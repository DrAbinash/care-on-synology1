# CARE ERP — Radiology Reporting Workspace Remediation: Delivery Report

**Date:** 2026-10-03
**Branch:** `fix/reporting-workspace-end-to-end-integrity`
**HEAD:** `8435d2b4aa8f0909f0c080e29ad2e28cd94f2347`
**Base:** `origin/main` = `bc8ca8c5d5d1644804467dcb08eafad23af28a0c`
**Ahead / behind:** 8 ahead, 0 behind
**Pushed:** **No.** This branch exists only in the local working copy. CI has therefore never
run on it (see Part 9 and Appendix C).
**Spec:** the 39-section task *"AUDIT REMEDIATION, END-TO-END WIRING HARDENING, AI SAFETY &
SELF-RE-AUDIT"*. This document is its §37 delivery; parts 1–18 below are the 18 parts §37
requires, in order.
**Companion:** `docs/audits/radiology-reporting-workspace-deep-audit-2026-10-03.md` (the audit
this work remediates, 3,700+ lines) and
`docs/audits/radiology-reporting-workspace-deep-audit-2026-09-30.md` (the prior register,
tracked in git).

> **Read this before anything else.** Nothing here is deployed. Nothing here is merged. No
> schema was changed, so no `migrations/*.sql` file was needed and none was added. The single
> largest caveat on the whole delivery is in Part 9: **the database-backed tests have never
> executed anywhere**, on this branch or on this machine.

---

## Part 1 — Executive Summary

Eight commits, 40 files, **+3,961 / −140**. Six are fixes, one is a documentation correction,
one is a test group.

**What was actually broken, and is now fixed, on a path a radiologist uses:**

1. **A signed report did not contain the Clinical History or the Technique the radiologist had
   approved.** The finalize payload never carried them, so the stored signed artifact — the
   medico-legal document — was missing two of its own sections while the screen showed them.
   Fixed in `6e921f04`; print and Word export now read the same signed body.
2. **The wrong-patient quality rules could not fire.** `sex` and `age` never reached the
   evaluation endpoint, so Q109 (male+uterus / female+prostate) and its siblings were dead on
   the reporting path. Fixed in `21021ff6`; the server now resolves demography itself and does
   not trust the client to send it.
3. **Ctrl+I's AI draft was not checked the way the composer's output is.** The fast path had no
   grounding verdict at all. Fixed in `1be8252b` by *calling the composer's existing validator*,
   not by writing a second one — and by declaring in the response the three checks that path
   structurally cannot perform.
4. **Editing Findings did not stale the Impression derived from it**, and orphaned
   recommendation advice was invisible at signing. Fixed in `df7e024b`.
5. **One study's clinical state could survive into the next patient.** Three separate reset
   paths each cleared a different subset of fields, and the undo stack was not scoped to the
   study at all. Fixed in `cd572ea1` by extracting one canonical reset and one study-keyed
   refusal.
6. **Ctrl+I awaited the model with no study check** — a delayed answer for Study A landed on
   Study B. Fixed in `9c010fe7` (RW-31).
7. **The next-study preload stored an invented AI draft** against a study nobody had opened,
   retrievable later as an ordinary draft. Fixed in `1be8252b` via `warmUpOnly` (RW-23).
   **The image egress half of this is not fixed** — see Part 14, risk R-2.
8. **The pending-AI finalize gate was sixteen untested lines** inline in a hook no test in this
   repo can reach. Extracted to a testable module and tested ten ways in `9c010fe7` (RW-32).

**What was measured and found already correct, and left alone.** The MRI sub-masters, the
observation ledger, the provenance model and `materializeAcceptedText` were verified rather than
rewritten. §25's constraint held: no sub-master file was touched except two test files.

**What was not fixed.** 74 of the 98 register findings remain open, including **all three P0s**.
None of the three is reachable from a client-isolation group: RR-01 (signed report in-place
mutable), RR-02 (critical flag clearable on a verified report) and RR-03 (signer identity
caller-supplied on a key-authenticated route) are server-side schema and authorization work.
They are recorded, with their evidence, in Part 10 and Part 14.

**Verification status.** 8,581 tests execute on this box at head against 8,436 at base:
**+145 tests, +6 test files, all added by this branch. Zero regressions** — the failing-file set
diff is 1 new failure (the DB-gated new file, failing at import exactly like the 82 pre-existing
DB-gated files) and 0 files newly passing. Typecheck clean, grounding-check clean (105 claims),
both production builds exit 0. **But 83 test files, including this branch's own demography
request suite, have never run against a database.**

**The one naming problem in this delivery, stated up front.** The spec's §26 Group F is
*"downstream rendering (print, PDF, share, PACS)"*. This branch used the label "Group F" for the
failure-mode and journey test group (§23/§24 material). The spec's actual Group F work was done —
but inside Groups A and E, in `storedReportBody.ts`, `radiologyReportPrintLiveMerge.ts` and
`radiologyReportWordExport.ts`. See Appendix D.

---

## Part 2 — Git Evidence

### Before any modification (§36 requirement)

| | value |
|---|---|
| Branch at start | created new from `origin/main` |
| `origin/main` at start | `bc8ca8c5d5d1644804467dcb08eafad23af28a0c` |
| `origin/main` now | `bc8ca8c5d5d1644804467dcb08eafad23af28a0c` — **unchanged** |
| Working tree now | clean except one untracked file: the audit document |

`git status --short` at delivery:

```
?? docs/audits/radiology-reporting-workspace-deep-audit-2026-10-03.md
```

The audit document is **untracked and unstaged**. It is one `git clean -fd` from being lost. It is
not committed into this branch deliberately: committing a 3,700-line read-only audit into a code
branch would put an unrelated change inside the PR, which the standing rule forbids. It needs its
own PR or an explicit owner decision — see Part 15, decision D-1.

### Commits (§36: logically grouped)

```
8435d2b4 docs(radiology): drop a line count from the finalize gate's header comment
9c010fe7 test(radiology): a delayed AI answer cannot land on the next patient, and an unreviewed one cannot be signed
cd572ea1 fix(radiology): one study's clinical state cannot survive into the next patient
df7e024b fix(radiology): every Findings edit stales the Impression, and orphaned advice is named at signing
1be8252b fix(radiology): the AI draft a radiologist asks for is checked like the one the composer writes
d3498ba1 docs(radiology): stop describing an advisory quality gate as a hard block
21021ff6 fix(radiology): the wrong-patient quality rules can now actually fire
6e921f04 fix(radiology): the signed report is the report the radiologist approved
```

Each carries the group it belongs to in its body. `d3498ba1` is a comment-only correction to
claims the code never made — a false docstring is a defect in the same class as a false audit
column, and it was fixed rather than left because Group B was already in that file.

### Merge / push status

Not merged. Not pushed. No force-push. No deploy. `deploy-synology.sh` hard-resets the NAS to
`origin/main`, so **none of this is live at the clinic** and none of the earlier PRs #799–#814
are either.

---

## Part 3 — Files Changed

40 files, +3,961 / −140. Grouped by the §26 group that owns them.

### Group A — signed artifact integrity (`6e921f04`)

| File | Δ | Role |
|---|---|---|
| `artifacts/diagnostic-erp/src/lib/storedReportBody.ts` | **new**, +187 | the canonical builder for the stored signed body; one function, one shape |
| `artifacts/diagnostic-erp/src/lib/storedReportBody.test.ts` | **new**, +231 | 17 cases |
| `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts` | +144 (shared with D/E) | sends History + Technique in the finalize payload |
| `artifacts/diagnostic-erp/src/lib/radiologyReportPrintLiveMerge.ts` | +48 | print reads the signed body, not a live overlay |
| `artifacts/diagnostic-erp/src/lib/radiologyReportWordExport.ts` | +28 | Word export reads the same builder |
| `artifacts/api-server/src/routes/patient-reports.ts` | +9 | accepts and stores the two sections |
| `artifacts/api-server/src/routes/patient-reports.d8.test.ts` | +77 | 4 new cases on the stored shape |

### Group B — demography and quality wiring (`21021ff6`, `d3498ba1`)

| File | Δ | Role |
|---|---|---|
| `artifacts/api-server/src/routes/reportQuality.ts` | +74 | `resolveDraftDemography` — server resolves `sex`/`age`, does not trust the client |
| `artifacts/api-server/src/routes/reportQuality.demography.request.test.ts` | **new**, +324 | 8 request-level cases; **cannot collect without `DATABASE_URL`** |
| `lib/report-quality/src/text/evaluate.demography.test.ts` | **new**, +161 | 13 engine-level cases proving Q109 emits |
| `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx` | +80 (shared) | `buildWorkspaceQualityRequest` sends `sex`/`age` |
| `artifacts/diagnostic-erp/src/lib/reportQualityFinalize.ts` | +40 | finalize-path evaluation carries demography |
| `artifacts/diagnostic-erp/src/lib/reportQualityFinalize.test.ts` | +44 | 4 new cases |

### Group C — AI draft hardening (`1be8252b`)

| File | Δ | Role |
|---|---|---|
| `artifacts/api-server/src/routes/aiReporting.ts` | +190 | `validateDraftGrounding`, `DRAFT_VALIDATION_GAPS`, `warmUpOnly` guard |
| `artifacts/api-server/src/routes/aiReporting.query.test.ts` | +239 | 15 new cases |
| `artifacts/api-server/src/lib/ai/draftPromptSafety.ts` | **new**, +22 | prompt-side bounds for the interactive path |
| `artifacts/diagnostic-erp/src/lib/aiDraftValidation.ts` | **new**, +79 | client-side rendering of the verdict |
| `artifacts/diagnostic-erp/src/lib/aiDraftValidation.test.ts` | **new**, +149 | 13 cases |
| `lib/api-zod/src/radiologyAi.ts` | +82 | `warmUpOnly` and the validation verdict on the shared contract |
| `artifacts/api-server/src/lib/ai/aiPipelineSelfTest.ts` | +6 | records the measured constant, not a claimed one |

### Group D — Findings → Impression → Recommendation (`df7e024b`)

| File | Δ | Role |
|---|---|---|
| `artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts` | +81 | `mergeField` arms `impressionNeedsRefresh`; reset scoped to study |
| `artifacts/diagnostic-erp/src/lib/observationLedger.ts` | +56 | orphaned-advice detection |
| `artifacts/diagnostic-erp/src/lib/observationPersistence.hardening.test.ts` | +265 | 23 new cases |
| `artifacts/diagnostic-erp/src/lib/reportFieldMerge.test.ts` | +58 | 6 new cases (measurement precision, RW-34) |
| `artifacts/diagnostic-erp/src/components/radiology/FollowUpPanel.tsx` | +44 | names orphaned advice |
| `artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts` | +15 | splits the impression at finalize |

### Group E — finalization, identity, signed state (`cd572ea1`)

| File | Δ | Role |
|---|---|---|
| `artifacts/diagnostic-erp/src/lib/zai-workspace/clinicalStateReset.ts` | **new**, +181 | one canonical reset replacing three hand-maintained field lists |
| `artifacts/diagnostic-erp/src/lib/clinicalStateReset.hardening.test.ts` | **new**, +510 | 23 cases |
| `artifacts/diagnostic-erp/src/lib/radiologyWorkspaceSafety.ts` | +19 | `shouldApplyAsyncStudyKey` |
| `artifacts/diagnostic-erp/src/lib/radiologyWorkspaceSafety.test.ts` | +36 | 5 new cases |
| `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts` | +29 | draft hydration gated on patient identity |
| `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceCommands.ts` | +25 | undo refusal across a study switch |
| `artifacts/diagnostic-erp/src/components/radiology/zai-workspace/finalize-dialog.tsx` | +24 | surfaces the authoritative status |
| `artifacts/diagnostic-erp/src/components/radiology/FinalizeSignDialog.tsx` | +1 | — |
| `artifacts/diagnostic-erp/src/hooks/useFinalizeFlow.ts` | +1 | — |

### The test group this branch mislabelled "Group F" (`9c010fe7`)

| File | Δ | Role |
|---|---|---|
| `artifacts/diagnostic-erp/src/lib/aiFinalizeGate.ts` | **new**, +41 | `decideAiFinalizeGate` extracted from the hook |
| `artifacts/diagnostic-erp/src/lib/reportingWorkspaceJourneys.hardening.test.ts` | **new**, +395 | 22 journey cases |
| `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useTriggerAiImpression.ts` | +64 | the study-identity refusal |
| `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts` | (in A's +144) | calls `decideAiFinalizeGate` |
| `artifacts/diagnostic-erp/src/lib/mriDorsoLumbarCanvas.test.ts` | +40 | §25 guard: sub-master behaviour pinned |
| `artifacts/diagnostic-erp/src/lib/compositionSafety.walkthrough.test.ts` | +2 | — |

**Two files appear in more than one group** (`useStudyFinalize.ts`, `useWorkspaceClinicalUi.tsx`).
That is the honest shape of the work: the finalize hook is where Groups A, D and E all land, and
splitting it across commits would have produced commits that do not individually typecheck.

---

## Part 4 — Clinical Workflow Before → After

What the radiologist experiences, not what the code does.

| Step | Before | After |
|---|---|---|
| Open a study from the worklist | Demography loaded; `sex`/`age` visible on screen but **never sent** to the quality engine | Same on screen; the server now resolves `sex`/`age` itself from the draft/patient row, so the wrong-patient rules can fire |
| Type Clinical History and Technique | Visible, saved to the draft, **absent from the signed document** | Visible, saved, and present in the stored signed body, print and Word export |
| Type Findings, then an Impression | Editing Findings afterwards left the Impression marked current | Any Findings edit — typed, merged, template-applied, AI-accepted — arms `impressionNeedsRefresh` |
| Press Ctrl+I for an AI impression | Unvalidated model prose appeared as ghost text, indistinguishable from grounded prose | The composer's own validator runs; an ungrounded draft arrives labelled *"failed a grounding check"* with a destructive toast, and the response names the three checks that path cannot do |
| Move to the next study while Ctrl+I is in flight | The answer landed on the new patient's screen | Refused: *"You moved to another study while the model was working. Nothing was changed."* |
| Reach 80% and trigger the preload | An invented draft was **stored** against the next study, later retrievable as an ordinary AI draft | No draft stored; `draftId: null`. **Images are still sent** — Part 14, R-2 |
| Sign a report with an unreviewed AI proposal outstanding | A sixteen-line untested inline `if` was the only thing stopping it | `decideAiFinalizeGate`, extracted and tested ten ways: *"AI suggestions remain unreviewed"* |
| Sign the last study in the queue | Four clinical fields cleared; the rest of Patient A's state survived into the empty workspace | One canonical reset clears all 65; the undo stack is study-keyed and refuses across a switch |
| Re-open a signed study | Session-only lock; a re-opened signed study was editable and re-printable as final | The three lock decisions read one authoritative status. **RR-20's server half is still open** — Part 10 |
| Print a signed report | A live-body overlay on a signed shell — later edits could substitute into the printout | Print reads the signed body |

---

## Part 5 — Signed Artifact Integrity

Spec §3, §10, §11, §12; invariants 6, 7, 9, 10.

### The defect

At base the finalize payload carried Findings, Impression and Recommendation. Clinical History and
Technique existed in the workspace store, were persisted to the draft, were rendered on screen —
and were **not in the request that creates the signed document**. `storedReportBody` did not exist;
each output surface assembled its own body.

The print path made it worse: `radiologyReportPrintLiveMerge.ts` merged the *live* body over the
signed shell, so a printout taken after signing could show text the signature never covered. That
is RW-01 and RR-19 at once, and it is the exact failure §38 invariant 10 names.

### The fix

One builder, `storedReportBody.ts` (+187), produces the signed body from the payload. Three
consumers read it: the finalize request, `radiologyReportPrintLiveMerge.ts`, and
`radiologyReportWordExport.ts`. `patient-reports.ts` (+9) accepts and stores the two sections.

**Why one builder and not three patches:** §2 forbids a second source of truth. Before this change
there were effectively three (payload, print, Word) and they disagreed. Now there is one, and the
17 cases in `storedReportBody.test.ts` pin its shape.

### Evidence, per §39

| Claim | Evidence | Verified how |
|---|---|---|
| The signed body contains History and Technique | `storedReportBody.test.ts`, 17 cases, **pass on this box** | executed |
| The stored row carries them | `patient-reports.d8.test.ts`, 4 new cases, **28 pass** | executed |
| Print reads the signed body | `radiologyReportPrintLiveMerge.ts` +48; the merge function takes the signed body as its input | read |
| **A real signed PDF shows them** | — | **CANNOT VERIFY.** No `pdftotext` binary on this box (a known pre-existing failure), and no database to sign against. Runtime evidence required: sign one study, download the PDF, confirm both section headings and their text. |

Invariant 9 (*the signed stored artifact represents what was intended*) is **GREEN at the payload
and database layer, UNKNOWN at the rendered-output layer**.

---

## Part 6 — AI Reporting Changes

Spec §13–§17; invariants 1, 2, 3, 4, 12, 13.

### What changed

1. **`/draft` is now validated by the composer's own validator.** `validateDraftGrounding`
   (`aiReporting.ts:1326-1336`) calls `validateComposerOutput` — the same function that gates the
   background composer's READY state. This is a call, not a second validator, which is what §2
   requires.
2. **The verdict is advisory, and says so.** `blocking: false` (`:893`). Nothing withholds the
   draft; it labels it. The label is `"AI Draft – Ungrounded content flagged – verify before
   accepting"` (`:1455-1457`).
3. **The three structural gaps are declared in the response**, not left implied
   (`DRAFT_VALIDATION_GAPS`, `:843-847`): no frozen key-image registry so the snapshot stays
   `TEXT_ONLY`; no structured observations so definite-laterality and severity correlation stay
   advisory; no Technique sent. A validator that quietly cannot see part of the report is worse
   than no validator, because the green label becomes a claim nobody tested.
4. **`warmUpOnly`** (`radiologyAi.ts:92`, guard at `aiReporting.ts:1363`) stops the preload
   storing a draft.
5. **The study-identity refusal** (`useTriggerAiImpression.ts:56-80`) captures the study key
   *before* the await and compares on both `activeStudyId` and `activeStudyInstanceUID` when the
   response lands.

### What did not change, and why that matters more

**Invariant 1 — manual text cannot be silently overwritten by AI — is carried by
`materializeAcceptedText`, not by anything this branch wrote.** That function
(`reportComposer/types.ts:345/355`) skips anything not `ACCEPTED`/`EDITED`. It was already correct
at base and `preDeploySafety.test.ts:56` already proved it. This branch added no protection there
because none was needed, and claims none.

**Invariant 2 — AI stays proposal-based — holds on every path this branch touched.** Ctrl+I writes
to a ghost layer (`store.ts:1086-1091 acceptGhostText` → `mergeField(…, "ai-draft")`) and never
writes the field. Acceptance is an explicit radiologist action.

**Invariant 12 — the fast path does not masquerade as equivalently validated — is now explicitly
false in the safe direction.** `/draft` *is* validated, and its `notChecked` list states exactly
where it is weaker than the composer. Before this branch the fast path had no verdict at all, so
nothing to masquerade with; the risk was that adding one would imply equivalence. `blocking:
false` plus `DRAFT_VALIDATION_GAPS` is what prevents that.

### New AI findings from this pass, all recorded not fixed

| ID | Sev | Finding |
|---|---|---|
| RW-24 | P2 | `POST /query` — the one surface that offers **Findings** prose for a report — has **no validation of any kind** (`aiReporting.ts:825-834`; verified: the response object is built and returned with no `validate*` call in the handler). Group C reached `/draft`, which offers only an Impression to a ghost layer. The asymmetry is now the wrong way round. |
| RW-25 | P2 | *"Insert Into Report"* (`pages/DicomViewer.tsx:461-473`) writes no text anywhere. `POST /insert-to-report` (`:1852-1869`) sets `status = "inserted"` and `wasInsertedToReport = true`, and that flag renders as **"Yes"** in the AI audit log — so the record an auditor reads can claim an insertion no code performed. |
| — | P2 | `POST /polish` (`:1465-1510`) is **live with no server-side safety gate**. It instructs the model not to change medical facts and returns the result directly. Its only client, `RadiologyAICopilotPanel.tsx:770`, appears unmounted and carries no auth header, so it would 401 — but the route is mounted and reachable. Nothing compares the polished text against the input for measurement or laterality drift. |

RW-24 and RW-25 are **not overwrite risks — both are honesty risks in the record**. They are
escalated to Part 15, decision D-8, because closing either is a semantics decision: parse-then-
validate `/query` or write a section-agnostic grounding subset; relabel the button or make the flag
mean what it says.

---

## Part 7 — Quality and Safety Wiring Changes

Spec §20, §21, §22; invariants 5, 8, 11, 14.

### Demography reaches the engine (Group B)

At base `POST /evaluate` did no patient or draft lookup — it passed `text` straight to the engine
(C-4 records this being checked before RW-04 was published, because the finding would otherwise
have been a false positive). So every rule needing `sex` or `age` was unreachable on the reporting
path.

The fix is **server-canonical and overriding**: `resolveDraftDemography` in `reportQuality.ts`
resolves from the draft/patient row, passes `sex` through the existing `sanitizeDicomSex`
normalizer rather than a new one, and the client's `buildWorkspaceQualityRequest` sends `sex`/`age`
as a fallback only. One source of truth, server wins.

`evaluate.demography.test.ts` (13 cases) is a describe **named for Q109** asserting
`toContain("Q109")` on the engine's own output — an engine-level proof the rule emits, not a
source grep.

### The 19 unreachable structured rules (invariant 11)

Invariant 11 says a quality rule must get its data **or be documented unreachable**. Group B
produced the matrix (audit §30.5). The honest result: **Q007 (required measurement missing) is
dead end to end** — `text.missingRequiredMeasurements[]` has no producer, so the rule cannot fire
from any path. That is RW-21, recorded, not fixed: closing it needs a protocol-vs-report gap
computation that does not exist. Decision D-4.

### Isolation (Group E, invariant 5)

Three reset paths existed at base, each clearing a different subset: 65 fields, 16 fields, and
4 fields. The third — `advanceToNextStudy`'s end-of-queue branch — fires when the **last study in
a session is signed**, i.e. on the normal path, and cleared 4 fields. C-11 records that the audit
had written "exactly two" and that the third stayed invisible for the whole audit pass *because
the audit had told itself the enumeration was complete*.

`clinicalStateReset.ts` (+181) is now the single canonical reset; `shouldApplyAsyncStudyKey`
(`radiologyWorkspaceSafety.ts:25-32`) is the string-identity refusal; the undo stack is
study-keyed and cleared on all three paths. 23 cases in `clinicalStateReset.hardening.test.ts`.

A deliberate design decision worth stating because it looks like a hole: **a null request key is
not a refusal** (`:29`). Worklist rows legitimately carry no `StudyInstanceUID`, and refusing
those would break Ctrl+I for every such study — a usability regression bought with no safety,
because there was no identity to lose. A null *current* key **is** a refusal once the request named
one, because that means the workspace has moved.

### Invariant 14 — MRI sub-masters intact

§25's constraint. Verified three ways: no sub-master source file is in the 40-file diff;
`mriDorsoLumbarCanvas.test.ts` was **extended** (+40) not modified, and its 12 pre-existing cases
still pass; the full ERP suite shows 0 regressions. The Lumbar/Dorsal equivalence work from PRs
#780/#783/#794 is untouched.

---

## Part 8 — Tests Added

**+153 declared test cases across 14 files.** 8 of them are in the DB-gated new file and cannot
collect on this box, so **+145 execute** — which reconciles exactly with the whole-repo delta
measured in Part 9 (8,436 → 8,581).

| File | New cases | Executes here |
|---|---|---|
| `aiDraftValidation.test.ts` (new) | 13 | ✓ 13 pass |
| `clinicalStateReset.hardening.test.ts` (new) | 23 | ✓ |
| `reportingWorkspaceJourneys.hardening.test.ts` (new) | 22 | ✓ |
| `storedReportBody.test.ts` (new) | 17 | ✓ |
| `evaluate.demography.test.ts` (new) | 13 | ✓ 13 pass |
| `reportQuality.demography.request.test.ts` (new) | 8 | **✗ fails at import** |
| `observationPersistence.hardening.test.ts` | +23 | ✓ |
| `aiReporting.query.test.ts` | +15 | ✓ 39 pass |
| `reportFieldMerge.test.ts` | +6 | ✓ |
| `radiologyWorkspaceSafety.test.ts` | +5 | ✓ |
| `patient-reports.d8.test.ts` | +4 | ✓ 28 pass |
| `reportQualityFinalize.test.ts` | +4 | ✓ |
| `mriDorsoLumbarCanvas.test.ts` | +40 lines, 0 new cases | ✓ 12 pass |
| **Total** | **+153** | **264 executed, 264 pass** |

Executed on this box at delivery:

```
10 ERP test files touched by this branch .... 184 passed (184)
lib/report-quality evaluate.demography ......  13 passed (13)
aiReporting.query.test.ts ...................  39 passed
patient-reports.d8.test.ts ..................  28 passed
                                              ─────────
                                              264 passed, 0 failed
```

### Mutation testing — the part that makes these numbers mean something

A test that passes proves nothing about the code it names unless it can fail. Two mutations were
run against the branch's own new tests, and **both produced findings that are recorded against
this work rather than quietly dropped**:

- **M6/M7 — delete the laterality guard row, or the spine-level guard row, from
  `CLINICAL_GUARDS`.** The whole ERP suite stays green. **RW-33.** The word-subsequence check at
  `reportFieldMerge.ts:456-459` is doing the work those two rows appear to do. The *behaviour* is
  correct; the *tests claiming to prove it* are not. §23's list of covered failure modes was
  overstated by exactly that much until this measured it.
- **M3/M4 — the finalize gauntlet ordering assertion was vacuous.** Its needle,
  `finalizeRadiologyReport`, first occurs at the **import** (`useStudyFinalize.ts:12`), so the
  ordering claim compared the gate against an import line and could not have failed for the reason
  it was written to detect. **C-16.** The needle now names the call site,
  `await finalizeRadiologyReport(`.

**No fix was made to RW-33.** Deleting the two unproven guard rows would be a behaviour change
with no test able to detect it either way — the one thing a test-hardening group is not entitled
to do.

---

## Part 9 — Test and Build Results

§29 requires pre-existing failures separated from regressions, with exact evidence.

### Whole-repo suite, base vs head

Measured in a detached worktree at `bc8ca8c5` with all 20 `node_modules` directories junctioned
in, using an **identical invocation** in both trees (`node ./node_modules/vitest/vitest.mjs`).
Method and cleanup recorded in the audit's Appendix A; two of the traps it hit are C-18 and C-19.

| | base `bc8ca8c5` | head `9c010fe7` (run B, identical invocation) |
|---|---|---|
| Test files | 89 failed / 710 passed / 13 skipped (**812**) | 90 failed / 715 passed / 13 skipped (**818**) |
| Tests | 21 failed / 8,375 passed / 40 skipped (**8,436**) | 22 failed / 8,519 passed / 40 skipped (**8,581**) |
| Duration | 27.42 s | 27.97 s |

**Delta: +6 test files, +145 tests. Regressions: 0.**

Failing-file set diff, both sides normalised through one function: **only at head = 1**,
**only at base = 0**. The one is `reportQuality.demography.request.test.ts`, added by Group B,
failing at *import* on `DATABASE_URL must be set` at `:24` — the same failure mode as the 82
pre-existing DB-gated files.

A first run of head used `npx` and reported 20 failures instead of 22. The ±1 is
`restoreVerifiesRealArtifact.test.ts` — `Error: Test timed out in 5000ms`, nondeterministic (failed
at base, failed in run B, passed in run A, and the specific test that times out varies). **Recorded
as a flake and not claimed as a fix.**

### PRE-EXISTING FAILURES (not caused by this work)

**83 of 83 collection failures at head are `DATABASE_URL must be set`** (82 at base; the 83rd is
this branch's new file). 82 surface the throw from `lib/db/src/index.ts:8`; the 83rd,
`composeEngine.mimeAndFallback.test.ts`, surfaces it as a `vi.mock` hoisting error whose import
chain reaches the same throw via `voiceReportComposer/runtimeConfig.ts:5`.

**The identical 7 files fail at test level on both revisions:**

| File | Failing | Cause (read from the output, not inferred) |
|---|---|---|
| `structuredReport/renderer.test.ts` | 5 | byte-for-byte goldens compared against a CRLF working tree |
| `dockerCompose.test.ts` | 9 | `getServiceBlock()` returns `''` for every service including `db` — the whole extractor fails on CRLF |
| `backupHealth.test.ts` | 2 | `resolveDataDir({}, "/app")` → `C:\app\data` |
| `secretStrength.test.ts` | 1 | imports `cron.ts` → `lib/db` |
| `pacs/mwlDeploymentStatus.test.ts` | 1 | counts 0 `.wl` files where the fixture wrote 2 |
| `restoreVerifiesRealArtifact.test.ts` | 1 | 5 s timeout, nondeterministic |
| `diagnostic-erp/src/lib/aiQueryContract.test.ts` | 1 | `f.replace(ERP_SRC + "/", "")` at `:52` is a no-op on a `\`-joined path, so the allowlisted `lib/aiReportingClient.ts` reads as the offender |

Every one is a Windows/CRLF/no-DB artifact of this box. Six of the seven are unchanged by this
branch; `aiQueryContract.test.ts` is in the ERP and its failure is a path-separator artifact, not a
behaviour change — the assertion it makes about the command centre's guarded overwrite passes.

### Build

| Command | Result |
|---|---|
| `pnpm run check:grounding` | **pass** — 105 claims, all `✓`, no `✗` |
| `pnpm typecheck` | **pass** — all 5 packages Done, zero diagnostics |
| `pnpm --filter @workspace/api-server run build` | **exit 0** — `dist/index.mjs` 17.0 mb, `dist/worker.mjs` 8.2 mb |
| `BASE_PATH=/erp/ pnpm --filter @workspace/diagnostic-erp run build` | **exit 0** — 420 chunks, `✓ built in 11.93s`, `dist/public/index.html` → `/erp/assets/index-BUcxejKe.js` |

`pnpm build` (the whole monorepo) **fails** at `@workspace/diagno-booking-mobile`:
`ERROR: No deployment domain found. Set REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or
EXPO_PUBLIC_DOMAIN`. **PRE-EXISTING and unrelated** — this branch changes 0 files in that package —
but it aborts `pnpm -r` before the ERP builds, which is why the two were built individually.

`AGENTS.md` claims the React frontends fail typecheck on `calendar.tsx`/`spinner.tsx`. **Measured
false** (C-8): `tsc --noEmit` exits 0 with 1,988 files compiled. `AGENTS.md` is stale on that point.

### Bundle-level wiring proof (§39 applied to the shipped artifact)

A component existing is not evidence it is wired. Three strings were grepped in the **minified
production chunks**, all found in `RadiologyReportingWorkspace-CQ5ctF_Z.js`:

| String in the shipped bundle | Proves |
|---|---|
| `You moved to another study while the model was working` | RW-31's refusal reaches production |
| `AI suggestions remain unreviewed` | RW-32's gate reaches production |
| `failed a grounding check` | Group C's verdict reaches production |

Re-verified after `8435d2b4`: 5 ERP test files → **102 passed**;
`pnpm --filter @workspace/diagnostic-erp exec tsc -p tsconfig.json --noEmit` → exit 0.

### The gap that matters most

`git ls-remote --heads origin` returns **only `main`**. This branch has never been pushed, so **CI
has never run on it**. CI *does* provision a database (`.github/workflows/ci.yml:53-71`:
`postgres:16-alpine`, `DATABASE_URL=postgresql://erp:erp@localhost:5432/care_test`,
`MIGRATION_SMOKE_ADMIN_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENABLE_SCHEDULERS: "0"`), so all 83
DB-gated files execute there.

**Therefore the following are UNVERIFIED, recorded as UNKNOWN per §39 and not as pass:**
`reportQuality.demography.request.test.ts` (8 cases — Group B's entire request-level proof), the
extended `aiReporting.query.test.ts` cases that need a DB, and the extended
`patient-reports.d8.test.ts` cases. Runtime evidence required: push the branch and read the CI run.

The local PostgreSQL 18 service on this machine was **deliberately not used**. It is
password-gated (`scram-sha-256`) and may hold the operator's real data; pointing a test or a
`db:push` at it is not a risk worth taking to close a verification gap.

---

## Part 10 — RR / RW Closure Matrix (§30)

Status vocabulary, per §30: **FIXED / PARTIALLY FIXED / NOT FIXED / NO LONGER APPLICABLE /
REQUIRES OWNER DECISION / CANNOT VERIFY**. FIXED requires proof the production path uses it, not
proof that code was added.

**Register totals: 98 findings — 22 closed, 2 partially addressed, 74 open.** (Corrected from
"19 fixed / 77 open" — C-20. The earlier figure subtracted an RW-only closed list from all 98.)

### The matrix below tallies differently, and the difference is deliberate

§29's totals use a three-way split (closed / partially addressed / open). §30's required vocabulary
has **six** values, and two of them — PARTIALLY FIXED and REQUIRES OWNER DECISION — cut across that
split. Enumerated, the 98 rows below are:

| Status | Count | IDs |
|---|---|---|
| FIXED | 20 | RR-06, RR-36, RW-01…RW-08, RW-13, RW-15…RW-18, RW-29…RW-32, RW-34 |
| PARTIALLY FIXED | 10 | RR-17, RR-18, RR-19, RR-20, RR-27, RR-37, RR-45, RW-19, RW-22, RW-23 |
| REQUIRES OWNER DECISION | 4 | RW-24, RW-25, RW-27, RW-28 |
| NOT FIXED | 62 | every remaining RR, plus RW-09…RW-12, RW-14, RW-20, RW-21, RW-26 |
| NOT FIXED — deliberately | 1 | RW-33 |
| **WORSE, measured** | 1 | RR-50 |
| | **98** | |

**Reconciliation to §29's 22 / 2 / 74:**

- **22 closed = 20 FIXED + RR-20 + RW-23.** Both of those are PARTIALLY FIXED here, because §30
  re-assesses *current* status and both have a half still open: RR-20's client locks are fixed and
  its server half is not; RW-23's stored draft is fixed and its image egress is not. §29 counted
  them closed. **The matrix is the stricter and the more accurate of the two.**
- **2 partially addressed = RW-19 + RW-22**, the only two §29 named. The matrix's other 8 PARTIALLY
  FIXED rows were inside §29's "74 open" (RR-20 and RW-23 excepted, per above).
- **74 open = 62 NOT FIXED + 1 NOT-FIXED-deliberately + 4 REQUIRES OWNER DECISION + 1 WORSE + 6
  PARTIALLY FIXED** that §29 called open (RR-17, RR-18, RR-19, RR-27, RR-37, RR-45).

**One row is not "open" but "regressed": RR-50.** The share of tests that assert on source text grew
under this work — 148/755 files to **154/810**, `readFileSync` 461 → **477**. This branch added
tests and the ratio moved against us. It is reported as WORSE rather than NOT FIXED because that is
what happened.

No row is NO LONGER APPLICABLE and none is CANNOT VERIFY at the *finding* level; the eleven
CANNOT VERIFY items in Appendix C are **evidence gaps about this branch's fixes**, not register
findings, and conflating the two would be a way of hiding them.

### The 64 RR findings, re-read at head

Every RR finding this branch does not touch — **48 of the 64** — was re-read against head. **All
48 are STILL PRESENT. None is FIXED. None is NO LONGER APPLICABLE.** Seven of them had citations
that could not be used as the starting point (C-21); in all seven **the finding survives and the
address was wrong**. Those seven are listed with their corrected sites below and are marked ⟂.

### The three P0s

| ID | Sev | Original problem | Status | Evidence at head | Test | Remaining risk |
|---|---|---|---|---|---|---|
| RR-01 | **P0** | Signed report is in-place mutable with no audit row | **NOT FIXED** | Re-read; no immutability constraint and no mutation audit row added by this branch | — | A signed report can still be edited in place. Group A changed *what* is stored, not *whether it can be changed*. Needs a server-side invariant plus an audit table — a schema change, so a `migrations/*.sql` file. |
| RR-02 | **P0** | Critical flag + acknowledgement clearable on a verified report | **NOT FIXED** | Re-read | — | Same class. Adjacent to RW-27/RW-28 (Part 15, D-10). |
| RR-03 | **P0** | Signing identity and instant are caller-supplied on a key-authenticated route | **NOT FIXED** | Re-read | — | The signer of record is whatever the client sent. Invariant §38-9 cannot be fully GREEN until this closes. |

**None of the three is reachable from a client-isolation group.** They are server-side schema and
authorization work and are the recommended next phase (Part 18).

### The other 13 RR rows re-verified in §23

| ID | Sev | Original problem | Status | Evidence | Test | Remaining risk |
|---|---|---|---|---|---|---|
| RR-04 | P1 | Strong identity gate sits on an endpoint the workspace does not call | NOT FIXED | audit §23 | — | The gate exists and is unreachable from the reporting workspace |
| RR-05 | P1 | Provenance does not survive finalization | NOT FIXED | Verified by enumeration at head: `fieldProvenance` occurs **exactly once** in `useDraftPersistence.ts` — at `:216`, inside the Group E refusal branch that *clears* it when a draft belongs to another patient — and is **absent from the save payload** at `:378-432`, which does carry technique, findings, impression, recommendation, `findingsSections`, `structuredFormatState`, `observationLedger`, `viewerMeasurements`, `canalApProvenance`, spine state, `vascularTechnique`, `linkedStudy`, `appliedPatterns` and `reportFormatIdentity` | — | The one place the persistence layer mentions provenance is the place it wipes it. In-report AI marking is **screen-only**. Provenance does exist durably in the composer job record (`jobService.ts:423` stores `validationJson: JSON.stringify({ ...validation, provenance: run.provenance ?? null })` — verified) but that is the job, not the signed artifact |
| **RR-06** | P1 | Undo stack survives a study switch | **FIXED** | `cd572ea1`; `shouldApplyAsyncStudyKey` at `radiologyWorkspaceSafety.ts:25-32`, refusal in `useWorkspaceCommands.ts` | `clinicalStateReset.hardening.test.ts`, `radiologyWorkspaceSafety.test.ts` (+5) | → RW-06. Client-side only; a client that skips the hook still has the stack |
| RR-07 | P1 | Format A/B merge destroys the ledger and the only recovery path | NOT FIXED | audit §23 | — | Group D added staleness detection; the destructive merge itself is unchanged |
| RR-18 | P1 | Validator is starved of its own inputs at finalize | **PARTIALLY FIXED** | Group B sends `sex`/`age`; `reportQualityFinalize.ts` +40 | `reportQualityFinalize.test.ts` (+4), `evaluate.demography.test.ts` (13) | Demography now reaches it. `observations` and `technique` still do not, so the structured rules stay unreachable (Part 7) |
| **RR-20** | P1 | Finalized state is session-only; a re-opened signed study is editable and re-printable as final | **PARTIALLY FIXED** | RW-30's `authoritativeStatus` now feeds all three lock decisions (`cd572ea1`) | `clinicalStateReset.hardening.test.ts` | The **client** half is closed. The **server** still accepts an edit to a finalized row — RR-01's territory |
| RR-21 | P1 | Client PDF path substitutes a default signer name | NOT FIXED | audit §23 | — | Interacts with RR-03; both must close together |
| **RR-36** | P2 | Ctrl+I sends findings the server never reads | **FIXED** | `aiReporting.ts:1003` reads `reportBody ?? findings`; an empty prompt hard-fails at `:740-745` (C-6) | `aiReporting.query.test.ts` | Closed before this pass. Verified, not assumed |
| RR-37 | P2 | AI-pending gate is client-only and depends on this tab's query cache | **PARTIALLY FIXED — client half now proven** | Gate extracted to `decideAiFinalizeGate` (`aiFinalizeGate.ts`, +41) and called at `useStudyFinalize.ts:214` | **10 cases**; the string `AI suggestions remain unreviewed` is in the shipped bundle | **Does not close RR-37.** Nothing server-side refuses to sign a report whose composer job has PENDING proposals, so a client that skips the hook still signs |
| RR-38 | P2 | `mergeField` finalized guard covers voice only | NOT FIXED | audit §23 | — | RW-05 armed staleness on `mergeField`; the finalized-guard breadth is unchanged |
| RR-53 | P4 | Orphaned surfaces and ~6,000 dead lines still bundled | NOT FIXED | audit §23 | — | Group C added one more orphan finding: `RadiologyAICopilotPanel.tsx` is unmounted **and** unauthenticated (RW-14) |
| RR-59 | P3 | Hard-coded signer preference via regex in the finalize path | NOT FIXED | audit §23 | — | — |
| RR-62 | P3 | HOPE emit can report success while enqueuing nothing | NOT FIXED | audit §23 | — | — |

### The 48 re-read at head — all NOT FIXED

Evidence column: "re-read at head" means the code was opened at `8435d2b4` and still does what the
register says. ⟂ marks the seven whose recorded citation was wrong (C-21); the corrected site is
given. Line numbers elsewhere are the 2026-09-30 register's vintage, re-confirmed as still
describing live code.

**This report had the same defect, and it is recorded rather than quietly fixed.** Much of the
evidence in Parts 10–13 was first gathered by delegated search and then spot-checked against source
before publication, because C-15 exists precisely for that reason. **Four citations in the first
draft of this document were wrong**, all in the same direction — plausible, specific, and never
opened:

| Claim as first drafted | Verified truth at head |
|---|---|
| `reportValidator.ts:201` says *"Review before signing (does not block)"* | `reportValidator.ts:201` is `function medicalConsistencyWarnings(…)`. The string is at **`FinalizeSignDialog.tsx:201`** — a different file. `reportValidator.ts:4-5` does say *"WARN ONLY … it never blocks and never auto-corrects"* |
| `CRITICAL_TERMS` has **113** entries | **108**, counted two independent ways over `:34-176`, no multi-line entries |
| the server critical list is at `criticalFindingsAlert.ts:124-134` | it is `CRITICAL_KEYWORDS` at **`:124-135`**; the count of 10 was right |
| RR-12's overwrite lands at `store.ts:1200-1201` — one line | **`store.ts:1255-1258` and `:1264` — five `replaceProvenance: true` writes**, covering technique, findings, impression, recommendation *and* clinicalHistory. The real defect is five times wider than the citation implied |
| `fieldProvenance` is "absent from `useDraftPersistence.ts:372-433`" | absent from the payload, but it **does** occur once in the file — at `:216`, in the branch that *clears* it. The precise claim is stronger than the drafted one |

**Two of the five made the finding look smaller than it is** (RR-12: one line vs five; RR-05: a range
vs the whole file). That is the direction worth worrying about, and it is why the spot-check was not
optional. Every affected cell below now names what was actually read.

| ID | Sev | Original problem | Status | Evidence at head | Test | Remaining risk |
|---|---|---|---|---|---|---|
| RR-08 | P1 | DICOM study-UID uniqueness is boot-time best-effort | NOT FIXED | Drizzle declares `uidUq` (`lib/db/src/schema/radiologyWorklist.ts:97`) but **zero SQL migrations create it**; `index.ts:595-602` still `EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'skipped'` | — | The DDL of record and the ORM disagree; production may lack the constraint. Needs a live DB to settle (RR-48's family) |
| RR-09 ⟂ | P1 | Report↔study binding: polymorphic integer, no FK, no unique index, two namespaces | NOT FIXED | **Citation corrected:** `radiologyCopilot.ts:111-125` is the `POST /log` handler. The remaining defect is in `pacsArchive.ts:108-120` only | — | Polymorphic binding unchanged |
| RR-10 | P1 | Name-similarity auto-link writes identity before human review | NOT FIXED | re-read at head | — | Identity can still be written by a similarity heuristic |
| RR-11 ⟂ | P1 | Cross-patient link guard disabled exactly when identity is unknown | NOT FIXED | **Citation drifted by this branch:** `radiologyWorkspaceSafety.ts:23` → **`:42`**, because `9c010fe7` inserted `shouldApplyAsyncStudyKey` above it. The line is `if (draftPatientId == null \|\| currentPatientId == null) return true;` | `radiologyWorkspaceSafety.test.ts` covers the *new* function, not this one | **This is a deliberate design decision, not an oversight** — see the comment at `:19-23` and Part 7. It is nonetheless the guard being off when identity is unknown, and it stays open |
| RR-12 | P1 | Hand-typed text can be classified as machine text and overwritten | NOT FIXED | Chain live end to end, all four hops verified at head: `observationLedger.ts:449` `map[key] = ["template"];` → `fullReportFormat.ts:230` `if ([...sources].some((s) => TEMPLATE_SOURCES.has(s))) return "template";` → `:241` *"Safe auto-replace: blank / generated / template / AI"* → `store.ts:1255-1258` and `:1264`, **five** `setField(…, { source: "template", replaceProvenance: true })` calls covering technique, findings, impression, recommendation **and clinicalHistory** | — | **Invariant 1's sharpest edge, and wider than the register recorded.** `materializeAcceptedText` protects AI text; this path is a *format* overwriting text it has classified as a format's own, and it does so across all five sections at once. The register cited one line in `store.ts`; the real site is five |
| RR-13 ⟂ | P1 | Five live insertion paths overwrite with no confirmation and no undo | NOT FIXED | **Overwrite-without-confirm verified at 3 paths, not literally five** — the least confident row in this matrix. Lines drifted after #794 landed 2026-10-01 | — | Count disputed, defect real. Needs one browser session to enumerate the five precisely |
| RR-14 | P1 | Voice command mode live-commits by default | NOT FIXED | re-read at head | — | — |
| RR-15 | P1 | The merger can delete or substitute a sentence with no diff | NOT FIXED | re-read at head | — | Adjacent to RW-19 (Part 15, D-3) |
| RR-16 | P1 | Invisible deletion in the voice change plan | NOT FIXED | re-read at head | — | — |
| RR-17 | P1 | No findings↔impression consistency check on the signing path | **PARTIALLY FIXED** | Group D arms `impressionNeedsRefresh` on every Findings write (`df7e024b`) | `observationPersistence.hardening.test.ts` (+23) | **The gate is still advisory.** `canConfirm` (`FinalizeSignDialog.tsx:148-151`) is exactly three terms — critical ack, signer, `compositionOk` — and **`unresolvedBlockers` is not among them** (verified at head); the structured-tier blockers render at `:201` under the literal heading *"Review before signing (does not block)"*; `reportValidator.ts:4-5` says *"WARN ONLY … it never blocks and never auto-corrects"*. `d3498ba1` corrected the *code comments* that claimed otherwise. Decision D-1 |
| RR-19 ⟂ | P1 | Print output is a live-body overlay on a signed shell | **PARTIALLY FIXED** | `radiologyReportPrintLiveMerge.ts` +48 now reads the signed body; `radiology-report-generator.ts:2379,2422,2459` exact. **PrintLiveMerge lines drifted +48** because `6e921f04` added `buildSignedReportBodyHtml` | `storedReportBody.test.ts` (17) | The ERP print path is fixed. The server-side generator's three sites are unchanged |
| RR-22 | P2 | Sequence gating enforced only at the tile panel | NOT FIXED | `spineSequencesAllow` still absent from all four cited modules; the re-derive effect moved to `useWorkspaceClinicalUi.tsx:2942-2961` | — | — |
| RR-23 | P2 | Level defaults offer unimaged levels; coverage is never a gate | NOT FIXED | re-read at head | — | — |
| RR-24 | P2 | Laterality emitted without selection; prose can drop a recorded level | NOT FIXED | re-read at head (evidence cell was truncated in the register) | — | Invariant 4 is protected at the *merge* level (`reportFieldMerge.test.ts:75`) and the *AI* level (`aiDraftValidation.test.ts:52`), not at emission |
| RR-25 | P2 | Canal AP measurement re-parsed with units stripped and read as mm | NOT FIXED | re-read at head | — | — |
| RR-26 ⟂ | P2 | Viewer-measurement ingest exempts deletes and matches without study UID | NOT FIXED | **Wrong file in the register.** `useOhifViewerBridge.ts:350-353` holds `invalidateQueries`/`toast` callbacks. The label→level parse is `resolvePersistedCanalLevel` at `structuredViewerMeasurements.ts:350-352` | — | Finding real, address corrected |
| RR-27 | P2 | Measurement truncation is silent and untested | **PARTIALLY FIXED** | The "untested" half holds only for the **client** `.slice(-400)` at `useDraftPersistence.ts:393-395`. `structuredJsonColumn.test.ts:112-122` **does** assert the server clamp | server clamp covered | Silent client truncation remains |
| RR-28 | P2 | Autosave ignores finalizing/lock state and drops non-transient failures | NOT FIXED | re-read at head | — | Group E scoped the reset; autosave's own lock check is unchanged |
| RR-29 | P2 | Opening a study can create a server draft with zero radiologist action | NOT FIXED | re-read at head | — | **Needs one browser observation to prove end to end**: open a spine study, touch nothing, watch the network tab for `POST …/save-draft` |
| RR-30 | P2 | `radiology_report_drafts` has no UNIQUE(study/worklist) | NOT FIXED | no `uniqueIndex` (`radiologyReportGenerator.ts:57-61`); `save-draft` inserts with no `onConflict` (`radiology-report-generator.ts:1763`); the client adopts `res?.drafts?.[0]` (`useRadiologyDraftId.ts:36`) | — | Duplicate drafts possible; the client picks one arbitrarily |
| RR-31 | P2 | Screening limitation sentence deletable, and deleting it is undetectable | NOT FIXED | re-read at head | — | — |
| RR-32 | P2 | Screening vs dedicated decided by a name substring, unasserted at sign-off | NOT FIXED | `screening` persists in the draft payload, **`studyComposition` does not**, and `useStudyFinalize.ts` reads neither | — | — |
| RR-33 | P2 | Prose-matched multi-study routing lands a chip in the wrong study on a tie | NOT FIXED | re-read at head | — | — |
| RR-34 | P2 | Silent modality/status defaults inside the workspace | NOT FIXED | re-read at head | — | — |
| RR-35 | P2 | Non-AI text labelled `ai-draft`; AI text labelled `manual` | NOT FIXED | `command-palette.tsx:51` fixed `"ai-draft"` string; the regex-as-AI classifier moved to `findings-editor.tsx:224-230`; `store.ts:894-895,917-922` | — | **Provenance labels can invert.** Interacts with RR-05 and with invariant 13 |
| RR-39 | P2 | No auditable dictation original is retained | NOT FIXED | re-read at head | — | — |
| RR-40 | P2 | Critical ack/notif never persisted from finalize; SLA escalation cosmetic | NOT FIXED | **Least confident row.** `computeFinalizeSafety` *is* called (`useStudyFinalize.ts:214`), so only the `critical-unflagged` branch is dead by tautology. Ack persists only via `patient-reports.ts:2450-2461`, called solely from `ReportHub.tsx:296` — **not from the workspace** | — | The workspace's critical acknowledgement is not durable. Adjacent to RW-28 (D-10) |
| RR-41 | P2 | Two divergent critical keyword lists | NOT FIXED | Client `CRITICAL_TERMS` is `criticalResults.ts:33-177` — **108 entries**, counted two independent ways (`{ term:` and `label:` occurrences, no multi-line entries). The server list is `CRITICAL_KEYWORDS` at `criticalFindingsAlert.ts:124-135` — **10 entries** — consumed only by `scanForCriticalFindings` (`:137`), which reaches `POST /studies/:id/prelim`, a route with **no ERP caller** | — | **108 vs 10.** The smaller list guards a route nothing calls, so the critical terms the *server* can detect are a tenth of the ones the workspace knows |
| RR-42 | P3 | `GET /worklist` unbounded with post-fetch JS search | NOT FIXED | no LIMIT in `radiology.ts:404-434`; no index on `radiology_studies.assigned_radiologist_id` | — | — |
| RR-43 | P3 | `nextAccessionNumber` is a retrying seq-scan `MAX+1` with zero tests | NOT FIXED | **zero tests reference `nextAccessionNumber`** | — | Unchanged and untested |
| RR-44 | P3 | Autosave rewrites a 10-subtree jsonb envelope; ledger is the unbounded member | NOT FIXED | re-read at head | — | — |
| RR-45 | P3 | Next-study "prefetch" discards its result and POSTs an AI draft | **PARTIALLY FIXED — the one genuinely arguable row** | The recorded behaviour (`nextStudyReportPrefetch.ts:30-40`, `useWorkspaceClinicalUi.tsx:2206-2216`) is **literally unchanged**, but `1be8252b` added `warmUpOnly: true` and the server now skips draft persistence (`aiReporting.ts:1363 if (success && !warmUpOnly)`) | `aiReporting.query.test.ts` | The **stored-draft half is closed; the image-egress half is not** (Part 14, R-2). A grader could reasonably call the clinical half FIXED — it is marked PARTIAL because the finding as written names the POST, which still happens |
| RR-46 | P3 | Worklist row fetched twice per open; prefs twice; 3 concurrent polls | NOT FIXED | re-read at head | — | — |
| RR-47 | P2 | `/report-hub` permission-invisible, bypasses the radiology choke point | NOT FIXED | re-read at head | — | — |
| RR-48 | P3 | 201 declared FKs vs 133 in SQL; 0 CHECK / 0 GRANT | NOT FIXED | measured at head: **201** `.references(` in the Drizzle schema, **133** `REFERENCES` in migrations, **0** `GRANT` | — | The superuser half needs a live DB (**U-8**) |
| RR-49 | P3 | Drizzle↔DDL drift in both directions, "safe to ignore" by comment | NOT FIXED | re-read at head | — | RR-08 is one instance of this |
| RR-50 | P3 | Gates validate naming, not behaviour; 19.6% of tests assert source text | **WORSE, measured** | text-asserting tests grew to **154 of 810 files** with **477** `readFileSync` (was 148/755, 461). Grounding claims still 105 | — | This branch added tests; the ratio moved against us. `AGENTS.md` already warns that a grep test stayed green while an endpoint returned HTTP 500 on every call |
| RR-51 | P3 | Zero React render tests while the orchestrator is 3,357 lines | NOT FIXED | `vitest.config.ts:22` `environment: "node"`; **zero** `*.test.tsx` files; testing-library mentions drifted 5→2 | — | **This is why RW-32 existed.** A hook with a DOM dependency cannot be tested here, so the gate had to be extracted to be tested at all |
| RR-52 | P3 | Guard-test asymmetry across regions | NOT FIXED | re-read at head | — | RW-33 is the measured instance for the merge guards |
| RR-54 | P4 | Six nav lists, three shortcut definitions, two undo-depth constants | NOT FIXED | re-read at head | — | — |
| RR-55 | P4 | `@ts-nocheck` on every workspace shell panel | NOT FIXED | `@ts-nocheck` in **exactly 8 files** under `components/radiology/workspace/` | — | — |
| RR-56 | P4 | Queue position "n of N" computed but displayed nowhere live | NOT FIXED | re-read at head | — | — |
| RR-57 | P3 | Global macro tables role-free and unattributed | NOT FIXED | re-read at head | — | — |
| RR-58 | P4 | Provenance UI hidden from users | NOT FIXED | `<div className="hidden" aria-hidden="true"><OwnershipTracePanel /></div>` at `ReportCanvas.tsx:1553` is the **only** mount | — | The provenance UI exists and is rendered invisible. Interacts with RR-05 |
| RR-60 ⟂ | P3 | Un-encoded identifiers spliced into `weasis://`; StudyUID sent to public `viewer.ohif.org` | NOT FIXED | **Wrong site in the register.** `viewerService.ts:357-368` is `getWeasisUrl`'s raw weasis splice (confirmed: `:357` template replace, `:368` `weasis://$dicom:get`). `viewer.ohif.org` lives in `dicomConnectors.ts:125-126` and `fetalUsgLevel4.ts:799-801` | — | **Both halves of the finding are real**; the register put them in one file. The weasis splice is un-encoded; the public-viewer send is a separate site |
| RR-61 | P3 | Bearer staff token placed in a URL query parameter for image loads | NOT FIXED | re-read at head | — | Tokens in URLs reach proxy and browser logs |
| RR-63 ⟂ | P2 | Amendment/version behaviour flag-conditional; flag-off serves superseded rows unbannered | NOT FIXED | **Wrong file in the register.** `radiologyReportVersion.ts:409-416` never existed (the file is 348 lines, since July). The code is `effectiveResolveMode` at `patient-reports.ts:409-416`, returning `"latest"` when `ff_radiology_structured_final` is on and `"specific"` otherwise — verified at head | `patient-reports.d8.test.ts` (28 pass) covers the D8 surface, not this branch of the flag | Same line numbers, different file. Finding real |
| RR-64 ⟂ | P2 | Workspace prior-report panel is chain-blind and cross-namespace | NOT FIXED | **Wrong site in the register.** `radiologyCopilot.ts:111-125` has been the `/log` route since a July 23 refactor. The real prior-select is `:84-100` with `mergePriorStudies(studies, reports)` at `:103` — verified chain-blind, no ordering or chain logic in the select | — | Finding real, address corrected |

### The 34 RW rows

| ID | Sev | Status | Evidence / note |
|---|---|---|---|
| RW-01 | P1 | **FIXED** | `6e921f04`; `storedReportBody.ts` + `storedReportBody.test.ts` (17) |
| RW-02 | P3 | **FIXED** | Group A |
| RW-03 | P2 | **FIXED** | Group A |
| RW-04 | P1 | **FIXED** | `21021ff6`; `resolveDraftDemography`; `evaluate.demography.test.ts` (13) |
| RW-05 | P2 | **FIXED** | `df7e024b`; `mergeField` arms staleness. **Fix was wider than its own entry recommended** — the arming predicate it said to mirror was itself source-keyed, so `setField` needed changing too |
| RW-06 | P1 | **FIXED** | `cd572ea1`; closes RR-06 |
| RW-07 | P1 (ledger) / P2 (rest) | **FIXED** | `cd572ea1`; three reset paths → one |
| RW-08 | P2 | **FIXED** | `df7e024b`. **Narrower than its entry proposed** — unowned advice is deliberately not named, and it reaches the signer at the finalize dialog only, not live in the workspace banner |
| RW-09 | P2 | NOT FIXED | audit §24 |
| RW-10 | P2 | NOT FIXED | audit §24 |
| RW-11 | P3 | NOT FIXED | audit §24 |
| RW-12 | P2 | NOT FIXED | audit §24 |
| RW-13 | P3 | **FIXED** | `df7e024b` |
| RW-14 | P4 | NOT FIXED | `RadiologyAICopilotPanel.tsx` unmounted **and** would 401 — its five `fetch()` calls (`:189, :536, :617, :635, :770`) carry no `Authorization` header and no `credentials` |
| RW-15 | P2 | **FIXED** | Group A. The Impression printed **twice** on every signed radiology document: `patient-reports.ts:2775` passed the `impression` column into `renderReportDocument`, which renders it as a `.impression` box (`reportPresentation.ts:1036`) *and* then renders `bodyHtml` (`:1038`), which already contains an Impression section. Fixed at the model-construction site only — `impression: r.type === "radiology" ? null : r.impression` — so the DB column is untouched and `FollowUpPanel`'s "Copy impression" and `RadiologyCommandCenter.tsx:1354` still work. Proven by `patient-reports.d8.test.ts` |
| RW-16 | P3 | **FIXED** | Group A. The study title printed twice: the finalize payload built its own `<h2>${title}</h2>` while `renderReportDocument` also renders `.study-title-bar` (`reportPresentation.ts:1031`). The new builder emits no title; the assertion is that `class="study-title-bar"` appears exactly once and no `<h2>` carries the title |
| RW-17 | P2 | **FIXED** | Group A. `FollowUpPanel` treated signed report HTML as narrative text — a prior report's `body` is one of **five** different HTML shapes, not findings prose, and both the comparison panel and the timeline fed raw `body` into a sentence differ and into the DOM. Fixed by routing both through `parseStoredReportBody` in the new `storedReportBody.ts`, the one place that knows the five shapes; 17 tests |
| RW-18 | P2 | **FIXED** | Group B. The finalize mirror validator was starved behind an `as any`: `useStudyFinalize.ts` called `validateReport` with **3 of its 9** inputs, cast to `any` to silence the type error, so recommendation, clinical history, sex, age, modality and study description were all absent and Q004, Q005, Q107–Q114 could not fire there. Cast removed, all nine passed |
| RW-19 | **P3** | **PARTIALLY FIXED** | False docstring corrected, semantics left alone. *"Copy findings"* (`ReportingToolsRail.tsx:1013` → `setField`) is still a wholesale replace of the radiologist's Findings, attributed as a manual edit, with no undo. Decision D-3 |
| RW-20 | P4 | NOT FIXED | `useWorkspaceClinicalUi.tsx:120` imports `runFinalizeQualityEvaluation` |
| RW-21 | P2 | NOT FIXED | **Q007 dead end to end** — `text.missingRequiredMeasurements[]` has no producer. Decision D-4 |
| RW-22 | P2 | **PARTIALLY FIXED** | Misleading comments corrected, no behaviour change. The string `failed a grounding check` **is** in the shipped bundle |
| RW-23 | **P1** | **PARTIALLY FIXED** | `warmUpOnly` closes the stored-draft half. **The image-egress half is open** — Part 14 R-2, decision D-11 |
| RW-24 | P2 | **REQUIRES OWNER DECISION** | `/query` unvalidated. D-8 |
| RW-25 | P2 | **REQUIRES OWNER DECISION** | "Insert Into Report" flips a flag. D-8 |
| RW-26 | P3 | NOT FIXED | Two dead imports beside the one live banner consumer |
| RW-27 | **P1** | **REQUIRES OWNER DECISION** | One benign formatting action permanently suppresses the critical interrupt **and** its SLA timer for every later patient in the tab. D-10 |
| RW-28 | **P1** | **REQUIRES OWNER DECISION** | The "log the call for medico-legal record" dialog writes nothing. D-10 |
| RW-29 | P3 | **FIXED** | Group E |
| RW-30 | — | **FIXED** | `authoritativeStatus` feeds all three lock decisions. **Half of RR-20** |
| RW-31 | P2→**P1** | **FIXED** | `9c010fe7`; 7 tests; string in the shipped bundle |
| RW-32 | P2 | **FIXED** | `decideAiFinalizeGate`; 10 tests; string in the shipped bundle. **Client half of RR-37** |
| RW-33 | P3 | **NOT FIXED — deliberately** | M6/M7 not caught. Deleting the two guard rows would be a behaviour change no test can detect either way |
| RW-34 | P2 | **FIXED** | Measurement precision now has a test; §17's own canonical example had none |

---

## Part 11 — End-to-End Wiring Matrix (§32)

**GREEN** = correctly wired · **YELLOW** = partial / intentional limitation · **RED** = broken ·
**GREY** = not applicable. Every RED and YELLOW is explained below the table.

| Data | Source | Workspace | AI | Validation | Finalize | Stored | Print/PDF | Provenance | Status |
|---|---|---|---|---|---|---|---|---|---|
| Patient ID | worklist row | GREEN | GREEN (bound server-side) | GREEN | GREEN | GREEN | GREEN | GREEN | **GREEN** |
| Name | worklist row | GREEN | GREY (not sent) | GREY | GREEN | GREEN | GREEN | GREY | **GREEN** |
| Age | patient row | GREEN | GREY | **YELLOW 1** | GREEN | GREEN | GREEN | GREY | **YELLOW** |
| Sex | patient row | GREEN | GREY | GREEN | GREEN | GREEN | GREEN | GREY | **GREEN** |
| Study | worklist row | GREEN | GREEN (`studyInstanceUID`) | GREEN | GREEN | GREEN | GREEN | GREY | **GREEN** |
| Clinical History | workspace store | GREEN | **RED 2** | GREY | GREEN | GREEN | GREEN | GREY | **RED** |
| Technique | workspace store | GREEN | **RED 2** | GREY | GREEN | GREEN | GREEN | GREY | **RED** |
| Findings | workspace store | GREEN | GREEN (`reportBody`) | **YELLOW 3** | GREEN | GREEN | GREEN | **YELLOW 4** | **YELLOW** |
| Measurements | ledger / viewer | GREEN | **YELLOW 5** | **YELLOW 3** | GREEN | GREEN | GREEN | GREEN | **YELLOW** |
| Laterality | ledger / viewer | GREEN | **YELLOW 5** | **YELLOW 3** | GREEN | GREEN | GREEN | GREEN | **YELLOW** |
| Impression | derived | GREEN | GREEN (Ctrl+I ghost) | GREEN | GREEN | GREEN | GREEN | **YELLOW 4** | **YELLOW** |
| Recommendation | ledger advice | GREEN | GREEN (composer) | **YELLOW 6** | **YELLOW 6** | GREEN | GREEN | **YELLOW 4** | **YELLOW** |
| Critical result | `criticalResults.ts` (108 terms) | GREEN | GREY | **YELLOW 7** | **YELLOW 7** | **RED 8** | GREY | GREY | **RED** |
| Signer | client-supplied | GREEN | GREY | **RED 9** | **RED 9** | **RED 9** | **YELLOW 10** | GREY | **RED** |

### Every RED and YELLOW explained

1. **YELLOW — Age.** Group B sends `sex`/`age` and the server resolves both canonically, but only
   the *demography* rules are proven to receive them. `observations` and `technique` still do not
   reach the evaluator, so the 19 structured rules stay unreachable (RW-21, decision D-4).
   Invariant 11 is satisfied for demography and documented-unreachable for the rest.
2. **RED — Clinical History and Technique are not sent to Ctrl+I's `/draft`.** Verified at head:
   the client body is exactly `{ studyInstanceUID, modality, field: "impression", reportBody }`
   (`useTriggerAiImpression.ts:61-66`). The **server supports both** — `aiReporting.ts:1194-1209`
   reads `clinicalHistory`, and the route admits `technique` at `:846`. The workspace does not send
   them. `DRAFT_VALIDATION_GAPS` declares the technique half honestly (`:846`). This is decision
   D-7 and it is a **context-completeness failure (§15), not a safety failure**: the model writes an
   Impression without seeing the Clinical History. The background composer *does* get both
   (`buildRadiologistDraftContext.ts:218-222,239-240`).
3. **YELLOW — Findings/Measurements/Laterality validation.** `/draft` runs
   `validateComposerOutput`, but the snapshot it validates has `observations: []` and
   `technique: ""` (`aiReporting.ts:878-882`), so the **hard** `measurement_mutation` and
   `laterality_swap` checks (`validateOutput.ts:270-274`, `:318-320`) **cannot fire on that path**.
   And `blocking: false` (`:893`) — the verdict labels, it does not withhold. Both are declared in
   the response, which is what makes this YELLOW rather than RED.
4. **YELLOW — Provenance does not survive finalization.** `fieldProvenance` occurs exactly once in
   `useDraftPersistence.ts` — at `:216`, in the refusal branch that *clears* it — and is absent from
   the save payload at `:378-432`, which carries fourteen other clinical fields. So in-report AI
   marking is screen-only. RR-05. The composer path is stronger — `jobService.ts:423` stores
   `validationJson` including `provenance` — but that is the job record, not the signed artifact.
   And RR-58: the provenance panel's only mount is inside `className="hidden"`
   (`ReportCanvas.tsx:1553`, verified exact).
5. **YELLOW — Measurements and laterality reach only the composer.** `/draft` gets no structured
   observations at all, so it cannot see a measurement to mutate. The composer's frozen snapshot
   includes them. Declared gap 2 of `DRAFT_VALIDATION_GAPS`.
6. **YELLOW — Recommendation.** Group D names orphaned advice at the finalize dialog, deliberately
   not live in the workspace banner (RW-08's fix is narrower than its entry proposed). The advice
   does not block.
7. **YELLOW — Critical result validation and finalize.** The finalize gate catches an unchecked
   acknowledgement box, so **no unsigned critical can be issued**. But `computeFinalizeSafety`'s
   `critical-unflagged` branch is dead by tautology (RR-40), and the workspace's ack is not the
   durable one — only `patient-reports.ts:2450-2461` persists it, called solely from
   `ReportHub.tsx:296`.
8. **RED — Critical result is not stored.** RW-28: the dialog promising *"Log the call for
   medico-legal record"* writes nothing. `criticalSummary` appears **nowhere** in `api-server`,
   `lib/db` or `lib/api-zod`. There is no record of who was telephoned, when, by whom, and a reload
   loses the fact that the call happened. Making it durable is a schema change → `migrations/*.sql`.
   Decision D-10.
9. **RED — Signer identity is caller-supplied.** RR-03 (**P0**) on a key-authenticated route, and
   RR-21: the client PDF path substitutes a default signer name. The signer of record is whatever
   the client sent. Nothing in this branch touches it.
10. **YELLOW — Print/PDF signer.** Group A fixed the *body*. The signer *name* on the printout
    inherits RR-21's substitution.

**Invariant 9 verdict:** GREEN for the body, **RED for the signer**. Invariant 10 verdict: GREEN —
print and Word now read the signed body, not a live overlay.

---

## Part 12 — AI Context and Safety Matrix (§33)

Rows are AI pathways; columns are what each one receives and what happens to its output.
**"Do not infer. Verify source."** Every cell below was read at head. Cells this box cannot settle
are marked **CANNOT VERIFY** with the runtime evidence required.

| Pathway | History | Technique | Findings | Impression | Measurements | Laterality | Images | Validation | Explicit accept | Provenance |
|---|---|---|---|---|---|---|---|---|---|---|
| **1. Ctrl+I `/draft`** | **NO** | **NO** | YES (`reportBody`) | n/a (target) | NO | NO | up to 6, server-fetched | YES — `validateComposerOutput` via `validateDraftGrounding`, **advisory**, 3 declared gaps | YES — ghost text only | audit row + draft row; **not** in the report |
| **2. `POST /query`** (DicomViewer AI tab) | YES | no | via `promptText` | via `promptText` | no | no | up to 6 | **NONE** (RW-24) | clipboard *Copy*, or a button that writes nothing (RW-25) | `POST /drafts` + audit row |
| **3. Background composer** | YES | YES | YES (frozen snapshot) | YES | **YES** | **YES** | frozen key-image registry | **YES — gates READY** (`jobService.ts:388-399`) | YES — `useReportComposer.ts:330` "Never auto on READY" | **strongest** — `jobService.ts:423` stores `validationJson` incl. `provenance` |
| **4. Voice** | no | no | YES | YES | YES (`radiologyDictationVocab.ts:161-166`) | YES | no | YES — `isPolishSafe` gate (`ai.ts:351`) | YES | — |
| **5. Overnight / on-arrival** | **NO** | **NO** | **NO radiologist text at all** | generated | no | no | provider-dependent | `runDeterministicQuality` + `applyTrustGauntlet` (`:331,339`) — **not** `validateComposerOutput` | YES — `AiDraftPanel.tsx:25,88-98` "Accept stages; never inserts" | shadow-only (`shadowPipeline.ts:5-6,441-442`) |
| **6. Next-study preload** | NO | NO | NO | generated | no | no | **up to 6, unredacted** | same validator, **result unused** | n/a — discarded | audit row only; `draftId: null` |
| **7. `POST /polish`** | no | no | YES (the text) | no | no | no | no | **NONE server-side** | **CANNOT VERIFY** — only client appears unmounted | audit row |
| **8. `/image-review`** | no | no | no | no | no | no | YES | reuses `/query` infra | — | audit row |
| **9. `/compare`** | no | no | prior + current | no | no | no | optional | **CANNOT VERIFY** | — | — |
| **10. `NeuroPromptPanel`** | no | no | YES | no | no | no | optional | none | `window.confirm` before overwriting typed findings | audit row; **forces `provider: "gemini"` = cloud** |
| **11. Patient-communication draft** | — | — | — | — | — | — | — | **501 disabled** (`:3532-3535`) | — | — |
| **12. `dicomWorkflow.aiExtract`** | — | — | — | — | — | — | — | **501 disabled** (`:211-216`) | — | — |
| **13. `aiReporting.voiceTranscription.transcribe`** | — | — | — | — | — | — | — | **501 disabled** (`:3385-3390`) | — | — |

### Cells that need stating plainly

- **The composer is the only pathway that receives structured observations *and* whose output gates
  anything.** Pathway 3 is the reference implementation; every other live pathway is weaker, and
  `DRAFT_VALIDATION_GAPS` now says so in the response rather than leaving it implied.
- **Pathway 2 is the surface that offers Findings prose for a report and has no validation at
  all** — while pathway 1, which offers only an Impression to a ghost layer, now has one. The
  asymmetry points the wrong way. RW-24, decision D-8.
- **Pathway 6 still sends up to 6 unredacted patient images** for a study nobody has opened, on a
  trigger (80% progress on the *previous* study) that corresponds to no consent or workflow step.
  `DICOM_REDACTION_PERFORMED` is `false` (`lib/ai/dicomRedaction.ts:17`), so "unredacted" is the
  measured state. Decision D-11.
- **Pathway 7 is live, mounted, and ungated server-side.** It instructs the model not to change
  medical facts and returns the result. No comparison against the input. Its only client appears
  unmounted and unauthenticated — but that is a client property, and §39 is explicit that a
  client-side guard is not a server-side invariant.
- **Pathway 10 forces cloud.** `NeuroPromptPanel.tsx:190-214` is text-only with
  `provider: "gemini"`. Relevant to the operator's model-default setting.
- **Which provider actually runs in production is CANNOT VERIFY** on this box. It depends on
  `resolveLocalAiRuntime` and the clinic's settings rows. Runtime evidence required: read
  `ai_reporting_audit_logs.provider` for a recent row on the NAS.
- **`aiPipelineSelfTest.ts` is not the preload.** It is diagnostics-only. The real preload is
  pathway 6. The earlier AI-infrastructure audit conflated them; corrected here.
- **`composeEngine.ts:51-55` keeps a `@deprecated buildSystemPrompt` alive via
  `void buildSystemPrompt;`** — one of four code-vs-documentation disagreements found in this pass.

---

## Part 13 — Trace Scenario Results (§31)

Seven original scenarios plus Traces A–I. **Evidence for each hop.**

### Trace A — Patient → study → demographics → workspace

| Hop | Evidence | Verdict |
|---|---|---|
| Worklist row → `selectStudy` | `store.ts:847` resets `preloadTriggered`/`nextStudyPreloaded` | GREEN |
| Study → patient demography on screen | workspace store; unchanged by this branch | GREEN |
| Demography → quality engine | **was RED**; `resolveDraftDemography` in `reportQuality.ts` now resolves server-side, `buildWorkspaceQualityRequest` sends `sex`/`age` as fallback | **GREEN — fixed by `21021ff6`** |
| Engine → Q109 emits | `evaluate.demography.test.ts`, 13 cases, pass | GREEN |
| **Request-level end to end** | `reportQuality.demography.request.test.ts`, 8 cases | **CANNOT VERIFY — needs a DB** |

### Trace B — Clinical History → AI → final report

| Hop | Evidence | Verdict |
|---|---|---|
| History typed → store | workspace store | GREEN |
| History → **composer** prompt | `buildRadiologistDraftContext.ts:218-222` | GREEN |
| History → **Ctrl+I `/draft`** | `useTriggerAiImpression.ts:61-66` sends 4 fields; History is not one | **RED — decision D-7** |
| History → finalize payload | `useStudyFinalize.ts` (+144) | **GREEN — fixed by `6e921f04`** |
| History → stored signed row | `patient-reports.d8.test.ts`, 28 pass | GREEN |
| History → print / Word | `radiologyReportPrintLiveMerge.ts` +48, `radiologyReportWordExport.ts` +28, both via `storedReportBody.ts` | GREEN |
| **History → rendered PDF** | — | **CANNOT VERIFY — no `pdftotext`, no DB** |

### Trace C — Technique → finalization → stored signed artifact

Identical shape to Trace B, identical verdicts. Technique is additionally declared as a
`DRAFT_VALIDATION_GAPS` entry (`aiReporting.ts:846`) because the route admits it at `:846` but the
workspace never sends it. **RED at the AI hop, GREEN at every finalization and storage hop.**

### Trace D — Structured Finding → Findings → Impression

| Hop | Evidence | Verdict |
|---|---|---|
| Structured finding → ledger | `observationLedger.ts` (+56) | GREEN |
| Ledger → Findings prose | `fullReportFormat.ts:230` classifies template-sourced keys → `store.ts:1255-1258,1264` writes all five sections | GREEN, **but RR-12: the `source: "template"` classification makes hand-typed text auto-replaceable, across five sections at once** |
| Findings edit → Impression stales | **was RED**; `mergeField` now arms `impressionNeedsRefresh` | **GREEN — fixed by `df7e024b`** |
| Staleness → signer | `reportQualityFinalize.ts` (+40) | GREEN, **advisory** — `canConfirm` omits `unresolvedBlockers` |

### Trace E — Finding → Recommendation

| Hop | Evidence | Verdict |
|---|---|---|
| Finding → advice in ledger | `observationLedger.ts` | GREEN |
| Advice → FollowUpPanel | `FollowUpPanel.tsx` (+44) | **GREEN — fixed by `df7e024b`** |
| **Orphaned** advice → signer at finalize | finalize dialog | GREEN, deliberately not live in the banner (RW-08 narrower than proposed) |
| Advice → blocks signing | — | **YELLOW** — advisory. Decision D-1 |

### Trace F — Selected image → Composer → validation → proposal → acceptance → provenance

| Hop | Evidence | Verdict |
|---|---|---|
| Image selected → frozen key-image registry | composer snapshot | GREEN |
| Registry → prompt | `buildRadiologistDraftContext.ts:239-240` | GREEN |
| Output → `validateComposerOutput` | `jobService.ts:388-399` gates READY | GREEN |
| READY → proposal, **never auto-applied** | `useReportComposer.ts:330` | GREEN |
| Acceptance → `materializeAcceptedText` | `reportComposer/types.ts:345/355` skips non-`ACCEPTED`/`EDITED` | GREEN — **invariant 1's real carrier** |
| Provenance → job record | `jobService.ts:423` | GREEN |
| **Provenance → signed artifact** | `fieldProvenance` absent from the draft-save payload | **RED — RR-05** |

### Trace G — Ctrl+I `/draft` → validation → ghost text → acceptance

| Hop | Evidence | Verdict |
|---|---|---|
| Keystroke → request | `useTriggerAiImpression.ts:48-67` | GREEN |
| Study key captured **before** the await | `:56-59` | **GREEN — fixed by `9c010fe7` (RW-31)** |
| Server → `validateDraftGrounding` | `aiReporting.ts:1326-1336` | **GREEN — fixed by `1be8252b`** |
| Verdict → toast | `aiDraftValidation.ts` (+79); `:83-91` | GREEN |
| Response → ghost layer only | `:82` `setGhostText` → `store.ts:1086-1091` | GREEN |
| Acceptance → `mergeField(…, "ai-draft")` | `store.ts` | GREEN, **but RR-35: the label can invert** |
| Delayed answer after a study switch | refusal + toast; **string found in the shipped bundle** | **GREEN** |

### Trace H — Finalize → stored report → print/PDF/share/PACS

| Hop | Evidence | Verdict |
|---|---|---|
| Finalize → gate | `decideAiFinalizeGate` called at `useStudyFinalize.ts:214` | **GREEN — `9c010fe7`** |
| Gate → server | **nothing server-side refuses** | **RED — RR-37's server half** |
| Payload → stored row | `storedReportBody.ts`, 17 cases | **GREEN — `6e921f04`** |
| Stored row → print | `radiologyReportPrintLiveMerge.ts` reads the signed body | **GREEN** |
| Stored row → Word | `radiologyReportWordExport.ts` | GREEN |
| Stored row → **PDF bytes** | — | **CANNOT VERIFY** |
| Stored row → **share / PACS** | not touched by this branch | **CANNOT VERIFY — §26's actual Group F was never scoped as a group here** |
| Signer identity → stored | client-supplied | **RED — RR-03 (P0)** |

### Trace I — Study A → delayed async op → switch to Study B → no contamination

| Hop | Evidence | Verdict |
|---|---|---|
| Ctrl+I in flight → switch | `shouldApplyAsyncStudyKey` on both keys (`useTriggerAiImpression.ts:69-71`) | **GREEN — RW-31** |
| Draft hydration → wrong patient | `canHydrateDraftForPatient` (`radiologyWorkspaceSafety.ts:34-44`), gated in `useDraftPersistence.ts` (+29) | **GREEN** |
| Autosave → wrong study | `shouldCommitAutosave` compares study id **and** generation | GREEN |
| Undo stack → next patient | study-keyed; cleared on all three reset paths | **GREEN — `cd572ea1`, closes RR-06** |
| End-of-queue residual state | `clinicalStateReset.ts` clears all 65 fields | **GREEN — was 4 fields at base** |
| **All of the above end to end in a browser** | — | **CANNOT VERIFY — zero React render tests (RR-51), no DOM in the ERP test environment** |

### The seven original scenarios

All seven are re-run in audit §30.10 and §23. Summary: scenario E (§22) was the last open trace with
a live defect behind it and **is now closed** by RW-31. Scenario 11 (delayed Study A AI result on
Study B) went from **absent — and the defect live** to **fixed + 7 tests**. Scenarios 1, 9 and 10
were believed PARTIAL by an initial coverage survey and were found **already covered** — C-15
records that the survey was wrong on all three, and that treating it as a work list would have
produced three duplicate test files while burying the one live defect.

---

## Part 14 — Remaining Risks

Ordered by clinical consequence, not by severity label.

**R-1 (P0, three findings) — The signed artifact has no server-side integrity.** RR-01 (in-place
mutable, no audit row), RR-02 (critical flag clearable on a verified report), RR-03 (signer identity
caller-supplied). Group A fixed *what goes in* the signed body. Nothing prevents it being changed
*after*, and nothing verifies *who* signed. This is the single largest remaining clinical and
medico-legal exposure in the workspace, and it is entirely server-side.

**R-2 (P1) — Unrequested image egress on the next-study preload.** Reaching 80% on patient A pulls
up to 6 unredacted middle-slice JPEGs of **patient B** out of Orthanc and sends them to the resolved
provider, for a report nobody has started, with the result discarded. `warmUpOnly` closed the
stored-draft half only. The audit row that records the egress is the one row the fix deliberately
kept — so the egress is at least visible in `ai_reporting_audit_logs`. Fix is one condition on an
existing flag; it was not made because it changes what a shipped network call sends and **no test
in this repository observes egress**. Decision D-11.

**R-3 (P1) — The critical-finding channel can be permanently silenced by a formatting action.**
RW-27: `recomputeCopilot`'s guard is `!get().notification`, which conflates "a critical card is up"
with "anything occupies the single slot". The `ledger`/`edge-glow` kinds have no renderer and no
dismiss affordance below a `return null`, so one action disables the critical interrupt **and**
`startCriticalSla()` — the 15-minute escalation never begins, for every later patient in that tab.
Nothing is lost silently (the copilot sidebar still lists the item), but the interrupt and the SLA
are the two mechanisms the channel exists to carry. Decision D-10.

**R-4 (P1) — No durable record of a critical-results telephone call.** RW-28: the dialog says
*"Log the call for medico-legal record"* and writes nothing. `criticalSummary` appears in no
server package. The finalize gate does catch an unchecked box, so no unsigned critical can be
issued — but there is no record of who was telephoned, when, by whom. Decision D-10.

**R-5 (P1) — Hand-typed text can still be classified as machine text and overwritten.** RR-12,
chain verified live at head. `materializeAcceptedText` protects against *AI* overwriting; this path
is a *report format* overwriting text the ledger has classified as its own. Invariant 1 is GREEN
for AI and YELLOW for formats.

**R-6 (P2) — Provenance is screen-only.** RR-05 + RR-35 + RR-58 together: `fieldProvenance` never
reaches the draft payload, the `ai-draft`/`manual` labels can invert, and the panel that would show
the truth is mounted inside `className="hidden"`. A signed report cannot answer *"which sentences
were AI?"* from its own stored data.

**R-7 (P2) — `/query` offers Findings prose with no validation, and its "Insert Into Report"
button writes nothing while the audit log records that it did.** RW-24 + RW-25. Neither can
overwrite radiologist text. Both can make the record wrong. Decision D-8.

**R-8 (P2) — `POST /polish` is live and ungated server-side.** Its only client appears unmounted,
which is a client property. Nothing compares polished text against input for measurement or
laterality drift.

**R-9 (P3) — Two clinical merge guards have no test that can fail.** RW-33, measured by mutation:
deleting the laterality row or the spine-level row turns the whole ERP suite green. The behaviour is
correct. The tests that claim to prove it are not.

**R-10 (P3) — The verification gap itself.** 83 test files have never run here, CI has never run on
this branch, and there are zero React render tests (RR-51) in a workspace whose orchestrator is
3,357 lines. Everything in Part 11 and 13 marked CANNOT VERIFY is a consequence of one of those
three.

---

## Part 15 — Owner Decisions Required (§35)

Product and clinical decisions. **Kept separate from bugs that can be objectively fixed.** Format
per §35: Decision · Current behavior · Option A · Option B · Clinical consequence · Technical
consequence · Recommended technical default.

### D-1 — Should any quality finding hard-block a signature?

- **Current:** No. `canConfirm` (`FinalizeSignDialog.tsx:148-151`) is three terms — critical ack,
  signer, `compositionOk` — and does not include `unresolvedBlockers`; the structured-tier blockers
  render at `:201` under the literal heading *"Review before signing (does not block)"*;
  `reportValidator.ts:4-5` says *"WARN ONLY … it never blocks and never auto-corrects"*.
  `ARCHITECTURE.md §8.1` still describes a hard gate — `d3498ba1` corrected the *code* comments that
  agreed with it, and the architecture doc is still wrong.
- **Option A:** keep advisory. **Option B:** make a defined subset block.
- **Clinical:** A blocks a radiologist who has read the image and disagrees with a rule; B lets a
  rule with a false positive stop a report reaching a referring clinician.
- **Technical:** B needs `unresolvedBlockers` in `canConfirm`, a decision on *which* rules block,
  and an override path with attribution — otherwise the block gets worked around informally.
- **Recommended default:** **A, with the documentation fixed to say so.** No rule in this repo has
  a measured false-positive rate, and Q109's siblings have been unreachable until this branch.

### D-3 — Should "Copy findings" keep replacing the radiologist's Findings with no undo?

- **Current:** It does (RW-19). The false docstring was corrected; the semantics were left alone.
- **A:** keep, add a confirm. **B:** make it append or diff.
- **Clinical:** irreversible loss of authored text — RR-13 and RR-15 are the same family.
- **Technical:** a confirm is one `window.confirm`; the command-centre `/query` path already does
  exactly this and `aiQueryContract.test.ts` asserts the shape.
- **Recommended default:** **A with a confirm**, mirroring the pattern already in the codebase.

### D-4 — Should Q007 (required measurement missing) be wired, or deleted?

- **Current:** dead end to end. `text.missingRequiredMeasurements[]` has no producer (RW-21).
- **A:** compute the protocol-vs-report gap. **B:** delete the rule and its row in the matrix.
- **Clinical:** A catches a genuinely dangerous omission — a study reported without the measurement
  its protocol requires. B removes a rule that has never fired and that nobody has noticed missing.
- **Technical:** A is new computation against the protocol tables; B is a deletion plus a matrix row.
- **Recommended default:** **A**, but not in a remediation branch — it is new feature work.

### D-7 — Should Ctrl+I send Clinical History and Technique to `/draft`?

- **Current:** No. The client sends 4 fields; the server already reads `clinicalHistory`
  (`aiReporting.ts:1194-1209`) and admits `technique` (`:846`).
- **A:** send both. **B:** keep as is and keep declaring the technique gap.
- **Clinical:** A model writing an Impression without the Clinical History can produce prose that is
  internally coherent and clinically wrong for *this* patient. This is §15's whole subject.
- **Technical:** A is two fields on an existing request and would let `DRAFT_VALIDATION_GAPS` drop
  its third entry. It lengthens the prompt on a path that is already latency-sensitive at the
  keyboard, and `numCtx` may need revisiting.
- **Recommended default:** **A for Clinical History** (the server already reads it — this is a
  client omission, not a design choice), **B for Technique** until someone measures whether the
  radiologist wants Technique in an Impression prompt at all.

### D-8 — `POST /query` output, and the "Insert Into Report" flag

- **Current:** `/query` returns raw text with no validation (RW-24), and `DicomViewer`'s button
  labelled *"Insert Into Report"* sets two flags and moves no text (RW-25) — after which the AI
  audit log renders **"Yes"** for an insertion that never happened.
- **A:** relabel the button *"Mark as used"* and leave `/query` alone. **B:** parse-then-validate
  `/query` and make the flag require the paste to happen through the app.
- **Clinical:** neither can issue a wrong report. Both are about whether the record an auditor reads
  is true.
- **Technical:** B's `/query` half needs either a section parser or a section-agnostic grounding
  subset — `validateComposerOutput` is section-aware and does not apply unchanged. B's button half
  needs the insertion to be observable, which means routing the paste through the app.
- **Recommended default:** **A now** (a label change, no semantics), **B for the flag** only if the
  audit log is treated as a medico-legal record — which RR-01 and RR-03 suggest it currently is not.

### D-10 — The critical-finding channel needs three decisions at once

- **Current:** (i) three notification kinds declared, two with no renderer; (ii) a visible
  notification suppresses the critical interrupt **and** its SLA timer, permanently, for every
  later patient in the tab (RW-27); (iii) the "log the call for medico-legal record" dialog writes
  nothing (RW-28).
- **A (minimal):** scope `recomputeCopilot`'s guard to `kind === "interrupt"`, and relabel the
  dialog so it stops promising a record. **B (full):** delete the two rendererless kinds, give
  criticals their own slot, and make the call record durable.
- **Clinical:** A stops the permanent suppression and stops the false promise. B additionally
  produces the record a medico-legal inquiry would ask for — who was telephoned, when, by whom.
- **Technical:** A is a guard predicate and a string. B's durable half is a **schema change**, so a
  `migrations/*.sql` file, per the standing rule that `care-db-patch-v2` is the only thing that
  touches the clinic's database.
- **Recommended default:** **A immediately** — the suppression is a live defect with a one-line
  guard fix — **and B's schema half as its own PR** with an owner decision on what the record must
  contain.

### D-11 — Should the next-study warm-up send images?

- **Current:** Yes, up to 6, unredacted, for a study nobody has opened (R-2).
- **A:** condition the fetch on `!warmUpOnly`. **B:** keep it.
- **Clinical:** none for the next patient's report — the result is discarded. The consequence is
  privacy and medico-legal: patient B's images leave the server before anyone opens patient B, on a
  trigger no consent or workflow step corresponds to.
- **Technical:** A is one condition on an existing flag, strictly reducing, and removes the `numCtx`
  escalation at `:1276-1280` that exists only because 6-image payloads are ~6453 tokens — so the
  warm-up gets cheaper and less likely to time out. Cost: nothing observable, since no caller reads
  the response. B's only argument is that a vision warm-up warms more of the pipeline; whether the
  provider caches anything that would make this matter is **UNKNOWN** and undocumented in
  `lib/ai-providers`.
- **Recommended default:** **A.** It makes `warmUpOnly` mean what its name says.

### D-12 — What happens to the two audit documents?

- **Current:** the 2026-10-03 audit is untracked; this delivery report is untracked. One
  `git clean -fd` loses both.
- **A:** commit both to a docs-only branch and open a second PR. **B:** leave them local.
- **Clinical:** none directly. But a remediation whose audit trail exists only in one working copy
  cannot be re-audited, which is what §30 exists to allow.
- **Technical:** A keeps them out of this PR, satisfying "no unrelated changes riding inside a PR".
- **Recommended default:** **A**, as a separate `docs/` PR against `main`, opened after this one.

---

## Part 16 — Deferred Items, with reasons

| Item | Reason |
|---|---|
| **RR-01, RR-02, RR-03 (all P0)** | Server-side schema and authorization. Outside a client-isolation group's reach, and RR-01/RR-02 need `migrations/*.sql`. |
| **RW-23's image-egress half (R-2)** | Changes what a shipped network call sends; no test in this repo observes egress, so it could not be proven either way. Decision D-11. |
| **RW-24, RW-25** | Semantics decisions, not bugs. D-8. |
| **RW-27, RW-28** | Three coupled decisions; the durable half is a schema change. D-10. |
| **RW-33** | Deleting the two unproven guard rows would be a behaviour change no test can detect either way — the one thing a test-hardening group is not entitled to do. |
| **RW-21 / Q007** | New feature work (protocol-vs-report gap computation). D-4. |
| **`ARCHITECTURE.md §8.1`** | Still describes a hard quality gate. `d3498ba1` corrected the code comments; the architecture doc is a separate document with its own review path. |
| **#71 — measured egress manifest** | Pre-existing deferred item. Replaces the boolean `anonymized` audit column with a measured manifest. Needs `migrations/*.sql`. |
| **`clinicalStateReset.hardening.test.ts:217-219`** | Carries a stale comment — *"24 existing tests assert `undoLastPatch()).toBe(true)`"* — where the measured figure is **20 across 17 files** (C-14 corrected the number in the audit but not in this test comment). Cosmetic; not worth a commit on its own. |
| **`pnpm build` monorepo failure** | `@workspace/diagno-booking-mobile` needs `REPLIT_INTERNAL_APP_DOMAIN` / `EXPO_PUBLIC_DOMAIN`. Pre-existing, unrelated, 0 files touched in that package. |

---

## Part 17 — Regression Risk

**Measured: zero.** The evidence, not the assertion:

| Check | Result |
|---|---|
| Whole-repo suite, base vs head, identical invocation | +6 test files, +145 tests, **failing-file diff 1 / 0**, the 1 being this branch's own DB-gated file failing at import like the 82 pre-existing ones |
| Test-level failures | **the identical 7 files on both revisions**, all Windows/CRLF/no-DB artifacts |
| Typecheck | all 5 packages clean at head |
| Grounding check | 105 claims, all `✓` |
| Production build (api-server + ERP) | exit 0 both |
| MRI sub-master source files in the diff | **0** (§25 held) |
| Bundle strings | all three new user-facing strings present in the shipped chunk |

**Where the residual risk actually sits,** since a clean diff is not the same as no risk:

1. **The DB-gated surface.** Group B's entire request-level proof (8 cases) has never executed
   anywhere. If `resolveDraftDemography` has a bug that only appears against real rows, nothing so
   far would have caught it. Push and read CI.
2. **`store.ts` (+81).** The Zustand store is a module-scope singleton with three reset paths. Group
   D and Group E both change what it clears. 23 cases cover the reset; none of them run in a DOM.
3. **`useStudyFinalize.ts` (+144 across three groups).** The single file where Groups A, D and E all
   land. Its hook body is still untestable here (RR-51) — which is exactly why the gate was
   extracted into `aiFinalizeGate.ts` to be tested at all.
4. **`radiologyReportPrintLiveMerge.ts`.** Changing print from a live overlay to the signed body is
   correct and is what invariant 10 demands, but **it changes what an existing printout shows** for
   any study signed before this branch. Those studies have no stored signed body containing History
   or Technique, because none was ever stored. The fallback behaviour for a legacy row is covered by
   `storedReportBody.test.ts` but not against real legacy data.

**Rollback:** `git revert` the eight commits, or simply do not merge. No schema was changed, so
there is nothing to roll back in the database. That is a deliberate consequence of §27.

---

## Part 18 — Recommended Next Phase

In order, with the reason for the order.

**Phase 1 — Close the verification gap before anything else.** Push this branch and read the CI
run. Until 83 DB-gated files execute, Part 9's "zero regressions" is a statement about this
machine, and Group B's request-level proof is a claim. This is free, it is the highest-value action
available, and every later phase depends on trusting the baseline. Then deploy to the NAS — nothing
from #799–#814 or this branch is live at the clinic.

**Phase 2 — The three P0s, as one server-side PR.** RR-01 (signed report immutability + mutation
audit row), RR-02 (critical flag not clearable on a verified report), RR-03 (signer identity derived
server-side from the session, not supplied by the client). All three need `migrations/*.sql` files.
All three are prerequisite to invariant 9 being GREEN rather than partially GREEN. **They should be
one PR because they are one property** — "the signed artifact is trustworthy" — and splitting them
produces three intermediate states where the artifact is trustworthy in some respects and not
others, which is worse than either endpoint.

**Phase 3 — RW-27's one-line guard.** Scoping `recomputeCopilot`'s guard to `kind === "interrupt"`
stops a formatting action from permanently disabling critical interrupts and their SLA timer. It is
small, it is a live defect, and it should not wait for the rest of D-10.

**Phase 4 — Provenance that survives signing.** RR-05 + RR-35 + RR-58 as one piece: put
`fieldProvenance` in the draft-save payload, fix the label inversion, and unhide the panel. Until
then a signed report cannot answer *"which sentences were AI?"* from its own data — and that
question is the one an auditor, or a family, will ask.

**Phase 5 — Egress honesty.** Decision D-11 (the warm-up's images) plus the deferred #71 (a measured
egress manifest replacing the boolean `anonymized` column). Both are about the audit log saying
what actually happened. `DICOM_REDACTION_PERFORMED = false` is now recorded honestly; the manifest
would make it specific.

**Phase 6 — A DOM test environment.** RR-51 is the root cause of RW-32, of the extracted gate, and
of every CANNOT VERIFY in Part 13 that involves a hook. One `environment: "jsdom"` vitest project
for the ERP would make the orchestrator's 3,357 lines testable and would have made several findings
in this programme unnecessary to find by reading.

---

# Appendix A — Duplicate Sources of Truth (§34)

For each: canonical source · secondary representation · synchronization mechanism · can they
diverge · can the duplicate safely be removed. **"Do NOT remove duplicates merely to reduce a
count… The goal is no ambiguous clinical authority."**

| # | Canonical | Secondary | Sync | Divergence possible? | Safe to remove? |
|---|---|---|---|---|---|
| 1 | **Zustand workspace store** — report body, History, Technique, Impression | `radiology_report_drafts` row | `useDraftPersistence` autosave | **Yes** — RR-28: autosave ignores finalizing/lock state and drops non-transient failures | **No.** The draft is the recovery path. Fix RR-28 instead |
| 2 | **`storedReportBody.ts`** — the signed body | print renderer, Word export | both call the builder | **No, after `6e921f04`.** Before it, yes — that was RW-01 and RR-19 | **Already done.** This is what Group A removed: three assemblers became one |
| 3 | **Server-resolved demography** (`resolveDraftDemography`) | client `buildWorkspaceQualityRequest` | client is a **fallback**; server overrides | **No** — precedence is explicit | **No.** The client fallback covers a draft with no patient row yet |
| 4 | **`emptyClinicalState()` via `clinicalStateReset.ts`** | — | one function, three call sites | **No, after `cd572ea1`.** Before it, yes — three hand-maintained lists of 65 / 16 / 4 fields | **Already done.** This is what Group E removed |
| 5 | **`fieldProvenance` in the store** | nothing durable | none | **Yes, always** — it never reaches the draft payload | **No, and this is the wrong direction.** The *secondary* is what is missing (RR-05). Provenance must gain a durable representation, not lose its live one |
| 6 | **Critical terms: `CRITICAL_TERMS` in `criticalResults.ts:33-177` (108)** | `CRITICAL_KEYWORDS` in `criticalFindingsAlert.ts:124-135` (10) | none | **Yes** — RR-41, and the 10-term list guards a route with no ERP caller | **Yes — the 10-term list.** It is the smaller, the unused one, and having two lists means neither is authoritative |
| 7 | **`notification` slot (one)** | three declared kinds | `recomputeCopilot`'s `!get().notification` | **Yes** — RW-27. Two kinds have no renderer, so they occupy the slot invisibly | **Yes — the two rendererless kinds**, or give them a renderer. What must not stand is a message produced into a void while blocking a critical interrupt |
| 8 | **Composer job record (`validationJson` incl. `provenance`)** | signed artifact | none | **Yes** — the strongest provenance in the system does not reach the document it describes | **No.** Both are needed; the gap is a missing link, not a duplicate |
| 9 | **Six nav lists, three shortcut definitions, two undo-depth constants** (RR-54) | — | none | **Yes** | **Yes**, but it is P4 and cosmetic-adjacent — §28 forbids scope creep into it from a clinical-safety branch |
| 10 | **Drizzle schema (201 `.references(`)** | SQL migrations (133 `REFERENCES`) | `db:push` locally, migrations in production | **Yes** — RR-08/RR-48/RR-49. `uidUq` is declared and no migration creates it | **No — this is the most dangerous duplicate in the repository**, because the two are believed to be one. It needs a live-DB reconciliation (U-8), not a removal |

**Verdict:** two duplicates were removed by this work (#2, #4), and both were clinical-authority
ambiguities rather than counts. Three more are safely removable (#6, #7, #9) and none was touched,
because each needs an owner decision first. **No new duplicate source of clinical truth was
introduced** — invariant 15.

---

# Appendix B — The Fifteen Non-Negotiable Clinical Invariants (§38)

| # | Invariant | Verdict | Evidence |
|---|---|---|---|
| 1 | Manual text cannot be silently overwritten by AI | **GREEN for AI, YELLOW for formats** | `materializeAcceptedText` (`reportComposer/types.ts:345/355`) skips non-`ACCEPTED`/`EDITED`; `preDeploySafety.test.ts:56`. **But RR-12's chain is live and wider than the register recorded:** `observationLedger.ts:449` → `fullReportFormat.ts:230` → `:241` ("Safe auto-replace: … template …") → `store.ts:1255-1258,1264`, five `replaceProvenance: true` writes covering technique, findings, impression, recommendation and clinicalHistory |
| 2 | AI stays proposal-based | **GREEN** | Ctrl+I writes a ghost layer only (`useTriggerAiImpression.ts:82`); composer never auto-applies on READY (`useReportComposer.ts:330`); `AiDraftPanel.tsx:25,88-98` "Accept stages; never inserts". Qualified by RW-24/RW-25, which are honesty risks not overwrite risks |
| 3 | Measurements preserved | **GREEN, now tested** | RW-34 fixed: §17's own canonical example (`8.7 mm` → `8 mm`) had a guard and **no test anywhere**; `reportFieldMerge.test.ts` +6 now covers it |
| 4 | Laterality preserved | **YELLOW** | Merge-level (`reportFieldMerge.test.ts:75`) and AI-level (`aiDraftValidation.test.ts:52`) covered. **But RW-33: deleting the laterality guard row turns the suite green**, and RR-24 (emission without selection) is open |
| 5 | No patient/study leak across worklists | **GREEN client-side, CANNOT VERIFY in a browser** | `cd572ea1` + `9c010fe7`; Trace I is GREEN at every hop this box can reach. Zero React render tests (RR-51) |
| 6 | Clinical History does not disappear at signing | **GREEN** | `6e921f04`; `storedReportBody.test.ts` (17), `patient-reports.d8.test.ts` (28). PDF bytes **CANNOT VERIFY** |
| 7 | Technique does not disappear at signing | **GREEN** | same evidence as 6 |
| 8 | Findings/Impression/Recommendation have detectable consistency/staleness | **GREEN, advisory** | `df7e024b`; `mergeField` arms `impressionNeedsRefresh`; `observationPersistence.hardening.test.ts` +23. **Detectable ≠ blocking** — D-1 |
| 9 | The signed stored artifact represents what was intended | **GREEN for the body, RED for the signer** | Body: `storedReportBody.ts`. Signer: RR-03 (P0), caller-supplied; RR-21, client PDF substitutes a default name |
| 10 | Print/PDF/share do not substitute later live text | **GREEN for print and Word, CANNOT VERIFY for share/PACS** | `radiologyReportPrintLiveMerge.ts` +48 reads the signed body. Share and PACS were never scoped as a group — Appendix D |
| 11 | Quality rules get their data or are documented unreachable | **GREEN** | Demography now reaches the engine (`evaluate.demography.test.ts`, 13 cases named for Q109). The 19 structured rules are **documented unreachable** in audit §30.5, with Q007 named as dead end to end |
| 12 | The fast AI Draft path does not masquerade as equivalently validated | **GREEN** | `blocking: false` (`aiReporting.ts:893`) plus `DRAFT_VALIDATION_GAPS` (`:843-847`) declaring all three structural gaps **in the response** |
| 13 | Existing provenance / manual-text protection intact | **GREEN — nothing was weakened** | `materializeAcceptedText` untouched; `preDeploySafety.test.ts` still passes. **But provenance was already screen-only (RR-05) and still is** |
| 14 | Existing MRI sub-master infrastructure intact | **GREEN** | 0 sub-master source files in the 40-file diff; `mriDorsoLumbarCanvas.test.ts` extended (+40) with its 12 pre-existing cases passing; 0 regressions repo-wide |
| 15 | No new parallel source of clinical truth | **GREEN** | Two duplicates *removed* (Appendix A #2, #4). `aiFinalizeGate.ts`, `storedReportBody.ts`, `clinicalStateReset.ts`, `aiDraftValidation.ts` and `draftPromptSafety.ts` are all extractions or single-consumer builders, not parallel stores. `validateDraftGrounding` **calls** `validateComposerOutput` rather than reimplementing it |

**Summary: 10 GREEN, 3 YELLOW, 1 GREEN/RED split, 1 GREEN-with-CANNOT-VERIFY. Zero invariants
weakened by this work.**

---

# Appendix C — CANNOT VERIFY Register (§39)

*"When uncertain, mark it UNKNOWN/CANNOT VERIFY and state exactly what runtime evidence is
required. Do not guess."*

| # | Claim | Why it cannot be verified here | Exact runtime evidence required |
|---|---|---|---|
| U-1 | The signed PDF shows Clinical History and Technique | No `pdftotext` binary; no DB to sign against | Sign one study on the NAS, download the PDF, confirm both headings and their text |
| U-2 | Group B's demography resolution works against real rows | 8 cases in a file that cannot collect without `DATABASE_URL` | Push the branch; read the CI run's `reportQuality.demography.request.test.ts` result |
| U-3 | Zero regressions against a real database | 83 of 812 test files never execute here | Same CI run — all 83 files |
| U-4 | No contamination end to end in a browser | Zero React render tests; `environment: "node"` | Manual: open Study A, fire Ctrl+I, switch to B before it returns, confirm the refusal toast |
| U-5 | RR-29 — opening a study creates a server draft with no action | Needs a network observation | Open a spine study, touch nothing, watch for `POST …/save-draft` |
| U-6 | Which AI provider runs in production | Depends on `resolveLocalAiRuntime` and clinic settings rows | `SELECT provider, model, count(*) FROM ai_reporting_audit_logs GROUP BY 1,2` on the NAS |
| U-7 | Pathway 5's legacy `onInsertText` binding (`AiDraftPanel.tsx:95-98`) | Cannot establish whether it is reachable | Browser: open the AI draft panel, accept a stage, observe whether text is inserted |
| U-8 | RR-48's superuser half — whether production actually has the 201 declared FKs | Needs a live DB | `\d+ radiology_worklist` and a `pg_constraint` count on the NAS |
| U-9 | Share and PACS output read the signed body | Never in scope — Appendix D | Trace a shared link and a PACS-relevant export for one signed study |
| U-10 | RR-13's exact count of overwrite-without-confirm paths | Verified 3, the register says five; least confident row in Part 10 | One browser session enumerating every insertion affordance |
| U-11 | Whether the voice polish provider runs locally or in cloud | `ai.ts:269/302-315/348` resolves at runtime | Same query as U-6, filtered to `report_enhancement` |

**Nothing in Part 11, Part 12 or Part 13 is marked GREEN on the strength of an inference.** Where a
hop could not be observed it is marked CANNOT VERIFY above, and the corresponding matrix cell says
so.

---

# Appendix D — The Group F Naming Collision, disclosed

§26 defines six implementation groups. Its **Group F is "downstream rendering (print, PDF, share,
PACS)"**. This branch used the label **"Group F"** for the failure-mode and journey test group —
§23 and §24 material — and committed it as `9c010fe7` with that name in its body.

**The consequence, stated plainly:** the spec's actual Group F was **never executed as a group**.
Its work was done, but distributed:

| §26 Group F scope | Where it actually landed | Status |
|---|---|---|
| Print | Group A — `radiologyReportPrintLiveMerge.ts` +48, reading `storedReportBody.ts` | **done** |
| PDF | Group A — same builder; `radiologyReportWordExport.ts` +28 | **done at the body level; rendered bytes CANNOT VERIFY (U-1)** |
| Share | — | **never scoped, never touched. U-9** |
| PACS | — | **never scoped, never touched. U-9** |

So two of the four downstream surfaces — **share and PACS — were not examined at all** by this
remediation. Trace H's last rows are CANNOT VERIFY for exactly that reason, and invariant 10 is
GREEN for print and Word only.

**Why it happened and why it is reported rather than quietly relabelled:** the branch's group
labels were assigned while working through §23/§24 test material and the collision was not noticed
until the spec was re-read verbatim for this delivery. Relabelling the commit now would require a
history rewrite on a branch whose commit messages are cited throughout the audit document. The
mismatch is recorded here, in Part 3's heading for that commit, and in Part 18's Phase 1 note that
share/PACS remain unexamined.

**Recommended correction:** treat share and PACS as their own scoped phase, after Phase 1. They are
the two surfaces where a signed report leaves the system entirely, which makes them the two where
invariant 10 matters most and the two this delivery can say least about.

---

## Closing statement

The spec's closing instruction was: *"Audit first. Reuse existing architecture. Implement carefully.
Test clinically dangerous failure modes. Then reopen the original audits and prove what was actually
fixed. Do not merge automatically."*

All five were done. The audits were reopened and re-read, not recalled: 48 untouched register
findings were re-verified against head and **every one is still present**; seven of them had
citations that did not survive being opened, and all seven corrections are recorded (C-21) rather
than silently applied. The arithmetic in the audit's own totals was wrong by three and is corrected
(C-20). Two of this pass's own mutation tests were vacuous and are recorded as such (C-16, RW-33).
And **five citations in the first draft of this very document were wrong** — four of them inherited
from delegated search, one a mis-count — corrected in Part 10's disclosure table, two of them in the
direction that made a finding look smaller than it is.

**Not merged. Not pushed. Not deployed.** The branch is ready and the commands are in Part 2. Per
§39, where this delivery cannot prove a claim it says CANNOT VERIFY and names the evidence that
would settle it — eleven such claims, in Appendix C.

**22 of 98 findings closed. 74 open, including all three P0s.**
