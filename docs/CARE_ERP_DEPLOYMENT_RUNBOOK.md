# CARE ERP — Deployment Runbook

_Exact steps to deploy CARE ERP on the Synology NAS (Container Manager / `docker compose`), and how to roll back._

---

## 0. Pre-flight (once per environment)
1. `.env` exists next to `docker-compose.yml` with at least: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `SESSION_SECRET`, `ICICI_SECRET_KEY`. See `CARE_ERP_ENVIRONMENT_MATRIX.md`.
2. External DB volume exists: `docker volume create care_main_db_data` (only if not already present — **never** recreate over real data).
3. Optional integrations (Orthanc, OHIF, Ollama, n8n) configured only if in use.

## 1. Standard deploy (automated)
The repo ships `deploy-synology.sh`, which does exactly:
```sh
git fetch origin main
git checkout main
git reset --hard origin/main   # deploy tracks main (default branch)
export GIT_COMMIT=... GIT_BRANCH=... GIT_TAG=... BUILD_DATE=...   # version stamping
node scripts/bump-build.cjs                                  # ERP_VERSION / BUILD_NUMBER
sudo docker compose down --remove-orphans
sudo docker compose up -d --build
```
Run it:
```sh
./deploy-synology.sh
```

> **Why main:** Agent/PR work merges to GitHub `main`. The former deploy branch
> `feature/website-login-redirection` no longer exists on the remote. If the NAS
> script still fetched that name, deploy failed or reset to a stale local ref —
> clinic CARE looked unchanged while `main` kept advancing.

## 2. What happens on `up` (do not intervene mid-sequence)
```
care-db → healthy
  → care-db-patch-v2  applies migrations (Drizzle journal order, then migrations/*.sql
                      alphabetical), records schema_deploy_state, exits 0
     → care-schema-verify  confirms schema matches; exits 0 (blocks only on DB-identity
                           mismatch, or drift when SCHEMA_VERIFY_STRICT=true)
        → care-api  starts, healthcheck GET /health
           → care-web  nginx starts, healthcheck GET /nginx-health
```
`care-api` will **not** start unless `care-db-patch-v2` and `care-schema-verify` both exit 0 — a schema mismatch cannot silently serve traffic.

## 3. Post-deploy verification (required)
```sh
docker ps --format '{{.Names}}\t{{.Status}}'         # all healthy / patch+verify Exited(0)
pnpm operations:verify-deployment                     # full stack health
curl -fsS http://localhost:8080/health                # {"ok":true}
curl -fsS http://localhost:8080/api/system/version    # deployed version/commit
```
Expected: verifier prints "✓ No deployment-blocking failures." External services you haven't configured show **SKIPPED — NOT CONFIGURED** (not a failure).

Then the owner smoke: log in → Operational Health → `/radiology/usg-demo` (see `CARE_ERP_MASTER_HANDOVER.md` §Owner checklist).

## 4. First-ever install (empty database)
Same as above. The migration path is proven to bootstrap a completely empty DB end-to-end (`pnpm db:smoke` → 23/23). The first admin user is auto-seeded (default PIN `1234` for the bootstrap email); change it immediately, then ensure `BOOTSTRAP_ADMIN_FORCE` is `false`/unset.

## 5. Emergency / manual migration (rarely needed)
The automatic `care-db-patch-v2` handles all normal migrations. Only if debugging:
```sh
docker compose --profile manual run --rm care-migrate      # Drizzle TS migrator (db-deploy.ts)
```
One-off owner-reviewed data scripts run in the same container, e.g.:
```sh
docker compose run --rm care-migrate pnpm --filter @workspace/db run phase-f:assess
```

## 6. Rollback
Migrations are **forward-only** — there is no automatic data rollback. To roll back the application:
1. Identify the previous good commit/tag (`/api/system/version` history, or `git log`).
2. `git reset --hard <previous-commit>` on `main`, then `docker compose up -d --build`.
3. The schema stays forward (idempotent, additive) — an older app image runs fine against the newer schema because migrations only ADD. If a specific migration must be neutralised, **remove its `migrations/*.sql` file** (removing a file never touches the DB) and write a compensating additive migration; never edit an already-applied migration.
4. For data corruption, restore from backup — see `CARE_ERP_RECOVERY_GUIDE.md`.

## 7. Safety guards you will see in logs (all good signs)
- **DB target printout** — host/port/db/user printed before any mutation (catches a wrong-`.env`).
- **DB identity check** — `system_database_identity` stamped `app_name=care-erp`; a mismatch **fails loudly** rather than migrating the wrong database.
- **Migration lock** — `schema_migration_lock` prevents two migration runs racing; auto-expires after 10 min if a run crashed.

## 8. When NOT to deploy
- A migration-order preflight fails: `node scripts/check-migration-order.cjs` → fix first.
- `pnpm db:smoke` fails against a scratch DB → the clean boot is broken; do not ship.
- Disk `<10%` free on the NAS → free space first (deploys write build layers).

## 9. Deployment-readiness checklist (10 checks, with the command and what counts as evidence)

Audited 2026-10-12 against `main` = `cd752a43`. Nothing here was run against the
clinic: it needs the NAS, and a deploy is the owner's decision. Each row says
**LOCAL** (measured in this repo) or **NAS** (must be run on the box).

| # | Check | Command | Evidence that it passed | Where |
|---|---|---|---|---|
| 1 | A backup exists, and it is proven to restore | `bash scripts/synology-nas-backup.sh` then §"2. Verifying a backup restores" of `CARE_ERP_BACKUP_RESTORE.md` | a `.sql.gz` (or `.enc`) file whose size is > 0, restored into a scratch DB with row counts printed from both sides | NAS |
| 2 | Migrations this deploy will run | `git log --name-only --diff-filter=A <last-deploy>..origin/main -- migrations/*.sql` | every added file is reviewed; `deploy-synology.sh` prints the commit it reset to, and `<last-deploy>` is that SHA | NAS |
| 3 | Migration order and idempotency | `node scripts/check-migration-order.cjs` | `✓ No ordering violations` — **LOCAL: ran at `cd752a43`, 189 files, clean.** Re-application is refused by `schema_migrations_log(name, kind, sha256)` (`docker/db-patch-entrypoint.sh:223,347`), so an edited file cannot silently re-run | LOCAL + NAS |
| 4 | What actually mutated the schema | `docker logs care-db-patch-v2 --tail 60` and `docker inspect --format '{{.State.ExitCode}}' care-db-patch-v2` | `Exited (0)`, and the log names each file applied. `care-api` will not start unless patch **and** `care-schema-verify` both exit 0 (`depends_on: … service_completed_successfully`) | NAS |
| 5 | Container image versions match the code | `docker inspect --format '{{.Config.Image}} {{index .Config.Labels "com.caredeoghar.git-commit"}} {{index .Config.Labels "com.caredeoghar.build"}}' care-api care-web` then `curl -fsS http://localhost:8888/api/system/version` | the label's commit equals the SHA `deploy-synology.sh` printed, and the endpoint reports the same. `db` = `postgres:16-alpine`, `redis` = `redis:7-alpine` — the only pinned images; app images are built, so the label is the only identity they have | NAS |
| 6 | Env vars the app needs are present | `docker compose config --quiet` (fails on an unset required var) then `node scripts/check-env-secrets.mjs --file .env` | `SESSION_SECRET` uses `${SESSION_SECRET:?…}` so compose cannot start without it; the secret-strength gate runs inside `deploy-synology.sh` and must print `Guarded secrets acceptable`. Degrade-silently set: `ORTHANC_URL`, `ORTHANC_INTERNAL_URL`, `ORTHANC_USERNAME/PASSWORD`, `ENABLE_SCHEDULERS` | LOCAL + NAS |
| 7 | Uploads and objects survive | `docker volume ls \| grep -E "db_data\|object_storage\|uploads_data"` and `docker volume inspect care_main_db_data` | `object_storage` → `/app/data/object-storage`, `uploads_data` → `/app/data/uploads`, and the worklist bind mounts of `/volume1/docker/care-pacs/orthanc/worklists`. **`db_data` is `external: true, name: care_main_db_data` — the real patient database.** `deploy-synology.sh` runs `down --remove-orphans` with no `-v`, so volumes are not touched; never add `-v`, and never `docker volume prune` on this box | NAS |
| 8 | Orthanc is reachable from the API | `docker exec care-api sh -c 'wget -qO- $ORTHANC_INTERNAL_URL/system'` | JSON with the Orthanc version. `care-pacs` is a **different compose project on its own bridge network**, so `care-orthanc` does not resolve from `care-api` unless they share one — that is why `ORTHANC_CHANGES_POLLER` exists and must be `false` when `care-erp-sync` runs (see the comment block at `docker-compose.yml` api env) | NAS |
| 9 | The app is actually serving | `docker inspect --format '{{.State.Health.Status}}' care-api care-web` then `curl -fsS http://localhost:8888/api/health/schema` | `healthy` for both, and the schema probe returns `"ok":true`. Reach it on **8888** — see §10 for why the script's own probe cannot work | NAS |
| 10 | No patient data deleted or altered by the deploy | `grep -lnE "^\s*(DELETE\|TRUNCATE\|DROP TABLE\|DROP SCHEMA)" migrations/*.sql` | **LOCAL at `cd752a43`: three files match, all long-applied and none touches patient records** — `zzzz_ct_knowledge_packs.sql` / `zzzz_xr_knowledge_packs.sql` re-seed non-system configuration packs, and `add_report_image_panel_r13.sql:38` de-duplicates image references *only for drafts that are not finalized*, keeping the earliest row so a signed report's image set is never rewritten. The script itself only does `git reset --hard` (repo files; data lives in named volumes) and `compose down`/`up` | LOCAL + NAS |

## 10. Two defects in `deploy-synology.sh` — found by reading it, not yet changed

Both make a failed deploy look like a successful one. They are listed here rather
than fixed in the same change as a feature, because this file is the clinic's
only deploy path and the fix must be tried on the box deliberately.

1. **Its health gate can never pass.** Step 5 waits on
   `http://localhost:8080/api/health/schema`, but **no service publishes port 8080 on
   the host** — `grep -n ':8080' docker-compose.yml` returns only the API's own
   in-container healthcheck (`CMD curl -fsS http://localhost:8080/health`), and the ERP
   is published as `${HOST_PORT:-8888}:80`. The loop therefore always exhausts its 90
   seconds and falls through, and the script still prints
   `✓ DEPLOYMENT COMPLETE`. Correct probe:
   `curl -fsS http://localhost:8888/api/health/schema`.
2. **Both wait loops report success on timeout.** Step 4 (migrations) treats a missing
   `care-db-patch-v2` as `missing 0` and, after 120 s, continues; step 5 does the same
   after 90 s. Neither sets a failure. A deploy that never started the API prints the
   same banner as one that worked. The loops should `fail` on timeout, or the script
   should gate on `docker inspect --format '{{.State.Health.Status}}' care-api`.

Also worth knowing before the next deploy: the script takes **no backup** before
`git reset --hard` + `compose down --remove-orphans`, although `scripts/synology-nas-
backup.sh` exists and is fast. Run it first. The older `scripts/synology-backup.sh`
still downloads from `https://caredeoghar.replit.app`, a host the clinic no longer
uses — do not schedule it.

## 11. Rollback, in the order that actually works

Migrations are forward-only (§6). Because the app image is built rather than pulled,
`docker compose up -d --build` after `git reset --hard <previous-sha>` replaces the
`:latest` tag — so record the image IDs **before** deploying
(`docker inspect --format '{{.Image}}' care-api care-web > /volume1/docker/backups/images-<date>.txt`)
if a true image rollback is ever wanted without a rebuild. Schema columns added by a
migration are inert to an older app, which is why §6's "remove the file, write a
compensating additive migration" is safe; `DROP`-style neutralisation is not.

## 12. Secrets in tracked files — reported, not corrected here

`git ls-files` shows two tracked env templates that carry live values, not
placeholders: `deploy/synology/care.env` and `deploy/synology/hope.env`. In
`care.env` the keys with 64-character values include `SESSION_SECRET`,
`JWT_SECRET`, `BACKUP_PASSPHRASE`, `CRON_SECRET`, `SUPER_ADMIN_USB_KEY`,
`INTERNAL_API_KEY`, `OCR_WORKER_TOKEN`, `INTEGRATION_HOPE_SIGNING_SECRET`,
`HOPE_PARTNER_KEY` and a `DB_PASSWORD`; `hope.env` carries its own
`SESSION_SECRET` plus the partner key and callback secret. (The third tracked
template, `NAS_OVERNIGHT_ENV_PATCH.env`, holds only scheduler and Ollama
settings — no secrets.) `deploy-synology.sh` also appends two Hope integration
values into `.env` by name when they are missing, so the same secrets live in the
repository's history and in the script.

No file was deleted, rewritten or git-ignored as part of this checklist: rotating
these means re-issuing keys on CARE *and* HOPE, and purging history means a force-push
that every open branch must re-base onto. That is an owner decision with a downtime
window, and it should be its own change. There is no rotation procedure written down
in this repo yet — `CARE_ERP_BACKUP_RESTORE.md` only warns that changing
`SESSION_SECRET` makes older encrypted backups unreadable unless the previous value
is kept for the rotation window.

