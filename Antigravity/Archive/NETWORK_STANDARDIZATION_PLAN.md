# Network Standardization Plan
**Date:** 2026-06-24  
**Derived from:** `CONFIGURATION_INVENTORY.md`, `PACS_CURRENT_STATE_REPORT.md`, `NETWORK_DEPENDENCY_AUDIT.md`  
**Purpose:** Pre-implementation plan to standardize all PACS/network configuration before building the Radiology Network Control Center  
**Status:** Documentation only — no implementation yet

---

## Executive Summary

The current PACS ecosystem has **3 structural problems**:

1. **Two sources of truth** — `.env` and the `pacs_settings` database table store the same values independently and are never synchronized. This causes viewer launches to fail even when `.env` is correctly configured.
2. **Docker bridge IPs leaked into user-facing configuration** — `172.16.1.139` (a Docker internal address) is hardcoded in 8+ places as the Orthanc address. Browsers and Weasis on radiologist workstations cannot reach this IP.
3. **No single control surface** — Network settings are scattered across `.env`, `docker-compose.yml`, 5 backend files, 4 frontend files, and a Lua script. There is no UI where an administrator can see and change all PACS network settings in one place.

The **Radiology Network Control Center** will be the solution to problem 3. This plan ensures problems 1 and 2 are resolved before that UI is built.

---

## Phase 1 — Verify Actual Hardware Values (Manual Steps Required)

> These steps must be done by the user before any code changes. The values will inform the canonical configuration.

### Step 1.1 — Verify Orthanc AE Title on Synology

**Action:** SSH into Synology or open Container Manager. Find the `care-pacs` container. Run:
```bash
docker exec care-pacs cat /etc/orthanc/orthanc.json | grep -i "aetitle\|dicomae"
```
Or check the container's environment variables for `DICOM_AE_TITLE`.

**Expected result:** Either `ORTHANC` (default) or a custom value like `ORTHANC2`.

**Record result as:** `CANONICAL_ORTHANC_AE_TITLE = ____`

---

### Step 1.2 — Verify Conquest Host IP and Port

**Action:** On the Windows PC running Conquest, open `<ConquestInstallDir>\dicom.ini` and find:
```ini
[dicom]
LocalAddress    = <IP>   ; this is the Conquest LAN IP
TCPPort         = <port> ; this is the DICOM listen port (default 5678)
MyName          = <AE>   ; this is the Conquest AE title
```

**Record results as:**
- `CANONICAL_CONQUEST_HOST = ____` (e.g., `192.168.1.20`)
- `CANONICAL_CONQUEST_PORT = ____` (e.g., `5678` or `5680`)
- `CANONICAL_CONQUEST_AE_TITLE = ____` (e.g., `CONQUESTPACS`)

---

### Step 1.3 — Verify Orthanc DICOM Port

**Action:** In Synology Container Manager, check port mappings for `care-pacs`. Orthanc's DICOM SCP port inside the container is always `4242`. Check if it's exposed externally and to which host port.

**Record result as:** `CANONICAL_ORTHANC_DICOM_PORT = ____` (host port exposed to LAN)

---

### Step 1.4 — Verify OHIF Port

**Action:** In Synology Container Manager or via browser, confirm OHIF is accessible at `http://192.168.1.137:3010`.

**Record result as:** `CANONICAL_OHIF_PORT = ____` (e.g., `3010`)

---

### Step 1.5 — Determine ERP Host Port

**Action:** Check `.env` for `HOST_PORT` (the Nginx listening port). This is the port the Conquest Lua hook must POST to.

**Record result as:** `CANONICAL_ERP_HOST_PORT = ____` (e.g., `8080`, `443`, etc.)

---

## Phase 2 — Standardization Changes

> After Phase 1 values are confirmed, apply these changes. Ordered by dependency (lowest-level first).

---

### Change 1 — Populate `.env` with Missing Conquest Variables

**Priority:** 🔴 Critical  
**Status:** Not started

**Add to `.env`:**
```ini
# ─── CONQUEST PACS ───────────────────────────────────────────────────────────
# Windows host running Conquest PACS. Fill after verifying dicom.ini
CONQUEST_HOST=192.168.1.___          # Step 1.2 result
CONQUEST_PORT=5678                   # Step 1.2 result (verify 5678 vs 5680)
CONQUEST_AE_TITLE=CONQUESTPACS       # Step 1.2 result
PACS_AE_TITLE=ORTHANC                # Step 1.1 result

# ─── ORTHANC DICOM PORT ─────────────────────────────────────────────────────
ORTHANC_DICOM_PORT=4242              # Step 1.3 result

# ─── DICOM PULL AGENT ────────────────────────────────────────────────────────
AGENT_NAME=care-diag-agent           # Human-readable agent identifier
AGENT_AE_TITLE=DIAGNOCENTER          # ERP's DICOM calling AE title
```

**Files changed:** `.env` only

---

### Change 2 — Add Missing Variables to `docker-compose.yml`

**Priority:** 🔴 Critical  
**Status:** Not started

**Add to the `care-api` service environment section:**
```yaml
CONQUEST_HOST: ${CONQUEST_HOST:-}
CONQUEST_PORT: ${CONQUEST_PORT:-5678}
CONQUEST_AE_TITLE: ${CONQUEST_AE_TITLE:-CONQUESTPACS}
PACS_AE_TITLE: ${PACS_AE_TITLE:-ORTHANC}
ORTHANC_DICOM_PORT: ${ORTHANC_DICOM_PORT:-4242}
AGENT_NAME: ${AGENT_NAME:-care-diag-agent}
AGENT_AE_TITLE: ${AGENT_AE_TITLE:-DIAGNOCENTER}
```

**Files changed:** `docker-compose.yml`

---

### Change 3 — Fix `DEFAULT_VIEWER_SETTINGS` IP Addresses

**Priority:** 🔴 Critical  
**Status:** Not started

**File:** `artifacts/api-server/src/routes/pacsEnterprise.ts` L194–207

**Current (wrong):**
```typescript
const DEFAULT_VIEWER_SETTINGS = {
  ohif_base_url: "http://192.168.1.137:3010",        // ✅ correct
  dicom_web_base_url: "http://172.16.1.139:8042/dicom-web",  // ❌ Docker bridge
  wado_uri_base_url: "http://172.16.1.139:8042/wado",        // ❌ Docker bridge
  weasis_manifest_url_template: 'weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={studyInstanceUID}"', // ❌
  pacs_ip: "172.16.1.139",           // ❌ Docker bridge
  pacs_port: "5680",                 // ⚠️ Verify Conquest port
  pacs_ae_title: "ORTHANC2",         // ⚠️ Verify Orthanc AE
  ...
};
```

**Proposed (correct):**
```typescript
const DEFAULT_VIEWER_SETTINGS = {
  ohif_base_url: process.env.OHIF_URL || "http://192.168.1.137:3010",
  dicom_web_base_url: `${process.env.ORTHANC_URL || "http://192.168.1.137:8042"}/dicom-web`,
  wado_uri_base_url: process.env.WADO_URL || "http://192.168.1.137:8042/wado",
  weasis_manifest_url_template: `weasis://$dicom:get -w "${process.env.WADO_URL || "http://192.168.1.137:8042/wado"}?studyUID={studyInstanceUID}"`,
  pacs_ip: "192.168.1.137",          // ✅ LAN IP
  pacs_port: process.env.CONQUEST_PORT || "5678",
  pacs_ae_title: process.env.PACS_AE_TITLE || "ORTHANC",
  ...
};
```

**Note:** The load-defaults endpoint will now seed dynamically from env vars instead of hardcoded values. Any existing `pacs_settings` rows seeded with `172.16.1.139` must be deleted and re-seeded after this change.

---

### Change 4 — Fix `DicomNodes.tsx` Preset IP Addresses

**Priority:** 🟡 Medium (presets only — does not affect existing DB rows)  
**Status:** Not started

**File:** `artifacts/diagnostic-erp/src/pages/DicomNodes.tsx` L249–282

**Replace ALL occurrences of `172.16.1.x`** in the QUICK_PRESETS array with the correct LAN IPs. The actual modality IPs are:
- UIH MRI: verify real IP (currently `172.16.1.103` — likely `192.168.1.103` or similar)
- CT (ct99): verify real IP (currently `172.16.1.99`)
- Voluson USG: verify real IP (currently `172.16.1.46`)
- Conquest PACS: `192.168.1.___` (Step 1.2 result)

Also change `conquestPort: 5680` to the canonical Conquest port from Step 1.2.

---

### Change 5 — Fix `dimse-agent.ts` AE Title and Conquest Defaults

**Priority:** 🔴 Critical  
**Status:** Not started

**File:** `artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts`

**Change 5a:** Replace hardcoded `"DIAGNOCENTER"` calling AE with env var:
```typescript
// Before:
const AGENT_AE_TITLE = "DIAGNOCENTER";
// After:
const AGENT_AE_TITLE = process.env.AGENT_AE_TITLE?.trim() || "DIAGNOCENTER";
```

**Change 5b:** Standardize Conquest defaults:
```typescript
// Before:
const destAeTitle = node.conquestAeTitle || process.env["CONQUEST_AE_TITLE"] || "CONQUEST";
const destHost = node.conquestHost || process.env["CONQUEST_HOST"] || "127.0.0.1";
const destPort = node.conquestPort || Number(process.env["CONQUEST_PORT"] || 5678);
// After (canonical AE):
const destAeTitle = node.conquestAeTitle || process.env["CONQUEST_AE_TITLE"] || "CONQUESTPACS";
const destHost = node.conquestHost || process.env["CONQUEST_HOST"] || "";  // fail loudly if not set
const destPort = node.conquestPort || Number(process.env["CONQUEST_PORT"] || 5678);
```

---

### Change 6 — Fix `internal-radiology.ts` Conquest Agent Config Defaults

**Priority:** 🟡 Medium  
**Status:** Not started

**File:** `artifacts/api-server/src/routes/internal-radiology.ts` L1499–1501

**Change:**
```typescript
// Before:
host:    sm["conquest_host"]    ?? "127.0.0.1",
port:    Number(sm["conquest_port"]    ?? 5678),
aeTitle: sm["conquest_ae"]      ?? "CONQUEST1",
// After:
host:    sm["conquest_host"]    ?? process.env.CONQUEST_HOST ?? "",
port:    Number(sm["conquest_port"]    ?? process.env.CONQUEST_PORT ?? 5678),
aeTitle: sm["conquest_ae"]      ?? process.env.CONQUEST_AE_TITLE ?? "CONQUESTPACS",
```

---

### Change 7 — Add `pacs_settings` DB Seeding on Server Boot

**Priority:** 🔴 Critical (resolves the .env ↔ DB sync gap)  
**Status:** Not started

**Location:** `artifacts/api-server/src/app.ts` (startup sequence) OR a new `lib/pacsSettingsSeed.ts`

**Logic:**
```typescript
// On startup — only seed if DB key is absent (never overwrite user-set values)
async function seedPacsSettingsFromEnv() {
  const seeds = [
    { key: "ohif_base_url",              category: "viewer",   env: "OHIF_URL" },
    { key: "wado_uri_base_url",          category: "viewer",   env: "WADO_URL" },
    { key: "dicom_web_base_url",         category: "viewer",   env: null,       value: `${ORTHANC_URL}/dicom-web` },
    { key: "orthanc_base_url",           category: "orthanc",  env: "ORTHANC_URL" },
    { key: "conquest_host",              category: "conquest", env: "CONQUEST_HOST" },
    { key: "conquest_port",              category: "conquest", env: "CONQUEST_PORT" },
    { key: "conquest_ae",                category: "conquest", env: "CONQUEST_AE_TITLE" },
    { key: "pacs_ae_title",              category: "viewer",   env: "PACS_AE_TITLE" },
  ];
  // For each: INSERT INTO pacs_settings ... ON CONFLICT (key, category) DO NOTHING
}
```

This ensures the DB always has values on first boot without ever stomping user overrides.

---

### Change 8 — Fix Conquest Lua Hook

**Priority:** 🔴 Critical  
**Status:** Not started

**File:** `conquest/erp_notify.lua` L31–34

**Replace:**
```lua
local ERP_URL     = "https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies"
local ERP_API_KEY = "REPLACE_WITH_YOUR_INTERNAL_API_KEY"
```

**With (after Step 1.5):**
```lua
local ERP_URL     = "http://192.168.1.137:<HOST_PORT>/api/internal/radiology/studies"
local ERP_API_KEY = "<actual INTERNAL_API_KEY from .env>"
```

**Then:** Copy the updated file to `<ConquestInstallDir>\lua\erp_notify.lua` on the Windows host and restart Conquest (or reload via `dicomserver.exe --reload`).

---

### Change 9 — Add Missing `weasis-launch-redirect` Endpoint

**Priority:** 🔴 Critical (currently causes 404 on every Weasis launch from DICOM Agent Dashboard)  
**Status:** Not started

**File:** `artifacts/api-server/src/routes/pacsEnterprise.ts`

**Add after the `weasis-launch` endpoint:**
```typescript
// GET /api/radiology/studies/:studyInstanceUID/weasis-launch-redirect
// Redirects browser to weasis:// URI directly
router.get("/studies/:studyInstanceUID/weasis-launch-redirect", async (req, res) => {
  const { studyInstanceUID } = req.params;
  // Reuse weasis-launch logic — get weasisUrl
  // Then: res.redirect(weasisUrl);
});
```

---

### Change 10 — Create Orthanc ERP Notify Lua Hook

**Priority:** 🔴 Critical (currently Orthanc → ERP sync is completely broken)  
**Status:** Not started

**New file:** `orthanc/erp_notify.lua`

**Logic** (mirrors `conquest/erp_notify.lua` but uses Orthanc Lua API):
```lua
function OnStoredInstance(instanceId, tags, metadata, origin)
  -- Only process instances from external sources (not from ERP itself)
  if origin["RequestOrigin"] == "RestApi" then return end

  local ERP_URL     = "http://192.168.1.137:<HOST_PORT>/api/internal/radiology/studies"
  local ERP_API_KEY = "<INTERNAL_API_KEY>"

  -- Build JSON body from Orthanc tags
  local body = '{"studyInstanceUID":"' .. (tags["StudyInstanceUID"] or "") .. '",...}'
  
  -- HTTP POST
  HttpPost(ERP_URL, body, { ["Content-Type"] = "application/json", ["Authorization"] = "Bearer " .. ERP_API_KEY })
end
```

**Deployment:** Place in Orthanc scripts directory. Add to `orthanc.json`:
```json
{ "LuaScripts": ["/scripts/erp_notify.lua"] }
```

---

## Phase 3 — Validation Checklist

After all changes are applied, verify each item:

| Test | Expected Result | How to Test |
|------|----------------|-------------|
| Orthanc health check | `GET /api/pacs/health` → `{ connected: true }` | ERP UI or curl |
| OHIF launch | Opens OHIF with study in browser | Click OHIF button on any worklist item |
| Weasis launch | `weasis://` URI opens Weasis on workstation | Click Weasis button on any worklist item |
| Weasis redirect | No 404 from DICOM Agent Dashboard | Click Weasis link in DicomAgentDashboard |
| Conquest C-ECHO | `POST /api/radiology/modalities/:id/echo-test` → `ok: true` | Run echo test from DICOM Nodes page |
| MWL procedure created | Billing creates procedure in `radiology_scheduled_procedures` | Place a radiology order in Billing |
| DICOM PDF archival | `pacs_archive_status = success` after report finalized | Finalize a report and check DB |
| Conquest → ERP push | New Conquest study appears in PACS Worklist within 30s | Send a test DICOM from a modality to Conquest |
| Orthanc → ERP push | New Orthanc study appears in PACS Worklist within 30s | Send a test DICOM from a modality to Orthanc |
| Agent heartbeat | `GET /api/dicom-agent/status` shows last heartbeat < 5 min | Check DICOM Agent Dashboard |

---

## Radiology Network Control Center — UI Design

### Purpose

A unified administrative UI page where the Synology ERP administrator can:
- View real-time health of all PACS/network components
- Edit all canonical configuration values in one place
- Run connectivity tests (C-ECHO, TCP ping, HTTP health)
- See the data flow status for each pathway

### Page Location
Route: `/radiology/network-control-center`  
Nav: Settings → PACS & DICOM → Network Control Center  
Access: Admin / Radiologist with `/dicom-nodes` permission

---

### UI Wireframe (Text-Based)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  🏥  RADIOLOGY NETWORK CONTROL CENTER                          [Last refresh: 18:39] ║
║  Care Diagnostics · Synology DS1522+                          [Refresh All ↻] ║
╚══════════════════════════════════════════════════════════════════════════════╝

┌─ NETWORK TOPOLOGY (live flow map) ─────────────────────────────────────────┐
│                                                                              │
│  [MR UIH]──────┐                                                             │
│  [CT ct99]─────┤──→  [CONQUEST]──→  [ERP WORKLIST]  ←──  [ORTHANC]  ←──[MR]│
│  [US Voluson]──┘         ↑                ↓                   ↑             │
│                      Lua Hook        PACS Archive         Study Push         │
│                     (live/dead)    (PDF → Orthanc)       (hook missing)      │
│                                                                              │
│  STATUS LEGEND:  ●GREEN = CONNECTED   ●AMBER = DEGRADED   ●RED = BROKEN    │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 1: MODALITIES ──────────────────────────────────────────────────────┐
│ + Add Modality                                                                │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────┐             │
│  │ NAME    │ TYPE │ IP            │ PORT │ AE TITLE │ STATUS    │ ACTIONS │   │
│  │─────────┼──────┼───────────────┼──────┼──────────┼───────────┼─────────│   │
│  │ UIH MRI │ MR   │ 192.168.1.103 │ 3333 │ UIH      │ ● ONLINE  │ [Echo] [Edit] [Delete] │
│  │ CT-99   │ CT   │ 192.168.1.99  │ 4006 │ ct99     │ ● ONLINE  │ [Echo] [Edit] [Delete] │
│  │ Voluson │ US   │ 192.168.1.46  │ 104  │ Voluson  │ ⊘ OFFLINE │ [Echo] [Edit] [Delete] │
│  └──────────────────────────────────────────────────────────────┘             │
│                                                                               │
│  [Echo All]  Last C-ECHO run: 2 hours ago                                    │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 2: ORTHANC PACS ───────────────────────────────────────────────────┐
│                                                                               │
│  ┌─────────────────────────────────────────────────────────┐                 │
│  │ HTTP URL:        http://192.168.1.137:8042              │ [Test ↻]        │
│  │ DICOM Port:      4242                                   │                  │
│  │ AE Title:        ORTHANC                                │                  │
│  │ Username:        admin                                   │                  │
│  │ Password:        ••••••                                  │                  │
│  └─────────────────────────────────────────────────────────┘                 │
│                                                                               │
│  ┌─ ORTHANC HEALTH ──────────────────────────────────────┐                   │
│  │  HTTP REST:   ● REACHABLE    Response: 200ms           │                   │
│  │  DICOM SCP:   ● C-ECHO OK    Latency: 12ms            │                   │
│  │  Studies:     1,247 stored                             │                   │
│  │  Disk used:   47.2 GB                                  │                   │
│  └────────────────────────────────────────────────────────┘                   │
│                                                                               │
│  ┌─ ORTHANC → ERP SYNC ──────────────────────────────────┐                   │
│  │  Hook status:   ● NOT CONFIGURED                       │                   │
│  │  Hook file:     orthanc/erp_notify.lua  [Download]     │                   │
│  │  Last sync:     Never                                  │                   │
│  │  ⚠ Lua hook is not deployed. Studies received by      │                   │
│  │    Orthanc will NOT appear in the ERP worklist.        │                   │
│  └────────────────────────────────────────────────────────┘                   │
│                                                                               │
│  [Save Orthanc Settings]  [Load Defaults]                                    │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 3: CONQUEST PACS ──────────────────────────────────────────────────┐
│                                                                               │
│  ┌─────────────────────────────────────────────────────────┐                 │
│  │ Host IP:         192.168.1.___                          │ [Test ↻]        │
│  │ DICOM Port:      5678                                   │                  │
│  │ AE Title:        CONQUESTPACS                           │                  │
│  │ CGI URL:         http://192.168.1.___:8080/cgi-bin/dgate│                  │
│  └─────────────────────────────────────────────────────────┘                 │
│                                                                               │
│  ┌─ CONQUEST HEALTH ─────────────────────────────────────┐                   │
│  │  TCP Probe:     ⊘ UNREACHABLE   (host not configured)  │                   │
│  │  C-ECHO:        ⊘ NOT TESTED                          │                   │
│  │  HTTP CGI:      ⊘ NOT TESTED                          │                   │
│  └────────────────────────────────────────────────────────┘                   │
│                                                                               │
│  ┌─ CONQUEST → ERP SYNC ─────────────────────────────────┐                   │
│  │  Hook file:     conquest/erp_notify.lua  [Download]    │                   │
│  │  Hook status:   ● NOT CONFIGURED (placeholder URL)     │                   │
│  │  ERP endpoint:  http://192.168.1.137:__/api/internal/  │                   │
│  │  API Key:       ••••••••••••••••  [Copy]               │                   │
│  │  Last sync:     Never                                  │                   │
│  │  ⚠ Update erp_notify.lua with the ERP URL and API key │                   │
│  │    before deploying to Conquest.                       │                   │
│  └────────────────────────────────────────────────────────┘                   │
│                                                                               │
│  [Save Conquest Settings]                                                    │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 4: OHIF VIEWER ────────────────────────────────────────────────────┐
│                                                                               │
│  ┌─────────────────────────────────────────────────────────┐                 │
│  │ OHIF Base URL:     http://192.168.1.137:3010            │ [Test ↻] [Open] │
│  │ DICOMweb URL:      http://192.168.1.137:8042/dicom-web  │                  │
│  │ URL Template:      {OHIF_BASE_URL}/viewer?StudyInstance  │                  │
│  │ Study URL preview: http://192.168.1.137:3010/viewer?... │                  │
│  └─────────────────────────────────────────────────────────┘                 │
│                                                                               │
│  ┌─ OHIF HEALTH ─────────────────────────────────────────┐                   │
│  │  HTTP Probe:    ● REACHABLE    Response: 340ms         │                   │
│  │  Test launch:   [Open test study in OHIF]              │                   │
│  └────────────────────────────────────────────────────────┘                   │
│                                                                               │
│  [Save OHIF Settings]                                                        │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 5: WEASIS VIEWER ──────────────────────────────────────────────────┐
│                                                                               │
│  ┌─────────────────────────────────────────────────────────┐                 │
│  │ WADO Base URL:     http://192.168.1.137:8042/wado       │ [Test ↻]       │
│  │ URI Template:      weasis://$dicom:get -w "{WADO}?...   │                  │
│  │ URI preview:       weasis://$dicom:get -w "http://...   │                  │
│  │                                                         │                  │
│  │ ⓘ Weasis must be installed on each radiologist's PC.   │                  │
│  │   Download: https://weasis.org                          │                  │
│  └─────────────────────────────────────────────────────────┘                 │
│                                                                               │
│  ┌─ WEASIS TEST ─────────────────────────────────────────┐                   │
│  │  Protocol check:  [Test weasis:// handler]             │                   │
│  │  WADO endpoint:   ● REACHABLE (via Orthanc)            │                   │
│  └────────────────────────────────────────────────────────┘                   │
│                                                                               │
│  [Save Weasis Settings]                                                      │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 6: ERP SYNC STATUS ────────────────────────────────────────────────┐
│                                                                               │
│  ┌─ DICOM PULL AGENT ──────────────────────────────────────────────────────┐ │
│  │  Agent name:    care-diag-agent                                          │ │
│  │  Agent AE:      DIAGNOCENTER                                             │ │
│  │  Status:        ● RUNNING                                                │ │
│  │  Last heartbeat: 2 min ago                                               │ │
│  │  Jobs today:    12 completed · 0 failed                                  │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─ DATA FLOW STATUS ────────────────────────────────────────────────────┐   │
│  │  Pathway                         Status        Last event              │   │
│  │  ─────────────────────────────────────────────────────────────────   │   │
│  │  Conquest → ERP Worklist:        ● NOT CONFIGURED (hook not deployed) │   │
│  │  Orthanc → ERP Worklist:         ● NOT CONFIGURED (no Orthanc hook)   │   │
│  │  ERP Billing → MWL:              ✅ WORKING     Last: 14:32           │   │
│  │  ERP Report → Orthanc PDF:       ✅ WORKING     Last: 16:10           │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌─ MWL STATUS ──────────────────────────────────────────────────────────┐   │
│  │  Scheduled today:    8                                                  │   │
│  │  Sent to PACS:       0  ⚠ MWL push not implemented                    │   │
│  │  Completed:          3                                                  │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 7: NETWORK HEALTH DASHBOARD ───────────────────────────────────────┐
│                                                                               │
│  Service              IP                Port   Protocol  Status   Latency    │
│  ────────────────────────────────────────────────────────────────────────    │
│  Orthanc REST         192.168.1.137     8042   HTTP      ● OK     200ms     │
│  Orthanc DICOM SCP    192.168.1.137     4242   DICOM     ● OK     12ms      │
│  OHIF Viewer          192.168.1.137     3010   HTTP      ● OK     340ms     │
│  Weasis WADO          192.168.1.137     8042   HTTP      ● OK     via Orthanc│
│  Conquest DICOM SCP   192.168.1.???     5678   DICOM     ⊘ UNCONFIGURED    │
│  Conquest HTTP CGI    192.168.1.???     8080   HTTP      ⊘ UNCONFIGURED    │
│  Ollama AI            192.168.1.250     11434  HTTP      ● OK     45ms      │
│                                                                               │
│  [Run Full Network Scan]   [Export Health Report]                            │
│                                                                               │
│  ┌─ CONFIGURATION WARNINGS ─────────────────────────────────────────────┐   │
│  │  🔴 Conquest Lua hook has placeholder URL — ERP sync not working      │   │
│  │  🔴 Orthanc Lua hook not deployed — Orthanc → ERP sync broken         │   │
│  │  🔴 CONQUEST_HOST not set — DICOM puller cannot connect to Conquest   │   │
│  │  🟡 Weasis WADO URL seeded with Docker bridge IP — may not work       │   │
│  │  🟡 ORTHANC_PASSWORD is empty — Orthanc auth may be open              │   │
│  │  🟡 MWL push to PACS not implemented — worklist not delivered         │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

### Component Breakdown

#### Top Bar
- Page title + last refresh timestamp
- "Refresh All" button — runs all health checks simultaneously
- Warning badge showing count of active configuration issues

#### Network Topology Map
- Visual flow diagram showing all data pathways
- Each pathway colored green/amber/red based on health check result
- Live animated pulse when data is flowing
- Static broken-line visual when a pathway is unconfigured/broken

#### Section 1 — Modalities
- Table of all registered DICOM nodes (`dicom_nodes` table)
- Per-row: C-ECHO test button, Edit, Delete
- "Echo All" button at top
- Add/Edit modal with: name, type, IP, port, AE title, Conquest destination (host/port/AE)

#### Section 2 — Orthanc PACS
- Editable form: HTTP URL, DICOM port, AE title, credentials
- Live health panel: HTTP reachability, C-ECHO result, storage stats
- Orthanc → ERP Sync sub-panel: hook deployment status + download button for ready-to-deploy Lua file

#### Section 3 — Conquest PACS
- Editable form: host IP, DICOM port, AE title, CGI URL
- Live health panel: TCP probe, C-ECHO, CGI reachability
- Conquest → ERP Sync sub-panel: hook download + pre-filled with real ERP URL and API key

#### Section 4 — OHIF Viewer
- Editable form: OHIF URL, DICOMweb URL, URL template
- Live preview of generated study URL
- HTTP health check + test launch button

#### Section 5 — Weasis Viewer
- Editable form: WADO URL, URI template
- Live preview of generated `weasis://` URI
- WADO endpoint reachability check
- Protocol handler test link

#### Section 6 — ERP Sync Status
- DICOM Pull Agent status (heartbeat, job counts)
- Data flow status table for all 4 pathways
- MWL status summary

#### Section 7 — Network Health Dashboard
- Full service grid with latency
- "Run Full Network Scan" — runs all probes simultaneously
- Configuration Warnings panel — auto-populated from detected issues in config

---

### Data Sources for Each Section

| Section | Read from | Write to |
|---------|-----------|---------|
| Modalities | `dicom_nodes` DB table | `dicom_nodes` DB table |
| Orthanc config | `pacs_settings` (category: `orthanc`) + `.env` | `pacs_settings` DB |
| Conquest config | `pacs_settings` (category: `conquest`) + `.env` | `pacs_settings` DB |
| OHIF config | `pacs_settings` (category: `viewer`) | `pacs_settings` DB |
| Weasis config | `pacs_settings` (category: `viewer`) | `pacs_settings` DB |
| ERP Sync status | `pacs_logs` table + `dicom_pull_agent_status` | Read-only |
| MWL status | `radiology_scheduled_procedures` | Read-only |
| Network health | Live HTTP/TCP probes | Read-only |
| Config warnings | Derived from all above | Read-only |

---

### New Backend Endpoints Required

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/radiology/network/health` | GET | Run all probes, return unified health object |
| `/api/radiology/network/health/:service` | GET | Run probe for single service (orthanc/conquest/ohif/weasis) |
| `/api/radiology/network/settings` | GET | Return all `pacs_settings` + env-derived values |
| `/api/radiology/network/settings` | PATCH | Update settings (writes to DB, validates IP/port) |
| `/api/radiology/network/warnings` | GET | Return computed list of config warnings |
| `/api/radiology/network/lua-hook/conquest` | GET | Return ready-to-use `erp_notify.lua` with ERP URL + key pre-filled |
| `/api/radiology/network/lua-hook/orthanc` | GET | Return ready-to-use `orthanc_erp_notify.lua` |
| `/api/radiology/studies/:uid/weasis-launch-redirect` | GET | Redirect to `weasis://` URI (fix 404) |

---

### Implementation Sequence (When Ready)

1. **Phase 1** (Manual — user action): Verify hardware values (Orthanc AE, Conquest port/IP, etc.)
2. **Phase 2** (Code): Apply Changes 1–9 from this plan (env, docker-compose, backend fixes)
3. **Phase 3** (Code): Build Network Control Center frontend + new backend endpoints
4. **Phase 4** (Manual — user action): Deploy Lua hooks to Conquest and Orthanc
5. **Phase 5** (Validation): Run the full checklist from Phase 3 of this plan

---

*End of Network Standardization Plan*
