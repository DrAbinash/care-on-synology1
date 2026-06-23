# DICOM Pull Agent

## Two Modes of Operation

### 1. In-Process DIMSE Agent (Cloud / Replit VM)

Runs **inside the API server** using `dcmjs-dimse` (pure Node.js DICOM DIMSE library).

**Enable it:**
```bash
ENABLE_DICOM_PULL_AGENT=1
# or, it also auto-starts when ENABLE_SCHEDULERS=1
```

**What it does:**
- Polls the database every 30s for `dicom_pull_jobs` with `status='pending'`
- Executes **C-ECHO** connectivity probe against each modality
- Executes **C-FIND** (Study Root) to discover studies by date range
- Executes **C-MOVE** to transfer studies into your Conquest PACS
- Writes results directly back to `dicom_pull_jobs`, `dicom_pull_agent_logs`, and `dicom_pull_agent_status`

**Best for:** Cloud deployments where modalities have public IPs or VPN access.

**Environment variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_NAME` | `hostname()` | Unique agent identifier |
| `AGENT_AE_TITLE` | `DIAGNO_AGENT` | DICOM AE title for this agent |
| `DIMSE_POLL_INTERVAL_MS` | `30000` | How often to check for jobs |
| `DIMSE_MAX_CONCURRENT_JOBS` | `3` | Parallel job limit |
| `DIMSE_TIMEOUT_MS` | `60000` | Per-DIMSE-operation timeout |
| `CONQUEST_AE_TITLE` | `CONQUEST` | Fallback destination AE |
| `CONQUEST_HOST` | `127.0.0.1` | Fallback destination host |
| `CONQUEST_PORT` | `5678` | Fallback destination port |

### 2. Local DICOM Bridge (Clinic LAN PC — Recommended for Private Networks)

A standalone Node.js service that runs **on a PC inside your clinic LAN**.
It uses `dcmjs-dimse` (pure Node.js, no DCMTK installation) to reach private-network modalities (`172.16.1.x`)
and reports everything back to the cloud ERP via REST API.

**Best for:** Clinics where modalities are on a private network unreachable from the cloud.

**Location:** `artifacts/local-dicom-bridge/`

**Setup:**
```bash
cd artifacts/local-dicom-bridge
npm install
# Copy .env.example to .env, fill ERP_BASE_URL + INTERNAL_API_KEY
node src/index.js
```

**Features:**
- Pure Node.js — no DCMTK, no Windows-specific dependencies
- Auto-fetches config from ERP every 5 minutes (or uses `.env` overrides)
- Last-known-good config saved to disk (survives ERP downtime)
- Rolling file logs with 30-day cleanup
- Heartbeat + status reporting visible in ERP → Radiology → Agent Status
- Graceful shutdown on SIGTERM/SIGINT

### 3. External Reference Agent (Legacy — DCMTK-based)

A standalone Node.js service that runs on the Conquest/PACS server machine.
It polls the ERP REST API and spawns `findscu` / `movescu` via child process.

Use this if you:
- Need DCMTK-specific features not in `dcmjs-dimse`
- Already have DCMTK installed and prefer it
- Want the agent on a separate machine near the modalities

See `artifacts/windows-pull-agent/` for the DCMTK-based implementation.
