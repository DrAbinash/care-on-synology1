# Network Dependency Audit
**Date:** 2026-06-24  
**Checkpoint:** `4d0ceba` — `pre-pacs-audit restore point`  
**Scope:** Care Diagnostics ERP — all source code, config, docker, scripts, docs  
**Auditor:** Antigravity (read-only — no changes made)

---

## Summary

| Category | Count | Notes |
|----------|-------|-------|
| IP Addresses (LAN `192.168.1.x`) | 6 | Scattered across env, code, frontend |
| IP Addresses (Docker Bridge `172.16.1.x`) | 8 | Hardcoded in DEFAULT settings — problematic |
| IP Addresses (loopback `127.0.0.1`) | 3 | Agent fallback defaults |
| Ports | 14 unique ports | 8042, 3010, 5680, 4242, 5678, 11434, etc. |
| AE Titles | 7 unique | ORTHANC, ORTHANC2, CONQUEST, DIAGNOCENTER, UIH, ct99, Voluson |
| Orthanc URLs | 4 locations | .env, docker-compose, pacsEnterprise.ts, viewerService.ts |
| OHIF URLs | 3 locations | .env, pacsEnterprise.ts, pacs.ts |
| Weasis URLs | 3 locations | pacsEnterprise.ts, viewerService.ts, AgentSetup.tsx |
| Conquest URLs | 3 locations | erp_notify.lua (placeholder), dimse-agent.ts, pacsEnterprise.ts |
| ERP Internal URLs | 2 locations | erp_notify.lua, conquest_after_import.lua |
| localhost references | 5 | dimse-agent.ts defaults, AiInferenceSettings placeholder |
| Cloudflare references | 0 | None found |
| Tailscale references | 0 | None found |

---

## 1. Environment Files

### `.env` (Active Production Config)

| Variable | Value | Used By |
|----------|-------|---------|
| `ORTHANC_URL` | `http://192.168.1.137:8042` | `pacs.ts`, `pacsEnterprise.ts`, `pacsArchive.ts` |
| `ORTHANC_USERNAME` | `admin` | same as above |
| `ORTHANC_PASSWORD` | *(empty)* | ⚠️ No password set |
| `PACS_PROVIDER` | `orthanc` | `providers.ts` |
| `PACS_VIEWER_TYPE` | `ohif` | `pacs.ts` GET /config |
| `OHIF_URL` | `http://192.168.1.137:3010` | **NOT used by launch endpoints** (DB-only) |
| `WADO_URL` | `http://192.168.1.137:8042/wado` | docker-compose passes through; not used by viewer launch |

**Missing variables (not in `.env`):**

| Variable | Expected Value | Used Where |
|----------|---------------|------------|
| `CONQUEST_HOST` | e.g. `192.168.1.x` | `dimse-agent.ts` L486, `pacsEnterprise.ts` L1176 |
| `CONQUEST_PORT` | `5678` or `5680` | `dimse-agent.ts` L487 |
| `CONQUEST_AE_TITLE` | e.g. `CONQUESTPACS` | `pacsEnterprise.ts` L1178 |
| `PACS_AE_TITLE` | e.g. `ORTHANC` | `pacsEnterprise.ts` L1178 fallback |
| `AGENT_NAME` | e.g. `care-diag-agent` | `dimse-agent.ts` L43 |

---

### `.env.example` (Template)

| Line | Content | Note |
|------|---------|------|
| 37–42 | `ORTHANC_URL=http://192.168.1.137:8042` (commented) | Matches `.env` |
| 46 | `OHIF_URL=http://192.168.1.137:3010` (commented) | Matches `.env` |
| 47 | `WADO_URL=http://192.168.1.137:8042/wado` (commented) | Matches `.env` |
| 66 | `OLLAMA_PRIMARY_URL=http://192.168.1.250:11434` (commented) | Ollama Windows PC |
| 78 | `OLLAMA_BASE_URL=http://192.168.1.250:11434` | Open WebUI Ollama |

---

## 2. Docker Compose (`docker-compose.yml`)

### Variables Passed to API Container

| Variable | Value | Port |
|----------|-------|------|
| `ORTHANC_URL` | `${ORTHANC_URL:-}` (from .env) | 8042 (HTTP) |
| `ORTHANC_USERNAME` | `${ORTHANC_USERNAME:-}` | — |
| `ORTHANC_PASSWORD` | `${ORTHANC_PASSWORD:-}` | — |
| `PACS_PROVIDER` | `${PACS_PROVIDER:-orthanc}` | — |
| `PACS_VIEWER_TYPE` | `${PACS_VIEWER_TYPE:-ohif}` | — |
| `OHIF_URL` | `${OHIF_URL:-}` | 3010 |
| `WADO_URL` | `${WADO_URL:-}` | — |

**⚠️ Gaps in docker-compose env passthrough:**
- `CONQUEST_HOST`, `CONQUEST_PORT`, `CONQUEST_AE_TITLE` — not listed in docker-compose
- `PACS_AE_TITLE` — not listed
- `AGENT_NAME` — not listed

---

## 3. Backend — IP Addresses & Ports

### `artifacts/api-server/src/routes/pacsEnterprise.ts`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L195 | `http://192.168.1.137:3010` | OHIF Base URL | DEFAULT_VIEWER_SETTINGS `ohif_base_url` |
| L196 | `http://172.16.1.139:8042/dicom-web` | DICOMweb URL | DEFAULT_VIEWER_SETTINGS `dicom_web_base_url` ⚠️ Docker bridge IP |
| L198 | `http://172.16.1.139:8042/wado` | WADO URI | DEFAULT_VIEWER_SETTINGS `wado_uri_base_url` ⚠️ Docker bridge IP |
| L199 | `http://172.16.1.139:8042/weasis?studyUID=...` | Weasis manifest URL | DEFAULT_VIEWER_SETTINGS ⚠️ Docker bridge IP |
| L200 | `172.16.1.139` | PACS IP | DEFAULT_VIEWER_SETTINGS `pacs_ip` ⚠️ Docker bridge IP |
| L201 | `5680` | PACS Port | DEFAULT_VIEWER_SETTINGS `pacs_port` |
| L202 | `ORTHANC2` | AE Title | DEFAULT_VIEWER_SETTINGS `pacs_ae_title` |
| L1176 | `CONQUEST_HOST` env | Conquest host | C-FIND findscu fallback |
| L1177 | `CONQUEST_PORT` env (default `"5678"`) | Conquest port | C-FIND findscu fallback |
| L1178 | `CONQUEST_AE_TITLE` env (default `"CONQUESTPACS"`) | Conquest AE | C-FIND findscu |

### `artifacts/api-server/src/routes/pacs.ts`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L21 | `process.env.ORTHANC_URL` | env | All Orthanc REST proxy calls |
| L208 | `process.env.WADO_URL` | env | Weasis URL builder fallback |
| L210 | `weasis://$dicom:get -r` | Protocol | Weasis URI scheme |
| L218 | `process.env.OHIF_URL` | env | OHIF URL in weasis-url endpoint |

### `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L63 | `127.0.0.1` | Loopback | getPrimaryIp() fallback when no network interface found |
| L485 | `CONQUEST_AE_TITLE` env (default `"CONQUEST"`) | AE Title | C-MOVE destination |
| L486 | `CONQUEST_HOST` env (default `"127.0.0.1"`) | IP | C-MOVE destination ⚠️ loopback default |
| L487 | `CONQUEST_PORT` env (default `5678`) | Port | C-MOVE destination |
| L126 | `"DIAGNOCENTER"` | AE Title | Calling AE for echoscu `-aet` |
| L101 | `modality.aeTitle ?? "DIAGNOCENTER"` | AE Title | Called AE for C-ECHO `-aec` fallback |

### `artifacts/api-server/src/routes/internal-radiology.ts`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L1499 | `127.0.0.1` | Loopback | Default conquest host in agent config endpoint |
| L1500 | `5678` | Port | Default conquest port in agent config endpoint |
| L1501 | `CONQUEST1` | AE Title | Default conquest AE in agent config endpoint |

### `artifacts/api-server/src/lib/pacsArchive.ts`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L14 | `process.env.ORTHANC_URL` | env | Orthanc STOW-RS upload endpoint |
| L176 | `${url}/tools/create-dicom` | URL path | Orthanc API for encapsulated PDF creation |

---

## 4. Frontend — IP Addresses & Ports

### `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L249 | `172.16.1.103` | IP | MR modality (UIH) default host ⚠️ Docker bridge |
| L252 | `172.16.1.139` | IP | Conquest PACS default host ⚠️ Docker bridge |
| L252 | `5680` | Port | Conquest PACS default port |
| L252 | `ORTHANC2` | AE Title | Conquest destination AE |
| L260 | `172.16.1.99` | IP | CT modality (ct99) default host ⚠️ Docker bridge |
| L263 | `172.16.1.139` | IP | Conquest destination host ⚠️ Docker bridge |
| L263 | `5680` | Port | Conquest destination port |
| L271 | `172.16.1.46` | IP | US modality (Voluson) default host ⚠️ Docker bridge |
| L274 | `172.16.1.139` | IP | Conquest destination host ⚠️ Docker bridge |
| L274 | `5680` | Port | Conquest destination port |
| L282 | `172.16.1.139` | IP | Conquest PACS node host ⚠️ Docker bridge |
| L282 | `5680` | Port | Conquest PACS node port |
| L282 | `ORTHANC2` | AE Title | Conquest PACS node AE |

**⚠️ Critical:** ALL hardcoded modality and Conquest defaults use `172.16.1.x` (Docker bridge) IPs. These are **preset values** shown when a user adds a new DICOM node. The actual values in the DB may differ if already configured.

### `artifacts/diagnostic-erp/src/pages/AiReportingSettings.tsx`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L237 | `http://192.168.1.250:11434` | Ollama primary | AI reporting primary URL |
| L238 | `http://172.16.1.140:11434` | Ollama fallback | AI reporting fallback URL ⚠️ Docker bridge |
| L572 | `http://192.168.1.250:11434` | Placeholder | Ollama URL input placeholder |
| L583 | `http://172.16.1.140:11434` | Placeholder | Ollama fallback placeholder ⚠️ Docker bridge |

### `artifacts/diagnostic-erp/src/pages/AgentSetup.tsx`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L200 | `http://192.168.1.10:8080/wado` | Example | Conquest WADO URL example in docs |
| L201 | `http://192.168.1.10:8042/wado` | Example | Orthanc WADO URL example in docs |
| L204 | `weasis://$dicom:get -w "http://192.168.1.10:8080/wado"` | Example | Weasis test URI in docs |
| L214 | `http://192.168.1.10:3000` | Example | OHIF example URL |
| L216 | `http://192.168.1.10:8042/dicom-web` | Example | Orthanc DICOMweb example |
| L222 | `http://192.168.1.10:3000/viewer?StudyInstanceUIDs=...` | Example | OHIF full URL example |

> Note: `192.168.1.10` in AgentSetup is documentation/examples only — not functional configuration.

### `artifacts/diagnostic-erp/src/pages/AiInferenceSettings.tsx`

| Line | Value | Type | Used For |
|------|-------|------|---------|
| L200 | `http://localhost:8080/predict` | Placeholder | AI inference endpoint placeholder |
| L204 | `http://192.168.1.50:8080/v1/infer` | Example | AI inference example |

---

## 5. Conquest Integration

### `conquest/erp_notify.lua`

| Line | Value | Type | Status |
|------|-------|------|--------|
| L31 | `https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies` | ERP URL | ❌ Placeholder — never configured |
| L34 | `REPLACE_WITH_YOUR_INTERNAL_API_KEY` | API Key | ❌ Placeholder — never configured |

### `docs/conquest_after_import.lua`

| Line | Value | Type | Status |
|------|-------|------|--------|
| (URL similar to above) | Likely placeholder | ERP URL | Review needed |

### `CONQUEST_SETUP.md`

| Reference | Value |
|-----------|-------|
| Default Conquest install | `C:\Conquest\` |
| Hook file location | `<ConquestInstallDir>\lua\erp_notify.lua` |
| Config file | `dicom.ini` → `LuaConvertScript = lua\erp_notify.lua` |

---

## 6. OHIF Viewer References

| Location | Value | Type | Notes |
|----------|-------|------|-------|
| `.env` L97 | `http://192.168.1.137:3010` | OHIF_URL env | ⚠️ Not read by viewer launch endpoints |
| `pacsEnterprise.ts` L195 | `http://192.168.1.137:3010` | OHIF Base URL | DEFAULT_VIEWER_SETTINGS — seeded to DB |
| `pacs.ts` L218 | `process.env.OHIF_URL` | env | Used in `/studies/:id/weasis-url` endpoint response |
| `docker-compose.yml` L246 | `${OHIF_URL:-}` | env passthrough | Passed to container |
| AgentSetup.tsx L214 | `http://192.168.1.10:3000` | Example only | Documentation |
| `viewerService.ts` L7–16 | DB key `ohif_base_url` | DB | Actual launch URL source |

---

## 7. Weasis Viewer References

| Location | Value | Type | Notes |
|----------|-------|------|-------|
| `pacsEnterprise.ts` L199 | `weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={uid}"` | Template | ⚠️ Docker bridge IP |
| `pacs.ts` L210 | `weasis://$dicom:get -r "{wado}?requestType=WADO&studyUID={uid}&contentType=application/dicom"` | URI | WADO-URI scheme |
| `viewerService.ts` L21–33 | DB key `weasis_manifest_url_template` | DB | Actual launch source |
| `viewerService.ts` L30 | DB key `conquest_wado_base_url` | DB | Conquest WADO fallback |
| `AgentSetup.tsx` L204 | `weasis://$dicom:get -w "http://192.168.1.10:8080/wado"` | Example | Documentation |

---

## 8. ERP Internal API URLs (Server-to-Server)

| Location | Value | Purpose |
|----------|-------|---------|
| `conquest/erp_notify.lua` L31 | `https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies` | Conquest → ERP study push ❌ Placeholder |
| Expected production value | `http://192.168.1.137:<HOST_PORT>/api/internal/radiology/studies` | Conquest → ERP study push |

---

## 9. Synology / Container Network References

| Location | Reference | Context |
|----------|-----------|---------|
| `.env` L1 | `# Care Diagnostics ERP - Synology / Container Manager .env` | Header comment |
| `.env` L21 | `Synology host port 5432 was already in use, so host port 5400 is used` | DB port comment |
| `.env` L87–88 | `care-pacs = Orthanc PACS container on Synology` | Architecture note |
| `.env` L88 | `LAN IP: 192.168.1.137:8042` | Orthanc LAN |
| `.env` L89 | `Docker/Alt IP: 172.16.1.139:8042` | Orthanc Docker bridge |
| `.env.example` L49 | `Allow API container to call LAN IPs (required for Orthanc on same LAN)` | Network note |

---

## 10. localhost / 127.0.0.1 References

| Location | Line | Value | Context |
|----------|------|-------|---------|
| `dimse-agent.ts` | L63 | `127.0.0.1` | fallback when no network interface detected |
| `dimse-agent.ts` | L486 | `CONQUEST_HOST` env default `"127.0.0.1"` | C-MOVE destination fallback |
| `internal-radiology.ts` | L1499 | `127.0.0.1` | Conquest config endpoint default |
| `AiInferenceSettings.tsx` | L200 | `http://localhost:8080/predict` | UI placeholder text only |

---

## 11. Port Registry — All Ports Found

| Port | Protocol | Service | Location |
|------|----------|---------|---------|
| `8042` | HTTP | Orthanc REST API | `.env`, `pacsEnterprise.ts`, `viewerService.ts`, `DicomNodes.tsx` |
| `4242` | DICOM | Orthanc DICOM SCP | Implicit (Orthanc default) — **not in any config file** |
| `3010` | HTTP | OHIF Viewer | `.env`, `pacsEnterprise.ts` DEFAULT_VIEWER_SETTINGS |
| `5680` | DICOM | Conquest PACS DICOM SCP | `DicomNodes.tsx` presets, `pacsEnterprise.ts` L201 |
| `5678` | DICOM | Conquest PACS (alternate) | `dimse-agent.ts` L487, `internal-radiology.ts` L1500 |
| `5400` | TCP | PostgreSQL (host port) | `.env` comment |
| `5432` | TCP | PostgreSQL (container port) | Standard |
| `11434` | HTTP | Ollama LLM server | `AiReportingSettings.tsx`, `.env.example` |
| `3333` | DICOM | UIH MRI modality | `DicomNodes.tsx` L249 |
| `4006` | DICOM | CT modality (ct99) | `DicomNodes.tsx` L260 |
| `104` | DICOM | Voluson USG | `DicomNodes.tsx` L271 |
| `8080` | HTTP | Conquest HTTP CGI / AI inference | `AgentSetup.tsx` example, `AiInferenceSettings.tsx` placeholder |
| `3000` | HTTP | OHIF (old default) | `AgentSetup.tsx` examples |
| `8888` | HTTP | Jupyter / misc | Not found — mentioned in earlier docs only |

**⚠️ Port Discrepancy:** Conquest port is `5680` in `DicomNodes.tsx` presets vs `5678` in `dimse-agent.ts` and `internal-radiology.ts` defaults. One is wrong.

---

## 12. AE Title Registry

| AE Title | Type | Where | Notes |
|----------|------|-------|-------|
| `ORTHANC` | PACS SCP | Orthanc default | Not explicitly in codebase |
| `ORTHANC2` | PACS SCP | `DicomNodes.tsx` L252, `pacsEnterprise.ts` L202 | Non-standard — must match Orthanc config |
| `CONQUEST` | PACS SCP | `dimse-agent.ts` L485 default | Generic fallback |
| `CONQUESTPACS` | PACS SCP | `pacsEnterprise.ts` L1178 | C-FIND findscu default |
| `CONQUEST1` | PACS SCP | `internal-radiology.ts` L1501 | Agent config endpoint default |
| `DIAGNOCENTER` | SCU (ERP) | `dimse-agent.ts` L126, L101 | ERP's calling AE title — used in C-ECHO, C-MOVE |
| `UIH` | Modality SCU | `DicomNodes.tsx` L249 | MR modality preset |
| `ct99` | Modality SCU | `DicomNodes.tsx` L260 | CT modality preset |
| `Voluson` | Modality SCU | `DicomNodes.tsx` L271 | USG modality preset |

**⚠️ AE Title Inconsistency:** Three different AE Titles are used for "Conquest PACS": `CONQUEST`, `CONQUESTPACS`, and `CONQUEST1` across three files. One canonical AE title must be decided and standardized.

---

## 13. Cloudflare & Tailscale

**No Cloudflare or Tailscale references found** in any source code, configuration, docker-compose, or documentation files within the workspace.

> Note: `.env.example` L74 mentions `"NOTE: Ollama port 11434 must NOT be exposed publicly via Cloudflare Tunnel"` — indicating Cloudflare Tunnel may be in use on the Synology, but no Cloudflare-specific URLs or tokens were found in the codebase itself.

---

## 14. Summary of Critical Issues

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `172.16.1.139` Docker bridge IP hardcoded in 5+ locations in `pacsEnterprise.ts` DEFAULT_VIEWER_SETTINGS and `DicomNodes.tsx` presets | 🔴 High | Replace with `192.168.1.137` (LAN IP) |
| 2 | Conquest Lua hook (`erp_notify.lua`) has placeholder URL and API key — never deployed | 🔴 High | Update with real ERP URL and `INTERNAL_API_KEY` |
| 3 | `OHIF_URL` and `WADO_URL` in `.env` are not read by OHIF/Weasis launch endpoints | 🟡 Medium | Add DB seeding on startup from env vars |
| 4 | `CONQUEST_HOST/PORT/AE_TITLE` missing from `.env` — agent defaults to `127.0.0.1:5678` | 🔴 High | Add to `.env` and docker-compose |
| 5 | Port discrepancy: `5680` vs `5678` for Conquest across different files | 🟡 Medium | Standardize to actual Conquest port |
| 6 | AE Title inconsistency: `CONQUEST` vs `CONQUESTPACS` vs `CONQUEST1` | 🟡 Medium | Standardize to one AE title |
| 7 | `ORTHANC2` used as AE title in defaults but Orthanc's default AE is `ORTHANC` | 🟡 Medium | Verify actual Orthanc AE title |
| 8 | `ORTHANC_PASSWORD` is empty in `.env` | 🟡 Medium | Set password if Orthanc auth is enabled |
| 9 | `weasis-launch-redirect` endpoint referenced in frontend but does not exist | 🔴 High | Add redirect endpoint or fix frontend link |
| 10 | Playwright Chromium likely not installed in Docker container (DICOM PDF archival) | 🔴 High | Add to Dockerfile |

---

*End of Network Dependency Audit*
