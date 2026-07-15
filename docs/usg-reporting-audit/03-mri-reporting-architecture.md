# 03 — MRI/CT Reporting Workspace: Architecture Deep-Dive

*Audit-only document. As-of commit: `15ed9dfc` (origin/feature/website-login-redirection). All facts verified by direct reading of source files; file:line citations given for load-bearing claims. Note: initial research for this document was performed against a slightly older checkout that was missing the most recent PR #79/#80 work (Command Palette, CARE Copilot); this has been corrected below and cross-verified against the true latest commit before publishing.*

---

## 1. Component Hierarchy

The canonical reporting page is `RadiologyReportingWorkspace` (default export), `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx`, a single ~5,250-line component taking an optional `studyId: number` prop. `App.tsx` documents it explicitly as canonical: *"RadiologyReportingWorkspace is THE canonical radiology reporting page."* A sibling page, `RadiologyCommandCenter.tsx`, is explicitly **legacy/preserved** — it imports `DeprecatedSurfaceBanner` and is routed only under `/radiology/command-center`, wrapped in `<OwnerOnlyPreserved>`. `RadiologyReportEditor.tsx` is now a small pure redirect stub into the canonical workspace.

**Major imported child components**, each verified against its render site:
- `OpenStudyPanel` — left column; the single DICOM-viewer-launch control (network/viewer selection, diagnostics).
- `EmbeddedWadoViewer` — the in-page DICOM image viewer (ref used by voice "next/prev image/zoom" commands).
- `ReportImagePicker` — DICOM key-image/thumbnail selection.
- `QuickFindingsPanel` — right panel's "Quick" tab; the primary finding-selection UI.
- `StructuredFindingDialog` — the "ask only what's needed" modal (see §6).
- `FindingsHighlightEditor` — the free-text findings editor with macro highlighting.
- `RadiologyCopilotPanel` (Phase-8 "Radiology Copilot" — prior-study fetch, consistency checker, follow-up suggestions) — rendered twice (Prior tab; AI tab in prior-comparison mode).
- `RadiologyMemoryPanel` (Phase-9 "Radiology Memory + Context Engine" — learns a radiologist's phrasing/measurement preferences, feature-flag-gated, all flags off by default).
- `MeasurementAssistantPanel`, `ViewerMeasurementsPanel` (OHIF/Weasis/DICOM-SR measurement import queue, self-hides when empty), `UsgMeasurementReviewPanel` (USG-only, gated on `isUltrasound`), `ObDashboardStrip`, `FollowUpPanel`, `CollapsibleSection`, `PreferencesPanel`, `VoiceCommandBar` (conditional on `voiceSettings.enabled`).
- `CommandPalette` — the universal Ctrl+K palette (see §8; **confirmed live and imported** as of this commit).
- `CareCopilotPanel` — the newest addition (see §16), an always-on advisory tab.

**Layout**: outer `flex flex-col` wrapper, a compact header (patient banner, status badge, dirty indicator, Structured/free-text switch), a workflow status bar (queue position, lock status, scope selector), an optional `VoiceCommandBar`, then a **3-column body**:
- **Left ≈35%** (`280–460px` clamp, collapsible to a 44px icon strip via `isLeftPanelCollapsed`, persisted to `localStorage`): study-info card, `OpenStudyPanel`, `EmbeddedWadoViewer`, `ReportImagePicker`.
- **Center flex-1** (`min-w-0`): scrollable editor — clinical history, technique, findings (structured map or free text), impression list, recommendation, quality/validation banners, preview pane, sticky bottom action bar (Save/Preview/Print/AI-Review/Finalize/Send).
- **Right ≈20%** (`200–280px`): a multi-tab strip — Quick, Templates, Follow-up, Prior, AI, Measure, Teaching, CARE Copilot — driving `rightTab` state.

An in-code comment documents a mobile-width invariant deliberately: left+right never exceed 100% of viewport width so the center editor column always keeps real width (fixing a prior "cut view" bug) — worth preserving verbatim in a USG layout.

---

## 2. Data Flow

Sequence when a radiologist opens a study (`studyId` arrives as a route param, see §14):

1. **Worklist entry** — `useQuery(["workspace-entry", studyId], ...)` fires `GET /api/internal/radiology/worklist/${studyId}`. This is the DICOM/worklist source of truth: patient demographics, modality, `studyInstanceUID`, `aiDraftJson`, `status`, lock/assignment fields.
2. **Draft identity** — `useRadiologyDraftId(studyId)` fires `GET /api/radiology/report-generator/drafts?studyId=${studyId}` and adopts the newest draft (`ORDER BY updated_at DESC LIMIT 50`) as `existingDraft`/`draftId`, once per study.
3. **Draft hydration** — once both `entry` and `existingDraft` are loaded, an effect cross-checks `existingDraft.patientId === entry.patientId` (refuses a mislinked draft), then writes `clinicalHistory`, `rawFindings`/`findingsSections`, `impression`, `recommendation` into local state and marks the load as not-dirty.
4. **Structured findings / Quick-Select restore** — `GET /api/radiology/report-generator/finding-instances?draftId=...` (the `report_finding_instances` table, primary source); falls back to the draft document's embedded quick-select snapshot if empty.
5. **Templates** — `structured-templates` and `radiology-master-templates-v2` load in parallel; an auto-select effect picks a matching template once per study and fill-empty-only applies it (manual picks are never overwritten).
6. **AI draft prefill** — parses `entry.aiDraftJson` and fill-empty-only populates fields; deliberately loses a race to draft hydration (the saved draft always wins).
7. **Status derivation** — `reportStatus` comes from `entry.status` (`REPORT_FINAL` → `FINAL`, else `DRAFT`); mapped to lock state.

Data flows **DICOM/worklist → draft (`radiology_report_drafts`) → structured findings (`findingsMap` / `report_finding_instances`) → final report (`patient_reports`) → print/delivery**: a client-side `buildPreviewHtml()` assembles findings/impression/etc. into printable HTML for the live preview; on **save**, those fields plus derived Quick-Select findings go to `radiology_report_drafts`; on **finalize**, the same HTML becomes `htmlBody` sent to `finalizeRadiologyReport()`, which creates the `patient_reports` row and flips the worklist status.

---

## 3. State Management

**React Query** (`@tanstack/react-query`) backs ~15 `useQuery` calls (`workspace-entry`, `radiology-quick-select`, `radiology-existing-draft`, `radiology-finding-instances`, `structured-templates`, `radiology-master-templates-v2`, `usg-report-templates`, `normal-snippets`, `radiology-validate-draft`, etc.) and 2 `useMutation`s (AI Impression, AI draft generation).

**Local `useState`** is extensive, organized by comment banner (layout, template selection, report content, AI, style prefs, workflow meta, queue scope, Quick-Select selection) — dozens of state variables plus refs (`insertedTextRef`, `sectionContribRef`, `structuredValuesRef`, `sessionMemoryRef`) that track exactly what text a finding inserted, so deselection can exact-remove it without disturbing manual edits.

**`useReportingWorkflow(studyId, opts)`** is the queue/navigation controller. It owns the worklist queue (`refetchInterval: 30s`, `placeholderData: prev => prev` so the strip never flickers), client-only `parked` state (`localStorage`), session-only `completedIds`, a back-navigation `historyStack`, and a `transitioning` lock. All the *rules* (queue ordering, park/unpark, a `canLeaveStudy` transition guard) live in pure, unit-tested `lib/reportingWorkflow.ts` — busy states (saving/finalizing/viewer-launching) **block** leaving the study; a dirty draft only requires **confirm**.

**Dirty tracking**: `dirty = !isLocked && isReportDirty(currentSnapshot, lastSavedSnapshot)`, both sides serialized by `serializeReportSnapshot`. `lastSavedSnapshot` updates on save/finalize, and via a "baseline recapture" nonce pattern that re-serializes state on the render *after* any machine-driven hydration (draft load, template autofill, selection restore) flushes.

**No server-side autosave exists.** Persistence is explicit only: Save button, `Ctrl+S`, voice "save", or as step 1 of finalize (if dirty). A debounced *client-only* crash-backup (`useLocalDraftBackup`) writes a `localStorage` snapshot 2 seconds after the last edit, plus a rolling once-per-minute history (30 entries) — never reaches the server, cleared on successful finalize.

---

## 4. Template Engine

There are **three overlapping, non-unified template systems**, plus a fourth that's dead code:

1. **`StructuredTemplate`** (`GET /api/radiology/structured-report-templates`, table `structured_report_templates`) — this is the one actually driving the workspace. `sectionsJson` parses into `{technique, findingsItems: [{label, normal}]}`, which seeds `findingsMap: Record<sectionLabel, {normal, text}>` — the live structured-findings state. Auto-selection matches `entry.modality` + a substring match of `entry.studyDescription` against each template's `bodyPart`; auto-applies fill only empty fields, manual picks fully overwrite.
2. **DB-backed `MasterTemplate`** (`GET /api/radiology/knowledge/master-templates`, "Phase-F winner" catalog) — a second, additive, content-only catalog: applying one directly overwrites `rawFindings`/`impression` as free text (confirm-gated), bypassing `findingsMap` entirely.
3. **USG practical templates** (`GET /api/usg-reports/templates`, hardcoded server catalog, `usgReportTemplates.ts`) — used only in USG mode for `Ctrl+1..6` quick-select shortcuts.
4. **`lib/radiologyMasterTemplates.ts`** ("Dr. Sugandha Locked Master Template Library", 17 hardcoded templates with variants/critical-watch-lists) is **orphaned** — no component imports its exports; useful only as seed content to migrate into the live DB-backed catalogs.

Backend-side, `artifacts/api-server/src/lib/structuredReport/types.ts` defines a genuinely **modality-agnostic** canonical document (`StudyContext.modality`/`body_region`/`study_type` are free strings, no enum). This is the "D1" structured-report engine (see §11), separate from all three template systems above and not yet the thing producing everyday reports.

---

## 5. Smart Findings Engine

The live section-flip mechanism ("selecting a finding flips a template section") is `lib/smartFindings.ts` + `QuickFindingsPanel`, **not** `radiologySmartEngine.ts` (a separate, self-contained rules engine with 13 hardcoded `SmartBuilder`s including `MRI_BRAIN_BUILDER`, `USG_ABDOMEN_BUILDER` — imported only by the legacy `RadiologyCommandCenter.tsx` and by `RadiologySmartFindingsPanel.tsx`, which itself has **zero importers anywhere in the app** — dead code, notably containing already-written USG builders that could be mined as seed content but aren't live).

The real chain:
1. `QuickFindingsPanel` fires `onToggle(finding, selected)` when a Quick-Finding button (or `StructuredFindingDialog` Apply) fires.
2. `handleQuickToggle` computes conflict-group evictions via `conflictingSelections` (`lib/smartFindings.ts`, mutual exclusion within the same `studyType`+`conflictGroup`), updates selection state, and — only when structured mode is active — calls `applySmartFinding` per affected finding.
3. `applySmartFinding` resolves the finding's `anatomicalSection` (with any `{key}` templating resolved against structured answers), computes the new text (structured-values path via `generateStructuredFinding`, or `renderAbnormality` from `abnormalityEngine.ts` for ordinary property-chip findings), and calls the pure **`applySectionContribution`**: exact-removes the finding's *previous* contribution (so manual edits that no longer match exactly survive), dedupe-merges in the new text, and restores the template's baseline "normal" text if the section empties out.
4. `setFindingsMap` commits the section update, which renders in the UI.

`SmartRadiologyCards.tsx` is unrelated — 10 independent admin/operational widget cards (AI Impression, Quality Checker, TAT Dashboard, Amendment Manager, DICOM-SR Export, etc.), each a thin CRUD UI over `/api/smart-radiology/...`, live inside `PacsDashboard.tsx`/`RadiologySettingsCenter.tsx`, not the reporting canvas.

---

## 6. Structured Finding Assistant

Introduced by commit `505f33ab` ("Structured Finding Assistant — compact ask-only-what's-needed dialog"). It generalizes the earlier side/severity/level property-chip model into fully configurable, per-finding "questions."

**Data model** (`lib/structuredFindings.ts`): each `QuickFinding` carries a `questionsJson` field parsed by `parseQuestions()` into `StructuredQuestion[] = {key, label, type: "select"|"text", options[], default, required, sortOrder}`. Finding-text templates use `{key}` substitution and `[optional clause with {key}]` — a clause is dropped whole if any key inside resolves to a "nullish" value (`normal`, `none`, `nil`, `absent`, `not seen`, etc.). `fillStructuredTemplate()` resolves clauses, substitutes placeholders, then does grammar cleanup. `resolveSection()` even lets the *anatomical section itself* be templated (e.g. `"{level}"`), so one generic "Disc Bulge" finding maps to whichever spine level was answered. `initialValues()` pre-fills from session memory → question default → first option.

**`StructuredFindingDialog.tsx`** is the modal itself: one input per question (dropdown or free text), a live preview via `fillStructuredTemplate`, a `missingRequired` gate disabling Apply, Cancel/Remove/Apply buttons — no reporting logic of its own.

**`StructuredQuestionsEditor.tsx`** is the Settings-side admin editor for the same `questionsJson` (add/reorder/edit questions), with a warning UI for `{key}` placeholders referenced in text but not defined as a question, or vice versa. Introduced by commit `1b6b865c` ("configurable Structured Findings editor in Settings").

**Fit into the flow**: `QuickFindingsPanel` decides dialog-vs-immediate — a finding with `parseQuestions(f.questionsJson).length > 0` opens the dialog instead of toggling directly. On Apply, answered values are stored into `sessionMemoryRef` (remembered for next time) and `structuredValuesRef` (persisted per-finding so a reloaded draft regenerates identical text), then routed through the **same** `handleQuickToggle` path described in §5 — deliberately "no second reporting engine."

---

## 7. AI Impression / AI Copilot

**AI Impression**: `POST /api/ai-reporting/query` with a hand-built prompt ("As a radiologist, generate a numbered, clinically relevant impression from these findings..."), the current findings text, clinical history, modality, style preference, `provider: "gemini"`, `maxImages: 0` (text-only). `insertAiOutput()` confirm-gates overwriting a non-empty impression before splitting the AI text into lines.

**Backend**: checks global AI-reporting enablement and role permission, resolves a provider (explicit request → per-task model route for `"radiology_draft"` → global default), loads the provider config (encrypted API key), builds the final prompt (DB-backed prompt-template library with a legacy hardcoded fallback), optionally appends patient demographics, fetches up to `maxImages` study images via `fetchStudyImages()`, then calls **`generateAiResponse(providerName, prompt, images, {model})`** from the shared `lib/ai-providers` package — a unified abstraction over **OpenAI, Google Gemini, Anthropic Claude, and Ollama (local)**. Audit-logged to `ai_reporting_audit_logs`.

`RadiologyCopilotPanel.tsx` ("Phase 8") composes `SpineIntelligencePanel`, `BrainIntelligencePanel`, `TumorFollowupPanel`, `MultiAIReviewPanel`, `ImageAnnotationToolbar`. `RadiologyMemoryPanel.tsx` ("Phase 9") is live but every feature individually flag-gated, off by default.

---

## 8. Command Palette / Keyboard Workflow

**This section corrects an earlier draft of this document.** The commit *"Radiology: keyboard-first workflow + universal Ctrl+K command palette"* (`3db6dfcc`) is now **confirmed merged and live** on `origin/feature/website-login-redirection` (via PR #79) — `components/radiology/CommandPalette.tsx`, `lib/commandPalette.ts`, and `hooks/useRadiologyPalettePrefs.ts` all exist in the tree, and `RadiologyReportingWorkspace.tsx` imports and renders `CommandPalette` and calls `useRadiologyPalettePrefs()`, verified directly against the current commit.

Its design: `lib/commandPalette.ts` is a pure, alias-free ranking engine — `matchScore()` ranks exact(50) > prefix(40) > word-boundary(30) > substring(20) > keyword(10); `scoreItem()` adds recency (`RECENT_BASE=200 - index`) and a flat favourite boost (+100). Empty query shows a curated Recent → Favourites → Commands landing view; a query groups matched items by kind (`study|protocol|template|finding|history|combination|command|setting`). `CommandPalette.tsx` wraps cmdk's `Command` with `shouldFilter=false` (the palette engine ranks, cmdk only handles arrow/Enter navigation). `useRadiologyPalettePrefs.ts` persists recents/favourites to `localStorage` only — no backend calls. Items are built from data the workspace **already has cached** (active quick-select findings/protocols/history chips, structured+master templates, worklist queue) plus a static command/settings registry — "no new fetch, no new search index." Running an item calls back into the workspace's *existing* handlers.

Opening it intercepts `Ctrl/Cmd+K` at the top of the global keydown handler — this repurposes the workspace's pre-existing `Ctrl+K` binding (previously `"focus-quick-search"`), so this was a deliberate, resolved key-conflict decision, not an oversight.

A separate keyboard-shortcut matrix (`lib/workspaceReportState.ts`'s `matchWorkspaceShortcut()`) binds Save/Finalize/Next/Previous/Park/Open-viewer/etc. to specific keys, routed through one `createCommandDispatcher()` (`lib/workspaceCommands.ts`) — every keyboard shortcut, voice command, and palette action all funnel through this single dispatcher, so handlers have one guard implementation regardless of input modality. `VoiceCommandBar.tsx` is a separate push-to-talk/hands-free surface whose workflow intents also dispatch through this same `commandDispatcher`.

**Implication for USG**: this entire mechanism is modality-agnostic by construction (items are built from whatever data is already in the workspace's cache — findings/protocols/templates for the currently-open study, regardless of modality) and requires no changes to support USG-specific commands/findings/templates once those exist in the same data sources.

---

## 9. Draft Save

**Endpoint**: `POST /api/radiology/report-generator/save-draft` (`artifacts/api-server/src/routes/radiology-report-generator.ts`). Frontend payload: `{id (omitted on first save), studyId, worklistId, patientId, templateId, modality, studyName, clinicalHistory, rawFindings, findingsSections, impression: string[], recommendation, findings: deriveQuickSelectFindings(...)}`. `id` present ⇒ update; absent ⇒ insert.

**Backend writes**: primary write is `radiologyReportDraftsTable` (`radiology_report_drafts`) — no revision/version counter, just `updatedAt`. Two further writes are feature-flag gated and best-effort (wrapped in try/catch so failure never fails the response): if Quick-Select `findings[]` are present and `ff_radiology_structured_core` is on, rows are delete-then-reinserted into `report_finding_instances`; if additionally `ff_radiology_structured_d1_draft` is on, a canonical D1 structured-report document is built/validated and written to a `structured_json_d1` column. **No hashing happens at draft-save time** — content hashing is only computed by the D2 writer at finalize.

**Trigger**: explicit only — Save button, `Ctrl+S`, voice "save", or automatically as step 1 of finalize when the draft is dirty or has no id yet. A write-lock check runs before every save, returning 409 if another user actively holds the study's lock.

---

## 10. Finalization

Two parallel finalize paths exist server-side:

**Legacy path (default)**: `finalizeReport()` client-side — guards re-entry and lock ownership, saves the draft if dirty, calls a read-only validate-draft check, shows one `window.confirm` with patient identity/validation summary/warnings, then (if confirmed) calls the shared `finalizeRadiologyReport()`: resolves the study's billed test, `POST /api/patient-reports` (creating the row, storing `content.htmlBody` **verbatim as trusted HTML**), auto-signs via the sole active signature on file (declines rather than guessing if 0 or 2+ active signatures exist), then unconditionally posts a worklist status flip to `REPORT_FINAL`/`READY_TO_SEND` — this last step happens even when no report row was created.

**Structured (D5/D7/D9) path**, gated on `ff_radiology_structured_final`: runs inside one DB transaction, re-reads the authoritative draft + finding instances, materializes findings via the catalog, reserves an audit-log id, assembles/canonicalizes (RFC 8785 JCS)/SHA-256-hashes the document, then validates it (finalize-mode rules). A **Postgres transaction-scoped advisory lock** serializes the audit-chain append. Sign authority is checked separately from finalize permission — an explicit sign grant or full-access role, with a hard deny-list for typist/AI/system/bot roles; client-supplied author strings are never accepted (authorship comes only from the authenticated session).

A **legacy-equivalence check** compares the structured-rendered content against the draft's own persisted legacy fields; any genuine clinical-text mismatch causes finalize to fall back to the legacy (unsigned-structured) path rather than silently signing divergent content.

**Locking**: separate `radiology_worklist` row locking (`SELECT...FOR UPDATE`) blocks finalize while another user holds the study, and finalizing unconditionally clears the lock.

**UI locking after finalize**: `isLocked` gates every edit path; Save/Finalize buttons are hidden; a green "Report is finalized. Editing is disabled." banner appears. A separate amber/red banner handles lock-lost/locked-by-other states with Reclaim/Force-release actions.

**Notifications**: none fire on finalize/sign directly; the only automatic trigger is a WhatsApp auto-send on legacy `verify` (gated on a clinic setting) and an optional redelivery job enqueue on amendment.

---

## 11. Printing

`GET /:id/print`, `GET /:id/pdf`, and a public tokenized `GET /:token/pdf` all funnel through `buildReportArtifact()` → `resolveReportVersion()` (amendment-chain-aware version resolution) → `renderReportVersionHtml()`. **The actual served output is still HTML produced by the legacy, hand-built `lib/reportPresentation.ts` template system** — `/pdf` literally serves `Content-Type: text/html` for browser print-to-PDF, not a server-rendered PDF binary.

The new D4 `structuredReport/renderer.ts` is a **pure function** that assembles pre-pinned prose into plain text plus a per-line render trace and warnings. It only activates when `ff_radiology_structured_read` is on and the row has a non-null `structured_json` — when active, its plain-text body is fed into the *same* legacy HTML shell; when inactive, the legacy stored `body` string passes through unchanged. Printing is legacy-HTML-first with a feature-flagged structured-text substitution, not yet a full renderer cutover.

Amended/superseded reports get a visible safeguard: a red "SUPERSEDED" banner+watermark on any non-latest version, or an amber "AMENDED REPORT — Version N of M" banner.

---

## 12. Audit / Version History

`patient-reports.ts` has a dedicated amend endpoint (gated on `ff_radiology_structured_final`, requires a reason and sign authority). **Editing a finalized report never mutates the row in place** — it inserts a brand-new `patient_reports` row and a linkage row into `patient_report_amendments`. Chain-linearity is a **database constraint**, not just app logic: unique constraints on both the original and amended report id mean a report can be amended at most once and chains can never fork or merge; a concurrent double-amend hits a constraint violation, mapped to HTTP 409. Once verified/delivered (or structured-signed), plain edits are refused with a pointer to "Use Amend instead." A distinct, unrelated legacy `report_amendments` table (referenced from `smartRadiology.ts`) is a simple draft-keyed free-text addendum log, not part of this chain.

At the document level, the structured-report schema includes an `"amended"` audit-signature state and an `amends_document_id` field, and a validator rule walks that chain to enforce the same invariant the DB constraints also enforce — two independent enforcement layers of the same rule.

---

## 13. Settings

**Per-study-type ("Quick Select") settings** are keyed by a free-text `studyType` **region** string (e.g. "Brain," "LS Spine"), not by DICOM modality: study tabs, quick-finding buttons (including the Smart-Findings/questions fields), measurement library, protocols (indication-specific presets, with their **own separate** `modality` field — UI placeholder literally says `"MRI / CT / USG / XR"`), and clinical-history chips are all admin-configurable per region. This region/modality split means adding USG tabs ("Abdomen USG," "Obstetric," "Thyroid") is pure data entry, no schema change.

**Per-radiologist settings**: report preferences (heading case, section spacing, impression style, header/footer text, workspace layout), style preferences (AI impression style, terminology level, differential/measurement inclusion), voice preferences (push-to-talk key, confirmation policy — may only *tighten* clinic-wide policy, never loosen), learning settings (a single boolean).

**Clinic-wide settings**: `pacs_settings` key/value rows (default radiologist, urgent-highlight, report-final-lock, viewer network routes). **AI settings**: per-provider (OpenAI/Gemini/Anthropic/Ollama) API key/endpoint/model configuration, plus a USG-relevant toggle already present — `autoPopulateFormFFromObMeasurements` ("map ultrasound GA/CRL/FHR straight to PCPNDT logs") — evidence the settings surface already anticipates OB-USG workflows.

---

## 14. Worklist Integration

`RadiologyWorklist.tsx` renders RIS/PACS/MWL tabs; the **"Report" button** for each row navigates to `/radiology/report/${entry.id}` — critically, the worklist row's own primary key is used, **not** the often-null billing FK (an in-code comment explains this was a prior source of wrong-study/blank-workspace bugs). `App.tsx` resolves `/radiology/report/:studyId` to `<RadiologyReportingWorkspace studyId={Number(params.studyId)} />`; three more routes alias the same target and prop. **No other URL/query param is used** — `draftId`/`patientId` are derived server-side, never passed in the URL.

Assignment and locking are separate REST resources, backed by `radiology_study_locks` (one active lock per study, unique index) with a server-derived, settings-configurable TTL.

The worklist row already carries **USG-specific fields** (`usgMeasurementCount`, `usgKeyImageCount`, `usgReportStatus`, commented "R2.0 — canonical ultrasound integration"), confirming USG studies already ride the *same* worklist table/UI as MRI/CT — and a fallback destination exists for a USG study with no linked worklist row.

---

## 15. DICOM Integration

Viewer launch is **link-based (opens a new tab), not embedded**, via two coexisting paths:
1. **Legacy** — `lib/viewerService.ts`'s `launchViewer()`, used by direct Weasis/OHIF buttons in the worklist table; resolves an active network profile (LAN → Tailscale → Public, cached, probed live) client-side.
2. **Canonical (M1.2)** — `lib/studyLaunchService.ts`, used by `OpenStudyPanel.tsx` ("the ONE study-launch control of the canonical Reporting Workspace"): opens a blank tab synchronously (dodging popup blockers) before the async network probe resolves, selects StudyInstanceUID over accession number as the identifier (patient-name matching is explicitly "forbidden and not even representable"), probes `AUTO|LAN|TAILSCALE|CLOUDFLARE|PUBLIC` modes, guards against navigating a slow probe to the wrong patient if the radiologist switched studies mid-launch.

**Server-side deep links**: a study-viewer-launch endpoint degrades precision SOP → series → study when the configured OHIF template can't express a deeper level.

**Thumbnails/key-image selection**: `ReportImagePicker.tsx` browses a study's series/instances live over DICOMweb from the browser, renders thumbnails, and persists selections as **DICOM references only** (study/series/SOP UID + frame + caption + order, never blob URLs) to `radiology_image_references`. `ReportImagePanel.tsx` is the single reusable rendering component — explicitly designed for reuse by future surfaces, directly relevant to a USG workspace.

**Pull/routing pipeline**: PACS/modality → `dicom_pull_jobs` → external DICOM Pull Agent → `dicom_pulled_studies` (dedup) + telemetry → `dicom_routing_rules` decide forwarding → study is pushed to local PACS and intake-posted to `radiology_worklist` (already special-cases GE Voluson USG source AE-titles) and/or the canonical `dicom_studies` registry. `dicom_nodes` already has USG-specific fields (`watchFolderPath`, `allowNonDicomImages`, `acquisitionModesJson`, commented "USG/Voluson-specific file-system import paths"), meaning non-DICOM console-ultrasound ingestion is already modeled at the schema level.

---

## 16. AI Copilot Integration Points — What's Live vs. Orphaned/Partial

**Fully merged and working:**
- AI Impression generation (4-provider abstraction: OpenAI/Gemini/Anthropic/Ollama).
- On-demand full AI draft and passive AI-draft prefill.
- `RadiologyCopilotPanel.tsx` (prior-study fetch, consistency checker, follow-up suggestions).
- `RadiologyMemoryPanel.tsx` — live but every capability individually feature-flagged off by default.
- The Structured Finding Assistant and Smart Findings section-flip engine (deterministic, not AI).
- The universal Ctrl+K Command Palette (§8) — **confirmed merged and live**, correcting an earlier draft of this report.
- The D1/D5 structured-report engine — genuinely wired into draft-save and finalize, but entirely behind feature flags off by default.
- **`CareCopilotPanel.tsx` / `lib/copilotOrchestrator.ts`** (commit `21f870ba`, the newest radiology commit found in this audit, merged after the rest of this document's research was completed) — an always-on "CARE Copilot" tab that, per its own commit message, **composes the existing observer engine, validator, and quality-score functions into one report rather than adding a new engine**: structured contradiction detection, impression-completeness validation, missing-observation prompts, recommendation/follow-up, differential diagnosis, measurement reminders. Every item carries a plain-language "why," a confidence score, and is explicitly advisory-only (never silently changes the report). Local, deterministic analysis runs live with no per-keystroke AI call; Insert routes through the same setters the workspace already uses and is fully undoable. This is the single most direct architectural precedent in the codebase for "build a new capability by orchestrating existing engines, not duplicating them" — the exact posture recommended for USG in doc 07. **This audit has not deep-dived this component beyond its commit message**; a fast follow-up read is worth doing before finalizing an implementation plan, since it landed mid-audit.

**Orphaned / not reachable from any route** (confirmed via repo-wide grep — each has zero external importers):
- `RadiologyAICopilotPanel.tsx`, `RadiologyKnowledgePanel.tsx`, `RadiologyProductivityPanel.tsx`, `RadiologySmartFindingsPanel.tsx` — four substantial components, superseded by the Quick-Findings + Structured Finding Assistant system but never deleted.
- `radiologySmartEngine.ts`, `radiologyDifferentialEngine.ts`, `radiologyFollowUpEngine.ts` — consumed only by the orphaned panels above (`radiologyCoPilotEngine.ts` is the one live exception, wired for real-time missed-finding text nudges).
- `lib/radiologyMasterTemplates.ts` (17-template hardcoded library) and `radiologyMeasurementLibrary.ts` — dead, though their seed *content* (fatty-liver grading, renal calculus, hydronephrosis, OB GA formulas, etc.) is directly useful as data to migrate into the live DB-backed catalogs for a USG rollout.

**Already-built but disconnected USG-specific subsystem** worth flagging explicitly: `usg_measurements`/`usg_doppler_measurements`/`usg_key_images`/`usg_report_drafts` tables plus `lib/usgReportTemplates.ts` already exist and are already read by the worklist query, and `UsgMeasurementReviewPanel.tsx` is a mature, live, already-wired-into-the-workspace measurement-review/approve/insert UI (confidence scoring, DICOM-SR/OCR/manual provenance, "Trace" source viewer, PCPNDT Form-F mapping) — but none of this has been reconciled with either the legacy `usg-reports` finalize flow or the new D1 `structuredReport` engine. **A USG Reporting Workspace project should treat reconciling this existing USG subsystem with the canonical workspace as its central architectural decision, rather than building parallel structures from scratch.**
