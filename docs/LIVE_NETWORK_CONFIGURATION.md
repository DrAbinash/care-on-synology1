# Live Network Configuration
**Date:** 2026-06-24  
**Scope:** Care Diagnostics ERP · Synology NAS & LAN Production Network  
**Source of Truth:** Live environment audit (`.env` file and active PostgreSQL database tables)  
**Status:** ACTIVE RUNNING STATE (READ-ONLY AUDIT)

---

## 1. Modalities (DICOM Nodes Table)

The following modalities/imaging devices are actively registered in the `dicom_nodes` table in the production database:

| Node ID | Name | Modality | IP Address | DICOM Port | AE Title | Preferred Retrieve Method | Description |
|---------|------|----------|------------|------------|----------|---------------------------|-------------|
| **2** | *(Empty)* | `US` | `172.16.1.46` | `104` | `Voluson` | `C_STORE_OR_WATCH_FOLDER` | GE Voluson USG machine |

### Conquest Target / C-MOVE Destination for Modalities:
- **Conquest AE Title:** *(Empty)*
- **Conquest Host:** *(Empty)*
- **Conquest Port:** `5678`

---

## 2. Orthanc PACS Configuration

Orthanc is the primary PACS server. It runs in a separate Docker container (`care-pacs`) on the Synology NAS.

| Parameter | Configuration Source | Actual Value Found | Status |
|-----------|----------------------|--------------------|--------|
| **AE Title** | `pacs_settings` DB Table (`pacs_ae_title`) | `ORTHANC2` | ⚠️ Non-standard (Orthanc default is usually `ORTHANC`) |
| **DICOM Port** | Orthanc Default / LAN Host Mapping | `4242` | ✅ Standard (Internal port; check host mapping in Docker Compose) |
| **HTTP Port** | `.env` (`ORTHANC_URL`) | `8042` | ✅ Reachable on LAN at port `8042` |
| **Base REST URL** | `.env` (`ORTHANC_URL`) | `http://192.168.1.137:8042` | ✅ Configured for Server-to-Server calls |
| **DICOMWeb URL** | `pacs_settings` DB Table (`dicom_web_base_url`) | `http://172.16.1.139:8042/dicom-web` | ⚠️ Points to Docker Bridge IP |
| **Auth Username** | `.env` (`ORTHANC_USERNAME`) | `admin` | ✅ Configured |
| **Auth Password** | `.env` (`ORTHANC_PASSWORD`) | *(Empty / Blank)* | ⚠️ No password set |

---

## 3. Conquest PACS Configuration

Conquest PACS is currently configured in a dual-setup architecture where it exists as a fallback destination and a metadata client on a separate workstation.

| Parameter | Configuration Source | Actual Value Found | Status |
|-----------|----------------------|--------------------|--------|
| **AE Title** | `pacs_settings` DB Table (`conquest_ae`) | `ORTHANC2` | ⚠️ Overlaps with Orthanc AE Title key in DB |
| **Host IP** | `pacs_settings` DB Table (`pacs_ip`) | `172.16.1.139` | ⚠️ Points to Docker Bridge IP |
| **DICOM Port** | `pacs_settings` DB Table (`pacs_port`) | `5680` | ⚠️ Mismatches code default of `5678` |

### Conquest Lua Hook (`erp_notify.lua`)
- **Location in repo:** [conquest/erp_notify.lua](file:///c:/Users/abina/caredeoghar--antigravity/conquest/erp_notify.lua)
- **Configured ERP Endpoint:** `https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies` (❌ Unconfigured Placeholder)
- **Configured API Key:** `REPLACE_WITH_YOUR_INTERNAL_API_KEY` (❌ Unconfigured Placeholder)

### Legacy Conquest Lua Hook (`conquest_after_import.lua`)
- **Location in repo:** [docs/conquest_after_import.lua](file:///c:/Users/abina/caredeoghar--antigravity/docs/conquest_after_import.lua)
- **Configured ERP Endpoint:** `http://YOUR_ERP_HOST/api/internal/radiology/studies` (❌ Unconfigured Placeholder)
- **Configured API Key:** `YOUR_INTERNAL_API_KEY` (❌ Unconfigured Placeholder)

---

## 4. ERP RIS Configuration

The ERP API Server (`care-api`) runs in a Docker container on the Synology NAS.

| Parameter | Configuration Source | Actual Value Found | Status |
|-----------|----------------------|--------------------|--------|
| **Base URL** | `.env` (`PUBLIC_BASE_URL`) | `https://caredeoghar.com` | ✅ Active (served via Cloudflare tunnel) |
| **Host LAN IP** | Network Adapter Audit | `192.168.1.137` (Synology Host) | ✅ Resolves on local network |
| **Internal Port** | `.env` (`HOST_PORT`) | `8888` | ✅ Exposed port for web access |
| **Database Port** | `.env` (`DB_HOST_PORT`) | `5400` | ✅ Mapped on host (default container runs on `5432`) |
| **Internal API Key**| `.env` (`INTERNAL_API_KEY`) | `1234` | ✅ Active for local inter-service calls |

---

## 5. OHIF Viewer Configuration

The OHIF Viewer runs in a Docker container (`care-ohif`) on the Synology NAS.

| Parameter | Configuration Source | Actual Value Found | Status |
|-----------|----------------------|--------------------|--------|
| **Viewer URL** | `pacs_settings` DB Table (`ohif_base_url`) | `http://172.16.1.139:3000` | ⚠️ Points to Docker Bridge IP and port `3000` |
| **Env Viewer URL** | `.env` (`OHIF_URL`) | `http://192.168.1.137:3010` | ✅ Correct LAN endpoint (but unused by launcher) |
| **DICOMWeb URL** | `pacs_settings` DB Table (`dicom_web_base_url`) | `http://172.16.1.139:8042/dicom-web` | ⚠️ Points to Docker Bridge IP |
| **Study Template** | `pacs_settings` DB Table (`ohif_study_url_template`) | `{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}` | ✅ Matches standard pattern |

---

## 6. Weasis Desktop Viewer Configuration

Weasis is launched from the workstation browser via a local system protocol handler (`weasis://`).

| Parameter | Configuration Source | Actual Value Found | Status |
|-----------|----------------------|--------------------|--------|
| **Launcher URL** | `pacs_settings` DB Table (`weasis_manifest_url_template`) | `weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={studyInstanceUID}"` | ⚠️ Points to Docker Bridge IP |
| **WADO Endpoint** | `pacs_settings` DB Table (`wado_uri_base_url`) | `http://172.16.1.139:8042/wado` | ⚠️ Points to Docker Bridge IP |
| **Env WADO URL** | `.env` (`WADO_URL`) | `http://192.168.1.137:8042/wado` | ✅ Correct LAN endpoint (but unused by launcher) |
