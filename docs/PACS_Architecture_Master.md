# PACS_Architecture_Master.md
**Care Diagnostics ERP — PACS / Imaging Architecture**
*Audited: 2026-06-24 | Commit: e695884 (checkpoint before audit)*

---

## Table of Contents
1. [System Topology](#1-system-topology)
2. [Component Inventory](#2-component-inventory)
3. [Study Flow Diagram](#3-study-flow-diagram)
4. [Component Deep-Dive](#4-component-deep-dive)
5. [Wiring Map — API Routes ↔ Components](#5-wiring-map--api-routes--components)
6. [Broken Wiring](#6-broken-wiring)
7. [Duplicate Settings](#7-duplicate-settings)
8. [Legacy Configuration](#8-legacy-configuration)
9. [Unused Components](#9-unused-components)
10. [Recommendations](#10-recommendations)

---

## 1. System Topology

```
INTERNET
    │
    ▼
┌───────────────────────────────────────┐
│  Cloudflare Tunnel (cloudflared)      │
│  caredeoghar.com  → ERP :8888/8080    │
│  webui.caredeoghar.com → WebUI :3000  │
│  (OHIF :3010 — NOT tunneled ✅)       │
│  (Orthanc :8042 — NOT tunneled ✅)    │
│  (Ollama :11434 — NOT tunneled ✅)    │
└───────────┬───────────────────────────┘
            │ LAN 192.168.1.0/24
            │
┌───────────▼───────────────────────────────────────────────┐
│  Synology NAS DS923+ — 192.168.1.137                      │
│  Container Manager (Docker Compose)                        │
│                                                            │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │  care-api    │  │  care-erp  │  │  care-pacs       │  │
│  │  :8080       │  │  :5173     │  │  Orthanc :8042   │  │
│  │  (API Server)│  │  (Vite SPA)│  │  DICOMweb + REST │  │
│  └──────┬───────┘  └────────────┘  └────────┬─────────┘  │
│         │                                    │             │
│  ┌──────▼───────┐  ┌────────────┐  ┌────────▼─────────┐  │
│  │  care-db     │  │  care-ohif │  │  Open WebUI      │  │
│  │  PostgreSQL  │  │  OHIF :3010│  │  :3000 (Ollama)  │  │
│  │  :5432/5400  │  └────────────┘  └──────────────────┘  │
│  └──────────────┘                                         │
└───────────────────────────────────────────────────────────┘
            │
            │ LAN (DICOM C-FIND/C-MOVE, TCP)
            │
┌───────────▼───────────────────────────────────────────────┐
│  Imaging Modalities (DICOM SCU)                            │
│  • USG machine (US)     • X-Ray (DX/CR)                   │
│  • CT (CT)              • MRI (MR)                        │
│  Typically: 192.168.1.x or 172.16.1.x                     │
└───────────────────────────────────────────────────────────┘

Windows PC (optional): 192.168.1.250 / 172.16.1.140
  └─ Ollama (AI) :11434
```

**Network notes:**
- Primary LAN: `192.168.1.0/24`
- Docker bridge LAN: `172.16.1.0/24`
- Orthanc is reachable as both `192.168.1.137:8042` (host LAN) and `172.16.1.139:8042` (Docker bridge)
- `ALLOW_PRIVATE_IPS=true` is set — otherwise the SSRF guard in `providers.ts` would block LAN calls from Docker containers

---

## 2. Component Inventory

| Component | Type | Status | Location | Port(s) |
|-----------|------|--------|----------|---------|
| **Orthanc** | PACS Server | ✅ Active (Primary) | Synology Docker | 8042 (HTTP/REST/DICOMweb), 4242 (DICOM) |
| **OHIF Viewer** | Web Viewer | ✅ Active | Synology Docker | 3010 |
| **Weasis** | Desktop Viewer | ⚠️ Partially wired | Client PC (Java app) | N/A (launched via URL) |
| **Conquest** | PACS Server | ⚠️ Code placeholder only | Undefined | 5678 (HTTP), varies (DICOM) |
| **DIMSE Pull Agent** | ERP Service | ✅ Active (toggled) | care-api container | Internal |
| **MWL (Modality Worklist)** | DICOM Service | ⚠️ Partial — no SCP | care-api Internal API | Internal |
| **DICOM Puller** | Job Queue | ✅ Active | care-api (DB-backed) | Internal |
| **PACS Settings** | Config Store | ✅ Active | PostgreSQL `pacs_settings` | Internal |
| **ERP RIS** | Radiology IS | ✅ Active | care-api routes | Internal |
| **Open WebUI** | AI Interface | ✅ Active | Synology Docker | 3000 |
| **Cloudflare Tunnel** | Reverse Proxy | ✅ Active | Synology Docker | — |

### Sub-components inside care-api

| Sub-component | File | Purpose |
|--------------|------|---------|
| `PacsProvider` (Orthanc/Conquest/None) | `lib/pacs/providers.ts` | Provider abstraction, health checks, SSRF guard |
| `DicomConnector` registry | `lib/dicomConnectors.ts` | Study list/viewer/link abstraction (5 connectors) |
| `pacsArchive` | `lib/pacsArchive.ts` | Render finalized report PDF → push to Orthanc as SR |
| `dicomPatientCreator` | `lib/dicomPatientCreator.ts` | Create patient record in Orthanc on bill creation |
| `dicomRoutingOptimizer` | `lib/dicomRoutingOptimizer.ts` | Route DICOM C-MOVE to correct destination |
| `multiSiteWorklist` | `lib/multiSiteWorklist.ts` | Multi-branch MWL aggregation |
| `DIMSE Pull Agent` | `services/dicom-pull-agent/dimse-agent.ts` | In-process C-ECHO/C-FIND/C-MOVE via dcmjs-dimse |

---

## 3. Study Flow Diagram

### A. Complete Radiology Study Flow (Happy Path)

```
MODALITY (USG/CT/MR/CR/DX)
    │
    │ DICOM C-STORE push (port 4242)
    ▼
┌─────────────────────────────────────────────────┐
│  Orthanc PACS  (192.168.1.137:8042)             │
│  • Receives DICOM instances                     │
│  • Stores in /var/lib/orthanc/storage/          │
│  • Indexes study/series/instance in Orthanc DB  │
│  • Exposes DICOMweb (QIDO/WADO/STOW)            │
└───────────────┬─────────────────────────────────┘
                │
                │ REST API / DICOMweb  [PULL PATH]
                ▼
┌─────────────────────────────────────────────────┐
│  ERP RIS (care-api)                             │
│                                                 │
│  1. Bill created at reception desk              │
│     → radiology_studies row inserted            │
│     → accession_number generated                │
│     → PACS patient created (dicomPatientCreator)│
│                                                 │
│  2. MWL entry scheduled                         │
│     → radiology_scheduled_procedures row        │
│     → status: SENT_TO_MWL                       │
│     → Orthanc receives MWL (REST push)           │
│                                                 │
│  3. DICOM Pull Agent polls modality             │
│     → C-ECHO → C-FIND → C-MOVE to Orthanc      │
│     → dicom_pull_jobs row updated               │
│     → dicom_studies row created/updated         │
│                                                 │
│  4. Study auto-linked to radiology_studies      │
│     → by accession_number matching              │
│                                                 │
│  5. Radiologist opens study                     │
│     → OHIF Viewer (LAN :3010)                   │
│     OR Weasis (weasis:// URL from ERP)          │
│                                                 │
│  6. Radiologist writes report                   │
│     → Radiology Command Center                  │
│     → AI Draft (Ollama) optional                │
│     → Report saved in radiology_studies.final_report │
│     → Status → reported_final                   │
│                                                 │
│  7. Report archived to PACS                     │
│     → pacsArchive renders PDF via Playwright     │
│     → SR pushed to Orthanc as DICOM instance    │
│     → pacs_archive_status = 'archived'          │
└───────────────┬─────────────────────────────────┘
                │
                ▼
        FINALIZED REPORT
        • ERP: printable PDF
        • PACS: DICOM SR in Orthanc
        • Patient Portal: PDF download link
        • WhatsApp delivery (optional)
```

### B. MWL Flow (Modality Worklist Push)

```
Bill Created (reception)
    │
    ▼
radiology_scheduled_procedures (DB)
    │ status = SENT_TO_MWL
    ▼
POST /api/internal/radiology/mwl   (internal API, INTERNAL_API_KEY)
    │
    ▼
Orthanc REST API: PUT /modalities/{ae}/store   [⚠️ BROKEN — see §6]
    │
    ▼
Modality reads worklist via DICOM C-FIND on MWL SCP
    │
    ▼
Patient/study info pre-populated on modality console
```

### C. DICOM Pull Flow (Auto-Pull Agent)

```
Scheduled job (cron, every N seconds per node config)
    │
    ▼
dicom_pull_jobs (DB) — status: pending
    │
    ▼
DIMSE Pull Agent (in-process, dcmjs-dimse)
    │
    ├─ C-ECHO → modality (connectivity probe)
    │
    ├─ C-FIND → modality (study query by date range)
    │
    └─ C-MOVE → modality (move study to Orthanc AE)
         │
         ▼
    Orthanc (DIAGNOCENTER_PACS AE) receives C-STORE
         │
         ▼
    ERP dicom_studies updated
```

### D. Viewer Launch Flow

```
Staff clicks "Open in OHIF" / "Open in Weasis"
    │
    ├─ OHIF:
    │   GET /api/pacs/studies/:id/weasis-url
    │   → response: ohifUrl = http://192.168.1.137:3010/viewer?StudyInstanceUIDs=...
    │   → Browser opens OHIF on LAN
    │   → OHIF fetches via DICOMweb from Orthanc :8042
    │
    └─ Weasis:
        GET /api/pacs/studies/:id/weasis-url
        → response: weasisUrl = weasis://$dicom:get -r "http://...wado?..."
        → Browser opens Weasis protocol handler
        → Weasis fetches DICOM via WADO from Orthanc
```

---

## 4. Component Deep-Dive

### 4.1 Orthanc (Primary PACS)

**Status:** ✅ Active and integrated

| Property | Value |
|----------|-------|
| Container name | `care-pacs` (inferred) |
| LAN IP | `192.168.1.137:8042` |
| Docker bridge IP | `172.16.1.139:8042` |
| AE Title | `DIAGNOCENTER_PACS` (inferred from C-MOVE destination) |
| DICOM port | `4242` (standard Orthanc DICOM) |
| Auth | Username/password (`admin` / empty in .env — **⚠️ no password set**) |
| ERP env vars | `ORTHANC_URL`, `ORTHANC_USERNAME`, `ORTHANC_PASSWORD` |

**What is wired:**
- Patient creation on bill: `dicomPatientCreator.ts`
- Study/series/instance proxy: `routes/pacs.ts` (GET /patients, /studies, /series, /instances)
- WADO proxy: `routes/pacs.ts` (GET /pacs/wado)
- Health check: `GET /pacs/health` → Orthanc `/system`
- Weasis URL generation: `GET /pacs/studies/:id/weasis-url`
- OHIF URL construction: `OHIF_URL/viewer?StudyInstanceUIDs=...`
- Report archival (SR): `lib/pacsArchive.ts` (POST to Orthanc)
- C-ECHO/C-FIND/C-MOVE as *destination* for pull agent

**What is NOT wired:**
- MWL SCP — Orthanc does not natively serve a DICOM MWL SCP (see §6.1)
- Orthanc's built-in Osimis Viewer is referenced in fallback code (`/osimis-viewer/index.html`) — unused
- Orthanc notifications/webhooks to ERP not configured

---

### 4.2 OHIF Viewer

**Status:** ✅ Active (LAN only)

| Property | Value |
|----------|-------|
| URL | `http://192.168.1.137:3010` |
| Container port | `3010` |
| Env var | `OHIF_URL=http://192.168.1.137:3010` |
| DICOMweb source | Orthanc at `192.168.1.137:8042` |
| Auth | None (open on LAN) |
| Tunnel exposure | ❌ NOT exposed — correct |

**What is wired:**
- OHIF URL injected into `GET /pacs/config` response
- `openViewer()` in `DicomConnector` constructs OHIF URL with `StudyInstanceUIDs`
- `pacsEnterprise.ts` viewer settings read from `pacs_settings` category=`viewer`

**What is NOT wired:**
- No ERP login propagated to OHIF (OHIF has no auth awareness)
- No deep-link from OHIF back into ERP reporting workspace
- OHIF config (`app-config.js`) not managed by ERP — managed separately

---

### 4.3 Weasis

**Status:** ⚠️ Partially wired — URL generation only

| Property | Value |
|----------|-------|
| Launch type | `weasis://` URI protocol handler (client-side Java) |
| URL format | `weasis://$dicom:get -r "WADO_URL?requestType=WADO&studyUID=..."` |
| WADO source | `WADO_URL=http://192.168.1.137:8042/wado` |
| Installation | Requires Weasis installed on each radiologist PC |

**What is wired:**
- `GET /pacs/studies/:id/weasis-url` → returns `weasisUrl`
- `DicomConnector.openViewer()` supports `viewer: "weasis"`
- WADO proxy in `routes/pacs.ts` avoids CORS on Weasis fetch

**What is NOT wired:**
- No way to know if Weasis is installed on the opening machine
- No fallback to OHIF if Weasis protocol handler not registered
- No reporting integration (Weasis cannot write back to ERP)

---

### 4.4 Conquest PACS

**Status:** 🔴 NOT ACTIVE — Code placeholder only

| Property | Value |
|----------|-------|
| Provider class | `ConquestProvider` in `lib/pacs/providers.ts` |
| Connector class | `ConquestConnector` in `lib/dicomConnectors.ts` |
| `isConfigured` | Hardcoded `false` |
| `CONQUEST_URL` env | Not set in `.env` |
| Capabilities | `studyArchive: false`, `mwlPush: false`, `teleradiologyShare: false` |

**What is wired:**
- Conquest AE Title / Host / Port fields exist in `dicom_nodes` schema
- DIMSE agent uses `conquestAeTitle` as C-MOVE **destination** (not source)
- C-MOVE destination defaults: `CONQUEST_AE_TITLE`, `CONQUEST_HOST`, `CONQUEST_PORT`

**What is NOT wired:**
- ConquestConnector returns empty lists for all methods
- Conquest HTTP API (`/cgi-bin/dgate`) never called
- No Conquest container running on Synology
- PACS_PROVIDER env is `orthanc` — Conquest branch never executes

> **Verdict:** Conquest is dead code in the provider/connector layer. The Conquest AE Title field in DICOM nodes is used only as a C-MOVE destination (routing), not as a PACS source. This is intentional for some workflows but confusing in naming.

---

### 4.5 DIMSE Pull Agent (DICOM Puller)

**Status:** ✅ Implemented, ⚠️ Disabled by default

| Property | Value |
|----------|-------|
| File | `services/dicom-pull-agent/dimse-agent.ts` |
| Toggle | `ENABLE_DICOM_PULL_AGENT=1` (not set in `.env`) |
| Library | `dcmjs-dimse` (Node.js DICOM) |
| Poll interval | `DIMSE_POLL_INTERVAL_MS` (default 30,000ms) |
| Concurrent jobs | `DIMSE_MAX_CONCURRENT_JOBS` (default 3) |
| Agent AE Title | `AGENT_AE_TITLE` (default `DIAGNO_AGENT`) |

**Operations:**
| Op | DICOM | Description |
|----|-------|-------------|
| C-ECHO | SCU | Connectivity probe to modality |
| C-FIND | SCU | Query studies by date range |
| C-MOVE | SCU | Move study from modality to Orthanc |

**What is wired:**
- `startDimsePullAgent()` called from `cron.ts` when toggle enabled
- Pull jobs stored in `dicom_pull_jobs` table
- Logs stored in `dicom_pull_agent_logs`, status in `dicom_pull_agent_status`
- ERP UI: DICOM Puller dashboard reads job status
- Manual pull trigger: `POST /api/dicom/nodes/:id/pull`

**What is NOT wired:**
- `ENABLE_DICOM_PULL_AGENT=1` not in `.env` → agent is disabled on Synology
- `scheduleDicomAutoPull()` referenced in `cron.ts` comment but function not found in file — possible bug (cron registers the agent but does not auto-schedule per-node pulls separately)

---

### 4.6 MWL (Modality Worklist)

**Status:** ⚠️ ERP side built, DICOM SCP side missing

**How it should work:**
1. Bill created → `radiology_scheduled_procedures` row inserted
2. ERP pushes MWL entry to Orthanc via REST
3. Modality queries MWL via DICOM C-FIND on SCP

**What is wired:**
- `radiology_scheduled_procedures` table with MWL fields
- `POST /api/internal/radiology/mwl` — returns scheduled procedures as JSON
- `PATCH /api/internal/radiology/mwl/:id/status` — updates MWL status
- `GET /api/internal/radiology/structured-mwl` — structured JSON for Windows MWL SCP
- MWL fields in `radiology_studies` (body_part, study_description, scheduled_station_ae_title)
- MWL gate in `PATCH /radiology/:id` — prevents `in_progress` without MWL fields

**What is NOT wired (Critical Gap):**
- **Orthanc does not natively serve DICOM MWL SCP** — it needs a Lua plugin or separate SCP service
- No MWL SCP container running on Synology
- The `/structured-mwl` endpoint says "for Windows DICOM MWL SCP agent" — this agent is not deployed
- Modalities cannot actually query worklist — they see an empty list
- MWL data is correctly built in ERP DB but never reaches modality console

---

### 4.7 ERP RIS (Radiology Information System)

**Status:** ✅ Active (extensive)

**Key tables:**
| Table | Purpose |
|-------|---------|
| `radiology_studies` | Primary RIS record, billing-linked |
| `radiology_worklist` | PACS-side worklist (pulled from PACS) |
| `dicom_studies` | Canonical DICOM study registry (Phase 9+) |
| `radiology_scheduled_procedures` | MWL entries |
| `dicom_nodes` | Modality/PACS node registry |
| `dicom_pull_jobs` | Pull job queue |
| `pacs_settings` | Key-value PACS configuration |
| `pacs_logs` | PACS event audit log |

**Key routes:**
| Route file | Mounts at | Purpose |
|-----------|-----------|---------|
| `radiology.ts` | `/api/radiology` | Core RIS — worklist, status, reports |
| `pacsEnterprise.ts` | `/api/radiology` | Enterprise — nodes, MWL, pull, routing |
| `pacs.ts` | `/api/pacs` | Orthanc proxy — patients/studies/series/WADO |
| `dicom.ts` | `/api/dicom` | DICOM nodes CRUD, pull jobs, provider info |
| `internal-radiology.ts` | `/api/internal/radiology` | MWL, DICOM sync (internal API key) |
| `dicomStudyManager.ts` | `/api/dicom-studies` | Study management, link to reports |
| `dicomWorkflow.ts` | `/api/dicom-workflow` | Workflow orchestration |
| `dicom-uploads.ts` | `/api/dicom-uploads` | Manual DICOM file upload |

---

### 4.8 Synology NAS

**Status:** ✅ Active (all containers running here)

| Service | Container | Port |
|---------|-----------|------|
| ERP API | `care-api` | 8080 (host: via tunnel) |
| ERP Frontend | `care-erp` | 5173/8888 |
| PostgreSQL | `care-db` | 5432 (host: 5400) |
| Orthanc | `care-pacs` | 8042 (HTTP), 4242 (DICOM) |
| OHIF Viewer | `care-ohif` | 3010 |
| Open WebUI | `open-webui` | 3000 |
| Cloudflare tunnel | `cloudflared` | — |

---

### 4.9 Cloudflare Tunnel

**Status:** ✅ Active

| Route | Exposed | Auth |
|-------|---------|------|
| `caredeoghar.com` → `:8888` | ✅ Yes | ERP staff auth |
| `webui.caredeoghar.com` → `:3000` | ✅ Yes | Open WebUI login |
| Orthanc `:8042` | ❌ LAN only | — |
| OHIF `:3010` | ❌ LAN only | — |
| Ollama `:11434` | ❌ Must stay LAN | — |

---

## 5. Wiring Map — API Routes ↔ Components

```
ERP Frontend
    │
    ├──/api/pacs/*──────────────────→ pacs.ts → Orthanc REST (proxy)
    │                                            ├── /patients
    │                                            ├── /studies
    │                                            ├── /series
    │                                            ├── /instances/preview
    │                                            ├── /wado (proxy)
    │                                            └── /weasis-url
    │
    ├──/api/dicom/*─────────────────→ dicom.ts
    │                                  ├── DICOM nodes CRUD (DB only)
    │                                  ├── /nodes/:id/test ─→ tcpProbe()
    │                                  ├── /nodes/:id/pull ─→ dicom_pull_jobs
    │                                  └── /provider ──────→ getPacsProvider()
    │
    ├──/api/radiology/*──────────────→ radiology.ts (RIS worklist + reports)
    │                                + pacsEnterprise.ts (MWL, routing, nodes)
    │
    ├──/api/dicom-studies/*──────────→ dicomStudyManager.ts → DB
    │
    ├──/api/dicom-workflow/*─────────→ dicomWorkflow.ts → DB
    │
    └──/api/dicom-uploads/*──────────→ dicom-uploads.ts → Orthanc (stow-rs)

Internal (INTERNAL_API_KEY):
    ├──/api/internal/radiology/mwl───→ internal-radiology.ts → DB
    └──/api/internal/radiology/structured-mwl → for MWL SCP agent (not deployed)

DIMSE Agent (in-process):
    └── dcmjs-dimse ──→ Modality (C-ECHO/C-FIND/C-MOVE)
                   └──→ Orthanc (C-STORE destination via C-MOVE)
```

---

## 6. Broken Wiring

### 🔴 BW-001 — MWL SCP Not Deployed (Critical)

**Severity:** High | **Impact:** Modalities cannot fetch worklist

- ERP builds MWL data correctly (`radiology_scheduled_procedures`)
- ERP exposes `/api/internal/radiology/structured-mwl` for a "Windows MWL SCP agent"
- **That agent is not deployed anywhere on Synology**
- Modalities query DICOM C-FIND on a worklist SCP — none is running
- Orthanc does not have a built-in MWL SCP (it needs a Lua plugin or external tool)

**Result:** Technicians manually enter patient/study info on the modality console instead of auto-populating from worklist. This is the single largest workflow gap.

---

### 🔴 BW-002 — DIMSE Pull Agent Disabled (High)

**Severity:** High | **Impact:** No automatic study retrieval from modalities

- `ENABLE_DICOM_PULL_AGENT=1` is **NOT set** in `.env`
- Agent code is complete and functional
- Without it, `dicom_pull_jobs` accumulate as pending but never execute
- Studies must be pushed by modality (C-STORE) or manually pulled

---

### 🟡 BW-003 — Orthanc Password Empty (Medium)

**Severity:** Medium | **Impact:** Orthanc accessible without credentials on LAN

```env
ORTHANC_USERNAME=admin
ORTHANC_PASSWORD=          # ← EMPTY
```

- Orthanc is LAN-only, so this is acceptable for single-user home network
- ERP auth headers are sent with empty password: `Basic YWRtaW46`
- If Orthanc is configured with no authentication, this works
- If Orthanc is configured to require auth, all ERP calls silently fail

---

### 🟡 BW-004 — OHIF Has No Auth / ERP Session Awareness (Medium)

**Severity:** Medium | **Impact:** Anyone on LAN can access all PACS images

- OHIF runs on `:3010` with no authentication layer
- ERP generates OHIF URL and opens it in a new tab
- No ERP session token passed to OHIF
- No way to audit which staff opened which study via OHIF

---

### 🟡 BW-005 — Report Archive (pacsArchive) Requires Playwright (Medium)

**Severity:** Medium | **Impact:** Report-to-PACS archival fails silently if Playwright is not installed in container

```typescript
// lib/pacsArchive.ts line 9
import { chromium } from "playwright";
```

- `playwright` is in root `package.json` dependencies
- Playwright needs Chromium installed in the container
- Docker image may not have Chromium → archival silently fails
- `pacs_archive_status` never becomes `'archived'`

---

### 🟡 BW-006 — getStudy() in OrthancConnector is Broken (Medium)

**Severity:** Medium | **Impact:** Per-study metadata lookups via DicomConnector return null

```typescript
// lib/dicomConnectors.ts line 191
const data = await this.fetchJson(`/tools/find`) as Record<string, unknown>;
```

- `/tools/find` requires a POST body with query parameters — not a GET
- Called as GET → Orthanc returns 405 or empty
- `getStudy()` always returns `null` for real UIDs
- `listStudies()` works; `getStudy()` does not

---

### 🟢 BW-007 — Conquest C-MOVE Destination Fields Confusing (Low)

**Severity:** Low | **Impact:** Configuration confusion only

- `dicom_nodes` table has `conquestAeTitle`, `conquestHost`, `conquestPort`
- These fields are used in DIMSE agent as the **C-MOVE destination** (where to send pulled studies)
- Field name "conquest" implies a Conquest PACS, but the destination is actually Orthanc
- Staff entering node config may be confused about what these fields mean

---

## 7. Duplicate Settings

### DS-001 — Orthanc URL Defined in Two Places

| Location | Value |
|----------|-------|
| `.env` → `ORTHANC_URL` | `http://192.168.1.137:8042` |
| `pacs_settings` table (`category=orthanc`, `key=url`) | Possibly set via ERP settings UI |

- `pacs.ts` and `pacsArchive.ts` read from `process.env.ORTHANC_URL`
- `pacsEnterprise.ts` reads some settings from `pacs_settings` table
- If they differ, behavior is inconsistent
- **Recommendation:** env var should be source of truth; DB settings UI should only write env-level overrides, not duplicate them

---

### DS-002 — OHIF URL Defined in Two Places

| Location | Value |
|----------|-------|
| `.env` → `OHIF_URL` | `http://192.168.1.137:3010` |
| `pacs_settings` table (`category=viewer`, `key=ohifUrl`) | May be set via UI |

- `pacs.ts` line 57: `ohifUrl: process.env.OHIF_URL || null`
- `pacsEnterprise.ts` `getViewerSettings()` reads from DB
- Two sources — if DB has a different URL, viewer launch will use wrong URL for some code paths

---

### DS-003 — Viewer Type Set in Three Places

| Location |
|----------|
| `.env` → `PACS_VIEWER_TYPE=ohif` |
| `docker-compose.yml` → `PACS_VIEWER_TYPE: ${PACS_VIEWER_TYPE:-ohif}` |
| `pacs_settings` table (`category=viewer`, `key=viewerType`) |

- All three should agree. Currently `.env=ohif` is consistent with expected behavior.

---

### DS-004 — WADO URL Defined in Two Places

| Location | Value |
|----------|-------|
| `.env` → `WADO_URL` | `http://192.168.1.137:8042/wado` |
| Fallback in code | `${ORTHANC_URL}/wado` |

- If `WADO_URL` is not set, code falls back to `ORTHANC_URL + /wado` — consistent
- If `WADO_URL` is set but differs, Weasis launch may point to wrong endpoint

---

## 8. Legacy Configuration

### LC-001 — Osimis Viewer Fallback Reference

```typescript
// lib/dicomConnectors.ts line 227
ohif: ohifBase ? `${ohifBase}/viewer?...` : `${this.url}/osimis-viewer/index.html?study=${uid}`,
```

- Osimis Viewer (now OHIF v2) is the old Orthanc bundled viewer
- Modern Orthanc bundles OHIF v3 or Stone Web Viewer, not Osimis
- This fallback will 404 on current Orthanc versions
- Should be replaced with Orthanc's built-in Stone viewer or removed entirely

---

### LC-002 — `radiology_worklist` Table

- Created to hold PACS-sourced worklist data
- `radiology_studies` (billing-linked) and `dicom_studies` (PACS ingested) now serve the same purpose
- `radiology_worklist` is largely unused in the main workflows
- Superseded by `v_unified_worklist` view (created in DB optimization migration)

---

### LC-003 — Conquest Provider and Connector Code

```typescript
// lib/pacs/providers.ts
class ConquestProvider ...   // isConfigured: from env (no Conquest env set)

// lib/dicomConnectors.ts
class ConquestConnector ... readonly isConfigured = false;  // hardcoded
```

- Conquest was the original PACS intention before Orthanc was adopted
- All methods return empty/null
- Dead code — no Conquest running, no Conquest env vars
- Retention value: documents what Conquest would have done; actual cleanup can wait

---

### LC-004 — `PACS_VIEWER_TYPE` Defaults to `weasis` in One Place

```typescript
// pacs.ts line 56
viewerType: process.env.PACS_VIEWER_TYPE || "weasis",
```

- Default is `weasis` here
- But `.env` explicitly sets `PACS_VIEWER_TYPE=ohif`
- If env var is ever unset, code would return `weasis` as default while rest of system assumes `ohif`
- Inconsistent defaults across files

---

## 9. Unused Components

### UC-001 — DICOMweb Connector (Unused)

```typescript
class DicomWebConnector implements DicomConnector {
  readonly isConfigured = false;  // hardcoded
```

- Orthanc natively serves DICOMweb (QIDO-RS/WADO-RS/STOW-RS)
- But the `DicomWebConnector` class is never used — Orthanc is accessed via its REST API directly
- DICOMweb standard endpoints not used by ERP UI

---

### UC-002 — LocalFolder Connector (Unused)

```typescript
class LocalFolderConnector implements DicomConnector {
  readonly isConfigured = false;
  async openViewer(): Promise<{ url: string; viewer: string } | null> { return null; }
```

- Intended for USG machines that write files to a shared folder
- Not implemented beyond empty methods
- No watch-folder-based ingest pipeline deployed

---

### UC-003 — HL7 Routes (`routes/hl7.ts`)

- Route file exists (`9,109 bytes`)
- HL7 integration is built but not referenced in any active workflow
- No HL7 listener running on Synology
- Most workflows use direct DB / REST instead of HL7 messaging

---

### UC-004 — `dicom-agent.ts` Route

```
/api/dicom-agent   (2,659 bytes)
```

- Thin wrapper around the DIMSE agent status
- Wired in `routes/index.ts`
- DIMSE agent is disabled (`ENABLE_DICOM_PULL_AGENT` not set)
- Route exists but returns agent-not-running status for all calls

---

### UC-005 — `multiSiteWorklist.ts`

```typescript
// lib/multiSiteWorklist.ts  (2,470 bytes)
```

- Multi-branch worklist aggregation
- Only a single branch/site exists currently
- Not called from any active route
- Premature implementation

---

### UC-006 — RadiantViewer URL in DicomConnector

```typescript
radiant: `radiant://open?studyUID=${uid}`,
```

- RadiAnt is a Windows DICOM viewer
- URL handler generated but no UI button to launch it
- No documentation that RadiAnt is installed or used at this clinic

---

## 10. Recommendations

### Priority 1 — Critical Fixes

| # | Issue | Action | Effort |
|---|-------|--------|--------|
| R-01 | MWL SCP not deployed (BW-001) | Deploy a DICOM MWL SCP on Synology — options: (a) Orthanc Lua plugin for MWL, (b) dcm4chee WL SCP container, (c) simple Python/Node MWL SCP | High |
| R-02 | DIMSE Pull Agent disabled (BW-002) | Add `ENABLE_DICOM_PULL_AGENT=1` to `.env` and redeploy care-api | Trivial |
| R-03 | OrthancConnector.getStudy() broken (BW-006) | Fix to use `POST /tools/find` with proper body | Low |

### Priority 2 — Configuration Hardening

| # | Issue | Action | Effort |
|---|-------|--------|--------|
| R-04 | Orthanc has no password (BW-003) | Set `ORTHANC_PASSWORD` in both `.env` and Orthanc's `orthanc.json` | Trivial |
| R-05 | Duplicate URL settings (DS-001 to DS-004) | Enforce env vars as single source of truth; remove DB-based URL overrides | Low |
| R-06 | PACS_VIEWER_TYPE default mismatch (LC-004) | Change fallback default to `"ohif"` in `pacs.ts` | Trivial |
| R-07 | OHIF needs audit trail | Add ERP API endpoint that logs "staff X opened study Y at time Z" before redirecting to OHIF | Low |

### Priority 3 — Architecture Cleanup

| # | Issue | Action | Effort |
|---|-------|--------|--------|
| R-08 | Conquest dead code (LC-003, UC-001) | Add `@deprecated` comments; do not delete yet (retain for future multi-PACS) | Trivial |
| R-09 | radiology_worklist legacy (LC-002) | Migrate consumers to `v_unified_worklist` view; mark table for future deprecation | Low |
| R-10 | Osimis viewer fallback (LC-001) | Replace with Orthanc Stone Web Viewer URL: `/stone-webviewer/index.html?study={uid}` | Trivial |
| R-11 | Playwright dependency for archival (BW-005) | Add Playwright Chromium install to Dockerfile; or use a lightweight PDF render approach (puppeteer with system Chrome, or wkhtmltopdf) | Medium |
| R-12 | Unused components (UC-002 to UC-006) | Add `// UNUSED` banner comments; add cleanup tickets | Trivial |

### Priority 4 — Enhancements

| # | Enhancement | Description | Effort |
|---|-------------|-------------|--------|
| R-13 | MWL via Orthanc Lua | Install MWL Lua plugin in Orthanc container; ERP pushes to `/worklists/` endpoint | Medium |
| R-14 | Orthanc → ERP webhook | Configure Orthanc `OnStoredInstance` webhook to notify ERP when study arrives | Low |
| R-15 | OHIF authentication | Route OHIF through ERP reverse proxy with JWT validation to restrict LAN access | High |
| R-16 | Auto-link studies | Create background job that periodically matches `dicom_studies.accession_number` to `radiology_studies` for any unlinked studies | Low |
| R-17 | DICOM node AE title clarity | Rename `conquestAeTitle`/`conquestHost`/`conquestPort` fields to `destinationAeTitle`/`destinationHost`/`destinationPort` | Low |

---

## Appendix A — Environment Variable Reference

| Variable | Used By | Current Value | Notes |
|----------|---------|---------------|-------|
| `ORTHANC_URL` | pacs.ts, pacsArchive.ts, providers.ts, dicomConnectors.ts | `http://192.168.1.137:8042` | Primary source of truth |
| `ORTHANC_USERNAME` | Same | `admin` | ✅ Set |
| `ORTHANC_PASSWORD` | Same | *(empty)* | ⚠️ Not set |
| `PACS_PROVIDER` | providers.ts | `orthanc` | Correct |
| `PACS_VIEWER_TYPE` | pacs.ts, docker-compose.yml | `ohif` | ✅ Correct |
| `OHIF_URL` | pacs.ts, dicomConnectors.ts | `http://192.168.1.137:3010` | ✅ Correct |
| `WADO_URL` | pacs.ts, dicomConnectors.ts | `http://192.168.1.137:8042/wado` | ✅ Correct |
| `ALLOW_PRIVATE_IPS` | providers.ts (SSRF guard) | `true` | Required for LAN calls from Docker |
| `ENABLE_DICOM_PULL_AGENT` | cron.ts | *(not set)* | ⚠️ Agent disabled |
| `AGENT_AE_TITLE` | dimse-agent.ts | *(not set → DIAGNO_AGENT)* | Default |
| `CONQUEST_AE_TITLE` | dimse-agent.ts | *(not set → CONQUEST)* | Used as C-MOVE destination default |
| `CONQUEST_HOST` | dimse-agent.ts | *(not set → 127.0.0.1)* | ⚠️ Wrong — should be Orthanc IP |
| `CONQUEST_PORT` | dimse-agent.ts | *(not set → 5678)* | ⚠️ Wrong — should be Orthanc DICOM port 4242 |
| `INTERNAL_API_KEY` | internal-radiology.ts | `1234` | ⚠️ Weak default — change for production |

---

## Appendix B — PACS Tables Quick Reference

| Table | Rows (est.) | Purpose | Notes |
|-------|-------------|---------|-------|
| `radiology_studies` | 100–10k | RIS core — billing-linked studies | Source of truth for billing |
| `radiology_worklist` | Low | PACS-pulled worklist entries | Legacy — use v_unified_worklist |
| `radiology_scheduled_procedures` | Moderate | MWL entries | Used for MWL (SCP not deployed) |
| `dicom_studies` | Moderate | Canonical PACS study registry | Phase 9+ |
| `dicom_nodes` | 1–20 | Modality/PACS AE node config | |
| `dicom_pull_jobs` | Grows daily | Pull job queue and history | Index added in DB optimization |
| `dicom_pulled_studies` | Moderate | Studies pulled via DICOM Q/R | |
| `dicom_failed_retrieval_queue` | Low | Failed pull retry queue | |
| `dicom_modalities` | 1–20 | Physical modality registry | |
| `dicom_routing_rules` | Low | C-MOVE routing configuration | |
| `pacs_settings` | 10–50 | Key-value PACS config | Duplicate of env vars |
| `pacs_logs` | Grows fast | PACS event audit log | Needs index |
| `dicom_pull_agent_logs` | Grows fast | DIMSE agent event log | |
| `dicom_pull_agent_status` | 1 | Agent heartbeat | |

---

*Document generated: 2026-06-24*
*Source audit: git commit e695884 (caredeoghar--antigravity)*
*Next review: After MWL SCP deployment and DIMSE agent enablement*
