# ADR-004: Safe Reporting-Region Transitions

## Status

Accepted — decision logic and the clinical wiring are both implemented.

* Policy: `src/lib/regionTransition.ts`, `src/lib/regionTransition.test.ts` (17 tests) — this ADR's own PR.
* Wiring: `useReportingStudySetup.ts` (the four region writers gated), `StudyRegionReportFormatSection.tsx`
  (the confirmation strip), `store.ts` (`commitRegionTransition`), `useDraftPersistence.ts` +
  `structuredJsonColumn.ts` (the record's round trip), `regionTransitionCommit.test.ts` (15) and
  `regionTransitionWiring.contract.test.ts` (12).

The premise below is measured in the browser against the un-wired product, and the wired behaviour is
measured against the same fixture in §Verification of what is implemented.

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
4. **User text is never retired, and nothing is offered that the store will refuse.**
   `unownedLines()` returns the Findings lines that no ledger row owns; those are counted and
   quoted in the confirmation, and they stay byte-identical because the only writer is
   `removeObservation`, which refuses a line the radiologist owns. A row already marked
   `protected` is not offered for retirement either: a confirmation that announced twelve
   removals and performed eleven would make the count a lie. Measured on the whole-spine
   screening normal, whose limitation row comes out of the format apply already protected —
   eleven rows are offered, eleven leave, and the caveat line stays.
5. **Retirement is the product's own withdrawal, not a new one.** Each retired row goes through
   `removeObservation` — the same per-observation call a Quick Select deselection makes — so its
   sentence leaves the text, the baseline it had been covering comes back, its measurements
   detach and the Recommendation re-aligns. The whole transition is ONE undo frame
   (`skipUndoSnapshot` on the per-row calls, one `captureClinicalSnapshot` around them), because
   twelve frames would need twelve presses and the stack is depth-capped.
   The original rule for this ADR said "a flag, never a removal", and the implemented design
   does not honour those words: the ledger's `stale` flag is not persisted
   (`serializeObservationLedger` whitelists `id, observation, templates, lastRendered,
   replacedBaseline, source, protected` — `observationLedger.ts:313`), so a flagged row would
   return as a live normal on the next reload and print the very sentence the transition
   removed. What carries the audit instead is the record: `record({ decidedBy })` emits
   `care.region_transition.v1` with every retired row's `id`, `concept`, `segment` and **its
   text**, narrowed to the rows whose sentence really left, persisted with the draft. Nothing
   is removed that is not quoted first, and nothing is quoted that was not removed.
6. **No opinion outside the spine.** `coverageOfRegion` returns `null` for non-spine regions
   and for the bare "Spine" tab; the plan comes back `actionable: false` and the product
   behaves exactly as it does today. This module must never grow into a second
   region-selection engine (the constraint #947 was written under).

7. **Coverage belongs to the selection, not to its first entry.** The Study / Region chips are
   multi-select, and clicking a chip that is already selected makes it primary rather than
   removing it (`nextStudyRegions`, `studyRegion.ts:266`). `coverageUnionOfRegions` unions the
   whole list on each side, so re-ordering Cervical + LS Spine asks nothing — the click changes
   no coverage — while taking the LS Spine chip off retires the lumbar normals. Reading only
   `studyRegions[0]` would have made the first case a dialog about nothing and the second a
   silent deletion.

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
| a multi-region selection | the union of its regions |

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
* A radiologist-edited baseline sentence is not retired. The withdrawal path compares the row's
  own rendered text with the text on the page, and a line that no longer matches is `protected` —
  the store refuses to delete it and the hook never offers it. The report may therefore still
  contain an edited old-region normal, visibly, under the radiologist's own authorship, rather
  than silently rewritten. The strip's count is the number that actually leaves, so the sentence
  the radiologist reads in the confirmation is the sentence that goes.
* This ADR does not decide what happens on a *signed* report. The signed-mutation boundary
  (#838/#846/#859) already refuses content writes after signature; a region transition is a
  content write and must go through that refusal, not around it.
* The whole-spine normal-study conclusion leaves with the normals it summarised, and the
  transition writes no replacement of its own. In the store, with nothing underneath, the
  Impression comes back empty (`regionTransitionCommit.test.ts`). An empty conclusion is a
  visible gap that gets filled; a conclusion about segments the examination no longer covers
  is a wrong statement that prints.
  **What the browser shows is a filled field, and it is worth being exact about why.** Measured on
  `SYN-M1-ACC-0001`: the retired row's own `replacedBaseline` is `{findings: [], impression: []}`,
  so the withdrawal restores nothing. What the Impression ends up saying is
  `Normal MRI Cervical Spine. No cord compression or significant spondylosis.` — byte-identical to
  the shipped Cervical Spine preset's `defaultImpression` (`structuredReportTemplates.ts:259`). The
  writer is the pre-existing auto-template path, not this PR: that effect re-runs when
  `matchedStudyRegion` changes (`useReportingStudySetup.ts:493`) and applies **fill-empty only**
  (`:541`, `setImpressionIfEmpty`), so a conclusion this transition vacated is refilled from the
  new region's own template. The intermediate empty field was not itself observed — the two writes
  land in one commit — so what is proven is the end state and the code path that produces it, not a
  sequence. Two consequences a reviewer should see rather than be surprised by: the conclusion left
  behind is whatever the new region's template says, which this module neither guarantees nor
  inspects; and if the retirement had NOT vacated the field, that same effect could not have written
  it. A transition onto a region with no matching template leaves the Impression empty.
* Only the report text follows the region. After the confirmed transition the printed header
  still carried the billed test name (`MRI WHOLE SPINE`) and the Technique still described the
  whole-spine screening acquisition, because a transition retires ledger rows and touches neither
  the bill nor the acquisition record. The persisted `care.region_transition.v1` row is what makes
  that residue legible to a reviewer: it names the region the radiologist chose, the one they left,
  who decided and when. Fixing the header/Technique side is #189 and the per-book bill naming, not
  this ADR.
* The screening protocol's acquisition caveat stays in the report, because its row is
  `protected` from withdrawal and the hook does not offer what the store will refuse. It
  under-states the examination rather than over-claiming anatomy — the safe direction, but
  the radiologist reading a cervical report should notice a screening caveat in it, which is
  a review point this ADR does not settle.

## Implementation (wired by the follow-up PR)

The three seams above are the product now, and none of them is an engine.

1. `useReportingStudySetup.ts` — the four user-facing writers of `regionOverrides`
   (`selectPrimaryRegion` for a chosen region, its placeholder branch that clears the
   selection, `handleRegionToggle` for the chips, `resetRegionOverrides` for the "reset to
   auto" link) each build a plan from the LIVE ledger — `appliedPathologyPatches` minus
   `stale` and `protected`, plus `findingsText` — and when `plan.requiresConfirmation` store
   it in `pendingRegionTransition` and return, writing neither the region nor the report.
   `regionTransitionWiring.contract.test.ts` pins the census of `setRegionOverrides(` (7
   sites: the four gated, the confirm's own write, and two documented exemptions — the
   study-change effect, whose content is reset in the same effect, and the protocol seed,
   which only runs while no region is resolved at all) and that each gate precedes its write.
2. `StudyRegionReportFormatSection.tsx` — one strip under the region row shows `plan.summary`
   verbatim, then the sentences that leave (six, then "+N more"), the findings that stay
   because they name an abnormality, the lines that belong to no ledger row, and the rows this
   module could not place on a segment. *Cancel — report unchanged* dismisses and writes
   nothing; *Change region and remove N* writes the region, then commits the plan through
   `useWorkspace.commitRegionTransition`. The strip inherits the section's `disabled`, so a
   signed report cannot arm it, and the store refuses again at the write (#838) — a confirmed
   dialog is not a licence to edit a signed report. The existing `confirm-overwrite-dialog`
   was not reused: it is organised around formats and pathology patches, and a region
   transition is not an overwrite.
3. Persistence — `regionTransitions` is a store key that joins `CLINICAL_RESET_FIELDS` and the
   clinical undo snapshot, and travels in the draft envelope as `careRegionTransitions` under
   the save-draft request field `regionTransitions`. `structured_json` is an allow-list:
   `composeStructuredJsonColumn` rebuilds the envelope from the keys it knows, so a key that
   is missing from it is dropped by the next unrelated write rather than preserved. That is
   the Technique defect (B-01) one column over, which is why the server's arms, the client's
   reader and the round-trip are all under test.

Two consequences of choosing the withdrawal path over a flag:

* `applyPlanToFindingsText` was deleted with the wiring. It rewrote the Findings text
  line-by-line beside the ledger's own withdrawal path — a second, smaller version of a job
  the product does once, and one that could not honour the manual-text refusal.
* Nothing has to be re-derived as `stale` on hydrate, because a retired row is gone from the
  ledger rather than flagged: the reload reads `care.region_transition.v1` and finds the
  sentences it is missing accounted for, instead of presenting them as a lost draft.
  Undo restores the ledger and forgets the record in one press.

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

## Verification of the wiring

Same environment, same fixture, same "delete the stored draft first" rule, run twice
(`.pr-e-p3-browser2.cjs`, artefacts under `tmp/pr-e-p3-wiring/` and `tmp-pr-e-p3-run1/`). Both
runs produced the identical verdict, and the api-server half was live: `artifacts/api-server`
was rebuilt (`node ./build.mjs`) and the isolated :8081 process restarted, because the record
cannot reach `structured_json` through a bundle that predates the change.

| Step | Measured |
| --- | --- |
| Whole Spine → Cervical, click | `region-transition-strip` present and **visible**; heading `Region change: Whole Spine → Cervical Spine`; summary `11 normals from dorsal and lumbar and whole are not covered by Cervical Spine; your own 1 line stays.`; 6 sentences quoted + `+5 more`; `Change region and remove 11` / `Cancel — report unchanged` |
| While the strip is open | Findings byte-identical, region select still reads `Whole Spine` — the gate returns before either write |
| Cancel | strip gone; Findings **and** Impression byte-identical; region unchanged |
| Confirm | 6 of 6 announced sentences absent; exactly 10 Findings lines removed, 0 added; 1213 → 456 chars; region `Cervical Spine` |
| Cervical → Whole Spine | no strip, region applied immediately, Findings unchanged — widening asks nothing |
| Save | `POST /api/radiology/report-generator/save-draft` 200; `structured_json #> '{careRegionTransitions}'` is an array of 1 with `fromRegion: Whole Spine`, `toRegion: Cervical Spine`, `decidedBy: Dr Abinash Kumar`, `manualLinesPreserved: 1`, and all **eleven** retired rows with their text (10 segment normals + `system-normal-study`) |
| Reload | Findings and Impression byte-identical to the saved state (456 chars); no strip; `region-match-source` reads `billed` again — the override is a session choice, the *record* is what persists |
| Print | popup renders; the five cervical normals and the screening caveat remain; `retiredStillPrinted: []` — no dorsal or lumbar normal survives into the printed report |

`decidedBy: "Dr Abinash Kumar"` is read from the staff session
(`regionTransitionActor()` → `readStaffSession()`), not typed by the user, and the actor test pins
name → email → empty string.

What the suite could not see on its own, found only here:

* The strip lives inside the `region` report-section, whose body is `display: none` unless that
  accordion is the active one. The first acceptance pass read `stripPresent: true` and then timed
  out clicking a button that was in the DOM but not on the screen — a green-looking harness
  measuring an invisible control. It is a sound place for the strip, because every control that
  arms it (dropdown, Quick chip, reset-to-auto) is inside the same section: the radiologist cannot
  arm a confirmation they cannot see. But it is only sound for that reason, and no test says so.
* Eleven rows are offered and eleven leave, because the screening-limitation row arrives from the
  format apply already `protected` — confirmed live in the saved ledger, not just in the store test.

Limits of this acceptance: it is one fixture, one narrowing direction confirmed and one widening
click, on the isolated scratch DB with synthetic data. `artifacts/api-server` cannot be typechecked
in this worktree (its `node_modules` resolves `@types` through the symlinked main repo, which
carries no `@types/node`), so the server half is verified by its own suites and by CI. The printed
header still says `MRI WHOLE SPINE` and carries no accession — the accession column in the print
header arrived in #945, which merged to `main` after this branch's base, so it is an artifact of
the stacked base, not of this change.


## The session-only override, and what it gates (PR E PRIORITY 1)

The row above — "`region-match-source` reads `billed` again" — was written as an accepted
limitation. It is not inert: `generateProfessionalReport` resolves the examination from the
context it is handed and merges that format's sentences into whatever is on the page, so on a
reloaded report it regenerates the **booked** examination over the narrowed one. Measured through
the real store and the shipped format library before this change: whole-spine screening generates
16 Findings lines, the confirmed transition retires 11 and leaves 6 with no dorsal or lumbar text,
save → reload preserves those 6, and one press of Generate against the reloaded region writes
**10 lines back — every one of them a dorsal or lumbar normal the radiologist had just retired**.
The mount-time auto-bootstrap cannot do this — its `if (existingDraft) return;` guard refuses any
study with a saved draft; the press can, which is why the one-click action needed a gate.

`regionIdentityConflictsWithTransition` / `regionIdentityConflictMessage` in
`src/lib/regionTransition.ts` decide it from two things only: the provenance of the region being
used, and the last recorded transition. The recorded decision outranks a region CARE read by
itself — `billed`, `dicom`, `auto` — and an explicit radiologist choice (`override`) always
clears it, so widening the study back is never blocked. Nothing here reads report prose: inferring
a region from sentences is the guessing this ADR exists to prevent. Both writers check it before
any write — `handleStartReport` before its setup half (setup merges Technique, so a refusal after
it would still have left an acquisition paragraph for the wrong examination), and
`generateProfessionalReport` before it resolves a format, which also covers any future caller.

Reopened in a browser afterwards, the same press says:

> Nothing generated. This report was moved to Cervical Spine and that decision is recorded, but
> the examination is being read as Whole Spine. Choose Cervical Spine in the Region control, then
> generate again.

and leaves Findings, Impression, Technique, the ledger and the transition record unchanged.


## The printed page says which region it documents (PRIORITY 1)

A whole-spine study narrowed to the cervical spine now prints `MRI WHOLE SPINE` as its
heading — correct, because that is what was ordered, billed and booked — and one line
under it saying what the report actually documents:

> Documented reporting region: Cervical Spine (recorded by Dr Abinash Kumar on 13 Oct 2026).
> Booked examination: MRI WHOLE SPINE.

Four different things can be meant by "the region", and conflating them is what produced
the contradiction. They are now stated separately, and only the ones the product can
prove are printed:

| meaning | where it lives | what the page says |
| --- | --- | --- |
| original booked examination | `radiology_worklist.study_description` / catalog test name → `studyTitle` | the title bar, unchanged and never renamed |
| radiologist-selected reporting region | `structured_json.careRegionTransitions[n-1].toRegion`, with `decidedBy` + `at` | the line under the title bar |
| anatomical coverage documented | the same record (it lists what it retired and what stayed) | the same line, worded about the report |
| anatomy actually imaged | nothing the ERP can prove — no series-level coverage evidence exists | deliberately not asserted |

The note is derived from the recorded transition and the heading it sits under, and from
nothing else: no findings, technique or impression text is read, so a report can never be
re-scoped by prose. It is emitted only when the recorded region and the booked name acquire
different spine segments, and never outside the spine, so a report nobody has re-regioned
renders byte-identically.

`documentedReportingScope()` and `reportedScopeNote()` live in
`lib/report-quality/src/reportingScope.ts`, and the spine-region vocabulary they need
(`canonicalContentRegion`, `spineSegmentFromRegion`, `familyFromRegion`,
`isDorsoLumbarRegionName`, `coverageOfRegion`, `coverageUnionOfRegions`) moved beside them
into `lib/report-quality/src/reportingRegion.ts`. That is not a relocation for tidiness: the
report document is rendered by the **API server** while the workspace PDF is rendered by the
**browser**, and both must answer "is this the same region?" identically — two copies of the
vocabulary is how one study comes to print one region on the paper and another in the PDF.
`reportingStudyContext.ts` and `regionTransition.ts` re-export the moved names, so none of
the 92 files that import from them changed, and the functions are literally the same objects.

Not in scope here, on purpose: the **signed** artifact. `patient_reports.title` is frozen at
signing and the durable radiology report re-renders from a content-hashed structured document
(`verifyContentSha256`), so putting this line on a signed report is a compatibility decision
for the durable reporting-context work, not a presentational change to slip into a print PR.

## What a report may document also caps which template opens (PRIORITY 2)

The printed line says what a report documents. The same decision has to reach the two
actions that WRITE the report: which Complete Normal Format the workspace opens a study
with, and which `structured_report_templates` row it applies by itself.

A whole-spine screening study narrowed to Cervical Spine still opened with the shipped
Templates row **"MRI Cervical Spine with Whole Spine Screening"**, whose findings contain
"Whole spine screening sagittals of the **dorsal and lumbosacral** spine show normal
alignment, marrow signal and cord signal." The transition record had just retired those
segments, line by line, and the row put them back on the page without anyone deciding
they should be there. Two root causes, found by measuring the real workspace rather than
by reading one path:

* `resolveNormalBootstrapFormat()` decides the screening preference from the examination's
  booked name (folded into the context by `billedStudyContextForNormal`, correctly, so a
  contrast booking does not open a plain technique), and nothing asked whether the format
  it was about to choose documents more anatomy than the report still describes.
* `pickStructuredTemplateForRegion()` matched rows by `body_part`, found none for
  SPINE_WHOLE, and fell through to a search of row *names* that returned the first MRI row
  saying "whole spine" — a Cervical or an LS row. One door was capped; the other was
  wider than the ceiling and still reaching across segments.

Five examinations have to stay apart, and each now resolves on its own evidence:

| the study | what decides it | what opens |
| --- | --- | --- |
| dedicated segment ("MRI Cervical Spine") | region only | that segment's own normal |
| segment with documented screening, nobody re-regioned | booked name declares screening, no record to retire it | the screening row, limitation sentence intact |
| whole spine | region acquires all three segments | the whole-spine screening normal |
| limited-sequence screening of one segment | tag says `screening`, not `whole spine` | that segment's screening normal — documents one segment only |
| narrowed by a **recorded** move | last readable record ∩ current regions | nothing that documents a retired segment |

The ceiling is computed once, in `documentedCoverageCeiling()`, from two declared facts and
no prose, and both doors ask it the same question:

* **what a format documents** — `formatDocumentedCoverage()` over its body part plus the
  screening scope its own catalog row declares (`study_type` on a Templates row, the
  `whole spine` tag on a built-in baseline). A format tagged `screening` for one region
  still documents one region; only a declared *whole-spine* scope widens it.
* **what the report may still say** — for an automatic reading of the study, the
  INTERSECTION of the recorded move and the regions the study resolves to now. Not a
  union: a reloaded report is read as the booked examination, because the region override
  is React state and only the record survives the draft, so unioning "Whole Spine" with
  the recorded "Cervical Spine" gives a whole-spine ceiling that excludes nothing. That
  was this rule's first version, and the browser showed what it cost — eleven retired
  screening sentences on the page on study open, before anyone pressed anything.
* An **explicit** region choice caps the report at exactly what was chosen, and the record
  is not consulted. Choosing "Whole Spine" is how a study is widened back out — widening
  retires nothing, so it writes no record, and an older narrower one must not trap the
  examination the radiologist has just re-declared. Choosing "Cervical Spine" is a
  declaration of the cervical spine, not of the examination the booking names. The first
  version answered "no opinion" for every explicit choice and the measured consequence was
  the second page of this section: after narrowing the report by hand, Generate applied the
  booked whole-spine screening document over the top of the choice.

If nothing within the ceiling exists, the study gets **no** auto-applied normal or template
and the message says why. Guessing here means a report that documents a spine segment the
study's own decision retired.

Two things this deliberately does not do. It edits **no template**: every shipped screening
row keeps its sentences and its mandatory
`SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.` discipline for the studies it was
authored for, which is also why the wording is pinned by `spinePresetFindingsDocument.test.ts`
rather than changed here, and a row the radiologist selects from the Templates list is their
decision and is never filtered. And it does not quietly re-scope a study whose examination
*declares* screening of segments the region tab does not name — today that declaration
exists only as the booked name, and a structured coverage column is the durable
reporting-context work's to propose with a migration, not a change to slip into a
template-selection PR.

## Future review

* When the region engine next changes (multi-region exams, companion studies), extend the
  shared vocabulary in `lib/report-quality/src/reportingRegion.ts` — it is now the only
  copy, used by the workspace, the print route and the PDF. `@workspace/measurements`
  `spineCanal` still owns the measurement tables, which are a different question.
* Revisit rule 3 if the clinic ever wants "retracted" findings to leave the report on
  re-booking; that needs an explicit withdrawal, per #940's bundle semantics, not a transition.
* Non-spine coverage (organ-to-organ transitions) is the obvious next applicant for this shape.
