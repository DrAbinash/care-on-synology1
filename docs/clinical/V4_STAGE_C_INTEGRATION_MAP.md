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
