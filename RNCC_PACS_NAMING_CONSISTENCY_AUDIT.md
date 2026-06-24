# Radiology Network Control Center (RNCC) PACS Naming Consistency Audit Report
**Care Diagnostics ERP**  
**Date:** June 24, 2026  
**Auditor:** Antigravity AI  
**Status:** Read-Only Audit (No code modified, no configurations changed)

---

## 1. Executive Summary

This audit evaluates the consistency and correctness of the Radiology Network Control Center (RNCC) configurations, focussing on production PACS identities, AE Titles, network ports, URL templates, Lua integration scripts, and permission guards.

No production code or database values have been modified. This report highlights naming, port, and IP conflicts across the codebase, database seeds, environment files, and frontend labels, and validates the safety of the recent permission guard updates.

---

## 2. Production PACS Identity Findings

* **PACS Architecture Mode**: Mixed configuration.
  - **Orthanc**: Deployed inside the `care-pacs` container on the primary Synology NAS (`192.168.1.137`) on port `8042`. It acts as the primary image store and feeds the web viewers (OHIF/Weasis).
  - **Conquest**: Installed on a separate Windows host on the local network (`192.168.1.xxx`). It receives scans directly from modalities and utilizes a Lua hook to notify the ERP.
* **Naming Inconsistency**: Frontend labels and RNCC status indicators often refer generic parameters to "Orthanc" even when the underlying data pipeline or query endpoint is configured for Conquest (or vice versa), which can cause operator confusion.

---

## 3. AE Title & Port Matrix

| Layer / Context | Orthanc AE Title | Orthanc Port (DICOM/HTTP) | Conquest AE Title | Conquest Port (DICOM/HTTP) |
| :--- | :--- | :--- | :--- | :--- |
| **Code Default** | `ORTHANC2` | `4242` / `8042` | `CONQUEST` / `CONQUESTPACS` | `5678` |
| **Environment (`.env`)** | Not defined | `8042` (HTTP) | Not defined | Not defined |
| **Database Seed (`0004_...sql`)** | `ORTHANC2` | `5680` (DICOM) / `8042` (HTTP) | N/A | N/A |
| **Frontend UI Defaults** | `ORTHANC2` | `5680` | `ORTHANC2` | `5680` |
| **Real Production Target** | `ORTHANC` | `4242` (DICOM) / `8042` | `CONQUESTPACS` | `5678` / `5680` |

### Key Port Discrepancies:
- **Port 5678 vs 5680**: Conquest defaults to port `5678` in backend agent code, but frontend presets and database seed files hardcode port `5680` for DICOM communication.
- **Port 4242**: Orthanc's default DICOM port (`4242`) is omitted from the Docker Compose file, meaning modalities cannot send scans to Orthanc unless it is manually exposed in Container Manager.

---

## 4. URL & Endpoint Matrix

| Layer / Parameter | Synology LAN IP | OHIF URL / Port | Weasis WADO Base | ERP API Base URL |
| :--- | :--- | :--- | :--- | :--- |
| **Source Code Default** | `172.16.1.139` (Docker) | `http://192.168.1.137:3010` | `http://172.16.1.139:8042/wado` | `http://localhost:8080` |
| **Environment (`.env`)** | `192.168.1.137` | `http://192.168.1.137:3010` | `http://192.168.1.137:8042/wado` | `https://caredeoghar.com` |
| **Database Seed** | `172.16.1.139` | `http://172.16.1.139:3000` | `http://172.16.1.139:8042/wado` | N/A |
| **Real Production Target**| `192.168.1.137` | `http://192.168.1.137:3010` | `http://192.168.1.137:8042/wado` | `http://192.168.1.137:8888` |

---

## 5. Naming & Configuration Inconsistencies

1. **Replit Domain Leaks in Lua Hook**: The Conquest push script `conquest/erp_notify.lua` L31 references the placeholder domain `https://YOUR_DOMAIN.replit.app`. It also references placeholder API key `REPLACE_WITH_YOUR_INTERNAL_API_KEY`. It must be updated to reference `https://caredeoghar.com` and the real production `INTERNAL_API_KEY`.
2. **Missing Conquest Env Vars**: The environment file `.env` contains no `CONQUEST_*` variables.
3. **Database Seed vs Code Settings**: Seeding presets (in `0004_seed_pacs_viewer_defaults.sql`) write `pacs_ae_title = 'ORTHANC2'` and `ohif_base_url = 'http://172.16.1.139:3000'`. However, `pacsEnterprise.ts` uses `192.168.1.137` and `3010`.
4. **Seed Preservation**: The database SQL migrations utilize `ON CONFLICT (key, category) DO NOTHING;` which correctly preserves custom settings if already populated. However, the admin endpoint `/pacs-settings/load-defaults` performs a direct `update` operation and will overwrite custom values.

---

## 6. Permission Impact Review

We cross-checked the recent **Permission Penetration Remediation** changes:
* **Internal APIs Unaffected**: The intake API endpoints under `/api/internal/*` (such as `/api/internal/radiology/studies` and `/api/internal/backup`) are mounted *before* the staff authentication block and use the `requireInternalApiKey` middleware. Therefore, the new staff role permissions **do not block** Conquest Lua push hooks or cron jobs.
* **Viewer Launch Secure**: The OHIF and Weasis launch handlers under `/radiology` are appropriately protected by `requireStaffPermission("/radiology")` for staff sessions, ensuring that unauthorized staff members cannot access patient image links.

---

## 7. Risk List

* 🔴 **CRITICAL**: Conquest Lua hook will fail to execute successfully in production due to the hardcoded `YOUR_DOMAIN.replit.app` placeholder.
* 🔴 **CRITICAL**: Weasis viewer launch will fail on external workstations because `wado_uri_base_url` defaults to the non-routeable Docker IP `172.16.1.139`.
* 🟡 **WARNING**: `echoscu` C-ECHO tests fall back to simple TCP port probes because the DCMTK package is not installed on the Node container.

---

## 8. Required Manual Tests on Synology

1. **Orthanc C-ECHO**: Run connection test from the ERP settings and verify that it completes via TCP probe.
2. **Conquest Sync Validation**: Trigger a scan on a modality, send to Conquest, and verify that the study appears on the PACS worklist.
3. **Viewer Check**: Load a study from the worklist and verify that Weasis/OHIF opens in a new tab using the correct LAN IP `192.168.1.137`.

---

## 9. Final Pass/Fail Recommendation

* **Permission Remediation**: **PASS**. Permission guards are correct, safe, and do not disrupt internal automated callbacks.
* **PACS Naming & Config Consistency**: **FAIL**. Requires updating the Conquest Lua hook URL/key and correcting the Docker IP leaks (`172.16.1.139`) in the database settings table.
