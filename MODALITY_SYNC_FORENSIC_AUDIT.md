# Modality Sync Forensic Audit: Care Diagnostics PACS & RIS

**Date:** 2026-06-24  
**Auditor:** AI Systems Audit  
**Scope:** Care Diagnostics Modality → Orthanc → ERP Sync Ingestion Pipeline  
**Status:** DRAFT AUDIT REPORT (Phase 1 Complete)

---

## 1. Executive Summary & Root Cause Candidates

We have completed a forensic audit comparing the current non-functional PACS state with the original working configuration. Five major configuration errors and architectural mismatches have been identified:

### 🔴 Root Cause 1: Database Settings Bridge Leak (Critical)
The `pacs_settings` table contains entries pointing to `172.16.1.139` (the Docker internal bridge IP) instead of the Synology host LAN IP `192.168.1.137` or Tailscale IP `100.65.255.115`.
* **Impact:** Viewers (OHIF/Weasis) launched from client workstations fail immediately because client browsers cannot route traffic to internal Docker bridge subnets.

### 🔴 Root Cause 2: Missing Study Linkage & Status Update in Intake API (Critical)
The `POST /api/internal/radiology/studies` endpoint in `internal-radiology.ts` contains a strict type guard:
```typescript
const studyId = typeof b.studyId === "number" ? b.studyId : undefined;
```
* **Impact:** The original `care_erp_sync.py` script passes the string `StudyInstanceUID` as the `studyId`. The type guard fails this check, leaving `studyId` as `undefined` (resolving to `null` in the database).
* Because the API never resolves the real `id` of `radiology_studies` via `accession_number`, it fails to link the incoming PACS study with the billing order. The `radiology_studies` row remains in a `scheduled` status forever, and `study_instance_uid` is never populated. As a result, the study never appears on the radiologist's worklist dashboard.

### 🔴 Root Cause 3: Conquest AE Title and Port Inconsistency (High)
* **Database:** `pacs_settings` has `pacs_port = 5680` and `pacs_ae_title = ORTHANC2`.
* **Conquest default:** Runs on port `5678` with AE Title `CONQUESTPACS` or `CONQUEST`.
* **Impact:** The DIMSE pull agent falls back to `127.0.0.1:5678` with default AE Titles, leading to association failures.

### 🔴 Root Cause 4: Conquest Lua Hook Placeholders (High)
* The `conquest/erp_notify.lua` script contains placeholder values:
  * `ERP_URL = "https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies"`
  * `ERP_API_KEY = "REPLACE_WITH_YOUR_INTERNAL_API_KEY"`
* **Impact:** Conquest triggers fail to contact the ERP API, leaving the PACS-to-ERP real-time sync completely non-functional.

### 🟡 Root Cause 5: OHIF Port Mismatch (Medium)
* **Database:** `ohif_base_url` points to port `3000`.
* **Runtime:** The running OHIF service container is mapped to port `3010` on the Synology host.
* **Impact:** Client browsers are redirected to an inactive port, causing a "Connection Refused" error when opening the viewer.

---

## 2. Commit & Code Modification Timeline

* **Commit `4481758` (RNCC and PACS Config Abstraction):** Introduced the database abstraction layer (`pacs_settings` table). This commit inadvertently populated the database with Docker-internal bridge IP addresses (`172.16.1.139`) instead of physical LAN IP addresses.
* **Commit `d2bb12a` (RNCC Final Production Validation):** Transitioned worklist queries to strictly enforce permission checks and routed queries through the `radiology_studies` table, highlighting the missing linkage bug in `internal-radiology.ts`.

---

## 3. Original vs. Current Configuration Matrix

| Parameter / Config | Original Working State | Current Broken State |
| :--- | :--- | :--- |
| **Orthanc HTTP Base** | `http://192.168.1.137:8042` | `http://172.16.1.139:8042` |
| **OHIF Viewer Base** | `http://192.168.1.137:3010` | `http://172.16.1.139:3000` |
| **DICOMweb Endpoint** | `http://192.168.1.137:8042/dicom-web` | `http://172.16.1.139:8042/dicom-web` |
| **WADO Endpoint** | `http://192.168.1.137:8042/wado` | `http://172.16.1.139:8042/wado` |
| **Orthanc AE Title** | `ORTHANC2` | `ORTHANC` (System default mismatch) |
| **Conquest AE Title** | `CONQUESTPACS` | `ORTHANC2` (Overlapped in DB settings) |
| **Conquest Port** | `5678` | `5680` |
| **Lua Hook Endpoint** | `http://192.168.1.137:8888/api/internal/radiology/studies` | `https://YOUR_DOMAIN.replit.app/...` |
| **Lua Hook API Key** | `1234` | `REPLACE_WITH_YOUR_INTERNAL_API_KEY` |
| **Study Intake API** | Implicitly mapped `accessionNumber` to billing | Strictly relies on numeric `studyId` from body |

---

## 4. Verification & Action Plan (Phases 2-6)

### Phase 2: Verification of Original Flow (Read-Only)
We will verify LAN reachability from client workstations to the NAS host ports:
* Port `8888` (ERP Web)
* Port `8042` (Orthanc HTTP)
* Port `3010` (OHIF Viewer)
* Port `4242` (Orthanc DICOM port)
* Port `5678` (Conquest DICOM port)

### Phase 3: Restore Known-Good Logic
We will implement a correction inside [`artifacts/api-server/src/routes/internal-radiology.ts`](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/internal-radiology.ts) to:
1. Resolve the `studyId` by querying `radiology_studies` using the `accessionNumber` if the body's `studyId` is missing, null, or non-numeric.
2. Update the matching `radiology_studies` row: set `studyInstanceUid = studyInstanceUID`, set `status = 'acquired'`, and update `acquiredAt = new Date()`.
3. Re-align database `pacs_settings` records to use the correct LAN host IP `192.168.1.137` and correct ports.
