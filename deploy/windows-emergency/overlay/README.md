# CARE Emergency Billing (DS225+ / Windows Emergency PC)

Standalone **capture-only** emergency billing for disaster recovery.

CARE on DS1522+ remains the **only** source of truth for accounting, commission, and canonical bills.

This repository is independently buildable. **Do not clone the CARE monorepo onto the emergency host.**

| Piece | Repository |
| --- | --- |
| This app (UI + API + dedicated Postgres) | `https://github.com/DrAbinash/225app` |
| Master-data push/pull bridge, fetch, CSV/JSON import, reconciliation | CARE (`DrAbinash/care-on-synology1`) |
| Pendrive ultra-emergency (when CARE **and** this host are down) | Plan: `docs/PENDRIVE_ULTRA_EMERGENCY_PLAN.md` |

**Bill Desk UI** matches CARE ERP Billing Desk (Patient · Referring Doctor · Investigations · Selected Tests · Bill Summary · Payment) with an unmistakable **EMERGENCY MODE** banner.

## Windows Emergency PC (Docker Desktop)

See **`docs/WINDOWS_EMERGENCY_DEPLOY.md`**.

```powershell
copy .env.windows.example .env
# edit EMERGENCY_FETCH_TOKEN, PRIMARY_CARE_URL, passwords
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-Emergency.ps1
# open http://127.0.0.1:8080/
```

Backup / restore: `scripts\windows\Backup-Emergency.ps1` / `Restore-Emergency.ps1`.

## Deploy on DS225+ (`/volume1/docker/care-emergency/`)

```sh
sudo mkdir -p /volume1/docker/care-emergency
cd /volume1/docker/care-emergency
git clone https://github.com/DrAbinash/225app.git .
cp .env.example .env
# edit EMERGENCY_DB_PASSWORD and EMERGENCY_FETCH_TOKEN (openssl rand -hex 32)
docker compose --env-file .env up -d --build
curl -fsS http://127.0.0.1/health
```

Bookmark `http://<DS225-IP>/` on reception PCs.

Then on CARE (while DS1522+ is healthy): **Settings → Billing → Emergency Billing → Push Initial Master Data**  
(or from this app: **Sync From Main CARE** when `PRIMARY_CARE_URL` is set).

## Interchange contracts

| Format | Direction |
| --- | --- |
| `CARE_EMERGENCY_MASTER_V1` | CARE ↔ this app (tariff / catalogue / doctors / patients / staff / discount reasons) |
| `CARE_EMERGENCY_BILLING_V1` | this app → CARE (CSV) |
| `CARE_EMERGENCY_BILLING_JSON_V1` | this app → CARE (JSON) |

CARE bridge (token auth): `GET/POST /api/emergency-bridge/*` on Main CARE.

## Local development

```sh
cd artifacts/emergency-billing
npm install
export DATABASE_URL=postgres://ubuntu@/care_emergency_test?host=/var/run/postgresql
export EMERGENCY_FETCH_TOKEN=dev-token
npm run dev   # API+UI on :8898
```

## What this app must not contain

Accounting, commission, PACS, radiology reporting, pathology, AI, inventory, HR, or a copy of `diagnostic_erp`.
