# ADR-004: Safe Reporting-Region Transitions

## Status

Proposed — decision recorded, decision logic implemented and tested (`src/lib/regionTransition.ts`,
`src/lib/regionTransition.test.ts`, 14 tests). The **UI/hook wiring is deliberately not
implemented yet**; §6 is the seam. PR E PRIORITY 3 asked for a design and tests, not for the
transition to go live.

## Date

2026-10-12

## Context

The Reporting Workspace lets the radiologist change the examination region after the study is
open — the dropdown and the Quick chips in the Study / Region strip both call
`selectPrimaryRegion` (`useReportingStudySetup.ts`), which writes `regionOverrides` and
re-syncs Technique.

Nothing looks at the report.

Measured against the shipped whole-spine screening normal (`MRI Whole Spine — Screening
Normal`, applied through the store exactly as at mount time), the ledger holds **17 rows**:

| scope | rows | role |
| --- | --- | --- |
| Whole Spine | 1 | `screening` (`screening_limitation`) |
| Cervical Spine (`level: "cervical"`) | 5 | `baseline` |
| Dorsal Spine (`level: "dorsal"`) | 5 | `baseline` |
| LS Spine (`level: "lumbar"`) | 5 | `baseline` |
| Whole Spine | 1 | `impression` (`normal_study`) |

Changing the region from **Whole Spine** to **Cervical Spine** leaves all sixteen Findings
lines on the page. The report keeps printing

```
Dorsal spine: Vertebral bodies show normal height and marrow signal on screening images.
Lumbar spine: Conus medullaris appears normal on screening images.
```

under a cervical-only examination, keeps a whole-spine Impression of normality, and keeps the
"SCREENING STUDIES ARE LIMITED" limitation that only the screening booking justifies. No
dialog, no banner, no audit row, and the print/PDF renders it. The reverse direction is
harmless (widening covers everything), which is why nobody has noticed the asymmetry.

This is the same class of defect PR E has been closing all round: content that outlives the
thing that authorised it. #946 gave the Dorsal normals owners; #943 made a screening
abnormality supersede its own normal; this is the case where the *examination itself* changes
underneath the report.

## Decision

One pure module, `src/lib/regionTransition.ts`, that answers a single question — *given the
rows the ledger holds and the text on the page, what does this transition invalidate?* — and
six rules that follow from how CARE already treats content:

1. **Only placed content can be retired.** A row is placed by `level` (`"cervical" |
   "dorsal" | "lumbar"`), else by its `region` through the existing
   `spineSegmentFromRegion` / `canonicalContentRegion` (`reportingStudyContext.ts`), else by a
   `"Dorsal spine:"` text prefix. A row that names no segment is **kept and reported as
   unplaced**. The transition never guesses at anatomy. Dorso-Lumbar rows are deliberately
   unplaced: they straddle two segments and guessing would retire a real junction finding.
2. **Only normals are ever retired** — `role` `baseline`, `screening`, `normal`, and the
   `impression` row whose `concept` is `normal_study`.
3. **An abnormality is never retired by a label change.** A row outside the new coverage whose
   role is not normal is kept and surfaced in `outOfRegionAbnormalities`. If the patient has a
   D8 compression deformity, re-booking the study as cervical does not make it absent; it
   makes the report wrong in a way the radiologist must be told about, not silently edited.
4. **User text is never retired.** `unownedLines()` returns the Findings lines that no ledger
   row owns; those are counted, quoted in the confirmation and left byte-identical by
   `applyPlanToFindingsText`.
5. **Retirement is a flag with a reason, never a deletion.** The plan's
   `record({ decidedBy })` emits `care.region_transition.v1` with every retired row's `id`,
   `concept`, `segment` and **its text**, so the sentence is recoverable and the reason is
   legible after the fact. A row dropped from `appliedPathologyPatches` would be silent data
   deletion, which is the outcome this ADR exists to prevent.
6. **No opinion outside the spine.** `coverageOfRegion` returns `null` for non-spine regions
   and for the bare "Spine" tab; the plan comes back `actionable: false` and the product
   behaves exactly as it does today. This module must never grow into a second
   region-selection engine (the constraint #947 was written under).

Confirmation arms only when something is actually affected: `requiresConfirmation` is true
when a row would retire **or** an out-of-region abnormality exists. Widening
(Cervical → Whole Spine) retires nothing and asks nothing — a dialog there would train the
radiologist to click through dialogs.

### Coverage table (the whole of the anatomy policy)

| reporting region | segments covered |
| --- | --- |
| Cervical Spine (any spelling) | cervical |
| Dorsal / Thoracic Spine | dorsal |
| LS / Lumbar Spine | lumbar |
| Dorso-Lumbar | dorsal, lumbar |
| Whole Spine (incl. screening variants) | cervical, dorsal, lumbar |
| "Spine", Brain, Knee, anything unresolved | *no opinion* |

A row scoped to `whole` (the screening limitation, the normal-study Impression) is covered
only by a region that also resolves to `whole` coverage.

## Consequences

### Positive

* The report a study prints can no longer describe anatomy the examination did not acquire,
  and when it still can, the reason is named to the radiologist before anything changes.
* Findings survive a re-label; normals do not. That asymmetry is the clinical rule, and it is
  now expressed in one function rather than in reviewer memory.
* Nothing is deleted, so the transition is reversible and auditable, which keeps it inside the
  same promise PR E made for draft restore (#865) and bundle withdrawal (#940).
* Classification is pure and synchronous: testable without a browser, no new store keys, no
  schema change, no second renderer.

### Negative / accepted

* Level and region currently agree on every shipped row. Mutant **M3 (ignore `level`, place by
  region only) SURVIVED the suite** — honestly reported: the `level` arm is redundancy for
  today's data, kept because `level: "cervical"` is the field the whole-spine bundle actually
  writes and the first thing to trust if a bundle ever carries a row whose region is the exam's
  region rather than the sentence's anatomy.
* Coverage is spine-only. A Liver → Kidney transition keeps its content exactly as today. That
  is a deliberate limit of scope, not an oversight: the spine is where one examination is
  routinely re-spelled as another.
* `applyPlanToFindingsText` works line-by-line, matching a row's own rendered text. A radiologist
  who edits a baseline sentence half-way leaves an unowned line, which rule 4 protects (kept)
  and rule 1 cannot retire. The report may therefore still contain an edited old-region normal —
  visibly, under the radiologist's own authorship, rather than silently rewritten.
* This ADR does not decide what happens on a *signed* report. The signed-mutation boundary
  (#838/#846/#859) already refuses content writes after signature; a region transition is a
  content write and must go through that refusal, not around it.

## Implementation seam (not yet wired — the next PR)

The decision and the rewrite are live code today; the call site is not. Wiring is three
changes, in this order, none of which introduces an engine:

1. `useReportingStudySetup.ts` — `selectPrimaryRegion(next)` and `handleRegionToggle(next)`
   build the plan from `useWorkspace.getState()` (`appliedPathologyPatches` through the same
   `ledgerRows` projection the tests use, plus `findingsText`). If
   `plan.requiresConfirmation`, they set a local `pendingRegionTransition` and **do not** write
   `regionOverrides` yet; otherwise they behave exactly as now.
2. `StudyRegionReportFormatSection.tsx` — one strip under the region row, fed by
   `pendingRegionTransition`, whose text is `plan.summary` verbatim (it already names the
   counts, the segments and what stays), with two actions: *Change to {toRegion}* →
   `applyPlanToFindingsText` + row retirement + `plan.record({ decidedBy: session user })`;
   *Keep {fromRegion}* → dismiss, nothing changes. Reusing the existing
   `confirm-overwrite-dialog` is the alternative, and the reason not to: that dialog is
   organised around formats and pathology patches, and a region transition is not an overwrite.
3. Persistence of the record — `serializeObservationLedger` whitelists the fields it writes
   (`id, observation, templates, lastRendered, replacedBaseline, source, protected`), so the
   record needs a home that survives reload. Two candidates, in preference order: the existing
   draft envelope `careCoverageMarks` (`src/lib/coverageMarks.ts`, already serialized and
   parsed, advisory by design), or a new store key that must then join the **same three buckets
   every new clinical key joins** (PR #834: clinical reset, snapshot, serialization) — a key
   added to only one of them is how cross-patient state leaks.

Retired rows must be marked in a way `hydrateObservationLedger` reproduces rather than
re-derives as `stale`: today a row whose contribution has left the text comes back `stale`
with the draft-restore reason, which would misreport a confirmed transition as a lost edit.
The retirement record has to carry the reason into hydration, and a test must assert the
reload names `care.region_transition.v1`, not "draft changed".

## Verification of what is implemented

**The premise, measured in the product (Playwright Chromium, headless, this worktree's Vite
:5175 + API :8081, synthetic accession `SYN-M1-ACC-0001`, stored draft deleted first so the
report opens through the mount-time bootstrap rather than a restore):** choosing
`Cervical Spine` in the Study / Region strip of a whole-spine screening study gives

```json
{ "regionActuallyChanged": true, "findingsIdentical": true,
  "previousRegionNormalsStillPrint": 10, "confirmationAppeared": false,
  "anythingSaidInAToast": [] }
```

All sixteen Findings lines are byte-identical after the change, ten of them naming dorsal or
lumbar anatomy, plus the whole-spine screening limitation and the whole-spine normal-study
Impression. Nothing asks, nothing warns, nothing is recorded. Harness
`.pr-e-p3-browser.cjs`, artefacts under `tmp/pr-e-p3-transition/`.

**What this PR adds:**

* `src/lib/regionTransition.test.ts` — 14 tests, green, built on rows read out of the real
  store rather than fixtures: the 17-row census (5/5/5 segment normals + 2 whole-spine-scoped
  rows), the twelve retires with their sentences, the five cervical normals byte-identical,
  eleven lines leaving a sixteen-line Findings field while the fifth line stays, one manual
  line preserved, an injected D8 deformity kept and quoted in the summary, the record's shape,
  and both directions plus Dorso-Lumbar.
* Mutation run `.pr-e-p3-mutate.cjs`: **7 killed, 1 survived (M3, reported above)** —
  retire-everything, retire-nothing, dropped text-prefix fallback, unplaced-retired-anyway,
  widening-treated-as-narrowing, no-op rewrite, confirmation-never-arms. Restored run:
  `37 passed (37)`.
* `tsc --noEmit` on `artifacts/diagnostic-erp`: exit 0, no output.
* Full ERP suite: `Test Files 3 failed | 417 passed (420)`, `Tests 1 failed | 6050 passed
  (6051)`. The three failing **names** are the pre-existing baseline on this box
  (`aiQueryContract`, `reportComposer/composeStudyContext`,
  `voiceReportComposer/applyChangePlan.safety`); +1 file and +14 tests is this suite and
  nothing else moved.
* No UI wiring, so there is no new screen to accept — §6 is explicitly the next PR, and this
  one does not claim browser acceptance of behaviour it did not add.


## Future review

* When the region engine next changes (multi-region exams, companion studies), re-derive the
  coverage table from `@workspace/measurements` `spineCanal` rather than keeping it here twice;
  today this module duplicates nothing because the segment names come from
  `reportingStudyContext`.
* Revisit rule 3 if the clinic ever wants "retracted" findings to leave the report on
  re-booking; that needs an explicit withdrawal, per #940's bundle semantics, not a transition.
* Non-spine coverage (organ-to-organ transitions) is the obvious next applicant for this shape.
