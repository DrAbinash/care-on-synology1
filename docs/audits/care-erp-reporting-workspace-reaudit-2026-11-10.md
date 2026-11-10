# CARE ERP — Reporting Workspace Re-Audit: Demography → Composer → Print

**Repository:** `DrAbinash/care-on-synology1`
**Audited tree:** `origin/main` at `7af936b6` (clean working tree; includes merged PR #1316 `2009ee69` and PR #1317).
**Audit performed:** 2026-11-10.
**Mode:** READ-ONLY audit. Two deep passes (demography→composer chain; export→preview→print chain) over ~40 files, followed by lead-reviewer spot-verification of every headline finding against source before publication.
**Prior work assumed merged and excluded from findings:** P1-1 (demography card honesty, UHID not numeric PK), P1-2 (edit-before-apply reaches server), P2-4 (VOI vocabulary thread FE+BE), P2-5/P1-1 (STUDY|DOB letterpad identity row, FE letterpad + PDF + BE parity), P2-9 (Word export: signature images, 480px captions, draft watermark), frozen-key-image freeze-path hardening.
**Deliverable:** this document plus the fix batches it tracks. Each batch lands as one commit under `fix/reaudit-demography-to-print`; this doc's §5 maps batch → finding IDs.

**Remediation status (2026-11-10): COMPLETE — all 15 batches merged to `main`.** Batches 1–8 (A-1…A-11, X-1…X-4, E-1, E-4…E-7, E-9, E-14) landed as `2e445df4`…`22bf43ff`; batches 9–12 (A-12, E-2, X-5…X-9, E-3, E-11, E-13, E-16) as `25ed17fd`…`1919df64` (+ two export-pin test follow-ups `adda1313`, `5a37b268`); batch 13 (E-10, E-15) as `650b8d42`; batch 14 (E-8) as `41b51a10`; batch 15 (E-12, A-13) as `e8c3825d`. Every batch shipped with regression tests; both packages typecheck clean (tsc 0 errors) and all affected suites green before each merge; CI validates the full suite per push to `main`.

---

## 1. Flow map

### 1.1 Demography → composer

`pages/RadiologyReportingWorkspace.tsx` composes `hooks/radiology-workspace/useWorkspaceClinicalUi.tsx` (the 4,364-line view-model). Demography is assembled in the `canonicalDemography` memo (:3115–3190): patient master + worklist detail + queue row + `dicomMetadata`, folded by `lib/reportDemography.ts#mergeReportDemography` with study-stamped radiologist overrides (`demographyOverridesRaw` :742–755, route-keyed reset :1314, persisted in the draft envelope `careDemographyOverrides`). The card is `components/radiology/ReportDemographyCard.tsx` (mounted by `workspace/ReportCanvas.tsx:870`), echoed read-only in `ComposerIdentityStrip`; outputs render via `buildDemographyHeaderHtml` / `buildLetterpadDemographyHtml` (`reportDemography.ts`), `reportPdfGenerator.ts` (client PDF) and the BE mirror `api-server/src/lib/reportPresentation.ts`. Key images flow from the viewer (EmbeddedWadoViewer frames or the OHIF postMessage bridge `useOhifViewerBridge.ts` with `keyImageCaption.ts`) through `uploadFrozenKeyImage` into the frozen rail (`FrozenKeyImagesRail.tsx` + `frozenKeyImageRailState.ts` + guarded-URL grants in `keyImageAccess.ts`), while picked DICOM images live as image-reference rows (`ReportImagePanel.tsx`, framing+VOI in one `presentationJson` slot, `lib/imageFraming.ts`). Composition: `reporting-canvas/FindingComposer.tsx` + `findingComposerModel.ts` commit structured findings into the canonical observation ledger; `reportComposer/composeObservations.ts` projects that ledger into `ComposerInputSnapshot`s hashed by `reportComposer/types.ts`, enqueued/polled/applied by `hooks/useReportComposer.ts` via `reportComposer/api.ts`; `findingsCompose.ts`, `usgReportComposer.ts`, `multiStudyReport.ts` are separate composition engines; `reportFieldMerge.ts` is the shared insert-merge; `storedReportBody.ts` re-parses stored `patient_reports.body` HTML.

### 1.2 Export → preview → print

Four doors, wired in `hooks/radiology-workspace/useWorkspaceExportShare.ts`, surfaced in `components/radiology/ReportExportPanel.tsx`: **Word** (server letterpad HTML from `/api/radiology/report-generator/drafts/:id/print-preview` or `/api/patient-reports/:id/print?preview=true`, BE `reportPresentation.renderReportDocument`), live-merged via `finalizePrintPreviewHtml` (`radiologyReportPrintLiveMerge.ts`), key images hydrated by `radiologyReportPdfExport.ts`, converted to .docx by `radiologyReportWordExport.exportRadiologyReportToWord`, with client `radiologyReportPreviewHtml.buildPreviewHtml` as fallback; **PDF** (signed → frozen server artifact `/api/patient-reports/:id/pdf`; unsigned → client jsPDF `reportPdfGenerator.generateReportPDF` with DRAFT watermark from `draftAwarePrintSettings`); **Print like final / Print signed** (popup; signed → frozen print HTML; unsigned → print-preview + live merge + autoPrint script), gated by save-before-print; **on-screen preview** (iframe fed by the panel's react-query, same print-preview URL with `likeFinal=true`). Typography rides `reportPrintFormat.ts` query params; film printing via `PrintImagePicker.tsx` (POST `/api/radiology/print-images` + job polling); bridge health via `printBridgeHealth.ts`.

---

## 2. Bugs (all spot-verified against source)

Severity: P2 = user-visible correctness/data-integrity defect on a working path; P3 = edge-case or silent-failure defect.

| ID | Sev | Location | Defect | Symptom |
|---|---|---|---|---|
| A-1 | P2 | `hooks/useReportComposer.ts:279–299` | The reopen effect keyed on `opts.worklistId` never clears `job`/`reviewOpen`; no `setJob(null)` anywhere in the file | After switching from study A (READY/QUEUED AI draft) to study B, B's AI tab shows A's proposed findings with Accept/Reject/Apply; the freshness hash only catches differing text — identical normals can Apply A's text into B's draft |
| A-2 | P2 | `lib/reportDemography.ts:561,566` (letterpad), `lib/radiologyReportWordExport.ts:727,806` (Word) | DOB printed raw, while client PDF formats it (`reportPdfGenerator.ts:1135`) and the server letterpad formats it (`reportPresentation.ts:458`); `mergeReportDemography` formats only `studyDate` (:391), never `dateOfBirth` | `DOB: 1990-05-12` (or DICOM `19900512`) on preview/Word vs `DOB: 12/05/1990` on PDF — in the same STUDY|DOB identity row |
| A-3 | P2 | `lib/usgReportComposer.ts:115–119` | `removeFinding` rebuilds organ text from findings alone; user-typed prose in `section.text` (directly editable, `OrganReportSection.tsx:77`) is never read | Deleting any structured finding on an organ silently deletes the radiologist's typed prose on that organ |
| X-1 | P2 | `components/radiology/ReportExportPanel.tsx:400–410` | Preview demography debounce key omits `studyDescription`/`dateOfBirth` (passed at `ReportLivePreviewColumn.tsx:286–287`) | Correcting STUDY or DOB changes nothing on the preview until an unrelated edit; radiologist finalizes against a stale identity row |
| X-2 | P2 | `hooks/radiology-workspace/useWorkspaceExportShare.ts:776–785` | Print door's letterpad patch passes 8 demography fields, omitting `studyDescription`/`dateOfBirth` (Word door passes them at :451–454); demography edits don't set the clinical dirty flag, so the conditional save at :726 doesn't run | A draft whose only recent edit was the STUDY/DOB correction prints the stale row on paper |
| X-3 | P2 | `useWorkspaceExportShare.ts:394–460` | In `handleExportWord` the signer-of-record read runs only after a successful server fetch; the blanket `catch` (:458–460) falls back to client HTML with `authorized = false` | A SIGNED report whose server render fails transiently exports as unsigned-looking Word (no signer/registration) that can disagree with its own PDF — the "one report, two printed forms" defect in the error path |
| X-4 | P2/P3 | `lib/radiologyReportPreviewHtml.ts:269–413` | The client fallback HTML carries no `draft-watermark` markup (the Word parser needs it, `radiologyReportWordExport.ts:316–319`; server draws it only in the server render) | Whenever X-3's fallback fires for an unsigned draft, the .docx has no DRAFT mark while the same draft's PDF always carries one |
| A-4 | P3 | `ReportDemographyCard.tsx:51` vs `reportDemography.ts:386` | Card sends blank patches; merge drops blanks (pinned by `demographyOverrideStudyIsolation.hardening.test.ts:267–275`); UI never says so | Clearing a wrong value and applying is a silent no-op — the old value reappears |
| A-5 | P3 | `reportDemography.ts:384–387` | Override loop stores values verbatim; only source ages go through `firstNonEmptyAge` (:351) | Typed `45` prints `AGE/SEX: 45 / M` while every merged age prints `45 Yrs` |
| A-6 | P3 | `reportDemography.ts:206` | `formatReferringDoctorDisplay`: both branches of the ternary are identical, so every referrer is force-prefixed "Dr." | Non-physician referrer ("City Clinic") prints as "Dr. City Clinic" on card, letterpad and headers |
| A-7 | P3 | `findingComposerModel.ts:208/227/245` + `levelOptionsForEntry:329–337` | Builtin spine entries hardcode `LUMBAR_CANAL_LEVELS`; `levelOptionsForEntry` falls back to the entry's own options when the region intersection is empty | On a cervical/dorsal study with a sparse catalog, "Disc bulge" offers L1-L2…L5-S1; a committed phrase can read "disc bulge at L4-L5" on a cervical report |
| A-8 | P3 | `reporting-canvas/FindingComposer.tsx:74` | `onFindingChange` keeps `draft.level` when it isn't in the new entry's list (levels computed for the previous entry) | The level box looks empty but "Add Finding" commits the stale level |
| A-9 | P3 | `findingComposerModel.ts:391` | `new RegExp(draft.severity, "i")` built from admin-catalog-controlled severity options; regex metacharacters throw during render | A severity option containing `(`, `+`, `*`… crashes the composer render |
| A-10 | P3 | `FrozenKeyImagesRail.tsx:181–188` (:428–431) | The filtered (per-observation) item count feeds `frozenKeyImageRailState`, so a filtered-empty rail reaches `kind: "empty"` | With the observation filter active the strip claims "No frozen captures yet" about a study that has captures — the exact anti-lie property `frozenKeyImageRailState` exists to enforce |
| A-11 | P3 | `useOhifViewerBridge.ts:698` | `await uploadFrozenKeyImage(fd)` has no try/catch; the bridge swallows the rejection (`ohifViewerBridge.ts:461–464`) | Annotated capture looks successful in the viewer, never lands in the rail, nothing says why (the sibling `onKeyImageDropped` path :587–597 does explain failures) |
| A-12 | P3 | `ImageFramingEditor.tsx:86–104` | `suggestFromImage` sets `crossOrigin="anonymous"`, calls `getImageData` with no `onerror`/try-catch | "Auto" fails silently on CORS-tainted/DICOMweb images |
| A-13 | P3 | `lib/radiologyReportAssembler.ts` (+ `ReportCanvas.tsx:883` dead `{false && …}` slot) | Dead module with latent defects (dead `impressions` block :133–143; label-string critical matching :444); no importer in the app (verified by grep) | Latent-defect trap for future reuse |
| X-5 | P3 | `reportPdfGenerator.ts:1134–1149` | PDF letterpad prints STUDY/DOB values mixed-case; server letterpad uppercases the whole table (`reportPresentation.ts:1240`) and Word uppercases cell values (`radiologyReportWordExport.ts:741`) | The identity row reads differently on the downloaded PDF vs the printed page/Word copy |
| X-6 | P3 | `reportPdfGenerator.ts:1321–1337`, `drawFindingsTable` :532–542 | `autoTable` breaks pages internally without re-drawing the letterpad chrome (only `ensureSpace`'s own breaks call `drawLetterPadChrome()` :1276–1284) | A long MEASUREMENTS/findings table that crosses a page yields continuation pages with the services bar but no logo/address letterpad |
| X-7 | P3 | `reportPdfGenerator.ts:1213` vs `:1428` | `SIG_RESERVE_MM = settings.signature.enabled ? 12 : 0` but the block prints under `ofRecord \|\| report.unsigned \|\| settings.signature.enabled`; image drawn 36×14 mm, only 12 mm reserved/advanced (:1482–1488) | With the signature switch off, an unsigned draft prints "NOT SIGNED" at a position body flow never reserved; name baseline sits ~2 mm inside the image's bottom edge |
| X-8 | P3 | `reportPdfGenerator.ts:150–152` | `loadPrintSettings`' JSON-failure branch returns the shared module-level `DEFAULT_PRINT_SETTINGS` object (the `!raw` branch :132 returns a clone) | A caller mutating the returned settings corrupts the defaults for the session |
| X-9 | P3 | `ReportExportPanel.tsx:443` | `authorizedArtifact: Boolean(linkedReportId)` conflates "has a report row" with "is signed" | Finalized-but-unsigned rows refuse the live merge in preview while the print door live-merges the same rows — preview ≠ what Print produces |

## 3. Enhancements (prioritized)

| ID | Location | Improvement | Benefit |
|---|---|---|---|
| E-1 | `ReportDemographyCard.tsx:69–79` | Show DOB (and modality) in the read view | Identity verification at the surface where corrections are made |
| E-2 | `ImageFramingEditor.tsx` / `imageFraming.ts` | VOI window/level editor + CT presets writing through `serializeImagePresentation` (P2-4 groundwork; server PATCH already preserves VOI) | Re-window a wrongly windowed key image without re-picking from PACS |
| E-3 | `FrozenKeyImagesRail.tsx:280–288` | Drag-to-reorder (port `ReportImagePanel.tsx:99–127` atomic pattern) | Faster ordering of 6+ images; parity between the two image lists |
| E-4 | `ReportDemographyCard.tsx:81–100` | `<form>` semantics: Enter applies, Esc cancels | Fewer mouse round-trips |
| E-5 | `useReportComposer.ts` / rail render | Stamp a READY draft with its study; render "AI draft for another study — switch to review" when mismatched | Wrong-patient guardrail that survives future refactors of the reset effect |
| E-6 | `ReportDemographyCard.tsx` | "Corrected" pencil/dot on overridden demography rows (overrides outrank the patient master and persist invisibly) | Tells the radiologist which identity values are report-local corrections |
| E-7 | `useOhifViewerBridge.ts:698–700` | Auto-select a fresh capture for AI when `aiMode === "SELECTED_IMAGES"` (or one-click "Select for AI" toast) | Removes a manual click per image in the vision-draft flow |
| E-8 | `lib/examDemographyFit.ts` (billing-desk only today) | Reuse the pure check as a workspace advisory when a sex/age override contradicts a sex-specific study | Catches "USG Pelvis (Female) on a male" at the reporting desk, not just the cashier's |
| E-9 | `useWorkspaceExportShare.ts` | One authorization reader (`readExportAuthorization()`) for all four doors | Closes the X-3/X-9 drift class permanently |
| E-10 | `useWorkspaceExportShare.ts:787–790` | Reprint with audit: `afterprint` → POST print event; panel shows "reprinted ×N" | Traceable paper copies, currently invisible |
| E-11 | `radiologyReportWordExport.ts:906–940` | Word footer page numbers (docx `PageNumber` runs) | Multi-page Word copies paginate like the PDF |
| E-12 | BE `/api/patient-reports/:id/pdf` | `?archive=1` PDF/A variant (Ghostscript when available, 501 with a clear message otherwise) | Long-term legal retention of the frozen artifact |
| E-13 | `ReportExportPanel.tsx:499–522` | Remember last export format (Word vs PDF) and make it the primary button | One click less per report |
| E-14 | `radiologyReportPreviewHtml.ts` | `unsignedDraft` flag → same `draft-watermark` markup the server uses (pairs with X-4) | The preview pane warns like the PDF does |
| E-15 | `PrintImagePicker.tsx:153–164, :185` | Keep the selection until terminal state; "Retry status" action on the 60 s dead end | The give-up toast is no longer a dead end |
| E-16 | `radiologyReportWordExport.ts:698` | Name unreadable images (attachment id/SOP) like the PDF's integrity line (`reportPdfGenerator.ts:1233–1252`) | A failed attachment is identifiable on every surface |

## 4. Areas checked and found clean

Demography merge & study isolation (precedence, UHID numeric-PK suppression :368, P3-4 study-stamp guard :742–755, route-keyed reset :1314 — pinned by `demographyOverrideStudyIsolation.hardening.test.ts`); `examDemographyFit.ts` rule catalog; `imageFraming.ts` clamps and VOI parse/serialize acceptance (P2-4, server PATCH VOI preservation verified at `radiology-report-generator.ts:3917–3934`); `keyImageAccess.ts` batch window/expiry/invalidation (no cross-study leakage — cache keyed by globally-unique row ids); `frozenKeyImageRailState.ts` anti-lie ordering; rail mutations (toasts, atomic reorder, delete prunes AI selection, guarded vs finalized); `reportComposer/` lib (types/hashing, `composeObservations` filtering, `composerInputPreview`, `refineTarget`, `jobStatusNotice`, `api.ts`); `findingsCompose.ts`, `multiStudyReport.ts`, `reportFieldMerge.ts` (conservative merge + provenance), `storedReportBody.ts`, `workspaceReportState.ts`; `useFindingComposerDraft` resets/prunes; `ComposerIdentityStrip` and accordion summaries (no-numeric-PK patientCode rule); draft-envelope round-trip for demography overrides.

Export side: date parity FE↔BE (`readStudyDate`/`formatReportDateShort` identical, cross-tested); key-image identity & ordering (SOP+frame dedupe mirrors server; frozen-first ordering consistent across PDF, print hydrate and Word; unreadable cells become named placeholders); draft marking on working paths (PDF watermark via `draftAwarePrintSettings`, server DRAFT stamp + `NOT SIGNED` slot, no signer name for drafts); signed-artifact routing (PDF door `SignedReportArtifactRequired`, print door `signedReportPrintUrl`, `readFailed` aborts all doors, `finalizePrintPreviewHtml` returns authorized artifacts byte-for-byte); print flow mechanics (popup closed on every abort path, failed save aborts, duplicate-draft insert fixed, `autoPrint` script, print CSS `@page`/`break-inside`/orphans/widows/fixed watermarks); stale-data guards (click-time reads, identity-keyed debounce, study-stamped overrides); double-print guards; jsPDF signature image format (re-sniffed by jspdf 4.2.1, JPEG-safe); `techniqueSectionText` consistency; critical-result print nudge; `reportPrintFormat` clamping; `printBridgeHealth` mapping. No TODO/FIXME markers in any audited file; `printExportBacklog` contract's pinned behaviors all present.

## 5. Execution plan (batches → findings)

| Batch | Findings |
|---|---|
| 1 | A-1 + E-5 (AI composer job reset + study stamp) |
| 2 | A-2 (DOB display formatting at merge) |
| 3 | X-1 + X-2 (preview key + print patch STUDY/DOB) |
| 4 | X-3 + X-4/E-14 + E-9 (signer-first, one auth reader, fallback watermark) |
| 5 | A-3 (USG prose preservation) |
| 6 | A-4, A-5, A-6 + E-1, E-4, E-6 (demography card batch) |
| 7 | A-7, A-8, A-9 (composer level/severity fixes) |
| 8 | A-10, A-11 + E-7 (rail honesty, upload toast, auto-select) |
| 9 | A-12 + E-2 (framing Auto CORS + VOI re-windowing) |
| 10 | X-5, X-6, X-7, X-8 (PDF generator batch) |
| 11 | X-9 + E-13, E-16, E-11 (panel/Word batch) |
| 12 | E-3 (drag-to-reorder frozen rail) |
| 13 | E-10 + E-15 (reprint audit, picker retry) |
| 14 | E-8 (examDemographyFit advisory) |
| 15 | E-12 + A-13 (PDF/A variant, dead-code delete) |

Each batch: fix + regression tests + targeted vitest + package typecheck + commit + push. CI validates the full suite per push; the final report checks `main`/PR CI green.
