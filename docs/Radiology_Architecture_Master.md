# Radiology Architecture Master
> **Version**: 2026-06-24 | **Status**: Audit Document | **DO NOT IMPLEMENT — DOCUMENT ONLY**
> **Prepared by**: Antigravity AI | **Checkpoint**: `a5fc75e` (pre-audit stash retained)

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Component Inventory](#2-component-inventory)
3. [Detailed Component Audit](#3-detailed-component-audit)
   - [Worklist Hub](#31-worklist-hub)
   - [Command Center](#32-command-center)
   - [Reporting Workspace](#33-reporting-workspace)
   - [AI Draft Engine](#34-ai-draft-engine)
   - [Findings Library (Chocolate Box)](#35-findings-library-chocolate-box)
   - [Normal Templates / Snippets](#36-normal-templates--snippets)
   - [Structured Templates & Macros](#37-structured-templates--macros)
   - [Measurements](#38-measurements)
   - [Favorites](#39-favorites)
   - [OHIF Web Viewer](#310-ohif-web-viewer)
   - [Weasis Native Viewer](#311-weasis-native-viewer)
   - [Orthanc PACS](#312-orthanc-pacs)
   - [Conquest PACS](#313-conquest-pacs)
   - [MWL (Modality Worklist)](#314-mwl-modality-worklist)
   - [DICOM Puller / Auto-Ingest](#315-dicom-puller--auto-ingest)
   - [PACS Settings](#316-pacs-settings)
4. [Duplicate Functionality Map](#4-duplicate-functionality-map)
5. [Legacy & Unused Components](#5-legacy--unused-components)
6. [Hidden Functionality](#6-hidden-functionality)
7. [Components Not Integrated into Command Center](#7-components-not-integrated-into-command-center)
8. [Problems Summary](#8-problems-summary)
9. [Consolidation Opportunities](#9-consolidation-opportunities)
10. [Recommended Next Enhancements](#10-recommended-next-enhancements)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CARE DIAGNOSTICS RADIOLOGY SYSTEM                │
│                         (Synology NAS / LAN)                        │
├──────────────┬──────────────┬─────────────────┬─────────────────────┤
│   Modalities │ Conquest PACS│  Orthanc PACS   │  OHIF Viewer        │
│  (CT/MR/US)  │ (C-STORE SCP)│  care-pacs      │  :3010              │
│              │  Legacy Hook │  :8042 PRIMARY  │  DICOMweb            │
│  172.16.x.x  │  Lua notify  │  192.168.1.137  │  192.168.1.137      │
└──────┬───────┴──────┬───────┴────────┬────────┴──────────┬──────────┘
       │ C-STORE       │ Lua HTTP POST  │ REST/DICOMweb     │ OHIF URL
       │              ▼                ▼                   │
       │    ┌──────────────────────────────────────────────┘
       │    │         CARE ERP API SERVER                  │
       │    │         care-api container :8080             │
       │    │                                              │
       │    │  /api/internal/radiology/studies (intake)    │
       │    │  /api/radiology/*                            │
       │    │  /api/pacs/*   (Orthanc proxy)               │
       │    │  /api/dicom/*  (node management)             │
       │    │  /api/radiology/workflow/*                   │
       │    │  /api/radiology/smart-findings/*             │
       │    │  /api/radiology/snippets/*                   │
       │    │  /api/radiology/ollama/*                     │
       │    │  /api/radiology/copilot/*                    │
       │    └──────────────────────┬───────────────────────┘
       │                           │
       │                    PostgreSQL DB
       │                    care-db :5432
       │
       └──▶ (future) Direct C-STORE receive by ERP dimse-agent.ts
```

### Key Facts
- **Primary PACS**: Orthanc (`care-pacs`, `192.168.1.137:8042`) — **now activated** (`PACS_PROVIDER=orthanc`)
- **Legacy PACS**: Conquest PACS — Lua hook still active, feeds worklist via `/api/internal/radiology/studies`
- **Primary Viewer**: OHIF at `http://192.168.1.137:3010` — **now activated** (`PACS_VIEWER_TYPE=ohif`)
- **Fallback Viewer**: Weasis — native Windows launcher via `weasis://` protocol
- **AI**: Gemini AI (cloud) + Ollama (local, optional)
- **Network**: All LAN, Synology-hosted, no cloud PACS dependency

---

## 2. Component Inventory

| # | Component | Location | Lines | Status | In Sidebar? | In Command Center? |
|---|-----------|----------|-------|--------|-------------|---------------------|
| 1 | **Radiology Hub** | `pages/Radiology.tsx` | 366 | Active — launcher/directory | ✅ | n/a |
| 2 | **Radiology Worklist Hub** | `pages/RadiologyWorklist.tsx` | 946 | Active — primary daily view | ✅ | Partial |
| 3 | **Radiology Command Center** | `pages/RadiologyCommandCenter.tsx` | 1,896 | Active — **recommended** | ✅ | Self |
| 4 | **Reporting Workspace** | `pages/RadiologyReportingWorkspace.tsx` | 1,459 | Active (future label) | ❌ hidden | ❌ |
| 5 | **Unified Report Editor** | `pages/RadiologyReportUnified.tsx` | 2,294 | Active — most feature-rich | ❌ hidden | ❌ |
| 6 | **Legacy Report Editor** | `pages/RadiologyLegacy.tsx` | 1,479 | Legacy — still in use | Deprecated label | ❌ |
| 7 | **Standalone Report Editor** | `pages/RadiologyReportEditor.tsx` | 505 | Minimal, standalone | ❌ | ❌ |
| 8 | **PACS Viewer (OHIF/Weasis)** | `pages/PACS.tsx` | 456 | Active | ✅ | Linked |
| 9 | **PACS Settings** | `pages/PacsSettings.tsx` | 1,337 | Active — admin config | ✅ owner | ❌ |
| 10 | **DICOM Nodes** | `pages/DicomNodes.tsx` | 973 | Active — node registry | ✅ owner | ❌ |
| 11 | **DICOM Query/Retrieve** | `pages/DicomQueryRetrieve.tsx` | 1,584 | Active | ✅ | ❌ |
| 12 | **MWL Dashboard** | `pages/MwlDashboard.tsx` | 311 | Active | ✅ | ❌ |
| 13 | **MWL Manager** | `pages/MwlManager.tsx` | ? | Active — secondary view | ❌ hidden | ❌ |
| 14 | **DICOM Agent Dashboard** | `pages/DicomAgentDashboard.tsx` | ? | Active | ✅ owner | ❌ |
| 15 | **DICOM Study Worklist** | `pages/DicomStudyWorklist.tsx` | 254 | Partial/hidden | ❌ | ❌ |
| 16 | **Normal Templates** | `pages/NormalReportTemplates.tsx` | 285 | Active | ✅ | Linked |
| 17 | **Hanging Protocols** | `pages/HangingProtocols.tsx` | 168 | Minimal stub | ❌ | ❌ |
| 18 | **PACS Dashboard** | `pages/PacsDashboard.tsx` | ? | Active | ❌ hidden | ❌ |
| 19 | **PACS Logs** | `pages/PacsLogs.tsx` | ? | Active | ❌ hidden | ❌ |
| 20 | **PACS Archive Lifecycle** | `pages/PacsArchiveLifecycle.tsx` | ? | Experimental | ❌ | ❌ |
| 21 | **PACS Watchdog** | `pages/PacsWatchdogDashboard.tsx` | ? | Active monitoring | ✅ owner | ❌ |
| 22 | **Radiologist Queue** | `pages/RadiologistQueue.tsx` | ? | Active | ❌ hidden | ❌ |
| 23 | **Advanced Tools** | `pages/RadiologyAdvancedTools.tsx` | 668 | Admin directory page | ✅ owner | ❌ |
| 24 | **Radiology Settings** | `pages/RadiologySettings.tsx` | ? | Active | ✅ | ❌ |
| 25 | **Teaching Files** | `pages/TeachingFiles.tsx` + 7 sub-pages | ~1,500+ | Active (7 pages) | ✅ | ❌ |
| 26 | **Teleradiology Portal** | `pages/TeleradiologyPortal.tsx` | ? | Active | ✅ | ❌ |
| 27 | **USG Worklist** | `pages/UsgWorklist.tsx` | ? | Active | ❌ hidden | ❌ |
| 28 | **Chocolate Box Panel** | `components/ChocolateBoxPanel.tsx` | ? | Active — findings library | In CC | ❌ standalone |
| 29 | **Smart Findings Panel** | `components/RadiologySmartFindingsPanel.tsx` | ? | Active | In Unified | ❌ |
| 30 | **AI Copilot Panel** | `components/RadiologyAICopilotPanel.tsx` | ? | Active | In Unified | ❌ |
| 31 | **Radiology Copilot Panel** | `components/RadiologyCopilotPanel.tsx` | ? | **DUPLICATE** of above | In Workspace | ❌ |
| 32 | **Memory Panel** | `components/RadiologyMemoryPanel.tsx` | ? | Active | In Workspace | ❌ |
| 33 | **Knowledge Panel** | `components/RadiologyKnowledgePanel.tsx` | ? | Active | In Unified | ❌ |
| 34 | **Productivity Panel** | `components/RadiologyProductivityPanel.tsx` | ? | Active | In Unified | ❌ |
| 35 | **Measurement Panel** | `components/MeasurementAssistantPanel.tsx` | ? | Active | In Workspace | ❌ |
| 36 | **Spinal Measurement Panel** | `components/SpinalMeasurementPanel.tsx` | ? | Active, specialized | ❌ | ❌ |
| 37 | **Embedded WADO Viewer** | `components/EmbeddedWadoViewer.tsx` | ? | Active — in-app iframe | In CC + Workspace | ❌ |
| 38 | **Voice Dictation Button** | `components/VoiceDictationButton.tsx` | ? | Active — speech-to-text | In CC + Workspace | ✅ |
| 39 | **Command Center (old)** | `pages/CommandCenter.tsx` | 57 | Legacy stats widget | ❌ | Self |

---

## 3. Detailed Component Audit

### 3.1 Worklist Hub
**Path**: `/radiology/worklist` → `RadiologyWorklist.tsx` (946 lines)

**Current State**:
- Full PACS worklist with tabs: Active Studies, MWL Panel, DICOM Worklist
- Columns: patient, modality, date, accession, status, AI draft status, lock status, delivery status
- Actions: Claim, Unclaim, Open Viewer (OHIF/Weasis), Open Report, AI Draft trigger
- Has `MwlPanel` embedded from `MwlDashboard.tsx`
- Has study locking: `lockUserId`, `lockUserName`, `lockTime`, `lockWorkstation`
- Filter: modality, status, search, date range
- Source: feeds from `radiology_worklist` table (populated by Conquest Lua hook + direct registration)

**Problems**:
- Duplicate `WorklistEntry` type defined in 4 separate files: `RadiologyCommandCenter.tsx`, `RadiologyWorklist.tsx`, `RadiologyLegacy.tsx`, `RadiologyReportEditor.tsx`
- No link to Reporting Workspace or Unified Report from the worklist row — navigates to legacy editor
- "Open Command Center" and "Open Worklist" are competing entry points to the same data

---

### 3.2 Command Center
**Path**: `/radiology/command-center` → `RadiologyCommandCenter.tsx` (1,896 lines)

**Current State** — The recommended single-screen workstation. Contains:
- **Left panel**: Worklist list with claim/unclaim, status, AI draft indicator
- **Center panel**: Report editor (findings + impression + technique textarea)
- **Right panel tabs**:
  - Chocolate Box (findings library)
  - Structured Templates
  - Personal Macros
  - Normal Snippets
  - Voice Dictation button
  - Embedded WADO Viewer (iframe)
  - Smart Engine builder (deterministic AI-free structured report)
- AI Draft: fetch from `/api/radiology/pacs-worklist/:id/ai-draft`
- Viewer launch: `launchViewer()` via `viewerService.ts` (OHIF or Weasis)
- Study locking: implemented
- Share link: via `/api/radiology/:id/share-link`

**Problems**:
- 1,896 lines — **monolithic, difficult to maintain**
- Re-implements much of what `RadiologyReportUnified.tsx` and `RadiologyReportingWorkspace.tsx` already do
- Smart Engine (deterministic builder) only available here; not in Unified or Workspace
- Missing: Measurements, Knowledge Panel, Productivity Panel, AI Copilot Panel (these exist only in `RadiologyReportUnified.tsx`)
- MWL panel NOT integrated — user must switch pages
- PACS Watchdog NOT integrated
- No AI consistency check, no prior study comparison (available in Unified only)

---

### 3.3 Reporting Workspace
**Path**: `/radiology/reporting-workspace` → `RadiologyReportingWorkspace.tsx` (1,459 lines)

**Current State**:
- Labeled "Future" in the Advanced Tools catalog
- Contains: Embedded WADO Viewer, RadiologyCopilotPanel, RadiologyMemoryPanel, MeasurementAssistantPanel
- Full report editor: technique, findings, impression, advice sections
- Structured template support with macros (checklist-style)
- AI draft trigger
- Routing: accessible at `/radiology/reporting-workspace/:studyId`

**Problems**:
- Marked as "Future" but fully functional — **confusing status**
- NOT linked from the main sidebar
- NOT linked from Command Center
- Has `RadiologyCopilotPanel` which is a **duplicate** of `RadiologyAICopilotPanel` used in Unified
- Misses: Chocolate Box, Smart Engine, Normal Snippets, Productivity Panel
- The most isolated of the three reporting surfaces

---

### 3.4 AI Draft Engine
**Backend**: `POST /api/radiology/pacs-worklist/:id/ai-draft` (in `radiology.ts`)
**Frontend**: Called from `RadiologyCommandCenter.tsx` + `RadiologyWorklist.tsx`

**Current State**:
- Generates AI draft using Gemini AI from DICOM metadata (modality, description, patient info)
- Draft stored as JSON in `radiology_worklist.ai_draft_json`
- Status tracked: `NONE → PENDING → DONE → ERROR`
- Feedback: thumbs up/down via `POST /api/radiology/pacs-worklist/:id/ai-feedback`

**Second AI path**: `radiologyOllama.ts` — local Ollama integration
- Endpoints: `/findings`, `/impression`, `/multi-review`, `/differential`
- Separate from the main Gemini draft system

**Problems**:
- Two parallel AI draft systems: **Gemini (cloud)** vs **Ollama (local)** — no unified interface
- AI draft only triggered from Worklist or Command Center — **not available in Unified Report editor**
- `RadiologyAICopilotPanel` (in Unified) is a third AI surface — calls `radiologyCopilot.ts` endpoints
- `RadiologyCopilotPanel` (in Workspace) is a fourth AI surface — likely overlaps with AICopilotPanel
- No single "AI hub" — AI is scattered across 4 systems with no consolidation

---

### 3.5 Findings Library (Chocolate Box)
**Component**: `ChocolateBoxPanel.tsx`
**Backend**: `radiologySmartFindings.ts` → tables: `radiology_smart_findings`, `radiology_impression_rules`, `radiology_favorite_finding_sets`, `radiology_smart_usage`, `radiology_smart_findings_audit`

**Current State**:
- Modality + body part filtered finding cards
- Each finding: `shortName`, `findingText`, `impressionText`, `isCritical`
- Favorites: per-user favorite finding IDs + custom findings (stored as JSON)
- Admin: CRUD of findings, mark as critical
- Usage analytics: `radiology_smart_usage` table tracks insertions
- Audit log: `radiology_smart_findings_audit` tracks admin edits

**Where it appears**:
- ✅ `RadiologyCommandCenter.tsx` — Right panel tab
- ❌ `RadiologyReportingWorkspace.tsx` — NOT present
- ❌ `RadiologyReportUnified.tsx` — Has `RadiologySmartFindingsPanel` instead (different component)

**Problems**:
- `ChocolateBoxPanel` ≠ `RadiologySmartFindingsPanel` — **two different findings library components** doing the same job
- No global entry point — can't access/manage findings outside of a report session
- Favorites stored as `favoriteFindingIds` JSON string — brittle serialization

---

### 3.6 Normal Templates / Snippets
**Backend**: 
- `radiologySnippets.ts` → `radiology_snippets` table (unified: quick_add, smart_format, favorite, macro, normal_template)
- `radiology.ts` → `GET /api/radiology/templates/:testId` (legacy path)
**Pages**:
- `NormalReportTemplates.tsx` — dedicated management page
- `RadiologyCommandCenter.tsx` — Normal Snippets tab (inline mini-management)

**Current State**:
- `radiology_snippets` table is the **unified** store for: quick_add, smart_format, favorite, macro, normal_template
- `NormalReportTemplates.tsx` manages a separate `report_templates` table (older schema)
- Command Center fetches snippets from `/api/radiology/snippets?type=normal_template`
- NormalReportTemplates page fetches from `/api/radiology/normal-templates` (separate endpoint/table)

**Problems**:
- **Two snippet systems in parallel**: `radiology_snippets` (new) vs `report_templates` (old)
- `NormalReportTemplates.tsx` does NOT use the new `radiologySnippets` router
- A snippet created in the Normal Templates page is NOT visible in Command Center
- Technique field only in some templates — inconsistent schema

---

### 3.7 Structured Templates & Macros
**Backend**: 
- `GET/POST /api/radiology/structured-report-templates` (in `radiology.ts`)
- Table: `structured_report_templates`
**Pages**:
- `/radiology/structured-report-templates` → `ReportTemplatesPage` (lazy import in App.tsx)
- `RadiologyCommandCenter.tsx` — Templates tab loads from same endpoint
- `RadiologyReportingWorkspace.tsx` — Also loads structured templates

**Current State**:
- Each template has: `templateName`, `modality`, `bodyPart`, `studyType`, `sectionsJson` (technique + findingsItems array), `macrosJson`, `defaultFindings`, `defaultImpression`
- Macros: key/label/text quick-insert items per template
- Personal macros: stored in user preferences JSON in `radiology_workflow` shortcuts table
- Workflow macros: `GET /api/radiology/workflow/macros`

**Problems**:
- **Three macro systems**: template-level macros (`macrosJson`), personal macros (preferences JSON), workflow macros (`radiology_workflow`)
- Macros in Command Center = personal preferences JSON; macros in Workspace = template-level JSON
- No cross-session macro editor — macros edited per-template, no global macro library page
- `HangingProtocols.tsx` (168 lines) is a stub — DICOM hanging protocols not actually implemented

---

### 3.8 Measurements
**Backend**: `radiologyCopilot.ts`
- `GET /api/radiology/copilot/measurements/:studyId`
- `POST /api/radiology/copilot/measurements`
**Components**:
- `MeasurementAssistantPanel.tsx` — in Reporting Workspace
- `SpinalMeasurementPanel.tsx` — specialized for spine
- `RadiologyMeasurementLibrary.ts` (client lib) — reference measurement templates

**Current State**:
- Manual measurement entry: organ, measurement name, value, unit, reference range
- Stored in `radiology_measurements` table (via copilot endpoint)
- Reference library in `RadiologyMeasurementLibrary.ts` — static data, ~100+ measurements across CT/MR/US/Echo
- `SpinalMeasurementPanel.tsx` handles Cobbs angle, vertebral height, disc space — fully specialized

**Problems**:
- Measurements panel **only in Reporting Workspace** — NOT in Command Center (most used page)
- Measurements **not injected into report text** automatically — user must copy-paste values
- No DICOM SR (Structured Report) output from measurements
- `SpinalMeasurementPanel.tsx` accessible from where? Not linked in sidebar or Command Center

---

### 3.9 Favorites
**Two separate favorites systems**:

| System | Location | Backend | Scope |
|--------|----------|---------|-------|
| Finding Favorites | `ChocolateBoxPanel` → `user_preferences.favoriteFindingIds` | Smart Findings API | Findings library |
| Template Favorites (starred) | `RadiologyCommandCenter` → localStorage `starred_templates` | None — localStorage only | Templates |
| Teaching Favorites | `pages/TeachingFavorites.tsx` | `teachingCases.ts` | Teaching cases |

**Problems**:
- Template favorites stored in **localStorage only** — lost on browser clear, not synced across devices
- Finding favorites stored in DB but as a raw JSON ID array — not named sets
- No unified favorites/bookmarks system
- Teaching Favorites is a separate completely independent system

---

### 3.10 OHIF Web Viewer
**Config**: `lib/viewerService.ts` → `getOhifUrl()`
**Launch**: `launchViewer()` → opens `OHIF_URL/viewer?StudyInstanceUIDs={uid}` in new tab
**Hardcoded fallback**: `http://192.168.1.137:3010` in `viewerService.ts`
**Settings source**: `pacs_settings` table key `ohif_base_url`

**Current State**:
- Zero-footprint web viewer — runs in browser, no installation
- Template: `{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}`
- Custom template support: `ohif_study_url_template` setting
- Embedded mode: `EmbeddedWadoViewer.tsx` — iframe-based inline viewer inside ERP

**Where it appears**:
- `PACS.tsx` — standalone viewer launch page
- `RadiologyCommandCenter.tsx` — embedded in right panel
- `RadiologyReportingWorkspace.tsx` — embedded via EmbeddedWadoViewer
- All "Open Viewer" buttons across worklist, report editors

**Problems**:
- `EmbeddedWadoViewer.tsx` loads OHIF in iframe — **may not work if Orthanc lacks CORS headers**
- OHIF_URL hardcoded fallback in `viewerService.ts` (`192.168.1.137:3010`) duplicates `.env` value
- No OHIF authentication configured — Orthanc's DICOMweb exposed without auth check in viewer
- Viewer URL sometimes built with double-encoded UID from `encodeURIComponent()` — potential URL error

---

### 3.11 Weasis Native Viewer
**Config**: `lib/viewerService.ts` → `getWeasisUrl()`
**Launch**: `weasis://$dicom:get -w {WADO_URL} -r studyUID={uid}`
**Settings source**: `pacs_settings` table key `weasis_manifest_url_template`, `wado_uri_base_url`

**Current State**:
- Protocol handler: requires Weasis installed on client Windows machine
- Used as fallback when OHIF unavailable
- Each worklist row has a precomputed `weasisUrl` column in DB (Conquest legacy)
- Backend launch route: `GET /api/pacs/enterprise/studies/:studyInstanceUID/weasis-launch`

**Problems**:
- On Synology-hosted ERP accessed via browser, Weasis requires **client-side installation** — doesn't work on tablets/phones
- `weasisUrl` column in `radiology_worklist` table pre-built by Conquest hook — becomes stale if PACS changes
- With Orthanc as primary, Weasis still uses Conquest-era WADO URL from DB — **broken until pacs_settings updated**
- Viewer type is a global setting — no per-study or per-user preference

---

### 3.12 Orthanc PACS
**Container**: `care-pacs` on Synology
**URLs**: `192.168.1.137:8042` (LAN) / `172.16.1.139:8042` (Docker alt)
**Provider**: `OrthancProvider` in `lib/pacs/providers.ts`
**DICOMweb**: `/dicom-web/` endpoint on Orthanc
**API routes**: `pacs.ts`, `pacsEnterprise.ts`, `dicom.ts`

**Current State**:
- Full REST API: `/studies`, `/patients`, `/instances`
- DICOMweb: WADO-RS, STOW-RS, QIDO-RS — all supported
- Capabilities: `studyArchive: true`, `teleradiologyShare: true`, `mwlPush: true`, `instanceMetadata: true`
- SSRF protection: `resolveAndCheckHost()` blocks private IP calls when `ALLOW_PRIVATE_IPS=false`
- Health check: `GET /api/pacs/provider` → hits `orthanc/system`
- Study browser: `PACS.tsx` → `GET /api/pacs/studies`
- MWL push: `POST /api/pacs/enterprise/mwl-procedures`
- Study archive (ZIP): `GET /api/pacs/enterprise/studies/:uid` download
- Weasis launch: `GET /api/pacs/enterprise/studies/:uid/weasis-launch`
- OHIF launch: `GET /api/pacs/enterprise/studies/:uid/ohif-launch`

**Problems**:
- `ORTHANC_PASSWORD` is blank in `.env` — Orthanc auth may fail if password is required
- `resolveAndCheckHost()` blocks LAN IPs in prod unless `ALLOW_PRIVATE_IPS=true` (already set)
- Conquest Lua hook still writes to `radiology_worklist` → worklist now has studies from both systems; no deduplication on StudyInstanceUID
- MWL push to Orthanc via REST is implemented but **not tested in production**

---

### 3.13 Conquest PACS
**Integration**: `conquest/erp_notify.lua` (on Conquest Windows machine)
**Hook**: Every DICOM store → Lua HTTP POST → `/api/internal/radiology/studies`
**Provider**: `ConquestProvider` in `lib/pacs/providers.ts`
**Capabilities**: `studyArchive: false`, `teleradiologyShare: false`, `mwlPush: false`

**Current State**:
- Acts as C-STORE SCP — receives images from all modalities
- Lua script posts: `studyInstanceUID`, `accessionNumber`, `patientName`, `modality`, `studyDate`, `studyDescription`, `sourceAeTitle`, `ipAddress`
- ERP endpoint: `POST /api/internal/radiology/studies` (in `internal-radiology.ts`) — upsert into `radiology_worklist`
- Legacy endpoint: `GET /api/radiology/conquest-status` — still active, checks Conquest via HTTP
- Conquest CGI: `http://<conquest-ip>:5678/cgi-bin/dgate?requesttype=requeststudy`

**Problems**:
- Conquest now acts as **study intake relay** only — images actually stored in Orthanc (future)
- If Conquest is on a different Windows machine than Orthanc, images are stored in **two PACSes** — risk of split storage
- `weasisUrl` prebuilt by Conquest Lua hook points to Conquest WADO — broken now that Orthanc is primary
- C-FIND/C-MOVE from Conquest not going through Orthanc — the two PACSes are not peered
- No DICOM routing (C-MOVE from Conquest → Orthanc) configured

---

### 3.14 MWL (Modality Worklist)
**Pages**: `MwlDashboard.tsx` (311 lines), `MwlManager.tsx` (hidden)
**Backend**: `radiologyWorkflow.ts`
- `GET /api/radiology/workflow/mwl`
- `POST /api/radiology/workflow/mwl`
- `PATCH /api/radiology/workflow/mwl/:id/status`
- `POST /api/radiology/workflow/mwl/:id/resend`

**Also**: `pacsEnterprise.ts`
- `GET /api/pacs/enterprise/mwl-procedures`
- `POST /api/pacs/enterprise/mwl-procedures`
- `PATCH /api/pacs/enterprise/mwl-procedures/:id`

**Current State**:
- `MwlPanel` embedded in `RadiologyWorklist.tsx` — inline view
- `MwlDashboard.tsx` — full management page at `/radiology/mwl-dashboard`
- Procedures statuses: `SCHEDULED → SENT_TO_MWL → COMPLETED / CANCELLED`
- Created automatically when billing order placed for radiology test (via `radiologyScheduledProcedures` table)
- Push to Orthanc MWL: REST endpoint (not Conquest file-based)

**Problems**:
- **Two MWL endpoint families**: `workflow/mwl` vs `pacs/enterprise/mwl-procedures` — likely store to same table but called from different places
- `MwlManager.tsx` exists but is not wired in sidebar — **hidden duplicate** of `MwlDashboard.tsx`
- Modality machines receive MWL via DICOM C-FIND SCU — but ERP has no embedded DICOM MWL SCP
- MWL push works only when Orthanc is configured as provider — with Conquest, `mwlPush: false`

---

### 3.15 DICOM Puller / Auto-Ingest
**Backend**: `lib/dimse-agent.ts` (in-process DICOM pull agent)
**Management**: `DicomAgentDashboard.tsx`, `DicomNodes.tsx`
**Legacy**: `dicom-pull-agent--LEGACY-RETIRED/` — retired external agent

**Current State**:
- `dimse-agent.ts`: scheduled job, polls configured DICOM nodes, performs C-FIND then C-MOVE
- Nodes configured via `dicom_nodes` table (`DicomNodes.tsx` → `CRUD on /api/dicom/nodes`)
- Pull logs: `dicom_pull_agent_logs`, `dicom_pull_agent_status` tables
- Dashboard: `DicomAgentDashboard.tsx` shows last heartbeat, log entries, failed pulls
- Per-node: `auto_pull`, `pull_interval_seconds`, `query_lookback_hours`, `preferred_retrieve_method`
- `DicomQueryRetrieve.tsx` (1,584 lines) — manual C-FIND/C-MOVE query UI

**Connectivity at modality level** (from DB seed):
```
GE Voluson USG → 172.16.1.46:104 (C-STORE + watch folder + USB auto-import)
```

**Problems**:
- C-MOVE destination is configured per-node as `destination_pacs` = `CONQUEST` — still targets Conquest
- With Orthanc as primary, the C-MOVE destination should be Orthanc's AET, not Conquest's
- `dimse-agent.ts` requires `dcmtk` or `dcm4che` tools on the system path — no pure JS DICOM library
- Failed queue: `pacsEnterprise.ts` → `GET /api/pacs/enterprise/failed-queue` — separate from dimse-agent logs
- Watch folder: `watch_folder_path` on Voluson node — requires filesystem access from container

---

### 3.16 PACS Settings
**Path**: `/radiology/pacs-settings` → `PacsSettings.tsx` (1,337 lines)

**Current State**:
- 5 setting categories: `general`, `conquest`, `mwl`, `delivery`, `notification`
- Modality registry: CRUD for `dicom_modalities` (machines + their AET/IP/port)
- MWL field config: AE title, host, port
- Priority rules: auto-assign priority based on modality/description
- Assignment rules: auto-assign radiologist based on modality

**OHIF setting key**: `ohif_base_url` → read by `viewerService.ts`
**Conquest setting keys**: `conquest_ae_title`, `conquest_host`, `conquest_port`

**Problems**:
- PACS Settings page has MWL config AND modality management AND priority rules AND assignment rules — **way too large**
- No Orthanc-specific settings UI — Orthanc URL/credentials only configurable via `.env`, not from ERP UI
- `conquest_*` settings still in `pacs_settings` table but Conquest is now secondary — **stale config section**
- OHIF URL in `pacs_settings` (`ohif_base_url`) and in `.env` (`OHIF_URL`) — two sources of truth
- C-ECHO test from UI (`pacsEnterprise.ts → /modalities/:id/echo-test`) may not work with Orthanc as primary

---

## 4. Duplicate Functionality Map

| Functionality | Instance 1 | Instance 2 | Instance 3 | Status |
|---|---|---|---|---|
| **Report Editor** | `RadiologyCommandCenter.tsx` | `RadiologyReportUnified.tsx` (2,294 ln) | `RadiologyReportingWorkspace.tsx` (1,459 ln) + `RadiologyLegacy.tsx` (1,479 ln) | 4 active editors |
| **Worklist type def** | `RadiologyCommandCenter.tsx` | `RadiologyWorklist.tsx` | `RadiologyLegacy.tsx` + `RadiologyReportEditor.tsx` | 4 identical TypeScript types |
| **AI Copilot panel** | `RadiologyAICopilotPanel.tsx` (in Unified) | `RadiologyCopilotPanel.tsx` (in Workspace) | `radiologyCopilot.ts` + `radiologyOllama.ts` | 2 panel components, 2 backend routes |
| **Findings library** | `ChocolateBoxPanel.tsx` | `RadiologySmartFindingsPanel.tsx` | — | 2 components, 1 backend |
| **Normal snippets** | `NormalReportTemplates.tsx` → `report_templates` table | `radiologySnippets.ts` → `radiology_snippets` table | — | 2 tables, 2 routes |
| **Macros** | Template-level macros (`macrosJson`) | Personal macros (preferences JSON) | Workflow macros (`/workflow/macros`) | 3 macro systems |
| **MWL management** | `MwlDashboard.tsx` | `MwlManager.tsx` (hidden) | MWL Panel embedded in `RadiologyWorklist.tsx` | 3 surfaces |
| **MWL API** | `/api/radiology/workflow/mwl` | `/api/pacs/enterprise/mwl-procedures` | — | 2 route families |
| **Favorites** | Finding favorites (DB) | Template favorites (localStorage) | Teaching Favorites (separate system) | 3 unrelated systems |
| **PACS viewer launch** | `launchViewer()` in viewerService | `weasisUrl` prebuilt in DB | Backend launch routes in `pacsEnterprise.ts` | 3 launch paths |
| **Command Center** | `RadiologyCommandCenter.tsx` (1,896 ln) | `CommandCenter.tsx` (57 ln, stats only) | — | Name collision |

---

## 5. Legacy & Unused Components

| Component | Location | Why Legacy | Recommended Action |
|-----------|----------|------------|-------------------|
| `RadiologyLegacy.tsx` | `pages/RadiologyLegacy.tsx` | 1,479 ln — superseded by Command Center | Retire — redirect to Command Center |
| `CommandCenter.tsx` | `pages/CommandCenter.tsx` | 57 ln stats widget — no longer the main CC | Rename to `RadiologyStatsWidget` or delete |
| `RadiologyReportEditor.tsx` | `pages/RadiologyReportEditor.tsx` | 505 ln standalone — superseded | Retire — remove route |
| `DicomStudyWorklist.tsx` | `pages/DicomStudyWorklist.tsx` | 254 ln — overlaps `DicomQueryRetrieve.tsx` | Review — possibly merge |
| `HangingProtocols.tsx` | `pages/HangingProtocols.tsx` | 168 ln stub — not functional | Implement or remove |
| `conquest/erp_notify.lua` | `conquest/erp_notify.lua` | Active but Conquest is now secondary | Keep as fallback, document clearly |
| `dicom-pull-agent--LEGACY-RETIRED/` | Repo root | Explicitly retired | Already retired — keep folder as historical reference |
| `weasisUrl` in worklist DB | `radiology_worklist.weasis_url` column | Prebuilt by Conquest, broken with Orthanc | Rebuild dynamically from `viewerService.ts` |

---

## 6. Hidden Functionality

Pages that exist, are fully functional, but are **not accessible from sidebar navigation**:

| Page | Route | Discovery Path |
|------|-------|---------------|
| `RadiologyReportingWorkspace` | `/radiology/reporting-workspace` | Only via Advanced Tools (labeled "Future") |
| `RadiologyReportUnified` | `/radiology/unified-report/:id` | Only via worklist row click (sometimes) |
| `PacsDashboard` | `/radiology/pacs-dashboard` | Advanced Tools only |
| `PacsLogs` | `/radiology/pacs-logs` | Advanced Tools only |
| `PacsArchiveLifecycle` | (route exists) | No sidebar entry |
| `RadiologistQueue` | `/radiology/radiologist-queue` | No sidebar entry |
| `MwlManager` | (no route in App.tsx found) | Completely unreachable |
| `UsgWorklist` | `/radiology/usg-worklist` | Not in sidebar |
| `RadiologyProductivity` | `/radiology/productivity` | Advanced Tools only |
| `DicomStudyWorklist` | `/radiology/dicom-study-worklist` | Not in sidebar |
| `SpinalMeasurementPanel` | Component only | No standalone route |
| Teaching sub-pages (7) | `/teaching-*` | Sidebar: "Teaching Files" links to root only |
| AI pages (8+) | `/radiology/ai-*` | Advanced Tools + Settings only |

---

## 7. Components Not Integrated into Command Center

The Command Center (`RadiologyCommandCenter.tsx`) is the **recommended daily workflow page** but is missing:

| Feature | Where it Exists | Not in CC? |
|---------|----------------|------------|
| **Measurements panel** | `RadiologyReportingWorkspace.tsx` | ❌ Not in CC |
| **AI Copilot panel** | `RadiologyReportUnified.tsx` | ❌ Not in CC (has AI draft only) |
| **Knowledge Panel** | `RadiologyReportUnified.tsx` | ❌ Not in CC |
| **Productivity Panel** | `RadiologyReportUnified.tsx` | ❌ Not in CC |
| **Memory Panel** | `RadiologyReportingWorkspace.tsx` | ❌ Not in CC |
| **Smart Findings Panel** | `RadiologyReportUnified.tsx` | ❌ Not in CC (has ChocolateBox only) |
| **Spinal Measurement Panel** | Component only | ❌ No route, no CC |
| **Prior Study Comparison** | `radiologyCopilot.ts` backend | ❌ Not surfaced in CC |
| **Quality Gates check** | `radiologyIntelligenceEngine.ts` | ❌ Only in Unified |
| **Critical Finding detector** | `radiologyReportAssembler.ts` | ❌ Only in Unified |
| **MWL Panel** | Embedded in `RadiologyWorklist.tsx` | ❌ Not in CC |
| **DICOM QR** | `DicomQueryRetrieve.tsx` | ❌ Separate page |
| **Peer Review** | Backend exists | ❌ No CC surface |
| **TAT Tracker** | `lib/tatTracker.ts` | ❌ No CC surface |

---

## 8. Problems Summary

### 🔴 Critical
1. **4 parallel report editors** — `CommandCenter`, `ReportUnified`, `ReportingWorkspace`, `Legacy` — all active, all incomplete in different ways. Users don't know which to use.
2. **Conquest → Orthanc migration incomplete** — images may be split between both PACSes. C-MOVE destination in DICOM nodes still targets Conquest. `weasisUrl` in worklist DB is stale.
3. **ORTHANC_PASSWORD blank** — if Orthanc has auth enabled, all API calls will fail silently.
4. **Two findings library components** — `ChocolateBoxPanel` vs `RadiologySmartFindingsPanel` — different data, different UI, same purpose.
5. **Two normal template systems** — `report_templates` table (old) vs `radiology_snippets` table (new) — snippets created in one don't appear in the other.

### 🟠 High
6. **Template favorites in localStorage** — lost on clear, not synced across devices (tablets, other browsers).
7. **3 macro systems** — template macros, personal macros (preferences JSON), workflow macros — no unified editor.
8. **AI fragmented across 4 paths** — Gemini draft, Ollama local, AICopilotPanel, RadiologyCopilotPanel — no unified AI hub.
9. **MWL: 2 API families + 3 UI surfaces** — MWL push to Orthanc untested in production.
10. **OHIF URL hardcoded fallback** in `viewerService.ts` — should read only from `pacs_settings` DB.
11. **`HangingProtocols.tsx` is a non-functional stub** — appears as a menu item leading nowhere useful.

### 🟡 Medium
12. **Measurements panel missing from Command Center** — radiologists who use measurements must switch pages mid-report.
13. **Prior study comparison** — backend implemented (`/api/radiology/copilot/prior-studies`), not surfaced in Command Center.
14. **Teaching sub-system has 7 pages** but only the root is in the sidebar — 6 pages are hidden.
15. **`RadiologyReportingWorkspace` labeled "Future"** but is fully functional — needs status update.
16. **2 MWL route families** — `/workflow/mwl` and `/pacs/enterprise/mwl-procedures` — likely writing to same table.
17. **Quality check and critical finding detector** (`radiologyIntelligenceEngine.ts`) only in Unified — not in CC.

### 🟢 Low
18. **Duplicate `WorklistEntry` TypeScript type** defined in 4 files — should be extracted to shared type.
19. **`CommandCenter.tsx` (57 lines) name collision** with `RadiologyCommandCenter.tsx` (1,896 lines).
20. **`DicomStudyWorklist.tsx`** overlaps with `DicomQueryRetrieve.tsx` — two pages for same function.

---

## 9. Consolidation Opportunities

### A. Unify the Report Editor — Single Surface
Merge `RadiologyCommandCenter`, `RadiologyReportUnified`, `RadiologyReportingWorkspace` into one page:

```
Recommended: Expand RadiologyCommandCenter to include all panels currently in Unified:
  ├── Measurements tab (from MeasurementAssistantPanel)
  ├── AI Copilot tab (merge AICopilotPanel + RadiologyCopilotPanel into one)
  ├── Smart Findings tab (replace ChocolateBox with SmartFindingsPanel or vice versa)
  ├── Knowledge tab
  ├── Productivity tab
  └── Prior Studies comparison tab
Retire: RadiologyReportingWorkspace (label "Future", redirect to CC)
Retire: RadiologyLegacy (redirect to CC)
Retire: RadiologyReportEditor (redirect to CC)
```

### B. Unify the Template System
```
Migrate NormalReportTemplates data → radiology_snippets table (type: "normal_template")
Remove /api/radiology/normal-templates endpoint
Remove report_templates table
Single management UI for: quick_add, normal_template, smart_format, macro, favorite
```

### C. Unify Macros
```
One macro table: radiology_snippets (type: "macro")
Personal scope: staffId filter
Global scope: isGlobal flag
Template-level macros: reference macro IDs from the central table
Remove: macrosJson column from structured_report_templates
Remove: personalMacros from preferences JSON
Remove: /api/radiology/workflow/macros (merge into snippets)
```

### D. Unify Findings Library
```
Keep: ChocolateBoxPanel (better UX, modality+bodyPart filtering, per-user favorites)
Migrate: RadiologySmartFindingsPanel data → smart_findings table
Remove: RadiologySmartFindingsPanel (replace with ChocolateBoxPanel everywhere)
Add ChocolateBoxPanel to: RadiologyReportUnified, MeasurementAssistantPanel
```

### E. Consolidate MWL
```
Single endpoint: /api/radiology/workflow/mwl (keep this one)
Remove: /api/pacs/enterprise/mwl-procedures (or proxy to workflow/mwl)
Single UI: MwlDashboard.tsx (keep)
Remove: MwlManager.tsx (unreachable duplicate)
Add MWL tab to: RadiologyCommandCenter
```

### F. PACS Provider Migration Completion
```
1. Set ORTHANC_PASSWORD in .env (if Orthanc auth enabled)
2. Update DICOM nodes: destination_pacs from CONQUEST → ORTHANC
3. Build Weasis URLs dynamically from viewerService.ts, not from DB column
4. Peer Conquest → Orthanc: configure Conquest to C-MOVE to Orthanc (or retire Conquest C-STORE)
5. Expose Orthanc settings in PacsSettings UI (not just .env)
```

---

## 10. Recommended Next Enhancements

Listed by value/effort ratio (not ordered for implementation):

### High Value / Low Effort

**1. Add Measurements tab to Command Center**
- Move `MeasurementAssistantPanel` to be a tab in `RadiologyCommandCenter`
- No backend changes needed

**2. Fix template favorites — move from localStorage to DB**
- Add `starred_template_ids` to `user_preferences` table or `radiology_snippets` favorites
- Enables cross-device sync and persistence

**3. Add "Prior Studies" comparison button to Command Center**
- `GET /api/radiology/copilot/prior-studies?patientId=X` is already built
- Just needs a UI trigger in Command Center

**4. Fix OHIF hardcoded fallback URL**
- `viewerService.ts` should only read `pacs_settings.ohif_base_url`, not have a hardcoded IP

**5. Add ORTHANC_PASSWORD to .env**
- Needed only if Orthanc has auth enabled — quick operational fix

### High Value / Medium Effort

**6. Retire RadiologyLegacy — redirect to Command Center**
- Change `/radiology/legacy` route to redirect to `/radiology/command-center`
- Banner in Legacy page: "Use Command Center instead"

**7. Unify normal templates → radiology_snippets**
- Migration script + redirect `NormalReportTemplates.tsx` to snippets API

**8. Add Orthanc settings to PacsSettings UI**
- Fields: ORTHANC_URL, ORTHANC_USERNAME, ORTHANC_PASSWORD in a new "Orthanc" tab
- Reads/writes to `pacs_settings` table, reloads provider on save

**9. Update DICOM node C-MOVE destination to Orthanc**
- Change `destination_pacs` from `CONQUEST` to `ORTHANC` in `dicom_nodes` table
- Update dimse-agent.ts to use Orthanc AET as C-MOVE destination

**10. Quality Gate enforcement in Command Center**
- `runQualityCheck()` and `detectCriticalFindings()` from `radiologyIntelligenceEngine.ts` exist
- Wire into Command Center finalize button — show warnings before finalizing

### Medium Value / High Effort

**11. Merge 4 report editors into 1**
- Extract shared WorklistEntry type to `@workspace/types`
- Extend Command Center with all Unified Report panels
- Deprecate and redirect remaining editors

**12. Unified AI Hub in Command Center**
- Single AI panel with tabs: AI Draft (Gemini), Local AI (Ollama), Copilot (prior studies + consistency)
- Replace 4 separate AI surfaces with one consistent interface

**13. Unify macros — single macro library**
- Central `radiology_snippets` (type: macro) as the only macro store
- Personal vs global scope via `staffId` / `isGlobal`
- Global macro editor page

**14. Implement DICOM MWL SCP in-process**
- Currently ERP has no embedded MWL SCP — modalities can't C-FIND the ERP directly
- Needs `dimse-agent.ts` expansion or a DICOM library like `dicom-parser` + custom server

**15. CORS headers on Orthanc for embedded WADO viewer**
- `EmbeddedWadoViewer.tsx` iframe needs Orthanc CORS configured
- Add Orthanc CORS config: `AllowOrigin: "*"` or restrict to ERP domain

---

## Appendix: Database Tables (Radiology)

| Table | Purpose | Owner Module |
|-------|---------|-------------|
| `radiology_worklist` | Main study queue | Worklist Hub, Command Center |
| `radiology_reports` | Finalized report text + metadata | All report editors |
| `radiology_scheduled_procedures` | MWL source (from billing) | MWL Dashboard |
| `radiology_mwl_procedures` | MWL sent to modalities | MWL Dashboard |
| `radiology_smart_findings` | Chocolate Box findings library | ChocolateBoxPanel |
| `radiology_impression_rules` | Auto-impression rules | Smart Findings backend |
| `radiology_favorite_finding_sets` | Named finding sets | Smart Findings |
| `radiology_snippets` | Unified snippets/macros/templates | Snippets router |
| `report_templates` | OLD normal templates | NormalReportTemplates.tsx |
| `structured_report_templates` | Structured templates with macros | ReportTemplatesPage |
| `radiology_measurements` | Measurement records | Copilot → Measurement panel |
| `dicom_nodes` | DICOM node registry | DicomNodes.tsx |
| `dicom_modalities` | Machine registry | ModalityManagement |
| `dicom_pull_agent_logs` | Pull job history | DicomAgentDashboard |
| `dicom_pull_agent_status` | Agent heartbeat | DicomAgentDashboard |
| `pacs_settings` | Key-value PACS config | PacsSettings.tsx |
| `radiology_workflow_shortcuts` | Macros + viewer presets | Workflow router |
| `radiology_ai_review_audits` | AI feedback audit trail | AI routes |
| `radiology_annotations` | Image annotations | Annotations route |
| `radiology_share_links` | Teleradiology share tokens | Share link route |
| `teaching_cases` | Teaching file cases | Teaching sub-system |
| `critical_findings` | Critical finding records | Critical findings |
| `ai_voice_transcriptions` | Voice dictation logs | Voice dictation |
| `ris_monitoring` | RIS system metrics | risMonitoring.ts |

---

*End of Radiology Architecture Master — 2026-06-24*
*Next review recommended after: Orthanc migration completion + editor consolidation*
