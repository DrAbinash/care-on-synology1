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
clinical_tile_versions       append-only published snapshot
clinical_tile_parameters     declared parameters, bound to the existing parameter library
clinical_tile_normal_replacements   which normals this tile retires and restores
clinical_tile_relationships  parent_child | requires | excludes | supersedes | combines_with
clinical_combination_rules   A + B → this one consolidated sentence
clinical_combination_rule_members
clinical_recommendation_rules conditional advice, with an emit policy
clinical_publications        what was live, and its content hash
```

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

Five properties are enforced by the database, not by application code, because the content will
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
4. **Order is an integer with a unique constraint**, per examination. A duplicate ordinal is a
   write error, not a report whose section order depends on which row the database read first.
5. **One normal per anatomical slot** (`(examination, field, section, level, laterality)`), with
   `TRIM`/`LOWER` normalisation. This is the "6 tiles compete for one baseline sentence" case, and
   the level dimension is what lets L4-L5 and L3-L4 coexist without one migrating into the other.

Append-only by construction: `clinical_tile_versions` and `clinical_publications` have **no
`deleted_at` column**, and a test asserts their absence. A history you can soft-delete is not a
history, and a publication whose hash can be overwritten is not a cache token.

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
| **B** | the 13 catalogue tables, forward-only, + 18 examination scope rows as drafts | drop the 13 tables; nothing reads them |
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

**Does:** adds thirteen catalogue tables and their Drizzle declarations (`lib/db/src/schema/
clinicalCatalogue.ts`), exports the shared column fragments from `radiologyCatalog.ts` so both
halves of one catalogue cannot disagree about what soft delete means, seeds the eighteen examination
scopes as `draft`, and proves the constraints behave as declared on a real database
(`clinicalCatalogue.db.test.ts`) as well as statically (`clinicalCatalogue.schema.test.ts`).

**Does not:** read from any of it, change any report, touch billing, registration, cashier,
accounting, PACS/DICOM, Orthanc or any hospital integration; deploy; or merge. The workspace behaves
exactly as it did, because no code path reaches these tables.
