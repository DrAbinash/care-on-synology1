# Radiology Network Control Center (RNCC) Final Production Validation Report
**Care Diagnostics ERP**  
**Date:** June 24, 2026  
**Auditor:** Antigravity AI  
**Status:** READ-ONLY AUDIT & VERIFICATION ONLY (No code, settings, or database values modified)

---

## 1. Executive Summary

This report presents the final production validation audit of the Care Diagnostics Radiology Network Control Center (RNCC), verifying the PACS configuration layer, viewer integration, DICOM routing, and recent permission remediation. 

All verified parameters align with the confirmed **Corrected Production Facts**. Recent security fixes (staff permission guards) are validated as safe and correct, with zero disruption to internal PACS synchronizations, Lua callbacks, or clinician viewer launches.

---

## 2. Production Architecture Map

The production radiology workflow maps as follows:
```
[Modality Scanners] 
       │ (C-STORE to 172.16.1.139:5680, AET: ORTHANC2)
       ▼
[Orthanc PACS Server] ◄─── (REST Query/Retrieve via 192.168.1.137:8042) ───► [Care ERP API Server]
       │                                                                            │
       │ (WADO Scans Fetch)                                                         │ (Viewer Redirect)
       ▼                                                                            ▼
[Local Workstations (Weasis)] ◄───────────────────────────────────────── [Web Browsers (OHIF)]
```

*Note: Conquest PACS is officially retired from active production and is maintained only as a local Windows emergency backup.*

---

## 3. AE Title Inventory

The active and legacy AE Titles across the configurations are:

| AE Title | Role / Owner | Scope | Status |
| :--- | :--- | :--- | :--- |
| **`ORTHANC2`** | Orthanc PACS Server | Active Production Target | **Active** |
| **`CONQUEST`** | Conquest PACS Server | Emergency Backup | **Legacy / Standby** |
| **`CONQUESTPACS`** | Conquest PACS Server | Code default fallback | **Obsolete** |
| **`DIAGNOCENTER`** | Care ERP DICOM Puller | Local Node Identity | **Active** |

---

## 4. Port Inventory

The verified port allocations for production services:

* **`5680` (DICOM)**: Orthanc PACS DICOM listener port. Orthanc is mapped to listen externally on `5680` on the Synology host, which routes to its internal DICOM service (standard `4242` is not directly exposed to the external LAN).
* **`8042` (HTTP)**: Orthanc PACS REST API and WADO endpoint.
* **`3010` (HTTP)**: OHIF Web Viewer LAN interface.
* **`8888` (HTTP)**: Care Diagnostics ERP host interface.

---

## 5. URL & Endpoint Matrix

The verified production URLs and access targets:

| Endpoint Key | Value / Template | Scope / Resolution | Status |
| :--- | :--- | :--- | :--- |
| **ERP LAN URL** | `http://192.168.1.137:8888` | Local network access | **Verified** |
| **ERP Public URL** | `https://caredeoghar.com` | Internet-facing access | **Verified** |
| **OHIF LAN URL** | `http://192.168.1.137:3010` | Local viewer launch | **Verified** |
| **OHIF Public URL** | `https://ohif.caredeoghar.com` | Cloud-facing viewer | **Verified** |
| **Preferred WADO URL**| `http://192.168.1.137:8042/wado` | Client browser-facing | **Verified** |

---

## 6. Orthanc Validation

- **Active PACS Status**: Orthanc is recognized as the sole active production store. Conquest is verified as retired from active worklists and is not referenced in active transaction routing.
- **DICOM Ports**: Orthanc listens on port `5680` externally (mapped to its container port `4242`), matching the target configurations used by the modalities.

---

## 7. Viewer Validation

- **OHIF Launcher**: The launch endpoint reads `ohif_base_url` from the database `pacs_settings` table (dynamically seeded as `http://192.168.1.137:3010`).
- **Weasis Launcher**: Weasis uses custom protocol links (`weasis://`) calling the preferred WADO endpoint `http://192.168.1.137:8042/wado`, which correctly routes WADO-URI requests through client workstations.

---

## 8. RNCC Validation

- **Seeding Integrity**: SQL migrations use `ON CONFLICT (key, category) DO NOTHING;` to seed defaults, ensuring existing custom AE titles, IPs, and ports remain untouched on startup.
- **Display Configurations**: Dashboard labels, Lua hooks, and config files correctly match the production environment variables and target settings.

---

## 9. Permission Remediation Validation

The recently implemented security guards:
* `requireStaffPermission("/radiology")`
* `requireStaffPermission("/dicom-nodes")`
* `PERMISSIONED_PATHS` and `PERMISSION_ALIASES` updates
* `/ledgers` and `/daily-summary` guards

**Status: VALIDATED**. 
- These guards only apply to the `/api/` endpoints gated by `requireStaffAuth` (staff portal sessions).
- They **do not break** automated callbacks, study intake, or cron jobs.
- Clinicians with `/radiology` permissions retain seamless access to the Radiology Worklist, report generator, AI drafts, save draft, and OHIF/Weasis viewers.

---

## 10. Internal API Validation

- The intake route `/api/internal/radiology/studies` and other callback routes remain fully functional.
- Authentication checks verifying `INTERNAL_API_KEY` are executed in isolation inside [internal-radiology.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/internal-radiology.ts) without interfering with staff session guards.

---

## 11. Configuration Drift Findings

- **Lua Hook Placeholder**: `conquest/erp_notify.lua` contains legacy Replit subdomain placeholders (`YOUR_DOMAIN.replit.app`). Since Conquest is retired from production, this finding is classified as **Legacy but harmless**.
- **Docker IP Usage**: The IP `172.16.1.139` is used for Orthanc container DICOM targets. This is **Intentional** for internal Synology/modality communication and is not a leak.

---

## 12. Risks

* **Low Risk**: If the backup Conquest workstation is brought online during an emergency, the Lua hook script must have its placeholders replaced before it can sync studies to the ERP.

---

## 13. Recommended Actions

1. **Retain Existing Code**: No changes are required. The codebase and database configurations match the production environment facts.
2. **Conquest Sync Update**: If Conquest is ever reactivated, update the Lua hook with the live production key and base URL.

---

## 14. Final PASS / FAIL Assessment

* **Permission Remediation**: **PASS** (Protected endpoints are secure; internal integrations are unaffected).
* **Production PACS Consistency**: **PASS** (All configured parameters align with Orthanc's active production status, port `5680`, and AE Title `ORTHANC2`).
