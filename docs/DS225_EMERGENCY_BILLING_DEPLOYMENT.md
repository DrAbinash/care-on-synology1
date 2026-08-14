# DS225+ Emergency Billing — Deployment

Do **not** deploy to cloud. Do **not** merge this stack into the CARE `docker-compose.yml`. Do **not** point any volume at Hyper Backup or the DS1522+ backup repository.

## Resource requirements (DS225+)

Emergency Billing is small (Postgres + Node + nginx). Leave the bulk of RAM/disk for Hyper Backup and snapshots.

| Item | Guidance |
| --- | --- |
| RAM | 1 GB is enough for this stack; keep NAS headroom for backup jobs |
| Disk | Dedicated volume; 10 GB+ for DB + dumps (not on the vault share) |
| CPU | 1 vCPU equivalent is enough |

## Ports

| Service | Internal | Host default |
| --- | --- | --- |
| `care-emergency-web` | 80 | `0.0.0.0:80` (reception browser) |
| `care-emergency-api` | 8898 | not published (nginx proxies) |
| `care-emergency-db` | 5432 | `127.0.0.1:5410` (loopback only) |

CARE production uses 8888 / 5400. These emergency ports are deliberately different.

## Persistent volumes

- `care_emergency_db_data` — live PostgreSQL (`care_emergency` database, role from `.env`)
- `care_emergency_backups` or host path `/volume1/docker/care-emergency/backups` — `pg_dump` files every 6 hours, keep 14

## One-time install on DS225+

1. Create `/volume1/docker/care-emergency/` (ordinary docker share — **not** the Hyper Backup destination).
2. Copy `deploy/ds225-emergency/` plus enough of the git repo to build the API image (or load a pre-built `care-emergency-api:local`).
3. `cp .env.example .env` and set:
   - `EMERGENCY_DB_PASSWORD` (long random)
   - `EMERGENCY_FETCH_TOKEN` (`openssl rand -hex 32`)
   - Optional `EMERGENCY_BOOTSTRAP_USERNAME` / `EMERGENCY_BOOTSTRAP_PIN` for first login **before** CARE has pushed staff (unset after first master sync)
4. From that folder:

```sh
docker compose -f docker-compose.yml --env-file .env up -d --build
curl -fsS http://127.0.0.1/health
```

5. Bookmark `http://<DS225-IP>/` on reception PCs (example `http://192.168.50.10`).
6. While CARE is healthy: Settings → Billing → Emergency Billing → save NAS URL + token → **Push master data to DS225+**.

## CARE (DS1522+) side

1. Apply `migrations/zzzzzzzzzzz_emergency_billing_reconciliation.sql` with the normal CARE schema path (`pnpm db:push` or compose `db-patch-v2`).
2. Redeploy CARE API/web so `/api/emergency-billing` and the Settings tab exist.
3. Admin opens Settings → Billing → Emergency Billing and stores `http://<DS225-IP>` plus the same fetch token.

## Backup procedure

Automatic: API writes `pg_dump` into `BACKUP_DIR` every 6 hours.

Manual:

```sh
docker compose exec care-emergency-api pg_dump --no-owner --dbname="$DATABASE_URL" -f /backups/manual.sql
```

USB disaster copy (not a live database): in the Emergency UI, owner clicks **USB package** (CSV + JSON + checksums). Do **not** run billing from a pendrive.

## Rollback

```sh
docker compose down
# volumes are kept; to destroy emergency data only (never Hyper Backup):
docker volume rm care_emergency_db_data care_emergency_backups
```

CARE production is untouched. Imported CARE bills are ordinary bills — reverse them with CARE cancel/void, not by deleting this stack.

## Portability

The same compose file can run on another Synology, a Linux PC, or a generic Docker host. Change bind addresses only. Do not redesign billing/reconciliation.
