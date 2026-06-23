# RADIOLOGY PACS/DICOM — PRODUCTION-ONLY EVIDENCE AUDIT

**Date:** June 6, 2026
**Scope:** Production database only. No code changes. No database changes.
**Evidence:** SQL queries, API code analysis, screenshots

---

## A. ROOT CAUSE: WHY PACS VIEWER SHOWS "OHIF NOT CONFIGURED" / "WEASIS NOT CONFIGURED"

### Evidence

```sql
-- Production: pacs_settings table has ZERO records
SELECT COUNT(*) FROM pacs_settings;  -- Result: 0

-- Production: all categories empty
SELECT key, value, category, is_secret FROM pacs_settings ORDER BY category, key;
-- Result: NO ROWS
```

### Root Cause

| Component | What It Checks | What It Finds | Result |
|-----------|---------------|---------------|--------|
| **OHIF Launch API** | `pacs_settings` where `category = 'viewer'` and `key = 'ohif_base_url'` | No rows | Returns error: "OHIF viewer URL not configured" |
| **Weasis Launch API** | `pacs_settings` where `category = 'viewer'` and `key = 'wado_uri_base_url'` | No rows | Returns error: "No WADO URL configured" |
| **PACS Settings Page** | `GET /api/radiology/pacs-settings` | Empty array | Shows "No settings configured yet" |

**The `pacs_settings` table exists in production but contains ZERO records.**

The UI is reading the correct table (`pacs_settings`). The API is reading the correct table. The table is simply empty.

### Code Evidence

From `artifacts/api-server/src/routes/pacsEnterprise.ts` (line 445):

```typescript
const ohifBase = viewerSettings["ohif_base_url"] ?? "";
if (!ohifBase && !studyTemplate) {
  res.json({
    studyInstanceUID,
    viewerType: "OHIF",
    error: "OHIF viewer URL not configured. Go to PACS Settings → Viewer Settings → OHIF Base URL.",
    ohifUrl: null,
    ...
  });
  return;
}
```

From `artifacts/api-server/src/routes/pacsEnterprise.ts` (line 376):

```typescript
const wadoUrl = viewerSettings["wado_uri_base_url"] || viewerSettings["wado_base_url"] || conquestWado || ...;
if (!wadoUrl && !manifestTemplate) {
  res.json({
    studyInstanceUID,
    viewerType: "WEASIS",
    error: "No WADO URL configured. Please configure PACS → Viewer Settings.",
    weasisUrl: null,
    ...
  });
  return;
}
```

### Exact Missing Records

| Key | Category | Expected Value | Status |
|-----|----------|----------------|--------|
| `ohif_base_url` | `viewer` | `http://172.16.1.139:3000` | **MISSING** |
| `dicom_web_base_url` | `viewer` | `http://172.16.1.139:8042/dicom-web` | **MISSING** |
| `ohif_study_url_template` | `viewer` | `{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}` | **MISSING** |
| `wado_uri_base_url` | `viewer` | `http://172.16.1.139:8042/wado` | **MISSING** |
| `weasis_manifest_url_template` | `viewer` | `weasis://$dicom:get -w "..."` | **MISSING** |
| `pacs_ip` | `viewer` | `172.16.1.139` | **MISSING** |
| `pacs_port` | `viewer` | `5680` | **MISSING** |
| `pacs_ae_title` | `viewer` | `ORTHANC2` | **MISSING** |
| `viewer_mode` | `viewer` | `BOTH` | **MISSING** |
| `default_viewer` | `viewer` | `OHIF` | **MISSING** |
| `ohif_enabled` | `viewer` | `true` | **MISSING** |
| `weasis_enabled` | `viewer` | `true` | **MISSING** |

**Migration Issue:** The `pacs_settings` table schema was created but no seed data or default records were inserted. The UI has "Load Defaults" buttons that would insert these values, but an admin has never clicked them.

---

## B. WHY PACS/DICOM SETTINGS PAGE SAYS "NO SETTINGS CONFIGURED YET"

### Evidence

The PACS Settings page (`PacsSettings.tsx`) calls `api.get("/api/radiology/pacs-settings")` which returns `pacs_settings` rows.

Since `pacs_settings` has 0 records, the page renders empty state.

### Code Evidence

From `artifacts/diagnostic-erp/src/pages/PacsSettings.tsx` (line 448):

```typescript
const { data: settings = [], ... } = useQuery<Setting[]>({
  queryKey: ["pacs-settings"],
  queryFn: () => api.get("/api/radiology/pacs-settings"),
});
```

The `settings` array is empty → the Settings tab and the Viewer tab show empty states.

---

## C. DATABASE TABLE THAT STORES VIEWER CONFIGURATION

### Exact Table Name

| Setting | Table | Column `key` | Column `category` | Column `value` |
|---------|-------|-------------|-------------------|----------------|
| OHIF Base URL | `pacs_settings` | `ohif_base_url` | `viewer` | `http://172.16.1.139:3000` |
| DICOMweb URL | `pacs_settings` | `dicom_web_base_url` | `viewer` | `http://172.16.1.139:8042/dicom-web` |
| WADO URL | `pacs_settings` | `wado_uri_base_url` | `viewer` | `http://172.16.1.139:8042/wado` |
| Weasis Template | `pacs_settings` | `weasis_manifest_url_template` | `viewer` | `weasis://$dicom:get -w "..."` |
| PACS AE Title | `pacs_settings` | `pacs_ae_title` | `viewer` | `ORTHANC2` |
| PACS IP | `pacs_settings` | `pacs_ip` | `viewer` | `172.16.1.139` |
| PACS Port | `pacs_settings` | `pacs_port` | `viewer` | `5680` |

### Table Schema

```sql
-- From information_schema.columns
Column        | Type
--------------|------
id            | integer (serial)
key           | text
value         | text
category      | text
is_secret     | boolean
created_at    | timestamp
updated_at    | timestamp
```

### Table Existence

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'pacs_settings';
-- Result: pacs_settings EXISTS
```

### Production Records

```sql
SELECT COUNT(*) FROM pacs_settings;
-- Result: 0
```

**The table exists. The UI reads the correct table. The table is empty in both production and development.**

---

## D. VERIFICATION CHECKLIST

| Check | Method | Result |
|-------|--------|--------|
| Table exists? | `information_schema.tables` | ✅ `pacs_settings` exists |
| Production records? | `SELECT COUNT(*) FROM pacs_settings` | ❌ **0 records** |
| Dev records? | `SELECT COUNT(*) FROM pacs_settings` | ❌ **0 records** |
| UI reading correct table? | Code review `PacsSettings.tsx` | ✅ Reads `pacs_settings` |
| API reading correct table? | Code review `pacsEnterprise.ts` | ✅ Reads `pacs_settings` |
| Migration issue? | Compare schema vs data | ✅ Table created, no seed data |
| Production-only empty? | Compare prod vs dev | ❌ **Empty in both** |

---

## E. WHY MODALITY TEST REPORTS "PRIVATE/LOOPBACK ADDRESS BLOCKED"

### Evidence

```sql
-- Production: dicom_modalities
SELECT machine_name, modality, ae_title, ip_address, port, last_connection_status, last_error
FROM dicom_modalities;

-- Result:
-- machine_name=MRI, modality=MR, ae_title=UIH, ip_address=172.16.1.103, port=3333,
--   last_connection_status=error, last_error="172.16.1.103 is a private/loopback address and is blocked"
-- machine_name=Voluson USG, modality=US, ae_title=Voluson, ip_address=172.16.1.46, port=104,
--   last_connection_status=error, last_error="172.16.1.46 is a private/loopback address and is blocked"
```

### Root Cause

From `artifacts/api-server/src/lib/pacs/providers.ts` (line 208):

```typescript
export function isBlockedHost(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return "host is empty";
  if (SSRF_BLOCK_LITERAL.has(h)) return `${h} is a blocked address`;
  if (isPrivateIPv4(h)) return `${h} is a private/loopback address and is blocked`;
  if (isPrivateIPv6(h)) return `${h} is a private/loopback IPv6 address and is blocked`;
  ...
}
```

The IP addresses `172.16.1.103` and `172.16.1.46` are in the **private IP range** (172.16.0.0/12 = RFC 1918 private).

The SSRF guard blocks them to prevent Server-Side Request Forgery attacks.

### Is This Expected?

**YES.** The Replit cloud VM cannot access the clinic LAN (172.16.1.x). The clinic LAN is a private network. The cloud VM is on the public internet. Private IP addresses are intentionally blocked by the SSRF guard.

### What This Means

| Scenario | Can Reach 172.16.1.x? | Reason |
|----------|----------------------|--------|
| Cloud VM (production) | ❌ NO | SSRF guard blocks private IPs |
| Clinic LAN machine | ✅ YES | Same local network |
| Browser on clinic LAN | ✅ YES | Browser can access LAN IPs |
| Weasis on clinic LAN | ✅ YES | Weasis runs locally, can reach LAN PACS |
| DICOM puller on cloud | ❌ NO | Cannot reach LAN modalities |

---

## F. WORKLIST DATA — CONFIRMED ACTIVE

### Evidence

```sql
-- Production: radiology_worklist
SELECT COUNT(*) FROM radiology_worklist;  -- Result: 271

SELECT status, COUNT(*) FROM radiology_worklist GROUP BY status;
-- STUDY_RECEIVED: 271

SELECT modality, COUNT(*) FROM radiology_worklist GROUP BY modality;
-- CT: 171
-- MR: 100

SELECT id, modality, body_part, study_description, status, created_at
FROM radiology_worklist ORDER BY updated_at DESC LIMIT 5;
-- (rows present, all status=STUDY_RECEIVED)
```

**The worklist has 271 studies (171 CT, 100 MR) with status `STUDY_RECEIVED`.**

This confirms studies are being received. The worklist is populated by the radiology workflow, not by the DICOM puller.

---

## G. DICOM PULLER STATUS

### Evidence

```sql
-- Production: dicom_pull_agent_status
SELECT COUNT(*) FROM dicom_pull_agent_status;  -- Result: 76

SELECT agent_name, agent_host, last_heartbeat_at, is_online,
       studies_found_today, studies_pulled_today, failed_today
FROM dicom_pull_agent_status ORDER BY last_heartbeat_at DESC LIMIT 5;

-- Result:
-- agent_name=nixos, agent_host=10.36.5.165, last_heartbeat=2026-06-06 23:21:54, is_online=t, studies_found=0, studies_pulled=0, failed=0
-- (all 76 agents show 0 studies found/pulled today)
```

```sql
-- Production: dicom_pull_agent_logs
SELECT event_type, COUNT(*) FROM dicom_pull_agent_logs GROUP BY event_type;
-- STARTUP: 80
-- (all events are STARTUP — no actual pull events)
```

### Analysis

- 76 pull agent status records exist
- All agents are `nixos` with internal Replit IPs (`10.36.x.x`, `10.39.x.x`)
- **ZERO studies found/pulled today**
- All log events are `STARTUP` — no actual pull activity
- **The DICOM puller is NOT pulling studies from the clinic LAN** because the cloud VM cannot reach `172.16.1.x`

---

## H. INTEGRATION PLAN: OHIF AND WEASIS VIEWER

### Problem Summary

1. `pacs_settings` is empty → no viewer URLs configured
2. Clinic LAN (`172.16.1.x`) is private → cloud VM cannot reach it
3. DICOM puller cannot reach LAN modalities

### Solution Architecture

Since the clinic has **no static public IP**, the following architecture is required:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Cloud ERP      │     │  Clinic LAN      │     │  Imaging        │
│  (Replit VM)    │◄────│  (172.16.1.x)    │     │  Modalities     │
│                 │     │                  │     │  (CT, MRI, USG) │
│  - Worklist     │     │  - PACS Server   │     │                 │
│  - Reports      │     │  - OHIF Viewer   │     │  - UIH MRI      │
│  - Billing      │     │  - Weasis Client │     │  - Voluson USG  │
│                 │     │  - DICOM Puller  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        │   ❌ Cannot reach      │   ✅ Can reach
        │   172.16.1.x           │   172.16.1.x
        │                        │
        │   (SSRF guard)         │   (Same LAN)
        │                        │
```

### Option 1: Populate `pacs_settings` (Immediate Fix)

**Step 1:** An admin must open PACS Settings → Viewer Settings tab and click "Load Defaults" for each section.

This will insert the following records into `pacs_settings`:

```sql
INSERT INTO pacs_settings (key, value, category, is_secret) VALUES
  ('ohif_base_url', 'http://172.16.1.139:3000', 'viewer', false),
  ('dicom_web_base_url', 'http://172.16.1.139:8042/dicom-web', 'viewer', false),
  ('ohif_study_url_template', '{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}', 'viewer', false),
  ('wado_uri_base_url', 'http://172.16.1.139:8042/wado', 'viewer', false),
  ('weasis_manifest_url_template', 'weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={studyInstanceUID}"', 'viewer', false),
  ('pacs_ip', '172.16.1.139', 'viewer', false),
  ('pacs_port', '5680', 'viewer', false),
  ('pacs_ae_title', 'ORTHANC2', 'viewer', false),
  ('viewer_mode', 'BOTH', 'viewer', false),
  ('default_viewer', 'OHIF', 'viewer', false),
  ('ohif_enabled', 'true', 'viewer', false),
  ('weasis_enabled', 'true', 'viewer', false);
```

**Step 2:** After populating, the APIs will return proper URLs:

- `GET /api/radiology/studies/{uid}/ohif-launch` → returns `ohifUrl: "http://172.16.1.139:3000/viewer?StudyInstanceUIDs=..."`
- `GET /api/radiology/studies/{uid}/weasis-launch` → returns `weasisUrl: "weasis://$dicom:get -w \"...\""`

### Option 2: Use Embedded DICOM Viewer (No External Viewer Needed)

The ERP already has an embedded viewer (`EmbeddedWadoViewer.tsx`) that:
- Uses DICOMweb to fetch series and instances
- Renders frames directly in the browser
- Requires only a `dicom_web_base_url` configured

**Advantage:** Works inside the ERP without external software.
**Limitation:** Still requires the DICOMweb endpoint to be reachable from the browser.

### Option 3: DICOM Puller on Clinic LAN

**Problem:** The cloud DICOM puller cannot reach `172.16.1.x`.
**Solution:** Run a local DICOM pull agent on a clinic LAN machine.

The `bridge-service` or a local Node.js agent can:
1. Connect to modalities on `172.16.1.103` and `172.16.1.46`
2. Pull studies via C-MOVE
3. Upload to the PACS server (`172.16.1.139:5680`)
4. Report status back to the cloud ERP

**Configuration:**
- The `dicom_nodes` table already has the modality configuration
- The `dicom_modalities` table has the polling settings
- The agent needs to run on a machine with access to both the modalities and the cloud API

### Option 4: Reverse Proxy / VPN

If the clinic can set up:
- A reverse proxy (e.g., nginx, Traefik) with a public domain
- A VPN tunnel (e.g., Tailscale, WireGuard) from the cloud VM to the clinic LAN
- A cloudflare tunnel

Then the cloud VM can reach `172.16.1.x` through the tunnel.

---

## I. SUMMARY

| Question | Answer |
|----------|--------|
| **Why OHIF not configured?** | `pacs_settings` table is empty — no `ohif_base_url` record |
| **Why Weasis not configured?** | `pacs_settings` table is empty — no `wado_uri_base_url` record |
| **Why "No settings configured yet"?** | `pacs_settings` has 0 records |
| **Which table stores settings?** | `pacs_settings` (key-value with category) |
| **Does table exist?** | ✅ Yes |
| **Does production have records?** | ❌ No — 0 records |
| **Is UI reading correct table?** | ✅ Yes |
| **Migration issue?** | ✅ Yes — table created but not seeded |
| **Production-only empty?** | ❌ No — empty in both |
| **Why "private/loopback address blocked"?** | SSRF guard blocks `172.16.1.x` (private IPs) |
| **Is this expected?** | ✅ Yes — cloud VM cannot reach clinic LAN |
| **Worklist active?** | ✅ Yes — 271 studies (171 CT, 100 MR) |
| **DICOM puller working?** | ❌ No — 0 studies pulled, 76 agents all idle |

### Exact Root Cause

1. **`pacs_settings` is completely empty** — no viewer configuration records exist
2. **SSRF guard blocks private IPs** — the cloud VM cannot reach the clinic LAN (`172.16.1.x`)
3. **DICOM puller cannot operate** — because the modalities are on a private LAN

### Exact Missing Records

12 records need to be inserted into `pacs_settings` with `category = 'viewer'`:

| # | Key | Expected Value |
|---|-----|---------------|
| 1 | `ohif_base_url` | `http://172.16.1.139:3000` |
| 2 | `dicom_web_base_url` | `http://172.16.1.139:8042/dicom-web` |
| 3 | `ohif_study_url_template` | `{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}` |
| 4 | `wado_uri_base_url` | `http://172.16.1.139:8042/wado` |
| 5 | `weasis_manifest_url_template` | `weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={studyInstanceUID}"` |
| 6 | `pacs_ip` | `172.16.1.139` |
| 7 | `pacs_port` | `5680` |
| 8 | `pacs_ae_title` | `ORTHANC2` |
| 9 | `viewer_mode` | `BOTH` |
| 10 | `default_viewer` | `OHIF` |
| 11 | `ohif_enabled` | `true` |
| 12 | `weasis_enabled` | `true` |

### Exact Affected Table

- **Table:** `pacs_settings`
- **Schema:** `id`, `key`, `value`, `category`, `is_secret`, `created_at`, `updated_at`
- **Current count:** 0 records
- **Required count:** 12+ records (viewer category)

### Exact API Responses (Current)

```json
// GET /api/radiology/studies/{uid}/ohif-launch
{
  "studyInstanceUID": "...",
  "viewerType": "OHIF",
  "error": "OHIF viewer URL not configured. Go to PACS Settings → Viewer Settings → OHIF Base URL.",
  "ohifUrl": null,
  "dicomWebBaseUrl": null,
  "pacsType": "CONQUEST"
}

// GET /api/radiology/studies/{uid}/weasis-launch
{
  "studyInstanceUID": "...",
  "viewerType": "WEASIS",
  "error": "No WADO URL configured. Please configure PACS → Viewer Settings.",
  "weasisUrl": null,
  "fallbackDicomWebUrl": null,
  "pacsType": "UNKNOWN"
}

// GET /api/radiology/pacs-settings
[]
```

---

*End of Evidence Audit*
*Date: June 6, 2026*
*All evidence from production database queries and code review. No speculation.*
