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

## The compose project name is part of the recovery, not a detail

`docker-compose.yml` declares no `name:` and nothing in this repository sets
`COMPOSE_PROJECT_NAME`; `deploy-synology.sh` calls `docker compose` with no `-p`. So the
project comes from wherever the operator typed it first. On the clinic box that is
**`care-erp-github`** — measured 2026-10-13 from the deploy folder, where a bare
`docker compose ps` listed no containers and `docker compose -p care-erp-github ps` listed
`care-api`, `care-db`, `care-redis`, `care-web` (`CARE_ERP_CLINIC_READINESS_CHECKS.md` §B,
and `CARE_ERP_PREDEPLOYMENT_GATE.md` §D says the same of the audit commands). The folder is
`care-on-synology1`, which is the name a bare command would derive — a different stack.

Why that decides whether a failover loses data:

| Volume | Declared | Belongs to |
| --- | --- | --- |
| `db_data` | `external: true, name: care_main_db_data` (`docker-compose.yml:645-647`) | nothing — the fixed name is the same under every project |
| `object_storage` | plain named volume (`:648`) | `<project>_object_storage` |
| `uploads_data` | plain named volume (`:649`) | `<project>_uploads_data` |

So starting the stack under the wrong project attaches **the real patient database** and a
**brand-new, empty pair of upload volumes**. The ERP comes up, logs in, reports patients and
bills — and the uploaded clinical documents and the frozen key-images are gone from the
screen with no error anywhere. `uploads_data` holds `/app/data/uploads/**`
(`docker-compose.yml:423`): the upload modules `reports`, `patient_documents`, `billing`,
`site_assets` (`routes/uploads.ts:19`), expense attachments, scans, radiology report
attachments, and `data/uploads/radiology-key-images` (`lib/frozenKeyImages.ts:33`). The
database holds only rows and paths, never those bytes. A finalized report's **PDF** is not
lost this way — it is rendered on demand from the database (`CARE_ERP_BACKUP_COVERAGE.md` §2)
— which is exactly why losing the frozen images is the dangerous half: the re-rendered
document is silently a different one, with no images in it.
Full detail: `CARE_ERP_BACKUP_COVERAGE.md` §3 "Uploaded documents" and §4 "Frozen key
images".

- **On the standby**, choose the project name deliberately and write it on the failover
  checklist below. `/volume1/docker/care-erp` derives `care-erp`, which is fine as long as
  every later command says the same thing.
- **On the primary**, name the live project in every stack command:
  `docker compose -p care-erp-github …`.
- **Before you call a failover complete**, prove the two upload volumes are the ones the
  previous box had content in:
  `docker volume ls | grep -E "uploads_data|object_storage"`, then open one uploaded patient
  document and one signed report's **frozen key-image rail** in the UI. A green `/health`
  does not see either of them, and a report that prints without its images looks normal.

---

## PART 1 — One-time pre-staging on the standby NAS (do this NOW, while healthy)
This is what turns "hours" into "minutes."

1. **Install Container Manager** (DSM → Package Center).
2. **Get the code** onto the standby, e.g. `/volume1/docker/care-erp`:
   ```sh
   git clone <your repo url> /volume1/docker/care-erp
   cd /volume1/docker/care-erp
   git checkout main
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
# 1. Pick the artifact by the name the job wrote, not by a guess. There is no `latest`
#    symlink anywhere in this repo — the destination holds
#    caredeoghar_<UTC stamp>.sql.gz[.meta] (or .sql.gz.enc when BACKUP_PASSPHRASE is set) —
#    so list it and read which one is newest and provable. DSM does not guarantee `node` on
#    the host, so run the repo's own tool from the image the same way the runbook does:
docker compose run --rm --no-deps schema-verify \
  node scripts/ops-backup-inventory.mjs
#    (add BACKUP_DIR=… to that command's environment if the dumps are elsewhere — Hyper
#    Backup copies them to the standby, so name the standby's own path.)
#    Use the `artifact` column with the `manifest` / `checksum` / `restored` columns beside
#    it. `CARE_ERP_BACKUP_RESTORE.md` §3 is the full procedure; these steps are the short
#    form for a box that is already pre-staged.

# 2. Start ONLY the database first, so the app never serves traffic against a
#    half-restored schema:
docker compose up -d db
until docker exec care-db pg_isready -U erp -d diagnostic_erp -q; do sleep 2; done

# 3. Restore the chosen artifact. Use `docker exec … psql`, not a host `psql`: DSM ships
#    `openssl` but not the PostgreSQL client, which is why the backup job itself reaches
#    pg_dump through `docker exec care-db`. Pipe it end to end — an unzipped `.sql` on disk
#    is the whole clinic's records in plaintext, and a patient database has no reason to sit
#    in a temp file. `ON_ERROR_STOP=1` is not optional: without it `psql` can fail every
#    statement and still exit 0, which reads as a successful restore.
export BACKUP_PASSPHRASE          # only when the artifact is .enc; never on the argv —
                                  # it would sit in `ps -ef` and in this history forever
gunzip -c /volume1/backups/caredeoghar/caredeoghar_20261015_030000.sql.gz \
  | docker exec -i care-db psql -v ON_ERROR_STOP=1 -U erp -d diagnostic_erp
# .enc instead: openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE \
#                -in <artifact>.sql.gz.enc | gunzip -c | docker exec -i care-db psql …
echo "restore exit: $?"           # must be 0 — a pipeline prints the last command's status
# Scheduler-written files (backup_<job>_*.sql) are plain SQL, not gzipped: skip gunzip.

# 4. Bring up the rest of the stack. care-db-patch-v2 applies any migrations newer
#    than the backup (idempotent); care-api starts only after schema is verified.
docker compose up -d

# 5. Confirm it is healthy. The NAS has no `pnpm` and no `npx` — run the repo's own
#    checkers with `node` (they live in the image, so the container form always works).
#    Nothing publishes 8080 on the host either: 8080 is `care-api`'s container port, so a
#    host-side `curl localhost:8080` fails on a stack that is actually fine. The
#    host-facing address is ${HOST_PORT:-8888} on care-web.
docker ps --format '{{.Names}}\t{{.Status}}'
node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}"
docker compose run --rm --no-deps schema-verify node scripts/verify-deployment.mjs
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
- [ ] The standby's compose **project name** is written here: `____________` — every command
      below is run with `-p <that name>`, and it never changes after the first `up`
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
