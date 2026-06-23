# ERP_TECHNICAL_DEBT.md
**Care Diagnostics ERP — Technical Debt, Cleanup & Consolidation Audit**
*Audited: 2026-06-24 | Commit: 5b3a0d6 | 148 page files, ~200 API routes*

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Severity Legend](#2-severity-legend)
3. [Findings: Unused Pages](#3-findings-unused-pages)
4. [Findings: Dead / Orphaned Routes](#4-findings-dead--orphaned-routes)
5. [Findings: Duplicate Components & Pages](#5-findings-duplicate-components--pages)
6. [Findings: Legacy Reporting Tools](#6-findings-legacy-reporting-tools)
7. [Findings: Legacy PACS Pages](#7-findings-legacy-pacs-pages)
8. [Findings: Unused APIs](#8-findings-unused-apis)
9. [Findings: Unused Settings Pages](#9-findings-unused-settings-pages)
10. [Security & Auth Debt (Carried from Prior Audit)](#10-security--auth-debt-carried-from-prior-audit)
11. [Consolidated Issue Register](#11-consolidated-issue-register)
12. [3-Month Cleanup Roadmap](#12-3-month-cleanup-roadmap)

---

## 1. Executive Summary

The ERP has grown to **148 page files** and **~200 API routes** across many development phases. 
While all pages are routed (no completely dead imports), many have overlapping purposes, 
are hidden behind feature flags, serve functions now handled by newer unified components, 
or are pre-built for features not yet deployed (MWL SCP, HL7, peer review, AI pipeline).

**Key findings:**
- **~28 pages** are functionally redundant, legacy, or stub-level
- **~6 pages** duplicate a primary workflow that a newer page already owns
- **4 API route files** serve features with no UI consumer or no backend backend
- **7 settings pages** are pre-built but largely non-functional (HL7, AI pipeline, hanging protocols, etc.)
- **CommandCenter.tsx** is a 62-line KPI stub that is not linked in the main navigation
- **RadiologyLegacy.tsx** (74 KB) is explicitly named "legacy" and kept alive only as a fallback

---

## 2. Severity Legend

| Level | Meaning |
|-------|---------|
| 🔴 Critical | Causes active confusion, performance drag, or security risk |
| 🟠 High | Functional duplicate or significant developer confusion |
| 🟡 Medium | Feature stub / placeholder — zero user value, mild maintenance cost |
| 🟢 Low | Nice-to-clean, low risk, low impact |

---

## 3. Findings: Unused Pages

Pages that exist in `/src/pages/` and are routed in `App.tsx` but serve no active clinical workflow, 
are stubs, or are feature flags marked `hideDeprecatedNav`.

### UP-01 — CommandCenter.tsx 🔴 Critical
- **File:** `pages/CommandCenter.tsx` (2,736 bytes — 62 lines)
- **Route:** `/radiology/command-center` (routed in `App.tsx` line 353–358)
- **Status:** Not in `navItems` — cannot be reached from the sidebar
- **Problem:** This is a 7-card KPI summary stub. The actual RadiologyCommandCenter.tsx (111 KB, 
  full workflow page) is the real Command Center. The stub has the **same route prefix** and creates 
  confusion — `/radiology/command-center` goes to the stub, not the full page.
- **Impact:** Staff bookmarking `/radiology/command-center` land on the wrong page. 
  Real Command Center (RadiologyCommandCenter.tsx) is the workhorse but this stub shadows it.
- **Recommendation:** Delete `CommandCenter.tsx`. Point `/radiology/command-center` 
  entirely to `RadiologyCommandCenter.tsx`.

---

### UP-02 — RadiologyLegacy.tsx 🔴 Critical
- **File:** `pages/RadiologyLegacy.tsx` (74,672 bytes)
- **Route:** `/radiology/legacy`
- **Status:** In nav with `featureFlag: "hideDeprecatedNav"` — hidden by default
- **Problem:** Explicitly named "legacy". Contains the old pre-Phase 12 radiology workflow.
  Actively maintained (74 KB file), which drains maintenance budget.
  The new `RadiologyCommandCenter.tsx` + `RadiologyReportingWorkspace.tsx` replace it fully.
- **Impact:** Every refactor of radiology data structures must also touch this file.
- **Recommendation:** Freeze (no further changes), document as deprecated, set a removal date (Month 2).

---

### UP-03 — Radiology.tsx (landing page) 🟠 High
- **File:** `pages/Radiology.tsx` (15,422 bytes)
- **Route:** `/radiology`
- **Status:** In nav — but this is a generic "Radiology" landing that just links to sub-pages
- **Problem:** `RadiologyWorklist.tsx` at `/radiology/worklist` is the actual starting point.
  The `/radiology` landing page is a redundant intermediate step — one extra click.
- **Recommendation:** Replace `/radiology` route with redirect to `/radiology/worklist`. 
  Remove as standalone page after Month 1.

---

### UP-04 — ReportGenerator.tsx 🟠 High
- **File:** `pages/ReportGenerator.tsx` (89,265 bytes)
- **Route:** `/report-generator`
- **Status:** In nav under Settings group
- **Problem:** `RadiologyReportGenerator.tsx` (`/radiology/report-generator`, 97 KB) and 
  `RadiologyReportingWorkspace.tsx` (`/radiology/reporting-workspace`, 116 KB) both serve 
  the same purpose. Three report generators coexist.
- **Impact:** Maintenance tripling — any report format change must be done 3 times.
- **Recommendation:** Consolidate into `RadiologyReportingWorkspace.tsx` as the single entry. 
  `ReportGenerator.tsx` → redirect to `/radiology/reporting-workspace`.

---

### UP-05 — RadiologyReportEditor.tsx 🟠 High
- **File:** `pages/RadiologyReportEditor.tsx` (21,943 bytes)
- **Route:** `/radiology/report/:studyId`
- **Status:** Not in sidebar nav — only reachable via direct link/code
- **Problem:** A standalone editor that predates the full `RadiologyReportingWorkspace`. 
  Not linked from any navigation. Only exists as a legacy route for old bookmarks.
- **Recommendation:** Add redirect from `/radiology/report/:studyId` → 
  `/radiology/reporting-workspace/:studyId`. Remove file Month 2.

---

### UP-06 — RadiologyReportUnified.tsx 🟠 High
- **File:** `pages/RadiologyReportUnified.tsx` (116,803 bytes)
- **Route:** Not directly routed in App.tsx (unified-report → maps to RadiologyReportingWorkspace)
- **Status:** The `/radiology/unified-report/:worklistId` route points to `RadiologyReportingWorkspace` not to this file
- **Problem:** This is a 116 KB file that is **imported nowhere in App.tsx and never rendered**.
  It appears to be a superseded unified report component, replaced by `RadiologyReportingWorkspace`.
- **Impact:** Bundle size — even as lazy-loaded, it adds to the chunk graph analysis.
- **Recommendation:** Confirm no imports, then delete. High confidence it is fully dead code.

---

### UP-07 — ReportHub.tsx 🟠 High
- **File:** `pages/ReportHub.tsx` (52,654 bytes)
- **Route:** `/report-hub`
- **Status:** In sidebar nav
- **Problem:** `/reports` (Reports.tsx, 53 KB) and `/report-hub` serve nearly identical purposes — 
  financial + clinical report browsing. Two nav items for effectively the same workflow.
- **Recommendation:** Merge into Reports.tsx as tabs. Remove /report-hub as standalone.

---

### UP-08 — AiPipelineManager.tsx 🟡 Medium
- **File:** `pages/AiPipelineManager.tsx` (7,752 bytes)
- **Route:** `/radiology/ai-pipeline`
- **Status:** Not in sidebar nav
- **Problem:** Pre-built UI for an AI inference pipeline orchestration feature not yet deployed.
  No backend endpoint it calls is functional.
- **Recommendation:** Keep as future placeholder, add `// FUTURE` comment, remove from bundle priority.

---

### UP-09 — HangingProtocols.tsx 🟡 Medium
- **File:** `pages/HangingProtocols.tsx` (8,697 bytes)
- **Route:** `/radiology/hanging-protocols`
- **Status:** Not in sidebar nav
- **Problem:** DICOM hanging protocol management — no backend implementation, 
  no DB table, no OHIF integration for custom protocols.
- **Recommendation:** Mark as `// FUTURE — requires OHIF hanging protocol API integration`.

---

### UP-10 — MissedFindingDetector.tsx 🟡 Medium
- **File:** `pages/MissedFindingDetector.tsx` (7,482 bytes)
- **Route:** `/radiology/missed-finding-detector`
- **Status:** Hidden behind `featureFlag: "hideDeprecatedNav"` in radiology group
- **Problem:** Calls an AI endpoint for missed finding detection. 
  Duplicate of functionality in `RadiologyCommandCenter`. 
  Now also in `AiDicomFindings.tsx`.
- **Recommendation:** Consolidate into Command Center AI tools section.

---

### UP-11 — ImageReviewAssistant.tsx 🟡 Medium
- **File:** `pages/ImageReviewAssistant.tsx` (9,706 bytes)
- **Route:** `/radiology/image-review`
- **Status:** Hidden behind `featureFlag: "hideDeprecatedNav"`
- **Problem:** Stub — calls AI endpoint for image review suggestions. 
  Functionality partially overlaps with `AiExtractionReview.tsx`.
- **Recommendation:** Merge into `AiExtractionReview.tsx` or `RadiologyCommandCenter`.

---

### UP-12 — FeedbackLoopAnalytics.tsx 🟡 Medium
- **File:** `pages/FeedbackLoopAnalytics.tsx` (3,806 bytes)
- **Route:** `/radiology/feedback-loop-analytics`
- **Status:** Not in nav
- **Problem:** 3,806 bytes — the smallest page. Renders a placeholder card only.
  "Feedback loop analytics" concept is not implemented.
- **Recommendation:** Delete stub, re-create when feature is real.

---

### UP-13 — ReportDiffViewer.tsx 🟡 Medium
- **File:** `pages/ReportDiffViewer.tsx` (4,579 bytes)
- **Route:** `/radiology/report-diff`
- **Status:** Not in nav
- **Problem:** Small page, compares two report versions. 
  Useful concept but no UI entry point.
- **Recommendation:** Integrate into `RadiologyReportingWorkspace` as a "Version History" tab.

---

### UP-14 — RagVectorStore.tsx + AiSearchRetrieval.tsx 🟡 Medium
- **Files:** `pages/RagVectorStore.tsx` (8,336), `pages/AiSearchRetrieval.tsx` (6,715)
- **Routes:** `/radiology/rag-vector-store`, `/radiology/ai-search-retrieval`
- **Status:** Not in nav
- **Problem:** RAG vector store and semantic search — backend not fully implemented.
  Calls undeployed embedding endpoints. Placeholder UIs.
- **Recommendation:** Keep files, add `// FUTURE`, remove from active routes.

---

### UP-15 — TrainingDataExports.tsx 🟡 Medium
- **File:** `pages/TrainingDataExports.tsx` (6,092 bytes)
- **Route:** `/radiology/training-data-exports`
- **Status:** Not in nav
- **Problem:** Exports radiology cases as AI training datasets. 
  Backend endpoint incomplete.
- **Recommendation:** Keep, mark as future, gate behind admin only.

---

### UP-16 — Teaching Suite (8 pages) 🟡 Medium
- **Files:** TeachingFiles, TeachingCaseDetail, TeachingCollections, TeachingFavorites, 
  TeachingAIAssistant, TeachingResearchMode, TeachingMode, TeachingAnalytics, 
  TeachingPresentationMode (9 files, ~120 KB total)
- **Routes:** `/teaching-cases`, `/teaching-*`
- **Status:** All routed; hidden behind `featureFlag: "hideDeprecatedNav"` in radiology nav
- **Problem:** Teaching case system is implemented (backend exists: `teachingCases.ts`),
  but navigation is suppressed. Staff cannot discover these features.
  9 separate routes/pages for one coherent "Teaching Mode" module.
- **Recommendation:** Consolidate into single `TeachingCases.tsx` with internal tabs. 
  Reduce 9 routes to 3 (list, detail, presentation). Re-enable in nav.

---

## 4. Findings: Dead / Orphaned Routes

Routes in `App.tsx` that are not reachable from the sidebar and have no deep-link source.

### DR-01 — `/register` 🟠 High
- **Component:** `Register.tsx`
- **Problem:** `/register` route exists but is not in `navItems`. 
  Staff registration is done via `/staff` (Staff.tsx). 
  This appears to be an old self-registration flow.
- **Recommendation:** Remove route or redirect to `/staff`.

---

### DR-02 — `/dues` 🟡 Medium
- **Component:** `Dues.tsx` (18,994 bytes)
- **Problem:** Not in sidebar `navItems`. Dues/pending payments workflow is inside `Billing.tsx` tabs.
  Orphaned page with no navigation entry point.
- **Recommendation:** Add to billing group nav or merge into Billing.tsx.

---

### DR-03 — `/radiology/unified-report/:worklistId` 🟠 High
- **Maps to:** `RadiologyReportingWorkspace` (correct), but import name is `RadiologyReportUnified`
- **Problem:** The route alias is confusing — it uses the same component as 
  `/radiology/reporting-workspace/:studyId`, just with a different param name.
  If `RadiologyReportUnified.tsx` is ever accidentally imported instead, the wrong component loads.
- **Recommendation:** Standardize to one route pattern for reporting workspace.

---

### DR-04 — `/outsourced-labs` and `/outsourced-cost-report` 🟡 Medium
- **Problem:** These exist as standalone routes (App.tsx lines 410–411) AND are duplicated 
  inside the Settings nav group. Same pages accessible via two different paths 
  (`/outsourced-labs` and `/settings → Outsourced Labs`).
- **Recommendation:** Remove standalone routes, keep only under `/outsource/` prefix.

---

### DR-05 — `/m/viewer/:studyInstanceUID` (MobileViewer) 🟡 Medium
- **Component:** `MobileViewer.tsx` (15,504 bytes)
- **Problem:** Mobile DICOM viewer route — not linked from anywhere in the ERP.
  Must be accessed via direct URL only.
- **Recommendation:** Either link from worklist "Open on mobile" button, 
  or remove and use OHIF's responsive mode.

---

## 5. Findings: Duplicate Components & Pages

### DC-01 — Three Report Generation Pages 🔴 Critical
| Page | Route | Size |
|------|-------|------|
| `ReportGenerator.tsx` | `/report-generator` | 89 KB |
| `RadiologyReportGenerator.tsx` | `/radiology/report-generator` | 97 KB |
| `RadiologyReportingWorkspace.tsx` | `/radiology/reporting-workspace` | 116 KB |

- **Problem:** Three separate report generation UIs with overlapping functionality.
  Any design change must be applied to all three.
- **Winner:** `RadiologyReportingWorkspace.tsx` — most complete, Phase 12+
- **Recommendation:** Make Workspace the single tool; redirect others → Workspace.

---

### DC-02 — Two PACS Dashboard Pages 🟠 High
| Page | Route |
|------|-------|
| `PACS.tsx` | `/pacs` |
| `PacsDashboard.tsx` | `/radiology/pacs-dashboard` |

- **Problem:** `/pacs` (24 KB) is a basic PACS viewer/study list. 
  `/radiology/pacs-dashboard` (52 KB) is the enterprise PACS dashboard.
  Both appear in the sidebar: "PACS Viewer" and — if enabled — "PACS Dashboard".
- **Recommendation:** Merge into `PacsDashboard.tsx` as tabs. Remove `PACS.tsx`.

---

### DC-03 — Two MWL Pages 🟠 High
| Page | Route |
|------|-------|
| `MwlDashboard.tsx` | `/radiology/mwl-dashboard` |
| `MwlManager.tsx` | `/radiology/mwl-manager` |

- **Problem:** `MwlDashboard` (15 KB) shows MWL scheduled procedures list. 
  `MwlManager` (8 KB) is a management form. Both routed, only Dashboard in nav.
  Overlapping UI, no clear separation.
- **Recommendation:** Merge MwlManager into MwlDashboard as a modal/panel.

---

### DC-04 — Two Daily Summary Pages 🟠 High
| Page | Route |
|------|-------|
| `DailySummary.tsx` | `/daily-summary` |
| `MyDailySummary.tsx` | `/my-daily-summary` |

- **Status:** Both in nav
- **Problem:** MyDailySummary (109 KB) is the individual radiologist daily view.
  DailySummary (42 KB) is the owner/admin daily view.
  Different enough to warrant separate existence, but nearly identical UI patterns.
  Permission guard for DailySummary is missing (see Security Debt TD-01).
- **Recommendation:** Keep both; add permission guard to DailySummary.

---

### DC-05 — Two Day Close Pages 🟡 Medium
| Page | Route |
|------|-------|
| `DayClose.tsx` | `/day-close` |
| `MyDayClose.tsx` | `/my-day-close` |

- **Problem:** DayClose (65 KB) = admin day close. MyDayClose (37 KB) = staff day close.
  Both in nav. Pattern is consistent with DailySummary split.
- **Recommendation:** Keep; consider merging under one route with role-based UI switching.

---

### DC-06 — Two USG Measurement Pages 🟡 Medium
| Route | Component |
|-------|-----------|
| `/usg/measurements` | `UsgMeasurementReview.tsx` |
| `/radiology/usg-measurements` | `UsgMeasurementReview.tsx` |

- **Problem:** The **same component** is routed at two different paths.
  `UsgMeasurementReview.tsx` appears in both the USG module and the Radiology module routes.
- **Recommendation:** Standardize to `/usg/measurements`. Remove `/radiology/usg-measurements`.

---

### DC-07 — Two USG Admin Settings Routes 🟡 Medium
| Route | Component |
|-------|-----------|
| `/usg/settings` | `UsgAdminSettings.tsx` |
| `/radiology/usg-admin-settings` | `UsgAdminSettings.tsx` |

- **Problem:** Same component, two routes.
- **Recommendation:** Use `/usg/settings` only.

---

### DC-08 — DicomNodes vs PacsSettings in nav 🟡 Medium
- **Nav:** Settings group shows both "PACS & DICOM" (`/radiology/pacs-settings`) 
  and "DICOM Nodes" (`/dicom-nodes`) as separate entries.
- **PACS.tsx** (`/pacs`) also has DICOM node management sections.
- **Problem:** Three places to manage DICOM configuration.
- **Recommendation:** Consolidate DICOM nodes into PacsSettings as a tab.

---

## 6. Findings: Legacy Reporting Tools

### LR-01 — RadiologyLegacy.tsx 🔴 Critical
- **See UP-02.** 74 KB of actively maintained legacy code.
- **Estimate to freeze/remove:** 2 hours (freeze) + 4 hours (verify no callers) + 2 hours (remove)

---

### LR-02 — ReportGenerator.tsx 🟠 High
- **See DC-01.** 89 KB standalone report generator.
- The "Report Generator" nav item in Settings points here.
- No unique feature that Workspace doesn't offer.
- **Recommendation:** Redirect → Workspace. Month 2 removal.

---

### LR-03 — NormalReportTemplates.tsx 🟡 Medium
- **File:** `pages/NormalReportTemplates.tsx` (16,253 bytes)
- **Route:** `/radiology/normal-templates`
- **Status:** In nav (Radiology group: "Normal Templates")
- **Problem:** Duplicate of `ReportTemplates.tsx` (`/report-templates`) and 
  `RadiologyReportingWorkspace` normal template tab.
  Three ways to manage normal/standard report templates.
- **Recommendation:** Merge into Reporting Workspace "Templates" tab.

---

### LR-04 — TemplateVersions.tsx 🟡 Medium
- **File:** `pages/TemplateVersions.tsx` (5,587 bytes)
- **Route:** `/radiology/template-versions`
- **Status:** Not in nav
- **Problem:** Template version history — minor feature, not linked anywhere.
- **Recommendation:** Add as sub-section of ReportTemplates page.

---

### LR-05 — RadiologyReportEditor.tsx 🟠 High
- **See UP-05.** Per-study report editor, predates Workspace, not linked in nav.

---

## 7. Findings: Legacy PACS Pages

### LP-01 — PACS.tsx (basic viewer) 🟠 High
- **File:** `pages/PACS.tsx` (24,824 bytes)
- **Route:** `/pacs`
- **Status:** In nav (Radiology group: "PACS Viewer")
- **Problem:** Basic study browser that proxies Orthanc REST. 
  `PacsDashboard.tsx` (52 KB) and `DicomQueryRetrieve.tsx` (84 KB) are full replacements.
  The basic `/pacs` page shows a flat study list — fine for quick access, 
  but duplicates the worklist+viewer pattern.
- **Recommendation:** Redirect `/pacs` → `/radiology/dicom-qr` or `/radiology/pacs-dashboard`.
  Keep URL alive for backward compatibility.

---

### LP-02 — DicomStudyWorklist.tsx 🟡 Medium
- **File:** `pages/DicomStudyWorklist.tsx` (14,315 bytes)
- **Route:** `/radiology/dicom-study-worklist`
- **Status:** Not in main nav (only ERP_NAV_ORDER for permission guard)
- **Problem:** Study worklist that predates `RadiologyWorklist.tsx` and `DicomQueryRetrieve.tsx`.
  Three worklists coexist for the same study list function.
- **Recommendation:** Deprecate; redirect to `/radiology/worklist`.

---

### LP-03 — AcquisitionGateway.tsx 🟡 Medium
- **File:** `pages/AcquisitionGateway.tsx` (8,438 bytes)
- **Route:** `/radiology/acquisition-gateway`
- **Status:** Not in nav
- **Problem:** Pre-built gateway for scanner/modality connection setup.
  Overlaps with `DicomNodes.tsx` and `ModalityManagement.tsx`.
- **Recommendation:** Merge unique UI into ModalityManagement. Remove standalone.

---

### LP-04 — PacsWatchdogDashboard.tsx 🟡 Medium
- **File:** `pages/PacsWatchdogDashboard.tsx` (11,384 bytes)
- **Route:** `/radiology/watchdog`
- **Status:** Hidden behind `featureFlag + ownerOnly`
- **Problem:** PACS watchdog monitors for stale studies and connectivity. 
  Backend watchdog service is not deployed.
- **Recommendation:** Mark as future. Remove from active routes until service is deployed.

---

### LP-05 — PacsArchiveLifecycle.tsx 🟡 Medium
- **File:** `pages/PacsArchiveLifecycle.tsx` (15,012 bytes)
- **Route:** `/radiology/archive-lifecycle`
- **Status:** Not in main nav (`ERP_NAV_ORDER` only)
- **Problem:** Archive lifecycle management (cold/warm/hot storage tiers). 
  No backend storage lifecycle API implemented.
- **Recommendation:** Keep as future. Add to PacsDashboard as "Archive" tab when ready.

---

### LP-06 — AgentSetup.tsx 🟡 Medium
- **File:** `pages/AgentSetup.tsx` (14,555 bytes)
- **Route:** `/radiology/agent-setup`
- **Status:** Not in main nav
- **Problem:** DIMSE agent setup wizard. Backend agent exists but is disabled (`ENABLE_DICOM_PULL_AGENT=1` not set).
  Once enabled, this page becomes valuable.
- **Recommendation:** Enable DIMSE agent (trivial env var), then surface this page in nav under PACS settings.

---

## 8. Findings: Unused APIs

### UA-01 — HL7 Routes (`routes/hl7.ts`) 🟠 High
- **File:** `routes/hl7.ts` (9,109 bytes)
- **Route:** `/api/hl7/*`
- **UI Consumer:** `Hl7Settings.tsx` (`/radiology/hl7-settings`)
- **Problem:** No HL7 listener running on Synology. All endpoints build HL7 messages 
  but have no receiver to send them to. HL7 settings page lets you configure what 
  is essentially a no-op.
- **Impact:** Staff confusion when HL7 sends silently fail.
- **Recommendation:** Either deploy an HL7 listener (Mirth Connect or similar), 
  or clearly mark HL7 Settings as "NOT CONFIGURED — for future use".

---

### UA-02 — `routes/dicom-agent.ts` 🟡 Medium
- **File:** `routes/dicom-agent.ts` (2,659 bytes)
- **Route:** `/api/dicom-agent/*`
- **Problem:** Thin wrapper that checks DIMSE agent status. 
  Agent is disabled (`ENABLE_DICOM_PULL_AGENT` not set), so all calls return "agent not running".
- **Recommendation:** Enable agent (env var). Route becomes useful immediately.

---

### UA-03 — Multi-Site Worklist (`lib/multiSiteWorklist.ts`) 🟡 Medium
- **File:** `lib/multiSiteWorklist.ts` (2,470 bytes)
- **Problem:** Multi-branch MWL aggregation. Not called from any route.
  Single-site clinic — this is premature.
- **Recommendation:** Remove from build or add `// FUTURE` comment. Revisit at multi-branch expansion.

---

### UA-04 — `routes/risMonitoring.ts` 🟡 Medium
- **File:** `routes/risMonitoring.ts` (23,291 bytes)
- **Route:** `/api/ris-monitor/*`
- **UI Consumer:** Not found in page components (no RisMonitor.tsx in pages/)
- **Problem:** RIS monitoring backend (TAT alerts, queue depth, priority queue) with no UI page.
  Data is accessible via API but no staff-facing dashboard renders it.
- **Recommendation:** Create a simple RIS monitor panel inside the PACS Dashboard or 
  Command Center instead of a separate page.

---

## 9. Findings: Unused Settings Pages

### SP-01 — Hl7Settings.tsx 🟠 High
- **File:** `pages/Hl7Settings.tsx` (16,579 bytes)
- **Route:** `/radiology/hl7-settings`
- **Problem:** See UA-01. HL7 is not deployed. Settings page configures a non-functional service.
- **Recommendation:** Add prominent banner: "HL7 integration requires server-side HL7 listener — not configured."

---

### SP-02 — AiInferenceSettings.tsx 🟡 Medium
- **File:** `pages/AiInferenceSettings.tsx` (13,793 bytes)
- **Route:** `/radiology/ai-inference-settings`
- **Status:** Not in main nav (`ERP_NAV_ORDER` only)
- **Problem:** Advanced AI inference tuning — model temperature, token limits, etc.
  Most settings are already in `AiReportingSettings.tsx`. Duplicate settings surface.
- **Recommendation:** Merge unique inference settings into `AiReportingSettings.tsx`.

---

### SP-03 — AiPromptEffectiveness.tsx 🟡 Medium
- **File:** `pages/AiPromptEffectiveness.tsx` (9,968 bytes)
- **Route:** `/radiology/ai-prompt-effectiveness`
- **Status:** Not in main nav
- **Problem:** Analytics for prompt quality scoring. Backend has no data to show 
  without a full AI feedback collection pipeline (not deployed).
- **Recommendation:** Keep placeholder, add disclaimer banner.

---

### SP-04 — AiQualityScores.tsx 🟡 Medium
- **File:** `pages/AiQualityScores.tsx` (12,698 bytes)
- **Route:** `/radiology/ai-quality-scores`
- **Status:** Not in main nav
- **Problem:** Similar to SP-03. Quality scoring requires a deployed evaluation pipeline.
- **Recommendation:** Consolidate with `AiAuditLog.tsx` as an "AI Analytics" combined page.

---

### SP-05 — AnomalyAlerts.tsx 🟡 Medium
- **File:** `pages/AnomalyAlerts.tsx` (14,723 bytes)
- **Route:** `/radiology/anomaly-alerts`
- **Status:** Not in main nav
- **Problem:** Anomaly detection alerts — similar to `CriticalFindings.tsx` and `CriticalAlertsManager.tsx`.
  Three separate "alerts" pages exist.
- **Recommendation:** Merge all three alert surfaces into a single "Alerts & Findings" dashboard.

---

### SP-06 — RadiologyProductivity.tsx 🟡 Medium
- **File:** `pages/RadiologyProductivity.tsx` (9,208 bytes)
- **Route:** `/radiology/productivity`
- **Status:** Not in nav
- **Problem:** Productivity tracking per radiologist. Good concept but thin implementation.
  Data partially available in `TurnaroundTimeAnalytics.tsx`.
- **Recommendation:** Merge into MyDailySummary or a combined "Radiologist Analytics" tab.

---

### SP-07 — StorageLifecycle.tsx 🟡 Medium
- **File:** `pages/StorageLifecycle.tsx` (8,423 bytes)
- **Route:** `/radiology/storage-lifecycle`
- **Status:** Not in main nav
- **Problem:** Object storage lifecycle management. No storage tier management backend deployed.
  Duplicate of `PacsArchiveLifecycle.tsx` intent.
- **Recommendation:** Merge with `PacsArchiveLifecycle.tsx` as one "Storage" page.

---

## 10. Security & Auth Debt (Carried from Prior Audit)

These items remain open from the original `ERP_TECHNICAL_DEBT.md`:

| Ref | Severity | Status | Description |
|-----|----------|--------|-------------|
| TD-01 | 🔴 Critical | ⏳ Open | `/daily-summary` missing permission gate |
| TD-02 | 🔴 Critical | ⏳ Open | Open mail relay in daily summary emailer |
| TD-03 | 🔴 Critical | ⏳ Open | Missing route gates on `/samples` |
| TD-04 | 🟠 High | ⏳ Open | O(N) patient ID generation |
| TD-05 | 🟠 High | ⏳ Open | Playwright PDF on main thread |
| TD-06 | 🟠 High | ⏳ Open | Unapplied role checks in DICOM Study Manager |
| TD-07 | 🟡 Medium | ⏳ Open | Billing mutation gating bypasses |
| TD-08 | 🟡 Medium | ⏳ Open | Dead helper functions in DICOM Study Manager |
| TD-09 | 🟢 Low | ✅ Partially done | Workspace repository pollution (docs moved) |

Plus new security items from PACS audit:
| Ref | Severity | Description |
|-----|----------|-------------|
| PACS-BW-003 | 🟡 Medium | Orthanc password empty |
| PACS-BW-006 | 🟡 Medium | OrthancConnector.getStudy() broken (wrong HTTP method) |

---

## 11. Consolidated Issue Register

| ID | Severity | Category | Item | File(s) | Effort |
|----|----------|----------|------|---------|--------|
| UP-01 | 🔴 | Unused Page | CommandCenter stub shadows real page | CommandCenter.tsx | 0.5h |
| UP-02 | 🔴 | Legacy | RadiologyLegacy explicitly deprecated | RadiologyLegacy.tsx | 8h |
| DC-01 | 🔴 | Duplicate | 3 report generators | ReportGenerator, RadiologyReportGenerator, ReportingWorkspace | 16h |
| TD-01 | 🔴 | Security | /daily-summary no permission gate | daily-summary.ts | 0.5h |
| TD-02 | 🔴 | Security | Open mail relay | my-daily-summary.ts | 2h |
| TD-03 | 🔴 | Security | /samples no permission gate | samples.ts | 0.5h |
| UP-03 | 🟠 | Unused | Radiology.tsx landing redirect | Radiology.tsx | 0.5h |
| UP-04 | 🟠 | Duplicate | ReportGenerator.tsx vs Workspace | ReportGenerator.tsx | 4h |
| UP-05 | 🟠 | Dead route | RadiologyReportEditor not in nav | RadiologyReportEditor.tsx | 2h |
| UP-06 | 🟠 | Dead code | RadiologyReportUnified not rendered | RadiologyReportUnified.tsx | 1h |
| UP-07 | 🟠 | Duplicate | ReportHub vs Reports | ReportHub.tsx, Reports.tsx | 8h |
| DR-01 | 🟠 | Dead route | /register orphaned | Register.tsx | 0.5h |
| DR-03 | 🟠 | Dead route | unified-report alias confusion | App.tsx | 1h |
| DC-02 | 🟠 | Duplicate | PACS.tsx vs PacsDashboard | PACS.tsx, PacsDashboard.tsx | 4h |
| DC-03 | 🟠 | Duplicate | MwlDashboard vs MwlManager | MwlDashboard, MwlManager | 2h |
| DC-04 | 🟠 | Duplicate | DailySummary permission missing | DailySummary.tsx | 0.5h |
| DC-08 | 🟠 | Duplicate | DicomNodes in 3 places | DicomNodes, PACS, PacsSettings | 4h |
| TD-04 | 🟠 | Performance | O(N) patient ID | patients.ts | 2h |
| TD-05 | 🟠 | Performance | Playwright on main thread | pacsArchive.ts | 8h |
| TD-06 | 🟠 | Security | DICOM Study Manager role checks | dicomStudyManager.ts | 2h |
| UA-01 | 🟠 | Unused API | HL7 routes, no listener | hl7.ts, Hl7Settings.tsx | 1h |
| LP-01 | 🟠 | Legacy PACS | PACS.tsx basic viewer | PACS.tsx | 2h |
| LP-02 | 🟡 | Legacy PACS | DicomStudyWorklist outdated | DicomStudyWorklist.tsx | 1h |
| UP-08 | 🟡 | Stub | AiPipelineManager stub | AiPipelineManager.tsx | 0.5h |
| UP-09 | 🟡 | Stub | HangingProtocols stub | HangingProtocols.tsx | 0.5h |
| UP-12 | 🟡 | Stub | FeedbackLoopAnalytics stub | FeedbackLoopAnalytics.tsx | 0.5h |
| UP-16 | 🟡 | Consolidate | Teaching suite (9 pages) | Teaching*.tsx | 8h |
| DC-05 | 🟡 | Duplicate | Two day close pages | DayClose, MyDayClose | 4h |
| DC-06 | 🟡 | Duplicate | UsgMeasurementReview two routes | App.tsx | 0.5h |
| DC-07 | 🟡 | Duplicate | UsgAdminSettings two routes | App.tsx | 0.5h |
| DR-02 | 🟡 | Dead route | /dues not in nav | Dues.tsx | 1h |
| DR-04 | 🟡 | Dead route | /outsourced-labs duplicate path | App.tsx | 0.5h |
| DR-05 | 🟡 | Dead route | MobileViewer not linked | MobileViewer.tsx | 1h |
| SP-01 | 🟡 | Settings | HL7 settings non-functional | Hl7Settings.tsx | 0.5h |
| SP-02 | 🟡 | Settings | AiInferenceSettings duplicate | AiInferenceSettings.tsx | 2h |
| SP-05 | 🟡 | Consolidate | 3 alert pages | Anomaly, Critical, CriticalMgr | 4h |
| UA-04 | 🟡 | Unused API | risMonitoring.ts no UI | risMonitoring.ts | 2h |
| LP-06 | 🟡 | PACS | AgentSetup not surfaced | AgentSetup.tsx | 0.5h |
| TD-07 | 🟡 | Security | Billing sub-permission bypasses | bills.ts | 2h |
| TD-08 | 🟡 | Code quality | Dead role helpers | dicomStudyManager.ts | 0.5h |

**Total estimated effort: ~100–110 hours (~14 working days)**

---

## 12. 3-Month Cleanup Roadmap

> **Rules:**
> - Do NOT delete any file without first: (1) verifying zero imports, (2) redirecting any live routes, (3) committing a checkpoint.
> - All cleanup is preceded by a `git commit -m "chore: checkpoint before [item]"`.
> - Effort = developer-hours (single experienced developer).

---

### Month 1 — Week 1–2: Critical Security & Quick Wins
**Target: 3 Critical security + 5 dead routes (low effort, high impact)**

| Task | ID | Effort | Impact |
|------|----|--------|--------|
| Add permission gate to `/daily-summary` | TD-01 | 0.5h | 🔴 Critical security fix |
| Fix open mail relay in emailer | TD-02 | 2h | 🔴 Critical security fix |
| Add permission gate to `/samples` | TD-03 | 0.5h | 🔴 Critical security fix |
| Fix DICOM Study Manager role checks | TD-06 | 2h | 🟠 Security fix |
| Add billing sub-permission checks | TD-07 | 2h | 🟡 Security hardening |
| Remove /register orphaned route | DR-01 | 0.5h | 🟢 Cleanup |
| Fix duplicate USG routes (DC-06, DC-07) | DC-06+07 | 1h | 🟢 Cleanup |
| Fix duplicate /outsourced-labs route | DR-04 | 0.5h | 🟢 Cleanup |
| Delete FeedbackLoopAnalytics stub | UP-12 | 0.5h | 🟢 Cleanup |
| Fix O(N) patient ID generation | TD-04 | 2h | 🟠 Performance |

**Month 1 total: ~11.5 hours | Expected reduction: 2 dead routes, 3 security fixes, 1 performance fix**

---

### Month 1 — Week 3–4: PACS Consolidation
**Target: Consolidate duplicated PACS/DICOM surfaces**

| Task | ID | Effort | Impact |
|------|----|--------|--------|
| Redirect `/pacs` → `/radiology/pacs-dashboard` | LP-01, DC-02 | 2h | 🟠 Simplify navigation |
| Merge MwlManager into MwlDashboard | DC-03 | 2h | 🟠 Consolidate MWL |
| Deprecate DicomStudyWorklist, redirect → Worklist Hub | LP-02 | 1h | 🟡 Cleanup |
| Merge AcquisitionGateway into ModalityManagement | LP-03 | 2h | 🟡 Consolidate |
| Surface AgentSetup in PACS Settings nav | LP-06 | 0.5h | 🟢 UX improvement |
| Mark PacsWatchdogDashboard as FUTURE | LP-04 | 0.5h | 🟢 Clarity |
| Merge StorageLifecycle + PacsArchiveLifecycle | SP-07 | 2h | 🟡 Consolidate |
| Fix Orthanc password in .env | PACS-BW-003 | 0.25h | 🟡 Security |
| Fix OrthancConnector.getStudy() POST body | PACS-BW-006 | 1h | 🟡 Bug fix |
| Enable DIMSE pull agent (add env var) | PACS-BW-002 | 0.25h | 🔴 Operational fix |

**Month 1 (Weeks 3–4) total: ~11.5 hours | Expected: PACS surfaces reduced from 8 → 4**

---

### Month 2 — Week 5–6: Report Generator Consolidation
**Target: Three report generators → one**

| Task | ID | Effort | Impact |
|------|----|--------|--------|
| Audit ReportGenerator.tsx vs Workspace — identify unique features | DC-01 | 2h | Analysis |
| Move unique features from ReportGenerator → Workspace | DC-01 | 8h | 🔴 Consolidation |
| Redirect `/report-generator` → `/radiology/reporting-workspace` | DC-01 | 0.5h | 🟠 UX |
| Confirm RadiologyReportUnified.tsx has no live imports | UP-06 | 1h | Analysis |
| Delete RadiologyReportUnified.tsx | UP-06 | 0.5h | 🟠 Dead code |
| Redirect `/radiology/report/:studyId` → Workspace | UP-05 | 0.5h | 🟠 Dead route |
| Freeze RadiologyLegacy.tsx (no further changes) | UP-02 | 0.5h | 🔴 Freeze |
| Add "DEPRECATED" banner to RadiologyLegacy | UP-02 | 1h | 🟢 Clarity |

**Month 2 (Weeks 5–6) total: ~14 hours | Expected: 2 report generators removed**

---

### Month 2 — Week 7–8: Nav & UX Cleanup
**Target: Sidebar rationalisation, Teaching suite, AI tools consolidation**

| Task | ID | Effort | Impact |
|------|----|--------|--------|
| Redirect `/radiology` → `/radiology/worklist` | UP-03 | 0.5h | 🟠 UX |
| Add `/dues` to billing nav group | DR-02 | 0.5h | 🟢 Discovery |
| Merge ReportHub into Reports as tab | UP-07 | 8h | 🟠 Consolidate |
| Merge NormalReportTemplates into Workspace templates | LR-03 | 4h | 🟡 Consolidate |
| Merge TemplateVersions into ReportTemplates | LR-04 | 2h | 🟡 Consolidate |
| Consolidate 3 alert pages → 1 "Alerts" page | SP-05 | 4h | 🟡 Consolidate |
| Merge AiQualityScores + AiPromptEffectiveness → AiAuditLog | SP-03, SP-04 | 4h | 🟡 Consolidate |
| Merge AiInferenceSettings into AiReportingSettings | SP-02 | 2h | 🟡 Consolidate |
| Consolidate Teaching suite (9 pages → 3) | UP-16 | 8h | 🟡 Consolidate |

**Month 2 (Weeks 7–8) total: ~33 hours | Expected: ~15 pages reduced to ~5**

---

### Month 3 — Week 9–10: Performance & Tech Infrastructure
**Target: Playwright PDF, DIMSE, MWL SCP**

| Task | ID | Effort | Impact |
|------|----|--------|--------|
| Move Playwright PDF to background job | TD-05 | 8h | 🟠 Performance |
| Deploy MWL SCP (Orthanc Lua or dedicated container) | PACS-BW-001 | 16h | 🔴 Operational |
| Add Orthanc → ERP webhook (OnStoredInstance) | PACS-R-14 | 4h | 🟢 Enhancement |
| Add DICOM study audit log (who opened which study) | PACS-BW-004 | 2h | 🟡 Audit |
| Add disclaimer banner to HL7 Settings | SP-01 | 0.5h | 🟢 Clarity |
| Remove multiSiteWorklist (dead code) | UA-03 | 0.5h | 🟢 Cleanup |
| Remove RadiologyLegacy.tsx | UP-02 | 4h | 🔴 Cleanup |

**Month 3 (Weeks 9–10) total: ~35 hours | Expected: MWL working, PACS webhook, Playwright offloaded**

---

### Month 3 — Week 11–12: Final Sweep & Documentation
**Target: Validation, documentation update, test run**

| Task | Effort |
|------|--------|
| Full navigation audit — walk every nav item, verify correct page loads | 3h |
| Verify no broken links after redirects | 2h |
| Update `REPOSITORY_INDEX.md` with removed/renamed pages | 2h |
| Update `PACS_Architecture_Master.md` — MWL status if deployed | 1h |
| Update `Radiology_Architecture_Master.md` — component list | 1h |
| Re-run security audit on modified routes | 3h |
| Final git tag: `v-cleanup-phase-1` | 0.5h |

**Month 3 (Weeks 11–12) total: ~12.5 hours**

---

### Roadmap Summary

| Month | Weeks | Focus | Est. Hours | Pages Removed/Merged |
|-------|-------|-------|-----------|----------------------|
| Month 1 | 1–2 | Security fixes + Quick wins | ~11.5h | 3 |
| Month 1 | 3–4 | PACS consolidation | ~11.5h | 4 |
| Month 2 | 5–6 | Report generator consolidation | ~14h | 3 |
| Month 2 | 7–8 | Nav & UX cleanup | ~33h | ~15 → ~5 |
| Month 3 | 9–10 | Performance & MWL infrastructure | ~35h | 1 (RadiologyLegacy) |
| Month 3 | 11–12 | Final sweep & docs | ~12.5h | — |
| **TOTAL** | | | **~118 hours** | **~25 pages cleaned** |

> **Expected outcome after 3 months:**
> - Pages: 148 → ~115 (23% reduction)
> - Critical security issues: 3 open → 0
> - Report generators: 3 → 1 (RadiologyReportingWorkspace)
> - PACS pages: 8 → 4 (Dashboard, Settings, DicomQR, Logs)
> - Alert pages: 3 → 1
> - AI analytics pages: 4 → 2
> - MWL: working (if SCP deployed)
> - DIMSE pull agent: enabled

---

*Document generated: 2026-06-24*
*Based on code audit at commit: 5b3a0d6*
*Next review recommended: After Month 1 completion*
