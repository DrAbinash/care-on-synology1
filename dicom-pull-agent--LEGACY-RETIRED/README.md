# Care Diagnostics DICOM Q/R Pull Agent

Runs on the **Conquest PACS server machine** (same Windows PC or on the LAN).
Polls the ERP for pending pull jobs and automatically executes DCMTK `findscu` + `movescu`
to pull studies from imaging machines (MRI, CT, X-Ray, USG) into Conquest — no technician needed.

## Prerequisites

1. **Node.js ≥ 18** — https://nodejs.org
2. **DCMTK** — https://dcmtk.org/en/dcmtk/dcmtk-overview/
   - Windows: download the official ZIP, extract, add `bin/` to PATH or set `DCMTK_DIR`
   - Ubuntu/Debian: `sudo apt install dcmtk`

## Setup

```cmd
:: Windows CMD — run on the Conquest server machine
set ERP_BASE_URL=https://your-erp.replit.app
set INTERNAL_API_KEY=your-secret-here
set AGENT_AE_TITLE=DIAGNO_AGENT
set CONQUEST_AE_TITLE=CONQUEST1
set CONQUEST_HOST=127.0.0.1
set CONQUEST_PORT=5678
set DCMTK_DIR=C:\DCMTK\bin

node src/index.js
```

```bash
# Linux / macOS
export ERP_BASE_URL=https://your-erp.replit.app
export INTERNAL_API_KEY=your-secret-here
export CONQUEST_HOST=127.0.0.1
node src/index.js
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ERP_BASE_URL` | — | **Required.** Base URL of the Care Diagnostics ERP |
| `INTERNAL_API_KEY` | — | **Required.** Must match `INTERNAL_API_KEY` on the ERP server |
| `DCMTK_DIR` | (PATH) | Path to DCMTK `bin/` folder if not in system PATH |
| `AGENT_AE_TITLE` | `DIAGNO_AGENT` | AE Title this agent uses when connecting to modalities |
| `CONQUEST_AE_TITLE` | `CONQUEST1` | Conquest AE Title (images are C-STOREd here) |
| `CONQUEST_HOST` | `127.0.0.1` | Conquest IP/hostname |
| `CONQUEST_PORT` | `5678` | Conquest DICOM port |
| `POLL_INTERVAL_MS` | `30000` | How often to poll the ERP (milliseconds) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Run as Windows Service (optional)

Install with [NSSM](https://nssm.cc) so the agent starts automatically with Windows:

```cmd
nssm install DicomPullAgent "C:\Program Files\nodejs\node.exe" "C:\DicomPullAgent\src\index.js"
nssm set DicomPullAgent AppDirectory "C:\DicomPullAgent"
nssm set DicomPullAgent AppEnvironmentExtra ERP_BASE_URL=https://your-erp.replit.app
nssm set DicomPullAgent AppEnvironmentExtra INTERNAL_API_KEY=your-secret
nssm set DicomPullAgent AppEnvironmentExtra CONQUEST_HOST=127.0.0.1
nssm set DicomPullAgent Start SERVICE_AUTO_START
nssm start DicomPullAgent
```

## How it works

```
ERP cron scheduler
  → creates dicom_pull_job (status: pending) for each auto-pull node

DICOM Pull Agent (this service — runs on Conquest PC)
  → polls GET /api/internal/dicom/pull-jobs/pending  every 30s
  → claims job: PATCH /api/internal/dicom/pull-jobs/:id/claim
  → runs findscu  ← queries modality for today's studies (C-FIND)
  → runs movescu  ← pulls each study into Conquest (C-MOVE)
  → reports back: PATCH /api/internal/dicom/pull-jobs/:id
    { status, studiesFound, studiesPulled, studiesFailed }

ERP updates node.last_pull_at + last_pull_status
ERP Radiology Worklist populated (via Conquest → notify_erp.ps1)
```

## Conquest setup

Each imaging machine must be registered in Conquest's `dicom.ini` as a known source:

```ini
[ACRNema]
MRI_SIEMENS = 192.168.1.10  104
CT_GE       = 192.168.1.11  104
XRAY_FUJI   = 192.168.1.12  104
USG_MINDRAY = 192.168.1.13  104
```

The agent's AE Title (`DIAGNO_AGENT`) must also be registered so modalities accept its C-MOVE requests.
Each modality's Q/R SCP must accept C-MOVE requests from `DIAGNO_AGENT` as the requestor.
