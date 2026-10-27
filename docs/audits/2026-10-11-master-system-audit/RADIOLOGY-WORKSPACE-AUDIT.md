# 2. Radiology Reporting Workspace Audit

Surface: `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` → one view-model hook `hooks/radiology-workspace/useWorkspaceClinicalUi.tsx` (3,498 lines) → `components/radiology/workspace/{WorkspaceShell,WorkspaceTopBar,WorklistPanel,ViewerColumn,ReportCanvas,ReportingToolsRail,WorkspaceFooter,WorkspaceOverlays}`, with `components/radiology/zai-workspace/*` as the leaf widgets.

**Evidence class.** Everything below is **code-level** unless marked *measured*. I could not run the UI, so nothing here is "observed rendering"; the ERP was returning 502 for the whole audit window (§1.2 of the architecture doc). Where a prior session has browser evidence, it is cited as such.

---

## 2.1 What the workspace actually is

A three-column reading surface: queue strip + patient context on the left, viewer in the middle, report canvas on the right, with a collapsible tools rail. The editor is **five plain `<textarea>`s** (history, technique, findings, impression, recommendation — `zai-workspace/findings-editor.tsx:397-437`); state is plain strings in Zustand (`lib/zai-workspace/store.ts:305-307`); autosave is 30 s after the last keystroke (`useDraftPersistence.ts:745-761`, disabled on mobile and when signed).

Two consequences that decide most of the usability findings:

* **There is no rich-text authoring anywhere.** A repo-wide grep for bold/underline/`contentEditable`/TipTap finds only `<strong>` in *print* markup. Emphasis is **generated at render** (`abnormalEmphasis.ts`, `impressionStyle`, `headingCase`). The radiologist cannot mark one sentence bold; the house style decides, and because that decision is made at render it does survive reload — but it is not his call per finding.
* The colour/tint the user sees on findings is a **display-only overlay `<div>`** (`findings-editor.tsx:360-396`) sitting behind the textarea, not formatting in the content.

## 2.2 Control inventory (what is wired)

| Control | file:line | what it does | state |
|---|---|---|---|
| Modality / date-preset / sort | `zai-workspace/worklist-strip.tsx:98,111,124` | persists choice → new query key; defaults `MR`, today+yesterday | **live** |
| Pending / signed / parked | `worklist-strip.tsx:79` | **counts only** | **no filter control exists** for these three states |
| Priority STAT / URGENT / ROUTINE / VIP | `worklist-strip.tsx:10-15,213` | badge render | **read-only** — no filter, no sort by priority |
| Search "patient/accession" | `WorkspaceTopBar.tsx:510-516` → `useWorkspaceClinicalUi.tsx:649,735-738` | server `search` param + optional live Orthanc C-FIND | **live, and harmful** — see PERF-1 |
| Patient jump select | `TopBar:517-538` | `openStudyGuarded(id)` | live |
| Next / Prev | `TopBar:491,494`; `ReportCanvas.tsx:2083`; keys `N`/`P`/`⌃⇧N`/`⌃⇧P` | `requestLeaveThen` (guarded leave) | live |
| **Park** | `TopBar:757` → `workflow.park(id,"")` | **`localStorage` only** (`useReportingWorkflow.ts:30,37-46`, key `radiology_parked_studies_v1`) | live but **never leaves the browser** — no server row, no reason, no leave-guard, invisible from another workstation |
| Refresh queue | `useWorkspaceCommands.ts:124` | `workflow.refreshQueue()` | **implemented, no caller** — absent from the command palette (`command-palette.tsx:44-133`) and from the shortcut map (`workspaceShortcutResolve.ts:24-40`) |
| Save / Autosave | `TopBar:647`, `ReportCanvas.tsx:2081` | one POST | live; disabled offline/locked/signed |
| Finalize | `ReportCanvas.tsx:2082-2085` | guarded finalize | live; label toggles Signed / Re-finalize |
| Verify (countersign) | `TopBar:761-774` | verify route | role-gated (`workspaceReportState.ts:360-371`) |
| **Print** | `TopBar:653-666` → `handlePrintLikeFinal` | opens a print popup | `canPrintLikeFinal = !linkedReportId` (`ReportExportPanel.tsx:39-43`) → **the button disappears once a report is signed**; needs a popup allowance |
| Preview / Word / PDF | `ReportExportPanel.tsx:311-367` | export handlers | live, inside the "Report" accordion |
| Layout modes Report/OHIF/Viewer+/Dual | `TopBar:472-490` | `setLayoutMode` | live |
| Quick Select / Quick Add / Macros / Snippets / Composer | `ReportingToolsRail.tsx:554,564,594,603,621` | insert/apply, one source at a time | live; **rail defaults to 3 % width** (`:509`) |
| Voice dictation | `TopBar:630-645` + per-field mic | `useVoiceReporting` | gated by server `voiceSession.enabled`; **the `Voice` button at `:740` renders regardless** of that gate |
| Generate Impression / Refresh-from-findings | `ReportCanvas.tsx:1836,1823` | local derivation | live, mutually exclusive |
| Undo Last Abnormal | `ReportCanvas.tsx:2079`, `Alt+U` | undo | live (**a duplicate body copy at `:1302` is dead**) |
| Demography Edit | `ReportDemographyCard.tsx:57` | `setDemographyOverrides` | live in memory, **never persisted** — absent from the save-draft body (`useDraftPersistence.ts:462-526`); lost on reload |
| Referring doctor | `ReportCanvas.tsx:787` → `ReferringDoctorQuickSelect.tsx:153` | PATCH worklist | live, server-persisted |
| **Priors and prior reports** | `ReportingToolsRail.tsx:977-1008` → `GET /api/radiology-copilot/prior-studies?limit=20` (`ComparisonPanel.tsx:69`) | fetch + toggle | **implemented and reachable — but only inside the collapsed rail's Priors tab, and only when the row has a resolved `patientId` (`:980`)** |
| Command palette / shortcut help | `TopBar:753,737` (`⌘K`, `?`) | overlay | live |

## 2.3 Shipped but unreachable (each gated by a literal expression)

| What | Gate |
|---|---|
| **Start Report** — the one-click protocol+template+normals action, and the *only* caller of `handleStartReport` | `ReportCanvas.tsx:804` `{false && !contentLocked && reportNeedsStart && …}` |
| Structured Normal/Abnormal section cards + Remove | `ReportCanvas.tsx:1431` `{false && useStructured ? (` |
| `ConnectedFindingsHighlightEditor` (abnormal-tinted body editor) | `ReportCanvas.tsx:1517` `: false && studySetup.highlightFindings ? (` |
| The primary Report-Format control | `ReportCanvas.tsx:772` `{false && <div … report-format-primary-slot` |
| **The entire MRI assistance block**: `MriBrainCanvas`, `BrainMeasuresStrip`, `FindingsAnatomyStrip`, `AbnormalPatternSuggestionStrip`, `NormalBaselineBadge`, `GhostLayer`, `ObservationLedgerPanel`, `ChocolateBoxMacros` | `ReportCanvas.tsx:1016` `{false && (` → `:1405`. The rail still *describes* them ("brain palettes render in the report body", `ReportingToolsRail.tsx:680-683`) — **they render nowhere**. `useAbnormalPatternSuggestions.ts:90-118` still recomputes matches on every keystroke for a strip with no render site |
| Inline findings tool drawers (`StructuredFormatPanel`, `PriorComparisonToolbar`, `UsgCompanionPanel`, `QuickFindingsPanel`) | `ReportCanvas.tsx:1579` `{false && (` → `:1788` — each has a live duplicate in the rail, so the *function* is reachable, the *placement* is not |
| `PrintImagePicker` under the viewer | `ViewerColumn.tsx:627` `{false && …}` (live copy at `ReportingToolsRail.tsx:969`) |
| Floating AI composer, staged-proposal bar, inline AI-finalize gate | `WorkspaceOverlays.tsx:482` `{false && (` → `:592` |
| Props that manufacture false reassurance | `ReportCanvas.tsx:877-878` passes `priorCount={0} pendingMeasurements={0}` → `MriReadinessStrip.tsx:47-56` **always prints "clear"**; `:2044 disabled={false}`; `ReportingToolsRail.tsx:1094-1095 minimized={false} onMinimizedChange={() => undefined}`; `:984 comparisonMissing={false}` |
| Ctrl+1…6 "select template" | `useWorkspaceCommands.ts:134` — all six open the same tab, which renders prose inside a `<details>` (`ReportingToolsRail.tsx:1054-1063`) |
| Radiology **amend** | server route exists (`routes/patient-reports.ts:1555`) with a **no frontend caller**; a test deliberately asserts the refusal message must *not* promise "Amend" (`lib/signedReportCorrectionTruth.test.ts:211,226`). The reachable correction path is withdraw-and-re-sign (`lib/reportSignatureWithdrawal.ts`) |

This is not a dead-code problem — it is a **status-of-truth** problem: several of these are exactly the capabilities the reporting brief asks for (one-click start, structured sections, anatomy assistance), and the UI text still claims they exist.

## 2.4 Patient/exam context — is it enough to report safely?

Present in the context panel: name, age, sex, clinical history, examination name, modality, referring doctor, study date, and the identity strip. Missing or hidden:

* **Accession number and StudyInstanceUID appear nowhere near the editor.** `ReportDemographyCard.tsx:15-24` does not include them; the accession surfaces only inside a `<select>` option string (`TopBar:535`) and in a collapsed legacy "More" box. For a radiologist who must reconcile a study against a requisition slip or a phone call, the two identifiers that matter are the two he cannot see.
* **Prior studies / prior reports** are implemented (good) but two clicks deep inside a collapsed rail and only when `patientId` resolved — which, per §2.6, is exactly the rows that often have none.
* **No prior dose / contrast / radiation-exposure history** anywhere in the workspace (the concept is absent, not merely hidden).
* Region and demographic detail live in a **"Study details" strip that defaults to collapsed** (`ReportCanvas.tsx:730`; `useReportSectionChrome.ts:56`) and, on a laptop, the accordion is exclusive — **activating findings auto-collapses the identity strip** (`:99-102`). Identity is hidden precisely while he is typing about that patient.

## 2.5 Clinical safety — present vs absent

| Present (code-level) | Absent |
|---|---|
| Cross-patient draft hydration refused, fields blanked (`useDraftPersistence.ts:245-258`) | **No two-identifier verification before signing.** The finalize dialog shows `patientName — studyDescription` only (`useStudyFinalize.ts:294`) |
| Finalize re-asserts study identity after all awaits (`:336-345`) | No amendment workflow reachable from the UI |
| Study lock: claim + ~100 s heartbeat + `locked-by-other` banner + conditional force-release (`TopBar:795-811`, `useStudyLock.ts:49,112,174`) | Park is browser-local: another workstation cannot see it, and no reason is captured |
| `contentLocked`/`signedContentLocked` disable every insert, mic and tile; save refuses with a named remedy (`useDraftPersistence.ts:437-448`) | Wrong-patient check compares the queue row against the queue row and raises an **auto-dismissing toast** (`useWorkspaceClinicalUi.tsx:971-986`) — advisory, not blocking |
| Cross-study / cross-signature **undo refused** with an explanation (`useWorkspaceCommands.ts:247-286`) | Critical-result comms (Mark Critical, SLA clock, interrupt card) are flag-off by default and, worse, the detected hits are **withheld from the sign gate** when the flag is off (`useStudyFinalize.ts:252-255`) |
| PCPNDT Form F hard gate (`:172-175`); unreviewed-AI finalize gate (`WorkspaceOverlays.tsx:593`); quality gate + critical acknowledgement inside the sign dialog | No offline queue; refresh recovery relies on `beforeunload` (`useDraftPersistence.ts:222-227`) plus a 30-snapshot local backup (`:809`, restore banner `Overlays:758-791`) |
| Honest finalize wording: idempotent / "no report created" surfaced destructively (`:428-460`) | No indication on screen that demography edits do not persist |

## 2.6 Identity and billing gaps that surface in this workspace

* **Nothing in the reading queue is gated on registration or payment.** The studio LIST (`internal-reporting-studio.ts:300-356`) filters by status/date/cursor only — the join to `radiology_studies`/`tests`/`patients`/`bills` is a `leftJoin` and unmatched rows are still emitted (`emptyResolution()` at `studioWorklistBillJoin.ts:264`).
* **The worklist also injects rows that exist only in Orthanc**: `routes/radiology.ts:747-769` pushes ephemeral `ORTHANC_ONLY` records with `patientId: null, studyId: null`, `sourcePacs: "ORTHANC_LIVE"`. Verified by reading the code. So a study with no registration and no bill is reportable. Whether that is acceptable is the operator's clinical decision; it should be an explicit one.
* **Two matchers, neither authoritative.** Matcher A (`lib/pacs/worklistBillingLink.ts:212`) persists `study_id` and runs **only for ultrasound** at intake (`internal-radiology.ts:990`) plus from the UI/finalize. Matcher B (`lib/reportingStudioBilling.ts` / `studioWorklistBillJoin.ts:344-577`) is read-only and is what the queue actually calls. For CT/MR/X-ray rows without an accession, the only remaining lane is a **name + date + modality fuzzy hit** (`:503-576`). The code itself quantifies the consequence: *"measured 666 of 668 US worklist rows arriving with `study_id` NULL"* (`internal-radiology.ts:977`).

## 2.7 Performance — request counts read out of the code

| Action | Requests | Notes |
|---|---|---|
| Cold open of `/radiology/reporting-workspace/:id` | **≥ 19** | 11 session-scoped config calls (preferences, voice config, AI settings, doctors, quick-select, structured templates, pacs settings, warm-cache status…) + 7 study-scoped + `hydrateContentLibraries()` which is **two sequential awaits** (`store.ts:3314-3321`) |
| Switch study | **7–8** | release+claim lock (2 POSTs), worklist row, `workspace-entry`, drafts, patient, key-images, image-refs. Queue query is correctly **not** refetched |
| Save draft | 1 POST | `radiologyReportLifecycle.ts:367`. **"Save & leave" = 2 sequential POSTs** (`useDraftPersistence.ts:647-648`) |
| Finalize | **8–9, all sequential before the dialog** | save → `validate-draft` → `report-quality/evaluate` (+ up to 2 GETs) → `/api/signatures` (uncached per finalize) → dialog → finalize POST → 4 cache invalidations. `validate-draft`, `evaluate` and `signatures` are independent once the draft id exists — a `Promise.all` removes two round-trips from the last action of every study |

**PERF-1 (worst).** The search box writes `patientJumpFilter` as raw `useState` (`:649`), it is bound straight to the input (`TopBar:512`), it is part of the queue query key **and** it gates a live Orthanc C-FIND (`readingQueueShouldSearchOrthanc`, `:735-739`). Every keystroke therefore issues a fresh DB query of up to **1,000 rows over an 8-table leftJoin** (`radiology.ts:674`: `.limit(dateFrom||dateTo||search ? 1000 : 500)`) **plus an archive query** — and the visible list is not filtered by it, only the adjacent `<select>`. The radiologist gets the lag without the benefit.
**PERF-2.** Persistent 30 s polling while reading: worklist `refetchInterval: 30_000` (`useReportingWorkflow.ts:138`), warm-cache status 30 s, PCPNDT compliance 30 s, lock heartbeat ~100 s, session tick 5 min.
**PERF-3.** `drafts?studyId=` returns 50 rows and the client keeps `[0]` (`useRadiologyDraftId.ts:33`).
**No timings exist anywhere in the repo.** The only numbers are in `RADIOLOGY_WORKSTATION_UX_REVIEW.md:19-25` (25–40 clicks, 18–20 min per study) and that file labels them *estimated* and marks itself superseded. **Any performance claim in this audit is therefore structural, not measured** — measuring needs the ERP up.

## 2.8 Usability, ranked by time saved × clinical importance

1. **Fix the search box** (PERF-1): debounce or make it explicit, and let it actually filter the queue. Highest cost per study, near-zero risk.
2. **Show accession + StudyUID in the identity card**, uncollapsed. Safety, not style.
3. **Promote Priors out of the collapsed rail** — prior-report comparison is the single largest per-report time saving available and it is currently two clicks deep, conditional on a resolved patient.
4. **Make Stop/Start Report decide**: either re-enable the one-click Start (`ReportCanvas.tsx:804`) or delete it and its description; today the rail promises assistance the body never shows.
5. **Persist the Report-Format choice** (three copies exist: starting canvas, a dead slot, and a `<details>` in Templates).
6. **Keep Print available after signing** (`!linkedReportId`) and stop requiring a popup.
7. **Replace the "corrections need an administrator" badge** (`WorkspaceOverlays.tsx:726`) with the route that actually works (Report Hub → withdraw), or the radiologist is told a dead end.
8. **Cut the modal chain** on the common path: dirty-leave 3-choice, overwrite-confirm, merge-preview, impression-replace, verify, Form F, sign dialog — seven stops, plus a silent double-save on "Save & leave".
9. **Remove duplicated actions** (Undo ×2, Quick Select ×3 surfaces, `PrintImagePicker` ×2).
10. **Fix misleading status wording**: "Zero-Click Read Loop" with no click count, `MriReadinessStrip` hard-coded to "clear", a "PARKED" badge with no unpark control in the queue.
11. **Stop re-typing demographics**: the Edit path re-enters all 8 fields per study and discards them (§2.2).

No UI redesign is warranted. The shell is coherent; the problem is 8 gated regions, one identity strip that hides, one search box that misfires, and three places where the same control exists twice.
