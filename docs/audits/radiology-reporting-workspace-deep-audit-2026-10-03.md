# Radiology Reporting Workspace — Deep Architecture, Clinical Workflow, Data-Flow and AI-Wiring Audit

**Date:** 2026-10-03
**Scope:** the interactive reporting workspace used by the radiologist while reporting a study, and the in-workspace AI that assists that act.
**Mode:** the audit pass (§1–§29) was read-only — no fix was implemented, no PR was opened, no
file in `artifacts/`, `lib/`, or `db/` was modified during it. Remediation came afterwards and
is confined to **§30**; six groups (A–F, seven commits) sit on
`fix/reporting-workspace-end-to-end-integrity` and are **not merged into `origin/main`**, so
nothing in §30 is live in the clinic.
**Repository state at audit time:** branch `docs/dorsal-submaster-evidence`, head `9fcd2a83`,
working tree clean. `origin/main` head `bc8ca8c5` — still the base every remediation group
branches from, and the revision every "at base" citation in §30 refers to.

> **§1–§29 are the as-found record of that read-only pass and have deliberately not been
> rewritten.** What changed afterwards is in **§30**, a delta on §24's register; register
> entries that remediation has closed carry a `**Status:**` line pointing at the subsection
> that proves it. The narrative sections — §8's chain table, §15.2's rule pairs, §22's
> failure-mode catalogue, §25's wiring matrices, §26's verdicts — still describe the pre-fix
> state. Read them against §30.
>
> **Exceptions**, where leaving the original text unannotated would state something now known
> to be false rather than merely incomplete: §2.2's *"exactly two reset paths"* (there are
> three — C-11), §20.3's coverage gap and §20.4's two test rows (closed for this one
> intersection), §22's scenarios **D**, **E** and **F** (each carries a re-run blockquote), §23's
> status table (RR-06 and RR-20 now read **FIXED**; RR-37's row records that its client half is
> proven while the finding stays open), §25's matrices (banner above them; two rows
> struck through) and §26's verdict **G** and recommendation **3**. Each is a marked blockquote,
> a struck-through cell or an appended note; none rewrites the finding it qualifies.

---

## 0. How to read this document

### 0.1 Relationship to the 2026-09-30 audit

A thorough workspace audit already exists at
`docs/audits/radiology-reporting-workspace-deep-audit-2026-09-30.md` — 635 lines, 64
numbered findings (RR-01 … RR-64), 3 P0 / 19 P1 / 20 P2 / 17 P3 / 5 P4.

This document does **not** restate it. It does three things:

1. **Re-verifies** the RR findings that this audit's remit touches, and records which are
   still true, which have been fixed since, and which were over- or under-stated (§23).
2. **Adds new findings** that the prior audit did not carry. These are numbered
   `RW-01 … RW-14` and are each independently verified against source in this pass (§24).
3. **Answers the specific questions** this audit was asked — the AI-context matrix (§12),
   the impression-source question (§9), the clinical safety failure-mode catalogue (§19),
   the test-coverage position (§20), the seven trace scenarios (§22), the wiring matrix
   (§25) and the verdict A–J (§26).

Where an RR finding already says it, this document says "RR-nn" and moves on. Duplication
would only make the register harder to act on.

### 0.2 Evidence standard

Every finding below was confirmed by reading the cited lines in this pass. Nothing is
carried forward from a subagent report, a component name, or a plausible inference without
a read. Where I could not confirm something, it is marked **UNKNOWN** with the reason and
the runtime test that would settle it (§27). Where I changed my mind mid-audit, that is
recorded rather than quietly edited away (§28).

Severity is a **proposal**, on the basis stated in §21, so it can be re-rated without
re-deriving the mechanism.

### 0.3 The five separations this document refuses to collapse

| Distinction | Why it matters here |
|---|---|
| **Visible in UI** vs **sent to AI** | The single most common false conclusion in AI-wiring audits. §12 answers this per field, with code. |
| **Rule exists** vs **rule can fire** | CARE has more safety rules built than it has wired. §15 and RW-04 are both instances. |
| **Draft artifact** vs **signed artifact** | Two different documents are produced from the same screen. RW-01. |
| **Client gate** vs **server gate** | A client gate is a reminder, not a control. §17. |
| **Silent overwrite** vs **proposal** | The most feared failure mode. §14 — and the answer is genuinely reassuring. |

---

## 1. EXECUTIVE SUMMARY

**The workspace is one coherent clinical product, and the authoring layer is good.** Study →
demography → history → technique → findings → impression → recommendation → validate → sign
is a real chain, traversed by real code, with a sentence-level observation ledger, per-field
provenance, level-based spine logic, laterality slots, and autosave identity guards that are
the strongest isolation code in the client. None of that should be rebuilt.

**Three things break the chain, and they are all at the last metre.**

**1. The signed report is not the report the radiologist saw. (RW-01, P1)**
Technique and Clinical History are authored, stored in the draft, rendered in the on-screen
preview — and then dropped at sign-off. The finalize payload builds a three-section HTML
body (Findings, Impression, Recommendation) and the lifecycle layer documents that it is
stored **verbatim**. Every downstream consumer — print, PDF, public link, WhatsApp, email,
PACS archive — reads that stored body. The structured-read path that could have restored the
missing sections is flag-gated **off by default**. So a referring doctor receives a report
with no Technique and no Clinical History, while the radiologist who signed it saw both.
This is a medico-legal exposure, not a cosmetic one: Technique is what makes a study
interpretable, and Clinical History is what makes the impression defensible.

**2. A built safety rule that cannot fire. (RW-04, P1)**
The canonical quality engine has a catalogued, implemented, unit-tested rule — **Q109,
gender/anatomy contradiction** — that catches a male patient's report mentioning a uterus, or
a female patient's mentioning a prostate. The workspace's request builder does not send
`sex`. The evaluate route does not look the patient up. Therefore Q109 is unreachable from
the only production caller. The same starvation disables the client validator's
laterality-vs-study-description and gender rules at both UI call sites. This is the cheapest
high-value fix in the entire audit: the demography is already in the store, three lines from
the call site.

**3. Undo can cross patients. (RR-06, re-verified, P1)**
The clinical undo snapshot carries no study identifier and the restore performs no study
check. The partial study-switch reset clears the five narrative texts but **not** the undo
stack, the ledger, or the measurements. Reachable today by browser Back/Forward, a deep
link, or by `selectStudy` silently no-oping on an id absent from `store.studies`. Ctrl+Shift+Z
after a study switch can insert Patient A's sentence into Patient B's Findings.

**What is NOT wrong, said plainly, because it is the most important negative result in this
audit:** there is **no pathway in which the AI silently overwrites radiologist text.** Every
AI route in the workspace lands as ghost text requiring explicit accept, or as a provenance-
tracked merge that preserves manual sentences, or behind a dialog with an undo snapshot.
Server AI is strictly proposal-only. Measurements survive merges via `CLINICAL_GUARDS`. The
stale-impression gate genuinely hard-blocks signing. The D5 structured finalize is correctly
designed with an equivalence abort. The autosave generation counters and patient-match
refusals are careful, deliberate engineering. The prior audit's RR-36 — Ctrl+I dropping the
doctor's findings — **is fixed** and verified fixed (§23).

**The smallest coherent set of fixes** is four items, in §26.J. Three are single-file and
under twenty lines. None requires a schema change, a rewrite, or a new subsystem.

---

## 2. FILE INVENTORY AND ARCHITECTURE MAP

### 2.1 Layer map

```
UI LAYER  artifacts/diagnostic-erp/src/components/radiology/workspace/
  WorkspaceShell.tsx        top-level cockpit; subscribes to chrome state only
  ReportCanvas.tsx          findings/impression/recommendation editors + GhostLayer
  ReportingToolsRail.tsx    formats, templates, macros, quick findings
  WorklistPanel.tsx         study queue, next/prev
  ViewerColumn.tsx          OHIF/Weasis launch, viewer measurements
  WorkspaceOverlays.tsx     finalize dialog, merge preview, AI pending gate
  WorkspaceTopBar.tsx / WorkspaceFooter.tsx   status, dirty, autosave chrome
  components/radiology/zai-workspace/
  finalize-dialog.tsx       composition gate consumer
  quick-select-strip.tsx    tile insertion -> mergeField(field, sentence, "quick-select")

ORCHESTRATION  artifacts/diagnostic-erp/src/hooks/radiology-workspace/
  useWorkspaceClinicalUi.tsx   ~3,357 lines; the workspace view-model
  useDraftPersistence.ts       hydrate / autosave / dirty-leave / navigation refs
  useStudyFinalize.ts          the finalize gauntlet (366 lines)
  useVoiceReporting.ts         dictation -> mergeField
  useTriggerAiImpression.ts    Ctrl+I (63 lines)
  useWorkspaceCommands.ts      keyboard bindings
  useWorkspaceExportShare.ts   print/preview/Word/PDF/share
  useOhifViewerBridge.ts       viewer measurement ingest

STATE  artifacts/diagnostic-erp/src/lib/zai-workspace/
  store.ts                  Zustand module-scope singleton (~2,760 lines)
  clinicalUndo.ts           PatchSnapshot stack, depth 5
  workspaceClinicalTexts.ts debounced mirror for chrome (NOT for persistence)

DOMAIN  artifacts/diagnostic-erp/src/lib/
  observationLedger.ts      ledger, staleness, finalize gate
  reportFieldMerge.ts       provenance-aware sentence merge, CLINICAL_GUARDS
  formatSlotMerge.ts        slot-level format merge
  observationSlot.ts        region|concept|level|laterality identity
  reportValidator.ts        legacy client warn-only validator
  generateLocalImpression.ts  non-AI impression synthesis
  impressionRecommendationWiring.ts  additive recommendation alignment
  reportQualityFinalize.ts  canonical quality request builder
  reportQualityShadow.ts    parity logger (imported, never called — RW-11)
  mri{Brain,Spine}Contradictions.ts, xray{Cervical,Chest,Ls}Contradictions.ts
  radiologyReportLifecycle.ts  finalize -> POST /api/patient-reports

API  artifacts/api-server/src/routes/
  patient-reports.ts        create / PATCH / print / pdf / share; ~2,600+ lines
  aiReporting.ts            /query /draft /polish /image-review /previous-reports /compare
  reportQuality.ts          POST /evaluate -> canonical engine
  radiology-report-generator.ts  draft CRUD, validate-draft, print-preview
  internal-radiology.ts, internal-reporting-studio.ts  key-authenticated siblings

SHARED  lib/
  report-quality/           canonical rule catalog Q101-Q115 + text/evaluate.ts
  ai-providers/             provider adapters
  db/                       Drizzle schema of record
```

### 2.2 The single most important structural fact

`useWorkspace` is a **module-scope Zustand singleton** (`store.ts:2761`,
`create<WorkspaceStore>()`). It is not scoped to a route, a component, or a study. It
survives navigation and survives unmount. Every isolation property in the workspace is
therefore an *explicit act of code*, not a structural guarantee. This is the root cause
behind RR-06, RR-20, RW-06 and RW-07 — and it is also why the autosave guards (which do
treat isolation as an explicit act) are the best code in the client.

There are exactly **two** reset paths, and they are not equivalent:

> **CORRECTED — this is wrong, see C-11 and §30.9.** There are **three**. The third is
> `advanceToNextStudy`'s end-of-queue branch (`store.ts:1086` at base), which cleared **4** of
> the 61 clinical fields and fires on the normal end of a reporting session. The table below is
> retained as the record of what this pass measured; the field counts in it (65 / 16 / 4) were
> obtained by parsing each `set({...})` literal at `bc8ca8c5` during Group E, not estimated.
> All three paths now spread one shared `emptyClinicalState()` (`cd572ea1`).

| | FULL — `selectStudy` (`store.ts:847`) | PARTIAL — study effect (`useDraftPersistence.ts:157-187`) |
|---|---|---|
| Clears 5 narrative texts | ✓ | ✓ |
| Clears `fieldProvenance` | ✓ | ✓ |
| Clears `appliedPathologyPatches` | ✓ | **✗** |
| Clears `patchUndoStack` / `lastPatchSnapshot` | ✓ | **✗** |
| Clears `measurements` / `structuredViewerMeasurements` | ✓ | **✗** |
| Clears numbering / screening / vascularTechnique | ✓ | **✗** |
| Silently no-ops if id not in `store.studies` | ✓ (`if (!st) return;`) | n/a |

`openStudy` (`useWorkspaceClinicalUi.tsx:1864-1880`) takes the FULL path. The URL-sync
effect (`:2045-2051`) deliberately does not, with the comment *"Do NOT call selectStudy()
here — it wipes editor text / reportingContext and races draft hydration."* That comment is
correct about the race and is the reason the PARTIAL path exists. The defect is that the
PARTIAL path was written as a text-clear, not as a study-scoped clear.

---

## 3. REPORT STATE AND SOURCE OF TRUTH

### 3.1 Canonical state

The **live authored report** is the five narrative fields plus `fieldProvenance` plus
`appliedPathologyPatches` in the Zustand store. There is no second copy of the authored text
in React state — `workspaceClinicalTexts.ts` is an explicitly-documented *mirror* for chrome
only, and its own docstring forbids using it for persistence:

> *"Save / finalize / export must call `readWorkspaceClinicalTexts` — never rely on this hook
> for clinical persistence."* (`workspaceClinicalTexts.ts:54-61`)

That rule is **honoured** at every site I checked: `useStudyFinalize.ts:128` and `:236`
read the live store; `useWorkspaceExportShare.ts:216` calls `readWorkspaceClinicalTexts()`.

### 3.2 Duplicate sources of truth — register

| # | Duplicate pair | Status | Consequence |
|---|---|---|---|
| D-1 | Live store narrative **vs** `radiology_report_drafts` row | Reconciled by autosave with generation + patient guards | Low. Guards are real. |
| D-2 | Live store narrative **vs** `patient_reports.body` | **Divergent by construction** at sign-off | **RW-01.** Two sections exist only in the draft. |
| D-3 | `radiology_report_drafts.body` (legacy) **vs** `structured_json_d1` (D5) | Flag-gated; D5 off by default | RR-63. Legacy is what production serves. |
| D-4 | Client `reportValidator.ts` **vs** server `lib/report-quality` | Deliberate 1:1 mirror, both run at finalize | Acceptable — but see RW-04: the server copy is better-fed than the client copy and *neither* gets `sex`. |
| D-5 | `cloudPayloadPrivacy.ts` (live) **vs** `assertGatewayPrivacy` (dead) | **Two privacy policies, one wired** | **RW-10.** A privacy gate that exists but is not called is worse than one that was never written, because it reads as coverage. |
| D-6 | ~110 client critical phrases **vs** 10 server (`criticalFindingsAlert.ts:124-135`) | Server list only used by an unreached route | RR-41. |
| D-7 | `isFinalized` (session-only) **vs** `patient_reports.status` | Never rehydrated from server | RR-20. |
| D-8 | Six navigation lists, three shortcut definitions, two undo-depth constants | Cos duplication | RR-54. |

---

## 4. THE CLINICAL CHAIN, END TO END

Each transition is answered against the ten questions the audit was asked to apply
(what carries forward, what is dropped, what can go stale, what can cross patients, who is
the author of record, is it gated client- or server-side, is it reversible, is it audited,
what does the AI see, what does the signed artifact contain).

| Transition | Carries forward | Dropped / at risk | Gate | Author of record |
|---|---|---|---|---|
| **Study → Demography** | `workflow.currentRow` (patientId, accession, studyInstanceUID, modality, studyDescription, sex) | `sex` reaches the UI but **not** the quality engine (RW-04) | Server identity gate on `POST /api/patient-reports` when a study id is supplied (RR-04: the strong GREEN/APPROVED gate sits on `/api/radiology/studies/:id/final`, which the workspace does not call) | worklist row |
| **Demography → Clinical History** | `st.clinicalHistory` seeded by `selectStudy:847`; no-draft branch re-seeds history only (`useDraftPersistence.ts:332-343`) | History is **not** carried into the signed body (RW-01) | none | worklist / referring |
| **History → Technique** | `techniqueText`, `vascularTechnique`, `sequencesAvailable` | Technique **not** carried into the signed body (RW-01). `vascularTechnique` not cleared by the PARTIAL reset (RW-07) | `contrastDependencyWarning` is built and tested but **never called** (RW-12) | protocol / radiologist |
| **Technique → Findings** | full narrative; ledger patches; provenance | `mergeField` writes do not arm `impressionNeedsRefresh` (RW-05) | warn-only `validateReport`; `GhostLayer` hints capped at 5 | radiologist |
| **Findings → Impression** | see §9 | see §9 | `compositionFinalizeAllowed` — **hard-blocks** on stale impression | radiologist |
| **Impression → Recommendation** | `alignRecommendationToObservations` | **additive only** — obsolete recommendations are never removed (RW-08) | none | observation / chip |
| **Recommendation → Validation** | all five texts to `runFinalizeQualityEvaluation` | `sex`, `age` (RW-04); client `validateReport` gets 3 fields with impression as a 1-element array (RR-18, re-verified) | canonical engine, warn + block counts | — |
| **Validation → Final Report** | Findings, Impression, Recommendation | **Technique, Clinical History** (RW-01); provenance map (RR-05) | finalize dialog; AI-pending gate is client-only (RR-37) | `createdBy`/`actor` caller-supplied (RR-03) |
| **Final → PACS/ERP/callback/print/export** | `displayBody` | see §18 | `versionSafeguardHtml` banners are correct | — |

---

## 5. DEMOGRAPHY AND STUDY CONTEXT

`canonicalDemography` (patientName, age, sex, accessionNumber, referringDoctor, studyDate)
is resolved in the workspace and is consumed correctly by the export path
(`useWorkspaceExportShare.ts:169-174`). It is **not** consumed by the quality path.

Age/sex/modality/body-part mismatch detection:

| Check | Built? | Wired? | Evidence |
|---|---|---|---|
| Sex vs anatomy (prostate/uterus/ovary/endometrium/cervix/seminal vesicle) | ✓ Q109 | **✗** | `lib/report-quality/src/text/evaluate.ts:161-167` reads `report.sex`; `buildWorkspaceQualityRequest` (`reportQualityFinalize.ts:85-115`) has no `sex` param; `POST /evaluate` (`reportQuality.ts:238-251`) does no patient lookup. Client mirror at `reportValidator.ts:241-246` is starved identically at `useWorkspaceClinicalUi.tsx:2820` and `ReportCanvas.tsx:1361`. |
| Laterality vs study description | ✓ | **partial** | `reportValidator.ts:208-221` needs `studyDescription`; the server path **does** get it (`reportQualityFinalize.ts:101,110`); both client callers do not. |
| Age vs finding (e.g. paediatric wording on an adult) | ✗ | ✗ | No such rule exists in either validator. Not invented here — recorded as an absence. |
| Modality contamination (CT wording in an MRI report) | ✓ (modality-specific contradiction modules) | partial | Only for the 6 covered regions — see §15. |
| Body part vs study description | ✗ | ✗ | Absent. |

The `sex` field's own history is instructive and is already documented in the source: the
comment at `reportValidator.ts:236-240` records that a strict `=== "F"` check *"never
matches a real patient and this whole rule was silently dead"*, and was fixed to
`startsWith`. The fix was applied to the rule but not to the feed. **The rule was revived;
the wire was not.**

---

## 6. CLINICAL HISTORY

Seeded from `st.clinicalHistory` on the FULL reset (`store.ts:847`) and on the no-draft
branch (`useDraftPersistence.ts:332-343`). Restored from draft on hydration. Sent to
`/api/ai-reporting/query` when the caller supplies it (`aiReporting.ts:684,746-748`) and to
`/draft` (`:987,1111-1134`).

**Stale-leakage on Next / Previous / Park:** the PARTIAL reset (`useDraftPersistence.ts:157-187`)
**does** clear `clinicalHistoryText`. Its own comment states the intent exactly:
*"Clear zustand editor unconditionally — worklist navigate() does not call selectStudy, so
Patient A text must not linger on Patient B."* For the five texts, this is correct and works.
The leak is in everything the PARTIAL reset does **not** clear (RW-07).

Hydration additionally refuses wrong-patient drafts: `canHydrateDraftForPatient` blanks the
texts rather than adopting them (`useDraftPersistence.ts:213-227`), and the server returns
`DRAFT_PATIENT_MISMATCH` / `DRAFT_WORKLIST_MISMATCH`. This is good, deliberate design.

History does **not** reach the signed artifact (RW-01).

---

## 7. TECHNIQUE AS A FIRST-CLASS SECTION

Technique is first-class in the store, the editor, the ledger (`fieldProvenance.technique`),
the draft row, the print preview (`useWorkspaceExportShare.ts:151,177`), the institutional
style model (`sectionOrder: "Technique,Findings,Impression"`, `showClinicalHistory` at
`patient-reports.ts:2615-2616`), and the quality request
(`reportQualityFinalize.ts:90,107`).

It is **absent from the signed body** (RW-01). The renderer is handed one string —
`bodyHtml: displayBody` — with no separate technique field, so the style model's
`sectionOrder` and `showClinicalHistory` flags can only arrange sections that were never
supplied. The style configuration promises Technique; the payload does not deliver it.

`contrastDependencyWarning` (`mriSpineContradictions.ts:222`) — which would catch a
post-contrast claim on a non-contrast technique — is exported and unit-tested
(`mriSpineContradictions.test.ts:144-146`) and **never called from production code** (RW-12).
Technique is therefore not used as evidence against Findings anywhere in the live path.

`vascularTechnique` and `sequencesAvailable` are not cleared by the PARTIAL reset (RW-07).

---

## 8. FINDINGS PIPELINE

Order of operations, as actually executed:

```
1. Insertion       quick-select tile / macro / template / voice / companion measurement
                     -> mergeField(field, text, source)      [store.ts:915-947]
                     -> setField(field, text, {source})      [store.ts:847-914]
2. Merge           mergeReportFieldContentWithProvenance     [reportFieldMerge.ts]
                     CLINICAL_GUARDS protect measurements
                     subsequence merge; supersequence may REPLACE a kept sentence (RR-15)
3. Ledger          applyPathologyOverlay -> appliedPathologyPatches
                     slot identity region|concept|level|laterality  [observationSlot.ts]
                     lastRendered.{findings,impression,recommendation}
                     impressionNeedsRefresh = impressionNeedsRefreshFromNarrative(...)
                                                        [store.ts:1672]
4. Protection      after any manual/unset-source write, a sweep marks patches
                     protected when their contribution is missing, mutated, or
                     manual-owned                          [store.ts:885-905]
5. Provenance      reconcileProvenanceAfterManualEdit       [store.ts:863]
6. Re-derivation   recomputeCopilot() on a 0ms timeout      [store.ts:913,946]
```

Step 4 is well-designed and worth stating plainly: a patch whose rendered contribution has
been hand-edited is marked `protected`, so no subsequent automated pass will re-assert it.
That is exactly the right precedence and it is implemented at the store level where it
cannot be bypassed by a UI component.

**The gap is step 1 → step 3.** `mergeField` sets `isDirty`, the text and the provenance, and
then stops. It never touches `impressionNeedsRefresh`. Fourteen live callers write Findings
through it — voice (`useVoiceReporting.ts:174,326`), templates
(`ReportingToolsRail.tsx:1175`), protocols, companion measurements (`store.ts:1024,1032,1055,1075`),
structured templates (`useWorkspaceClinicalUi.tsx:1545`), quick-select
(`quick-select-strip.tsx:233`). `setField` arms the flag only when the source is `manual` or
absent (`store.ts:871-873`). So a dictated or chipped abnormal finding does **not** flag the
Impression stale, while a typed one does (RW-05).

---

## 9. IMPRESSION — THE CENTRAL QUESTION

**Question asked:** is the Impression generated from the *visible final Findings text*, or
from a different intermediate representation?

**Answer: it depends on which of the four generators produced it, and the honest summary is
"mostly yes, with two exceptions that matter."**

| Generator | Input | Is it the visible Findings text? | Evidence |
|---|---|---|---|
| **Observation ledger** (`applyPathologyOverlay`) | `result.narrative.impression` — the freshly rendered narrative, then `impressionNeedsRefreshFromNarrative(result.narrative.impression, nextPatches, provenance.impression)` | **YES** — derived from the narrative that is written to `impressionText` in the same `set()` | `store.ts:1663-1677` |
| **Draft hydration** | `narrativeFromState(get())` — the live store | **YES** | `store.ts:1940-1953` |
| **Local synthesis** (`generateLocalImpression`) | `get().findingsText` | **YES**, but lossy — see below | `store.ts:1805`; `useWorkspaceClinicalUi.tsx:1812,1843` |
| **Ctrl+I / AI** (`/api/ai-reporting/draft`) | `reportBody` — the client's `cur`, i.e. the live Findings | **YES** as to input; **NO** as to guarantee, because there is no post-await study guard | `useTriggerAiImpression.ts:26-31`; `aiReporting.ts:1003,1111-1134` |

**The two exceptions:**

**(a) `generateLocalImpression` truncates and can invert.** `.slice(0, 6)` at
`generateLocalImpression.ts:45,58,64` silently caps the Impression at six lines. A report
with nine abnormal findings produces a six-line Impression with no warning and no indicator.
Its `ABNORMAL_CUE_RE` (`:17-18`) is neuro/spine-centric — `fazekas`, `lacunar`,
`midline shift`, `desiccation`, `bulge`, `herniation` — with no abdominal, thoracic or
ultrasound vocabulary. The safety net is `isAbnormalFindingLine`'s final line,
`return s.length > 24;` (`:36`), which promotes any sentence longer than 24 characters that
does not start with "no" and does not contain "normal". That net catches most real prose, but
it means the promotion decision is substantially a *length* test, and a short pathological
sentence ("Cholelithiasis.", 15 chars) is dropped. When nothing qualifies, the fallback is the
literal string `"No significant abnormality detected."` (`:48,79`) — a positive assertion of
normality produced by a regex miss (RW-09).

**(b) Ctrl+I has no post-await study guard.** `useTriggerAiImpression.ts` awaits a network
call and then calls `setGhostText(res.impression, "impression")` unconditionally. If the
radiologist navigates to the next study while the request is in flight, the ghost text for
Patient A's impression is offered on Patient B's screen. It is **ghost text, not a write** —
acceptance is explicit — which is why this is P2 and not P1. But it is the only place in the
AI path where a study identity is not re-checked after an await.

**What is right, and should not be disturbed:** the staleness model. `impressionNeedsRefresh`
is derived from the narrative rather than stored as an independent boolean
(`store.ts:625` documents *"existing CARE semantics — no parallel boolean"*), and
`compositionFinalizeAllowed` (`observationLedger.ts:608-615`) genuinely hard-blocks signing
unless the impression was refreshed or explicitly acknowledged. The ownership-change action
arms it unconditionally with the comment *"Do not silently merge into Impression narrative —
set impressionNeedsRefresh instead"* (`store.ts:2230-2254`). That is the correct design
instinct: prefer flagging staleness over writing text.

**The gate's blind spot:** `compositionFinalizeAllowed` reads `impressionNeedsRefresh` only.
`collectCompositionFinalizeGate` computes `stalePatchCount` and `siblingWarnings`
(`observationLedger.ts:596-604`) and the dialog receives them — but stale patches and sibling
warnings never block, by explicit design (*"Sibling warnings never block"*). Combined with
RW-05, the consequence is that the hard gate covers ledger-derived staleness and does not
cover free-text-derived staleness.

---

## 10. RECOMMENDATION AS A DEPENDENT SECTION

`alignRecommendationToObservations` (`impressionRecommendationWiring.ts`, 117 lines) is
**strictly additive**: `if (patch.stale) continue;`, sentences are merged in, and there is no
removal path. Its own docstring states the design: *"When no observation owns a
recommendation, the box is left untouched."*

That is the right choice for the case it names — refusing to auto-delete a radiologist's
recommendation. It becomes a defect in the case it does not name: when the **finding** that
justified a recommendation is removed.

Three paths, only one of which is covered:

| Path | Finding removed by | Recommendation updated? | Signed? |
|---|---|---|---|
| A | ledger exclusion (`store.ts:2220-2258`) | ✓ patch marked `stale`, `impressionNeedsRefresh: true` armed, gate blocks | blocked until refreshed |
| B | **manual deletion of the Findings sentence** | **✗** `alignRecommendationToObservations` skips stale patches and never removes | **signs silently** |
| C | **recommendation inserted from a chip/template** (`ReportCanvas.tsx:1620,1887`, `ReportingToolsRail.tsx:586`) with no owning observation | **✗** by docstring design | **signs silently** |

The finalize gate checks `impressionNeedsRefresh` only, so neither B nor C is caught (RW-08).
A recommendation to "follow up in 3 months" surviving into a signed report whose Findings no
longer mention the lesion is a real clinical-consistency failure — a referring doctor acts on
the Recommendation, and it is the section least likely to be re-read against Findings.

---

## 11. THE BUILT-IN AI PIPELINE, ACTION BY ACTION

| Action | Trigger | Client site | Server route | Landing mechanism | Reversible |
|---|---|---|---|---|---|
| **Ctrl+I impression** | keyboard | `useTriggerAiImpression.ts:26-31` → `POST /api/ai-reporting/draft` | `aiReporting.ts:977-1134` | `setGhostText(res.impression, "impression")` — ghost layer, explicit accept | n/a (never written until accepted) |
| **Binding** | `useWorkspaceCommands.ts:241-244` | `if (e.ctrlKey && (e.key === "i" \|\| e.key === "I"))` | — | — | — |
| **Undo binding** | `useWorkspaceCommands.ts:236-241` | `if (e.ctrlKey && e.shiftKey && (e.key === "z" \|\| e.key === "Z"))` → `undoLastPatch()` | — | **blind restore, no study check** | RW-06 |
| **Free query / ask** | AI panel | `POST /api/ai-reporting/query` | `aiReporting.ts:651-790` | returned text; the caller decides | — |
| **Polish** | selection | `POST /api/ai-reporting/polish` | — | ghost / dialog | ✓ |
| **Image review** | viewer | `POST /api/ai-reporting/image-review` | — | proposal | ✓ |
| **Compare / priors** | panel | `POST /api/ai-reporting/previous-reports`, `/compare` | — | read-only display | n/a |
| **Egress preview** | settings/inspector | `POST /api/ai-reporting/egress-preview` | — | read-only | n/a |
| **Async report composer** | dialog | 202 + poll | `reportComposer.ts` | `parseComposerDraftJson` → `ComposerDraftOutputSchema.safeParse` → `validateComposerOutput`; hard errors `empty_output`, `unsupported_abnormality`, `impression_ungrounded`, measurement mutation, selected-image overclaim | ✓ `rejectAllPending()` awaited before the finalize bypass (`WorkspaceOverlays.tsx:573-577`) |
| **Voice composer** | dictation | `useVoiceReporting.ts` → `mergeField` | — | provenance-tracked merge | ✓ undo snapshot |

**Provider routing** (`aiReporting.ts:690-706`): explicit request provider wins; otherwise
the per-task route for `radiology_draft`; otherwise the global default. Model resolves the
same way. This is settings-driven, not hard-coded — which is what the operator asked for.

**Permission gates are real:** `globalSettings.enabled` (403), `canUse(sReq, allowedRoles)`
(403), provider `isEnabled` (400), and an empty effective prompt is a **400, never a silent
fall-through** — with a comment recording that the fall-through *"is exactly how the
workstation's findings used to get dropped without anyone noticing"* (`:708-745`). That is
the RR-36 fix, and it is properly fixed.

---

## 12. WHAT THE AI ACTUALLY SEES

Answered per field with code evidence. **"Visible in the UI" was not treated as evidence of
transmission.**

| Data | Sent to `/draft` (Ctrl+I)? | Sent to `/query`? | Sent to `/evaluate` (quality)? | Evidence |
|---|---|---|---|---|
| **Findings** | **YES** | **NO** | **YES** | `/draft`: `reportBody ?? findings` (`aiReporting.ts:1003`). `/query` destructures no findings field (`:673-688`). `/evaluate`: `text.findings` (`reportQualityFinalize.ts:104`). |
| **Impression** | **YES** | **NO** | **YES** (as a 1-element array) | `/draft`: `:986`. `/evaluate`: `:105`. |
| **Recommendation** | **NO** | **NO** | **YES** | `/draft` destructures no recommendation. `/evaluate`: `:106`. |
| **Technique** | **NO** | **NO** | **YES** | `/evaluate`: `:107`. |
| **Clinical History** | **YES** | **CONDITIONAL** — only if the caller supplies it | **YES** | `/draft`: `:987,1111-1134`. `/query`: `:746-748` appends it only when present. `/evaluate`: `:108`. |
| **Modality** | **YES** | **YES** (via study lookup) | **YES** | `/draft`: `:982`. `/evaluate`: `:100,109`. |
| **Study description** | **YES** | **YES** | **YES** | `/evaluate`: `:101,110`. |
| **Patient sex** | **NO** | **CONDITIONAL** — only when `includeDemographics && patientId && !shouldAnonymize` | **NO** | `/query`: `:751-766`. `/evaluate`: absent from the builder **and** absent from the route → **RW-04**. |
| **Patient age** | **NO** | **CONDITIONAL** (same) | **NO** | as above |
| **Patient name** | **NO** | **CONDITIONAL** (same) | **NO** | `:764-765` |
| **Measurements** | **NO** (only as text inside Findings) | **NO** | indirectly, via text | no structured measurement field on any of the three |
| **Observation ledger / patches** | **NO** | **NO** | **NO** | no ledger field in any request schema |
| **Provenance map** | **NO** | **NO** | **NO** | — |
| **Prior reports** | **NO** | via `/previous-reports` and `/compare` only | **NO** | separate endpoints |
| **Images** | **NO** | **YES** — server-side Orthanc fetch, `maxImages` default 6, `0` = text-only | **NO** | `:780-790` |
| **Technique-derived sequence availability** | **NO** | **NO** | **NO** | — |
| **`field` (which section is being asked for)** | **NO — never read** | n/a | n/a | Client posts `field: "impression"` (`useTriggerAiImpression.ts:29`); server destructures no `field` (`aiReporting.ts:977-998`). Harmless today because `/draft` always returns an impression, but the client is signalling an intent the server ignores. |

**Privacy posture, verified.** `DICOM_REDACTION_PERFORMED = false` is a *measured* constant,
and the anonymize banner says so honestly: *"these images are NOT de-identified and may show
the patient's name, ID or date of birth. Do not transcribe any identifier into your answer"*
(`aiReporting.ts:772-778`). That is the #804 fix and it is correct — the previous wording
claimed a redaction step that never ran.

---

## 13. AI PROMPT QUALITY

The `/draft` prompt assembly (`aiReporting.ts:1111-1134`) supplies: Current Findings,
Impression, Clinical History, Study, Modality, plus an INSTRUCTION block.

Persona prompts exist and are substantial: `CARE_RADIOLOGY_MASTER` with 15 HARD RULES,
`CARE_SAFETY_RULES`, `CARE_REPORT_STYLE`.

**Gaps in the `/draft` INSTRUCTION block, verified by reading it:**

| Clause | Present? | Consequence |
|---|---|---|
| Do not invent findings absent from the supplied text | **NO** | The composer path *does* enforce this server-side (`impression_ungrounded`, `unsupported_abnormality` in `validateComposerOutput`). `/draft` has no equivalent — the only thing standing between a hallucinated impression and the ghost layer is the model's own restraint and the radiologist's eye. |
| Preserve measurements verbatim | **NO** | Client-side `CLINICAL_GUARDS` protect measurements during *merge*, but nothing instructs the model, and nothing validates `/draft` output. |
| Preserve laterality | **NO** | A left/right flip in a generated impression is undetectable on this path. |
| Do not assert normality | **NO** | Combined with RW-09's fallback string, "normal" can be asserted by two independent mechanisms with no gate on either. |
| Timeout | **NO** | `:1136` carries the comment that the Clinic Local AI timeout is *"NOT applied on this path today"*. |

**The asymmetry is the finding.** The async report-composer path is properly validated —
schema-parsed, grounded against the selected images, checked for measurement mutation, with
named hard errors. The synchronous `/draft` path used by Ctrl+I has none of that. Both
produce text a radiologist may accept. The stronger machinery already exists in the same
codebase and is not applied to the faster path (RW-03).

---

## 14. AI MERGE SAFETY AND PRECEDENCE

**Precedence map, as implemented:**

```
1. Radiologist manual text            HIGHEST — protected
     isProtectedManualSentence / RADIOLOGIST_MANUAL_SOURCES
     contributionProtected(lastF|lastI|lastR, prov)  -> patch.protected = true
                                                        [store.ts:899-902]
2. Hand-reordered Impression          impressionOrderFrozen = true
                                        [store.ts:877-883, §37 comment]
3. Measurements                       CLINICAL_GUARDS in reportFieldMerge.ts
4. Ledger-owned contributions         lastRendered tracked; stale-flagged, never auto-deleted
                                        [observationLedger.ts:628-652 "NEVER auto-deletes"]
5. Incoming AI / template / chip      LOWEST — merged as subsequence; ghost text until accepted
```

**Confirmed: there is no silent-overwrite path from AI to authored text.** I looked for one
specifically and did not find it:

- `/draft` → `setGhostText` — ghost layer only.
- Composer → dialog-gated, with `rejectAllPending()` awaited before any bypass.
- Voice → `mergeField`, provenance-stamped, undo-snapshotted.
- `mergeField`'s only store-level guard is `if (get().isFinalized && source === "radiologist-voice") return;` (`store.ts:917`) — narrow, as RR-38 records, but the narrowness does not create an AI overwrite path; it creates a *post-finalize* write path for non-voice sources.

**Residual merge risks are real but are not overwrite-of-manual-text:**

- RR-15: the merger may **delete or substitute** a sentence to avoid duplication —
  `reportFieldMerge.ts:459-469` (supersequence replaces a kept sentence), `:351-357` (drops
  one paraphrase), `:361-368` (discards a covered incoming sentence). No diff, no log.
- RR-07: a format A/B merge clears the ledger **and** the undo stack
  (`store.ts:2655-2658`), so the above is unrecoverable at that moment.
- RR-12: hand-typed text can be classified as machine text (default `["template"]` at
  `observationLedger.ts:444-451`) and therefore become eligible for replacement.

RR-12 is the one that most deserves attention, because it inverts the precedence map at item
1: the protection is only as good as the provenance stamp, and the stamp has a
machine-favouring default.

---

## 15. CONTRADICTION DETECTION — WHAT EXISTS VS WHAT IS ASKED FOR

### 15.1 What exists

| Engine | Coverage | Live? |
|---|---|---|
| `mriBrainContradictions.ts:107` `brainTextContradictions` | MRI Brain | ✓ |
| `mriSpineContradictions.ts:159` `lumbarTextContradictions` | MRI Lumbar | ✓ |
| `mriSpineContradictions.ts:321` `dorsalTextContradictions` | MRI Dorsal | ✓ |
| `mriSpineContradictions.ts:222` `contrastDependencyWarning` | contrast vs technique | **✗ RW-12** — exported, tested, never called |
| `xrayCervicalContradictions.ts:217,344,362` | X-ray Cervical + impression order + unvisualized levels | ✓ |
| `xrayChestContradictions.ts:115` | X-ray Chest | ✓ |
| `xrayLsContradictions.ts:221,361,415,437` | X-ray LS + derived measurements + order + uncovered levels | ✓ |
| `reportValidator.ts:46` generic | all | ✓ warn-only |
| `lib/report-quality` Q101–Q115 | all (server) | ✓, but starved of `sex` (RW-04) |

**Absent entirely:** ultrasound, CT, MRI abdomen/pelvis, MRI breast, X-ray of any region
other than cervical/chest/LS. For those, the only coverage is the generic validator, whose
`PATHOLOGY_WORDS` (`reportValidator.ts:34-39`) is neuro/spine-centric: `infarct, hemorrhage,
tumor, lesion, fracture, stenosis, compression, bulge, herniation, collection, edema,
demyelination, atrophy, gliosis, spondylodiscitis, tuberculosis, mass effect, midline shift,
impingement`. No `calculi`, `effusion`, `consolidation`, `nodule`, `aneurysm`, `cyst`,
`lymph node`, `hydroureter`, `gallstone`. For a USG abdomen or a CT chest, rules 3 and 5
("normal study" contradiction, pathology-with-empty-impression) will not fire on real
pathology vocabulary.

### 15.2 The pairs asked about

The audit asked whether 13 named contradiction pairs are detected. Mapping each against the
code above:

| # | Pair | Detected? | Where |
|---|---|---|---|
| 1 | Findings say normal, Impression says abnormal | **PARTIAL** | `reportValidator.ts:74-83` — requires a `NORMAL_PHRASES` hit AND a `PATHOLOGY_WORDS` hit; both lists are neuro/spine-centric |
| 2 | Findings say abnormal, Impression empty | **PARTIAL** | `:97-102` — same vocabulary limit |
| 3 | Left in Findings, right in Impression | **YES** | `:85-95` |
| 4 | Laterality vs study description | **YES on the server path only** | `:208-221`; both client callers starve it |
| 5 | Sex vs anatomy | **BUILT, NOT WIRED** | **RW-04** |
| 6 | Technique (no contrast) vs Findings (enhancing lesion) | **BUILT, NOT WIRED** | **RW-12** |
| 7 | Level in Impression not in Findings | **YES for 4 regions** | `xrayCervicalContradictions.ts:362`, `xrayLsContradictions.ts:437`, spine modules |
| 8 | Severity in Findings (mild) vs Impression (severe) | **YES** | `ledgerSeverityContradiction` (`ReportCanvas.tsx:1360`), `extractSeverity` (`reportValidator.ts:118-121`) |
| 9 | Measurement in Findings vs different measurement in Impression | **PARTIAL** | `derivedMeasurementWarnings` (`xrayLsContradictions.ts:361`); `{value}` placeholder check (`reportValidator.ts:107-110`) |
| 10 | "No restricted diffusion" vs "acute infarct" | **YES** | `reportValidator.ts:148-152` |
| 11 | Basal ganglia normal vs basal ganglia hemorrhage | **YES** | `:139-146` |
| 12 | Findings negated vs Impression asserted | **YES** | `:154-158` |
| 13 | Recommendation vs Findings (recommendation survives a deleted finding) | **NO** | **RW-08** — no rule of this kind exists in any engine |
| — | Duplicate sentence in Findings | **YES** | `:53-63` |
| — | Duplicate impression line | **YES in UI, DEAD at finalize** | `:65-72` iterates the array; `useStudyFinalize.ts:131` passes `[live.impressionText]` — one element — so it cannot fire at sign-off (**RW-13**) |

**Summary: of the 13, 8 are detected, 2 are partial, 2 are built-but-unwired, 1 does not
exist.** The pattern is consistent with §0.3's second separation: CARE builds more safety
machinery than it wires.

---

## 16. STUDY NAVIGATION SAFETY

Cross-patient leakage is the highest-severity class in this audit's terms, so it is answered
exhaustively.

### 16.1 What is protected — and it is genuinely well protected

| Mechanism | Site | Effect |
|---|---|---|
| `saveGenerationRef` | `useDraftPersistence.ts` | an in-flight autosave from a previous study cannot commit against the current one |
| `shouldCommitAutosave` | same | generation + study-id fence |
| `canHydrateDraftForPatient` | `:213-227` | a wrong-patient draft **blanks** the texts rather than adopting them |
| Server `DRAFT_PATIENT_MISMATCH` / `DRAFT_WORKLIST_MISMATCH` | draft routes | server-side refusal |
| `useStudyLock` → 409 `LOCKED_BY_OTHER` | same | two radiologists, one study |
| `assertDraftWritable` → 409 `REPORT_LOCKED` | same | write after lock loss |
| PARTIAL reset clears all five texts | `:157-187` | the comment names the exact threat |
| `activeStudyInstanceUID` rebind clears `activeAnchor` | `useWorkspaceClinicalUi.tsx` | anchors cannot outlive their study |
| Debounced mirror flushes **immediately** on study switch | `workspaceClinicalTexts.ts:74-84` | *"so wrong-patient chrome cannot linger"* |
| `leaveDirtyStudy` guards every navigation ref | `useDraftPersistence.ts:559-588` | Next / Prev / openStudy all route through it |

### 16.2 What is not protected

| Leak | Class | Mechanism | Severity |
|---|---|---|---|
| **Undo stack survives a study switch** | CONFIRMED | `PatchSnapshot` (`store.ts:262-278`) and `ClinicalUndoSnapshot` (`clinicalUndo.ts`) carry **no study identifier**; `undoLastPatch` (`store.ts:2367-2398`) restores all five texts + provenance + patches with **no study check** and sets `isDirty: true`; the PARTIAL reset does not clear `patchUndoStack` / `lastPatchSnapshot` | **P1** (RR-06, RW-06) |
| **Ledger survives a study switch** | CONFIRMED | `appliedPathologyPatches` not cleared by the PARTIAL reset. Note this is *mitigated in practice* by `hydrateObservationLedger` replacing the ledger on hydration (`:249-250`) — but only when a draft exists. The no-draft branch (`:332-343`) seeds clinical history and leaves the ledger alone. | **P1** (RW-07) |
| **Measurements survive** | CONFIRMED | `measurements`, `structuredViewerMeasurements` restored **only if the keys exist** in the draft | **P2** (RW-07) |
| **Numbering / screening / vascularTechnique survive** | CONFIRMED | not in the PARTIAL reset list | **P2** (RW-07) |
| **`selectStudy` silently no-ops** | CONFIRMED | `store.ts:847` — `const st = get().studies.find(s => s.id === id); if (!st) return;` — no reset, no error, no log. Reachable via deep link before the worklist loads. | **P2** (RW-06) |
| **Ctrl+I ghost text has no post-await study guard** | CONFIRMED | §9(b) | **P2** |
| **`isFinalized` is session-only** | CONFIRMED | RR-20 — a re-opened signed study is editable and re-printable as final | **P1** (RR-20) |

**The reachable sequence for the P1 undo leak**, stated concretely: report Patient A, apply
observations (undo stack populated), navigate to Patient B via a path that takes the PARTIAL
reset (browser Back/Forward, a deep link, or a worklist navigate before `store.studies`
contains the id), press Ctrl+Shift+Z. `undoLastPatch` pops Patient A's snapshot and writes
Patient A's five narrative texts into Patient B's study, then marks it dirty. Autosave will
then persist it against Patient B's draft — the generation guard does not help, because the
write happens *in* the current generation.

---

## 17. AUTOSAVE, SAVE AND FINALIZATION

### 17.1 Autosave

Debounced 30 s after the last keystroke (`useDraftPersistence.ts`), generation-fenced,
patient-fenced, lock-aware. RR-28's residuals stand: the gate at `:593` does not consult
`isFinalizing`, non-transient failures are toast-only (`:454-458`), there is no `If-Match` /
compare-and-swap, and measurements are truncated by `.slice(-400)` at `:401-402` with zero
tests referencing `MAX_CARE_VIEWER_MEASUREMENT_ITEMS` (RR-27).

### 17.2 The finalize gauntlet, in order (`useStudyFinalize.ts`)

```
 1. Form-F branch                                  :118-125
 2. Dirty -> saveDraft()                           :115-118   failure does NOT abort
 3. Client validateReport (3 fields)               :129-133
 4. Server validate-draft (errors+warnings+skips)   :134-146   try/catch, non-fatal
 5. runFinalizeQualityEvaluation (canonical)        :151-161   persisted; no sex/age
 6. collectCompositionFinalizeGate                  :193-231   sibling + stale counts
 7. FinalizeSignDialog -> compositionFinalizeAllowed            HARD BLOCK on stale impression
 8. if (!result.confirmed) return                   :233
 9. Re-read live store AFTER the gate               :236-239   correct — payload matches gate
10. Build htmlBody (3 sections)                     :260-263   RW-01
11. finalizeRadiologyReport -> POST /api/patient-reports
12. Honest toast on signed / skipped                :284-289
13. HOPE auto-push, .catch(() => {})                :310-326   silent
```

Step 9 is correct and worth noting: the signed payload is read *after* the dialog returns, so
a last-second edit cannot desynchronise the gate from the payload.

Step 2 is a latent defect: if `saveDraft()` fails, `effectiveDraftId` keeps its prior value
and finalize proceeds. The report signs from live store text, so the *content* is right, but
the draft row and the report row can disagree, and the quality evaluation is keyed to a
`draftId` that may not hold the signed text.

### 17.3 Server side

`POST /api/patient-reports` gates identity when a study/worklist id is supplied
(`MATCH_GATE_BLOCKED` / `PATIENT_MISMATCH` / `TEST_MISMATCH` / `ORDER_CANCELLED`). The strong
GREEN/APPROVED gate lives on `/api/radiology/studies/:id/final`, which the workspace does not
call (RR-04). The study-less create path bypasses by design (RR-04).

**The idempotent pre-check returns before any content comparison**
(`patient-reports.ts:2008-2018`): `{...existingReport, idempotent: true}`. Combined with the
client's "Edit report" trial mode, a re-finalize of an already-signed study returns the
**old** report while the client toasts success. That is RR-20's mechanism, verified again.

**The PATCH guard** (`:2148-2172`) covers content only for `verified` / `delivered` rows or
D5 hash-signed rows. A legacy signed row in `pending_verification` — the ordinary case — can
be overwritten in place, with no audit row and no version chain (RR-01), and `isCritical:false`
clears the critical note and both acknowledgement fields even on protected rows (RR-02).
Both remain **open and unfixed**.

---

## 18. FINAL REPORT INTEGRITY ACROSS FIVE CONSUMERS

All five read the same string:

```
patient_reports.body
  -> applyStructuredRead(r)                  [patient-reports.ts:2590]
  -> displayBody = structuredRead ? structuredRead.body : r.body     [:2591]
  -> bodyHtml: displayBody                   (radiology reports)
```

`ff_radiology_structured_read` has `defaultValue: false`
(`radiologyFeatureFlagRegistry.ts:69-73`) and depends on `ff_radiology_structured_final`,
also `defaultValue: false` (`:55-59`). **In production, `displayBody === r.body`** — the
three-section HTML built at `useStudyFinalize.ts:260-263`.

| Consumer | Receives Technique? | Receives Clinical History? | Other |
|---|---|---|---|
| Print (`/print`) | **NO** | **NO** | `versionSafeguardHtml` banners/watermarks are correct and do render |
| PDF | **NO** | **NO** | client jsPDF path additionally omits the critical banner and report number, and defaults the signer to a hard-coded name (RR-21) |
| Public link / WhatsApp | **NO** | **NO** | — |
| Email share | **NO** | **NO** | — |
| PACS archive / HOPE | **NO** | **NO** | HOPE emit can report success while enqueuing nothing (RR-62); auto-push failure is swallowed (`useStudyFinalize.ts:310-326`) |

Meanwhile the **pre-sign** preview *does* include both sections —
`buildLivePrintBodyHtml({clinicalHistory, technique, ...})` at
`useWorkspaceExportShare.ts:149-159` and `buildPreviewHtml({technique, clinicalHistory, ...})`
at `:166-191`.

So the radiologist reviews a complete document, signs, and a different, incomplete document
is issued. RW-01.

---

## 19. CLINICAL SAFETY FAILURE MODES

Catalogued by what actually happens to a patient or a document, not by which file is at
fault. Severity on the basis in §21. "Do not inflate severity" is honoured: a warn-only rule
that does not fire is a degraded reminder, not a wrong report.

### P0 — can cause wrong-patient care or unaudited mutation of posted history today

| Mode | Reachable? | Mechanism | ID |
|---|---|---|---|
| A signed report's body and impression overwritten in place, with no audit row and no version chain, on an ordinary `pending_verification` row | Yes, via API | PATCH guard covers content only for `verified`/`delivered` or D5 hash-signed rows | RR-01 |
| The critical flag and both acknowledgement fields cleared on a **verified** report | Yes, same handler | The whitelist test omits `isCritical`, `criticalAcknowledgedAt`, `criticalAcknowledgedBy` | RR-02 |
| Signing identity and instant supplied by the caller on a shared-API-key route with no session | Yes | `internal-reporting-studio.ts:811-816`, auth at `:74-86`; also `createdBy`/`actor` from the client at `useStudyFinalize.ts:267-268` | RR-03 |

**No new P0 was found in this pass.** All three are prior-audit findings, re-verified open.

### P1 — can cause a clinically wrong or legally indefensible document to be issued

| Mode | Reachable? | Mechanism | ID |
|---|---|---|---|
| **The issued report is not the reviewed report** — Technique and Clinical History present on screen and in the preview, absent from every signed artifact | Every sign-off | Three-section `htmlBody`; stored verbatim; structured read flag off | **RW-01** |
| **A wrong-patient-report detector that cannot fire** — male report mentioning a uterus, female report mentioning a prostate, signs with no warning | Every sign-off | `sex` never sent to the engine; route does no patient lookup | **RW-04** |
| **Patient A's text written into Patient B's report by undo** | Browser Back/Forward, deep link, or a navigate before the study list loads; then Ctrl+Shift+Z | Undo snapshot carries no study identity; restore performs no check; the PARTIAL reset does not clear the stack | **RW-06** |
| **Patient A's observations, measurements, numbering and vascular protocol live on Patient B's fresh study** | Any study opened with no existing draft | PARTIAL reset clears the five texts only | **RW-07** |
| A re-opened signed study is editable and re-signable; the client toasts success while the server returns the **old** report | Yes | `isFinalized` session-only; idempotent pre-check returns before any content comparison | RR-20 |
| The strong DICOM↔billed identity gate sits on an endpoint the workspace never calls | By design | `/api/radiology/studies/:id/final` vs the live `POST /api/patient-reports` | RR-04 |
| Provenance does not survive finalization — after signing, nobody can prove which sentences were the radiologist's | Every sign-off | `radiologyReportLifecycle.ts:257` sends `body` only | RR-05 |
| A format A/B merge clears the ledger **and** the undo stack together, so any merge damage is unrecoverable | Yes | `store.ts:2655-2658`, no pre-merge snapshot pushed | RR-07 |
| Hand-typed text can be classified as machine text and thereby lose manual protection | Yes | Default `["template"]` at `observationLedger.ts:444-451` | RR-12 |
| The merger can delete or substitute a sentence to avoid duplication, with no diff and no log | Yes | `reportFieldMerge.ts:459-469,351-357,361-368` | RR-15 |
| The client PDF path substitutes a hard-coded default signer and omits the critical banner and report number | Yes, that button | `reportPdfGenerator.ts:116,131` | RR-21 |

### P2 — degrades correctness or recoverability, or produces a wrong *warning*

| Mode | Mechanism | ID |
|---|---|---|
| A dictated or chipped abnormal finding leaves the Impression unflagged as stale, so the hard gate does not fire | `mergeField` never arms `impressionNeedsRefresh`; 14 live callers | **RW-05** |
| An obsolete Recommendation ("follow up in 3 months") survives into the signed report after its finding is deleted, or when it came from a chip with no owning observation | `alignRecommendationToObservations` is additive-only; the gate checks the impression only; no engine has a recommendation-vs-findings rule | **RW-08** |
| The generator asserts `"No significant abnormality detected."` because a short pathological sentence matched no cue regex; or silently truncates nine abnormal findings to six | `generateLocalImpression.ts:17-18,36,45,48` | **RW-09** |
| Ctrl+I's output reaches the ghost layer unvalidated, while the composer's is schema-parsed and grounding-checked | No `validateComposerOutput` on `/draft`; no timeout | **RW-03** |
| A contrast-dependent claim signs against a non-contrast Technique with no warning | `contrastDependencyWarning` built, tested, never called | **RW-12** |
| A reader auditing privacy controls finds two named gates and assumes both are enforced | `assertGatewayPrivacy` exported, zero call sites | **RW-10** |
| Ctrl+I's ghost text can be offered on the next study's screen if the radiologist navigates mid-request | No post-await study guard | §9(b) |
| Voice command mode live-commits by default; the raw transcript is retained nowhere | `REVERSIBLE_EDIT` confirms only under `strict` | RR-14, RR-39 |
| The AI-pending finalize gate depends on this browser tab's query cache | No server consult on either sign route | RR-37 |
| Ultrasound, CT and non-spine X-ray have no contradiction module at all, and the generic vocabulary is neuro/spine-centric | Six region modules exist; `PATHOLOGY_WORDS` has no abdominal or thoracic terms | §15.1 |

### P3 — engineering debt with no direct clinical consequence

`field` posted and never read (RW-02); the duplicate-impression rule unable to fire at
finalize (RW-13); the parity logger imported and never invoked (RW-11); four orphaned
surfaces still bundled, two of them named as AI panels (RW-14); six navigation lists and
three shortcut definitions (RR-54); `@ts-nocheck` on every workspace shell panel (RR-55).

### The failure mode this audit looked hardest for and did not find

**Silent AI overwrite of radiologist-authored text.** There is no such path. Every AI route
lands as ghost text requiring explicit acceptance, or as a provenance-tracked merge, or behind
a dialog with an undo snapshot pushed first. Manual text is protected at the store level, so
no UI component can bypass the protection (§14). This should be stated to anyone worried
about the AI, because it is the property most likely to be assumed broken and it is not.

---

## 20. TEST COVERAGE

Measured, not estimated. All figures from this pass.

| Measure | Value |
|---|---|
| ERP test files (`*.test.ts` + `*.test.tsx`) | **346** |
| React render tests (`*.test.tsx`) | **0** |
| Test files asserting source text via `readFileSync` | **68 of 346 (19.7%)** |

### 20.1 Coverage of the surfaces this audit touched

| Surface | Test files | Verdict |
|---|---|---|
| `observationLedger.ts` | 10 | Well covered |
| `reportValidator.ts` | 7 | Well covered — but no test feeds it `sex` or `studyDescription`, which is why RW-04's client half went unnoticed |
| `impressionRecommendationWiring.ts` | 3 | Covered — and the tests assert the additive-only behaviour, so they would **resist** a removal-based fix to RW-08. Correctly so; §24's recommendation is advisory for that reason. |
| `useStudyFinalize.ts` | 2 | Thin for a 366-line gauntlet |
| `useDraftPersistence.ts` | 2 | Thin for the highest-leverage isolation code in the client |
| `clinicalUndo.ts` | 2 | Covered for depth and pop semantics |
| `reportQualityFinalize.ts` | 1 | See §20.2 |
| `generateLocalImpression.ts` | 1 | Covered for the structured path; the six-line cap and the normality fallback are asserted as correct behaviour |
| `workspaceClinicalTexts.ts` | 1 | Covered |
| `useTriggerAiImpression.ts` | **0** | No test at all on the Ctrl+I path — which is where RR-36 lived undetected and where §9(b)'s missing study guard lives now |

### 20.2 The two tests that explain the P1 findings

**`radiologyReportLifecycle.test.ts:12-20`** is the only test in the repository that mentions
`htmlBody`. It supplies a fixed fixture:
```ts
const CONTENT = { title: "MRI SPINE", htmlBody: "<p>Findings</p>", ... };
```
It tests the **transport**, not the section set. No test anywhere asserts that the signed
body contains Technique or Clinical History — which is precisely why RW-01 is invisible to CI.

**`reportQualityFinalize.test.ts:52-65`** asserts that `buildWorkspaceQualityRequest` "maps
workspace fields", checking `reportDraftId`, `source`, `text.impression` and
`text.checklistPercent`. It passes an input with no `sex` and asserts nothing about it. The
test is green, the mapping is incomplete, and Q109 is unreachable. Importantly, **the test
does not assert the absence of `sex`** — so RW-04's fix will not break it. The fix is
unopposed; it was simply never demanded.

### 20.3 The structural gap behind RW-06 and RW-07

`undoLastPatch` is exercised in **at least 10 test files** — `crossProducerHardening`,
`findingComposer`, `mriBrainMeasures`, `mriBrainSubMasters`, `mriDorsalSubMasters`,
`mriLumbarSubMasters`, `mriSpineScreening`, `preDeploySafety`, `abnormalPatternApply` and
others. Every one of them applies an observation and undoes it **within a single study**.
`selectStudy` is referenced in only 4 test files, none of them about reset completeness.

So undo is heavily tested and study-switching is lightly tested, and the defect lives exactly
in the untested intersection. This is the most instructive coverage fact in the audit: **the
suite tests each mechanism thoroughly in isolation and does not test mechanisms against each
other.** With 0 render tests and a 3,357-line orchestrator (RR-51), no test can observe two
hooks interacting.

> **Closed for this one intersection** by `clinicalStateReset.hardening.test.ts` (23 tests,
> `cd572ea1`, §30.9) — which tests exactly the intersection: undo *across* a study switch, each
> reset path *against* the full field contract, and the signed-state lock *against* a re-finalize.
> It does so without a DOM, by driving the real store actions and reading real source. The
> structural point stands for every other pair of mechanisms.

### 20.4 Tests that would catch each P1 finding

| Finding | Test | Cost |
|---|---|---|
| RW-01 | Build the finalize `htmlBody` from a store containing all five sections; assert the string contains `Technique` and `Clinical History` | S |
| RW-04 | Assert `buildWorkspaceQualityRequest({..., sex: "female"}).text.sex === "female"`; then an engine-level test that a female report mentioning "prostate" emits Q109 | XS — the engine test may already exist in `lib/report-quality` |
| RW-06 | Populate the undo stack on study A, switch to study B via the PARTIAL path, call `undoLastPatch()`, assert `false` and assert study B's texts unchanged | S — **written**, §30.9 |
| RW-07 | After the PARTIAL reset on a study with no draft, assert `appliedPathologyPatches`, `measurements`, `lumbarNumbering`, `screening` and `vascularTechnique` are all at their defaults | S — **written and widened to all 61 fields and all three paths**, §30.9 |
| RW-05 | `mergeField("findings", <abnormal>, "radiologist-voice")`, assert `impressionNeedsRefresh === true` | XS |
| RW-13 | `validateReport({findings, impression: ["A.","A."]})` warns; then assert the finalize call site splits | XS |

Four of the six are under twenty lines. None requires a render harness.

### 20.5 The 19.7%

68 of 346 ERP test files assert the **text of source files** rather than behaviour
(`readFileSync` + `toContain`). The prior audit measured 148 of 755 repo-wide; the ERP
figure is worse. These tests cannot catch a runtime fault — the repository already carries
the proof: a grep test for `POST /api/billing/save` stayed green while the endpoint returned
HTTP 500 on every call (recorded in `AGENTS.md`). A `readFileSync` test asserting that
`useStudyFinalize.ts` contains the string `validateReport` would pass identically whether or
not the validator receives any usable input — which is the exact failure mode of RW-04 and
RW-13.

---

## 21. SEVERITY BASIS

| Level | Test applied |
|---|---|
| **P0** | Can cause wrong-patient care, or unaudited mutation of posted clinical history, **today**, on a normal path |
| **P1** | Can cause a clinically wrong or legally indefensible document to be issued, or a safety rule that exists to be unreachable, on a normal path |
| **P2** | Degrades correctness or recoverability; requires an unusual-but-reachable sequence, or produces a wrong *warning* rather than a wrong *report* |
| **P3** | Engineering debt, performance, or hygiene with no direct clinical consequence |

Deliberately **not** inflated: a warn-only rule that does not fire is P2, not P0 — the
radiologist is the gate and has always been. Ghost text is not a write. A dead function is
P3 unless its absence removes coverage a reader would assume exists (RW-10, RW-12 are the
exceptions, and are P2/P1 for that reason).

---

## 22. SEVEN END-TO-END TRACE SCENARIOS

**A. Routine MRI Lumbar, typed findings, signed.**
`selectStudy` FULL reset → history seeded → technique from protocol → tiles via `mergeField`
→ ledger patches → impression derived from narrative → `impressionNeedsRefresh` computed from
narrative → gate satisfied → 3-section body → signed. **Works.** Loses Technique and History
(RW-01).

**B. Same, but findings dictated by voice.**
Identical except Findings arrives via `mergeField("findings", text, voiceSource)`
(`useVoiceReporting.ts:174`). **`impressionNeedsRefresh` is NOT armed** (RW-05). If the
radiologist does not manually refresh, the gate sees a clean flag and signs a stale
impression. **Defect on a normal path.**

**C. Radiologist deletes a Findings sentence that owned a Recommendation.**
The sweep at `store.ts:885-905` marks the patch `protected` (its contribution is missing) —
correct, it prevents re-assertion. `alignRecommendationToObservations` skips it
(`if (patch.stale) continue;`). The Recommendation survives. The gate checks
`impressionNeedsRefresh`, not recommendations. **Signs silently with an orphaned
recommendation** (RW-08).

**D. Browser Back after reporting Patient A.**
PARTIAL reset clears the five texts. `patchUndoStack`, `appliedPathologyPatches`,
`measurements`, numbering, screening and `vascularTechnique` persist. Ctrl+Shift+Z writes
Patient A's five texts into Patient B (RW-06). Autosave persists them against Patient B's
draft within the current generation. **P1 cross-patient leak.**

> **Re-run after `cd572ea1` (§30.9): closed twice over.** The PARTIAL path now spreads the
> same 61-field `emptyClinicalState()` as the other two, so the undo stack, the ledger,
> measurements, all three numbering schemes, screening and vascular protocol are cleared before
> Patient B is on screen. Independently, every frame carries `activeStudyId` and
> `undoLastPatch` refuses a mismatched one without popping it, so a switch that somehow
> bypassed all three reset paths still cannot replay Patient A's edit; Ctrl+Shift+Z says why.
> The refusal and the FULL and third reset paths are tested **behaviourally**, by driving the
> real store actions. The PARTIAL path is tested by **source contract** — it is a hook effect
> and this repo's test environment has no DOM, so the assertion is that the effect spreads the
> helper and that its old 16-key literal is gone. That is a weaker form of proof and is recorded
> as such. The residual is `selectStudy`'s unknown-id branch, which logs
> `{ id, activeStudyId, knownStudies }` and still does not reset — correctly, because with no
> study selected there is no Patient B to contaminate.

**E. Ctrl+I, then immediately Next Study.**
`/draft` request in flight → navigation → response arrives → `setGhostText(res.impression,
"impression")` with no study check. Patient A's impression offered on Patient B's screen.
**Ghost text only — acceptance is explicit.** P2 (§9b).

> **Re-run after `9c010fe7` (§30.10): closed.** Both study identities are now captured before the
> `await` and the response is dropped, with a toast, if either has moved. *"Ghost text only —
> acceptance is explicit"* was sound as far as it went, and is the reason this was P2 and not P1;
> §30.10 argues the severity up and records the disagreement rather than silently re-grading it.
> Proven by seven tests and by two mutations (M1 deletes the guard, M2 makes it compare the
> current study to itself — a no-op that still names the helper).

**F. Re-open a signed study and press Finalize again.**
`isFinalized` was reset by `selectStudy`. The client's edit-trial mode re-posts.
`patient-reports.ts:2008-2018` returns the existing report with `idempotent: true` **before
comparing content**. The client toasts success. Edits are silently discarded (RR-20).
If instead the client PATCHes, `:2148-2172` permits an in-place content overwrite on a
legacy `pending_verification` row with no audit row (RR-01). **Both open.**

> **Re-run after `cd572ea1` (§30.9): RR-20 closed, RR-01 still open.** The re-open now stops
> earlier — `authoritativeStatus` reads the server's own `status` from the per-study detail
> query the workspace was already fetching and discarding, and honours `DELIVERED` as well as
> `REPORT_FINAL`, so `studyLock` refuses to claim the study, `contentLocked` is true and
> `draftBackup` is off. A signature made in another tab or session locks on reload, which is
> what "session-only" meant. If the operator enters trial-edit via `allowEditSigned` and
> re-posts anyway, the server's unchanged `idempotent: true` is now **read** and answered with
> a destructive "edits NOT saved" toast before any success path, with the local drafts left
> intact as the only remaining copy. RR-01's PATCH branch is untouched — it is server-side
> immutability and was explicitly out of scope for a client-isolation group.

**G. USG Abdomen with a genuine contradiction.**
No USG contradiction module exists. The generic validator's `PATHOLOGY_WORDS` contains no
abdominal vocabulary. `saysNormal` requires a `NORMAL_PHRASES` hit — present — and a
`PATHOLOGY_WORDS` hit — **absent for "calculi", "effusion", "hydropic"**. Rule 3 does not
fire. Q109 cannot fire (RW-04). **The contradiction reaches the signed report undetected.**

---

## 23. STATUS OF THE 2026-09-30 FINDINGS TOUCHED BY THIS AUDIT

| RR | Status | Evidence |
|---|---|---|
| RR-01 signed report in-place mutable | **OPEN** | `patient-reports.ts:2148-2172` re-read; guard still covers only `verified`/`delivered` or D5-signed |
| RR-02 critical flag clearable | **OPEN** | same handler |
| RR-03 caller-supplied signing identity | **OPEN** | `useStudyFinalize.ts:267-268` still sends `createdBy`/`actor` from the client session |
| RR-04 strong identity gate on an uncalled route | **OPEN** | — |
| RR-05 provenance does not survive finalize | **OPEN** | `radiologyReportLifecycle.ts:257` sends `body` only |
| RR-06 undo survives study switch | **FIXED ✓** in `cd572ea1` | → RW-06, §30.9. Frames stamped with `activeStudyId` (`store.ts:270,290`), `undoLastPatch` refuses a cross-study frame and keeps it on the stack (`:2440`), all three reset paths now clear `patchUndoStack`/`lastPatchSnapshot`, and the refusal is toasted at Ctrl+Shift+Z (`useWorkspaceCommands.ts:245-247`) |
| RR-07 format merge destroys ledger + undo | **OPEN** | `store.ts:2655-2658` |
| RR-18 validator starved at finalize | **OPEN, sharpened** | → RW-04, RW-13 |
| RR-20 finalized state session-only | **FIXED ✓** in `cd572ea1` | → §30.9. Both halves, both by reuse. *Session-only:* `authoritativeStatus` reads the server's own `status` from the per-study detail query, and now honours `DELIVERED` as well as `REPORT_FINAL` (`useWorkspaceClinicalUi.tsx:785-786`) — see RW-30. *Re-finalize returns the old report:* the `idempotent` flag the server was already sending is now read (`radiologyReportLifecycle.ts:115,284,357`) and produces a destructive "edits NOT saved" toast before any success path (`useStudyFinalize.ts:339`). Scenario F re-run below |
| RR-21 client PDF default signer | **OPEN** | `useStudyFinalize.ts:184-190` `/sugandha/i` sort re-read |
| RR-36 Ctrl+I sends findings the server never reads | **FIXED ✓** | `aiReporting.ts:1003` `const reportBody = reportBodyReq?.trim() ? reportBodyReq : findingsReq;` plus the 400-on-empty-prompt guard at `:740-745` |
| RR-37 AI-pending gate client-only | **OPEN, client half now proven** | The gate itself was sixteen untested lines inline in `useStudyFinalize`; extracted to `decideAiFinalizeGate` and tested ten ways in `9c010fe7` (→ RW-32, §30.10). That proves the client gate runs and where it sits in the gauntlet. It does **not** close RR-37: nothing server-side refuses to sign a report whose composer job has PENDING proposals, so a client that skips the hook still signs |
| RR-38 `mergeField` finalized guard covers voice only | **OPEN** | `store.ts:917` re-read |
| RR-53 orphaned surfaces | **OPEN, extended** | → RW-10, RW-11, RW-14 |
| RR-59 hard-coded signer regex | **OPEN** | `useStudyFinalize.ts:184-190` |
| RR-62 HOPE emit false success | **OPEN** | auto-push `.catch(() => {})` at `useStudyFinalize.ts:310-326` |

Also newly landed and verified since 2026-09-30: the privacy-label honesty fix
(`DICOM_REDACTION_PERFORMED = false` measured, banner rewritten at `aiReporting.ts:772-778`),
and the offline bill-parser and OCR fixes — outside this remit.

---

## 24. NEW FINDINGS REGISTER

Class key: **D** defect, **R** risk, **G** gap. Every entry was read in this pass.

Entries closed by remediation carry a `**Status:** FIXED` line naming the commit and the §30
subsection that proves it. Findings discovered *during* remediation — RW-15 … RW-34 — are not
given entries here; they are recorded in §30 beside the change that exposed them, which is why
this section stops at RW-14 while the register totals in §29 do not.

---

### RW-01 — The signed report omits Technique and Clinical History

**Severity:** **P1**
**Class:** D
**File(s):** `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts:260-263`; `artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts:50-56,257`; `artifacts/api-server/src/routes/patient-reports.ts:2590-2591`; `artifacts/api-server/src/lib/radiologyFeatureFlagRegistry.ts:55-59,69-73`
**Function:** `useStudyFinalize.finalize` → `finalizeRadiologyReport` → `renderReportVersionHtml`

**Current behavior:** The finalize payload's `htmlBody` is built from three sections only.
Technique and Clinical History are present in the store, present in the draft row, present in
the on-screen preview — and absent from the signed artifact and therefore from print, PDF,
public link, WhatsApp, email and PACS archive.

**Evidence:**
```ts
// useStudyFinalize.ts:260-263
htmlBody: (() => {
  const esc = (s: string) => s.replace(/&/g,"&amp;")...;
  return `<h2>${esc(combinedTitle)}</h2><p><b>Findings:</b> ${esc(signedFindings)...}</p>`
       + `<p><b>Impression:</b> ${esc(signedImpression)...}</p>`
       + `<p><b>Recommendation:</b> ${esc(signedRecommendation)...}</p>`;
})(),
```
```ts
// radiologyReportLifecycle.ts:50-56
/** Rendered HTML body — stored VERBATIM on the patient_reports row and ... */
htmlBody: string;
// :257
body: content.htmlBody,
```
```ts
// patient-reports.ts:2590-2591
const structuredRead = await applyStructuredRead(r);
const displayBody = structuredRead ? structuredRead.body : r.body;
```
`ff_radiology_structured_read` and `ff_radiology_structured_final` both have
`defaultValue: false` (`radiologyFeatureFlagRegistry.ts:56,70`), so `displayBody === r.body`
in production. The print renderer is handed `bodyHtml: displayBody` and no separate
technique field, so the institutional style's `sectionOrder: "Technique,Findings,Impression"`
and `showClinicalHistory` flags (`patient-reports.ts:2615-2616`) arrange sections that were
never supplied. Contrast `useWorkspaceExportShare.ts:149-159` and `:166-191`, where the
pre-sign preview **does** pass `clinicalHistory` and `technique`.

**Clinical consequence:** The referring doctor cannot see what sequences or protocol were
run, so cannot judge whether a "normal" study answers the clinical question. The clinical
history that justified the impression is not on the issued document, which weakens the
report's defensibility if the impression is later questioned. The radiologist reviewed a
complete document and issued an incomplete one, with no indication that anything was dropped.

**Recommended correction:** Include the two sections in the `htmlBody` builder at
`useStudyFinalize.ts:260-263`, reading `signed.techniqueText` and `signed.clinicalHistoryText`
from the same live `useWorkspace.getState()` read already performed at `:236`. Reuse the
section-ordering and visibility preferences the institutional style model already expresses
rather than hard-coding a new order.

**Existing architecture to reuse:** `buildLivePrintBodyHtml`
(`useWorkspaceExportShare.ts:149-159`) already composes exactly these five sections with the
clinic's `headingCase` and `impressionStyle`. Extracting or importing that builder for the
signed body would make the preview and the artifact structurally identical — which is the
property actually wanted.

**Risk of correction:** Low. Additive to a string builder; no schema change; no behaviour
removed. The one thing to check is length: an unusually long technique could push a
half-page print layout onto a second page, so verify against the `printLayout: "half_page"`
preset. Historical signed reports are unaffected — this changes only newly signed rows, which
is the correct behaviour and avoids rewriting issued documents.

---

### RW-02 — `field` is posted by the client and never read by the server

**Severity:** **P3**
**Class:** G
**File(s):** `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useTriggerAiImpression.ts:26-31`; `artifacts/api-server/src/routes/aiReporting.ts:977-998`

**Current behavior:** Ctrl+I posts `field: "impression"`. The `/draft` handler destructures
`worklistId, studyInstanceUID, modality, studyDescription, reportBody, findings, impression,
clinicalHistory, provider` — no `field`.

**Evidence:** the destructure block at `aiReporting.ts:977-998` contains no `field` binding;
the client sends it at `useTriggerAiImpression.ts:29`.

**Clinical consequence:** None today, because `/draft` only ever produces an impression. The
cost is latent: the client believes it is telling the server which section it wants, and the
server ignores it. If `/draft` is ever extended to other sections, the routing will silently
not happen.

**Recommended correction:** Either read `field` and branch on it, or delete it from the
client payload. Do not leave a signal that one side believes and the other does not.

**Existing architecture to reuse:** the `AiReportingQueryRequestSchema` zod pattern already
used by `/query` (`aiReporting.ts:664`) — `/draft` is the only AI route still hand-destructuring.

**Risk of correction:** Negligible either way.

---

### RW-03 — The `/draft` path has none of the composer's output validation

**Severity:** **P2**
**Class:** R
**File(s):** `artifacts/api-server/src/routes/aiReporting.ts:1111-1134,1136`

**Current behavior:** The synchronous `/draft` prompt supplies Current Findings, Impression,
Clinical History, Study and Modality plus an INSTRUCTION block. That block contains no
anti-hallucination clause, no measurement-preservation clause, no laterality-preservation
clause, and no timeout (`:1136` records that the Clinic Local AI timeout is *"NOT applied on
this path today"*). The output is returned to the client unvalidated.

**Evidence:** the async composer path runs `parseComposerDraftJson` →
`ComposerDraftOutputSchema.safeParse` → `validateComposerOutput`, with hard errors
`empty_output`, `unsupported_abnormality`, `impression_ungrounded`, measurement mutation and
selected-image overclaims. None of that is invoked on `/draft`.

**Clinical consequence:** A hallucinated or measurement-altered impression reaches the ghost
layer with only the radiologist's eye between it and the report. Because acceptance is
explicit this is not an overwrite risk — it is a *trust calibration* risk: the ghost layer
looks identical whether the output was validated or not.

**Recommended correction:** Apply the grounding subset of `validateComposerOutput` —
specifically the measurement-mutation and ungrounded-claim checks — to `/draft` output before
returning it, and surface a validation failure as a distinct toast rather than as ghost text.

**Existing architecture to reuse:** `validateComposerOutput` and `ComposerDraftOutputSchema`
already exist and are already tested. This is a call, not a build.

**Risk of correction:** Low, but tune before enabling blocking: an over-strict grounding check
on a short impression would make Ctrl+I feel broken. Ship it as a warning badge first.

---

### RW-04 — Q109 gender/anatomy contradiction cannot fire from the workspace

**Severity:** **P1**
**Class:** G
**File(s):** `artifacts/diagnostic-erp/src/lib/reportQualityFinalize.ts:85-115`; `artifacts/api-server/src/routes/reportQuality.ts:238-251`; `lib/report-quality/src/text/evaluate.ts:161-167`; `lib/report-quality/src/contract.ts:89`; `artifacts/diagnostic-erp/src/lib/reportValidator.ts:236-246`; `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts:151-161`

**Current behavior:** The canonical rule catalog defines Q109
(`care.text.consistency.gender-anatomy`, `ruleCatalog.ts:71`) and the engine implements it.
The workspace never sends `sex`, and the route never looks it up, so `report.sex` is always
undefined and the rule never fires.

**Evidence:**
```ts
// lib/report-quality/src/text/evaluate.ts:161-167
const sex = (report.sex || "").toUpperCase();
if (sex.startsWith("F") && (fullTextLower.includes("prostate") || fullTextLower.includes("seminal vesicle"))) {
  emit("Q109", "Gender contradiction: ...", W);
}
if (sex.startsWith("M") && ["uterus","ovary","ovarian","endometrium","cervix","uterine"].some(...)) {
  emit("Q109", "Gender contradiction: ...", W);
}
```
`buildWorkspaceQualityRequest`'s parameter type (`reportQualityFinalize.ts:85-96`) has no
`sex` and no `age`; the returned `text` object (`:103-113`) sets neither.
`POST /evaluate` (`reportQuality.ts:238-251`) passes `text` straight to `runQualityEngine`
with no patient or draft lookup. The client mirror at `reportValidator.ts:241-246` is starved
identically: `useWorkspaceClinicalUi.tsx:2820-2823` and `ReportCanvas.tsx:1361-1364` both
pass only `findings` and `impression`.

**Clinical consequence:** A report for a male patient that mentions a uterus, or a female
patient that mentions a prostate — the classic wrong-patient-report signature — signs with no
warning. This is the single most cost-effective detection of a mis-identified study that the
codebase owns, and it is switched off by omission. Note that `reportValidator.ts:236-240`
already carries a comment recording that this rule was *"silently dead"* once before and was
fixed; the rule was revived, the feed was not.

**Recommended correction:** Add `sex` and `age` to `buildWorkspaceQualityRequest`'s params and
to the returned `text`; pass `canonicalDemography.sex` at `useStudyFinalize.ts:151-161`. The
demography is already resolved in that hook's scope.

**Existing architecture to reuse:** everything downstream already works — the contract field
(`contract.ts:89`), the catalog entry, the engine rule, and its unit tests. Only the request
builder and one call site change.

**Risk of correction:** Very low. It can only add warnings. The one consideration is that
`patients.gender` is free-text in places, so verify the `startsWith("F")`/`startsWith("M")`
normalisation against real stored values before enabling — the existing comment at
`reportValidator.ts:236-240` documents exactly this trap and the fix already chosen.

---

### RW-05 — Findings written via `mergeField` never arm the stale-impression gate

**Severity:** **P2**
**Class:** D
**Status:** **FIXED** in `df7e024b` — §30.8. Fixed in *both* writers, not only `mergeField`: the predicate this entry recommended mirroring was itself keyed on source and therefore excluded every named source, including `radiologist-voice`.
**File(s):** `artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts:871-876,915-947`; 14 call sites incl. `useVoiceReporting.ts:174,326`, `ReportingToolsRail.tsx:1175`, `quick-select-strip.tsx:233`, `useWorkspaceClinicalUi.tsx:988,1545,1998`, `store.ts:1024,1032,1055,1075`

**Current behavior:** `setField` arms `impressionNeedsRefresh = true` when Findings changes
and the source is manual or absent (`store.ts:871-873`). `mergeField` sets `isDirty`, the text
and the provenance, and never touches the flag. Fourteen live callers write Findings through
`mergeField`.

**Evidence:** `store.ts:915-947` in full — the `set()` at `:934-938` contains
`isDirty`, `[key]` and `fieldProvenance` only. Contrast `:871-873`. The ledger paths *do*
compute it correctly (`:1672`, `:1948`, `:2254`), which is why this is a gap rather than a
design absence.

**Clinical consequence:** Dictating a new abnormal finding into Findings, or inserting one
from a tile, leaves the Impression unflagged as stale. `compositionFinalizeAllowed`
(`observationLedger.ts:608-615`) reads `impressionNeedsRefresh` only, so the hard gate that
exists to prevent signing a stale impression does not fire. Scenario B, §22.

**Recommended correction:** In `mergeField`, after the no-op early return, arm the flag under
the same condition `setField` uses — `f === "findings"` — and clear it under the same
condition for `f === "impression"` with a non-manual source. Two conditionals, mirroring
`:871-876`.

**Existing architecture to reuse:** the exact predicate already written at `store.ts:871-876`,
and `impressionNeedsRefreshFromNarrative` (`observationLedger.ts:570`) if a narrative-derived
answer is preferred over a boolean set.

**Risk of correction:** Low but not zero: this makes the stale-impression prompt appear more
often, on voice and tile paths that are currently silent. That is the intent, but it will be
felt as new friction by a radiologist who dictates most findings. Recommend arming it and
watching the acknowledgement rate before making it blocking anywhere it currently is not.

---

### RW-06 — The clinical undo snapshot carries no study identity

**Severity:** **P1**
**Class:** D
**Status:** **FIXED** in `cd572ea1` — §30.9. Both recommended layers, plus a third this entry did not list. (1) `PatchSnapshot` carries `activeStudyId` (`store.ts:270`) stamped by `captureClinicalSnapshot` (`:290`), and `undoLastPatch` refuses a mismatched frame and returns `false` **without popping it** (`:2440`) — the frame stays, because it is still the correct history for the study it came from. (2) `patchUndoStack`/`lastPatchSnapshot` are cleared on **all three** reset paths, not just the PARTIAL one — see the correction below. (3) The refusal is surfaced as a `destructive` toast at Ctrl+Shift+Z (`useWorkspaceCommands.ts:245-247`), as the risk note asked. `selectStudy`'s `if (!st) return;` now logs `{ id, activeStudyId, knownStudies }`. The signature stayed `() => boolean`: **20 assertions of the form `expect(undoLastPatch()).toBe(true)` across 17 test files**, plus several more through a bound variable, and a string union would have passed every one of them, since `"empty"` is truthy.
**Correction to the text below:** *"only the FULL `selectStudy` does"* understates it — a **third** path, `advanceToNextStudy`'s end-of-queue branch, cleared neither field and fires on the normal end of a session (§2.2, C-11).
**File(s):** `artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts:262-278,2367-2398`; `artifacts/diagnostic-erp/src/lib/zai-workspace/clinicalUndo.ts`; `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceCommands.ts:236-241`; `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts:157-187`; `store.ts:847`

**Current behavior:** `PatchSnapshot` and `ClinicalUndoSnapshot` record the five texts,
provenance, patches, format name, markers and voice observations. Neither records a study id,
accession or patient id. `undoLastPatch` pops and restores blindly, then sets `isDirty: true`.
The PARTIAL study-switch reset does not clear `patchUndoStack` or `lastPatchSnapshot`; only
the FULL `selectStudy` does. `selectStudy` itself silently no-ops when the id is not in
`store.studies` (`if (!st) return;`) — no reset, no error, no log.

**Evidence:** the type at `store.ts:262-278` has no identity field; `undoLastPatch` at
`:2367-2398` performs no comparison; the PARTIAL reset list at
`useDraftPersistence.ts:157-187` omits both stack fields; `useWorkspaceCommands.ts:236-241`
binds Ctrl+Shift+Z directly to `undoLastPatch()`.

**Clinical consequence:** Cross-patient text insertion, reachable by browser Back/Forward, a
deep link, or a worklist navigate that runs before the study list has loaded. Autosave then
persists the contaminating text against the current patient's draft within the current
generation, so the generation guard does not intercept it. Scenario D, §22.

**Recommended correction:** Two independent layers, either of which alone closes the hole:
(1) stamp `activeStudyId` onto the snapshot when it is pushed and have `undoLastPatch` return
`false` when it does not match the current study; (2) add `patchUndoStack: []` and
`lastPatchSnapshot: null` to the PARTIAL reset at `useDraftPersistence.ts:157-187`. Do both —
(1) is the correctness guarantee, (2) is the memory hygiene. Separately, make `selectStudy`'s
`if (!st) return;` branch log, since a silent no-op on a reset path is how this stayed hidden.

**Existing architecture to reuse:** the autosave code already solves exactly this problem
with `saveGenerationRef` and `shouldCommitAutosave`. The same fence pattern, applied to the
undo stack, is the idiomatic fix here.

**Risk of correction:** Very low. Layer (1) can only refuse an undo that was already unsafe;
a refused undo should surface a toast ("Undo history belongs to a different study") rather
than fail silently. Layer (2) removes an ability nobody intends to have.

---

### RW-07 — The partial study-switch reset leaves ledger, measurements and protocol state behind

**Severity:** **P1** (ledger) / **P2** (rest)
**Class:** D
**Status:** **FIXED** in `cd572ea1` — §30.9, by exactly the extraction this entry recommended. New leaf module `lib/zai-workspace/clinicalStateReset.ts` exports `CLINICAL_RESET_FIELDS` (**61** names), `ClinicalResetState = Pick<WorkspaceStore, ClinicalResetField>` and `emptyClinicalState()`. The `Pick<>` is the load-bearing part: rename or retype any of the 61 in the store and this stops compiling, whereas a hand-written duplicate would keep compiling and reset the wrong thing. **Equivalence measured, not asserted** — parsing the base FULL literal at `bc8ca8c5` and diffing key sets gives 65 base keys, the 4 not in the helper being exactly `activeStudyId`, `clinicalHistoryText`, `activeStudyInstanceUID` and `reportingContext`, and **zero** keys in the helper that the base FULL path lacked. All three paths spread it (`store.ts:870`, `store.ts:1140`, `useDraftPersistence.ts:175`), each pinned by a source contract, and the PARTIAL path's old literal is asserted absent so the change cannot silently revert. Paired with RW-06's layer (1) as the risk note required. The ordering concern is real and handled: the hydrate effect is declared after the reset effect, so it runs after.
**Two corrections to the text below.** (a) *"two hand-maintained lists of ~45 fields"* — measured, they are **65** and **16**, and there is a **third** list of **4** (`store.ts:1086` at base) that this entry does not mention and that fires when the last study in the queue is signed. (b) The merge-preview triple (`mergePreviewOpen`, `lastMergeResult`, `lastMergeFormats`) was cleared *conditionally*, on the **outgoing** study's `abnormalPatternConfirm`, so it usually survived a switch; it is now unconditional and study-scoped.
**File(s):** `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts:157-187`, `:204-344`

**Current behavior:** The PARTIAL reset clears the five narrative texts, `fieldProvenance`,
dirty/finalizing/finalized, ghost text, `primaryFindingsSection`, `linkedStudy`,
`activeFindingsSectionId`, `appliedPatternMarkers` and `abnormalPatternConfirm`. It does
**not** clear `appliedPathologyPatches`, `patchUndoStack`, `lastPatchSnapshot`,
`measurements`, `structuredViewerMeasurements`, numbering (`lumbarNumbering`,
`dorsalNumbering`, `dorsoLumbarNumbering`), `screening` or `vascularTechnique`. Hydration
restores measurements, canal, spine and vascular state **only if the keys exist** in the
draft; the no-draft branch (`:332-343`) seeds clinical history and leaves everything else.

**Evidence:** the reset object at `:157-187` read field by field; contrast the FULL reset at
`store.ts:847`, which clears all of the above.

**Clinical consequence:** For a study with a saved draft, `hydrateObservationLedger`
(`:249-250`) replaces the ledger and the practical exposure is limited. For a study with
**no** draft — a fresh study, which is the common case at the start of a session — Patient A's
observations, measurements, numbering scheme and vascular protocol remain in the store while
Patient B's empty report is on screen. Those then feed the re-derivation paths
(`recomputeCopilot`, `seedSystemNormalImpression`) and the finalize gate.

**Recommended correction:** Make the PARTIAL reset clear the same clinical set as the FULL
reset. The distinction the comment at `:157-187` is protecting — do not wipe
`reportingContext`, do not race hydration — is about *context*, not about *clinical content*.
Clearing the ledger, measurements, numbering, screening and vascular state does not
reintroduce that race.

**Existing architecture to reuse:** `store.ts:847` already enumerates the correct full set,
including the `default*()` constructors for numbering, screening, sequences and vascular
technique. Extract that field list into a shared `emptyClinicalState(study)` helper and have
both reset paths call it, so the two can never drift again. That single extraction is the
durable fix; today they are two hand-maintained lists of ~45 fields.

**Risk of correction:** Low. Must be paired with RW-06's layer (1) or the undo stack will
still hold a reference to the cleared state. Verify against the hydration path: clearing
before hydrate is correct, clearing *after* would wipe restored data, so the ordering inside
the effect matters.

---

### RW-08 — An obsolete Recommendation survives into the signed report

**Severity:** **P2**
**Class:** D
**Status:** **FIXED** in `df7e024b` — §30.8. Advisory, never deleting, never blocking. Two deliberate departures from the correction below: the detector reads `stale` **or** `protected` (a stale-only read misses Path B entirely), and advice with no owning observation is *not* named, so the "or absent" half is dropped. It reaches the signer at the finalize dialog only, not live in the workspace banner.
**File(s):** `artifacts/diagnostic-erp/src/lib/impressionRecommendationWiring.ts` (117 lines); `artifacts/diagnostic-erp/src/lib/observationLedger.ts:608-615`; `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts:193-231`

**Current behavior:** `alignRecommendationToObservations` is additive: it skips stale patches
and merges sentences in, with no removal path. Its docstring states the intent — *"When no
observation owns a recommendation, the box is left untouched."* The finalize gate reads
`impressionNeedsRefresh` only. No contradiction engine contains a recommendation-vs-findings
rule (§15.2, pair 13).

**Evidence:** `impressionRecommendationWiring.ts` read in full — the only loop guard is
`if (patch.stale) continue;`. `compositionFinalizeAllowed` (`observationLedger.ts:608-615`)
takes three booleans, none of them about recommendations.

**Clinical consequence:** Three reachable paths, of which two sign silently: deleting a
Findings sentence manually (Path B, §22 scenario C) and inserting a recommendation from a
chip with no owning observation (Path C, `ReportCanvas.tsx:1620,1887`,
`ReportingToolsRail.tsx:586`). A "follow up in 3 months" or "recommend MRI for further
evaluation" that no longer has a basis in the Findings reaches the referring doctor. The
Recommendation is the section a clinician is most likely to act on and least likely to
cross-check.

**Recommended correction:** Do **not** add auto-deletion — that would violate the highest
rule in this audit's terms, since the box may contain the radiologist's own authored advice.
Instead, make the orphan *visible and gated*: at finalize, detect recommendations whose
owning observation is `stale` or absent, and surface them in the finalize dialog as a named
review item alongside the existing sibling warnings. `collectCompositionFinalizeGate` already
returns an array of `{sentence, token, hint}` warnings — this is one more producer into the
same shape.

**Existing architecture to reuse:** `collectCompositionFinalizeGate`
(`observationLedger.ts:591-605`) and the `UNOWNED_SIBLING_HINT` pattern; the
`FinalizeSignDialog` already renders warning lists.

**Risk of correction:** Low, provided it stays advisory. Making it blocking would trap
radiologists who deliberately recommend follow-up on a normal study — which is legitimate
practice — so it must be acknowledgeable, exactly as the stale-impression gate already is.

---

### RW-09 — A regex miss can assert "No significant abnormality detected."

**Severity:** **P2**
**Class:** R
**File(s):** `artifacts/diagnostic-erp/src/lib/generateLocalImpression.ts:17-18,27-37,39-50,67-83`; callers at `store.ts:1805`, `useWorkspaceClinicalUi.tsx:1812,1843`

**Current behavior:** When no line satisfies `isAbnormalFindingLine`, the generator returns
the literal string `"No significant abnormality detected."` (`:48`, and `:79` for the
structured path). Promotion is decided by `ABNORMAL_CUE_RE` — a neuro/spine vocabulary — with
a fallback of `return s.length > 24;` (`:36`). Results are capped by `.slice(0, 6)`
(`:45,58,64`).

**Evidence:** read in full, 83 lines.

**Clinical consequence:** Two distinct failures. (a) A short pathological sentence that
matches no cue — "Cholelithiasis.", "Cardiomegaly.", "Pneumothorax." — is dropped, and if it
was the only abnormal line the generator asserts normality. (b) A report with more than six
abnormal findings silently produces a six-line Impression; the seventh finding is not
summarised, it is absent, with no truncation indicator. Both are *positive assertions of
clinical content produced by a vocabulary gap*, which is the worst possible provenance for
the sentence a referring doctor reads first.

**Recommended correction:** (a) Never emit a normality assertion from a generator — when
nothing qualifies, return an empty result and let the radiologist write the impression, or
return a non-clinical placeholder such as `"[Impression could not be derived — review
Findings]"`. (b) Replace the hard `.slice(0, 6)` with either no cap or an explicit
`"…and N further abnormal findings"` trailer, so truncation is visible.

**Existing architecture to reuse:** the pathology registry and the per-region concept
libraries already model what counts as abnormal for each study type, with role-aware
impression-worthiness (`isImpressionworthyAbnormal` with `context?.role`). Consulting that
registry instead of a regex is the architecturally consistent fix and would remove the
vocabulary gap for every modality at once.

**Risk of correction:** Moderate for (a): some workflows currently rely on the auto-normal
impression for genuinely normal studies, and removing it adds a manual step. Recommend making
the normality assertion *explicit and attributable* — stamp its provenance as machine-derived
so the provenance system already in place shows it was not authored — rather than removing
it. That preserves the workflow and removes the false attribution.

---

### RW-10 — A second privacy gate exists, is exported, and is never called

**Severity:** **P2**
**Class:** G
**File(s):** `artifacts/api-server/src/lib/reportComposer/providers/gatewayPrivacy.ts:31`; `artifacts/api-server/src/lib/reportComposer/providers/index.ts:30`; live gate: `cloudPayloadPrivacy.ts`

**Current behavior:** `assertGatewayPrivacy` is defined and re-exported from the providers
barrel. It has **zero call sites** in the repository. The live privacy decisions are made by
`cloudPayloadPrivacy.ts` (`cloudTextPhiAllowed`, `deepseekCloudVisionAllowed`).

**Evidence:** `grep -rn "assertGatewayPrivacy" --include=*.ts` excluding `node_modules` and
`dist` returns exactly two hits — the definition and the barrel re-export.

**Clinical consequence:** No direct one. The harm is epistemic: a reader auditing privacy
controls finds two named gates and reasonably concludes both are enforced. An `assert*`
function that is never called asserts nothing. This is the class of dead code that causes
audit findings to be wrong, which is why it is rated above ordinary dead code.

**Recommended correction:** Delete `gatewayPrivacy.ts` and its barrel export, **or** wire it
into the composer provider path if it encodes a policy `cloudPayloadPrivacy.ts` does not. The
decision requires reading both files' intent, not just their reachability — do not delete on
the grep alone.

**Existing architecture to reuse:** `cloudPayloadPrivacy.ts` is the live, measured gate and
is the one to keep.

**Risk of correction:** Very low if wired-or-deleted deliberately; the risk is deleting a
policy that was meant to be stricter than the live one.

---

### RW-11 — `logParityInDev` is imported and never invoked

**Severity:** **P3**
**Class:** G
**File(s):** `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx:118`; `artifacts/diagnostic-erp/src/lib/reportQualityShadow.ts:84`

**Current behavior:** The shadow-parity logger — which would record divergences between the
legacy client validator and the canonical engine — is imported at the top of the workspace
orchestrator and never called. `reportQualityShadow.ts:55` does call `validateReport`
internally, but nothing calls the shadow.

**Evidence:** `grep -rn "logParityInDev"` returns the import and the definition only.

**Clinical consequence:** None directly. The consequence is that the client/server validator
parity the codebase claims to maintain is **not measured at runtime**. RW-04 is precisely a
parity divergence — the client validator and the server engine are starved of `sex` in
different ways — and the instrument built to catch that class of drift is switched off.

**Recommended correction:** Either invoke it in development from the finalize path, or delete
it and the import. A permanently-unused import in a 3,357-line orchestrator is noise that
hides real wiring.

**Existing architecture to reuse:** the function itself, if parity measurement is wanted.

**Risk of correction:** None.

---

### RW-12 — `contrastDependencyWarning` is built, tested and never called

**Severity:** **P2**
**Class:** G
**File(s):** `artifacts/diagnostic-erp/src/lib/mriSpineContradictions.ts:222`; test at `mriSpineContradictions.test.ts:144-146`

**Current behavior:** The function that detects a contrast-dependent claim made against a
non-contrast technique is exported and has passing unit tests. No production code calls it.

**Evidence:** `grep -rn "contrastDependencyWarning"` returns the definition and the test file
only.

**Clinical consequence:** "Post-contrast images demonstrate enhancement" can be signed on a
study whose Technique records no contrast, with no warning. This is contradiction pair 6 in
§15.2 and one of only two named pairs that are built-but-unwired. It is also a
contrast-safety-adjacent check: gadolinium administration is documented in Technique, and a
report implying administration that did not occur is a documented-medication discrepancy.

**Recommended correction:** Call it from the same place the other spine contradiction
functions are called, passing `deriveSpineSequencesAvailable({techniqueText})` exactly as the
unit test does.

**Existing architecture to reuse:** `deriveSpineSequencesAvailable` and the
`contradictionHints` array already assembled at `ReportCanvas.tsx:1358-1365`.

**Risk of correction:** Very low. It can only add a hint to an array that is already capped at
5 for display — which is itself worth raising, since adding a producer to a capped consumer
can crowd out existing hints.

---

### RW-13 — The duplicate-impression rule cannot fire at sign-off

**Severity:** **P3**
**Class:** D
**File(s):** `artifacts/diagnostic-erp/src/lib/reportValidator.ts:65-72`; `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts:129-133`; `artifacts/diagnostic-erp/src/lib/reportQualityFinalize.ts:105`

**Current behavior:** The rule iterates `report.impression` as an array and flags a repeated
element. Both finalize-time callers pass a **single-element array containing the whole
impression joined by newlines**, so the loop runs once and can never find a duplicate.

**Evidence:**
```ts
// useStudyFinalize.ts:129-133
const validationIssues = validateReport({
  findings: live.findingsText,
  impression: [live.impressionText],   // one element
  technique: live.techniqueText,
} as any);
```
```ts
// reportQualityFinalize.ts:105
impression: impressionLine ? [impressionLine] : [],   // one element
```
Contrast the UI callers, which split correctly:
`impressionText.split(/\n+/).map(s => s.trim()).filter(Boolean)`
(`useWorkspaceClinicalUi.tsx:2822`, `ReportCanvas.tsx:1363`).

Note also the `as any` at `useStudyFinalize.ts:133` — the type escape hatch is what allows
the mismatch to compile.

**Clinical consequence:** A duplicated impression line reaches the signed report. Low impact
in isolation, but it is the clearest available demonstration of the pattern this audit keeps
finding: **the same rule receives different inputs at different call sites, and the site that
matters most is fed the least.** The `as any` suppressed the compiler warning that would have
caught it.

**Recommended correction:** Split the impression into lines at both finalize call sites, using
the exact expression the UI callers already use. Remove the `as any` so the compiler enforces
the shape going forward.

**Existing architecture to reuse:** `useWorkspaceClinicalUi.tsx:2822`.

**Risk of correction:** Very low. Will surface duplicate-line warnings that were previously
invisible — expect a small number of new warnings on the first day, which is the point.

---

### RW-14 — Additional orphaned surfaces still bundled

**Severity:** **P4**
**Class:** G
**File(s):** verified by grep, excluding `node_modules` and `dist`

| File | Evidence |
|---|---|
| `artifacts/diagnostic-erp/src/components/RadiologyAICopilotPanel.tsx` | only hits are its own `export default` (`:37`) and a comment in `radiologyFollowUpEngine.ts:9` |
| `artifacts/diagnostic-erp/src/components/RadiologySmartFindingsPanel.tsx` | only hit is its own `export default` (`:37`) |
| `artifacts/diagnostic-erp/src/components/radiology/zai-workspace/viewer-panel.tsx` | no importer at any path form |
| `artifacts/api-server/src/lib/ai/evaluationRunner.ts` | no importer; referenced only in a comment at `lib/ai-providers/src/evaluation.ts:4` |

**Current behavior:** Four components/modules ship in the bundle with no reachable entry
point. Two of them — `RadiologyAICopilotPanel`, `RadiologySmartFindingsPanel` — are named as
AI surfaces.

**Clinical consequence:** None at runtime. The consequence is audit risk: an AI-wiring review
that judges by component names (which this audit's rules explicitly forbid) would conclude
the workspace has an AI copilot panel and a smart-findings panel wired in. It does not.

**Recommended correction:** Delete, or move to a clearly-marked quarantine directory. Extends
RR-53's register.

**Existing architecture to reuse:** n/a.

**Risk of correction:** Very low, but confirm no lazy/dynamic import (`import(...)`) or route
string references them before deleting — the greps above covered static imports and path
strings.

---

## 25. WIRING MATRIX

Legend: **WIRED** end-to-end and verified · **PARTIAL** works on some paths · **NOT WIRED**
built but unreachable · **STALE-RISK** wired but can carry outdated content · **UNKNOWN**
requires a runtime test.

> **These matrices are the as-found record and are deliberately not rewritten.** Remediation
> (§30) closed several of the rows below. Only the rows re-verified during Group E carry a
> strike-through and a commit — `Undo scoped to study` and `Ledger cleared on study switch`,
> both `cd572ea1`. Every other row must be read against §30: RW-01, RW-02, RW-04, RW-05, RW-08
> and RW-13 all appear below as **NOT WIRED**, **PARTIAL** or **STALE-RISK** and are recorded as
> **FIXED** in §29's totals. Annotating them was not attempted here because doing so correctly
> means re-deriving each from source, and a half-annotated matrix is worse than a frozen one —
> it invites a reader to trust the cells that were not touched.

### 23.1 Clinical chain

| Link | Status | Evidence |
|---|---|---|
| Study → store (`selectStudy`) | WIRED (FULL path) / **STALE-RISK** (PARTIAL path) | `store.ts:847`; `useDraftPersistence.ts:157-187` — RW-07 |
| Study → demography | WIRED | `workflow.currentRow`; `canonicalDemography` |
| Demography → quality engine | **NOT WIRED** for sex/age | RW-04 |
| Demography → export/preview | WIRED | `useWorkspaceExportShare.ts:169-174` |
| History → store | WIRED | `store.ts:847`; `useDraftPersistence.ts:332-343` |
| History → AI `/draft` | WIRED | `aiReporting.ts:987,1111-1134` |
| History → signed artifact | **NOT WIRED** | RW-01 |
| Technique → store / draft / preview | WIRED | `useWorkspaceExportShare.ts:151,177` |
| Technique → signed artifact | **NOT WIRED** | RW-01 |
| Technique → contradiction evidence | **NOT WIRED** | RW-12 |
| Findings → Impression (ledger) | WIRED | `store.ts:1663-1677` |
| Findings → Impression (local synthesis) | **PARTIAL** | RW-09 |
| Findings → stale-impression flag (manual write) | WIRED | `store.ts:871-873` |
| Findings → stale-impression flag (`mergeField`) | **NOT WIRED** | RW-05 |
| Findings → Recommendation | **STALE-RISK** | RW-08 |
| Impression → finalize hard gate | WIRED | `observationLedger.ts:608-615` |
| Recommendation → finalize gate | **NOT WIRED** | RW-08 |
| Validation → finalize dialog | WIRED | `useStudyFinalize.ts:151-231` |
| Finalize → `patient_reports.body` | WIRED (lossy) | RW-01 |
| Body → print/PDF/public/WhatsApp/email/PACS | WIRED | `patient-reports.ts:2590-2591` |
| D5 structured finalize | **NOT WIRED in production** (flag off) | `radiologyFeatureFlagRegistry.ts:55-59` |
| D6 structured read | **NOT WIRED in production** (flag off) | `:69-73` |
| Amendment chain + version safeguards | WIRED | `versionSafeguardHtml`, `patient-reports.ts:2545-2568` |

### 23.2 In-workspace AI

| Capability | Status | Evidence |
|---|---|---|
| Ctrl+I sends live Findings | WIRED (fixed since 2026-09-30) | `aiReporting.ts:1003` |
| Ctrl+I result lands as ghost text only | WIRED | `useTriggerAiImpression.ts` |
| Ctrl+I post-await study guard | **NOT WIRED** | §9(b) |
| `/draft` output validation | **NOT WIRED** | RW-03 |
| Composer output validation | WIRED | `validateComposerOutput` |
| Composer pending-gate before finalize | **PARTIAL** (client-only) | RR-37 |
| Provider/model routing via settings | WIRED | `aiReporting.ts:690-706` |
| Permission + enablement gates | WIRED | `:655-660,701-704` |
| Empty-prompt hard failure | WIRED | `:740-745` |
| Privacy honesty (no false redaction claim) | WIRED | `:772-778` |
| AI sees ledger / provenance / measurements | **NOT WIRED** | §12 |
| AI sees sex / age / name | **CONDITIONAL** on `/query` only | `:751-766` |
| `field` intent honoured server-side | **NOT WIRED** | RW-02 |

### 23.3 Safety mechanisms

| Mechanism | Status | Evidence |
|---|---|---|
| Manual-text protection | WIRED | `store.ts:885-905`, `isProtectedManualSentence` |
| Measurement preservation in merge | WIRED | `CLINICAL_GUARDS` |
| Impression order freeze on manual edit | WIRED | `store.ts:877-883` |
| Autosave generation fence | WIRED | `useDraftPersistence.ts` |
| Wrong-patient draft refusal | WIRED (client + server) | `:213-227`; `DRAFT_PATIENT_MISMATCH` |
| Study lock | WIRED | `useStudyLock`, 409 `LOCKED_BY_OTHER` |
| Dirty-leave guard on every nav ref | WIRED | `:559-588` |
| Undo scoped to study | ~~**NOT WIRED**~~ → **WIRED** in `cd572ea1` | RW-06, §30.9 |
| Ledger cleared on study switch | ~~**PARTIAL**~~ → **WIRED** in `cd572ea1` | RW-07, §30.9 |
| Signed-report immutability | **PARTIAL** | RR-01 |
| Critical-flag immutability | **NOT WIRED** | RR-02 |
| Q109 gender/anatomy | **NOT WIRED** | RW-04 |
| Duplicate impression line at finalize | **NOT WIRED** | RW-13 |
| Laterality vs study description (client) | **NOT WIRED** | §5 |
| Region-specific contradictions (6 regions) | WIRED | §15.1 |
| Region-specific contradictions (USG/CT/other) | **NOT WIRED** (absent) | §15.1 |
| Runtime validator parity measurement | **NOT WIRED** | RW-11 |
| HOPE emit success honesty | **PARTIAL** | RR-62; `useStudyFinalize.ts:310-326` |

---

## 26. VERDICT

**A. Is the workspace one coherent clinical reporting system?**
**Yes, with one structural seam.** From study open to sign-off there is a single authored
state, a single ledger, a single provenance map and a single finalize gauntlet. The seam is
between the **draft artifact** and the **signed artifact**: they are built by different code
from different field sets, and the signed one is missing two sections (RW-01). Everything
before that seam is coherent; everything after it inherits the omission.

**B. Is the report state a single source of truth?**
**While drafting, yes.** The five narrative fields plus `fieldProvenance` plus
`appliedPathologyPatches` in the module-scope Zustand store are canonical, and the debounced
mirror explicitly refuses to be a second truth. **At sign-off, no** — `patient_reports.body`
becomes an independent, lossy snapshot that no longer agrees with the draft it came from.
Eight duplicate-source pairs are registered at §3.2; two are consequential (D-2, D-5).

**C. Does the clinical chain hold end to end?**
**It holds through Recommendation and breaks at Final Report.** Nine of ten transitions carry
their content forward. The Validation → Final Report transition drops Technique and Clinical
History, and the Recommendation → Validation transition has no gate at all (RW-08).

**D. Is the in-workspace AI correctly wired?**
**Structurally yes, and its safety posture is better than the rest of the finalize path.**
Every AI route is proposal-only; there is no silent-overwrite path (§14). Provider routing is
settings-driven, permissions are enforced, an empty prompt hard-fails, and the privacy banner
is honest about a redaction step that does not run. Three gaps: `/draft` output is unvalidated
while the composer's is (RW-03), Ctrl+I has no post-await study guard (§9b), and the AI never
sees the ledger, the provenance map or structured measurements (§12) — so it is asked to
summarise Findings without being told which sentences the radiologist authored.

**E. Does the AI see what the UI shows?**
**No.** Of seventeen data classes checked, five are transmitted to `/draft`, one
conditionally to `/query`, and seven to the quality engine. Sex, age, name, measurements,
ledger, provenance and prior reports do not reach `/draft` at all. §12 is the authoritative
table; the headline is that **the AI is asked to write an Impression without knowing the
patient's sex**, which is the same omission that disables Q109 (RW-04).

**F. Are manual radiologist texts protected?**
**Yes, and this is the strongest result in the audit.** Protection operates at the store
level, so no UI component can bypass it: a patch whose contribution has been hand-edited is
marked `protected` (`store.ts:885-905`), a hand-reordered impression freezes automatic
sorting (`:877-883`), measurements survive merges via `CLINICAL_GUARDS`, and the ledger
*"NEVER auto-deletes"* (`observationLedger.ts:631`). One inversion exists: hand-typed text can
be *classified* as machine text and thereby lose protection (RR-12) — a provenance-stamping
default, not an overwrite path.

**G. Can state leak across patients?**
**Yes, on one confirmed path.** The five narrative texts are correctly cleared on every
navigation path, and the autosave guards are genuinely strong. The undo stack, the
observation ledger, measurements, numbering, screening and vascular technique are **not**
cleared by the PARTIAL reset (RW-06, RW-07). The reachable sequence is browser Back/Forward
or a deep link, then Ctrl+Shift+Z. Rated P1.

> **Re-run after `cd572ea1` (§30.9): No, on any path this audit found.** The answer above was
> also incomplete — it named one path when there were three, and the third (end of queue) was
> reachable by simply finishing the list, not by any unusual navigation. All three now spread
> one 61-field definition, and the undo stack independently refuses a frame stamped with a
> different study. The residual exposure is the PARTIAL path's proof strength: it is asserted by
> source contract, not by driving the effect, because this repo has no DOM (§30.9, "Strength of
> proof"). **RW-27 reopens a different cross-patient question in the same verdict** — the
> `notification` slot survives all three resets, so an undismissed critical card carries Patient
> A's finding over Patient B's referring doctor.

**H. Is the final report intact across all consumers?**
**No.** All five consumers faithfully render the same string — which is the correct
architecture — but that string is missing Technique and Clinical History (RW-01). The client
jsPDF path additionally omits the critical banner and report number and substitutes a
hard-coded default signer (RR-21). Print/PDF/public/WhatsApp/email/PACS therefore agree with
each other and disagree with what the radiologist reviewed.

**I. Is validation effective at sign-off?**
**Partially, and the shortfall is systematic.** The canonical engine runs, persists, and its
blocking count reaches the dialog. The stale-impression gate genuinely hard-blocks. But the
client validator receives 3 of its 8 inputs with the impression malformed as a single-element
array (RW-13), the server engine receives no `sex` (RW-04), contradiction modules exist for
6 of the clinic's study types (§15.1), and no rule anywhere compares Recommendation against
Findings (RW-08). **A report whose impression contradicts its findings can still be signed —
that remains a product decision rather than a coding error (RR-17), but the decision is now
being made with fewer of the built rules actually running than the codebase implies.**

**J. The smallest coherent set of fixes.**

Four changes, in this order. Three are single-file. None requires a schema change, a new
subsystem, or the removal of any existing behaviour.

1. **RW-01 — put Technique and Clinical History in the signed body.**
   One string builder at `useStudyFinalize.ts:260-263`, reusing `buildLivePrintBodyHtml` so
   the preview and the artifact become structurally identical. Fixes the issued document for
   every consumer at once. *Newly signed reports only; historical rows untouched.*

2. **RW-04 — send `sex` to the quality engine.**
   Two lines in `buildWorkspaceQualityRequest` (`reportQualityFinalize.ts:85-115`) and one at
   the call site (`useStudyFinalize.ts:151-161`). Revives a catalogued, implemented,
   unit-tested wrong-patient-detector that is currently unreachable. Highest value per line
   in this audit.

3. **RW-06 + RW-07 — scope the clinical reset and the undo stack to the study.**
   Extract the FULL reset's field list (`store.ts:847`) into a shared `emptyClinicalState()`,
   call it from the PARTIAL reset (`useDraftPersistence.ts:157-187`), and stamp
   `activeStudyId` onto the undo snapshot so `undoLastPatch` can refuse a cross-study pop.
   Closes the only confirmed cross-patient write path.
   **DONE in `cd572ea1`, §30.9** — as recommended, plus a third caller this entry did not know
   about (`advanceToNextStudy`'s end-of-queue branch) and a surfaced refusal toast. The
   extraction proved worth doing exactly as specified: the `Pick<WorkspaceStore, …>` typing is
   what makes a future field addition a compile error rather than a leak.

4. **RW-05 + RW-13 — arm the stale flag on `mergeField`, and split the impression at finalize.**
   Two conditionals mirroring `store.ts:871-876`; two `.split(/\n+/)` expressions copied from
   `useWorkspaceClinicalUi.tsx:2822`; delete one `as any`. Makes the two gates that already
   exist actually see the content they were built to judge.

**Deliberately excluded from the minimal set,** because each is a policy decision rather than
a defect and should not ride along with the above: making any contradiction blocking (RR-17),
replacing `generateLocalImpression`'s normality assertion (RW-09 — recommended as a
provenance stamp, not a removal), the signed-report immutability controls (RR-01, RR-02 —
these need a database trigger and a decision about amendment workflow), and the D5/D6 flag
rollout (correctly designed, correctly gated, and a deployment choice rather than a fix).

---

## 27. UNKNOWN — RUNTIME TEST REQUIRED

Stated rather than guessed. This box has no database and no tailnet, so none of the following
could be settled by reading.

| # | Question | Why it cannot be settled statically | Test |
|---|---|---|---|
| U-1 | Are `ff_radiology_structured_final` / `_read` actually off in the clinic's database? | Registry says `defaultValue: false`; the live value is a row in the flags table | `SELECT key, enabled FROM radiology_feature_flags WHERE key LIKE 'ff_radiology_structured%';` |
| U-2 | Do any production `patient_reports.body` values already contain Technique? | Older code paths or the Reporting Studio route may have written a fuller body | `SELECT count(*) FROM patient_reports WHERE type='radiology' AND body ILIKE '%<b>Technique%';` |
| U-3 | What values does `patients.gender` actually hold? | RW-04's `startsWith("F")` normalisation depends on it; `reportValidator.ts:236-240` records that a strict check was silently dead once already | `SELECT gender, count(*) FROM patients GROUP BY 1;` |
| U-4 | Has a cross-patient undo ever occurred? | The leak is confirmed in code; occurrence is a runtime fact | Search `radiology_report_drafts.structured_json` for a ledger whose slot identities do not match the study's body part |
| U-5 | How often is the stale-impression gate acknowledged rather than refreshed? | Determines whether RW-05's added friction is tolerable | Query the finalize dialog's acknowledgement path in the audit tables |
| U-6 | Does `/draft` time out in practice against the clinic's local model? | `:1136` records the timeout is not applied; the observed latency is a runtime property | Time ten Ctrl+I presses on the NAS |
| U-7 | Is `assertGatewayPrivacy` a stricter policy than `cloudPayloadPrivacy`? | Requires reading intent, not reachability | Diff the two files' conditions before deleting (RW-10) |

---

## 28. REVISIONS AND SELF-CORRECTIONS

Recorded explicitly, per the standing audit rule.

| # | Initial position | Revised to | Why |
|---|---|---|---|
| C-1 | A grep for `gatewayPrivacy`, `evaluationRunner` and `viewer-panel` returned nothing, suggesting the subagent had invented these files. | All three **exist**; the grep was run from `artifacts/diagnostic-erp/src`, not the repo root. | The shell's working directory persisted from a previous command. Re-run from the root, all three were found and confirmed dead. **This is the second time in this audit programme that a wrong working directory produced a confident wrong answer** — every grep here was subsequently re-run with an explicit path. |
| C-2 | "The signed body omission may be covered by the D6 structured read." | It is not: `ff_radiology_structured_read` has `defaultValue: false` and depends on a flag that is also false. | Read the registry rather than assuming the flag state. RW-01 stands as production-live, with U-1 as the one runtime check that could soften it. |
| C-3 | "The print renderer's `sectionOrder: Technique,Findings,Impression` means Technique is rendered from somewhere." | The renderer receives `bodyHtml: displayBody` and no separate technique field. The style flags arrange sections that were never supplied. | Traced the renderer's actual parameter list instead of inferring from the style model. Sharpened RW-01 from "may be missing" to "cannot be present". |
| C-4 | "Q109 might be fed server-side from the draft's patient." | `POST /evaluate` does no patient or draft lookup; it passes `text` straight to the engine. | Read `reportQuality.ts:238-251` before publishing. Without this check RW-04 would have been a false positive. |
| C-5 | Initially treated `mergeField`'s missing staleness arming as a duplicate of RR-38. | They are distinct: RR-38 is about the `isFinalized` guard covering voice only; RW-05 is about `impressionNeedsRefresh` never being armed. | Re-read `store.ts:915-947` in full. Both stand. |
| C-6 | Assumed the prior audit's RR-36 (Ctrl+I dropping findings) was still open. | **FIXED.** `aiReporting.ts:1003` now reads `reportBody ?? findings`, and an empty prompt hard-fails at `:740-745`. | Verified against source rather than carrying the register forward. Recorded in §23 so the register does not keep a resolved item alive. |
| C-7 | Wrote a Group C finding as *"`DicomViewer`'s AI tab calls `/draft`, receives the new verdict and does not render it."* | `DicomViewer` never calls `/draft`. It calls `queryAiReporting` → `POST /query` (`:168`), which has **no** validation. The real finding is the opposite and more serious (RW-24). | Caught by enumerating every `/api/ai-reporting/draft` caller repo-wide before publishing, instead of trusting a plausible reading of one page. **Third instance in this programme of a confident claim about a caller that was never grepped** — see C-1. The corrected finding also produced RW-25, which the wrong version would have hidden. |
| C-8 | Carried `AGENTS.md`'s statement that the React frontends fail typecheck on `calendar.tsx` / `spinner.tsx` (duplicate `@types/react`). | Measured clean: `pnpm --filter @workspace/diagnostic-erp exec tsc --noEmit` exits 0 with no diagnostics, and `--listFiles` shows 1,988 files actually compiled. `AGENTS.md` is stale on this point. | Ran the command rather than citing the doc. Recorded so a future pass does not file a real ERP typecheck error as "pre-existing". |
| C-9 | Applied the first Group D mutation with `perl -0pi -e` and read a 26/26 green run as evidence the tests were weak against that mutation. | The mutation had not applied at all. `diff -q` against a `/tmp` backup showed the file byte-identical; the green run proved nothing about the tests. | A multi-line `-0pi` pattern that silently matches nothing is indistinguishable, from the test output alone, from a mutation the tests survive. Every later mutation was applied with an editor operation that errors when its target text is absent, and every file was `diff -q`'d back to its backup afterwards. Mutation results are only evidence if the mutation landed. |
| C-10 | Assumed C-9 was a one-off quirk of multi-line patterns. | A single-line `perl -ni -e 'print unless /^\s*…$/'` also left its target line in place. On a synthetic identical line the same anchored regex matched, and an unanchored variant did delete the real line; `od -c` showed pure LF with no CR, so the cause was never established. | Stopped diagnosing the tool and switched to one whose success is verifiable by construction. **The pattern across C-1, C-7, C-9 and C-10 is the same one: a command or grep that reported success while having done nothing, trusted because the surrounding output looked like confirmation.** Every load-bearing claim in §30 is now backed by a check that would fail if the step had not happened. |
| C-11 | §2.2 recorded *"There are exactly **two** reset paths"*; RW-07 recorded *"two hand-maintained lists of ~45 fields."* | There are **three**, and the counts are **65**, **16** and **4**. The third — `advanceToNextStudy`'s end-of-queue branch, `store.ts:1086` at base — cleared 4 clinical fields and fires when the last study in the queue is signed, i.e. at the normal end of a reporting session. | §2.2 was written by reading the two paths that RW-06 and RW-07 name, not by enumerating every `set({...})` in the store that clears clinical fields. The counts were estimates until Group E parsed each literal at `bc8ca8c5` and diffed the key sets. **A register entry that says "two" is an instruction to the next reader to stop looking after two** — the third path stayed invisible for the whole audit pass because the audit had already told itself the enumeration was complete. |
| C-12 | Attributed C-9/C-10 to an unexplained quirk of the editing tool. | Cause established: `core.autocrlf=true` with no `.gitattributes` covering source. Pre-existing files are CRLF in the working tree while patterns written by an editor operation are LF, so a multi-line pattern silently matches nothing. 4 of the first 13 Group E mutations reported "PATTERN NOT FOUND"; the single mutation targeting a newly-created (LF) file matched, which is what isolated the cause. | Recorded because C-10 explicitly left it unresolved and because the fix is a standing rule for this repo, not a one-off: **any script that pattern-matches multi-line source text on this box must normalise `\n` → `\r\n` first.** A runner that reports "not found" for a third of its table and is not read is indistinguishable from a green run. |
| C-13 | Wrote the Group E idempotent-path test as one lazy regex spanning guard branch → `cancelFinalize()` → `else` → `draftBackup.clear()`, and read a green run as proof the two branches were correctly separated. | Mutation M7 — moving the destructive completion side-effects *into* the guard branch — was **not caught**. `[\s\S]*?` simply jumped ahead to the copies still present in the `else`. | A lazy quantifier spanning two branches asserts that the tokens appear *in that order somewhere*, not that each is in the right one. Rewritten to slice the guard branch and the else branch separately and assert the guard branch **negatively** for all five side-effects, with the reason left in the test's own comment. The mutation was kept, not discarded: M7b/M7c/M7d now catch three further variants. |
| C-14 | Drafted RW-30's before/after table from working notes: *"`studyLock.enabled` read `worklistDetailQ` → `status`; `contentLocked` and `draftBackup` read the queue row."* | False, and provably so. At base **all three** read `workflow.currentRow.status`; `worklistDetailQ` was declared at `:2280`, *below* every one of them, so none of them could have referenced it — a `const` in the same function body. The real defect is two-fold: three hand-written reads of a stale list row, and only one of the three honouring `DELIVERED`. | Caught by `git show bc8ca8c5:… \| sed -n` on the three base sites before publishing, which is the check C-7 should have made unnecessary. **The error came from carrying a summary forward instead of re-reading the base** — the same failure mode as C-1 and C-7 wearing a different costume: the notes looked like confirmation because they were specific. Every before/after claim in §30.9 was subsequently re-derived from `bc8ca8c5` and `cd572ea1` directly. Two other numbers in the same draft were wrong the same way and were corrected the same way: the leaf module is **181** lines, not 182, and the `undoLastPatch()).toBe(true)` assertions number **20 across 17 files**, not 24. |
| C-15 | Opened Group F from a coverage survey that reported scenario 1 (male+uterus / female+prostate) as *"PARTIAL — no engine-level test that Q109 actually emits"* and scenarios 9 and 10 (`/draft` grounding, malformed output) as PARTIAL. | All three were already covered. `lib/report-quality/src/text/evaluate.demography.test.ts:23-85` is a six-test describe **named for Q109** asserting `toContain("Q109")` on the engine's own output; `aiReporting.query.test.ts:551-633` is a five-test describe on `/draft` grounding including `:580`'s `unsupported_abnormality`. Executed: 61 tests, all passing. | Two indirect signals were trusted instead of the files. The survey grepped for the rule id on the *client* side, and looked for a file matching `aiReporting.draft*` — which does not exist, because the `/draft` route tests live in a file named for `/query`. **Same failure mode as C-1, C-7 and C-14: a specific-looking conclusion carried forward from something that was not the source.** It cost nothing only because the survey was treated as a hypothesis to verify rather than a work list; treated as a work list it would have produced three duplicate test files and buried the one live defect (scenario 11) among twelve items that were already done. |
| C-16 | Asserted the finalize gauntlet's order with the needle `finalizeRadiologyReport` and read the passing test as proof the gate runs before signing. | Vacuous. The needle's first occurrence is the **import** at `useStudyFinalize.ts:12`, so the ordering claim compared the gate against an import line and could not have failed for the reason it was written to detect. | Caught by writing the mutation table before believing the run — M3 and M4 both passed through this assertion untouched. The needle now names the call site, `await finalizeRadiologyReport(`. **An ordering assertion whose needle appears twice in the file asserts nothing about the second occurrence**, and `indexOf` finds the first. |
| C-17 | While editing this table to add C-15 and C-16, replaced the C-14 row with them instead of appending after it — deleting a self-correction entry from the audit's own record of self-corrections. | Caught before committing, by re-reading the edited region rather than trusting the edit's success report. C-14 is restored above and the two new rows follow it. | An edit tool reporting "1 replacement" confirms that *a* substitution happened, not that the substitution was the intended one. The failure is only visible by reading the result. It is recorded here because §28 exists precisely to log this class of error, and because deleting an entry from a corrections table is the one edit that makes the table look *more* consistent than the work actually was. |
| C-18 | Built the baseline worktree for §30.11 and ran a loop that junctioned all 20 `node_modules` directories into it. The loop printed `OK` twenty times. | It had created **nothing**. `ls -ld <worktree>/node_modules` returned "No such file or directory", and the first baseline run died with `Cannot find module 'vitest/config'` after `npx` fell back to a cached vite. Cause: under `MSYS_NO_PATHCONV=1`, `cmd //c` passes the literal `//c`, which cmd does not treat as its command switch — it exits 0 having parsed nothing. | **The fifth instance of the C-1/C-7/C-9/C-10/C-14 pattern: a step that reported success while having done nothing.** This one is the most dangerous of the five, because the loop's own `&& echo OK` was the confirmation and there was no second signal to contradict it. Caught only because the baseline's *output* was read instead of its exit code. Two standing rules follow: verify a filesystem mutation by listing the result, never by the exit status of the command that made it; and in a worktree junctioned to the main tree, invoke the local binary (`node ./node_modules/vitest/vitest.mjs`) rather than `npx`, which resolves against a cache and hides the fact that the junction is missing. |
| C-19 | Diffed the baseline and branch-head failing-file sets and reported **85 files failing only at head** and **87 failing only at baseline** — which read as a catastrophic regression in one column and an implausible mass fix in the other. | The true answer was **1 and 0**. Both sides were fed to `comm` after different normalisations: one list had vitest's ` > test name` suffix stripped and the other still carried the ` [ path ]` suffix that vitest appends to collection failures, so almost every line differed textually while naming the same file. | Two sorted lists and a `comm` produce output that looks exactly like a result. **A set comparison is only as sound as the normalisation applied to both sides, and the normalisation is the part nobody reads.** The tell was in the numbers themselves — 85 "regressions" against a 40-file diff, and 87 "fixes" in packages this branch does not touch — but the tell was only noticed because the output was implausible enough to re-derive. The corrected comparison re-normalises both sides through one function, and its answer (1 new failing file, 0 files newly passing, the same 7 files failing at test level on both revisions) is consistent with the diff. |
| C-20 | §29's totals blockquote stated the register holds **98 recorded findings: 19 fixed, 2 partially addressed, and 77 still open.** | The open count is **74**, not 77. 98 − 19 − 2 = 77 is arithmetically correct and substantively wrong, because the "fixed" list enumerates **RW entries only** while the subtraction is applied to **all 98**. The same blockquote's next sentence names three prior-register findings that also closed — RR-06, RR-20 and RR-36 — and none of the three is ever subtracted. Closed is 22, partial is 2, open is 98 − 22 − 2 = **74**. | Found while extracting the register for §30's closure matrix, which required an enumerated row per finding rather than a total. **A total that is never enumerated cannot be checked against the list it summarises**, and here the two halves of one paragraph disagreed while each read as self-consistent. This is the counting analogue of the C-1/C-7/C-14 pattern: the number looked like confirmation because it was specific and because it was adjacent to the sentence that falsified it. It is a benign-direction error — it understates closed findings by three and overstates open ones by the same — but it is recorded rather than silently corrected, because §29's blockquote is the paragraph a reader is most likely to quote, and because the correction is only trustworthy if the three RR closures are themselves enumerated in §23 where they can be checked. |
| C-21 | Re-verified all 48 register findings this branch never touched, on the assumption that each entry's `file:line` citation could be taken as the starting point. | **Seven citations could not.** Five name the wrong file or the wrong route and were wrong when written: RR-09 and RR-64 both cite `radiologyCopilot.ts:111-125`, which is the `POST /log` handler (verified: `radiologyCopilot.ts:112-113`, file is 229 lines) — the prior-studies select they describe is `:84-100` with `mergePriorStudies` at `:103`; RR-26 cites `useOhifViewerBridge.ts:350-353`, which holds `invalidateQueries`/`toast` callbacks, while the label→level parse is `resolvePersistedCanalLevel` at `structuredViewerMeasurements.ts:350-352`; RR-60 cites `viewerService.ts:357-368` for a `viewer.ohif.org` launch, and those lines are `getWeasisUrl`'s raw `weasis://$dicom:get` splice; RR-63 cites `radiologyReportVersion.ts:409-416` in a file that is 348 lines long — the code is `effectiveResolveMode` at `patient-reports.ts:409-416`, same line numbers, different file. Two more are correct but have drifted: RR-11's `radiologyWorkspaceSafety.ts:23` is now `:42` **because this branch's own `9c010fe7` inserted `shouldApplyAsyncStudyKey` above it**, and RW-23's `useWorkspaceClinicalUi.tsx:2175-2182` is the mid-branch vintage `21021ff6`–`1be8252b` (base `:2161-2167`, head `:2206-2216`). | Every one of the seven was found by opening the cited line rather than by reasoning about the finding, and **in all seven the finding itself survives** — the defect is real, the address is not. That is the dangerous combination: a correct finding behind a wrong citation is unfalsifiable by spot-check, so a reader who opens the line, sees unrelated code, and concludes the audit was sloppy will discount a true defect along with a false one. Two standing rules follow. First, **a register citation must name the revision it was read at**, because a remediation branch moves lines in the very files it cites — RR-11 is this branch invalidating this branch's own citation. Second, **the five wrong-file rows are a different failure from the two drifts and were not caused by editing**: they are the C-1/C-7/C-14 pattern at the citation level, a specific-looking address carried forward from a plausible neighbour (`radiologyReportVersion.ts` for `patient-reports.ts`, `useOhifViewerBridge.ts` for `structuredViewerMeasurements.ts`) and never opened. The §30 matrix therefore cites head-of-branch line numbers throughout, and re-states each of the seven against its verified site. |

---

## 29. PRIORITIZED FINDINGS

New findings from this pass, with the still-open prior findings that share a mechanism.

| Priority | ID | Title | Class | Effort |
|---|---|---|---|---|
| **P1** | RW-01 | Signed report omits Technique and Clinical History | D | S — one builder |
| **P1** | RW-04 | Q109 gender/anatomy rule unreachable (no `sex` sent) | G | XS — three lines |
| **P1** | RW-06 | Undo snapshot has no study identity | D | S — two layers |
| **P1** | RW-07 | Partial reset leaves ledger, measurements, protocol state | D | S — one shared helper |
| **P1** | RR-01 | Signed report in-place mutable, no audit row | D | L — needs a trigger |
| **P1** | RR-02 | Critical flag + acknowledgement clearable | D | M |
| **P1** | RR-03 | Signing identity caller-supplied on a key-auth route | D | M |
| **P1** | RR-20 | `isFinalized` session-only; re-finalize returns the old report | R | M |
| **P2** | RW-05 | `mergeField` never arms the stale-impression gate | D | XS — two conditionals |
| **P2** | RW-08 | Obsolete Recommendation survives into the signed report | D | M — advisory only |
| **P2** | RW-09 | Regex miss can assert "No significant abnormality" | R | M |
| **P2** | RW-03 | `/draft` output unvalidated while the composer's is | R | M |
| **P2** | RW-10 | Second privacy gate exported and never called | G | XS — decide, then delete or wire |
| **P2** | RW-12 | `contrastDependencyWarning` built, tested, never called | G | XS — one call |
| **P2** | RR-07 | Format merge destroys ledger and undo together | D | M |
| **P2** | RR-12 | Hand-typed text classifiable as machine text | D | M |
| **P2** | RR-15/16 | Merger and voice plan can delete a sentence with no diff | D | M |
| **P2** | RR-37 | AI-pending finalize gate is client-only | R | M |
| **P3** | RW-02 | `field` posted and never read | G | XS |
| **P3** | RW-13 | Duplicate-impression rule cannot fire at finalize | D | XS |
| **P3** | RW-11 | `logParityInDev` imported, never invoked | G | XS |
| **P4** | RW-14 | Four orphaned surfaces still bundled | G | S |
| **P4** | RR-53/54/55 | Prior orphan/duplication/`@ts-nocheck` register | G | — |

**Totals for this pass:** 14 new findings — **0 P0, 4 P1, 6 P2, 3 P3, 1 P4**.
Classes: D 6 (RW-01, 05, 06, 07, 08, 13), G 6 (RW-02, 04, 10, 11, 12, 14), R 2 (RW-03, 09).
Combined with the 2026-09-30 register (3 P0, 19 P1, 20 P2, 17 P3, 5 P4), the workspace stands
at **3 P0, 23 P1, 26 P2, 20 P3, 6 P4** — 78 findings.

**No new P0.** The three P0s in the register are all from the prior audit (RR-01, RR-02,
RR-03) and all concern the immutability and attribution of an already-signed report. Nothing
found in this pass can cause wrong-patient care on a normal path — the cross-patient leak
(RW-06) requires an unusual-but-reachable navigation sequence, and every AI route remains
proposal-only.

> **These totals are the audit pass only, and reading them alone understates the position.**
> Remediation (§30) found twenty further findings while fixing — RW-15 to RW-22 across Groups A
> and B, RW-23 (**P1**), RW-24 and RW-25 during Group C, RW-26 during Group D, RW-27 (**P1**),
> RW-28 (**P1**), RW-29 and RW-30 during Group E, and RW-31, RW-32, RW-33 and RW-34 during
> Group F. The register therefore holds **98 recorded findings**: **22 closed** — 19 RW (RW-01,
> RW-02, RW-03, RW-04, RW-05, RW-06, RW-07, RW-08, RW-13, RW-15, RW-16, RW-17, RW-18, RW-23,
> RW-29, RW-30, RW-31, RW-32, RW-34) and 3 RR (RR-06, RR-20, RR-36) — **2 partially addressed**
> (RW-19 false docstring corrected, semantics left alone; RW-22 misleading comments corrected, no
> behaviour change), and **74 still open**.
> *Corrected from "19 fixed / 77 still open" — see C-20. The earlier figure subtracted an
> RW-only closed list from the full 98, so the three prior-register closures below were never
> taken off the open count.*
> Two of the three RR closures happened in Group E and are marked in §23: **RR-06** (→ RW-06) and
> **RR-20**. RR-36 closed before this pass (C-6). **All three P0s
> (RR-01, RR-02, RR-03) remain open** and none is reachable from a client-isolation group.
> RW-23 is a new P1 that this pass missed: the next-study preload was storing invented AI
> drafts against studies nobody had opened. The "every AI route remains proposal-only" line
> above is now qualified by RW-24 (`/query` output is unvalidated and `DicomViewer` offers it
> as report text) and RW-25 (an audit column that asserts an insertion no code performs).
> Neither is an overwrite risk — both are honesty risks in the record.
> RW-05's fix was wider than its own entry recommended (§30.8): the arming predicate it said
> to mirror was itself source-keyed, so `setField` needed changing too. RW-08's fix is
> narrower than its entry proposed — unowned advice is deliberately not named — and reaches
> the signer at the finalize dialog only, not live in the workspace banner.
> **The "no new P0" line above is now qualified by RW-27**, which found two P1s in the
> critical-finding path while verifying that Group E's undo refusal could not be delivered on
> the notification channel: one benign formatting action can permanently suppress the critical
> interrupt *and* its SLA timer for every subsequent patient in the tab, and the dialog that
> offers to log the critical-results call logs nothing. Neither can issue a wrong report — the
> copilot sidebar and the finalize gate both still fire — but both are honesty failures in the
> one place the workspace claims to protect.
> **Group F closed §22's scenario E, the last open trace scenario with a live defect behind it**
> (RW-31). It also found that §17's own canonical example — *"AI must not casually rewrite
> `8.7 mm` as `8 mm`"* — had a guard in the code and **no test anywhere in the repository**
> (RW-34), and that two of the four clinical merge guards have no test capable of failing when
> they are deleted (RW-33). Deleting the laterality or the spine-level guard row turns the whole
> ERP suite green; the word-subsequence check does the work those two rows appear to do. The
> behaviour is correct. The tests that claim to prove it are not, and §23's list of covered
> failure modes was overstated by exactly that much until this group measured it.

---

## 30. REMEDIATION LOG — GROUPS A, B, C, D, E AND F

This section is a delta on §24's register, written after the fixes landed. It records
what was changed, the new findings the change exposed, and the rule-reachability
matrix the task's §4 demands. Line numbers are as of `21021ff6` for §30.1–§30.6, as
of `1be8252b` for §30.7, as of `df7e024b` for §30.8, and as of `cd572ea1` for §30.9
and §30.10 except where a §30.10 citation names a line this group created.
Sites quoted in §30.9 and §30.10 with the phrase *"at base"* are as of `bc8ca8c5`, the branch point.
§30.11 quotes whole-suite measurements taken at `bc8ca8c5` and at `9c010fe7` on the same machine
and the same invocation, and is the only section here whose numbers come from two trees rather than one.

### 30.1 Group A — the signed artifact (`6e921f04`)

RW-01 fixed by **reuse**, not by a second builder. `buildSignedReportBodyHtml`
(`lib/radiologyReportPrintLiveMerge.ts`) delegates to the existing
`buildLivePrintBodyHtml`, so the stored body and the pre-sign print preview are now
produced by one function and cannot diverge. Clinical History, Technique and
Recommendation reach the signed report, its PDF, the WhatsApp link and the PACS
archive. Newly signed reports only; historical rows are not rewritten.

A stale-map guard is included: per-region structured headings are used only while
`findingsMapToText(findingsMap) === findingsText`. The map→text sync is one-way
(`useWorkspaceClinicalUi.tsx:954-960`), so a map left stale by direct typing must
never be what gets signed — the text is what every gate evaluated.

**New findings this exposed:**

**RW-15 — P2, class D. The Impression printed twice on every signed radiology document.**
`patient-reports.ts:2775` passed the `impression` *column* into `renderReportDocument`,
which renders it as a `.impression` highlight box (`reportPresentation.ts:1036`) and
then renders `bodyHtml` (`:1038`) — which already contains an Impression section.
Fixed at the model-construction site only:
`impression: r.type === "radiology" ? null : r.impression`. The DB column is
untouched, so `FollowUpPanel`'s "Copy impression" and `RadiologyCommandCenter.tsx:1354`
still work, and `renderReportDocument`'s contract and its tests
(`reportPresentation.test.ts:321,326`) stay intact. Non-radiology report types keep
the box. Proven by `patient-reports.d8.test.ts`.

**RW-16 — P3, class D. The study title printed twice.** The finalize payload built its
own `<h2>${title}</h2>` while `renderReportDocument` also renders `.study-title-bar`
(`reportPresentation.ts:1031`). The new builder emits no title; the assertion is that
`class="study-title-bar"` appears exactly once and no `<h2>` carries the title.

**RW-17 — P2, class D. `FollowUpPanel` treated signed report HTML as narrative text.**
A prior report's `body` is one of five different HTML shapes (§18), not findings prose.
The comparison panel and the timeline both fed raw `body` into a sentence differ and
into the DOM. Fixed by routing both through a new `parseStoredReportBody`
(`lib/storedReportBody.ts`), the one place that knows the five shapes; 17 tests.
In scope because Group A changes the stored shape.

**RW-18 — P2, class D. The finalize mirror validator was starved behind an `as any`.**
`useStudyFinalize.ts` called `validateReport` with 3 of its 9 inputs, cast to `any`
to silence the type error. Recommendation, clinical history, sex, age, modality and
study description were all absent, so Q004, Q005, Q107–Q114 could not fire there.
Cast removed, all nine passed. Fixed in Group B.

**RW-19 — P3, class G. "Copy findings" replaces, it does not merge.**
`ReportingToolsRail.tsx:1013` wires `onCopyFindings` to `setField` — a wholesale
replace of the radiologist's Findings, attributed as a manual edit, with no undo
snapshot. `FollowUpPanel`'s docstring claimed a "dedupe-safe merge". The false
docstring is corrected; the replace-vs-merge semantics are left alone and raised in
§31 as an owner decision.

**RW-20 — P4, class G.** `useWorkspaceClinicalUi.tsx:120` imports `runFinalizeQualityEvaluation`
and never calls it (the call moved into `useStudyFinalize`). Dead import, still bundled.

### 30.2 Group B — demography reaches safety logic (`21021ff6`)

RW-04 fixed at three layers, reusing what already exists:

1. **Server, canonical and overriding.** `resolveDraftDemography`
   (`reportQuality.ts:185-222`) resolves sex and age from the draft's DICOM worklist
   row, falling back to the patient master, and `POST /evaluate` (`:309-314`) lets
   that value **override** `body.text`. This is the clinically important half: a
   caller-supplied `sex: "M"` on a female patient's report is precisely the value
   that silences Q109, so trusting the caller would let the mistake the rule exists
   to catch also switch the rule off.
2. **Shared normalizer, not a new one.** Sex passes through `sanitizeDicomSex`
   (`lib/pathology/src/dicomSex.ts`), already used by the worklist poller
   (`orthancChangesPoller.ts:332`), by `internal-radiology.ts:466,2627` and by the
   client's own `reportDemography.ts:47`. A free-text `patients.gender` such as
   `"Mrs"` resolves to *no sex* rather than being read as male — `"MRS".startsWith("M")`
   is true, so passing it raw would raise a gender contradiction against female
   anatomy that is correct for that patient.
3. **Client fallback.** `buildWorkspaceQualityRequest` now accepts `sex`/`age`, and
   finalize passes the merged `canonicalDemography`. It reaches the hook through a
   ref + stable getter because `canonicalDemography` is assembled ~840 lines *below*
   the `useStudyFinalize` call, so a captured value would always be null.

RW-13 fixed: the impression was sent as **one array element** holding the whole
field, so Q102 (`care.text.consistency.duplicate-impression-line`) had no pair to
compare and could never fire at sign-off. Now split one element per point, matching
how the report renders them. Applied to the mirror validator too, so the two callers
do not disagree about the same text.

**RW-21 — P2, class G. Q007 (required measurement missing) is dead end to end.**
`missingRequiredMeasurements` appears in four signatures
(`copilotOrchestrator.ts:75`, `finalizeSafety.ts:32`, `reportQualityFinalize.ts:104`,
`reportValidator.ts:349`) and in three pass-throughs — and **nothing ever produces a
value for it**. No production call site supplies it, so `input.missingRequiredMeasurements?.length`
(`text/evaluate.ts:70`) is never truthy. The source data exists:
`radiology_protocols.required_measurements` is real and is read by
`measurementRegistry.ts:65`. What is missing is the step that compares a protocol's
required measurements against the report and reports the gap. Not fixed here — it
needs a per-study protocol lookup on the finalize path, which is a design decision
(§31), not a wiring fix.

**RW-22 — P2, class D. No quality finding blocks a signature, and the code said otherwise.**
Verified end to end:
- `FinalizeSignDialog.tsx:148-151` — `canConfirm` is
  `(!criticalRequiresAck || criticalAck) && (!needsSigner || !!signerId || signatures.length === 0) && compositionOk`.
  `unresolvedBlockers` does not appear in it.
- `:196-201` renders them under **"Review before signing (does not block)"**, while
  `:190` shows an unconditional green **"Ready to sign"** badge.
- `rules/structured/index.ts:26` — every one of the 23 structured definitions carries
  `blockingEligibility: false` in its shared base ("SHADOW — nothing blocks in Phase 3").
- Yet `reportQualityFinalize.ts:57` asserted *"Deterministic structured blockers are
  the only hard finalize gate"*, citing `ARCHITECTURE.md §8` — which is titled
  **"Open Questions / Risks — product-owner decisions before coding"**, whose item 1
  says the block-vs-warn policy **"Needs sign-off — this changes radiologist workflow."**

An open product-owner question was being cited in code as settled policy, and a
medico-legal gate was described as hard when it is advisory. **Comments corrected**
(no behaviour change); the underlying policy question is escalated to §31.

### 30.3 §4 matrix — text tier, canonical engine path

Caller: `useStudyFinalize.ts:189-201` → `buildWorkspaceQualityRequest` →
`POST /api/report-quality/evaluate` → `runQualityEngine` (`reportQuality.ts:318`).
"Sends it?" is the state **after** Group B.

| Rule | Required input | Current source | Caller sends it? | Can rule fire? | Fix |
|---|---|---|---|---|---|
| Q001 | `text.findings` | live store | Yes | **Yes** | — |
| Q002 | `text.impression[]` | live store, split per point | Yes | **Yes** | — |
| Q003 | `text.technique` | live store | Yes | **Yes** | — |
| Q004 | `text.clinicalHistory` | live store | Yes | **Yes** | — |
| Q005 | `text.recommendation` | live store | Yes | **Yes** | — |
| Q006 | `text.checklistPercent` | `studySetup.checklistPercent` | Yes | **Yes** | — |
| Q007 | `text.missingRequiredMeasurements[]` | **nothing produces it** | **No** | **No — RW-21** | needs a protocol-vs-report gap computation |
| Q101 | `text.findings` | live store | Yes | **Yes** | — |
| Q102 | `text.impression[]` with ≥2 elements | live store | **Was no** (1 element) | **Was no → Yes** | **Fixed, Group B** |
| Q103 | findings + impression | live store | Yes | **Yes** | — |
| Q104 | findings + impression laterality | live store | Yes | **Yes** | — |
| Q105 | findings + impression | live store | Yes | **Yes** | — |
| Q106 | findings + impression | live store | Yes | **Yes** | — |
| Q107 | `text.studyDescription` + laterality | `workflow.currentRow` | Yes | **Yes** | — |
| Q108 | full text | all five sections | Yes | **Yes** | — |
| Q109 | `text.sex` | **canonical: worklist DICOM → patient master** | **Was no** | **Was no → Yes** | **Fixed, Group B** |
| Q110 | `text.age` | **canonical: worklist DICOM → patient master** | **Was no** | **Was no → Yes** | **Fixed, Group B** |
| Q111 | `text.modality` + full text | `workflow.currentRow.modality` | Yes | **Yes** | — |
| Q112 | `studyDescription` + contrast wording | `workflow.currentRow` | Yes | **Yes** | — |
| Q113 | findings + impression | live store | Yes | **Yes** | — |
| Q114 | findings + impression | live store | Yes | **Yes** | — |
| Q115 | `text.findings` | live store | Yes | **Yes** | — |

**21 of 22 reachable.** Q007 alone remains dead, and it is dead for a missing
computation, not a missing wire.

`fullText` for Q108–Q114 is `clinicalHistory + technique + findings + impression +
recommendation` (`text/evaluate.ts:141-142`) — so a contradiction stated only in the
clinical history still fires. Proven by test.

### 30.4 §4 matrix — text tier, client mirror validator

Caller: `validateReport` at `useStudyFinalize.ts:158`, whose output is joined into the
dialog's `validationSummary` string (`:251`). Advisory only — it does not gate.

| Input | Before Group B | After |
|---|---|---|
| `findings` | sent | sent |
| `impression` | 1 joined element (Q102 dead) | split per point |
| `technique` | sent | sent |
| `recommendation` | **absent** (`as any`) | sent |
| `clinicalHistory` | **absent** | sent |
| `sex` | **absent** | sent |
| `age` | **absent** | sent |
| `modality` | **absent** | sent |
| `studyDescription` | **absent** | sent |
| `checklistPercent` | absent | absent (Q006 not run here) |
| `missingRequiredMeasurements` | absent | absent (Q007, RW-21) |

Before: Q004, Q005, Q102, Q107–Q114 could not fire. After: 9 of 11 inputs present.
`checklistPercent` is deliberately still absent — Q006 is the canonical engine's job
and duplicating it here would be a second source of truth (§3.2).

### 30.5 §4 matrix — structured tier

`runQualityEngine` uses `defaultEngine`, and `rules/index.ts` imports **only**
`"./text"`. The structured tier is a separate `createStructuredEngine()` instance
(`reportQuality.ts:51`) reached only through `runStructuredShadow` (`:231-259`),
which is best-effort and returns `null` unless `study`, `measurements` or
`findingInstances` is present (`:247`).

Of the 23 structured definitions, grouped by their own declared `requires`:

| `requires` | Count | Populated on the workspace path? | Reachable? |
|---|---|---|---|
| `["study"]` | 4 | Yes — `assembleStudyContext` (`:122-163`), worklist → study modality precedence | **Yes** |
| `["measurements"]` | 13 | **No** — no caller sends `measurements` | **No** |
| `["measurements","protocolRequiredMeasurements"]` | 3 | **No** | **No** |
| `["findingInstances"]` | 2 | **No** | **No** |
| `["template","coveredSections","knowledgePack"]` | 1 | **No** | **No** |

**19 of 23 structured rules are unreachable in production**, including every
measurement-range, unit-validation, required-measurement and laterality-pair rule —
the fetal/USG, CT and MR numeric checks. Only the four
`care.structured.consistency.study-modality.{mr,ct,us,xr}` rules can fire, and all 23
carry `blockingEligibility: false`, so even those cannot block.

The measurement data is not missing from the database. `radiology_quick_measurements`,
`fetal_usg_measurements`, `usg_measurements`, `spinal_measurements` and
`report_finding_instances` are all read elsewhere on the server
(`measurementRegistry.ts`, `usgExtractor.ts`, `radiologyStructuredJsonCache.ts`,
`fetalUsgLevel4.ts`, `pacsWorklistUsgAggregates.ts`, `patient-reports.ts`). **No edge
connects any of them to `QualityContext.measurements` or `.findingInstances`.**

The one place that does build a non-empty `measurements` array is
`runDeterministicQuality` (`rulesBeforeAi.ts:34`) — and it feeds `runQualityEngine`,
i.e. the text-only `defaultEngine`, which has no measurement rules registered. The
array is built and then ignored.

This is consistent with `ARCHITECTURE.md §8.3`, which states that universal
deterministic CT/MR/X-ray checks are *"impossible until D1 dual-write is on and
populating"* and that until then the engine is *"honestly heuristic-warn-only"*. The
gap is documented as intended; what was **not** documented is that the code comments
claimed a hard gate existed (RW-22).

### 30.6 §21 — finalization gate, as actually wired

| Class | Mechanism | Location | Blocks signing? |
|---|---|---|---|
| **HARD BLOCK** | PCPNDT Form F incomplete (obstetric USG) | `useStudyFinalize.ts:145-148` | Yes — returns before the dialog |
| **HARD BLOCK** | Critical finding requires acknowledgement | `FinalizeSignDialog.tsx:149` via `criticalFindingBlocksFinalize` | Yes — `canConfirm` |
| **HARD BLOCK** | Signer identity not chosen | `FinalizeSignDialog.tsx:150` | Yes — `canConfirm` |
| **HARD BLOCK** | Impression stale and not reviewed | `FinalizeSignDialog.tsx:143-147` `compositionOk` | Yes — `canConfirm` |
| SOFT WARNING | All 22 text-tier quality findings | `FinalizeSignDialog.tsx:208-215` | No — "do not block finalize" |
| SOFT WARNING | Structured-tier "blockers" | `FinalizeSignDialog.tsx:196-206` | No — "does not block" |
| INFORMATIONAL | Quality score, evaluation ids | `useStudyFinalize.ts:322-328` → `auditDetails` | No — provenance only |
| INFORMATIONAL | `validationSummary` mirror warnings | `useStudyFinalize.ts:251` | No — displayed text |

Note the fourth hard block depends on `impressionNeedsRefresh`, which RW-05 shows is
never armed by `mergeField`. So the one quality-adjacent hard block in the dialog is
itself partly dead — Group D's subject.

### 30.7 Group C — the interactive AI draft path (`1be8252b`)

9 files, +768/−37. RW-02 and RW-03 fixed by reuse; one new P1 found and fixed; one
evidence addition to RW-14; one new gap recorded rather than wired. Line numbers in this
subsection are as of `1be8252b`, not `21021ff6`.

**RW-03 fixed by calling the validator that already exists.** `validateDraftGrounding`
(`aiReporting.ts:862-904`) builds a snapshot through the composer's own
`parseComposerSnapshot` and passes it, with the model's output, to `validateComposerOutput`
(`validateOutput.ts:382`) — the same function that gates the background composer's READY
state and is already covered by `validateOutput.definiteMutations.test.ts` (9 tests,
verified green in isolation on this box). No second validator was written, so the two AI
paths cannot drift apart on what counts as invented.

The verdict is returned as `validation` and is **advisory**: `blocking: false`, HTTP 200,
draft still returned. That follows both the register's own recommendation ("Ship it as a
warning badge first") and the task's §14 ("Do not blindly make every warning blocking.
Preserve usability."). What changed is that a flagged draft can no longer look identical
to a vouched-for one — `aiSafetyLabel` (`:1455-1457`) reads
`"AI Draft – Ungrounded content flagged – verify before accepting"` when `validation.ok` is
false, and the workspace raises a destructive toast
(`useTriggerAiImpression.ts:55-63`) rather than only dropping text into the ghost layer.

**What the validator honestly could not check is stated, not implied.**
`DRAFT_VALIDATION_GAPS` (`:843-847`) travels in the response as `validation.notChecked`,
alongside `validation.imagesSentToModel`:

| Gap | Why it cannot be closed on this path |
|---|---|
| selected-image overclaim checks | `/draft` fetches its own middle-slice JPEGs and there is no frozen key-image registry, so `selectedKeyImages` cannot be populated truthfully. Setting `aiMode: "SELECTED_IMAGES"` with zero refs would raise a *false* `selected_images_empty`. The snapshot therefore stays TEXT_ONLY. |
| definite laterality and severity correlation | `detectDefiniteClinicalMutations` needs `snapshot.observations`; `/draft` is sent none, so those two remain advisory. |
| technique grounding | the reporting workspace does not send Technique to this route. |

Fabricating `keyImageId`s to light up the image checks was considered and rejected: a check
that passes on invented inputs is worse than a declared gap, and the task's §39 forbids
exactly that trade.

**RW-02 fixed by reading the key, not by deleting it.** `AiReportingDraftRequestSchema`
(`lib/api-zod/src/radiologyAi.ts:63-95`) declares the contract — `/draft` was the last AI
route still hand-destructuring `req.body`, which is *why* a key the workstation sent and
the handler did not read was invisible. The handler now parses it (`aiReporting.ts:1052-1059`)
and branches (`:1081`, `:1213-1229`, `:1300-1311`).

Deleting `field` from the client was the cheaper correction and was rejected: it would have
removed the lie and kept both the waste and the risk, because Ctrl+I would still ask the
model to regenerate a Findings section nobody requested and still receive it under `findings`
and `draft`, for any surface to offer as a replacement of text the radiologist had already
typed.

Branching then exposed a second latent defect. On the impression-only path the two-section
parser finds no `FINDINGS:` marker and falls through to `aiResponse.trim()`, which would
have handed the impression back **as the findings** — the precise silent substitution the
branch exists to prevent. The branch bypasses that parser entirely (`:1300-1307`), and
`aiReporting.query.test.ts:498` is a regression test for exactly that response shape.

**Prompt clauses now live in one leaf both callers import.** `DRAFT_SAFETY_CLAUSES`
(`lib/ai/draftPromptSafety.ts:15-22`) carries the anti-invention, measurement-preservation,
laterality/level-preservation and severity-preservation clauses the task's §17 and §18
demand. `aiPipelineSelfTest.ts:115-128` imports the same constant. Its `DRAFT_PROMPT` was
already documented as *"Same instruction block as POST /api/ai-reporting/draft
(production-shaped)"* but was a hand-copied paraphrase, so any hardening clause added to
production was never exercised by the self-test that claims to mirror it. It is now
literally the same string.

**RW-23 — P1, class D. The next-study preload stored an invented draft for a study nobody had opened.**

Found by reading what the workstation actually sends rather than what it was assumed to
send. `useWorkspaceClinicalUi.tsx` fires `POST /api/ai-reporting/draft` with
`{ studyInstanceUID, modality }` only — **no findings, no impression, no clinical history** —
for the *next* study in the list, then discards the response through
`.then(() => markNextStudyPreloaded())`. (Site: `:2161-2167` at base `bc8ca8c5`, the call at
`:2165`; `:2206-2216` at head, the call at `:2214`. This entry originally cited `:2175-2182`,
which is the mid-branch vintage `21021ff6`–`1be8252b` and points at `stageAiProposal` at either
endpoint — see C-21.)

Server-side the discarded call still:

1. fetched up to 6 Orthanc images for that study,
2. ran a full inference from a template-only prompt with zero radiologist input, and
3. **persisted an `ai_reporting_drafts` row** (`aiReporting.ts:1363-1380`).

`GET /api/ai-reporting/drafts/:studyId` (`:1840-1846`) returns every row for that UID with
no status or provenance filter, and `DicomViewer.tsx:121-125` lists them behind a
show-drafts toggle. So an ungrounded, image-plus-template invention became retrievable for
a study nobody had reported, presented as an ordinary AI draft, attributed to whoever was
logged in when the preload happened to fire.

**Fixed** with `warmUpOnly` (`radiologyAi.ts:92`, guard at `aiReporting.ts:1363`). The
warm-up is kept — the model is still loaded and exercised, which is the entire point of the
call, and the audit row at `:1384-1400` is still written so the AI call is not invisible —
but no clinical draft is stored and `draftId` returns `null`.

**What the fix does not do, stated because "fixed" invites the opposite reading:** steps 1 and 2
above still happen. The image fetch at `aiReporting.ts:1253-1268` is gated on `studyInstanceUID`
alone, so a preload for a study nobody has opened still pulls up to 6 middle-slice JPEGs out of
Orthanc and still sends them to whatever provider `resolveLocalAiRuntime` selects. Since
`DICOM_REDACTION_PERFORMED` is `false` (`lib/ai/dicomRedaction.ts:17`), those 6 images leave the
server unredacted, and the audit row that records the egress is the one row the fix deliberately
kept. The stored-draft half of RW-23 is closed; the **unrequested-image-egress half is not**, and
closing it means conditioning the fetch on `warmUpOnly` — which would defeat the warm-up's purpose
only if the warm-up needs images, and it does not: loading a model into memory is what the call is
for. Left open as an owner decision (§31 decision 11) rather than changed here, because it alters
what a shipped preload sends and no test in this repository observes egress.

The loop is bounded, so this was not a runaway: `selectStudy` (`store.ts:847`) resets
`preloadTriggered` and `nextStudyPreloaded`, and `shouldPreloadNext` (`types.ts:358`)
requires `!done && pct >= 80`. **Residual risk:** the effect's deps are
`[preloadTriggered, studies, activeStudyId]`, so a new `studies` array identity while the
preload is armed would re-fire it. That is a navigation-lifecycle concern, not a Group C one.

**RW-14, evidence addition — the orphaned copilot panel could not have worked anyway.**
`RadiologyAICopilotPanel.tsx` is not merely unmounted. Its five `fetch()` calls
(`:189, :536, :617, :635, :770`) carry no `Authorization` header and no `credentials`
option (grep for both returns nothing in the file), while `routes/index.ts:1018` mounts the
router behind `requireStaffAuth` and `fetchApi.ts:349` states this app has **no
cookie-session fallback**. If anyone ever mounted it, every tab would 401 and surface as
`"Draft generation failed"`. This raises the cost of leaving it bundled: it is a component
whose *name* advertises an AI copilot, which would fail on first use, shipping inside a
workspace that has no copilot panel at all.

**RW-24 — P2, class D. The one AI surface that offers Findings text for a report is the one Group C did not reach.**

Verifying the matrix below corrected an assumption. `POST /api/ai-reporting/draft` has
exactly **two live callers repo-wide** — `useTriggerAiImpression.ts:52` (Ctrl+I) and
`useWorkspaceClinicalUi.tsx:2182` (the preload) — plus the dead copilot panel. `DicomViewer`'s
AI tab does **not** call it. It calls `queryAiReporting` → `POST /api/ai-reporting/query`
(`DicomViewer.tsx:168`), then on success sets **both** `aiResponse` and `draftText` from the
raw model text (`:170-171`) and offers *Save Draft* (`:182`, → `POST /drafts`), *Copy*
(`:212`) and *Insert Into Report* (`:465`).

`POST /query` returns `aiResponse` with **no validation of any kind** — the handler's
response is `{ aiResponse, provider, model, numImages, anonymized, promptSource, promptChars }`
and nothing else (verified: no `validate*` call anywhere in that handler). So the surface
that hands a radiologist *Findings* prose for a report is the surface with no grounding
check, while the surface that hands only an *Impression* to a ghost layer now has one.

**Not fixed in Group C**, and not a Group C omission to paper over: `/query` is a free-text
Q&A route whose output is not guaranteed to be `FINDINGS:`/`IMPRESSION:` sections, so
`validateComposerOutput` — which is section-aware — does not apply to it unchanged. Making it
apply is a design decision (parse-then-validate, or a section-agnostic grounding subset),
escalated to §31 decision 8.

**RW-25 — P2, class D. "Insert Into Report" inserts nothing, and the audit log then says it did.**

`DicomViewer.tsx:461-473` renders a full-width purple button labelled **"Insert Into Report"**,
under the instruction *"Edit the draft above before inserting into the report."* (`:440`). Its
handler is `POST /api/ai-reporting/insert-to-report` (`:204`), which does exactly two things
(`aiReporting.ts:1860-1866`): sets `ai_reporting_drafts.status = "inserted"` and sets
`ai_reporting_audit_logs.wasInsertedToReport = true`. No text is written to any report, to any
worklist row, or to any field. The client's own success toast is honest — *"Marked as inserted
into report"* — but the button label is not.

`wasInsertedToReport` has precisely two readers in the product: `AiAuditLog.tsx:184` (a badge
in the audit list) and `:260` (rendered as **"Yes"** in the row detail). So the AI audit log —
the record an auditor reads to answer *"did unreviewed AI text reach a signed report?"* — can
answer **"Yes"** for a draft whose text was never moved anywhere, on the strength of one button
press. The transfer, if it happened at all, was a clipboard copy the system cannot observe.

Same class as the hard-coded `anonymized: true` the earlier AI-infrastructure audit found: a
column whose value asserts something the code never measured. Not fixed in Group C — it is an
audit-trail semantics decision (relabel the button, or make the flag mean what it says by
requiring the paste to happen through the app), escalated to §31 decision 8.

**AI path matrix (task §13), state after Group C.**

| AI path | Trigger | Input context | Output | Validation | Merge method | Provenance | Human acceptance |
|---|---|---|---|---|---|---|---|
| `POST /draft` — Ctrl+I | radiologist keystroke in the reporting workspace | typed Findings, modality, study UID | **Impression only**; `findings`/`draft` empty | `validateComposerOutput`, advisory, with declared `notChecked` | ghost layer (`setGhostText`) — never writes the field | audit row + draft row, `draftId` returned | **Required** — explicit accept of the ghost |
| `POST /draft` — next-study preload | ≥80% progress on the current study | client sends study UID + modality only; **the server then fetches up to 6 Orthanc images for that study** (`aiReporting.ts:1253-1268`, gated on `studyInstanceUID` and *not* on `warmUpOnly`) | discarded client-side | same validator; result unused | **none** — no merge, no store | audit row only; `warmUpOnly` ⇒ `draftId: null` | n/a |
| `POST /draft` — copilot panel | none — no importer (RW-14) | would send report body + impression | n/a | n/a | n/a | n/a | n/a — **and would 401**: no auth header |
| `POST /query` — `DicomViewer` AI tab | button in the DICOM viewer | `promptText`/template, clinical history, up to 6 images, scope | raw `aiResponse`, copied into `draftText` | **none** (RW-24) | clipboard *Copy*, or *Insert Into Report* which only flips a flag (RW-25) | `POST /drafts` row + audit row | **Required** — nothing is auto-applied |
| `POST /query` — command center / NeuroPromptPanel | button in those surfaces | `promptText`, optional images | free-form `aiResponse` | none | `window.confirm` before overwriting typed findings | audit row | **Required** — guarded overwrite |
| Background composer | scheduled / queued | full frozen snapshot incl. observations and key images | Findings + Impression + Recommendation | `validateComposerOutput` gating READY, incl. selected-image overclaim checks | writes a draft row | draft row + composer run record | **Required** |

Two facts in that table are worth stating plainly, because both were assumptions before they
were checked:

- The command center's guarded overwrite is not an assumption — `aiQueryContract.test.ts`
  asserts the `!rawFindings.trim() || window.confirm` shape and that assertion passes on this box.
- **The background composer is now the only AI path whose output is validated *and* the only
  one that receives structured observations.** The interactive `/draft` path is validated but
  structurally cannot perform the laterality and severity checks; `/query` is not validated at
  all. Group C narrowed that asymmetry; it did not close it.

**Context completeness (task §15) — Ctrl+I, visible vs actually sent.**

| Context item | Visible in UI | Sent before Group C | Sent after |
|---|---|---|---|
| Findings (typed) | Yes | Yes, as `reportBody` (fixed in PR1) | Yes |
| Impression (typed) | Yes | No | **No — deliberate** |
| Clinical history | Yes | No | **No** |
| Technique | Yes | No | **No** |
| Recommendation | Yes | No | **No** |
| Modality | Yes | Yes | Yes |
| Study UID | Yes | Yes | Yes |
| Images | Yes (viewer) | Yes, up to 6, unannounced | Yes, up to 6 — now **counted** in `validation.imagesSentToModel` |

Four of the eight are still not sent, and one of those is correct by design: Ctrl+I asks for
an Impression, so sending the Impression the radiologist already wrote would invite the
model to paraphrase its own target.

**Clinical history is the significant omission and it is still open.** An impression
generated without the history cannot be checked against the question the study was ordered
to answer, and `groundedCorpus` cannot see it either — so a draft that contradicts the
referral question is invisible to the validator as well as to the label. Group C made this
gap *measurable* (`imagesSentToModel`, `notChecked`) rather than closing it. Closing it means
threading history and technique through `useTriggerAiImpression`'s options
(`:26-29`), which changes a workspace hook signature. Escalated to §31 decision 7 rather
than done unilaterally, because it also changes what the validator can flag and therefore
how often Ctrl+I warns.

**§17 / §18 evidence — stated to the model and checked on the output.**

| Clinical danger | Stated in the prompt | Checked on the output | Test |
|---|---|---|---|
| `8.7 mm` rewritten as `8 mm` | `DRAFT_SAFETY_CLAUSES` line 3 | `measurement_mutation`, via `MEASUREMENT_TOKEN_RE` | `aiReporting.query.test.ts:585` |
| finding moved to another spinal level | line 4 | `level_change`, via `LEVEL_RE` | `:597` |
| finding moved to the other side | line 4 | `laterality_swap` — **advisory only on this path**; needs `snapshot.observations` | declared in `notChecked` |
| mild escalated to severe | line 5 | `severity_escalation` — **advisory only on this path**, same reason | declared in `notChecked` |
| abnormality invented from nothing | line 2 | `unsupported_abnormality` + the named terms | `:574` |

The task's §18 says *"Prefer structured laterality over NLP inference."* On `/draft` there is
no structured laterality to prefer, so the honest position is that **a side change is not
caught on this path** — and that is written into the response rather than being hidden behind
a green `ok`. The background composer, which does receive observations, keeps the real check.

**Presentation layer: one notice function, not a second validator.**
`draftValidationNotice` (`aiDraftValidation.ts:32-77`) turns the server verdict into the one
line a radiologist should read before accepting. It decides only what is worth interrupting
over. One judgement call is encoded and tested: `measurement_mutation` is suppressed for an
impression-only request (`NOT_APPLICABLE_TO_IMPRESSION`, `:14`), because an Impression
legitimately condenses six measured levels down to the one that matters — a measurement that
did not survive the condensing is not evidence of anything. On a full-report draft the same
code **is** the finding and is reported. Conflating the two would make Ctrl+I warn on almost
every press, and a warning nobody reads is worse than no warning.

Unknown error codes are surfaced by default (`:61-70`), so a check added to the validator
later cannot silently vanish from the UI, and a draft the server refused to vouch for is
never shown as clean.

**Test and typecheck evidence.**

| Check | Result on this box |
|---|---|
| `aiReporting.query.test.ts` | **39 passed** (24 pre-existing + 15 new: 5 `field`, 6 grounding, 4 warm-up) |
| `aiDraftValidation.test.ts` | **13 passed** (new file) |
| `validateOutput.definiteMutations.test.ts` | **9 passed** — the reused validator's own suite |
| `pnpm --filter @workspace/api-server exec tsc --noEmit` | exit 0 |
| `pnpm --filter @workspace/diagnostic-erp exec tsc --noEmit` | exit 0, 1,988 files compiled |

The ERP typecheck being clean contradicts the repo's own `AGENTS.md`, which records a
pre-existing `calendar.tsx` / `spinner.tsx` duplicate-`@types/react` failure. Measured, not
assumed: `tsc --noEmit --listFiles` emitted 1,988 paths and exited 0 with no diagnostics.
`AGENTS.md` is stale on this point.

**Five mutations applied, each failing exactly its intended tests and nothing else.**

| Mutation | Failed | Passed |
|---|---|---|
| `if (false && wantsImpressionOnly)` in the parse branch | 2 | 33 |
| `validateDraftGrounding` neutered to `ok:true, errors:[], unsupportedMentions:[], levelChanges:[]` | 3 | 32 |
| `DRAFT_SAFETY_CLAUSES = ""` | 1 | 34 |
| `if (success && !warmUpOnly)` → `if (success)` | 2 | 37 |
| dropped `!opts.impressionOnly &&` in `aiDraftValidation.ts` | 1 | 12 |

The last one is the mutation that matters most clinically: without the mode flag, Ctrl+I
warns about a "dropped measurement" on every condensed impression, which is the
cry-wolf failure mode that gets a safety warning ignored.

**Pre-existing and unrelated, verified unchanged.** `aiQueryContract.test.ts` still fails on
this box for the recorded Windows path-separator reason — its offender filter compares
`f.replace(ERP_SRC + "/", "")` against forward-slash relative paths, which never matches a
backslash path. Proven not caused by Group C: both the test file and `aiReportingClient.ts`
are unmodified in `1be8252b`, and the single offender it reports *is* the file it intends to
whitelist. It passes in CI on Linux. 23 further files under `lib/ai` and `lib/reportComposer`
fail to **collect** locally with `DATABASE_URL must be set`; per the CI workflow they really
run there.

---

### 30.8 Group D — the staleness wiring (`df7e024b`)

8 files, +369/−8. RW-05 and RW-08 fixed; one new G-class finding recorded rather than
wired; one honest limit on how far RW-08's fix reaches. Line numbers in this subsection
are as of `df7e024b`.

**RW-05 fixed in both writers — the gap was wider than the register said.**

RW-05's recommended correction was two conditionals in `mergeField`, mirroring
`store.ts:871-876`. That correction alone would have left the larger half of the hole
open, because the predicate it said to mirror was itself wrong:

```ts
if (f === "findings" && (opts?.source === "manual" || !opts?.source))
```

`InsertSource` (`reportFieldMerge.ts:14-30`) has sixteen members. This admits one of them
plus `undefined`, so **every named source was excluded** — including `"radiologist-voice"`,
which reaches `setField` through `replaceField` (`store.ts:971-973`) from
`useVoiceReporting.ts:174`. A radiologist dictating a replacement Findings paragraph did
not stale the Impression either. RW-05 as written attributed that silence to `mergeField`
alone; it belongs to both writers.

Both halves are now keyed on the field, not the source (`store.ts:871-881`, `:942-955`).
The *clearing* half stays keyed on source, and that asymmetry is the point: arming has to
be universal, because a new abnormality stales the Impression however it arrived, while
clearing must stay narrow so a hand-retyped Impression cannot discharge the obligation —
only a ledger refresh can.

**Why this is not a usability regression.** Arming more often would be a new hard block if
`compositionFinalizeAllowed` had widened with it. It has not: the body is unchanged, still
takes the same three impression booleans, and the acknowledge checkbox still discharges it.
Every `mergeField("findings", …)` caller was enumerated — 14 sites across
`useReportingStudySetup.ts:548,678`, `useWorkspaceClinicalUi.tsx:988,1215,1232,1558,2011`,
`useVoiceReporting.ts:174,326`, `store.ts:1041,1049,1072,1074,1092`,
`ReportingToolsRail.tsx:1175`, `SpineCanalApBox.tsx:387` — and each inserts new clinical
content into Findings without touching the Impression, so arming is exactly the intended
behaviour. The paired writers (report-format apply at `store.ts:1217-1220`, which writes
technique → findings → impression → recommendation; template apply and companion
auto-populate at `useReportingStudySetup.ts:515/516,531/534,548/552`) write the Impression
second with a non-manual source and clear the flag they just armed. `applyFormatById` on an
empty report is asserted to leave the gate **disarmed** — that is the regression a naive
widening would have caused, and it is tested rather than assumed.

One residual edge case, recorded rather than fixed: a report format carrying Findings but an
empty `defaultImpression`, applied to an empty report, early-returns on the Impression write
(`mergeField`'s no-op guard, `store.ts:936-941`) and leaves the gate armed, so the signer
must tick the acknowledge box. A spurious prompt on an uncommon path, not a silent miss, and
it errs in the safe direction.

**RW-08 fixed as one more advisory producer into the existing gate shape.**

`detectOrphanedRecommendationsForLedger` (`observationLedger.ts:549-590`) feeds
`collectCompositionFinalizeGate` and returns the same `{sentence, hint}` shape the sibling
warnings already use, so the finalize dialog renders it in the existing block. Nothing
deletes and nothing blocks.

Two decisions the register did not specify, both taken from reading the code that *sets* the
flags rather than from the register's wording:

1. **`stale` OR `protected` — not `stale` alone.** `reconcilePatchAgainstNarrative`
   (`observationLedger.ts:682-701`) is the only writer of `stale`, it runs only on hydrate,
   and it derives from `findings`/`impression` — never from `recommendation`. A stale-only
   detector would have caught the save→reopen path and **missed the audit's Path B
   entirely**: the radiologist deletes the Findings sentence in the live session,
   `store.ts:910` marks the patch `protected`, and nothing rehydrates. That is the more
   common of the two paths. Mutation M4 below is the proof the widening is load-bearing.
2. **Advice with no owning observation is not named.** RW-08's wording was "stale or
   absent"; the "absent" half was dropped deliberately. An unowned recommendation is
   indistinguishable from the radiologist's own advice — including the legitimate follow-up
   on a normal study that the entry's own risk note protects — so naming those would put a
   warning on most normal reports and train the signer to ignore the panel. Within a named
   patch, `contributionProtected` (`observationSlot.ts:415-427`) further suppresses any
   sentence whose provenance includes `manual` or `radiologist-voice`: once the radiologist
   has edited the advice, it is theirs.

**The two hops TypeScript cannot police are pinned by source contracts.** The collector's new
`recommendation` and `provenance` parameters can be passed as `""` and `undefined` and still
typecheck, silently producing an empty warning list — the failure mode that makes a safety
feature look wired while it is inert. Five source-level tests assert that
`useStudyFinalize.ts` really passes `latest.recommendationText` and
`latest.fieldProvenance.recommendation`, that it forwards the collector's array into the
prompt input, that `FinalizeSignDialog.tsx:174` passes that array and not `[]`, that the gate
component renders it, and — pinning the advisory-only guarantee structurally — that
`compositionFinalizeAllowed`'s body contains neither `recommendation` nor `sibling`. They read
real source because this repo's ERP test environment has no DOM.

**RW-26 — P3, class G. Two dead imports sit beside the one live banner consumer.**
`useWorkspaceClinicalUi.tsx:365` imports three names from `observationLedger`; only
`patchFindingsContributionBlocked` is called in that file. `collectCompositionFinalizeGate`
and `extractCareObservationLedger` each appear exactly once — the import line. Recorded, not
deleted: Group D touches neither line and the task's §28 excludes cosmetic scope from a
safety commit.

The dead import is evidence for the honest limit on RW-08's reach. The orphan detector has
exactly one production consumer chain — `useStudyFinalize` → `FinalizeSignDialog` →
`CompositionFinalizeGate`. The in-workspace banner (`ownershipReviewWarnings`, `:699`,
`:3208`) is fed from the store and carries unowned-sibling warnings only. An orphaned
recommendation is therefore named **at the sign dialog, not while the radiologist is typing**.
Surfacing it live would need a store field and a banner producer — a second consumer,
deliberately not built here, because the finalize dialog is the last point at which the advice
can still be re-read and the register asked for visibility at finalize.

**Test and typecheck evidence.**

| Check | Result on this box |
|---|---|
| `observationPersistence.hardening.test.ts` | **31 passed** (8 pre-existing + 23 new) |
| `compositionSafety.walkthrough.test.ts` | **11 passed** |
| 10 composition / ledger / recommendation files together | **178 passed** |
| `pnpm --filter @workspace/diagnostic-erp exec tsc --noEmit` | exit 0 |
| Full ERP suite, `--no-file-parallelism` | 348 files: **2 failed, 346 passed**; 4,673 tests: **1 failed, 4,672 passed** |

**Ten mutations across nine runs.** Each was verified to have actually landed before its run
was believed, and each file was restored byte-identical afterwards.

| # | Mutation | Failed | Passed | Tests that failed |
|---|---|---|---|---|
| M1 | `setField` arming reverted to source-keyed | 3 | 34 | dictation-replace, template-write, paired-write |
| M2 | `mergeField` findings arming removed | 3 | 34 | tile-insert, ai-draft, hand-retyped-impression |
| M3 | `mergeField` arming widened to `f !== "technique"` | 1 | 36 | recommendation/technique-alone-never-arms |
| M4 | `if (!p.stale) continue;` (drop `protected`) | 1 | 36 | Path B — the finding the widened predicate exists to catch |
| M5 | `contributionProtected` guard removed | 1 | 36 | silence after the radiologist adopts the sentence |
| M6 | `fieldContainsContribution` guard removed | 1 | 36 | silence after the advice is deleted from the box |
| M7 | dedupe removed | 1 | 36 | two patches rendering identical advice |
| M8 | collector passed `recommendation: ""` | 4 | 33 | exactly the 4 store-integration tests, zero pure-function tests |
| M9+M10 | `provenance:` cut in the hook **and** `orphanedRecommendations: []` in the dialog | 2 | 29 | the 2 wiring contracts |

M8 is the mutation that proves the source contracts are not decorative: stubbing the
collector's input to `""` — a change no typechecker would flag — fails four tests.

**Pre-existing failures separated empirically, not asserted.** The two failing files are
`aiQueryContract.test.ts:54` (the recorded Windows path-separator bug: its offender filter
compares `f.replace(ERP_SRC + "/", "")` against forward-slash paths, so the one file it
intends to whitelist reads as the offender) and `composeStudyContext.test.ts` (collection
error, `DATABASE_URL must be set` at `lib/db/src/index.ts:8`). Both were reproduced at base
`1be8252b` with Group D stashed. The tree was then restored and verified: identical `369/8`
diffstat, four files byte-identical to pre-run backups, and `grep -rn "MUTATION M"` clean
across `src`.

---

### 30.9 Group E — patient/study isolation and signed state (`cd572ea1`)

**Scope.** RW-06 and RW-07 (both **P1**, class D), the prior register's RR-06 and RR-20, and
one finding no register entry described (RW-30). Nine files, **+920/−53**, of which 510 lines
are the new test file and 181 the new leaf module. Nothing in this group changes what the
workspace *computes*; all of it changes what the workspace *forgets*, and what it admits about
having forgotten.

#### §2.2 was wrong about the number of reset paths, and that error is why RW-07 stayed open

The audit recorded *"There are exactly **two** reset paths."* There are **three**. The third is
`advanceToNextStudy`'s end-of-queue branch (`store.ts:1086` at base):

```js
if (r[0]) get().selectStudy(r[0].id);
else set({ activeStudyId: null, findingsText: "", impressionText: "",
           recommendationText: "", fieldProvenance: {} });
```

Measured field counts at base `bc8ca8c5`, by parsing each `set({...})` literal rather than
estimating:

| Reset path | Site at base | Clinical fields cleared | of 61 |
|---|---|---|---|
| FULL — `selectStudy` | `store.ts:847` | 65 keys = 61 clinical + 4 identity/context | **61/61** |
| PARTIAL — study-switch effect | `useDraftPersistence.ts:157-187` | 16 explicit keys, + a conditional merge-preview triple | **16/61** |
| THIRD — end of queue | `store.ts:1086` | `findingsText`, `impressionText`, `recommendationText`, `fieldProvenance` | **4/61** |

The third path is the one that fires when a radiologist signs the last study in the queue — the
normal end of a reporting session. It left **57 fields** holding the last reported patient's
state in a module-scope singleton: the observation ledger, the undo stack, every measurement,
all three numbering schemes, the screening and vascular protocol answers, the composition
gate's own inputs, and the critical-SLA flags. The store then stays in that condition until
something else calls `selectStudy`. The audit missed it because §2.2 was written by reading the
two paths RW-06 and RW-07 name, not by enumerating every `set({...})` that clears clinical
fields. **Corrected as C-11; §2.2's "exactly two" is now false and is annotated.**

RW-07's own entry also estimated *"two hand-maintained lists of ~45 fields."* The measured
figures are 65 and 16 — the estimate was wrong in both directions, and the third list did not
feature in it at all.

#### The fix RW-07 itself recommended: one definition, three callers

New leaf module `lib/zai-workspace/clinicalStateReset.ts` (181 lines). Its only import from the
store is `import type { WorkspaceStore }` — type-only, so there is no runtime cycle despite the
store importing it back. Its seven runtime imports are all pure default-factories from sibling
leaf libs (`defaultLumbarNumbering`, `defaultDorsalNumbering`, `defaultDorsoLumbarState`,
`defaultSpineSequences`, `defaultScreeningState`, `defaultVascularTechnique`,
`emptyViewerMeasurementsState`) — the same seven the base FULL path already called:

```ts
export const CLINICAL_RESET_FIELDS = [ /* 61 names */ ] as const;
export type ClinicalResetField = (typeof CLINICAL_RESET_FIELDS)[number];
export type ClinicalResetState = Pick<WorkspaceStore, ClinicalResetField>;
export function emptyClinicalState(): ClinicalResetState { /* 61 fresh defaults */ }
```

`Pick<WorkspaceStore, …>` rather than a hand-written shape is the load-bearing choice. If the
store renames or retypes any of the 61, this stops compiling. A hand-written duplicate would
keep compiling and quietly reset the wrong thing — which is precisely how three lists came to
exist in the first place.

**Equivalence was measured, not asserted.** Parsing the base FULL literal and diffing its key
set against `CLINICAL_RESET_FIELDS`:

```
base FULL reset keys: 65
not in the new helper: [ activeStudyId, clinicalHistoryText,
                         activeStudyInstanceUID, reportingContext ]
in the helper but not in base FULL: []
```

Exactly the four identity/context fields, deliberately excluded because each caller supplies
them differently (FULL sets them from the study row; PARTIAL must *not* touch
`reportingContext`, per the race its comment documents; THIRD nulls `activeStudyId`). Zero
additions, zero omissions. The helper is the FULL path's clinical set and nothing else, so the
FULL path's behaviour is bit-identical by construction.

All three paths now spread it — `store.ts:870`, `store.ts:1140`, `useDraftPersistence.ts:175`
— each asserted by a source contract in the new test file, and the PARTIAL path's old 16-key
literal is asserted *absent* so the change cannot be silently reverted.

The PARTIAL widening is safe against the race its comment protects, for two reasons recorded in
the code: the hydrate effect is declared after this one so it runs after, and
`onStudySwitchPageReset` is a stable `useCallback` over a state setter — widening the reset
cannot wipe a report mid-session, only at the switch it was already firing on.

**Strength of proof, per path — stated because the three are not equal.** The FULL and third
paths are store actions and are tested **behaviourally**: Patient A's state is poisoned, the
real action is driven, and all 61 fields are asserted at their defaults. The PARTIAL path is a
hook effect and this repo's test environment has no DOM, so it is tested by **source contract**
only — the effect spreads `emptyClinicalState()`, and its old 16-key literal is asserted absent.
That is a weaker guarantee: it proves the code says the right thing, not that the effect runs
when the study changes. It is the same limitation §20 records for the whole workspace, and it
is marked here rather than presented as equivalent.

#### RW-06 closed by three layers, not the two its entry proposed

1. **Identity on the frame.** `PatchSnapshot` gained `activeStudyId: string | null`
   (`store.ts:270`) and `captureClinicalSnapshot` stamps it (`store.ts:290`). Every frame now
   knows whose edit it holds.
2. **Refusal.** `undoLastPatch` compares and returns `false` without calling `set` when they
   differ, warning with `{ frameStudyId, activeStudyId }` (`store.ts:2440`). The refused frame
   is **left on the stack** rather than dropped — it is still the correct history for the study
   it came from, and `popClinicalUndoSnapshot` is pure (`clinicalUndo.ts:35-41`, `slice`), so
   returning early genuinely preserves it.
3. **The stack is cleared on all three paths** now that `patchUndoStack` and
   `lastPatchSnapshot` are in the shared 61. Layer 2 therefore only fires on a switch that went
   through none of the three — which is why its warning text says so.

The signature stayed `() => boolean`. Measured: **20 assertions of the exact form
`expect(undoLastPatch()).toBe(true)` across 17 test files**, plus several more that bind the
result to a variable first;
returning a string union would have passed every one of them, because `"empty"` is truthy. The
refused-vs-nothing-to-undo distinction moved to the caller, which reads the already-public
`patchUndoStack` to tell them apart.

`selectStudy`'s silent no-op now logs `{ id, activeStudyId, knownStudies }` before returning, as
RW-06's entry asked — *"a silent no-op on a reset path is how this stayed hidden."*

**The refusal is surfaced, and the channel it was *not* surfaced on is RW-27.** Ctrl+Shift+Z
(`useWorkspaceCommands.ts:245-247`) reads the top frame, calls `undoLastPatch`, and on a refusal
raises a `destructive` toast. `pushNotification` was considered and rejected after reading its
only consumer: `interrupt-card.tsx:11` returns `null` unless `kind === "interrupt"`, and an
interrupt renders a red card headed **"Critical finding detected"** (`:22`). An undo refusal
delivered on that channel would have presented as a false clinical alert — and on the other two
kinds it would not have presented at all. The test asserts the negative on comment-stripped
source, so the reasoning cannot be undone by an edit that leaves the comment behind.

#### RW-30 — the three signed-state decisions read a stale row and disagreed with each other

Not in any register entry; found while wiring the authoritative status. At base all three read
the **worklist queue row** — a list payload that can be stale, or absent for a deep-linked study
— while the workspace was already fetching the authoritative per-study row and throwing its
`status` away. And only one of the three honoured `DELIVERED`:

| Decision | Base site | Read | Honoured `DELIVERED`? |
|---|---|---|---|
| `studyLock.enabled` | `:754-759` | `workflow.currentRow.status` | ✓ |
| `contentLocked` | `:766-768` | `workflow.currentRow?.status` | **✗** |
| `draftBackup.enabled` | `:784` | `workflow.currentRow?.status` | **✗** |

So a **delivered** report was editable on screen while the study-lock refused to claim it — the
radiologist could type into a report the system would not let them own, and the local draft
backup kept writing over it. Two defects, one cause: three hand-written reads of the same
question. All three now read one derived value:

```ts
const authoritativeStatus = worklistDetailQ.data?.status ?? workflow.currentRow?.status ?? null;
const studyIsSignedElsewhere = authoritativeStatus === "REPORT_FINAL" || authoritativeStatus === "DELIVERED";
```

(`useWorkspaceClinicalUi.tsx:785-786`, consumed at `:792`, `:800`, `:816` — the same three
sites, now with no local re-derivation.) The queue row remains the fallback, so a study with no
detail response yet behaves exactly as before rather than appearing unlocked-then-locked.

This is reuse, not a new fetch: `GET /api/radiology/pacs-worklist/:id` already returned `status`
(`pacsWorklistDetailFields.ts:22`) and the workspace already called it per study — it merely
typed the response as `{ dicomMetadata?, age? }` and discarded the rest. The query declaration
was hoisted from `:2280` to `:768` so it precedes all three consumers; at base it was declared
*below* them, which is why none of them could read it. The old site holds a pointer comment. The
test asserts the declaration appears **exactly once** and above every lock, so it cannot drift
back.

`allowEditSigned` still overrides all three, unchanged — the trial-edit path is an owner
decision (§31), not something to narrow inside an isolation commit.

#### RR-20 closed by reading a flag the server was already sending

RR-20 had two halves and neither needed a server change.

*Re-finalize silently returns the old report.* `POST` already answered
`{ ...existingReport, idempotent: true }`; the client never read the field.
`radiologyReportLifecycle.ts` now carries it (`:115`, set at `:284`, returned at `:357`) and
`useStudyFinalize.ts:339` branches on it **before** any success toast, with a `destructive`
toast that says the edits were not saved and a 15-second duration. On that path the study is
**not** marked completed, the reading session is **not** credited, `cancelFinalize()` (not
`completeFinalize()`) releases `isFinalizing`, and both local backups **survive** — they are now
the only remaining copy of the discarded text. The test asserts the guard branch *negatively*,
field by field, for all five completion side-effects; a single lazy regex did not catch moving
them into the guard, because `[\s\S]*?` simply jumped ahead to the copies in the `else`. That
hole was found by mutation M7 and the test was rewritten, not the mutation discarded.

*Finalized state is session-only.* Half one was closed by RW-30's `authoritativeStatus`: a
report signed in another tab or another session now locks on reload, from the server's own
status, with no new client state. `qc.invalidateQueries(["pacs-worklist-detail", studyId])` at
`useStudyFinalize.ts:430` makes the lock take effect immediately after signing rather than on
the next refetch. The Hope push is gated on `!finalizeResult.idempotent` (`:385`) — a report
that was not written must not be announced as written.

#### Three new findings, all discovered by verifying this group

**RW-27 — P1, class D. The notification channel has three kinds, one consumer, and an
invisible message that permanently disables the critical-finding interrupt.**

`store.ts:454` declares `kind: "interrupt" | "edge-glow" | "ledger"`. Repo-wide there are
exactly **two** `pushNotification(` producers, both in `store.ts`, and exactly **one** consumer
of `s.notification`:

| Producer | Kind | Rendered? |
|---|---|---|
| `store.ts:1128` — `recomputeCopilot`, unacknowledged critical | `interrupt` | ✓ |
| `store.ts:1315` — a full report format was applied | `ledger` | **✗** |
| — | `edge-glow` | no producer exists |

`interrupt-card.tsx:11` is `if (!n || n.kind !== "interrupt") return null;`. The `ledger`
message is therefore produced into a void. Three consequences compound:

1. **It can never be dismissed.** `clearNotification` has exactly one call site outside the
   store — `interrupt-card.tsx:8` — wired to the card's X (`:25`), its Snooze (`:37`) and its
   workflow close (`:44`). All three are *below* the `return null` guard. A `ledger`
   notification sets `get().notification` truthy with no UI able to clear it.
2. **It suppresses the critical interrupt and its SLA timer.** `recomputeCopilot`'s guard is
   `if (ci.length > 0 && !get().notification)` — and `startCriticalSla()` is *inside* that
   block. `critical-sla-timer.tsx:8` only runs when `startedAt` is set, so one "apply full
   report format" action silently disables both the critical card and the 15-minute escalation
   for the rest of the tab's life. The copilot sidebar still lists the item (`set({ copilotItems })`
   is after the guard), which is the only remaining signal.
3. **It survives every reset path.** `notification` is not in `emptyClinicalState()`, and —
   verified against `bc8ca8c5` — was not in the base FULL reset either. It is pre-existing, not
   a Group E regression, but Group E is what makes the omission a *decision*: the critical-SLA
   flags beside it are reset, so the timer is cleared while the message blocking its restart is
   not.

The wrong-patient edge is also live: `interrupt-card.tsx:9` selects `study` from
`activeStudyId` at render and `:50` seeds the communication dialog's "Communicated to" from
`study?.patient?.referringDoctor` at mount. An undismissed critical from Patient A, followed by
a switch to Patient B, pre-fills B's referring doctor against A's finding.

**RW-28 — P1, class D. The critical-results communication workflow logs nothing.**

`interrupt-card.tsx:49-96` renders a dialog headed *"Critical-Results Communication"* /
*"Log the call for medico-legal record"*, with fields for recipient, method, note, an
actor/timestamp block, and a submit button reading `{logged ? "✓ Logged" : "Log communication"}`.
Its handler is the whole of `:54`:

```js
const log = () => { setLogged(true); setTimeout(onClose, 800); };
```

No API call, no store write, no toast. The file's import list is `useWorkspace`,
`useWorkspaceSelector`, six lucide icons, `Button` and `useState` — there is no mechanism in it
by which anything could be persisted. The claim of a medico-legal record is not backed by one.

The real checklist is elsewhere and is component-local: `checklistComm` is a `useState` in
`useWorkspaceClinicalUi.tsx:944`, and its **only** writer is the rail checkbox at
`ReportCanvas.tsx:1953`. Of the 17 `setChecklistComm` hits repo-wide, 8 are prop-drilling
declarations through 8 workspace components, 4 are the owning hook's own declaration, two
resets and its export, and 4 belong to a second, independent copy — `pages/RadiologyCommandCenter.tsx:247`,
with its own three checkboxes at `:1894/1903/1912`. The value is read at
`useStudyFinalize.ts:214` into `criticalCommunicated`, which feeds two *client-side* gates,
`computeFinalizeSafety` and `criticalFindingBlocksFinalize`. The payload's `criticalSummary` is
a label string and appears **nowhere** in `artifacts/api-server/src`, `lib/db/src` or
`lib/api-zod/src` — a grep that returns no output, reproduced in Appendix A.

So the communication that a critical was telephoned exists in three mutually-unaware places,
none durable across a reload, none reaching the server. The safety net holds — a radiologist
who uses the interrupt dialog instead of the rail checkbox leaves `phoned: false` and is
blocked at signing — but they are told "✓ Logged" first, and then blocked for a reason the UI
never connects to what they just did. Two of the task's own prohibitions, in one component: a
second source of truth, and local React state duplicating canonical report state.

**RW-29 — P3, class G. A source-grep test pinned one line and stayed green while two other
paths leaked the same field.**

`mriDorsoLumbarCanvas.test.ts:57` found the single line in `store.ts` containing
`selectStudy: (id) =>` and asserted that line contained
`dorsoLumbarNumbering: defaultDorsoLumbarState()`. Making `selectStudy` multi-line broke it —
the only test failure Group E caused, and it failed for the *wrong reason*: the assertion was
about formatting, not about the clinical property. Meanwhile the PARTIAL and THIRD paths leaked
`dorsoLumbarNumbering` freely and no test noticed, because both were invisible to a grep aimed
at one line of one function.

This is the exact class `AGENTS.md` warns about — *"Prefer request-level tests over source-text
greps… the grep test stayed green while the endpoint returned HTTP 500 on every call."* It was
fixed by strengthening, not weakening: the test now asserts contract-list membership
(`CLINICAL_RESET_FIELDS` contains the field), helper equality (`emptyClinicalState().dorsoLumbarNumbering`
deep-equals `defaultDorsoLumbarState()`), the source contract that `selectStudy` spreads the
helper, and the property end-to-end through the real action under fake timers. A grep was run
first to confirm no other test pinned the inline list.

#### Evidence

| Check | Result on this box |
|---|---|
| `clinicalStateReset.hardening.test.ts` (new) | **23 passed**, 7 describes — re-run and confirmed at the time of writing |
| 4 files together (new + DL canvas + `observationPersistence.hardening` + `compositionSafety.walkthrough`) | **79 passed** |
| `tsc --noEmit -p artifacts/diagnostic-erp/tsconfig.json` | exit 0 |
| Root `pnpm typecheck` | exit 0 |
| The new test file typechecked in isolation via a temporary `tsconfig.testcheck.json` | exit 0 — **`tsconfig.json` excludes `**/*.test.ts`, so the run above never saw it**; the temp config was deleted afterwards and `tsconfig.json` confirmed as the only one left |
| Full ERP suite, `--no-file-parallelism` | 349 files: **2 failed, 347 passed**; 4,696 tests: **1 failed, 4,695 passed** |
| Root monorepo suite | 817 files: 90 failed / 714 passed; 8,548 tests: 21 failed / 8,487 passed |

The first four rows were **re-run while writing this subsection**, not carried forward from the
implementation run; the two full-suite rows are from the implementation run and are the expensive
ones. Every line-number citation in §30.9 was re-derived from `bc8ca8c5` and `cd572ea1` directly
after C-14, and the Appendix A equivalence command was executed verbatim to confirm it reproduces
the 65 / 61 / 4 / `[]` figures quoted above.

Against Group D's recorded baseline (348 files, 2 failed / 346 passed; 4,673 tests, 1 failed /
4,672 passed) the ERP delta is exactly **+1 file and +23 tests with an identical failure set** —
no regression. All 90 root file-level failures throw `DATABASE_URL must be set` at import from
`lib/db/src/index.ts:8` (97 api-server + 4 `lib/ai-providers` lines), plus the known CRLF golden
mismatches in `api-server/src/lib/structuredReport/renderer.test.ts`. **Zero** diagnostic-erp
failures appear in the root run that do not appear in the ERP-scoped run.

**Eighteen mutations.** One of them, M7, **was not caught on the first run** — the test was
rewritten (C-13) and M7 is caught now, along with three further variants M7b/M7c/M7d that the
rewrite made expressible. Final state: **0 NOT CAUGHT, 0 bad restores.** Each mutation was
verified to have landed by byte-comparing the written file, and every file was `diff -q`'d back
to a pre-run backup afterwards; the whole tracked diff was compared to that backup at the end
and matched.

| # | Mutation | Result |
|---|---|---|
| M1 | PARTIAL reset reverts to its 16-key literal | caught |
| M2 | the cross-study guard in `undoLastPatch` dropped | caught |
| M3 | the snapshot's `activeStudyId` stamp nulled | caught |
| M4 | `contentLocked` back to the queue row | caught |
| M5 | `draftBackup.enabled` back to the queue row | caught |
| M6 | `authoritativeStatus` stops preferring the detail row | caught |
| M7 | the backup clears moved **into** the idempotent guard | **not caught — then the test was fixed** |
| M7b | `completeFinalize()` moved into the guard | caught (by the rewritten test) |
| M7c | `markCompleted` moved into the guard | caught (by the rewritten test) |
| M7d | `cancelFinalize()` removed from the guard | caught |
| M8 | the lifecycle helper stops returning `idempotent` | caught |
| M9 | the end-of-queue reset reverts to 4 fields | caught |
| M10 | `acknowledgedCopilotIds` hoisted to a shared module constant | caught |
| M11 | `selectStudy`'s unknown-id warning silenced | caught |
| M12 | the refused-undo toast removed | caught |
| M13 | the detail-query invalidation removed | caught |
| M14 | the Hope push ungated | caught |
| M15 | the idempotent toast guard removed | caught |

M10 deserves its line: `acknowledgedCopilotIds: new Set()` becoming a shared module constant
still typechecks, still passes a shallow equality assertion, and makes every patient inherit the
previous patient's acknowledgements — the critical-finding card would never fire again for the
same reason RW-27 describes, from a completely different direction. It is caught by the test
asserting that two `emptyClinicalState()` calls share no reference-typed value.

**Four of the thirteen mutations in the first run reported "PATTERN NOT FOUND"**, and the cause
is recorded as C-12 because it is the same class as C-9 and C-10: `core.autocrlf=true` with no
`.gitattributes` for source means pre-existing files are CRLF in the working tree while the
patterns were written LF. The one mutation targeting a newly-`Write`-created file (LF) matched,
which is what isolated the cause. A normaliser fixed it and the remaining five mutations were
added afterwards. **A mutation runner that reports "not found" for a third of its table and is
not read is indistinguishable from a green run.**

**The two ERP failures were proven pre-existing without touching the working tree** — no
`git stash`, deliberately, per the shared-worktree rule. `aiQueryContract.test.ts:52` does
`f.replace(ERP_SRC + "/", "")`, a no-op when `join()` produced `\`, so the one file it intends to
whitelist reads as the offender; `git diff --name-only HEAD` does not include
`aiReportingClient.ts`, so the change cannot be implicated. `composeStudyContext.test.ts` fails
at *collection* on `DATABASE_URL must be set` before any test body runs.

#### Out of scope, recorded so the omission is a decision and not an oversight

- **RR-01, RR-02, RR-03** — the three P0s. All are server-side immutability and attribution of
  an already-signed report. Group E is a client-isolation group and touching them here would
  have meant a schema change inside a safety commit (§27, §28).
- **A server-side 409 on divergent content** as the alternative to the idempotent-200 the client
  now reads. Rejected for this group: the flag was already there, unused, and §2 forbids
  introducing a second mechanism when a canonical one exists.
- **`allowEditSigned` trial-edit semantics** — who may edit a signed report, and whether the
  edit is a new version or an amendment. §31 owner decision.
- **`autoSignReport` still runs on the idempotent path** and may write a second signature audit
  event for a report that was not written. Found after the commit; **not verified** — recording
  it as a lead, not a finding, because the signature-audit writer was not read.
- **RW-27 and RW-28 are recorded, not fixed.** Both need decisions before code: RW-27 needs one
  about whether `ledger`/`edge-glow` should render at all or be deleted, and RW-28 needs a
  server-side critical-communication record, which is a schema change. *(Written before Group F
  was scoped; Group F became the failure-mode and journey group, §30.10. Both remain open.)*

---

### 30.10 Group F — the failure-mode and journey tests (`9c010fe7`)

§23 and §24 named thirteen failure modes that had to have a regression test. This group's job was
to find which of the thirteen already had one and write only the rest. It found one live defect,
one untested safety gate, one clinical guard with no test at all, and two guards whose tests
cannot fail.

#### The thirteen, as measured

"Covered" below means a test was **executed** during this group and observed to pass, not that a
file with a plausible name exists.

| # | Failure mode (§23/§24) | Status before | Where it is covered | Written here |
|---|---|---|---|---|
| 1 | male + uterus / female + prostate | **covered** | `lib/report-quality/src/text/evaluate.demography.test.ts:23-85` — a six-test Q109 describe, incl. free-text gender values and the unknown-sex negative | no |
| 2 | laterality flip | partial | `reportFieldMerge.test.ts:75` (merge), `aiDraftValidation.test.ts:52` (notice), `validateOutput.definiteMutations.test.ts:96,120` (detection) | merge-level assertion added; see RW-33 |
| 3 | measurement 12.6 mm → 12 mm | **absent** | — | **6 tests**, `reportFieldMerge.test.ts:97-146` |
| 4 | spine level L4-5 vs L5-S1 | covered | `impressionRecommendationWiring.test.ts:26`, `validateOutput.definiteMutations.test.ts:150,170` | merge-level assertion added |
| 5 | History retained at finalize | covered | `storedReportBody.test.ts:176-183` | no |
| 6 | Technique retained at finalize | covered | `storedReportBody.test.ts` (`TECHNIQUE`, `CECT Brain`) | no |
| 7 | staleness after a Findings edit | covered | `observationPersistence.hardening.test.ts:315-375` (8 cases), `compositionSafety.walkthrough.test.ts:118` | no |
| 8 | orphaned Recommendation | covered | `observationPersistence.hardening.test.ts:377-518`, `:545-580` | no |
| 9 | unsupported abnormality from `/draft` | **covered** | `aiReporting.query.test.ts:551-633` — "output is grounded by the composer's own validator", incl. `:580` asserting `unsupported_abnormality` on the `/draft` route | no |
| 10 | malformed Composer output | **covered** | `aiDraftValidation.test.ts:89-111` — an unknown error code default-surfaces; `impression_ungrounded` is phrased clinically | no |
| 11 | delayed Study A AI result on Study B | **absent — and the defect was live** | — | **fixed + 7 tests** (RW-31) |
| 12 | pending AI text not silently signed | partial — text level only | `preDeploySafety.test.ts:56` proved `materializeAcceptedText` skips PENDING; the finalize gate itself had **no test** | **gate extracted + 10 tests** (RW-32) |
| 13 | A→B→A rapid switch | partial | `radiologyWorkspaceSafety.test.ts:22`, `clinicalStateReset.hardening.test.ts:190-297` | **4 tests** through the real store |

Six of the thirteen were already covered and were left alone. Rows 1, 9 and 10 are recorded as
covered **against the survey that opened this group, which said otherwise** — see C-15.

#### RW-31 (P2 as classified at §22-E, argued up to P1 here → FIXED) — Ctrl+I awaited the model with no study check

The audit pass graded this P2 on the reasoning *"ghost text only — acceptance is explicit"*, and
that reasoning is sound as far as it goes. This group grades it P1, and the disagreement is
recorded rather than resolved by quietly re-numbering: the ghost layer is one Tab+Enter from the
report body, the radiologist who triggers it has just switched patients and is looking at a
different study than the one the text describes, and the text is a *summary of findings that are
not on screen* — so nothing about the acceptance gesture invites the comparison that would catch
it. A wrong-patient content vector whose only defence is an explicit keystroke is not a P2 in a
list-working environment. Both gradings are left visible.

`useTriggerAiImpression.ts` read the findings, posted to `/api/ai-reporting/draft`, and on the
response called `setGhostText(res.impression, "impression")` against `useWorkspace.getState()` —
whatever study was open *when the answer arrived*, not the one the request was built from. A
local model takes seconds; a radiologist working a list moves on inside that window. The result
is Patient A's impression sitting in Patient B's ghost layer, one Tab+Enter from being accepted
into B's signed report, summarising findings that are not on screen.

This is §22's **scenario E**, recorded open in the audit pass, and it was the only remaining
vector: `ghostText` and `ghostTextTarget` are both in `CLINICAL_RESET_FIELDS`
(`clinicalStateReset.ts:55-56,130-131`), so a switch through any reset path already cleared a
*pending* ghost. What no reset could reach was a callback still in flight.

The fix captures both identities before the `await` and drops the answer, with a toast, if either
has moved:

```ts
const requested = {
  studyId: atRequest.activeStudyId,
  studyInstanceUID: atRequest.activeStudyInstanceUID ?? studyInstanceUID ?? null,
};
// …await api.post(…)
const now = useWorkspace.getState();
const sameStudy =
  shouldApplyAsyncStudyKey(requested.studyId, now.activeStudyId)
  && shouldApplyAsyncStudyKey(requested.studyInstanceUID, now.activeStudyInstanceUID);
```

Two decisions inside it are load-bearing and are documented at the code:

- **Both identities, not one.** `activeStudyId` is set by the URL effect and
  `activeStudyInstanceUID` by a separate effect on the worklist row
  (`useWorkspaceClinicalUi.tsx:2090-2107`), so the workspace can produce a partial binding where
  one has moved and the other has not. Refusing on either is the only safe reading.
- **A null request key is not a refusal.** Worklist rows without a `StudyInstanceUID` are
  legitimate. Refusing those would disable Ctrl+I for every such study — a usability regression
  bought with no safety, because there was no identity to lose. `shouldApplyAsyncStudyKey`
  therefore differs from its numeric sibling on exactly this branch, and says so.

The helper had to be added because the canonical one could not carry the value:
`shouldApplyAsyncStudyResult` compares via `Number()`, and `Number()` on a DICOM UID is `NaN`, so
`NaN === NaN` is `false` and **every** result would have been refused. That is asserted rather
than assumed, at `radiologyWorkspaceSafety.test.ts:36-42`.

#### RW-32 (P2 → FIXED) — the pending-AI finalize gate was sixteen untested lines

"Guard 10" (`useStudyFinalize.ts:117-133` at `cd572ea1`) is what stops a radiologist signing
while an AI review is outstanding. It lived inline in a 455-line hook that no test in this repo
can reach, because the ERP test environment has no DOM. By §39's own standard — *a validator
existing is not evidence that it runs* — its correctness was unproven.

Extracted verbatim to `lib/aiFinalizeGate.ts` as `decideAiFinalizeGate`, behaviour unchanged, and
tested ten ways. The extraction also made one deliberate design choice visible for the first
time, and it is now documented rather than buried in a boolean:

> The gate only fires for `READY` / `STALE_READY`. Under any other status — `QUEUED`,
> `COMPOSING`, `FAILED`, `APPLIED`, `DISCARDED`, `CANCELLED`, `OBSOLETE` — pending rows pass
> through. That is **not** a hole, for two independent reasons, and the test
> `does not strand the radiologist on a job status the review panel cannot act on` pins both:
> `ReportComposerAssistant.tsx:307` gates its action bar on the same two statuses, so blocking
> elsewhere would raise a dialog with no button to clear it; and AI text reaches the report only
> through `applyAccepted`, which `materializeAcceptedText` (`reportComposer/types.ts:355`)
> confines to `ACCEPTED`/`EDITED`. Guard 10 is a **workflow** gate. The text-safety property is
> carried by `materializeAcceptedText`, and was already proven at `preDeploySafety.test.ts:56`.

The distinction matters for how much weight this gate can bear. It is a nudge, and it is now
tested as one; the reason no unreviewed AI sentence can appear in a signed body does not depend
on it.

One further assertion, `WIRED: the gate runs before anything irreversible`, checks **order**
inside the gauntlet — gate → `saveDraft()` → `validateReport()` → `/api/signatures` →
`finalizeRadiologyReport(`. A gate that runs after the signature fetch is not a gate. The first
attempt at this test passed for the wrong reason: `finalizeRadiologyReport` first appears in the
file as an *import* at `:12`, so the needle matched the import and the ordering claim was vacuous.
It now names the call site at `:302`.

#### RW-34 (P2 → FIXED) — measurement precision, the guard §17 named, had no test

§17's canonical example is *"AI must not casually rewrite `8.7 mm` as `8 mm`"*. The guard exists —
`reportFieldMerge.ts:406`, `/\b\d+(\.\d+)?\s*(mm|cm)\b/i` inside `CLINICAL_GUARDS` — and had
**no test anywhere in the repo**. `aiDraftValidation.test.ts:79-87` tests the *notice* shown when
the server reports `measurement_mutation`; nothing tested the client merge that decides whether
the two sentences collapse.

Six tests now cover it, and the guard is **proven load-bearing**: deleting the mm/cm row fails
two of them (`does not collapse 12.6 mm into 12 mm`, `keeps a decimal when the AI paraphrase
drops it`). Also covered: a unit change (`12 mm` vs `12 cm`) is a conflict and not a
restatement; a measurement is not moved between levels; and an identical measurement still
dedupes, so this is not a blanket refusal to merge.

The two-measurement case is the instructive one and its comment records why:

```
existing: "Canal 12.6 mm and foramen 4.1 mm at L4-L5."
incoming: "Canal 12.6 mm and foramen 4 mm at L4-L5."
```

`hasConflictingClinicalDetail` compares only the **first** match of each guard regex
(`reportFieldMerge.ts:410-414`), and the first mm/cm match is identical in both sentences — so
the guard does not fire. The sentence still does not merge, because the word-level subsequence
test fails on `4.1` vs `4`, and the precise figure survives. The guard and the subsequence check
overlap; neither alone is sufficient, and a first-match-only comparison is a real limitation that
happens to be covered here by the second mechanism.

#### RW-33 (P3, class G) — two clinical guards have no test that can fail

Measured, not inferred. Deleting each guard row from `CLINICAL_GUARDS` and running the full ERP
suite:

| Guard row deleted | Tests that fail |
|---|---|
| `/\b\d+(\.\d+)?\s*(mm\|cm)\b/i` | **2** |
| `/\b(left\|right\|bilateral)\b/i` | **0** |
| `/\b(l[1-5]\|c[1-7]\|t[1-12]\|s[1-5])\b/i` | **0** |
| the whole comparison (`return false`) | **3** — the 2 above plus an unrelated pre-existing win32 failure |

So the laterality and spine-level rows are **not load-bearing for any test in this repository**.
`reportFieldMerge.test.ts:75` *"preserves laterality differences"* and `:83` *"preserves severity
differences"* both pass with their guard deleted, because the word-subsequence check at
`:456-459` independently refuses to merge two sentences whose words differ. They are vacuous in
the sense that matters: they cannot detect the regression they appear to guard against.

This is **not** a claim that the behaviour is wrong — it is correct, twice over — and not a claim
that the guard rows should be deleted, because the subsequence check is a blunt instrument that
happens to align here and there are inputs (a paraphrase that reorders words while keeping them)
where only the guard would catch a flip. It is the class-G finding: a green test that gives
credit for a property it does not test. Recorded, and the two rows left in place with their real
justification now written down.

Note the asymmetry with `validateOutput.definiteMutations.test.ts:96,120,150,170`, which *does*
prove laterality and level detection on the server-side validator. The unproven rows are the
client merge's, not the pipeline's.

#### C-15 — the coverage survey that opened this group was wrong three times

The survey reported scenario 1 (Q109) as *"PARTIAL — no engine-level test that Q109 actually
emits"* and scenarios 9 and 10 as PARTIAL. All three were already covered, and running them was
enough to show it: `evaluate.demography.test.ts` is a six-test describe **named for Q109** that
asserts `toContain("Q109")` on the engine's own output; `aiReporting.query.test.ts:551-633` is a
five-test describe on `/draft` grounding. 61 tests across those three files, executed, all
passing.

The survey had grepped for the *client-side* rule id and for the file name `aiReporting.draft*`,
which does not exist — the `/draft` tests live in a file named for `/query`. Both are the same
error as C-14 and C-1: a conclusion carried forward from an indirect signal instead of reading
the file. It cost nothing here because the survey was treated as a hypothesis to verify and not
as a work list. Had it been treated as a work list, three already-covered scenarios would have
been re-written as duplicates and the real gap — scenario 11, the only live defect — would have
been one of thirteen instead of standing out.

#### Mutation verification

Seven mutations of the new wiring, each applied to the real source, run, and restored from a byte
copy. Restoration was confirmed with `git diff --stat` after each, and the files were verified
identical to their committed state at the end. (An eighth, disabling `CLINICAL_GUARDS` wholesale,
was run against the whole ERP suite to produce RW-33's table below.)

| # | Mutation | Caught by | Result |
|---|---|---|---|
| M1 | delete the study guard from `useTriggerAiImpression` (revert RW-31's fix) | Journey 11 WIRED | **caught** (1 failure) |
| M2 | guard compares `now.activeStudyId` to itself — a no-op that still names the helper | Journey 11 WIRED | **caught** (1 failure) |
| M3 | reinstate the inline gate, drop `decideAiFinalizeGate` | Journey 12 WIRED | **caught** (1 failure) |
| M4 | delete `aiFinalizeBypassRef.current = false` — the bypass stays latched for the next attempt | Journey 12 WIRED | **caught** (1 failure) |
| M5 | delete the mm/cm guard row | `reportFieldMerge.test.ts` | **caught** (2 failures) |
| M6 | delete the laterality guard row | — | **not caught** → RW-33 |
| M7 | delete the spine-level guard row | — | **not caught** → RW-33 |

M2 is the mutation that a naive source-contract test would miss: `shouldApplyAsyncStudyKey` still
appears in the file, still with plausible arguments. It is caught because the contract asserts
the **arguments** (`requested.studyId`, `requested.studyInstanceUID`) and their **order** relative
to the `await` and to `setGhostText`, not merely the presence of an identifier.

M6 and M7 are reported as not caught rather than quietly dropped, and became RW-33.

#### Evidence

```
# the 33 new tests, plus the two files they extend and the Group E file they build on
npx vitest run artifacts/diagnostic-erp/src/lib/reportingWorkspaceJourneys.hardening.test.ts \
  artifacts/diagnostic-erp/src/lib/radiologyWorkspaceSafety.test.ts \
  artifacts/diagnostic-erp/src/lib/reportFieldMerge.test.ts \
  artifacts/diagnostic-erp/src/lib/clinicalStateReset.hardening.test.ts \
  artifacts/diagnostic-erp/src/lib/aiDraftValidation.test.ts --reporter=dot
#   Test Files  5 passed (5)   Tests  102 passed (102)

# rows 1, 9 and 10 of the thirteen — the coverage the survey said was missing
npx vitest run artifacts/api-server/src/routes/aiReporting.query.test.ts \
  artifacts/api-server/src/lib/reportComposer/validateOutput.definiteMutations.test.ts \
  lib/report-quality/src/text/evaluate.demography.test.ts --reporter=dot
#   Test Files  3 passed (3)   Tests  61 passed (61)

# typecheck — clean, and the tsconfig.testcheck.json removed afterwards
npx tsc --noEmit -p tsconfig.json                                    # exit 0
npx tsc --noEmit -p tsconfig.testcheck.json                          # exit 0

# the whole ERP suite, for the pre-existing/regression split
npx vitest run --reporter=dot --no-file-parallelism
#   Test Files  2 failed | 348 passed (350)   Tests  1 failed | 4728 passed (4729)
```

`tsconfig.testcheck.json` needs **both** `include` overridden and `exclude` reset to
`["node_modules","build","dist"]`. The first attempt set only `include` and exited 0 having
typechecked nothing: the inherited `exclude: ["**/*.test.ts"]` wins, and tsc reports
`TS18003: No inputs were found`. An exit code of 0 from that config is not a clean typecheck.

The two ERP failures are the same two recorded at §30.9, re-confirmed by reading their output
rather than by assumption:

- `aiQueryContract.test.ts:52` — `f.replace(ERP_SRC + "/", "")` is a no-op when `join()` produced
  `\`, so the one file the test intends to whitelist reads as the offender. Pre-existing, win32
  only, and not touched by this group.
- `composeStudyContext.test.ts` — fails at *collection* on `DATABASE_URL must be set`, before any
  test body runs. This box has no database.

Neither file is imported by anything this group changed.

#### Out of scope, recorded so the omission is a decision and not an oversight

- **RW-27 and RW-28** remain open. RW-27 needs owner decision 10; RW-28 needs a server-side
  critical-communication record, which is a schema change (§27).
- **The PARTIAL reset path is still source-contract only.** Journey 13 exercises the FULL
  (`selectStudy`) and third (`advanceToNextStudy`) paths behaviourally against the real store,
  because both are reachable from a test. The PARTIAL path lives in a `useEffect` inside
  `useDraftPersistence` and cannot be driven without a DOM. Same limitation as §30.9, unchanged.
- **`hasConflictingClinicalDetail`'s first-match-only comparison** was found, explained and left
  alone. Fixing it means comparing all matches of each guard, which changes merge behaviour on
  inputs no test currently pins — a behaviour change inside a test group (§28).
- **No fix to RW-33.** Deleting the two unproven guard rows would be a behaviour change with no
  test able to detect it either way, which is the one thing this group is not entitled to do.

### 30.11 Whole-repo verification — `bc8ca8c5` against `9c010fe7`, measured not assumed

§29 of the task requires PRE-EXISTING and REGRESSION to be separated, and the standing rule
requires a "pre-existing" claim to be re-verified rather than asserted. The separation cannot be
argued from the shape of the diff, because the branch is not confined to one package: `git diff
--stat origin/main...HEAD` measures **40 files across `artifacts/api-server`,
`artifacts/diagnostic-erp`, `lib/api-zod` and `lib/report-quality`**, and at least three
api-server tests read ERP source directly (`preDeploySafety.test.ts:15`,
`localOpenAiCompatible.provider.test.ts:362`, `radiologistDraftComposer.golden.test.ts:587`).
So the baseline was measured.

**Method.** A detached `git worktree` at `bc8ca8c5` with all 20 `node_modules` directories
junctioned back into the main tree, then the identical invocation in both trees —
`node ./node_modules/vitest/vitest.mjs run --reporter=dot`, vitest v4.1.5, no `DATABASE_URL`
exported, no root `.env` present in either tree. Two traps, both recorded at §28: the junction
loop that reported success without creating anything (C-18), and the first set-diff that compared
two differently-normalised lists (C-19).

| | baseline `bc8ca8c5` | branch head `9c010fe7` | delta |
|---|---|---|---|
| Test files | 89 failed / 710 passed / 13 skipped (**812**) | 90 failed / 715 passed / 13 skipped (**818**) | **+6 files, all added by this branch** |
| Tests | 21 failed / 8375 passed / 40 skipped (**8436**) | 22 failed / 8519 passed / 40 skipped (**8581**) | **+145 tests, +1 failure** |
| Duration | 27.42 s | 27.97 s | — |

A third run of head via `npx vitest` (same version) reported 89 failed files / 20 failed tests.
The ±1 against the table is one flaky test, identified below.

**Failing-file set, both sides normalised through the same function:**

- **Only at head — 1 file:** `artifacts/api-server/src/routes/reportQuality.demography.request.test.ts`.
  Added by Group B. Fails at *import* on `DATABASE_URL must be set` at `:24`, before any test body
  runs, for the same reason as the 82 pre-existing files below. It is not an assertion failure and
  it is not new behaviour — it is a new file in a class this box cannot exercise.
- **Only at baseline — 0 files.**
- **Test-level failures — the same 7 files on both revisions.** Nothing that ran at baseline and
  asserted something stopped asserting it, and nothing new started failing an assertion.

**Cause census over head's 83 collection failures: 83 of 83 are `DATABASE_URL must be set`.** 82
surface the throw directly from `lib/db/src/index.ts:8`; the 83rd,
`composeEngine.mimeAndFallback.test.ts`, surfaces it as a `vi.mock` hoisting error whose import
chain reaches the same throw through `voiceReportComposer/runtimeConfig.ts:5`.

The 7 files that get far enough to fail a test are all win32/environmental, and all fail
identically at `bc8ca8c5`:

| File | Failing | Cause, read from the output |
|---|---|---|
| `structuredReport/renderer.test.ts` | 5 | Golden bodies compared byte-for-byte; the working tree is CRLF (`core.autocrlf=true`, no `.gitattributes` covering them). The diff prints lines that look identical. |
| `dockerCompose.test.ts` | 9 | `getServiceBlock()` returns `''` for **every** service including `db` — the extractor as a whole fails on CRLF, not any one assertion about compose content. |
| `backupHealth.test.ts` | 2 | `resolveDataDir({}, "/app")` returns `C:\app\data`. A POSIX-path assertion evaluated on Windows. |
| `secretStrength.test.ts` | 1 | Imports `cron.ts` → `lib/db` → the same `DATABASE_URL` throw, from inside a test body rather than at collection. |
| `pacs/mwlDeploymentStatus.test.ts` | 1 | `inspectWorklistQuarantine` counts 0 `.wl` files where the fixture wrote 2. |
| `restoreVerifiesRealArtifact.test.ts` | 1–2 | **`Error: Test timed out in 5000ms.` Nondeterministic** — failed at baseline, failed head run B, passed head run A, and the specific test that times out varies between runs. Recorded as a flake, and **not** claimed as a fix in the run where it passed. |
| `diagnostic-erp/src/lib/aiQueryContract.test.ts` | 1 | The test's own whitelist strip, `f.replace(ERP_SRC + "/", "")` at `:52`, is a no-op on a `\`-joined path, so `lib/aiReportingClient.ts` — the one file it means to allow — is reported as the offender. Same failure at both revisions. |

**REGRESSIONS: 0.** No assertion that passed at `bc8ca8c5` fails at `9c010fe7`.

Every number in this subsection was measured with the branch at `9c010fe7`. One commit has been
added since — `8435d2b4`, which changes only the text of a block comment in `lib/aiFinalizeGate.ts`
and cannot alter a test or build result. Re-run the two commands in step 3 above to re-measure
against any later head.

#### What this box cannot verify, stated as a gap rather than a pass

All 83 DB-gated files are unexercised here. CI does exercise them: `.github/workflows/ci.yml:53-71`
provisions `postgres:16-alpine` and exports
`DATABASE_URL=postgresql://erp:erp@localhost:5432/care_test`. But `git ls-remote --heads origin`
returns **only `main`** — this branch has never been pushed, so **CI has never run on it**. The
Group B request-level suite, the extended `aiReporting.query.test.ts` and `patient-reports.d8.test.ts`
are therefore **UNVERIFIED against a real database**. That is the largest single evidence gap in
this remediation, and it is closed by pushing the branch, not by further local work. Per §39 it is
recorded as UNKNOWN rather than as a pass.

The local PostgreSQL 18 service on this machine was deliberately **not** used to close the gap: it
is password-gated and may hold the operator's real data.

#### Build

| Step | Result |
|---|---|
| `pnpm run check:grounding` | **Pass.** 105 architecture claims, all `✓`, no `✗`. |
| `pnpm typecheck` | **Pass.** `typecheck:libs` plus api-server, diagnostic-erp, clinic-site, diagno-booking-mobile and scripts all `Done`, zero diagnostics. |
| `pnpm -r --if-present run build` | **Fails at `@workspace/diagno-booking-mobile`**: `ERROR: No deployment domain found. Set REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or EXPO_PUBLIC_DOMAIN`. Pre-existing and unrelated — the branch changes **0 files** in that package (measured from the same `git diff --stat`). It aborts the recursive run before the ERP builds. |
| `pnpm --filter @workspace/api-server run build` | **Pass**, exit 0. `dist/index.mjs` 17.0 mb, `dist/worker.mjs` 8.2 mb. |
| `BASE_PATH=/erp/ pnpm --filter @workspace/diagnostic-erp run build` | **Pass**, exit 0, `✓ built in 11.93s`, 420 chunks. `dist/public/index.html` references `/erp/assets/index-BUcxejKe.js` — the production base path is baked correctly, not the Git-Bash default. |

#### The shipped artifact, not just the source

§39's standard — *a component existing is not evidence that it is wired* — applies to the bundle
too, and a passing test file proves nothing about what ships. Three strings introduced by Groups C,
E and F were grepped for in the **minified production chunks**:

| String | Introduced by | Found in |
|---|---|---|
| `You moved to another study while the model was working` | Group F (RW-31, the Ctrl+I study-identity refusal) | `RadiologyReportingWorkspace-CQ5ctF_Z.js` |
| `AI suggestions remain unreviewed` | pre-existing text, now reached through `decideAiFinalizeGate` (RW-32) | `RadiologyReportingWorkspace-CQ5ctF_Z.js` |
| `failed a grounding check` | Group C (RW-22, the unknown-verdict default-surface branch) | `RadiologyReportingWorkspace-CQ5ctF_Z.js` |

All three land in the reporting workspace's own lazy-loaded chunk. This is weak-but-real evidence
that the guarded code paths are reachable in the production bundle and were not tree-shaken into
nothing; it is not evidence that they execute, which is what the tests in §30.10 are for.

---

## 31. OWNER DECISIONS REQUIRED

These are product/clinical decisions, not engineering ones. Nothing here has been
changed in code.

1. **Should any quality finding hard-block a signature?** `ARCHITECTURE.md §8.1` still
   lists this as open and needing sign-off. Today: none do. If yes, which severities,
   which modalities, and who may override (§8.2)? USG already hard-blocks through a
   separate path (`usgQualityCheck.ts`), so a "yes" creates two blocking regimes
   unless they are unified.
2. **The "Ready to sign" badge** (`FinalizeSignDialog.tsx:190`) renders green and
   unconditional even when unresolved structured blockers are listed directly beneath
   it. Keep, or make it reflect the findings?
3. **"Copy findings" replaces the radiologist's Findings text** (RW-19) with no undo
   snapshot, and the change is attributed as a manual edit. Should it merge, or should
   it require an explicit confirm? This is a data-loss surface, not a cosmetic one.
4. **Q007 / required measurements** (RW-21): is computing the protocol-vs-report gap
   worth a per-study lookup on the finalize path? Without it the rule stays dead.
5. **Wiring the 19 unreachable structured rules** (§30.5) needs measurements and
   finding instances on the quality context. Per `ARCHITECTURE.md §8.3` that is gated
   on D1 dual-write being funded and populating. Is that in scope, and for which
   modalities first?
6. **`demographyOverrides`** (`useWorkspaceClinicalUi.tsx:579`) is local state that is
   never persisted. An operator-corrected sex or age silently reverts on reload and
   never reaches the server, which now resolves canonically anyway. Keep as a
   display-only convenience, or persist and make it authoritative?
7. **Should Ctrl+I send Clinical History and Technique to `/draft`?** (Group C, §30.7.)
   Today it sends Findings, modality and study UID only, so the Impression is generated
   without the question the study was ordered to answer — and `groundedCorpus` cannot see
   the history either, so a draft that contradicts the referral question is invisible to the
   validator as well as to the label. Sending them is a small change to
   `useTriggerAiImpression`'s options, but it **also changes how often Ctrl+I warns**,
   because more corpus means fewer `unsupported_abnormality` hits and more
   `impression_ungrounded` ones. That trade-off is a workflow decision, not an engineering
   one. Related: should grounding ever **hard-block** an AI draft, or stay advisory forever?
   Same open question as decision 1, now on a second path.
8. **`POST /query` output and the "Insert Into Report" flag** (RW-24, RW-25).
   `DicomViewer`'s AI tab is the only surface that offers model *Findings* prose for a
   report, and it is the only AI generation path with no grounding validation — because
   `/query` is free-text and `validateComposerOutput` is section-aware. Options: parse
   `/query` output into sections and validate it; add a section-agnostic grounding subset; or
   leave it unvalidated and stop presenting its output as a report draft. Separately,
   **"Insert Into Report" moves no text** and sets `wasInsertedToReport = true`, which the AI
   Audit Log renders as **"Yes"**. Either relabel the button ("Mark as used") or make the flag
   mean what it says. Until then the audit log can claim AI text reached a report when the
   only thing that happened was a button press.
9. **Should an orphaned recommendation be named while the radiologist is typing, or only at
   the sign dialog?** (RW-08, Group D, §30.8.) Today it is the sign dialog only, because that
   is the last point at which the advice can still be re-read and it needed no new state.
   Naming it live would mean a second producer into the in-workspace banner
   (`ownershipReviewWarnings`) plus a store field, and would put an amber notice on screen
   *while* the radiologist is mid-edit — deleting a finding legitimately stales its advice for
   a few seconds before the Impression is regenerated. That is a workflow judgement about
   interruption, not an engineering one. Related and smaller: a report format that carries
   Findings but no `defaultImpression`, applied to an empty report, now leaves the
   stale-impression gate armed and asks for the acknowledge tick. That is a spurious prompt on
   an uncommon path erring in the safe direction; say the word and it will be suppressed at the
   source instead.
10. **The critical-finding channel needs three decisions at once** (RW-27, RW-28, found while
    verifying Group E, §30.9). None is an engineering choice.
    - *Should the notification channel keep three kinds?* `ledger` and `edge-glow` have no
      renderer. Either give them one — a quiet, dismissible strip for "a full report format was
      applied" is defensible and would have prevented the suppression below — or delete both
      kinds and let the format-apply action use a `toast`, which already works. What must not
      stand is a message that is produced into a void while still occupying the single
      `notification` slot.
    - *Should a visible notification suppress a critical interrupt?* Today
      `recomputeCopilot`'s guard is `!get().notification`, which conflates "a critical card is
      up" with "anything is in the slot". Because the `ledger` message cannot be dismissed
      (its only clear affordance is below a `return null`), one formatting action disables the
      critical card **and** `startCriticalSla()`, so the 15-minute escalation never begins, for
      every later patient in that tab. The copilot sidebar still lists the item, so nothing is
      lost silently — but the interrupt and the SLA are the two mechanisms the channel exists
      to carry. Fixing this means either scoping the guard to `kind === "interrupt"` or giving
      criticals their own slot; both change how often a radiologist is interrupted, which is a
      workflow judgement. Related: should `notification` join `emptyClinicalState()`? It was
      not in the FULL reset before Group E either, so this is pre-existing, but the critical-SLA
      flags beside it *are* reset — the timer is cleared while the message blocking its restart
      is not.
    - *Does a critical-results communication need a durable record?* The dialog that says
      *"Log the call for medico-legal record"* writes nothing; the real checklist is
      component-local `useState`, duplicated independently in the command-centre page, and never
      reaches the server (`criticalSummary` appears nowhere in `api-server`, `lib/db` or
      `lib/api-zod`). The finalize gate does catch an unchecked box, so no unsigned critical can
      be issued — but there is **no record of who was telephoned, when, by whom**, and a reload
      loses the fact that the call happened. Making it durable is a schema change and therefore
      a `migrations/*.sql` file, per the standing rule that `care-db-patch-v2` is the only thing
      that touches the clinic's database. The alternative is to relabel the dialog so it stops
      promising a record it does not keep. Which one is a medico-legal decision for the owner.

11. **Should the next-study warm-up send images at all?** (RW-23's residual half, §30.7.) The
    stored-draft half of RW-23 is closed by `warmUpOnly`. The egress half is not: the fetch at
    `aiReporting.ts:1253-1268` is gated on `studyInstanceUID` alone, so reaching 80% on the
    *current* study pulls up to 6 unredacted middle-slice JPEGs of the *next* patient out of
    Orthanc and sends them to the resolved provider, for a report nobody has started and whose
    result is discarded client-side. Since `DICOM_REDACTION_PERFORMED` is `false`, "unredacted"
    is the measured state, not a precaution.
    - *Option A — condition the fetch on `!warmUpOnly`.* The warm-up still achieves its entire
      stated purpose (`resolveLocalAiRuntime` + one inference pulls the model into memory; the
      comment at `useWorkspaceClinicalUi.tsx:2210-2213` says exactly that and never mentions
      images). Text-only warm-up also removes the `numCtx` escalation at `:1276-1280` that
      exists only because 6-image payloads are ~6453 tokens, so the warm-up gets cheaper and
      less likely to time out. Cost: nothing observable — no caller reads the response.
    - *Option B — keep it.* The only argument is that a warm-up which exercises the vision path
      warms more of the pipeline than one which does not. Whether the provider caches anything
      across requests that would make this matter is **UNKNOWN** and not documented anywhere in
      `lib/ai-providers`.
    - *Clinical consequence of leaving it:* none for the next patient's report — the result is
      discarded. The consequence is **privacy and medico-legal**: patient B's images are
      transmitted before anyone opens patient B, on a trigger (80% progress on patient A) that
      no consent or workflow step corresponds to, and the audit row that records it attributes
      the call to whoever was logged in at the time.
    - *Recommended technical default:* Option A. It is a one-line condition on an existing flag,
      it is strictly reducing, and it makes the `warmUpOnly` flag mean what its name says —
      "warm the model", not "warm the model with this patient's images". Not implemented here
      because it changes what a shipped network call sends and **no test in this repository
      observes egress**, so the change could not be proven either way on this box.

---

## Appendix A — verification commands (read-only, except the §30.11 block, which says so)

```bash
# RW-01: the signed body's section set, and its verbatim storage
sed -n '255,265p' artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts
grep -n "htmlBody\|body:" artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts
sed -n '2585,2595p' artifacts/api-server/src/routes/patient-reports.ts
grep -n "defaultValue" artifacts/api-server/src/lib/radiologyFeatureFlagRegistry.ts

# RW-04: the rule, the builder, the route
sed -n '160,170p' lib/report-quality/src/text/evaluate.ts
sed -n '85,115p' artifacts/diagnostic-erp/src/lib/reportQualityFinalize.ts
sed -n '238,252p' artifacts/api-server/src/routes/reportQuality.ts

# RW-05: mergeField vs setField
sed -n '865,880p;915,947p' artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts
grep -rn '\.mergeField("findings"' artifacts/diagnostic-erp/src --include=*.ts --include=*.tsx

# RW-06 / RW-07: the two reset paths (audit-pass vintage — there are three, see C-11)
sed -n '847p' artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts
sed -n '157,190p' artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts
sed -n '262,278p;2367,2398p' artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts

# RW-10 / RW-11 / RW-12 / RW-14: reachability (run from the repository root)
grep -rn "assertGatewayPrivacy"   --include=*.ts . | grep -v node_modules | grep -v /dist/
grep -rn "logParityInDev"         --include=*.ts --include=*.tsx artifacts/diagnostic-erp/src
grep -rn "contrastDependencyWarning" --include=*.ts artifacts/diagnostic-erp/src
grep -rn "RadiologyAICopilotPanel\|RadiologySmartFindingsPanel\|viewer-panel\|evaluationRunner" \
     --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v /dist/

# RW-13: the malformed impression array at both finalize sites
sed -n '129,133p' artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts
sed -n '97,114p'  artifacts/diagnostic-erp/src/lib/reportQualityFinalize.ts
sed -n '65,72p'   artifacts/diagnostic-erp/src/lib/reportValidator.ts

# RR-36 closure
sed -n '1000,1005p;740,748p' artifacts/api-server/src/routes/aiReporting.ts
```

### Group E verification (`cd572ea1`) — the three claims §30.9 rests on

The equivalence of the extracted helper, the enumeration of the notification channel, and the
absence of any writer for the critical-communication record are all reproducible read-only. The
first is the one that matters most: it is the proof that the FULL reset path's behaviour did not
change, only its spelling.

```bash
# 1. The helper IS the base FULL path's clinical set — 65 base keys, 61 in the helper,
#    the 4 excluded being exactly the identity/context fields each caller supplies itself.
git show bc8ca8c5:artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const line=d.split("\n").find(l=>l.includes("selectStudy: (id) =>"));
  const keys=[...line.match(/set\(\{([\s\S]*?)\}\); setTimeout/)[1]
    .matchAll(/(?:^|,)\s*([A-Za-z0-9_]+):/g)].map(x=>x[1]);
  const cur=require("fs").readFileSync(
    "artifacts/diagnostic-erp/src/lib/zai-workspace/clinicalStateReset.ts","utf8");
  const names=[...cur.match(/CLINICAL_RESET_FIELDS = \[([\s\S]*?)\] as const/)[1]
    .matchAll(/"([A-Za-z0-9_]+)"/g)].map(x=>x[1]);
  console.log("base FULL keys:", keys.length, "| helper:", names.length);
  console.log("excluded:", keys.filter(k=>!names.includes(k)));
  console.log("added:   ", names.filter(n=>!keys.includes(n)));   // must be []
});'

# 2. The three reset paths, and the third one the audit missed (base vintage, store.ts:1086)
grep -n "emptyClinicalState()" artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts \
                               artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts
git show bc8ca8c5:artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts | grep -n "advanceToNextStudy: () => {"

# 3. RW-27 — three kinds declared, two producers, one consumer that renders one kind
grep -n 'kind: "interrupt" | "edge-glow" | "ledger"' artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts
grep -rn "pushNotification(" --include=*.ts --include=*.tsx artifacts/diagnostic-erp/src | grep -v "\.test\."
grep -rn "clearNotification"  --include=*.ts --include=*.tsx artifacts/diagnostic-erp/src
sed -n '6,12p;22p' artifacts/diagnostic-erp/src/components/radiology/zai-workspace/interrupt-card.tsx
grep -rn "notification" artifacts/diagnostic-erp/src/lib/zai-workspace/clinicalStateReset.ts   # absent — it survives all three resets

# 4. RW-28 — the "medico-legal record" dialog's entire submit handler, and the real checklist
sed -n '49,55p;89,92p' artifacts/diagnostic-erp/src/components/radiology/zai-workspace/interrupt-card.tsx
grep -rn "setChecklistComm" --include=*.ts --include=*.tsx artifacts/diagnostic-erp/src
grep -rn "criticalSummary" --include=*.ts artifacts/api-server/src lib/db/src lib/api-zod/src   # no output

# 5. RW-30 — one authoritative status feeding all three lock decisions
grep -n "authoritativeStatus\|studyIsSignedElsewhere\|worklistDetailQ = useQuery" \
     artifacts/diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx

# 6. RR-20 — the idempotent flag the server already sent and the client never read
grep -n "idempotent" artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts \
                     artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts

# 7. The 23 tests, and the typecheck that does not cover them
pnpm --filter @workspace/diagnostic-erp exec vitest run src/lib/clinicalStateReset.hardening.test.ts
grep -n 'test.ts' artifacts/diagnostic-erp/tsconfig.json   # "**/*.test.ts" is excluded — hence the temporary tsconfig.testcheck.json in §30.9
```

### Group F verification (`9c010fe7`) — the five claims §30.10 rests on

```bash
# 1. RW-31 — at base, Ctrl+I awaited the model with no study check. This is the
#    whole defect: getState() AFTER the await, setGhostText unconditionally.
git show bc8ca8c5:artifacts/diagnostic-erp/src/hooks/radiology-workspace/useTriggerAiImpression.ts \
  | sed -n '42,60p'
# and the guard that replaced it, with both identities captured before the await:
sed -n '43,80p' artifacts/diagnostic-erp/src/hooks/radiology-workspace/useTriggerAiImpression.ts

# 2. Why a new helper and not the existing one — Number() on a DICOM UID is NaN,
#    and NaN === NaN is false, so every result would be refused.
grep -n "Number(requestStudyId) === Number(currentStudyId)" \
     artifacts/diagnostic-erp/src/lib/radiologyWorkspaceSafety.ts

# 3. RW-32 — Guard 10 at base, inline and untested; extracted, same semantics.
git show cd572ea1:artifacts/diagnostic-erp/src/hooks/radiology-workspace/useStudyFinalize.ts \
  | sed -n '117,134p'
cat artifacts/diagnostic-erp/src/lib/aiFinalizeGate.ts

# 4. RW-33 — measured, not inferred. Delete each guard row and count the failures.
#    mm/cm row: 2 failures. laterality row: 0. spine-level row: 0.
sed -n '402,416p' artifacts/diagnostic-erp/src/lib/reportFieldMerge.ts

# 5. The 33 new tests, and the typecheck that does not cover them by default.
npx vitest run artifacts/diagnostic-erp/src/lib/reportingWorkspaceJourneys.hardening.test.ts
# tsconfig.testcheck.json must override BOTH include and exclude — the inherited
# "**/*.test.ts" exclude wins, and tsc then exits 0 having typechecked nothing.
# The same shape as C-9/C-16: a success report from a step that did not happen.
```

### §30.11 verification — the measured baseline

**This block is the one exception to "all read-only".** It creates a second working tree and
junctions `node_modules` into it. Everything it touches is outside the repository and is removed
at the end; the main tree is never checked out, stashed or reset. Read the two traps at C-18
before running it, because both produce a success report for a step that did not happen.

```bash
REPO="C:/Users/Admin/Documents/GitHub/care-on-synology1"
BASE="C:/Users/Admin/AppData/Local/Temp/care-base-bc8ca8c5"

# 1. A detached tree at the branch point. No .env exists at the repo root, so both
#    trees run without DATABASE_URL and are comparable.
cd "$REPO" && git worktree add --detach "$BASE" bc8ca8c5

# 2. Junction every node_modules back into the main tree. /c and /J must be single
#    slash under MSYS_NO_PATHCONV=1; `cmd //c` exits 0 having created nothing (C-18).
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
cd "$REPO" && for d in $(find . -maxdepth 4 -type d -name node_modules -not -path "*/node_modules/*" | sed 's|^\./||'); do
  cmd /c mklink /J "$(cygpath -w "$BASE/$d")" "$(cygpath -w "$REPO/$d")"
done
ls -ld "$BASE/node_modules"        # VERIFY BY LISTING. Never trust the loop's exit code.

# 3. Same invocation in both trees. Not `npx`: in a junctioned worktree npx resolves a
#    cached vite and dies with "Cannot find module 'vitest/config'".
cd "$BASE" && node ./node_modules/vitest/vitest.mjs run --reporter=dot > /tmp/base.log 2>&1
cd "$REPO" && node ./node_modules/vitest/vitest.mjs run --reporter=dot > /tmp/head.log 2>&1

# 4. Compare. Strip ANSI first, then normalise BOTH sides through the same function —
#    vitest appends " [ path ]" to collection failures and " > test name" to test
#    failures, and comparing lists normalised differently reports ~85 phantom
#    regressions (C-19).
norm() { sed -e 's/\x1b\[[0-9;]*m//g' "$1" | grep -E "^ *FAIL +" \
         | sed -E 's/^ *FAIL +//; s/ *\[.*$//; s/ *> .*$//' | sort -u; }
comm -13 <(norm /tmp/base.log) <(norm /tmp/head.log)   # only at head  → 1 file
comm -23 <(norm /tmp/base.log) <(norm /tmp/head.log)   # only at base  → 0 files
grep -E "^ *(Test Files|Tests) " /tmp/base.log /tmp/head.log

# 5. Cause census: every collection failure, classified.
for L in /tmp/base.log /tmp/head.log; do
  sed -e 's/\x1b\[[0-9;]*m//g' "$L" | grep -nE '^ FAIL  .* \[ .* \]$' | cut -d: -f1 \
  | while read -r n; do sed -n "$((n+1)),$((n+14))p" "$L" | grep -q "DATABASE_URL must be set" \
      && echo DB || echo OTHER; done | sort | uniq -c
done

# 6. CLEANUP, in this order. `cmd /c rmdir` removes a junction without following it;
#    an `rm -rf` or a `git worktree remove` that traverses one would delete the MAIN
#    repo's node_modules. Unlink first, verify, then remove the tree.
cd "$BASE" && for d in $(find . -maxdepth 4 -type l -name node_modules | sed 's|^\./||'); do
  cmd /c rmdir "$(cygpath -w "$BASE/$d")"
done
ls "$REPO/node_modules/.bin" | wc -l                   # 36 — main tree intact
cd "$REPO" && git worktree remove --force "$BASE" && git worktree prune

# 7. Build. The recursive build dies in diagno-booking-mobile on a missing deployment
#    domain (0 files changed there by this branch), so build the two that matter.
pnpm run check:grounding && pnpm typecheck
pnpm --filter @workspace/api-server run build
BASE_PATH=/erp/ pnpm --filter @workspace/diagnostic-erp run build
grep -oE '(src|href)="[^"]+"' artifacts/diagnostic-erp/dist/public/index.html | head -8
for s in "You moved to another study while the model was working" \
         "AI suggestions remain unreviewed" "failed a grounding check"; do
  grep -rlF "$s" artifacts/diagnostic-erp/dist/public/assets/*.js
done
```

Every grep in this audit was run from the repository root with an explicit path, after C-1. Every
command above was executed, not composed; where one produced a result that was then contradicted,
the contradiction is recorded in §28 rather than the command being quietly replaced. C-18 is the
reason the §30.11 block verifies its own filesystem mutations by listing them.

## Appendix B — highest-value files for a follow-up pass

| File | Why |
|---|---|
| `hooks/radiology-workspace/useStudyFinalize.ts` (366 L at base; 454 L at `9c010fe7`) | The whole sign-off gauntlet in one readable file. RW-01, RW-04, RW-13 all land here, and Guard 10 was extracted out of it in Group F. |
| **`lib/aiFinalizeGate.ts` (41 L, new in `9c010fe7`)** | The pending-AI finalize decision, pure and tested. Its `REVIEWABLE_AI_JOB_STATUSES` doc comment is the only place in the repo that explains *why* the gate whitelists two statuses — read it before widening or narrowing that list. RR-37's client half lives here; the server half does not exist. |
| `lib/radiologyWorkspaceSafety.ts` (56 L) | Four correlation guards, and the canonical answer to "may this async result be applied to the study now open". `shouldApplyAsyncStudyKey`'s null-request branch is deliberately more permissive than its numeric sibling's and says why; changing it disables Ctrl+I for every worklist row without a StudyInstanceUID. |
| `lib/reportFieldMerge.ts:402-416` | `CLINICAL_GUARDS` and `hasConflictingClinicalDetail`. Only the mm/cm row is proven load-bearing (RW-33); the comparison is first-match-only, and the word-subsequence check at `:456-459` is doing more of this work than the guards appear to. |
| `lib/reportingWorkspaceJourneys.hardening.test.ts` (395 L, new in `9c010fe7`) | Journeys 11, 12 and 13 of §23, and the `expectOrder` helper that makes a source contract assert sequence rather than presence. C-16 is the reason its needles name call sites and not identifiers. |
| **`lib/zai-workspace/clinicalStateReset.ts` (181 L, new in `cd572ea1`)** | **Now the single highest-leverage file for cross-patient safety.** 61 field names in one `as const` contract plus a `Pick<WorkspaceStore, …>` typed factory, spread by all three reset paths. Adding a clinical field to the store without adding it here is a compile error, not a leak. Read this before touching any reset path. |
| `lib/zai-workspace/store.ts:856` and `:915-947` | The reset and write primitives. RW-05, RW-06, RW-07 all trace to these. `:1086` at base was the third reset path (§2.2, C-11); it is now `:1135-1140` and spreads the shared helper. |
| `hooks/radiology-workspace/useDraftPersistence.ts:157-344` | The PARTIAL reset and hydration. Still the file where reset *ordering* matters — the reset effect must stay declared above the hydrate effect. |
| `components/radiology/zai-workspace/interrupt-card.tsx` (97 L) | The whole critical-finding channel: its only consumer, its only dismiss affordance, and RW-27 and RW-28 both. Small enough to read in one sitting, which is why two P1s hiding in it is worth noting. |
| `lib/observationLedger.ts:570-615` | Staleness and the finalize gate. Correctly designed; RW-08 is an addition to it, not a change. |
| `api-server/src/routes/patient-reports.ts:2008-2018, 2148-2172, 2585-2595` | The three places a signed report's integrity is decided. RR-01, RR-02, RR-20. RR-20's client half is closed; RR-01 and RR-02 are the remaining server-side P0s. |
| `lib/reportQualityFinalize.ts:85-115` | Twenty-nine lines that determine what the canonical engine is allowed to know. RW-04. |
