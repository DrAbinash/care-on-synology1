# CARE ERP — Second-NAS Disaster Recovery

_Bring the whole billing/ERP system up on a **second Synology NAS** (e.g. a DS-class box running Container Manager) after the primary fails. With the one-time pre-staging below, real failover is **a few minutes**; from bare metal it is ~15–20 min (an image build)._

The system is just: a `docker compose` stack + one PostgreSQL database + a `.env` of secrets. If the standby already has the images built and a recent backup synced, recovery is "restore the dump, `up`, repoint the network."

---

## The idea
- **Primary NAS** runs the stack and takes a nightly backup (`CARE_ERP_BACKUP_RESTORE.md`).
- **Standby NAS** is pre-staged: same code, same `.env`, images pre-built, and the nightly backup **synced to it**.
- **On disaster**: restore the latest backup into the standby's DB, `docker compose up -d`, repoint the network. Done.

> **Two secrets MUST match the primary** on the standby `.env`, or you'll lock users out or block migrations:
> - `JWT_SECRET` and `SESSION_SECRET` — same values, so existing logins/tokens keep working.
> - `APP_NAME` — same value (default `care-erp`); the DB-identity guard refuses to migrate a database stamped with a different app name.
> Also copy `DB_USER/DB_PASSWORD/DB_NAME`, `ICICI_*`, `INTERNAL_API_KEY`, and any Orthanc/OHIF/Ollama/WhatsApp values you use.

---

## PART 1 — One-time pre-staging on the standby NAS (do this NOW, while healthy)
This is what turns "hours" into "minutes."

1. **Install Container Manager** (DSM → Package Center).
2. **Get the code** onto the standby, e.g. `/volume1/docker/care-erp`:
   ```sh
   git clone <your repo url> /volume1/docker/care-erp
   cd /volume1/docker/care-erp
   git checkout feature/website-login-redirection
   ```
   (Or copy the folder from the primary. You need at least: `docker-compose.yml`, `Dockerfile`, `docker/`, `lib/db/drizzle`, `migrations/`, and the app source the Dockerfile builds.)
3. **Copy `.env`** from the primary into this folder (same secrets — see the box above). Never commit it.
4. **Create the external DB volume** (compose expects it by name):
   ```sh
   docker volume create care_main_db_data
   ```
5. **Pre-build the images** so failover doesn't wait on a build:
   ```sh
   docker compose build
   ```
6. **Sync backups to the standby nightly.** Easiest: Synology **Hyper Backup** from the primary's `/volume1/backups/caredeoghar` to the standby, or add an `rsync`/`scp` line to the primary's backup task so `/volume1/backups` mirrors to the standby. Confirm a fresh `caredeoghar_*.sql.gz` appears on the standby each morning.
7. **Rehearse once** (safe): follow PART 2 on the standby while the primary is still up, on a throwaway DB name, then drop it. A rehearsed DR plan is the only kind that works.

## PART 2 — Failover (primary is down): bring the standby up
On the standby NAS shell, in `/volume1/docker/care-erp`:

```sh
# 1. Make sure you have the latest good backup (synced nightly). Decrypt if encrypted:
#    openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_PASSPHRASE" -in latest.sql.gz.enc -out latest.sql.gz

# 2. Start ONLY the database first (so we restore into it before the app serves traffic)
docker compose up -d db
until docker exec care-db pg_isready -U erp -d diagnostic_erp -q; do sleep 2; done

# 3. Restore the latest backup into the fresh database
gunzip -c /volume1/backups/caredeoghar/latest.sql.gz | docker exec -i care-db psql -U erp -d diagnostic_erp

# 4. Bring up the rest of the stack. care-db-patch-v2 applies any migrations newer
#    than the backup (idempotent); care-api starts only after schema is verified.
docker compose up -d

# 5. Confirm it is healthy
docker ps --format '{{.Names}}\t{{.Status}}'
pnpm operations:verify-deployment    # or: curl -fsS http://localhost:8080/api/health/schema  → 200
```

6. **Repoint the network** to the standby:
   - If the standby takes over the **same LAN IP** (primary fully dead): just move the IP / cable, users hit the same address.
   - If using **Cloudflare Tunnel / a public domain**: point the tunnel/`caredeoghar.com` at the standby.
   - Update any **external service** env that lives elsewhere (Orthanc/OHIF/Ollama) if their addresses differ on this site — reporting/billing work regardless; those are non-blocking.

7. Log in, open **Admin → Operational Health**, and run the **NAS validation checklist** (`CARE_ERP_NAS_VALIDATION_CHECKLIST.md`). If rows 1–3, 15–17 pass → you are live.

---

## If the standby was NOT pre-staged (bare-metal, ~15–20 min)
Do PART 1 steps 1–5 now (install Container Manager, get code, `.env`, `docker volume create care_main_db_data`, `docker compose up -d --build`), then PART 2 from step 2 (restore + verify). The extra time is only the image build.

## Failover checklist (print this)
- [ ] Standby has Container Manager + the code + a matching `.env` (JWT/SESSION/APP_NAME match)
- [ ] `care_main_db_data` volume exists on the standby
- [ ] A backup no older than last night is present on the standby (`gzip -t` OK)
- [ ] `docker compose up -d db` → `care-db` healthy
- [ ] Restored the dump → no `ERROR:` lines
- [ ] `docker compose up -d` → all containers healthy, `care-db-patch-v2` Exited(0)
- [ ] `/api/health/schema` returns 200 and `verify-deployment` shows no blocking failures
- [ ] Network repointed; a test login + a test bill works
- [ ] Change the bootstrap admin PIN if `BOOTSTRAP_ADMIN_FORCE` was used

## Recovery objectives with this setup
- **RPO (data loss window):** up to 24h (last nightly backup). Tighten by backing up more often (e.g. every 6h) or syncing after each day-close.
- **RTO (time to restore):** a few minutes pre-staged; ~15–20 min from bare metal.

## After the emergency
When the primary is repaired, decide which NAS is authoritative, take a fresh backup from whichever ran during the outage, and restore it onto the other so both match before switching back. Never run both as the live billing system at the same time.
