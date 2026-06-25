# CONQUEST PACS → Care Diagnostics ERP Integration Setup

When CONQUEST receives a DICOM study this hook fires automatically and pushes
the study metadata to the ERP. The study then appears in the **PACS Worklist**
without any manual intervention.

---

## 1. Set the `INTERNAL_API_KEY` secret in the ERP

The key protects the internal study-intake endpoint from unauthenticated calls.

1. In the Replit project open **Secrets** (left-hand panel, padlock icon).
2. Add a secret named **`INTERNAL_API_KEY`**.
3. Paste the value generated for you (see the agent's message).
4. Click **Save**.
5. **Re-deploy** (or restart the API server) so the new secret is picked up.

> The server returns **503** on the `/api/internal/radiology/studies` endpoint
> until this secret is set in production.

---

## 2. Copy the Lua hook to CONQUEST

```
<ConquestInstallDir>\
  lua\
    erp_notify.lua      ← copy conquest/erp_notify.lua here
```

Typical Windows paths:

| CONQUEST version | Install dir |
|---|---|
| Installer / service | `C:\Conquest\` |
| Portable / zip | wherever you extracted it |

---

## 3. Edit `dicom.ini` — add the Lua hook

Open `<ConquestInstallDir>\dicom.ini` in a text editor and find (or add) this
key under the `[dicom]` section:

```ini
[dicom]
...
LuaConvertScript = lua\erp_notify.lua
```

If `LuaConvertScript` already points to a different script:

```ini
LuaConvertScript = lua\existing_script.lua
```

…add a `require` call at the **bottom** of that existing script instead:

```lua
-- at the bottom of your existing convert.lua:
require("erp_notify")
```

---

## 4. Edit `erp_notify.lua` — set URL and key

Open `<ConquestInstallDir>\lua\erp_notify.lua` and set the two variables at
the top:

```lua
local ERP_URL     = "https://YOUR_APP.replit.app/api/internal/radiology/studies"
local ERP_API_KEY = "paste-your-INTERNAL_API_KEY-value-here"
```

Replace:
- `YOUR_APP.replit.app` with your actual deployment domain (visible in the
  Replit deployment panel, or in `REPLIT_DOMAINS` env var).
- The key value with the one you set in step 1.

---

## 5. Restart CONQUEST

**Windows service:**
```bat
net stop ConquestDICOM
net start ConquestDICOM
```

**Windows GUI / portable:**
Close and reopen the CONQUEST application.

**Linux (systemd):**
```bash
sudo systemctl restart conquest
```

---

## 6. Test the connection

### Quick smoke test (from any machine with curl):

```bash
# Replace the domain and key
curl -X POST https://YOUR_APP.replit.app/api/internal/radiology/studies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_INTERNAL_API_KEY" \
  -d '{
    "patientName": "Test Patient",
    "accessionNumber": "TEST001",
    "studyInstanceUID": "1.2.3.4.5.6.7",
    "modality": "CT",
    "studyDescription": "CT Brain",
    "studyDate": "20260511"
  }'
```

Expected response: **HTTP 201** with a JSON object.

### Verify in the ERP:

1. Log in to the ERP → **Radiology Worklist**.
2. Look for `TEST001` — it should appear within seconds of the curl call.

### Send a real DICOM study to CONQUEST:

Use a DICOM test tool (e.g. `dcmsend` from DCMTK, or Horos/Osirix "Send") to
push a study to CONQUEST. After CONQUEST stores it, refresh the ERP Worklist —
the study should appear automatically.

---

## 7. Enable debug logging (optional)

In `erp_notify.lua` change:

```lua
local DEBUG = true
```

CONQUEST will then write `[ERP]` lines to `ConquestDICOM.log` for every
received image, showing the HTTP status code and the study identifiers.
Set back to `false` in production to keep the log clean.

---

## Payload reference

| Field | Source DICOM tag | Notes |
|---|---|---|
| `patientName` | `(0010,0010)` PatientsName | `^` separators replaced with spaces |
| `patientId` | `(0010,0020)` PatientID | Used to match ERP patient (UHID) |
| `accessionNumber` | `(0008,0050)` AccessionNumber | **Required** — deduplication key |
| `studyInstanceUID` | `(0020,000D)` StudyInstanceUID | Secondary deduplication key |
| `modality` | `(0008,0060)` Modality | Defaults to `OT` if blank |
| `studyDescription` | `(0008,1030)` StudyDescription | Used for AI template selection |
| `studyDate` | `(0008,0020)` StudyDate | YYYYMMDD format stored as-is |
| `referringDoctor` | `(0008,0090)` ReferringPhysiciansName | Optional |
| `aeTitle` | Called AE title (CONQUEST node) | Auto-populated |
| `ipAddress` | Sending SCU IP | Auto-populated |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Studies don't appear in Worklist | Hook not firing | Check `LuaConvertScript` in dicom.ini; restart CONQUEST |
| HTTP 401 in log | Wrong key | Confirm key matches the `INTERNAL_API_KEY` secret in ERP |
| HTTP 503 in log | Key not set in ERP | Set `INTERNAL_API_KEY` secret and redeploy |
| HTTP 400 in log | Missing required fields | Enable DEBUG, check that AccessionNumber & PatientName are non-blank in your DICOM data |
| curl not found | Older Windows | Install curl or deploy luasocket; see below |
| `require("socket.http")` fails | No luasocket | Install via `luarocks install luasocket` or use the curl fallback |

### Installing luasocket on Windows (optional but recommended)

```bat
rem If you have LuaRocks installed alongside Lua/CONQUEST:
luarocks install luasocket
```

Or download the pre-built DLL from https://github.com/lunarmodules/luasocket/releases
and place it in the CONQUEST `lua/` directory.

---

## How it works (data flow)

```
DICOM SCU (modality)
      │
      │  C-STORE (DICOM)
      ▼
CONQUEST PACS
      │
      │  converter() Lua hook fires per image
      │  POST /api/internal/radiology/studies
      │  Authorization: Bearer INTERNAL_API_KEY
      ▼
Care Diagnostics ERP API Server
      │
      │  Upsert into radiology_worklist table
      │  (dedup by StudyInstanceUID + AccessionNumber)
      ▼
ERP PACS Worklist  ←  refreshes every 30 s (or manually)
```
