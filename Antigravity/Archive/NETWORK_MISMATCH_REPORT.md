# Network Mismatch Report
**Date:** 2026-06-24  
**Scope:** Care Diagnostics ERP · PACS & RIS Environment Variables vs. DB Settings vs. Code Defaults  
**Status:** READ-ONLY AUDIT ONLY

---

## 1. Executive Summary

This report identifies discrepancies across the four configuration layers:
1. **Source Code Defaults** (hardcoded fallbacks)
2. **Environment Variables** (`.env` configuration)
3. **Database Settings** (`pacs_settings` and `dicom_nodes` tables)
4. **Runtime Configuration** (active running parameters)

Discrepancies are categorized as:
- 🔴 **CRITICAL:** High risk of service failure or broken communication.
- 🟡 **WARNING:** Inconsistency that causes confusion or suboptimal routing.
- 🟢 **SAFE:** Configuration aligns correctly across all layers.

---

## 2. Identified Mismatches

### 🔴 Orthanc & Viewer IP Layer (Docker Bridge Leak)
- **Source Code Default:** `172.16.1.139` (Docker bridge IP) in `pacsEnterprise.ts`
- **Environment:** `192.168.1.137` (Physical LAN IP) in `.env`
- **Database:** `172.16.1.139` in `pacs_settings` (for `dicom_web_base_url`, `wado_uri_base_url`, `weasis_manifest_url_template`, and `pacs_ip`)
- **Runtime:** Viewers launched from client browsers query `172.16.1.139` and fail to connect because Docker bridge networks are not routeable from LAN client workstations.
- **Classification:** 🔴 **CRITICAL**

### 🔴 Conquest Configuration Discrepancy
- **Source Code Default:** Conquest port is default `5678` in `dimse-agent.ts` and `internal-radiology.ts`. Calling AE title is default `CONQUESTPACS` or `CONQUEST`.
- **Environment:** No `CONQUEST_*` environment variables are declared in `.env` or passed through `docker-compose.yml`.
- **Database:** `pacs_settings` table uses `pacs_port = 5680` and `pacs_ae_title = ORTHANC2` under category `viewer`.
- **Runtime:** The DICOM Pull Agent falls back to localhost defaults (`127.0.0.1:5678`) which will fail to reach the actual Conquest machine on the Windows host.
- **Classification:** 🔴 **CRITICAL**

### 🔴 Conquest Lua Hook API Endpoint Mismatch
- **Source Code Default:** `erp_notify.lua` uses placeholder `https://YOUR_DOMAIN.replit.app`
- **Environment:** `.env` defines `PUBLIC_BASE_URL=https://caredeoghar.com` and `INTERNAL_API_KEY=1234`
- **Database:** N/A (Lua scripts are external to the DB)
- **Runtime:** If the Lua script was deployed without replacing the placeholders, Conquest is calling a non-existent Replit subdomain, so no studies will sync to the ERP.
- **Classification:** 🔴 **CRITICAL**

### 🟡 OHIF Port Divergence
- **Source Code Default:** `http://192.168.1.137:3010` in `pacsEnterprise.ts`
- **Environment:** `http://192.168.1.137:3010` in `.env`
- **Database:** `http://172.16.1.139:3000` in `pacs_settings` (`ohif_base_url`)
- **Runtime:** Clicking the launch button redirects to port `3000` on the Docker IP, whereas the running service is mapped to port `3010` on the LAN.
- **Classification:** 🟡 **WARNING**

### 🟡 Orthanc AE Title Inconsistency
- **Source Code Default:** `ORTHANC2` in `pacsEnterprise.ts`
- **Environment:** Not defined in `.env`
- **Database:** `ORTHANC2` in `pacs_settings` (`pacs_ae_title`)
- **Runtime:** Orthanc's system default is `ORTHANC`. If Orthanc was deployed with its defaults, using `ORTHANC2` will fail C-STORE/C-MOVE associations.
- **Classification:** 🟡 **WARNING**

---

## 3. Mismatch Status Registry Table

| Parameter / Config | Source Code Defaults | Environment Var | Database Stored Value | Runtime Actual Status | Classification |
|--------------------|----------------------|-----------------|-----------------------|-----------------------|----------------|
| **Orthanc HTTP Base** | `http://172.16.1.139:8042` | `http://192.168.1.137:8042` | `http://172.16.1.139:8042` | `http://192.168.1.137:8042` | 🔴 **CRITICAL** |
| **OHIF Viewer Base**| `http://192.168.1.137:3010` | `http://192.168.1.137:3010` | `http://172.16.1.139:3000` | `http://192.168.1.137:3010` | 🟡 **WARNING** |
| **DICOMweb Endpoint**| `http://172.16.1.139:8042/...` | N/A | `http://172.16.1.139:8042/...` | `http://192.168.1.137:8042/...`| 🔴 **CRITICAL** |
| **WADO Endpoint** | `http://172.16.1.139:8042/...` | `http://192.168.1.137:8042/...` | `http://172.16.1.139:8042/...` | `http://192.168.1.137:8042/...`| 🔴 **CRITICAL** |
| **Conquest IP/Host**| `127.0.0.1` | *(None)* | `172.16.1.139` (Leaked) | `192.168.1.xxx` (Unconfigured) | 🔴 **CRITICAL** |
| **Conquest AE Title**| `CONQUEST` / `CONQUESTPACS` | *(None)* | `ORTHANC2` | `CONQUESTPACS` | 🔴 **CRITICAL** |
| **Conquest Port** | `5678` | *(None)* | `5680` | `5678` / `5680` | 🟡 **WARNING** |
| **Orthanc AE Title**| `ORTHANC2` | *(None)* | `ORTHANC2` | `ORTHANC` | 🟡 **WARNING** |
| **Orthanc Password**| N/A | *(Empty)* | N/A | *(Empty / No auth)* | 🟢 **SAFE** |
| **ERP Base URL** | N/A | `https://caredeoghar.com` | N/A | `https://caredeoghar.com` | 🟢 **SAFE** |
| **ERP Internal API**| `http://localhost:8080` | `INTERNAL_API_KEY=1234` | N/A | `http://192.168.1.137:8888` | 🟡 **WARNING** (Conquest calls fail) |
