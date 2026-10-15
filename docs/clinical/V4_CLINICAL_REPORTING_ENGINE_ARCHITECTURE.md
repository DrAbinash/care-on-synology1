# CARE Clinical Reporting Engine v4.0 — architecture and stage plan

**Status:** Stage A (this document) + Stage B (the catalogue schema) are implemented in this PR.
**Baseline:** `origin/main` = `1841668b` (PR #1012, the C3 metadata readiness audit).
**Scope licence:** §0 of the owner brief — the radiology reporting workspace is **not in clinical
production**, so its architecture may be redesigned. The wider CARE ERP **is** in production and
is not touched by this plan.

This document is deliberately short and deliberately numeric. Every count in it was measured on
this tree, not remembered; file:line citations are given so each claim can be re-checked.

---

## 1. What the workspace is today, measured

Four independent sources currently hold clinical reporting content, and none of them is
authoritative:

| Source | Size | Who reads it |
|---|---|---|
| `artifacts/diagnostic-erp/src/lib/zai-workspace/quick-select-tiles.data.ts` | **127 tiles** (101 write Findings, 4 impression, 7 technique, 11 history, 4 recommendation) | the reporting canvas Quick Select strip, via `zai-workspace/store.ts:1100` |
| `radiology_quick_findings` (PostgreSQL) | **363 live rows**, written by 136 `ON CONFLICT (study_type, label) DO NOTHING` statements across 20 migration files | `GET /api/radiology/quick-select` → `QuickFindingsPanel.tsx` — a *second* authoring surface |
| `lib/conceptCanon/contentPacks.ts` | **555 content packs** | concept canonicalisation, plus `GET /api/radiology/content-pack-tiles` which serves the YAML directly |
| `seeds/radiology/content-packs/v1/*.yaml` | 28 packs, 276 findings | the same route as above; **the catalogue importer cannot parse them** |

The canonical catalogue that was supposed to end this — `migrations/add_radiology_catalog.sql`,
tickets B1/B2, 11 tables — exists, is mounted, is gated behind `ff_radiology_catalog` (default
**off** in all five layers), and contains **zero clinical content**: `finding_definitions` has 0
rows on a freshly migrated database (measured). Its importer (`artifacts/api-server/src/lib/
radiologyCatalog/packs/`) has no production caller, and its `packs/types.ts` describes a YAML
shape the 28 real packs do not use — `validator.ts:49` would reject every one of them for a
missing `schema_version`, which no pack has. So the catalogue is not "unfinished"; it is
*unfinishable as built*, because it models one atom (a finding) and nothing else.

What the eleven B1/B2 tables do **not** model, verified column by column: an examination, an
authoring tile distinct from a concept, a tile version snapshot, which normal sentence a tile
replaces, an anatomical section ordinal, a conflict group, a parent/child relationship, a
combination rule, a dependency, provenance, and a per-study selection record. Every one of those
exists somewhere in the runtime — as a free-text column, a TypeScript field, a YAML array, or an
in-memory computed value that the importer discards — and none of them is a table.

The C3 audit (`artifacts/diagnostic-erp/src/lib/clinicalMetadata/coverage-baseline.json`,
merged in #1012) measured what that costs:

```
findingsTiles 101   safe anatomical rank key 2 (2.0%)   needs clinical mapping 96   no key 3
multi-sentence tiles 22   tiles sharing one baseline target 6
conflict groups holding both a normal and an abnormal: cholelithiasis, hemorrhage,
                                                        pneumothorax, spondylolisthesis
examinations with an owned baseline manifest 4   without 7
22 alias collisions   7 concepts under more than one conflict group
13 tiles whose only level metadata is prose with an unfilled "___" blank
severity: 1 ERROR, 120 WARNING, 74 INFORMATIONAL, 60 REQUIRES_RADIOLOGIST_REVIEW
```

Two of those numbers decide the architecture. **2.0 %** is why anatomical ordering cannot be
turned on for the whole workspace: 99 of 101 findings tiles have no trustworthy position, so any
"sort the report by anatomy" change would silently reorder 99 % of sentences with no clinical
basis. And **3 tiles out of 127 carry an `anatomicalSection`** (`grep -c` measured 2026-10-15),
which means section membership has to be authored, not inferred.

---

## 2. The model

One catalogue, in PostgreSQL, as the authoritative source. The entity set is chosen so that every
§2 responsibility of a tile is a *column or a row*, never a property inferred from prose.

```
clinical_examinations        modality + body part + protocol scope  (the billed unit)
clinical_anatomical_sections section identity + an explicit, unique ordinal     (§16)
clinical_normal_slots        the baseline sentence an examination asserts, per slot
clinical_tiles               one clickable observation, bound to a canonical concept
clinical_tile_examinations   where a tile appears, and in what position
clinical_tile_parameters     declared parameters, bound to the existing parameter library
clinical_tile_normal_replacements   which normals this tile retires and restores
clinical_tile_relationships  parent_child | requires | excludes | supersedes | combines_with
clinical_combination_rules   A + B → this one consolidated sentence
clinical_combination_rule_members
clinical_recommendation_rules conditional advice, with an emit policy
clinical_publications        what was released: content hash + the whole frozen catalogue
clinical_current_publications  (view) the one governing publication per examination
```

Eleven tables hold editable content, one holds history, and one view derives the present. The
history is a single table on purpose: `clinical_tile_versions` and `clinical_publication_tiles`
existed in earlier revisions and were removed, because `catalogue_snapshot` on the publication row
already freezes every tile at every column the manifest could name, and a second place that claims
to remember is a second thing that can be wrong. §2a records what replaced each of them and which
test proves the replacement holds.

Reused rather than replaced, because it is already the right shape:

* **`finding_definitions` is the concept.** A tile's `concept_id` is a RESTRICT foreign key to it.
  This is what makes "which canonical concept does this sentence assert" answerable — the question
  `radiology_quick_findings` cannot answer because it has no concept column at all.
* **`parameter_groups` / `parameter_options` are the parameter vocabulary.** `clinical_tile_parameters`
  points at them, so the dormant reusable library from B1 becomes load-bearing instead of a second
  thing to migrate.
* **Concept canonicalisation** (`conceptCanon/`), the **baseline manifest contract**
  (`lib/baseline-manifest`: `persistenceOwnershipSlotKey`, `normalizeLevel`, `normalizeLaterality`),
  the **observation ledger**, the **Quick Select parameter contract** (#877), the **C3 audit**
  (#1012) and the **report preview harness** all stay. The catalogue is the source they read from;
  none of them is re-implemented.

Deliberately **not** FK-linked: `clinical_examinations.template_key` is a soft text reference to
`structured_report_templates`. That table is production, has int4 ids, and holds 0 rows on a
migrated database. A dormant schema must not acquire a live dependency on a production table; the
B1/B2 file states the same discipline (`radiologyCatalog.ts:23`).

Eight properties are enforced by the database, not by application code, because the content will
arrive through SQL seeds and an admin editor, both of which bypass any service layer the B1/B2
tables relied on:

1. **Enums as CHECKs.** `modality` accepts exactly the eleven tokens of the ERP's own `Modality`
   union (`zai-workspace/types.ts:5`), and a test asserts the two lists are equal by reading both
   files, so they cannot drift apart. `laterality` accepts `left|right|bilateral|midline` or NULL —
   which is what makes `'LEFT'` and `''` impossible, and those two spellings are exactly how the
   22 alias collisions happened. The B1/B2 tables have no CHECKs at all; adding them here is the
   difference between a rule and a intention.
2. **Keys are unique among live rows**, so a retired tile frees its key but a signed report's
   provenance row is never silently re-pointed.
3. **`ON DELETE RESTRICT` everywhere, no cascade.** A concept, a normal slot, an examination or a
   tile in use cannot be destroyed — it can only be soft-deleted.
4. **Order is a nullable integer that must be positive when present**, unique per
   `(examination, section)`. NULL means "not yet placed", which is a fact about a draft; a
   duplicate position is a write error, and an incomplete order is refused at publication rather
   than composed in whatever order the database happened to read.
5. **A normal slot is identified the way the reporting runtime identifies it:**
   `(examination, field, region, concept, level, laterality)` with `TRIM`/`LOWER` normalisation.
   `lib/baseline-manifest` documents the persisted ownership key as `region | concept | level |
   laterality` and `buildSlotKey` (`artifacts/diagnostic-erp/src/lib/observationSlot.ts:287`)
   builds that, so the catalogue cannot invent a fifth dimension or drop one without the two
   disagreeing — which is a static test, not a paragraph. Section is placement metadata, never
   identity: one lumbar section legitimately holds disc, facet, ligamentum flavum, foramina and
   canal normals at the same level, and one basal-ganglia claim must not be storable twice under
   two sections.
6. **A section reference means a section of the same examination.** `section_id` alone only proves
   the section exists; every table that carries both an examination and a section now keys the pair
   (`FOREIGN KEY (examination_id, section_id) REFERENCES clinical_anatomical_sections
   (examination_id, id)`), which is what makes "an MRI Brain tile in an MRI Cervical Spine section"
   unwritable. The same trick closes the parameter library hole: a default answer must come from
   its own parameter's option list (`(parameter_group_id, default_option_id)` →
   `parameter_options (group_id, id)`). Because a composite key with a NULL half is skipped by
   `MATCH SIMPLE`, each one has a companion CHECK that states the missing half is not legal.
7. **A publication cannot be rewritten or deleted.** `clinical_append_only_guard()` fires
   `BEFORE UPDATE OR DELETE` on `clinical_publications`, which is now the only history table and
   therefore the only thing the guarantee has to cover. Uniqueness was not enough: the previous
   revision also guarded `clinical_tile_versions`, where `UPDATE clinical_tile_versions SET
   snapshot_json = …` could change what "version 1 of this tile" meant while leaving the row — and
   therefore the citation in a signed report — apparently intact. That row no longer exists to be
   rewritten; the frozen document sits in the immutable publication instead.
8. **Three invariants are facts about a set of rows**, so they live in a deferrable constraint
   trigger (`clinical_publication_gate`) rather than a CHECK or a foreign key: an examination with
   an unplaced live tile may not be published, a combination rule with no required member may not
   be published, and a tile or rule may not reference a normal or a placement belonging to an
   examination it is not placed in. It is `DEFERRABLE INITIALLY IMMEDIATE` on purpose: a bulk seed
   may defer it, while the default is that a refusal lands on the statement, which is the only way
   a suite that rolls back every test can prove the gate ever ran.

### 2a. What the independent review changed, and what it refused to change

Ten defect families in the first revision were reproduced as fifteen executable probes against a
database built by the original migration, each inside a rolled-back transaction, before any of the
above was written. Confirmed and fixed: cross-examination section references in four tables
(placement, parent section, rule section, slot section), a parameter default taken from another
group, the section-based normal-slot identity (both directions: legitimate normals refused,
duplicates accepted), `ordinal NOT NULL DEFAULT 0` making the second tile in an examination
unwritable and an adjacent swap impossible, a tile relating to itself, a tile carrying no clinical
text, a combination rule whose members are all optional, a `content_hash` holding prose, a
rewritable version-history row, and an inverted numeric parameter range stored without complaint.
An eleventh gap — a publication that could name no catalogue content at all, so neither rollback nor
citation had an answer — was found by reading the model rather than by a probe, and is closed by the
`catalogue_snapshot` document carried on the publication row itself. Every one of these is now an
executed test in `lib/db/src/schema/clinicalCatalogue.db.test.ts`; the probe script itself was a
review artefact and is not part of the repository.

Refuted, and therefore not "fixed":

* **`region` alone was not the missing dimension.** Adding it to the index would have kept the
  duplicate case (one claim stored under two sections) while still refusing real anatomy. The
  runtime's own four-part key was the answer, and it is a smaller change, not a bigger one.
* **Alphabetical or insertion-order fallback was not added.** §16 forbids it; the ordinal is the
  order, and an examination with an ordinal missing is a draft, not a report.
* **Multi-tile relationship cycles were not constrained here.** A `CHECK` sees one row and a
  foreign key sees one pair; cycle detection belongs to the composition walk in Stage D, which is
  where a cycle can be refused *while composing* rather than rejected *while editing*. A
  self-relationship is refused in the database because it is expressible in one row.
* **`deferred constraints` for reordering were not used.** `DEFERRABLE` unique indexes do not
  exist in PostgreSQL; the sparse-ordinal-plus-publication-gate design gives the same behaviour
  with features the clinic's PostgreSQL 16 already has, and no per-row staging table.

For an administrator, the reorder protocol is two statements in one transaction: unplace the rows
that are moving (`SET ordinal = NULL`), then write the new positions. Reordering a whole section is
one unplace plus N updates. Two people editing one examination serialise on
`SELECT … FROM clinical_examinations WHERE id = … FOR UPDATE`, which is why the placement table
cannot itself own the lock.

### 2b. Two architecture questions answered by storing the case, not by arguing about it

Both were executed against a database built by these migrations, inside a transaction that was
rolled back. Neither proves that a report is *composed* correctly — that is Stage D — only that the
model can hold the case at all.

* **The owner's Fazekas case is representable.** Two tiles (Fazekas grade I white-matter change;
  senile cerebral atrophy), each bound to its own concept and each placed in its own anatomical
  position in one examination; one `clinical_combination_rules` row targeting `impression` with
  `suppress_members = TRUE` and `requires_only_members = FALSE`; two required members; and a
  conditional recommendation carrying `emit_policy`. It publishes: the gate raised no refusal. So
  "two observations, one consolidated Impression, no duplicate, no unnecessary recommendation" needs
  no schema change — what it still needs is the composer that reads these rows, which is
  deliberately not in this stage. And both combined sentences are recoverable from the publication
  itself: the frozen document carries each tile's own `findings_text`, so a citation to this
  publication resolves both halves of the consolidated line with no second table naming them. That
  last half is no longer a probe result but an executed test in `clinicalCatalogue.db.test.ts`.
* **Nothing in this schema can reverse a direction.** `laterality` exists as a column on exactly one
  table (`clinical_normal_slots`, where it is part of the slot identity), there are no generated
  columns, and the only two triggers in the family are the append-only guard on
  `clinical_publications` and the publication gate; neither function mentions laterality at all. A
  midline-shift direction is therefore not a field anything here derives from a side. The honest
  consequence is the other way round too: the direction survives a re-composition only because the
  merge layer keeps prose intact
  — `artifacts/diagnostic-erp/src/lib/reportFieldMerge.ts` no longer folds a sentence onto a similar
  one — not because the schema guarantees it. Which fields are directional stays an owner
  decision, recorded in §"Decisions that are the owner's".

---

## 3. Ownership: what Stage C will build on

The runtime already has a ledger, and it is good: `appliedPathologyPatches`
(`zai-workspace/store.ts:1105`), serialised as `care.observation_ledger.v1` inside
`radiology_report_drafts.structured_json`, carrying per observation `templates` (what was
promised), `lastRendered` (what actually landed in the prose), `replacedBaseline` (the restore
payload), `protected` and `stale`. Removal, restore, hydration and hash-based staleness detection
are implemented and covered by 73 executed cases (`observationPersistence.hardening.test.ts` 31,
`observationOwnership.phase12.test.ts` 42). **Stage C does not replace
it.** Three things are missing, and they are the three things §3 and §17 require:

* **No stored sentence owner.** Nothing maps `sentence → tile`. Ownership survives only as the
  `qs-${tile.id}` id convention plus a scan. `reconstructProvenanceFromLedger`
  (`observationLedger.ts:446`) *computes* the owner set and then throws the ids away, keeping only
  source kinds. Stage C adds the owner index and writes it into the existing envelope.
* **No verb enum.** Today: `SameSlotPlan.action = "insert"|"noop"|"update"`, a 3-value removal
  outcome, and a 6-value dependency reason. ADD/UPDATE/REMOVE/REPLACE/COMBINE/SUPPRESS/RESTORE do
  not exist as a contract. **COMBINE has no implementation anywhere** — B-02 deliberately made the
  merge layer incapable of combining (`reportFieldMerge.ts:399-447`), which is why §9's
  Fazekas-plus-consolidated case has no home. `clinical_combination_rules` is that home.
* **No redo, and no fine-grained undo.** `grep -r "redo" artifacts/diagnostic-erp/src` returns
  nothing; `popClinicalUndoSnapshot` discards the frame it pops. Undo is a whole-report snapshot
  (`clinicalUndo.ts`, depth 5), so one press can roll back several tiles. §17 needs per-contribution
  granularity: it is built on the ledger, not on the snapshot stack.

Order-independence is a known, documented gap: PR #1009's own body records that retirement is
order-dependent ("haemorrhage then hydrocephalus leaves both halves on the page; the reverse order
retires the denial"). The cause is structural — `applyPathologyPatch` replaces in place via
`replacementSlot` (`pathologyPatch.ts:420/459/497`) and an `owns()` predicate that reads the
current prose. The fix is not a patch to that function: it is composing **from the observation set**
in catalogue order and diffing against the previous render, which is Stage D. T17 (all click-order
permutations produce one report) is the test that decides whether Stage D is acceptable.

Manual editing keeps the three states §17 names — `GENERATED`, `MANUALLY_EDITED`, `FROZEN` — and
extends machinery that already works: per-sentence provenance (`FieldProvenanceMap`), the manual
protection predicate (`isProtectedManualSentence`), `impressionOrderFrozen`, and the permute-only
reorder guard (`isImpressionReorderOf`, `store.ts:2878`, which already refuses a reorder that adds,
drops or rewords). No token named `MANUALLY_EDITED` exists yet; nothing freezes the whole report
because one sentence was typed.

---

## 4. Stage sequence — one PR per stage, and no big bang

| Stage | Deliverable | Rollback |
|---|---|---|
| **A** | this document | revert the PR |
| **B** | the 12 catalogue tables + the governing-publication view, forward-only, + 18 examination scope rows as drafts | drop the 12 tables and the view; nothing reads them |
| **C** | observation ownership engine: verb contract, sentence owner index, parameter declaration, undo/redo granularity | in-memory; the ledger envelope version falls back to `absent` |
| **D** | deterministic composer: observations + catalogue → Findings/Impression/Recommendation, in ordinal order, order-independent | preview harness first (`pnpm preview:reports`), then a flag |
| **E** | normal baseline replacement from `clinical_normal_slots` | the slot table is additive; restore falls back to `replacedBaseline` |
| **F** | Clinical Tile Studio (admin CRUD, live two-pane preview, publish gate) | admin surface only; the data stays |
| **G** | workspace integration behind `ff_clinical_catalogue_v4` | flag off |
| **H** | content migration for the 18 examinations, with every uncertain relationship recorded as `review_state='uncertain'` | per-examination, reversible because the legacy sources are still in place |
| **I** | T01–T35 acceptance suite plus the golden corpus | tests only |
| **J** | retire the legacy surfaces | last, and only after I is green |

Stage J has a measured constraint the C3 audit wrote down (`docs/clinical/
C3_ANATOMICAL_METADATA_REVIEW.md`, Phase J): of three options for legacy ordering, **Option B**
(opt-in ordering per examination, with a preview and an explicit approval) is the only one the data
supports. Turning ordering on workspace-wide is refused at 2.0 % coverage, and Option A ("sort
nothing") leaves the reports as they are.

`report_finding_instances` is *not* repointed in Stage B. It exists, is written at sign time by two
`patient-reports.ts` paths, and its `finding_id` is an `integer` pointing at
`radiology_quick_findings.id` while the catalogue's keys are `bigint`. Adding nullable columns is
safe, but doing it before a reader exists would be schema decoration. It belongs to Stage C, with
the code that writes it.

---

## 5. Performance, AI, and safety

**§23 (< 100 ms recomposition)** is a target, and the architecture can meet it: composition reads
one examination's rows (tens of rows), which are cacheable per `clinical_publications.content_hash`,
and performs no LLM call, no network call and no per-click query after the first read. The cache
key is the publication hash, so invalidation is correct by construction rather than by a TTL — and
T22 (publish invalidates) and T23 (unpublished edits are inert) are testable against the table
instead of against a comment.

**§1 / §22 (no generative AI in the standard workflow)** needs no new mechanism: the deterministic
path today already contains no LLM call, and the interactive AI is behind explicit invocations
(#881, #882, #919). Stage D must not call it, and the acceptance suite asserts T21/T29 — a report
composed with AI disabled and with no network reachable.

**§27 boundaries, as implemented:** no production table is altered or read into a foreign key; no
`DROP`, `TRUNCATE` or unfiltered `DELETE` appears in either migration (asserted by a test that
strips SQL comments first, because this file's own safety notes would otherwise match the regex);
the migrations create tables and eighteen administrative rows only; nothing deploys; nothing merges.
`scripts/migration-bootstrap-smoke.mjs` proves the replay property on a real server: after re-running
every migration, `patients` and `patient_reports` counts, the total table count, the stored
signed-report content hash and the AI-audit `anonymized` default are all unchanged.

---

## 6. Decisions the owner must make (clinical, not engineering)

Nothing here blocks Stage C. Each is recorded in the data as `uncertain` or as a review field, so an
answer becomes a row update rather than a redesign.

1. **Is "X-ray" an examination?** The brief lists it as the eighteenth; the product bills fourteen
   distinct `X-Ray …` study types. `xr.chest` is seeded as `uncertain` — a placeholder for the
   decision, not an approved scope.
2. **Is MRCP a body part or a protocol?** Seeded `uncertain` for the same reason.
3. **`US` or `USG_OB` for obstetric ultrasound?** The ERP declares both; the shipped tiles use `US`.
4. **Who ratifies wording?** C3 logged 60 `REQUIRES_RADIOLOGIST_REVIEW` findings, 22 alias
   collisions (including `meniscus` → pleural effusion at `contentPacks.ts:924`) and 7 concepts under
   several conflict groups. Stage H cannot author content truthfully without a named reviewer, and
   the engine must not silently pick a winner.
5. **The four conflict groups holding both a normal and an abnormal** (`cholelithiasis`,
   `hemorrhage`, `pneumothorax`, `spondylolisthesis`): selecting the abnormal must retire the normal,
   but a group that contains both makes "selecting one deselects the others" self-contradictory.
   §7's SDH-plus-SAH case says some of these must *coexist*, so the answer is per group, not global.
6. **Combination semantics** for §9 and §12: which sentence wins, and whether the members' own lines
   are retired (`suppress_members`) or kept alongside the consolidated line. The columns exist; the
   clinical policy does not.
7. **DVT extent wording** (§11): "never invent an extent" is implementable as
   `clinical_tile_parameters.is_required`, but only once someone states which extent phrases are
   authorised.
8. **Midline shift direction** (§8): the brief says do not auto-reverse it when laterality changes.
   That is a policy, and today `relateralizeOwnedText` (`pathologyPatch.ts:606`) does a literal
   replace of the previous side token — Stage D must be told, in data, which fields are directional.

---

## 7. What this PR does and does not do

**Does:** adds twelve catalogue tables plus the one view that derives each examination's governing
publication, with their Drizzle declarations (`lib/db/src/schema/
clinicalCatalogue.ts`), exports the shared column fragments from `radiologyCatalog.ts` so both
halves of one catalogue cannot disagree about what soft delete means, seeds the eighteen examination
scopes as `draft`, and proves the constraints behave as declared on a real database
(`clinicalCatalogue.db.test.ts`) as well as statically (`clinicalCatalogue.schema.test.ts`). The
second revision of this stage (the independent review, §2a above) added the same-examination
composite keys, the runtime slot identity, sparse ordinals, the append-only trigger and the
publication gate — the ten defect families reproduced as failures
first, and every guard then verified by deleting it: 36 executed mutations (28 DDL mutations
replayed against copies of the migrated database, 8 text mutations of the migration file) each
turned a suite red, 36/36. The two mutants that first survived were not weak constraints but weak
tests — an existence check that proved a phrase appeared somewhere in the file rather than in the
table it belongs to, and a two-column NOT NULL probe that passed because the other column fired —
and both guards were rewritten. That battery is a review artefact, not repository content; what
stays in the repo is the behaviour it forced.

One thing this stage deliberately leaves open, because inventing it here would be a clinical
decision dressed as a schema decision: the hash algorithm is not fixed by the schema — the CHECK
pins its shape (64 lowercase hex), not its computation. A second item that used to sit in this
paragraph, "a publication's manifest need not cover *every* tile in the examination", is closed:
the third pass replaced the manifest with a document that gate check 14 compares to the live rows in
both directions, so partial coverage is now refused rather than left to a future publisher.

**Does not:** read from any of it, change any report, touch billing, registration, cashier,
accounting, PACS/DICOM, Orthanc or any hospital integration; deploy; or merge. The workspace behaves
exactly as it did, because no code path reaches these tables.

## 8. Stage B hardening — four contracts, and what the third pass found

The second review of this stage asked four questions rather than requesting four features: can a
publication be restored, is a selection state expressible, does a combination rule reach one field,
and what exactly is refused at publication. Each became a contract, and each contract is executable
or it says so.

**The publication snapshot** (`lib/db/src/cataloguePublicationSnapshot.ts`, gate check 14).
A publication used to be a hash plus a list of tile versions, which answers "what wording was live"
and nothing else. It now freezes one canonical JSONB document in **ten domains** — examination,
sections, normalSlots, tiles, placements, parameters, normalReplacements, relationships,
combinationRules (members nested inside their rule) and recommendationRules — carrying every column
of every row it claims to restore, except `created_at` and `updated_at`, deliberately: a content
hash that moves with the clock is not a content hash. Attribution columns (`created_by`,
`updated_by`) are frozen, because who wrote a sentence is clinical fact. Deterministic serialisation
is executable rather than described: keys sorted at every depth, entries ordered by
`(ordinal NULLS LAST, ordinal, identity)`, timestamps as ISO-8601 UTC, integer-shaped strings
normalised so a `node-postgres` publication and a Drizzle publication hash identically while a
NUMERIC clinical threshold stays exactly as the clinic entered it. Every array entry carries an
`identity`, and check 14 compares the document against the live rows **in both directions**, with
duplicated identities refused separately because a set comparison cannot see them. Restorability is
proved by deleting the catalogue and rebuilding it from the frozen document alone: the recomputed
hash matches. Two limits are stated rather than hidden: the canonical vocabulary the domains point
at by id (`finding_definitions`, `parameter_groups`, `parameter_options`) is not frozen — that is
what `snapshot_version` exists to carry an eleventh domain for — and check 14 certifies
**membership, not content**: measured, a document with true identities and one fabricated sentence
publishes, because only the publisher's serializer can produce the canonical bytes and pgcrypto,
though available on the box, is not installed. `publicationColumnsFor()` is the guard that holds
(hash the exact document you store), and a test pins both halves of that so nobody reads the gate
as content authentication.

**The selection-state contract** (`clinicalSelectionContract.db.test.ts`). Seven states, and the
file says which of them a schema can already see: A selected, C mutually exclusive, D compatible,
E parent-child and F normal-suppression are Stage B facts; B explicitly-deselected and G radiologist
override are study-level and the catalogue must not gain a column for either. The nine
order-dependent tile pairs PR #1014 measured on `main` are mapped onto declared resolutions; eight
are normal-versus-abnormal suppression through an edge, and the ninth — glioma recurrence against
cerebral edema — is declared `coexists` because printing both is the conservative mechanism, with
its clinical wording marked **awaiting radiologist review**. Four facts are proved against the
database: an unresolved pair is unpublishable in either direction of unresolved; "these two
deliberately coexist" is a row, so the absence of a row can no longer be read as a decision, which
is exactly how the nine pairs survived; a normal is retired only by an edge, so a deselection has
exactly one restore set; and resolution and print order live in different columns — changing one
leaves the other byte-identical, measured on the frozen domains. The honest limit is written down
too: two tiles in different conflict groups with nothing between them are undeclared, not declared
compatible, and no finite row set enumerates every pair, so the default (print both, evict neither)
is a Stage C obligation, stated as a skipped test.

**The field-scoped combination contract** (`clinicalCombinationContract.db.test.ts`). The brief's
sentence — do not suppress Findings because the corresponding Impressions were combined — is a
shape, not a policy: a rule has exactly one `target_field`, `suppress_members` is a boolean, and
there is no value that means "combine the Impression and delete the anatomical Findings". Proved
constructively: the same two tiles at the same precedence number in two different fields publish
without colliding, because a claim is a claim within a field. Precedence is per
`(examination, field)`, positive, claimed once, released by deprecation; an overlap cannot be dodged
by making the shared member optional, because check 3 then refuses the hollow rule. **Confirmed
defect:** checks 1 and 9 already refuse a published tile or section with no position, but nothing
refused a live combination rule with `ordinal IS NULL` — the frozen document stated that two
observations consolidate and stayed silent on where, so the restoring composer invented a tiebreak
and the invention became the configuration. Gate check 16 refuses it, using the same
`status <> 'deprecated'` predicate as the unique index and check 12 so the three cannot disagree
about who is in force.

**The publication-validation contract** (`clinicalPublicationValidation.db.test.ts`) draws the
three-layer line the brief asks for: draft validation keeps a half-finished catalogue editable,
publication validation is where incompleteness stops being legal, and runtime selection validation
belongs to one study and must never block a publication. Each of the ten §4 items names the layer
where its last line of defence sits — nine to the gate, and duplicate logical normal slots to the
unique index, where the state cannot be stored at all, so the gate has no arm and needs none. Worked
in the same breath: a required `option` parameter with nothing to choose from is a publication fact,
a required `numeric` parameter nobody has answered yet is a runtime fact. Measurement found that
gate checks 2, 8, 9, 10, 11 and 15 had **never been executed against a real publication** — check 8,
the arm standing between a radiologist's sign-off and a patient reading a sentence nobody approved,
was asserted only in a comment. All five of its wording kinds are now refused and repaired one at a
time, and the `emits_heading` boundary is proved from both sides so a grouping row that reaches no
page cannot block a publication.

**Two defects the adversarial pass produced, not theorised.** On a database rebuilt from zero
through the real pipeline (15 drizzle + 193 feature migrations): retiring a tile that is placed in
an examination breaks no foreign key, and the examination then *published a document that had quietly
lost an observation* — the publisher's read drops the tile and its placement together, so neither
side disagreed about having lost it (check 17 refuses it, and a `deprecated` tile is deliberately
out of that arm because it still has wording history needs). And an `excludes` pair between this
examination's tile and **another examination's** tile was storable, declared both directions so check
6 was satisfied, and published — freezing the other examination's tile key into this publication and
making this report's resolution depend on a tile nobody can select here (check 18 refuses it; a
concept end stays allowed, because the concept list is canonical and examination-wide by design).

**The clinical acceptance specification** (`clinicalAcceptanceSpec.ts`) is data, so its completeness
is testable: the twenty cases exactly as §5 names them, all seven selection states exercised, every
report field exercised, and a case→contract and contract→case mapping checked in both directions with
a per-contract census. No case quotes a sentence — an expectation is a structural property (which
observations survive, in which field, retired by which edge, unchanged by click order) — and the four
cases whose outcome really is a clinical claim are marked awaiting review, which no code can sign
off. `CaseStatus` has exactly one member while there is no composer, so a case claiming it passed is
a compile error.

**Verification.** 126 tests pass with 32 skipped on a freshly migrated database; `tsc -p lib/db` is
clean; `check-migration-order` is clean; the api-server append-only census was unchanged at that
revision (53 tests) because no history table or trigger was added — the fourth pass below *did*
change it, and records what it changed. Fourteen mutations were attempted this round and
all were killed — three on check 16, four on checks 17–18, five on the acceptance spec's guards and
two on test-harness helpers. Three of them initially survived, and every one of those was a weak
test rather than a strong constraint: a deprecation assertion that left the rule at an ordinal so it
asserted nothing, a mutant that narrowed an arm while claiming to broaden it, and an anchor that
matched nothing because the harness converted `\n` to `\r\n` twice. The mutation drivers are review
artefacts in `tmp/`, not repository content; what stays in the repo is the behaviour they forced and
the tests that refuse to pass without it.

**Left open for the owner, unchanged from before:** whether an undeclared cross-group pair should
print both or ask; the clinical wording of the recurrence-versus-edema pair, the consolidated
Fazekas-and-atrophy line, which normals a hemorrhage retires, and the absent-cholecystitis negative;
whether a `deprecated` tile keeps its placement at publication; and whether the Recommendations field
is owned by `target_field='recommendation'` combination rules, by `clinical_recommendation_rules`, or
by an explicit precedence between the two.

## 9. Stage B fourth pass — the independent review, and the six corrections it justified

A second independent review read Stage B as a stranger would: the model, the gate, the snapshot
module, the migration and the tests, without the history of why each line was written. Findings came
back as RV-01…RV-09. Each was re-verified against the code before anything changed, and the two that
did not survive verification are recorded below, because a review that is never contradicted is never
actually read.

**RV-01 — the drift detector existed and nothing called it.** Confirmed, and it was the worst-shaped
finding in the round: `hashOfStoredSnapshot()` recomputed the hash of a stored publication, and the
only thing that ever invoked it was a test asserting the function exists. So the repository could say
"publication drift is detected" while the detection had no caller and no consumer. The correction
builds the read side properly and refuses to overclaim it:

* `verifyStoredPublication(row)` returns a verdict over four things — a `snapshot_version` this build
  can read, the stored document re-hashing to the stored `content_hash`, every domain of
  `SNAPSHOT_DOMAINS` present and shaped with an identity, and the document being scoped to the
  examination the row names. `assertStoredPublication()` is the throwing form.
* `loadVerifiedPublication()` and `loadCurrentPublication()` run the SQL through the exported
  `PUBLICATION_LOAD_QUERY` / `CURRENT_PUBLICATION_LOAD_QUERY` and hand back a verified document or
  throw. A missing row is a refusal, not a null, because a report citing publication 7 in a database
  where 7 does not exist is the same class of defect as a report citing one whose hash disagrees.
* `recomputeAgainstLiveRows()` is the drift question itself — does this stored publication still
  describe the live catalogue — answered without changing anything it reads.
* **What is NOT claimed:** no runtime consumer exists in Stage B, so no runtime verification exists
  either. The claim is bounded by an executed census (`gives a Stage C consumer no way to read a
  publication without verifying it`) that walks the production sources under the api-server routes,
  the api-server services and `lib/db/src`, and fails on any file that names a publication without
  calling the verifier. Measured today that census finds **zero** naming files, which is the honest
  form of "the verifier is ready, the runtime is not". The first Stage C consumer makes the number
  non-zero by adding a line to that assertion, and then either calls the verifier or CI names it.

**RV-02 — a required parameter could default to an option that no longer exists.** Confirmed, and the
previous revision of this repository had *pinned the wrong behaviour as correct*: the test read "a
default IS an answer: it publishes" for a default pointing at a soft-deleted option. Gate check 11b
refuses it now, in all three reachable shapes — an option that has been retired, an option whose
parameter group has been retired, an option whose status is not `active` — naming the parameter, the
tile, the option's label and key, and which of the three it found. The fourth shape the review asked
about, an option from a foreign group, is proved to need no arm: `clin_tile_param_option_in_group_fkey`
answers the UPDATE with `23503` and the state cannot be stored. Every refusal is paired with the
remedy it names, driven in the same transaction.

**RV-03 — two tables duplicated the snapshot.** Confirmed by reading the writers: nothing in the
product ever inserted into `clinical_tile_versions` or `clinical_publication_tiles`, while
`catalogue_snapshot` already froze every column of every tile a citation could name. Both tables are
**removed**, with their triggers, their Drizzle declarations, their types and their composite foreign
keys; the catalogue is now eleven editable tables plus one history table plus one view. The
requirements they were meant to serve are re-proved rather than asserted: *citation* is
`resolves the exact wording a publication froze, from the document alone`, and *rollback* stays
`restores the whole published configuration from the frozen document alone`. That one history table is
also the reason `clinical_append_only_guard()` now guards one table instead of three, which the
api-server census records out loud rather than letting a shrunken list look like a passing test. A test
asserts the **absence** of both retired tables and their Drizzle exports, because without it a later
revision can re-add a competing history and every other test still passes.

**RV-04 — two relationship kinds could contradict each other silently.** Confirmed: `clin_tile_rel_uq`
keys on (tile, kind, target), so `excludes` and `coexists` on one pair are two rows, both publishable,
and the composer must pick — where picking is a fact about traversal order, which is exactly the class
PR #1014 measured on the live workspace. Gate check 19 refuses four spellings (`excludes`/`coexists`,
`excludes`/`combines_with`, `excludes`/`requires`, `coexists`/`supersedes`) and, on purpose, does not
refuse two: `excludes` with `supersedes` names which of two retired sentences wins, and `requires` with
`supersedes` speaks about selection and about printing. Both allowed combinations are pinned so the arm
cannot quietly widen into a ban on more than one relationship per pair.

**RV-05 — concept-ended relationships were validated by nobody.** Confirmed, and structural: checks 6,
7, 13 and 18 all walk relationships through `related_tile_id`, so a row with that column NULL was
invisible to every one of them. The brief's alternative was "implement complete semantics or prohibit",
and the honest split is by what a concept can *mean*: `excludes`, `coexists` and `combines_with` assert
a fact about a pair, so a concept end leaves the pair's second member implicit and check 20a refuses it
with the remedy stated. `requires`, `parent_child` and `supersedes` point somewhere and a concept is a
legitimate target — it survives a tile being split, which is why the column exists — so check 20b
accepts them, but only for a live concept that a tile *placed in this examination* carries, because an
unsatisfiable requirement is advice that never fires while the catalogue says it does. Neither half is
a comment: each is executed against a real publication.

**RV-09 — which publication governs a report.** Answered with a derived rule, not a stored flag.
`clinical_current_publications` is `DISTINCT ON (examination_id) … ORDER BY examination_id, id DESC`,
so the governing publication is the greatest id, and gate check 0's `PERFORM … FOR UPDATE` on the
examination row is what makes greatest id mean *last to commit* rather than *first to start* (`NOW()`
is the transaction's start, so `published_at` cannot rank them and was not used). A new test binds it
end to end: an unpublished examination is refused rather than silently handed the live rows; the
session resolves exactly one identity; a second publication moves the governing row but not the
document the first session reads; `recomputeAgainstLiveRows()` reports the older publication as
superseded while reporting the current one as clean, which is how an upgrade stays a deliberate act
instead of an event that happens to a report; and both rows survive in commit order, so "which
catalogue did this report use, and has it been superseded" is a query. Stage C stores the resolved
`publication_id` in the report's own storage — the versioned draft envelope already exists, so neither
a new table nor a new catalogue column is required, and the catalogue holds scopes rather than
studies.

**Two findings that did not survive verification.**

* *"Check 14's membership comparison means the frozen content is authenticated."* It never did, and
  the review's own report said so — but the correction is not the paragraph that was already there.
  Check **14b** now compares the document's seven load-bearing columns against the live rows, with
  `IS DISTINCT FROM`, a deterministic `ORDER BY (key, ordinal)` and a refusal that quotes both values.
  The test that had pinned a fabricated sentence publishing is inverted, and the mutant that removes
  the comparison is killed by it.
* *"The gate's row lock makes a stale publisher impossible."* Refuted by construction: the lock
  serialises the two *writes*, and cannot retroactively refresh a document built before another
  transaction landed. The stale publisher is refused by 14b comparing the document to the newest
  committed rows, which is why the test is named for what the lock cannot do.

**Harness faults found while doing this, because they are the interesting part.** A
`return rows[0].id as number` in the fixture helper made `Promise<number>` a fiction — node-postgres
returns BIGSERIAL as a string — so a snapshot lookup by id found nothing and the new citation test
failed for a reason that looked like a bug in the verifier. A concept fixture that had been made
*reachable* by the preceding remedy step nearly let check 20b pass without ever firing. And the
deferred-gate test nested a `BEGIN`/`COMMIT` inside the suite's own transaction, where PostgreSQL
treats the inner `BEGIN` as a no-op and the first `COMMIT` ends the outer one — so the fixture vanished
mid-test and the failure read as "the gate refused at commit". All three were found by running the
code, not by reading it.

**Verification, this pass.** 131 tests pass with 12 skipped across the six catalogue files (152
passing, 32 skipped for the whole `lib/db` project); `tsc -p lib/db --noEmit` reports 0 errors; the
api-server append-only census is 53 passing with its list corrected from seven guarded tables to five.
The mutation battery had to be rebuilt before it meant anything: the first attempt edited
`migrations/*.sql` and re-ran the suites, and 10 of 19 mutants "survived" — because the gate is a
stored *function*, and a file edit does not touch the database the tests talk to. Every DDL mutant is
now replayed into a template clone of the migrated database. Result: **14 of 14 DDL mutants killed**
(check 0's lock; 11b's three disjuncts and the whole arm; 14b's comparison and two of its seven
columns; 19's spelling set narrowed and widened; 20a's kind list; 20b's carrier test; the view's
ordering and its per-examination collapse), and **9 of 9** source-level mutants killed (verifier hash
comparison, missing-row refusals, the loader's view routing, a re-added history table, the fixture's
`as number` lie, and a publication reader that bypasses the verifier). `tmp/` holds both drivers; they
are review artefacts and are not committed.
