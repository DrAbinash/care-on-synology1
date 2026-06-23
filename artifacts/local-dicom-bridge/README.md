# Care Diagnostics Local DICOM Bridge

A small Node.js service that runs **inside your clinic's LAN** (on any Windows, Linux, or macOS PC) to pull DICOM studies from CT, MRI, and Ultrasound machines into your local Conquest/Orthanc PACS.

**Why this exists:** Your imaging equipment lives on a private network (`172.16.1.x`) that the cloud ERP server cannot reach. This bridge runs on a PC inside that same network and handles the DIMSE protocol directly.

**Key difference from the old Windows Pull Agent:** This uses `dcmjs-dimse` (pure Node.js — no DCMTK installation needed). Just `npm install` and go.

---

## Quick Start

### 1. Prerequisites

- Node.js >= 18 (https://nodejs.org)
- A PC on the same LAN as your modalities (can reach `172.16.1.x`)
- Your ERP deployed and accessible via HTTPS

### 2. Install

```bash
# On your clinic PC
cd C:\DiagnoDicomBridge\   # or any folder you like
npm install
```

### 3. Configure

Copy `.env.example` to `.env` and fill in:

```bash
# Required
ERP_BASE_URL=https://your-app.replit.app
INTERNAL_API_KEY=your-internal-api-key

# Optional (defaults shown)
AGENT_ID=clinic-pc-01
AGENT_AE_TITLE=DIAGNO_AGENT
POLL_INTERVAL_MS=600000        # 10 minutes
DIMSE_TIMEOUT_MS=60000         # 60 seconds
MAX_CONCURRENT_JOBS=3
```

Get `INTERNAL_API_KEY` from your ERP admin (it's the same secret used by the in-process agent and the fingerprint bridge).

### 4. Run

```bash
node src/index.js
```

You should see:

```
[INFO] Care Diagnostics Local DICOM Bridge starting ...
[INFO] Bootstrap complete { modalities: 3, pollIntervalMs: 600000 }
[INFO] C-ECHO OK for Voluson (12ms)
[INFO] C-FIND returned 2 studies from Voluson
[XFER] Starting C-MOVE: 1.2.840... from Voluson → CONQUEST1
[INFO] Modality Voluson done: pulled=2 skipped=0 failed=0
```

### 5. Run as Windows Service (optional)

Use [NSSM](https://nssm.cc) to keep it running automatically:

```powershell
nssm install DiagnoDicomBridge "C:\Program Files\nodejs\node.exe" "C:\DiagnoDicomBridge\src\index.js"
nssm set DiagnoDicomBridge AppDirectory C:\DiagnoDicomBridge
nssm start DiagnoDicomBridge
```

---

## How It Works

1. **Polls ERP** every `POLL_INTERVAL_MS` for the list of DICOM nodes you configured in Radiology → DICOM Nodes.
2. **C-ECHO** each modality to verify it's online.
3. **C-FIND** queries the modality for studies from the last N days (set per node in ERP).
4. **C-MOVE** transfers each new study into your local Conquest PACS.
5. **Reports back** — heartbeat, logs, and pulled-study events go to the ERP so you can monitor from the web UI.

---

## Configuration Priority

1. `.env` file (local override)
2. Remote config from ERP (auto-fetched every 5 minutes)
3. Last-known-good config (saved to disk if ERP is unreachable)
4. Built-in defaults

Set `ERP_CONFIG_ENABLED=0` to disable remote fetching and use only `.env` values.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `C-ECHO failed: Network error` | Check that the PC can ping the modality IP. Verify AE Title and port match the modality's DICOM settings. |
| `ERP API returned 401` | `INTERNAL_API_KEY` doesn't match the server's secret. Ask your admin to verify. |
| `No active modalities` | Make sure DICOM Nodes in ERP have **Auto-Pull = ON**. |
| Studies aren't moving | Check that Conquest PACS is running and its AE Title matches the node config in ERP. |

---

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main loop — poll, C-ECHO, C-FIND, C-MOVE |
| `src/config.js` | Config loader — .env + remote ERP + last-known-good |
| `src/logger.js` | Rolling file logs (no external deps) |
| `.env.example` | Template for your `.env` file |
| `config/last-known-good.json` | Auto-saved config when ERP is down |
| `logs/` | Rolling agent.log + error.log |
