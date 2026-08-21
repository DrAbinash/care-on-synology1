# Windows Emergency CARE — deploy on a clinic Windows PC (Docker Desktop)

This is the same **225app** Emergency Billing capture stack used on DS225+,
packaged for **Windows Docker Desktop** so reception can keep billing when the
primary DS1522+ CARE ERP is unavailable.

It is **not** a second full ERP. Bill Desk UI matches CARE ERP visually;
data stays on local Postgres until reconciled back to Main CARE.

## One-time setup

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) (WSL2 backend recommended).
2. Clone this repo to a local folder, e.g. `C:\care-emergency`.
3. Copy `.env.windows.example` → `.env` and set:
   - `EMERGENCY_DB_PASSWORD`
   - `EMERGENCY_FETCH_TOKEN` (same token as Main CARE → Settings → Billing → Emergency Billing)
   - `PRIMARY_CARE_URL=http://<MAIN-CARE-LAN-IP>:<PORT>` (prefer IP, not QuickConnect)
4. On Main CARE, save the same fetch token and (optionally) the Windows PC URL if CARE will still push master data the old way.
5. Start:

```powershell
cd C:\care-emergency
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-Emergency.ps1
```

Open `http://127.0.0.1:8080/` (or the PC's LAN IP on port 8080).

## Daily ops (UI — no CLI needed during outage)

After login (admin/owner):

| Button | Action |
| --- | --- |
| **Sync From Main CARE** | Pull master tariff/patients/doctors/staff into this PC |
| **Push Emergency Data** | Push pending EMG bills into Main CARE (idempotent) |
| **Retry Failed** | Re-push failed rows |
| **Export CSV / JSON / USB** | Safety-net files for Main CARE import |
| **Download Backup** | Logical SQL dump download |

Status strip shows **Main CARE ONLINE / OFFLINE** with a grace period (default 90s) so a single failed probe does not panic staff.

## Backup / restore (CLI)

```powershell
.\scripts\windows\Backup-Emergency.ps1
.\scripts\windows\Restore-Emergency.ps1 -SqlFile C:\path\to\dump.sql -Confirm
```

## Health checks

```powershell
Invoke-WebRequest http://127.0.0.1:8080/health
docker compose -f docker-compose.yml -f docker-compose.windows.yml ps
```

Containers: `care-emergency-web`, `care-emergency-api`, `care-emergency-db`  
Volumes: `care_emergency_db_data`, `care_emergency_backups`  
Restart policy: `unless-stopped`

## Works when

- DS1522+ / DSM / Docker / primary Postgres is down
- Internet / QuickConnect is down
- Only this Windows PC + clinic LAN are available

## Must not

- Point volumes at Main CARE DB or Hyper Backup vaults
- Use real patient data in drills unless authorized
