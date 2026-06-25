# PACS / Radiology Current State Verification Audit
**Date:** 2026-06-24  
**Checkpoint:** `4d0ceba` — `pre-pacs-audit restore point`  
**Scope:** Care Diagnostics ERP · Synology DS1522+ deployment  
**Auditor:** Antigravity (read-only analysis — no changes made)

---

## Summary Table

| # | Component | Status | Severity |
|---|-----------|--------|----------|
| 1 | Modality → Orthanc (C-STORE/C-ECHO) | ⚠️ PARTIALLY WORKING | Medium |
| 2 | Modality → Conquest (C-STORE) | ⚠️ PARTIALLY WORKING | Medium |
| 3 | Orthanc → ERP Sync (auto-push on receive) | ❌ BROKEN | High |
| 4 | ERP Worklist Population | ✅ WORKING | — |
| 5 | Radiology Worklist (PACS Worklist) | ✅ WORKING | — |
| 6 | Radiology Command Center | ✅ WORKING | — |
| 7 | OHIF Viewer Launch | ⚠️ PARTIALLY WORKING | High |
| 8 | Weasis Viewer Launch | ⚠️ PARTIALLY WORKING | Medium |
| 9 | AI Draft (Radiology Copilot) | ✅ WORKING | — |
| 10 | Report Save Draft | ✅ WORKING | — |
| 11 | Report Finalization | ✅ WORKING | — |
| 12 | DICOM PDF Archival | ⚠️ PARTIALLY WORKING | High |
| 13 | PACS Settings | ⚠️ PARTIALLY WORKING | Medium |
| 14 | Viewer Settings | ⚠️ PARTIALLY WORKING | High |
| 15 | MWL Functionality | ⚠️ PARTIALLY WORKING | Medium |
| 16 | DICOM Puller Functionality | ⚠️ PARTIALLY WORKING | Medium |

---

## 1. Modality → Orthanc (C-STORE / C-ECHO)

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- Modalities can C-STORE directly to Orthanc at `192.168.1.137:8042` (DICOM port `4242` on Orthanc by default)
- TCP reachability probe (`tcpProbe`) in `providers.ts` works
- C-ECHO via ERP "Test Connection" button falls back to TCP if DCMTK is not installed on the API server container

### Root Cause of Partial Status
- **DCMTK (`echoscu`) is not installed inside the Docker container.** The `echo-test` endpoint in `pacsEnterprise.ts:L107` runs `which echoscu`; this will always fail in the Node container. It falls back to TCP — which verifies port reachability only, not DICOM association.
- **No C-STORE listener on ERP.** Orthanc receives studies directly. ERP has no SCP (C-STORE server). This is by design — but means Modality → Orthanc path requires Orthanc's DICOM port (`4242`) to be separately exposed, which is not in `docker-compose.yml`.
- **Orthanc DICOM port (`4242`) not exposed in Docker Compose.** Only Orthanc HTTP port `8042` is referenced. If Orthanc is running in a separate container (`care-pacs`), its DICOM port must be independently accessible.

### Files Involved
- `artifacts/api-server/src/routes/pacsEnterprise.ts` L78–190 (echo-test)
- `artifacts/api-server/src/lib/pacs/providers.ts` (TCP probe)
- `.env` → `ORTHANC_URL=http://192.168.1.137:8042`

### Dependencies
- DCMTK must be installed in the API server container for real C-ECHO
- Orthanc DICOM port `4242` must be network-accessible from modalities
- Orthanc's `dicom.ini` / JSON config must whitelist modality AE titles

### Recommended Fix
1. Add DCMTK to the Docker image: `RUN apt-get install -y dcmtk`
2. Verify Orthanc DICOM port `4242` is exposed in the Synology Container Manager
3. Confirm modality AE titles are registered in Orthanc's `RegisteredUsers` / `DicomModalities`

---

## 2. Modality → Conquest (C-STORE)

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- Conquest PACS receives DICOM from modalities independently (outside ERP)
- `erp_notify.lua` hook exists and POSTs study metadata to ERP when Conquest receives a study
- Conquest → ERP push pathway is implemented and correct

### Root Cause of Partial Status
- **`conquest/erp_notify.lua` uses a placeholder URL** (`https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies`). This has never been updated to the actual Synology/production URL. The Lua hook is not live on the Conquest installation.
- **No `CONQUEST_*` environment variables are set in `.env`.** The ERP has no configured Conquest host/port/AE title. The DICOM puller agent defaults to `127.0.0.1:5678/CONQUEST` which will not work on Synology.
- **C-ECHO to Conquest from ERP** uses findscu fallback from `pacsEnterprise.ts` L1175–1213, which requires `CONQUEST_HOST` env var — not set.

### Files Involved
- `conquest/erp_notify.lua` L31 (hardcoded placeholder URL)
- `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` L484–487 (Conquest defaults)
- `.env` (CONQUEST_* vars absent)
- `CONQUEST_SETUP.md`

### Dependencies
- Conquest PACS installed and running on a Windows host on the LAN
- `erp_notify.lua` deployed to Conquest's `lua/` directory
- `INTERNAL_API_KEY` set on both Conquest lua config and ERP `.env`

### Recommended Fix
1. Update `erp_notify.lua` L31: replace `YOUR_DOMAIN.replit.app` with the Synology ERP URL (e.g., `http://192.168.1.137:<port>/api/internal/radiology/studies`)
2. Add to `.env`: `CONQUEST_HOST`, `CONQUEST_PORT`, `CONQUEST_AE_TITLE`
3. Deploy updated lua hook to Conquest

---

## 3. Orthanc → ERP Sync (Auto-push on Receive)

**Status: ❌ BROKEN**

### Root Cause
There is **no Orthanc → ERP auto-push mechanism implemented**. 

- Conquest uses a Lua hook (`erp_notify.lua`) to POST to ERP when a study arrives.
- **Orthanc has no equivalent hook configured.** Orthanc supports Lua scripts and HTTP webhooks (via the `ServicesOrthancPlugin` or `JobsHistory`) but none are wired up in this deployment.
- The ERP's `/api/internal/radiology/studies` intake endpoint exists and works — it just never receives data from Orthanc.
- The DICOM Pull Agent (`dimse-agent.ts`) actively pulls from Orthanc REST API, but this is initiated from the ERP side (job queue), not pushed from Orthanc.
- The `/api/pacs/health` endpoint verifies Orthanc is reachable, but this is a read-only health check.

### What's Missing
- An Orthanc Lua script or HTTP webhook that calls `POST /api/internal/radiology/studies` when a new study is stored
- OR a polling service that watches Orthanc's `/changes` endpoint for new studies

### Files Involved
- `artifacts/api-server/src/routes/internal-radiology.ts` (intake endpoint — ready but unused by Orthanc)
- `conquest/erp_notify.lua` (exists for Conquest only, no Orthanc equivalent)
- `artifacts/api-server/src/routes/pacs.ts` (Orthanc REST proxy — read-only)

### Dependencies
- Orthanc `OnStoredInstance` Lua callback
- OR Orthanc HTTP webhook plugin

### Recommended Fix
Create an Orthanc Lua hook (`orthanc_erp_notify.lua`) identical in logic to `erp_notify.lua`, deployed to Orthanc's script directory. Alternatively, use the Orthanc REST `/changes` endpoint as a polling source in a background job.

---

## 4. ERP Worklist Population

**Status: ✅ WORKING**

### Details
- `POST /api/internal/radiology/studies` (called by Conquest Lua hook or manual entry) inserts rows into `radiology_worklist` table.
- `POST /api/radiology/worklist` (from billing flow in `BillingDesk.tsx`) creates entries in `radiology_studies` and optionally `radiology_worklist`.
- Auto-linked patient matching via `createOrLinkPatientFromDicom()` works.
- Duplicate handling via `ON CONFLICT DO NOTHING` on `study_instance_uid`.

### Files Involved
- `artifacts/api-server/src/routes/internal-radiology.ts` L151–344
- `lib/db/src/schema/dicom.ts`, `lib/db/src/schema/radiology.ts`

### Known Limitations
- Works only when the push endpoint is called. Orthanc never calls it (see item 3).
- Patient name matching depends on DICOM demographics matching ERP patient records.

---

## 5. Radiology Worklist (PACS Worklist)

**Status: ✅ WORKING**

### Details
- `GET /api/radiology/pacs-worklist` serves the PACS-pushed study list from `radiology_worklist` table.
- `GET /api/radiology/worklist` serves RIS-driven studies from `radiology_studies` table.
- Filtering by status, modality, date, and search all implemented.
- Count endpoint `GET /api/radiology/pacs-worklist/count` works.
- Frontend `RadiologyWorklist.tsx` (49 KB) renders both views.

### Files Involved
- `artifacts/api-server/src/routes/radiology.ts` L190–370
- `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx`

### Known Limitations
- PACS worklist only has entries if Conquest (or any caller) has posted to the intake endpoint.
- Orthanc-received studies do not appear unless manually entered or Orthanc hook is implemented.

---

## 6. Radiology Command Center

**Status: ✅ WORKING**

### Details
- `RadiologyCommandCenter.tsx` (111 KB) is the primary reporting workspace.
- Integrates: study worklist, AI copilot, report editor, smart findings, measurements, viewer launch.
- Connects to backend via `/api/radiology/*` endpoints.
- Template library, quick-add data, differential engine all functional.

### Files Involved
- `artifacts/diagnostic-erp/src/pages/RadiologyCommandCenter.tsx`
- `artifacts/api-server/src/routes/pacsEnterprise.ts`
- `artifacts/api-server/src/lib/smartRadiology/*.ts`

---

## 7. OHIF Viewer Launch

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- `GET /api/radiology/studies/:uid/ohif-launch` correctly reads OHIF URL from `pacs_settings` table
- URL template substitution (`{OHIF_BASE_URL}`, `{studyInstanceUID}`) is correct
- Frontend `DicomViewer.tsx` and `DicomAgentDashboard.tsx` have OHIF launch buttons

### Root Cause of Partial Status
**Critical configuration mismatch:**
1. **`.env` sets `OHIF_URL=http://192.168.1.137:3010`** — but this env var is NOT used by the OHIF launch endpoint. The launch endpoint reads exclusively from `pacs_settings` DB table key `ohif_base_url`.
2. **`DEFAULT_VIEWER_SETTINGS` in `pacsEnterprise.ts` L195 hardcodes `http://192.168.1.137:3010`** (LAN IP). If the `/pacs-settings/load-defaults` endpoint has ever been called, this IP is now in the DB.
3. **Docker internal IP conflict:** `DEFAULT_VIEWER_SETTINGS` also hardcodes `http://172.16.1.139:8042/dicom-web` for the DICOMweb base. The Docker network address `172.16.1.139` may not resolve correctly depending on which network the API container is on.
4. **OHIF's DICOMweb configuration**: OHIF needs to be separately configured with the correct DICOMweb data source pointing to Orthanc. There is no mechanism in ERP to set OHIF's own `app-config.js`. This is an external configuration dependency.

### Files Involved
- `artifacts/api-server/src/routes/pacsEnterprise.ts` L194–207, L487–550
- `artifacts/api-server/src/lib/pacs/viewerService.ts`
- `.env` `OHIF_URL` (unused by launch endpoint)
- `pacs_settings` DB table (key: `ohif_base_url`)

### Recommended Fix
1. Run `POST /api/radiology/pacs-settings/load-defaults` **once** to seed the DB, then verify the seeded `ohif_base_url` matches the actual OHIF instance IP/port.
2. Update `DEFAULT_VIEWER_SETTINGS` to use the LAN IP consistently (`192.168.1.137`) — not the Docker bridge IP `172.16.1.139`.
3. Ensure OHIF's `app-config.js` has DICOMweb data source pointing to `http://192.168.1.137:8042/dicom-web`.

---

## 8. Weasis Viewer Launch

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- `GET /api/radiology/studies/:uid/weasis-launch` generates `weasis://` URI correctly
- URI format: `weasis://$dicom:get -w "{wado_url}" -r "studyUID={uid}"`
- Falls back to `wado_uri_base_url` from `pacs_settings` DB
- `pacs.ts` L195–221 also generates Weasis URL for studies from Orthanc

### Root Cause of Partial Status
1. **`wado_uri_base_url` default is `http://172.16.1.139:8042/wado`** (Docker IP, not LAN IP `192.168.1.137:8042`). Weasis running on a radiologist's workstation cannot reach a Docker bridge IP — it needs the LAN IP.
2. **Weasis protocol handler must be installed locally.** `weasis://` URIs are custom protocol handlers. If Weasis is not installed on the radiologist's PC, the browser will silently fail.
3. **No `/api/radiology/studies/:uid/weasis-launch-redirect`** endpoint exists, but `DicomAgentDashboard.tsx` L353 links to it directly — **404 on click**.

### Files Involved
- `artifacts/api-server/src/routes/pacsEnterprise.ts` L420–485 (weasis-launch)
- `artifacts/api-server/src/routes/pacs.ts` L195–221 (Weasis URL helper)
- `artifacts/diagnostic-erp/src/pages/DicomAgentDashboard.tsx` L353 (broken link)
- `pacs_settings` table key: `wado_uri_base_url`, `weasis_manifest_url_template`

### Recommended Fix
1. Fix `wado_uri_base_url` in `pacs_settings` to `http://192.168.1.137:8042/wado` (LAN IP)
2. Add missing `/api/radiology/studies/:uid/weasis-launch-redirect` endpoint (should redirect to the `weasis://` URI)
3. Or change `DicomAgentDashboard.tsx` L353 to use the existing `/weasis-launch` endpoint

---

## 9. AI Draft (Radiology Copilot)

**Status: ✅ WORKING**

### Details
- AI draft generation via Ollama (`radiologyOllamaRouter`) and direct report assembler
- Template-based AI draft in `RadiologyCommandCenter.tsx` works via `radn/ai-draft` and `radn/report-generator` endpoints
- Smart findings (`RadiologySmartFindingsPanel.tsx`), copilot (`RadiologyCopilotPanel.tsx`), and AI inference settings (`AiReportingSettings.tsx`) all implemented
- Ollama primary URL `http://192.168.1.250:11434` and fallback `http://172.16.1.140:11434` configured in settings

### Known Limitation
- Ollama connectivity depends on Ollama running on the Windows PC at `192.168.1.250`. If that PC is off, AI draft fails silently.

---

## 10. Report Save Draft

**Status: ✅ WORKING**

### Details
- `PATCH /api/radiology/worklist/:id` updates `status`, `prelim_report`, `assigned_radiologist`
- Draft save in `RadiologyCommandCenter.tsx` via `radiology/studies/:id/prelim`
- Audit log entry created on every draft save
- `radiology_studies.prelim_report` column stores draft text

---

## 11. Report Finalization

**Status: ✅ WORKING**

### Details
- `POST /api/internal/radiology/report-status` handles status transitions to `FINALIZED`
- On finalization: PACS archive triggered automatically (`archiveReportToPacs()` called at L424)
- `patient_reports` table entry created/updated
- Audit log written
- WhatsApp report delivery triggered if configured

### Known Limitation
- DICOM PDF archival (item 12) may fail even if finalization succeeds — it's non-blocking

---

## 12. DICOM PDF Archival

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- `pacsArchive.ts` is fully implemented:
  - Fetches report HTML via `buildReportHtml()`
  - Renders PDF using **Playwright Chromium**
  - Encodes PDF as base64 and POSTs to Orthanc `/tools/create-dicom`
  - Uses SOPClassUID `1.2.840.10008.5.1.4.1.1.104.1` (Encapsulated PDF Storage)
  - Updates `radiology_studies.pacs_archive_status` (pending / success / failed)

### Root Cause of Partial Status
**Critical runtime dependency: Playwright / Chromium must be installed in the Docker container.**

1. **Playwright is not a standard production dependency** in most Docker Node images. The `playwright` package requires downloading Chromium binaries (`playwright install chromium`). This step is likely missing from the Dockerfile or Synology Container Manager setup.
2. **If `ORTHANC_URL` is empty or Orthanc unreachable**, the archival silently sets `pacs_archive_status = 'failed'` — no alert to staff.
3. **`buildReportHtml()` may return empty string** if the report has no associated `patient_reports` row — triggering a fallback HTML layout instead. The fallback is functional but may lack clinic letterhead.

### Files Involved
- `artifacts/api-server/src/lib/pacsArchive.ts` (full implementation)
- `artifacts/api-server/src/routes/internal-radiology.ts` L424–427 (trigger)
- `lib/db/src/schema/radiology.ts` (`pacs_archive_status`, `pacs_archive_response` columns)

### Recommended Fix
1. Add to Dockerfile: `RUN npx playwright install chromium --with-deps`
2. Verify `ORTHANC_URL`, `ORTHANC_USERNAME`, `ORTHANC_PASSWORD` are set on Synology
3. Add a staff-visible alert when `pacs_archive_status = 'failed'` in RadiologyCommandCenter

---

## 13. PACS Settings

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- `pacs_settings` DB table exists with `key / value / category / is_secret` schema
- `GET/POST /api/radiology/pacs-settings` endpoints work
- Settings categories: `viewer`, `orthanc`, `conquest`
- `POST /api/radiology/pacs-settings/load-defaults` seeds defaults from `DEFAULT_VIEWER_SETTINGS`
- Frontend `PacsSettings.tsx` (67 KB) renders the full settings UI

### Root Cause of Partial Status
1. **`DEFAULT_VIEWER_SETTINGS` contains mixed IPs** (`192.168.1.137:3010` for OHIF but `172.16.1.139:8042` for DICOMweb/WADO/Weasis). These are inconsistent — one is LAN IP, the other is Docker bridge IP. Loading defaults seeds incorrect values.
2. **No `.env` → DB seeding on first boot.** `OHIF_URL` and `WADO_URL` from `.env` are NOT automatically written to `pacs_settings`. The `POST /api/radiology/pacs-settings/load-defaults` must be manually called. If not called, `pacs_settings` for viewer may be empty.
3. **`pacs_ae_title` default is `ORTHANC2`** (L202) — not a real Orthanc AE title for most deployments. Orthanc's default AE title is `ORTHANC`.

### Files Involved
- `artifacts/api-server/src/routes/pacsEnterprise.ts` L194–236
- `artifacts/diagnostic-erp/src/pages/PacsSettings.tsx`
- `lib/db/src/schema/pacs.ts` (pacs_settings table)

---

## 14. Viewer Settings

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- Viewer settings stored in `pacs_settings` table under category `viewer`
- `viewerService.ts` cleanly abstracts OHIF and Weasis URL generation
- `NOTE: No hardcoded IP fallback` comment in `viewerService.ts` L8 — intentionally clean
- Frontend `AgentSetup.tsx` correctly documents viewer configuration steps

### Root Cause of Partial Status
1. **Two conflicting sources of truth**: `.env` (`OHIF_URL`, `WADO_URL`) and `pacs_settings` DB table. The launch endpoints use only DB. `.env` values are never read by viewer launch logic.
2. **`ohif_base_url` in DB may not exist** if load-defaults was not called. In that case, `GET /api/radiology/studies/:uid/ohif-launch` returns `{ error: "Viewer settings are not configured..." }` — which is correct behavior but confusing to staff.
3. **`weasis_manifest_url_template` hardcoded default** uses `172.16.1.139` (Docker bridge) instead of `192.168.1.137` (LAN).

### Files Involved
- `artifacts/api-server/src/lib/pacs/viewerService.ts`
- `artifacts/api-server/src/routes/pacsEnterprise.ts` L194–207 (DEFAULT_VIEWER_SETTINGS)
- `artifacts/diagnostic-erp/src/pages/AgentSetup.tsx`

---

## 15. MWL Functionality

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- `radiology_scheduled_procedures` table exists with full MWL fields (patient demographics, modality, scheduled date/time, station AE title, procedure code, body part)
- `GET /api/radiology/mwl-procedures` with filtering by status, modality, date, search
- `POST /api/radiology/mwl-procedures` creates new scheduled procedures
- `PATCH /api/radiology/mwl-procedures/:id` updates status (including `SENT_TO_MWL`)
- BillingDesk populates `scheduledStationAETitle` from the AE field on bill creation

### Root Cause of Partial Status
**MWL push to PACS (Conquest/Orthanc) is not implemented.**

1. The `status = SENT_TO_MWL` transition logs a PACS event but **does not actually push an MWL entry to Conquest or Orthanc**. It only marks the DB row as "sent."
2. Conquest's MWL is typically file-based (`.wl` files in a worklist directory). No file-write mechanism exists in the ERP.
3. Orthanc has a REST-based MWL via the `WorklistPlugin`. This is not called from `pacsEnterprise.ts`.
4. Live C-FIND MWL query in `pacsEnterprise.ts` L1071–1300 uses Orthanc `/tools/find` (Study-level, not MWL) or `findscu` DIMSE. The DIMSE C-FIND for MWL (information model: `1.2.840.10008.5.1.4.31`) is NOT implemented.

### Files Involved
- `artifacts/api-server/src/routes/pacsEnterprise.ts` L552–673, L1007–1300
- `artifacts/api-server/src/routes/radiology.ts` L107–189 (accession number generation + worklist creation)
- `lib/db/src/schema/radiology.ts` (radiology_scheduled_procedures)

### Recommended Fix
1. Implement `POST /api/radiology/mwl-push/:id` that writes a DICOM `.wl` file to a shared directory or calls Orthanc's Worklist REST API
2. For Conquest: Mount a shared folder accessible by both ERP container and Conquest; write `.wl` files via `fs.writeFile`

---

## 16. DICOM Puller Functionality

**Status: ⚠️ PARTIALLY WORKING**

### What Works
- `dimse-agent.ts` (24 KB) — full DIMSE implementation using `dcmjs-dimse` library
- C-ECHO, C-FIND (study level), C-MOVE (to Conquest destination) implemented
- Pull job queue (`dicom_pull_jobs` table) with status tracking
- Agent heartbeat/status table (`dicom_pull_agent_status`)
- Log table (`dicom_pull_agent_logs`) with rich filtering
- Frontend `DicomAgentDashboard.tsx` (19 KB) displays agent status and logs
- `DicomNodes.tsx` (48 KB) manages modality configurations

### Root Cause of Partial Status
1. **`dcmjs-dimse` import is lazy with error swallowing** (L33): if the library fails to load (e.g., native module issue in Docker), DIMSE operations silently fail with generic errors.
2. **Default Conquest destination is `127.0.0.1:5678`** (L486). This is the loopback address — not correct for a Synology deployment where Conquest runs on a separate Windows host.
3. **No CONQUEST env vars in `.env`**: `CONQUEST_HOST`, `CONQUEST_PORT`, `CONQUEST_AE_TITLE` are all absent. Agent falls back to `127.0.0.1:5678/CONQUEST`.
4. **C-MOVE destination hardcoded in `DicomNodes.tsx` L252, L263, L274, L282**: Default modality presets hardcode `conquestHost: "172.16.1.139"` and `conquestPort: 5680`. Port `5680` does not match the default `5678`. This discrepancy needs verification.
5. **Agent runs in-process** (`startDimsePullAgent()` called from the API server). If the API server restarts, the agent restarts too. No independent resilience.

### Files Involved
- `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts`
- `artifacts/api-server/src/routes/pacsEnterprise.ts` (DICOM nodes CRUD, pull job creation)
- `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx` (hardcoded presets)
- `.env` (missing CONQUEST_* vars)

### Recommended Fix
1. Set `CONQUEST_HOST`, `CONQUEST_PORT=5680`, `CONQUEST_AE_TITLE` in `.env`
2. Add error surfacing when `dcmjs-dimse` fails to load (currently silenced)
3. Fix port discrepancy: verify whether Conquest uses `5678` or `5680` and standardize

---

## Cross-Cutting Issues

### Issue A: Dual IP Addressing (LAN vs Docker Bridge)
The codebase inconsistently uses two IP ranges:
- **`192.168.1.x`** — Physical LAN IP (correct for services accessed by browsers/workstations)
- **`172.16.1.x`** — Docker bridge network IP (used in hardcoded defaults, wrong for browser-initiated requests)

The `DEFAULT_VIEWER_SETTINGS` mixes both. `OHIF_URL` uses `192.168.1.137:3010` but `dicom_web_base_url` uses `172.16.1.139:8042`. Both must use the same IP for consistency.

### Issue B: `.env` Values Not Seeding `pacs_settings` DB
`OHIF_URL`, `WADO_URL` are in `.env` and in `docker-compose.yml`, but the viewer launch endpoints (`ohif-launch`, `weasis-launch`) read from `pacs_settings` DB only. The env vars are never written to the DB automatically. An initialization step is required.

### Issue C: Missing Endpoint — `weasis-launch-redirect`
`DicomAgentDashboard.tsx` L353 references `/api/radiology/studies/${uid}/weasis-launch-redirect` which does not exist in any route file. This is a broken link causing a `404` on every Weasis launch attempt from the DICOM Agent Dashboard.

### Issue D: `INTERNAL_API_KEY` — Conquest Hook Not Deployed
`conquest/erp_notify.lua` L34 contains `"REPLACE_WITH_YOUR_INTERNAL_API_KEY"`. This is a placeholder. The hook has never been deployed to a live Conquest instance with the real key.

---

*End of PACS Current State Report*
