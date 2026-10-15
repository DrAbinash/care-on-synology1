# Stage C integration map — measured before coding

Baseline: `main` = `748a4c5c` (Stage A+B merged). Worktree `care-v4-stage-c`, branch
`clinical/v4-stage-c-deterministic-engine`.

Every claim below is a `file:line` in this tree or an executed result. Nothing here is inferred from
a name.

## 0. The one sentence that matters

The workspace already has everything Stage C needs **except** a rule that computes clinical state from
the **final selection set**. Today it computes it from the **order the boxes were clicked**, and one
private per-patch list decides what a normal sentence is allowed to come back. That list is the defect,
and it is measured in §3.

## 1. What already exists — reuse, do not rebuild

| Concern | Existing owner | Evidence |
| --- | --- | --- |
| The authoritative observation store | `appliedPathologyPatches` — one, and only one | `store.ts:679`, row type `store.ts:272-282` |
| Canonical observation identity | `buildCanonicalObservation`, `buildSlotKey`, `resolveConcept` | `observationSlot.ts:301, 287, 241` |
| Concept / level / laterality ownership | `sentenceOwnedBySlot`, `conceptsAssertedIn`, `isOppositeLaterality`, `observationsMutuallyExclusive`, `extractLevel`, `sentenceHasLevel`, `BROAD_ANATOMY` | `observationSlot.ts:515, 457, 344, 355, 163, 180, 120` |
| Sentence merge, dedupe, provenance | `mergeReportFieldContentWithProvenance`, `splitToSentences`, `normalizeForDedupe`, `reconcileProvenanceAfterManualEdit` | `reportFieldMerge.ts:490, 111, 102, 190` |
| Per-patch narrative overlay | `applyPathologyPatch` (`overlayPathology` at the call site) | `pathologyPatch.ts:324`, called `store.ts:2446` |
| Manual-text protection | `isProtectedManualSentence`, `contributionProtected`, `RemoveContributionOutcome = removed \| preserved-manual \| no-op-unproven` | `pathologyPatch.ts:195`, `observationSlot.ts:586`, `observationLedger.ts:60` |
| Ledger apply/remove + hydration | `removeLedgerObservation`, `serializeObservationLedger`, `parseObservationLedger`, `reconcilePatchAgainstNarrative`, `reconstructProvenanceFromLedger` | `observationLedger.ts:144, 311, 387, 943, 446` |
| Undo | `captureClinicalSnapshot` / `withPushedClinicalUndo` / `undoLastPatch`, depth 5 | `store.ts:363-391, 3488-3557`, `clinicalUndo.ts:5` |
| Save / reopen | `useDraftPersistence` save body + restore | `useDraftPersistence.ts:474-540`, `:296`; ledger envelope `store.ts:3032, 2959` |
| Recommendation alignment to observations | `alignRecommendationToObservations` | `impressionRecommendationWiring.ts:20`, called `store.ts:2491` |
| Impression dependency / staleness | `evaluateImpressionDependency`, `refreshImpressionFromObservations` | `observationLedger.ts:770, 1001` |
| The Quick Select click seam | `quick-select-strip.tsx:322` → `quickSelectTilePatch` → `applyPathologyOverlay` | `quickSelectTilePayload.ts:32` |
| Publication read API (Stage B) | `loadCurrentPublication(query, examinationId)`, `loadVerifiedPublication`, `assertStoredPublication`, `verifyStoredPublication` (pure), `recomputeAgainstLiveRows`, `buildCatalogueSnapshot`, `publicationColumnsFor` | `cataloguePublicationSnapshot.ts:635, 626, 600, 535, 655, 333, 427` |
| Acceptance specification | `CLINICAL_ACCEPTANCE_CASES` T1–T20 | `clinicalAcceptanceSpec.ts:62-405` |

**Do not add:** a second store, a second ledger, a second merge engine, a second provenance map, a
second AI Composer, a parallel workspace, or a new publication-history table.

## 2. Phase 2 has no data to bind to — measured, not assumed

This is the finding that reorders the work, so it is stated before anything is built.

- `migrations/zzzzz_seed_clinical_catalogue_v4_examinations.sql` inserts **`clinical_examinations`
  only — 18 rows** (`:29-75`), and every one is `status='draft'` (`:9-11`) with `review_state`
  `unreviewed`/`uncertain` (`:53, :62, :73`).
- `clinical_tiles`, `clinical_tile_examinations`, `clinical_tile_parameters`,
  `clinical_tile_normal_replacements`, `clinical_tile_relationships`, `clinical_normal_slots`,
  `clinical_combination_rules`, `clinical_recommendation_rules`, `clinical_publications`: **0 rows**.
  (Correct table name is `clinical_tile_examinations`, `:356` — there is no `clinical_tile_placements`.)
- `finding_definitions` holds 0 rows and `parameter_options` 0 rows (`zzzz…sql:20-21, :107`), while
  `clinical_tiles.concept_id` is `NOT NULL` FK → `finding_definitions` (`:293`). So even a fixture tile
  needs a concept row first.
- Gate check 8 (`:969-1001`) refuses an unapproved row, so a draft/unreviewed catalogue cannot publish.
- Zero files under `artifacts/` read any `clinical_*` table. The single grep hit is the trigger census
  in `businessTime.stage0.characterization.test.ts`. Enforced: `clinicalCatalogue.schema.test.ts:503`
  **fails** any `api-server/src/routes`, `…/services` or `lib/db/src` file that names a publication
  without arriving through the verified loader.
- `@workspace/db` exports exactly `"."` and `"./schema"` (`lib/db/package.json:5-8`).
  `cataloguePublicationSnapshot.ts` has **no subpath**, and `"."` throws without `DATABASE_URL`
  (`lib/db/src/index.ts:7-11`) while the snapshot module imports only `node:crypto`
  (`cataloguePublicationSnapshot.ts:71`).

Consequence: "every reporting session resolves exactly one authoritative publication" cannot be
demonstrated against clinic data, because none exists and creating it is clinical content authoring — a
radiologist decision, not an engineering one. Stage C therefore separates the two: the reducer is
verified against a publication **shaped exactly as `buildCatalogueSnapshot` produces**, and live binding
is a thin read-only adapter that is added once the clinic has an approved publication. The compatibility
path is explicit and required: **no v4 publication ⇒ the existing path runs unchanged**, and that is a
recorded state, never a silent success.

## 3. The Phase 4 defect, reproduced on the shipped store

Two shipped Cervical Spine tiles retire the **same** normal — `quick-select-tiles.data.ts:157`
(Burst fracture C5) and `:161` (Lytic lesion C2) both carry
`baselineReplaces: "Cervical vertebral bodies demonstrate normal height and marrow signal."`

Executed probe against `useWorkspace` (real store, real ledger, no schema-only test):

```
patch qs-…_yfhbl: replacedBaseline.findings=["Cervical vertebral bodies demonstrate normal height and marrow signal."]
patch qs-…_atc34: replacedBaseline.findings=[]
removeObservation -> removed
--- findings after deselecting Burst fracture C5 ---
Cervical spinal cord signal intensity is normal.
No spinal canal stenosis is seen.
Focal lytic lesion of the C2 vertebral body without cortical breach.
Cervical vertebral bodies demonstrate normal height and marrow signal.     <-- false normality
```

The report asserts normal vertebral bodies **while a C2 lytic lesion is still selected.** Two structural
causes, both visible in code:

1. `replacedBaseline` is a **private per-patch list** (`observationLedger.ts:53`), filled from what that
   patch happened to replace (`store.ts:2472, 2486`). When B applied, the normal was already gone, so B
   recorded `[]`. Removal restores the removed patch's own list and nothing else
   (`observationLedger.ts:181, 184` — `restoreBaselineSentences` has exactly these two callers).
   **Restoration is therefore keyed to click order, not to the surviving set.**
2. `restoreBaselineSentences` (`observationLedger.ts:133-142`) **appends at the end of the field**, which
   is also why the returned normal printed *below* the lesion instead of in its anatomical place —
   a Phase 7 ordering defect with the same root.

The catalogue already holds the correct answer as data: `clinical_tile_normal_replacements`
(`:432`) is a tile→slot edge, so the suppressed set is `⋃ over the active tiles`, and a slot returns
only when **no** active tile claims it. That is the reducer's job.

## 4. Order-sensitivity inventory (Phase 7 targets)

| Site | Why it is order-dependent |
| --- | --- |
| `store.ts:2490` `[…patches.filter(…), nextPatch]` | ledger order *is* click order; serialisation and restore follow it |
| `observationLedger.ts:133-142` | baseline restoration appends to the end of the field |
| `store.ts:3611-3617` | sequential `stripContribution` chain — voice patch order changes surviving text |
| `store.ts:3670-3688` | re-applies each observation one by one; Findings order follows the array |
| `store.ts:3810-3813` | `relateralizeOwnedText` reassigned per patch inside one `map` |
| `store.ts:1615, 1994, 2079` | `selectedFormatIds` (click order) picks which format is *a* and which is *b*, so `template-a`/`template-b` provenance colouring (`store.ts:3866`) is order-derived |

Ordering input already exists and is deterministic — snapshot array order is
`(ordinal NULLS LAST, identity)` (`cataloguePublicationSnapshot.ts:311-321`). Stage C must consume that,
not re-derive it.

## 5. Genuinely absent — must be built

1. **Set-based clinical resolution.** A pure function of (publication snapshot, active selection set,
   manual protections) → suppressed normals, findings, impression, recommendation, messages. No React,
   no DB, no AI, no clock, no `Math.random`.
2. **Redo.** There is **no** redo stack, no `restorePatch`, and zero matches for `redo` in `store.ts`.
   Undo exists at depth 5; Phase 9 requires the forward half.
3. **Undeclared cross-group default.** ~~`clinicalSelectionContract.db.test.ts:523` is `it.skip` —
   "print both, evict neither" is specified and unimplemented.~~ **Closed** — see §8. The runtime half
   now runs in `clinicalSelection/undeclaredPairPreservation.test.ts`; the schema-side `it.skip` stays,
   because a catalogue row still cannot express a runtime sentence.
4. **`NULL section_id` semantics.** `section_id` is nullable on `clinical_tile_examinations` (`:360`)
   and `clinical_normal_slots` (`:241`); check 10 only requires same-examination, so a cross-section
   retirement publishes today. Stage C must define it and refuse the ambiguous case.
5. **A publication read path for the client** — an `exports` subpath in `lib/db`, and one read-only
   route that goes through `loadCurrentPublication`, respecting the guard at
   `clinicalCatalogue.schema.test.ts:503`.
6. **Combination-rule `suppress_members` handling** — the column is `NOT NULL` with **no default**
   (`:525`), which is exactly Phase 8's "a rule targeting Impression must not silently remove members
   from Findings". There is no `resolution`/`precedence` enum anywhere; precedence is the nullable
   `ordinal` on `clinical_combination_rules` (`:537`).

## 6. Test surface, measured

Baseline in this worktree before any edit — **21 files, 349 tests, all green, 12.40 s**
(`tmp/baseline-clinical-core.log`): `reportFieldMerge`, `observationSlot.conceptsAsserted`,
`observationOwnership.matrix`/`.phase12`, `observationPersistence.hardening`,
`impressionRecommendationWiring`, `findingsImpressionDependency`, `pathologyPatchLevelTargeting`,
`quickSelectSlots`, `nondestructiveSentenceMerge.hardening`, `clinicalCompositionHardening`,
`compositionSafety.walkthrough`, `siblingContradiction.ownership`, `section5Impression`,
`reportingCanvasR2`, `reportFormatClinicalConsistency`, `wholeReportPathology`, `quickFindingsMerge`,
`quickSelectFindingsPayload`, `reportComposer/composeObservations`,
`structuredFormat/structuredObservations`.

Acceptance: all **20** cases in `CLINICAL_ACCEPTANCE_CASES` are `it.skip` whose body is
`expect(true, "no composer exists yet").toBe(false)` (`clinicalAcceptanceSpec.test.ts:148-157`), and five
(T2, T3, T5, T10 and one more) carry `wording: "awaiting-radiologist-review"` — they quote no clinical
sentence, so they are wording-blocked by an owner decision, not by code.

## 7. Recommended sequence

1. **Pure reducer first**, `lib/clinicalSelection/` beside the existing engine, typed against
   `SnapshotDocument`. Red-first from §3's reproductions; each Phase 4–9 rule becomes an executed
   assertion, and T12/T14/T15/T16/T17 turn from skip to run.
2. **Wire it under the existing ledger** as the baseline/order layer only. Manual text keeps
   `applyPathologyPatch` and the provenance rules untouched. One store, one ledger.
3. **Redo** as a sibling of the existing snapshot mechanism, reusing `captureClinicalSnapshot`.
4. **Live publication binding last** (Phase 2 proper): `lib/db` subpath + one read-only verified route
   + session identity, with the explicit "no v4 publication" compatibility branch.

## 8. Phase 5 closed — the narrative fence (measured first, then fixed)

**Mechanism, measured not assumed.** A census over every undeclared MRI Brain abnormal pair (distinct
concept AND distinct conflict group, no declared relationship) — 117 pairs, 4 that split by click order,
4 that lose a finding — gives one shape in every case: **the ledger row stays `live` and its sentence
leaves Findings.** So it is not `observationsMutuallyExclusive` (that needs an identical concept) and not
the same-slot replacement plan. It is the ownership oracle: `conceptsAssertedIn` reads a sentence as
asserting every concept it mentions, so "…post-resection cavity… suggestive of edema" reads as an edema
statement and the Cerebral edema box owned — deleted — the Glioma box's own sentence. A row present in
the state and absent from the page is a finding the radiologist believes they reported.

**Remedy: identity, not prose.** `liveContributionKeys` (`observationSlot.ts`) indexes the finding
statements of the other live ledger rows, and `applyPathologyPatch` refuses to own a sentence in that
set (`pathologyPatch.ts`, both the bare-unit and level-prefixed forms — a spine line's level is stored on
one side of the split and not the other). Callers: `applyPathologyOverlay` passes the ledger already
reduced for the write (incoming row and its mutex siblings dropped, so an in-place slot update still
replaces its own earlier wording), and `applyChangePlan` passes the dictation plan's own observations —
measured on that path too: the disc pair lost its first sentence without the fence.

**What stayed retirable, on purpose.** A live row's *normal* statements are outside the fence.
"No midline shift." inside the hydrocephalus box is a normal even though it travels with a finding, and
contradictory normals must go away automatically. Wording alone is not enough: a materialized Full Normal
baseline row also carries sentences that state no normality at all (an acquisition line, a comparison
note), so `findingRows` excludes rows by kind as well — `stale`, `source: "system"`,
`role: "baseline"`. That was measured, not designed: dropping the two kind checks made
`xrayChestSubMasters`, `cervicalQuickSelectCatalogue` and `reportPreviewHarness` fail, which is exactly
the false normality freezing that the first abnormality is supposed to retire. Baseline scaffold normals
are not contributions at all, so every retirement path the brain and spine catalogues depend on is
untouched.

**Tried and rejected, recorded so it is not re-derived.** Suppressing an *incoming* normal that a live
finding already contradicts does make the last click-order difference vanish, and it breaks four shipped
tests in `siblingContradiction.ownership.test.ts` (T1, T2, T7, T9) whose whole job is to keep a normal the
radiologist clicked on the page **and warn about it**. A clicked normal is theirs; the engine may retire
it as a contradicted baseline, never delete it quietly on the way in. Residual, bounded: a contradicted
normal is either retired (finding clicked second) or printed-and-warned (finding clicked first). Closing
that last asymmetry means the contradiction check reading the ledger instead of the page — a composition
change, not a fence.

**Evidence.** `clinicalSelection/undeclaredPairPreservation.test.ts` — 22 tests: the four census pairs
print both findings in either order, yield one report regardless of the mouse, keep manual text, restore
the whole baseline on deselection, and pin the ledger half (both rows stay) so a future fix that moves the
loss into the ledger fails loudly. Mutation battery `tmp/phase2b-mutants.py` — 9 mutants: fence removed,
each match arm alone, `stale`/`system`/`baseline` rows protected, live-row normals protected, and each
caller unwired — **9 killed, 0 survivors**, control 31 green over
`undeclaredPairPreservation` + `siblingContradiction.ownership`. Whole Stage C sweep after the change:
**76 files, 1764 tests, all passing**; `tsc -p artifacts/diagnostic-erp` stays at the 61 pre-existing
errors, none in the four files touched.

## 9. Phase 3 closed — the compositions a radiologist actually builds (measured, then two fixes)

`clinicalSelection/multiTilePreservation.test.ts` drives the shipped store over the shapes the journey
is made of, using **shipped tiles clicked onto the shipped per-level "Standard Normal" documents** — no
invented wording, because invented wording tests invented behaviour:

three levels of one family (disc bulge C4-C5 / C5-C6 / C6-C7) · three concepts at one level (herniation +
desiccation + cord compression at C5-C6, and the same three at L4-L5) · both sides of one box (foraminal
stenosis C5-C6, left then right) · the same slot named twice (herniation → extrusion; mild → moderate
stenosis) — the one shape where replacing is correct · removal in every order · a manual sentence written
into the middle of it. Every order assertion compares the *set of finding lines*, sorted: an observation's
sentence lands where its level block sits, so line position legitimately varies while the claims must not.

Two defects surfaced, both reproduced with the Phase 5 fence switched off (`liveRows: []`) to prove they
predate it — identical output, so neither is a regression from this branch.

**A — one box, two sides, one ledger row.** `quickSelectTilePayload.ts` minted `qs-<tile.id>` for every
click, while the engine resolves left and right into different `slotKey`s and the report the radiologist
is writing says both. The second click therefore overwrote the first row in the ledger (`dropIds` and the
row filter both key on the id) and left its sentence on the page. Measured on shipped data: Findings
carried "Left neural foraminal stenosis at C5-C6." **and** "Right neural foraminal stenosis at C5-C6.",
the Impression carried both, the ledger held one row recorded as right — so clicking the box off deleted
the right statement and left the left one printed, saved, and no longer backed by any observation. A
withdrawn clinical claim that cannot be withdrawn. The row identity now carries the side the click was
made with (`quickSelectRowId`), and the strip's chip reads as applied for any side of the box
(`quickSelectRowBelongsTo`). A tile that asks for no side keeps the exact id it has always had, so every
deselect-by-tile caller is untouched.

**B — a deselected level never gave its normal back.** `falsifies` route 2 (concept-level falsification)
had no level, so a bulge at C5-C6 also falsified the C4-C5 normal. Retirement at click time was already
level-correct (`applyPathologyPatch` checks the slot), and each row recorded its own
`replacedBaseline` — but on removal the survivor set said the sentence was still contradicted, the record
was filtered out, and it left with the row. Measured: three levels of disc bulge, all three boxes clicked
off, and the report permanently stated nothing about the C4-C5 and C5-C6 discs while C6-C7's normal came
back. The claim now carries the level it resolved to, and the guard fires **only** when both sides name a
level: a study-wide baseline ("No spondylolisthesis is seen.") stays falsified by any observation about
that concept, an observation whose level never resolved keeps the behaviour it had, and a regional bucket
("lumbar", from whole-spine screening) covers every level inside it. Guessing a level boundary would leave
a contradicted normal printed beside the abnormality that contradicts it, which is the worse failure.

**What deliberately stayed.** The severity ladder and same-slot replacement (herniation → extrusion at one
level still yields one row and one statement); shared study-wide normals under the Phase 3-9 set-based
rule — `baselineReplaces` is route 1 and returns before the level guard, so
`sharedBaselineRetirement.test.ts` is unmodified and passing; the §8 residual, untouched.

**Evidence.** 15 Phase 3 composition tests + 6 new unit tests on the two oracles
(`normalSuppression.test.ts`, `quickSelectTilePayload.test.ts`). The six suites that pin these two fixes:
**111 passed**. Mutation battery `tmp/phase3-mutants.py`: **6 mutants, 6 killed** — row id ignoring the
side, chip state matching only the exact id, `falsifies` without the level scope, the scope forgetting
regional buckets, the ledger claim dropping its level, and the guard firing where it must not. Full sweep
`tmp/stagec-all-tests.txt` plus the new file: **77 files, 1784 tests, 0 failures** (with `DATABASE_URL`
pointed at the scratch cluster; without it `applyChangePlan.safety.test.ts` cannot import
`@workspace/ai-providers` and errors at collection, which is environmental, not a verdict). No TypeScript
compiler is installed in this worktree, so the type-level check is CI's `pnpm typecheck`, not a local run.

## 10. Phase 4 closed — one box writes three fields, and removal is proved sentence by sentence

Phase 4 asks the deselection question the earlier phases left open: one Quick Select box can write a sentence
into Findings, a line into Impression and advice into Recommendation, and clicking it off has to take **its**
words out of each field it wrote and only its words. `clinicalSelection/fieldScopedComposition.test.ts` drives
that through the real door — the shipped "MRI LS Spine — Standard Normal" applied by id, then shipped tiles
clicked onto it — because the defect only appears once a real baseline has retired part of a tile's sentence.

**C — the deselection that could not remove anything.** `stripContribution` proved a row owned its contribution
as one block (`contributionPresent(fieldText, c)`). A box that carries a normal clause stops matching as a block
the moment another box retires it: the herniation box writes the finding *and* "No significant central canal
stenosis.", the stenosis box falsifies that clause, so after both clicks the recorded contribution is no longer
on the page as a single string. Removal reported `no-op-unproven` — and the store deleted the ledger row anyway.
The finding stayed printed with nothing on the ledger owning it, and a second click returned `missing`: a claim
that could no longer be withdrawn by any means the strip offered. Removal now proves ownership sentence by
sentence (`contributionChunks`), deletes each chunk that is actually on the page, keeps the whole-block path for
the case where the block is there, and returns `removed` only when text really left the field. All four fields
pass through the same code.

**D — the removal path had no identity fence.** Phase 5 fenced the *click*; nothing fenced the *deselect*. Once
removal is per sentence, a chunk list can contain a sentence a second live row also wrote, and the row being
deleted has no authority over it. `removeLedgerObservation` takes `heldElsewhere`, and `removeObservation`
passes the same oracle the click path uses — `liveContributionKeys(survivingPatches)` — with the whole-block arm
gated on it too. Three other call sites deliberately pass nothing (the contradicting-baseline sweep, the
system-normal yield, the withdrawn normal impression): each removes text the engine wrote, where the survivor set
is precisely the reason it must go.

**Where the fence stops, and why it is allowed to.** `liveContributionKeys` reads `lastRendered.findings` and
`.impression`, so Recommendation is not fenced — and does not need to be, because
`alignRecommendationToObservations` rebuilds advice from the surviving observations. The suite pins the shipped
case rather than asserting it in the abstract: herniation and spondylolisthesis both declare "Surgical referral
if neurological deficits develop.", and removing one keeps that line while the other is live and drops the box
that was removed having said anything of its own.

**Measured before being tested: how does one sentence come from two live rows?** Census over the shipped library
— 127 tiles, 97 non-normal, grouped by modality and body part, **1,148 distinct concept/conflict-group pairs**,
each compared with **every `{side}` × `{severity}` expansion** (the shipped library uses only those two
placeholders) — found **0** pairs sharing a Findings statement and **0** sharing an Impression statement. The
same census over `recommendationSentence` (21 tiles carry one) finds **31** pairs sharing an advice line, which
is the domain the aligner owns. So the Findings/Impression fence is *not* reachable from two library boxes today.
It is reachable from a box the radiologist wrote: `quickSelectTileFromForm` saves `custom: true` tiles with no
`concept`, so a custom box declares no relationship and coexists with the library box that says the same thing.
The two store-level tests are built on exactly that pair — a custom copy of a shipped sentence, not an invented
finding — which is why they are phrased that way and why the census is quoted in the file.

**Residual E — the Impression line order is still the order of the mouse.** With all three lumbar boxes on the
shipped normal document, the six click orders produce **one** set of Impression statements and **two**
sequences: herniation leads in HSP/HPS/PHS, stenosis leads in SHP/SPH/PSH. Findings splits the same way. The
composer is not at fault: `orderImpressionLines` sorts by `(rank, index)` and documents "stable for equal
ranks", while both statements classify as `UNCLASSIFIED_RANK` (50) and spondylolisthesis gets 8 — so the tie is
decided by insertion order, which is the click order. Deciding which of a disc herniation and a moderate canal
stenosis *leads* a lumbar Impression is a clinical ruling, and the clinic's own library already disagrees with
the shipped table on the neighbouring case
(`docs/clinical-libraries/mri-lumbar-clinical-content-library.md:204` puts spondylolisthesis above severe
foraminal stenosis with exiting-root compression, where `IMPRESSION_PRIORITY` ranks stenosis 5 and
spondylolisthesis 8). Guessing a second row of ranks would silently re-sequence every lumbar report, so this is
an **owner decision, left open**. A tripwire test states the rank gap and fails the moment the table is
extended, so the day a ruling is made the change is visible instead of silent.

**Found by widening the sweep, and fixed in its own commit: this branch's own undo/redo gate.** See §11.

**Evidence.** 14 tests in `fieldScopedComposition.test.ts`: the removal outcome and the exact claim set in all
six orders, the Impression line and its Findings sentence leaving together, the shared advice line surviving, a
manual sentence through every composition and removal, the custom-copy pair in both removal orders, four
`stripContribution` units, and the residual tripwire. Mutation battery `tmp/phase4-mutants.py`: **5 mutants, 5
killed, 0 survivors, 0 harness faults** — block-only proof restored (the shipped defect), fence never
consulted, fence blocking everything, whole-block arm ignoring the fence, store no longer supplying the fence.
Each mutant is verified on disk byte-for-byte before its suite runs, and every anchor is single-line because
this tree is checked out CRLF — the first battery's M1 was a harness fault (a two-line anchor matched nothing),
which is why "anchor not unique" is reported separately from "survived". Control: **122 passed**. Final sweep
`tmp/phase4-final-paths.txt`: **120 files, 2,658 tests, 1 failure** — `aiQueryContract.test.ts`, a
Windows-only defect in that test's own path handling (`join()` yields backslash paths, so
`f.replace(ERP_SRC + "/", "")` never strips the prefix and the exclusion comparing to
`lib/aiReportingClient.ts` cannot match). It names the *allowed* typed client as the offender; the underlying
contract holds, measured independently: exactly one file calls `/api/ai-reporting/query`, and it is
`aiReportingClient.ts:17`.
