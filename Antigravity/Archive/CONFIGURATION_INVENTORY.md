# Configuration Inventory
**Date:** 2026-06-24  
**Derived from:** `PACS_CURRENT_STATE_REPORT.md` + `NETWORK_DEPENDENCY_AUDIT.md`  
**Purpose:** Single source of truth for all canonical PACS/Radiology configuration values before standardization  
**Status:** Pre-implementation reference — no changes applied yet

---

## Part 1 — Canonical Values (Decisions Required)

### 1. Canonical Orthanc AE Title

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `ORTHANC` (Orthanc system default), `ORTHANC2` (hardcoded in `DicomNodes.tsx` L252, `pacsEnterprise.ts` L202) |
| **Files using `ORTHANC`** | Orthanc internal default — not written in ERP codebase |
| **Files using `ORTHANC2`** | `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx` L252, L263, L274, L282 (preset defaults); `artifacts/api-server/src/routes/pacsEnterprise.ts` L202 (DEFAULT_VIEWER_SETTINGS) |
| **Problem** | `ORTHANC2` is a non-standard custom AE title. If the actual Orthanc container was installed with its default (`ORTHANC`), every DICOM association to it using `ORTHANC2` will fail with "Unknown Called AE Title" |
| **Decision needed** | ✅ Verify the AE Title set in Orthanc's `orthanc.json` on the Synology `care-pacs` container |
| **Recommended Final Value** | `ORTHANC` (Orthanc's default — safest unless you confirmed `ORTHANC2` is set) |
| **Config key in DB** | `pacs_ae_title` in `pacs_settings` table (category: `viewer`) |
| **Env var** | `PACS_AE_TITLE` (add to `.env` and docker-compose) |

---

### 2. Canonical Conquest AE Title

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `CONQUEST` (dimse-agent.ts L485 default), `CONQUESTPACS` (pacsEnterprise.ts L1178 default), `CONQUEST1` (internal-radiology.ts L1501 default), `ORTHANC2` (DicomNodes.tsx presets as destination AE) |
| **Files using `CONQUEST`** | `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` L485 |
| **Files using `CONQUESTPACS`** | `artifacts/api-server/src/routes/pacsEnterprise.ts` L1178 |
| **Files using `CONQUEST1`** | `artifacts/api-server/src/routes/internal-radiology.ts` L1501 |
| **Files using `ORTHANC2` as destination** | `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx` L252, L263, L274, L282 |
| **Problem** | Three different AE Titles used for the same Conquest PACS server across three files. C-MOVE operations will target different AE titles depending on code path, causing unpredictable routing |
| **Decision needed** | ✅ Check Conquest's `dicom.ini` — `LocalAddress` and `MyName` fields define the Conquest AE title |
| **Recommended Final Value** | `CONQUESTPACS` (most descriptive; used in C-FIND path which is highest-level) |
| **Config key in DB** | `conquest_ae` in `pacs_settings` table (category: `conquest`) |
| **Env var** | `CONQUEST_AE_TITLE` (add to `.env` and docker-compose) |

---

### 3. Canonical ERP Calling AE Title

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `DIAGNOCENTER` (dimse-agent.ts L126, L101) |
| **Files using it** | `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` L101, L126 |
| **Problem** | This is the AE title that the ERP's DICOM Pull Agent presents itself as to modalities and PACS servers. Modalities and PACS must have `DIAGNOCENTER` whitelisted. If they don't, C-ECHO and C-MOVE will be rejected. Currently only hardcoded — not configurable via env or DB |
| **Decision needed** | ✅ Confirm `DIAGNOCENTER` is registered in Orthanc's `DicomModalities` and/or Conquest's `dicom.ini` as a trusted SCU |
| **Recommended Final Value** | `DIAGNOCENTER` (retain current value) |
| **Config key in DB** | `agent_ae_title` in `pacs_settings` table (new key — currently not persisted) |
| **Env var** | `AGENT_AE_TITLE` (add to `.env` and docker-compose) |

---

### 4. Canonical Conquest DICOM Port

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `5680` (DicomNodes.tsx presets L252/263/274/282; pacsEnterprise.ts L201), `5678` (dimse-agent.ts L487 default; internal-radiology.ts L1500 default) |
| **Files using `5680`** | `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx` (all 4 preset entries), `artifacts/api-server/src/routes/pacsEnterprise.ts` L201 |
| **Files using `5678`** | `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` L487, `artifacts/api-server/src/routes/internal-radiology.ts` L1500 |
| **Problem** | Conquest's DICOM SCP port is defined in its `dicom.ini`. Default Conquest port is `5678`. The `5680` found in DicomNodes presets may be a custom config or may be wrong. C-MOVE operations from `dimse-agent.ts` use `5678` while the UI shows `5680` — these two paths will not route to the same port |
| **Decision needed** | ✅ Check `dicom.ini` on the Conquest host — look for `TCPPort` or `DicomListenPort` |
| **Recommended Final Value** | `5678` (Conquest default) — change `DicomNodes.tsx` presets to match |
| **Config key in DB** | `conquest_port` in `pacs_settings` table (category: `conquest`) |
| **Env var** | `CONQUEST_PORT` (add to `.env` and docker-compose) |

> **Note:** If the actual Conquest is running on `5680`, then `dimse-agent.ts` and `internal-radiology.ts` defaults must be updated to `5680`.

---

### 5. Canonical Orthanc DICOM Port

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `4242` (Orthanc system default — implied but **not found in any ERP config file**) |
| **Files referencing it** | None — Orthanc's DICOM port is not referenced in ERP source code or configuration |
| **Problem** | The Orthanc DICOM SCP port (`4242`) is never configured or tested by the ERP. The only Orthanc port referenced is `8042` (HTTP REST). For modalities to C-STORE into Orthanc directly, Orthanc's DICOM port must be network-accessible and the ERP must know it for C-ECHO testing |
| **Decision needed** | ✅ Confirm Orthanc DICOM port is `4242` in the Synology container. Check if it's exposed in Container Manager port mappings |
| **Recommended Final Value** | `4242` (Orthanc default) |
| **Config key in DB** | `orthanc_dicom_port` in `pacs_settings` table (new key — not currently stored) |
| **Env var** | `ORTHANC_DICOM_PORT` (add to `.env` and docker-compose) |

---

### 6. Canonical Orthanc HTTP Port

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `8042` — consistent across all references |
| **Files using it** | `.env` (ORTHANC_URL), `docker-compose.yml`, `pacsEnterprise.ts` DEFAULT_VIEWER_SETTINGS, `DicomNodes.tsx` presets, `pacsArchive.ts`, `pacs.ts`, `viewerService.ts` |
| **Problem** | The `172.16.1.139:8042` reference in DEFAULT_VIEWER_SETTINGS uses the correct port but wrong IP. The port itself is consistent and correct |
| **Recommended Final Value** | `8042` ✅ (already canonical — no change needed) |
| **Config key in DB** | `orthanc_base_url` in `pacs_settings` table (category: `orthanc`) — includes port |
| **Env var** | `ORTHANC_URL` (already in `.env` as `http://192.168.1.137:8042`) |

---

### 7. Canonical OHIF URL

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `http://192.168.1.137:3010` (.env, pacsEnterprise.ts DEFAULT_VIEWER_SETTINGS), `http://192.168.1.10:3000` (AgentSetup.tsx examples only) |
| **Files using `192.168.1.137:3010`** | `.env` line 97, `artifacts/api-server/src/routes/pacsEnterprise.ts` L195 |
| **Files using env var** | `artifacts/api-server/src/routes/pacs.ts` L218 (reads `process.env.OHIF_URL` for non-launch endpoint only) |
| **Actual launch source** | `pacs_settings` DB table — key `ohif_base_url` (category: `viewer`) |
| **Problem** | `.env` has `OHIF_URL=http://192.168.1.137:3010` but this is NOT read by the OHIF launch endpoint. Launch reads from `pacs_settings` DB. The DB may be empty if `load-defaults` was never called |
| **Decision needed** | ✅ Verify OHIF is actually running on port `3010` on the Synology (not the default `3000`) |
| **Recommended Final Value** | `http://192.168.1.137:3010` |
| **Config key in DB** | `ohif_base_url` in `pacs_settings` table (category: `viewer`) |
| **Env var** | `OHIF_URL` (already in `.env`) — must also be seeded to DB |
| **DICOMweb source for OHIF** | `http://192.168.1.137:8042/dicom-web` (LAN IP, not `172.16.1.139`) |

---

### 8. Canonical Weasis URL / WADO Endpoint

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `http://172.16.1.139:8042/wado` (pacsEnterprise.ts L198 DEFAULT — ⚠️ Docker bridge IP), `http://192.168.1.137:8042/wado` (.env WADO_URL — correct but unused by launch), `http://192.168.1.10:8080/wado` (AgentSetup.tsx examples only) |
| **Weasis URI template found** | `weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={studyInstanceUID}"` (pacsEnterprise.ts L199 — ⚠️ Docker bridge IP) |
| **Actual launch source** | `pacs_settings` DB table — keys `wado_uri_base_url`, `weasis_manifest_url_template` |
| **Problem** | DEFAULT_VIEWER_SETTINGS seeds `172.16.1.139` for WADO. Weasis on a radiologist's Windows workstation cannot reach a Docker bridge IP |
| **Recommended Final Value (WADO)** | `http://192.168.1.137:8042/wado` |
| **Recommended Final Value (Weasis URI)** | `weasis://$dicom:get -w "http://192.168.1.137:8042/weasis?studyUID={studyInstanceUID}"` |
| **Config key in DB** | `wado_uri_base_url` and `weasis_manifest_url_template` in `pacs_settings` (category: `viewer`) |
| **Env var** | `WADO_URL` (already in `.env` with correct value) — must be seeded to DB |

---

### 9. Canonical ERP Internal API URL (for Conquest Hook)

| Attribute | Detail |
|-----------|--------|
| **Current values found** | `https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies` (conquest/erp_notify.lua L31 — ❌ placeholder) |
| **Files using it** | `conquest/erp_notify.lua` L31, `docs/conquest_after_import.lua` (similar placeholder) |
| **Problem** | The Conquest Lua hook was written for a Replit deployment and was never updated to the Synology production URL. The hook is therefore dead code — studies received by Conquest never reach the ERP worklist |
| **Decision needed** | ✅ Determine the production ERP URL accessible from the Conquest Windows host. Options: LAN IP (`http://192.168.1.137:<HOST_PORT>`), hostname, or Cloudflare Tunnel URL |
| **Recommended Final Value** | `http://192.168.1.137:<HOST_PORT>/api/internal/radiology/studies` (where HOST_PORT is the Nginx port from `.env`) |
| **Config key** | Hardcoded in `erp_notify.lua` — no DB key. Must be updated in the file before deployment |
| **Companion value** | `INTERNAL_API_KEY` — must also be set in both `erp_notify.lua` and `.env` |

---

## Part 2 — Duplicate Settings Registry

### Duplicate AE Titles

| Setting | Locations | Values Found | Canonical |
|---------|-----------|--------------|-----------|
| Orthanc PACS AE | `DicomNodes.tsx` L252/282, `pacsEnterprise.ts` L202 | `ORTHANC2` | `ORTHANC` |
| Conquest PACS AE | `dimse-agent.ts` L485, `pacsEnterprise.ts` L1178, `internal-radiology.ts` L1501 | `CONQUEST`, `CONQUESTPACS`, `CONQUEST1` | `CONQUESTPACS` |
| ERP Calling AE | `dimse-agent.ts` L101, L126 | `DIAGNOCENTER` | `DIAGNOCENTER` ✅ |

---

### Duplicate Ports

| Service | Locations | Values Found | Canonical |
|---------|-----------|--------------|-----------|
| Conquest DICOM port | `DicomNodes.tsx` presets, `pacsEnterprise.ts` L201 vs `dimse-agent.ts` L487, `internal-radiology.ts` L1500 | `5680` vs `5678` | Verify in `dicom.ini` |
| Orthanc HTTP port | All references | `8042` | `8042` ✅ |
| Orthanc DICOM port | Not in any file | `4242` (implied) | `4242` — must be added |
| OHIF HTTP port | `.env`, `pacsEnterprise.ts` | `3010` | `3010` ✅ |

---

### Duplicate URLs (Same Service, Multiple Locations)

| Service | Source A | Source B | Source C | Should be single source |
|---------|----------|----------|----------|------------------------|
| Orthanc REST URL | `.env` `ORTHANC_URL` | `pacs_settings` DB `orthanc_base_url` | `pacsEnterprise.ts` `DEFAULT_VIEWER_SETTINGS` | `.env` → seeded to DB on boot |
| OHIF URL | `.env` `OHIF_URL` | `pacs_settings` DB `ohif_base_url` | `pacsEnterprise.ts` `DEFAULT_VIEWER_SETTINGS` L195 | `.env` → seeded to DB on boot |
| WADO URL | `.env` `WADO_URL` | `pacs_settings` DB `wado_uri_base_url` | `pacsEnterprise.ts` `DEFAULT_VIEWER_SETTINGS` L198 | `.env` → seeded to DB on boot |
| Conquest host | `dimse-agent.ts` env default | `internal-radiology.ts` default | DB `pacs_settings` category `conquest` | `.env` → DB |

---

### Duplicate PACS Settings

| DB Key | Category | What It Configures | Also in |
|--------|----------|--------------------|---------|
| `ohif_base_url` | `viewer` | OHIF viewer base URL | `.env` `OHIF_URL` |
| `dicom_web_base_url` | `viewer` | DICOMweb URL for OHIF | No env equivalent — DB only |
| `wado_uri_base_url` | `viewer` | WADO URL for Weasis | `.env` `WADO_URL` |
| `weasis_manifest_url_template` | `viewer` | Full Weasis URI template | No env equivalent — DB only |
| `pacs_ip` | `viewer` | Orthanc LAN IP | `.env` in `ORTHANC_URL` |
| `pacs_port` | `viewer` | Conquest/Orthanc DICOM port | No env equivalent |
| `pacs_ae_title` | `viewer` | Orthanc/PACS AE title | No env equivalent |
| `orthanc_base_url` | `orthanc` | Orthanc HTTP URL | `.env` `ORTHANC_URL` |
| `conquest_host` | `conquest` | Conquest server IP | `.env` `CONQUEST_HOST` (missing) |
| `conquest_port` | `conquest` | Conquest DICOM port | `.env` `CONQUEST_PORT` (missing) |
| `conquest_ae` | `conquest` | Conquest AE title | `.env` `CONQUEST_AE_TITLE` (missing) |

> **Root Problem:** There are two sources of truth — `.env` (container-level) and `pacs_settings` DB (runtime). They are never synchronized automatically. The Network Control Center should eliminate this by being the single write surface that updates both.

---

### Duplicate Viewer Settings

| Setting | Reads from | Written by | Current state |
|---------|-----------|-----------|---------------|
| OHIF launch URL | DB only (`ohif_base_url`) | `load-defaults` or manual | May be empty or wrong Docker IP |
| Weasis WADO URL | DB only (`wado_uri_base_url`) | `load-defaults` or manual | Seeded with `172.16.1.139` (wrong) |
| Weasis URI template | DB only (`weasis_manifest_url_template`) | `load-defaults` or manual | Seeded with `172.16.1.139` (wrong) |
| Viewer mode (OHIF/Weasis/Both) | DB (`viewer_mode`) | `load-defaults` seeds `BOTH` | Default: `BOTH` |
| Default viewer | DB (`default_viewer`) | `load-defaults` seeds `OHIF` | Default: `OHIF` |

---

## Part 3 — IP Address Inventory

### Confirmed Production LAN IPs (from `.env`)

| IP | Service | Port | Hostname / Notes |
|----|---------|------|-----------------|
| `192.168.1.137` | Synology NAS | — | Runs all Docker containers (ERP, Orthanc PACS, OHIF) |
| `192.168.1.137` | Orthanc REST | `8042` | `care-pacs` container |
| `192.168.1.137` | OHIF Viewer | `3010` | OHIF container |
| `192.168.1.250` | Windows PC (Ollama host) | `11434` | AI model server |

### Docker Bridge IPs (Internal Only — ⚠️ Must Not Leak to Browser)

| IP | Mapped-to Service | Why Problematic |
|----|-------------------|-----------------|
| `172.16.1.139` | Orthanc `care-pacs` container | Used in `DEFAULT_VIEWER_SETTINGS` — browsers/Weasis cannot reach this |
| `172.16.1.103` | UIH MRI modality preset | Modality preset default in `DicomNodes.tsx` |
| `172.16.1.99` | CT modality preset | Modality preset default in `DicomNodes.tsx` |
| `172.16.1.46` | Voluson USG preset | Modality preset default in `DicomNodes.tsx` |
| `172.16.1.140` | Ollama fallback URL | AI reporting fallback in `AiReportingSettings.tsx` |

### Unknown / Unverified IPs

| IP | Context | Action needed |
|----|---------|--------------|
| `192.168.1.x` (unknown) | Conquest Windows host | Must be determined and added to `.env` as `CONQUEST_HOST` |

---

## Part 4 — Missing Configuration (Must Be Added)

The following settings are consumed by the codebase but have no value configured:

| Variable | Consumed by | Default used | Correct action |
|----------|------------|--------------|----------------|
| `CONQUEST_HOST` | `dimse-agent.ts`, `pacsEnterprise.ts` | `127.0.0.1` (wrong) | Add to `.env` and docker-compose |
| `CONQUEST_PORT` | `dimse-agent.ts`, `pacsEnterprise.ts` | `5678` (may be wrong) | Add to `.env` and docker-compose |
| `CONQUEST_AE_TITLE` | `dimse-agent.ts`, `pacsEnterprise.ts` | `CONQUEST` (inconsistent) | Add to `.env` and docker-compose |
| `PACS_AE_TITLE` | `pacsEnterprise.ts` L1178 | `CONQUESTPACS` | Add to `.env` and docker-compose |
| `ORTHANC_DICOM_PORT` | Not consumed yet — must be added | `4242` (implied) | Add to `.env`, code, and docker-compose |
| `AGENT_NAME` | `dimse-agent.ts` L43 | `hostname()` | Add to `.env` and docker-compose |
| `AGENT_AE_TITLE` | `dimse-agent.ts` (hardcoded as `DIAGNOCENTER`) | `DIAGNOCENTER` | Add to `.env` to make configurable |

---

## Part 5 — File Change Scope (for Standardization Plan)

Files that will need changes during standardization:

| File | Change Type | What Needs Fixing |
|------|-------------|-------------------|
| `.env` | Add variables | `CONQUEST_HOST`, `CONQUEST_PORT`, `CONQUEST_AE_TITLE`, `ORTHANC_DICOM_PORT`, `AGENT_NAME`, `AGENT_AE_TITLE`, `PACS_AE_TITLE` |
| `docker-compose.yml` | Add env passthrough | Same as above |
| `artifacts/api-server/src/routes/pacsEnterprise.ts` | Fix DEFAULT_VIEWER_SETTINGS | Replace `172.16.1.139` with `192.168.1.137`; fix `ORTHANC2` → `ORTHANC`; fix Conquest port |
| `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts` | Fix defaults | Conquest port, AE title defaults |
| `artifacts/api-server/src/routes/internal-radiology.ts` | Fix defaults | Conquest host/port/AE defaults |
| `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx` | Fix presets | All `172.16.1.x` IPs, port `5680` → canonical |
| `conquest/erp_notify.lua` | Replace placeholders | ERP URL and `INTERNAL_API_KEY` |
| `artifacts/api-server/src/app.ts` or startup | New: DB seeding | Seed `pacs_settings` from `.env` on boot |
| `artifacts/api-server/src/routes/pacsEnterprise.ts` | New endpoint | Add `weasis-launch-redirect` |

---

*End of Configuration Inventory*
