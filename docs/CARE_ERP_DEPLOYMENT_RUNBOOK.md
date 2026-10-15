# CARE ERP — Deployment Runbook

_Exact steps to deploy CARE ERP on the Synology NAS (Container Manager / `docker compose`), and how to roll back._

---

## 0. Pre-flight (once per environment)
1. `.env` exists next to `docker-compose.yml` with at least: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `SESSION_SECRET`, `ICICI_SECRET_KEY`. See `CARE_ERP_ENVIRONMENT_MATRIX.md`.
2. External DB volume exists: `docker volume create care_main_db_data` (only if not already present — **never** recreate over real data).
3. Optional integrations (Orthanc, OHIF, Ollama, n8n) configured only if in use.

## 1a. Read-only preflight — run this before every deploy

```sh
node scripts/ops-preflight.mjs       # the form that runs on the NAS
pnpm ops:preflight                   # the same thing on a dev box
node scripts/ops-preflight.mjs --json  # machine-readable
```

> **Which shell a command belongs to.** Synology has `node` at `/usr/local/bin/node` but
> **`pnpm` and `npx` are not on PATH** (the toolchain lives under
> `/volume1/@appstore/Node.js_v22/usr/local/bin/`), and `scripts/verify-deployment.mjs` additionally
> `import pg from "pg"`, which is installed in the image rather than on the host. So every gate
> command below is written as `node scripts/<tool>.mjs` — `ops-preflight.mjs`,
> `ops-backup-inventory.mjs` and `deploy-health.mjs` are Node-builtins-only and therefore actually
> run on the box. Anything needing `pg` runs in the container that has it:
> `docker compose run --rm --no-deps schema-verify node scripts/<tool>.mjs`. Lines that say
> `pnpm db:smoke` or `pnpm preview:reports` are **dev-box** actions, never NAS ones.

`scripts/ops-preflight.mjs` touches nothing: no migration, no write, no container
is created. It reads the repository, `.env`, `docker-compose.yml`, the backup
directory, the migration ledger and the external-result-link audit, and answers
one question — **is this box ready to deploy?** — as `READY`, `NOT_READY` or
`INSUFFICIENT_EVIDENCE` (exit 0 / 1 / 2).

It deliberately looks at the **newest** artifact only, because that is the one a
deploy is made against. Two other questions are not its job, and asking them of it
would make the gate disagree with itself:

```sh
node scripts/ops-backup-inventory.mjs   # every artifact that exists, what each sidecar
                                        # claims, which checksums were recomputed, which
                                        # restores were ever proved, and which days are
                                        # missing from the retained span
```

`scripts/ops-backup-inventory.mjs` is read-only in the same way and reaches **no
verdict** — it is an inventory, not a second gate. What it can tell you that a file
count cannot: four dumps from one night are one day of coverage, a `.meta` whose dump
is gone means retention deleted something it should not have, and a directory full of
perfect-looking artifacts can still contain no proven restore. Which datasets the
`pg_dump` in front of you does **not** contain is `docs/CARE_ERP_BACKUP_COVERAGE.md`.

Read the status words as what they are:

* **PASS** — the gate measured it and it is right.
* **FAIL** — the gate measured it and it is wrong. Fix before deploying.
* **UNKNOWN** — the gate could not tell, and refuses to guess. A critical UNKNOWN
  blocks `READY` on purpose: "no restore has ever been proven here" is not the
  same fact as "the restore works", and treating the two alike is how a clinic
  ends up with backups it cannot use.
* **NOT_APPLICABLE** — deliberately out of scope. `backup.orthanc_images` is the
  only one: DICOM image backup is excluded from ERP disaster recovery by owner
  decision, and the line says in as many words that it is not a pass.

Some facts are not observable from a repository at all — whether the deployed
HOPE build refuses an event it cannot interpret, whether anyone has ever restored
a backup on this box, what the pre-deploy image IDs were. For those the gate reads
`ops-evidence.json`, a small file **you** write after doing the work:

```sh
node scripts/ops-preflight.mjs --record-restore   # after a real restore proof
node scripts/ops-preflight.mjs --help             # the file's shape
```

It is gitignored, and that is load-bearing: `deploy-synology.sh` runs
`git reset --hard origin/main`, which would delete a tracked evidence file on
every single deploy. Recorded evidence older than 90 days is UNKNOWN again.

Two environment caveats, both deliberate:

* Run it **on the NAS**, from `/volume1/docker/care-erp-github/care-on-synology1`.
  On a laptop there is no `/volume1`, no docker and usually no live `.env`, so the
  gate reports `INSUFFICIENT_EVIDENCE` rather than pretending. If only the
  committed template `deploy/synology/care.env` is present, every check that reads
  *values* says UNKNOWN — the template lists every key with example content, and
  "all 9 required variables present" read off an example file is the exact false
  green this gate exists to prevent.
* `deploy.metadata` asks the **checkout** what commit it is, by running
  `node scripts/build-identity.mjs` here, so it no longer depends on `deploy-synology.sh`
  Step 2 having written `GIT_COMMIT` into `.env`. What it can now say is stronger than
  "the variables are filled in": either this tree resolves its commit — in which case
  the image built from it will report that SHA whatever `.env` claims — or it cannot,
  which is a critical **FAIL**, because an image that cannot resolve its commit can
  only repeat a stamp it was handed. If `.env` declares a different SHA, the line says
  so and says the image will override it; that is drift in a file, not a defect.
* `deploy.project_identity` and `deploy.volume_identity` are the two checks a
  Container Manager deploy can break and a shell deploy cannot: they read the compose
  labels off the running `care-api`, list every compose project that claims this
  checkout's `docker-compose.yml`, and then verify that the patient database is on
  `care_main_db_data` and the uploads and object storage on `care-erp-github_*`.
  A second project reuses the external database while creating fresh **empty** upload
  volumes, so the clinic's bill scans and frozen key images read as deleted while every
  money row is intact. Both are critical: `UNKNOWN` blocks `READY` here on purpose,
  because "I could not read the mounts" is not the same fact as "the mounts are right".
  Override the expected names with `CARE_COMPOSE_PROJECT` / `CARE_DB_VOLUME` if a box
  ever legitimately differs — never by editing the constants.

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

> **There is one deployment script, and it is this one.** `SOP/RECOVERY/01_INFRASTRUCTURE/deploy-synology.sh`,
> `SOP/RECOVERY/16_RUNBOOKS/deploy-synology.sh`, `SOP/RECOVERY/03_DOCKER/docker-compose.yml` and
> `SOP/RECOVERY/03_DOCKER/Dockerfile` used to hold older copies of the same four files while the
> binder's index called all four "Active". They are retired pointer files now, and running them does
> nothing but print where the live file is. `node scripts/ops-preflight.mjs` fails on any un-retired copy
> (`deploy.config_single_source`), so this cannot quietly come back.

> **If GitHub is unreachable** — a deploy is not the recovery path, but if you must bring the stack
> up from the checkout you already have, do not substitute an old copy of the script. From the
> repository root, with the tree you want to run already present:
> ```sh
> sudo docker compose up -d --build
> node scripts/deploy-health.mjs --wait --host-port "${HOST_PORT:-8888}"
> ```
> That is Step 3 of the script and nothing else: no `git reset`, no `.env` rewriting, no build-number
> bump. Running the previous commit is an acceptable outcome; running an unverified one is not.

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

The ERP is published on the host as `${HOST_PORT:-8888}:80`. **Nothing publishes
8080 on the host** — 8080 exists only inside `care-api`, where its own healthcheck
calls it. A command that curls `localhost:8080` from the NAS host cannot work; §10
records what happened the last time a script did exactly that.

```sh
docker ps --format '{{.Names}}\t{{.Status}}'         # all healthy / patch+verify Exited(0)
node scripts/deploy-health.mjs --host-port 8888      # the same gate the deploy uses
curl -fsS http://localhost:8888/api/healthz          # liveness
curl -fsS http://localhost:8888/api/health/schema    # schema-verify actually passed
curl -fsS http://localhost:8888/api/system/version   # deployed version/commit
node scripts/verify-deployed-identity.mjs --expected "$(git rev-parse HEAD)"   # the running API IS this commit
docker compose run --rm --no-deps schema-verify node scripts/verify-deployment.mjs   # full stack health
```

`scripts/verify-deployed-identity.mjs` is the step that used to be a human reading a
SHA off a page. It asks the deployed API what it is (`/health`, cross-checked against
`/api/health`) and compares that with the commit the deploy intended, and it has three
answers: exit **0 PASS** only when the running image resolved its own commit from Git
metadata and that commit is the expected one; **1 FAIL** when it is a different commit,
which means the containers are not running the code you deployed; **2 UNKNOWN** when the
API is unreachable, says nothing commit-shaped, or reports a stamp it was *handed*
rather than one it resolved (`identitySource=build-arg-declared`). UNKNOWN is not a pass
and never means "deployed correctly" — an unverifiable deploy is an unverified one.

`scripts/deploy-health.mjs` is the authoritative one: it checks the container states
and the three endpoints above, prints each answer it got, and exits non-zero if any
of them is wrong. Note that an unknown path on `care-web` returns the SPA's
`index.html` with status **200**, so "curl succeeded" is not evidence on its own —
the gate checks the response body, which is why it exists.

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

Audited 2026-10-12 against `main` = `cd752a43`; re-checked 2026-10-13 against
`main` = `8ca20cf9` (#950, #951, #952, #954, #955, #957, #958 merged — #958 is
docs-only). Nothing here was run
against the clinic: it needs the NAS, and a deploy is the owner's decision. Each row
says **LOCAL** (measured in this repo) or **NAS** (must be run on the box). Row 9's
probe changed after #952 — it is `node scripts/deploy-health.mjs`, not port 8080.

| # | Check | Command | Evidence that it passed | Where |
|---|---|---|---|---|
| 1 | A backup exists, and it is proven to restore | `bash scripts/synology-nas-backup.sh` then `bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar` (§"2. Verifying a backup restores" of `CARE_ERP_BACKUP_RESTORE.md`) | the verifier exits 0: it restored the real artifact into a throwaway container with `ON_ERROR_STOP=1`, and its printed `patients`/`bills`/`payments`/`vouchers`/`patient_reports` counts are non-zero. It checks the restored side only — comparing against the live counts is yours to do | NAS |
| 2 | Migrations this deploy will run | `git log --name-only --diff-filter=A <last-deploy>..origin/main -- migrations/*.sql` | every added file is reviewed; `deploy-synology.sh` prints the commit it reset to, and `<last-deploy>` is that SHA | NAS |
| 3 | Migration order and idempotency | `node scripts/check-migration-order.cjs` | `✓ No ordering violations` — **LOCAL: re-ran at `8ca20cf9`, 189 files, clean.** Re-application is refused by `schema_migrations_log(name, kind, sha256)` (`docker/db-patch-entrypoint.sh:223,347`), so an edited file cannot silently re-run | LOCAL + NAS |
| 4 | What actually mutated the schema | `docker logs care-db-patch-v2 --tail 60` and `docker inspect --format '{{.State.ExitCode}}' care-db-patch-v2` | `Exited (0)`, and the log names each file applied. `care-api` will not start unless patch **and** `care-schema-verify` both exit 0 (`depends_on: … service_completed_successfully`) | NAS |
| 5 | Container image versions match the code | `docker inspect --format '{{.Config.Image}} {{index .Config.Labels "com.caredeoghar.git-commit"}} {{index .Config.Labels "com.caredeoghar.build"}}' care-api care-web` then `curl -fsS http://localhost:8888/api/system/version` | the label's commit equals the SHA `deploy-synology.sh` printed, and the endpoint reports the same. `db` = `postgres:16-alpine`, `redis` = `redis:7-alpine` — the only pinned images; app images are built, so the label is the only identity they have | NAS |
| 6 | Env vars the app needs are present | `docker compose config --quiet` (fails on an unset required var) then `node scripts/check-env-secrets.mjs --file .env` | `SESSION_SECRET` uses `${SESSION_SECRET:?…}` so compose cannot start without it; the secret-strength gate runs inside `deploy-synology.sh` and must print `Guarded secrets acceptable`. Degrade-silently set: `ORTHANC_URL`, `ORTHANC_INTERNAL_URL`, `ORTHANC_USERNAME/PASSWORD`, `ENABLE_SCHEDULERS` | LOCAL + NAS |
| 7 | Uploads and objects survive | `docker volume ls \| grep -E "db_data\|object_storage\|uploads_data"` and `docker volume inspect care_main_db_data` | `object_storage` → `/app/data/object-storage`, `uploads_data` → `/app/data/uploads`, and the worklist bind mounts of `/volume1/docker/care-pacs/orthanc/worklists`. **`db_data` is `external: true, name: care_main_db_data` — the real patient database.** `deploy-synology.sh` runs `down --remove-orphans` with no `-v`, so volumes are not touched; never add `-v`, and never `docker volume prune` on this box | NAS |
| 8 | Orthanc is reachable from the API | the `node`-based `/system` probe in `CARE_ERP_PREDEPLOYMENT_GATE.md` §C — **not** `wget`, which `care-api` does not ship | JSON with the Orthanc version. `care-pacs` is a **different compose project on its own bridge network**, so `care-orthanc` does not resolve from `care-api` unless they share one — that is why `ORTHANC_CHANGES_POLLER` exists and must be `false` when `care-erp-sync` runs (see the comment block at `docker-compose.yml` api env) | NAS |
| 9 | The app is actually serving | `docker inspect --format '{{.State.Health.Status}}' care-api care-web` then `curl -fsS http://localhost:8888/api/health/schema` | `healthy` for both, and the schema probe returns `"ok":true`. Reach it on **8888** — see §10 for why the script's own probe cannot work | NAS |
| 10 | No patient data deleted or altered by the deploy | `grep -lnE "^\s*(DELETE\|TRUNCATE\|DROP TABLE\|DROP SCHEMA)" migrations/*.sql` | **LOCAL at `8ca20cf9`: three files match, all long-applied and none touches patient records** — `zzzz_ct_knowledge_packs.sql` / `zzzz_xr_knowledge_packs.sql` re-seed non-system configuration packs, and `add_report_image_panel_r13.sql:38` de-duplicates image references *only for drafts that are not finalized*, keeping the earliest row so a signed report's image set is never rewritten. The script itself only does `git reset --hard` (repo files; data lives in named volumes) and `compose down`/`up` | LOCAL + NAS |

## 10. The deploy gate, before and after PR #952

Both defects below made a failed deploy look like a successful one. **#952 fixed
them and is merged** (`0203b826`); this section is kept because the failure modes
are what the new gate is guarding, and because one item in it is still open.

1. **Its health gate could never pass** (fixed). Step 5 used to wait on
   `http://localhost:8080/api/health/schema`, but **no service publishes port 8080 on
   the host** — `grep -n ':8080' docker-compose.yml` returns only the API's own
   in-container healthcheck (`CMD curl -fsS http://localhost:8080/health`), while the
   ERP is published as `${HOST_PORT:-8888}:80`. The loop always exhausted its 90
   seconds and fell through, and the script still printed `✓ DEPLOYMENT COMPLETE`.
   It now reads `HOST_PORT` from `.env` (`deploy-synology.sh:187-196`, guarding the
   `${HOST_PORT:-8888}` compose default and rejecting a non-numeric value) and hands
   the number to `node scripts/deploy-health.mjs --wait --timeout-seconds
   "$DEPLOY_TIMEOUT" --host-port "$HOST_PORT"` (`deploy-synology.sh:254`). If that
   exits non-zero the script `fail`s — `Deployment NOT verified. Do not use the ERP
   until the check above passes.` The banner is printed only after it passes.
2. **Both wait loops reported success on timeout** (fixed). Step 4 (migrations)
   treated a missing `care-db-patch-v2` as `missing 0` and, after 120 s, continued;
   step 5 did the same after 90 s. A timeout is now a failure in both loops
   (`deploy-synology.sh:230-235`: `Migrations did not complete within ${MIGRATION_TIMEOUT}s.
   Nothing was verified`), and `DEPLOY_HEALTH_TIMEOUT_SECONDS` /
   `MIGRATION_TIMEOUT_SECONDS` override the 300 s / 240 s defaults.
3. **Still open: the script takes no backup.** `deploy-synology.sh` runs
   `git reset --hard` and `docker compose down --remove-orphans` before anything is
   saved, although `scripts/synology-nas-backup.sh` exists and is fast (it dumps
   straight out of the `care-db` container with `pg_dump`, so it does not need
   `care-api` up). §12 step 3 is where the backup belongs; it is a human step until
   the owner decides the script should do it. Do not add `-v` to the `down`, and never
   run `docker volume prune` on this box — `db_data` is `external: true, name:
   care_main_db_data`, the real patient database.
4. Also note the older `scripts/synology-backup.sh` still downloads from
   `https://caredeoghar.replit.app`, a host the clinic no longer uses — do not schedule
   it; use `scripts/synology-nas-backup.sh`.

## 11. Rollback, in the order that actually works

Migrations are forward-only (§6). Because the app image is built rather than pulled,
`docker compose up -d --build` after `git reset --hard <previous-sha>` replaces the
`:latest` tag — so record the image IDs **before** deploying
(`docker inspect --format '{{.Image}}' care-api care-web > /volume1/docker/backups/images-<date>.txt`)
if a true image rollback is ever wanted without a rebuild. Schema columns added by a
migration are inert to an older app, which is why §6's "remove the file, write a
compensating additive migration" is safe; `DROP`-style neutralisation is not.

## 12. The exact production deployment sequence

Twelve steps, in order, for the Synology box. Every command, path, port and service
name below is taken from this repository at `8ca20cf9` — `deploy-synology.sh`,
`docker-compose.yml` and the `scripts/` directory — not from memory. **Nothing in this
section has been executed against the clinic**, because that is a deploy, and a deploy
is the owner's decision. The print-and-tick form of these steps, with the open-items
register, is `docs/operations/CARE_PRODUCTION_READINESS_CHECKLIST.md`.

Before step 1, run `CARE_ERP_PREDEPLOYMENT_GATE.md` Part 1 — the four areas: database, backup,
PACS, HOPE — and record its Part 2, which states which outstanding P0/P1 item blocks which
kind of deploy. Steps 3, 4 and 10 below are the same three procedures; the gate is the
short form you can tick on the box.

The directory is the one `deploy-synology.sh` documents in its own header:

```sh
cd /volume1/docker/care-erp-github/care-on-synology1
```

| # | Step | Command | Stop the deploy if |
|---|---|---|---|
| 1 | Pre-deployment checks | `node scripts/ops-preflight.mjs` (all 24 checks; the four below are the ones a deploy most often fails on) · `df -h /volume1` · `docker compose config --quiet` · `node scripts/check-migration-order.cjs` · `node scripts/check-env-secrets.mjs --file .env` | the preflight says `NOT_READY`, disk is under 10 % free, compose cannot interpolate its own variables, the migration order gate reports a violation, or a guarded secret is weak. `INSUFFICIENT_EVIDENCE` is not a green light either — it means a critical check could not be run, most often the restore proof |
| 2 | Git revision verification | `git fetch origin main` · `git rev-parse origin/main` · `git log --name-only --diff-filter=A $(cat .git-deployed 2>/dev/null \|\| echo HEAD)..origin/main -- migrations/*.sql lib/db/drizzle/` | the SHA you are about to deploy is not the one you reviewed, or a new SQL file appeared that nobody read. Record the SHA: `echo "<sha>" > .git-deployed` after step 9 passes |
| 3 | Database backup, then prove it restores | `bash scripts/synology-nas-backup.sh` · `bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar` | either exits non-zero. `verify-backup-restore.sh` restores the real artifact into a **throwaway** container with `ON_ERROR_STOP=1`, refuses a dump that is not schema-complete, and fails if `patients` or `bills` landed empty — that is the only evidence that counts, because `deploy-synology.sh` takes **no** backup itself (§10.3) and the next step resets the working tree and recreates every container. If the artifact is encrypted, pass the passphrase through the environment — never on the command line. Full procedure, including the before/after proof that production was not touched: `docs/CARE_ERP_CLINIC_READINESS_CHECKS.md` §B |
| 4 | Historical migration-ledger audit | `docker compose run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs --json=output/ledger-audit-$(date +%F).json` | it prints any `RECORDED_BUT_ABSENT`, `CRITICAL_TABLE_MISSING` or `CRITICAL_COLUMN_MISSING`. This is the step that finds a migration the ledger recorded as applied but Postgres never finished — the condition #955 prevents but cannot undo. It is read-only by construction (`default_transaction_read_only=on`, `SELECT`/`SHOW` only). See `docs/MIGRATION_LEDGER_AUDIT.md`, and `docs/CARE_ERP_CLINIC_READINESS_CHECKS.md` §A for the target-verification pre-flight and how to read each finding |
| 5 | Record what to go back to, then rebuild | `node scripts/ops-preflight.mjs --record-rollback --auto` · `bash deploy-synology.sh` | the record refuses to write (it prints what it could not read and writes **nothing**, because a rollback record with a guessed image ID reads as complete and points at an image that does not exist), or the script exits non-zero. `--auto` takes `previous_commit` from this checkout's HEAD and `api_image`/`web_image`/`db_image` from the containers that are running now — afterwards they are gone. The script does `git reset --hard origin/main` → `docker compose down --remove-orphans` → `sudo GIT_COMMIT=… docker compose up -d --build`, forwarding the version stamps explicitly because `sudo` resets the environment (§11 explains why the image IDs matter) |
| 6 | Migration execution | `docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' care-db-patch-v2` · `docker logs care-db-patch-v2 --tail 60` | it is anything other than `exited 0`. Since #955 a Drizzle file that raises an unexpected error **fails the container** instead of being recorded and skipped forever; the log names the file and the statement. `deploy-synology.sh` already waits for this and fails on timeout (§10.2), so this step is the human double-check, not the only check |
| 7 | Schema verification | `docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' care-schema-verify` · `sed -n '1,40p' STARTUP_SCHEMA_VERIFICATION.md` | it did not exit 0. Note the limits: `SCHEMA_REPAIR` defaults to `false` and `SCHEMA_VERIFY_STRICT` to `false`, so drift is *reported* not blocked, and this container checks the columns the migration files declare — which is exactly the check that **passed** on a half-migrated database before #955. Step 4 is the audit that closes that gap; one is not a substitute for the other |
| 8 | Container startup | `docker ps --format '{{.Names}}\t{{.Status}}'` | `care-db`, `care-api`, `care-web`, `care-redis` are not `healthy`/`Up`, or `care-db-patch-v2`/`care-schema-verify` are still running. `care-api` cannot start unless both exited 0 (`depends_on: … service_completed_successfully`), so an API that is restarting while the others are fine means the schema, not the app |
| 9 | Health verification | `node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}"` · `node scripts/verify-deployed-identity.mjs --expected "$(git rev-parse HEAD)"` · `curl -fsS "http://localhost:${HOST_PORT:-8888}/api/system/version"` | the gate exits non-zero, or the identity check exits **1** (the containers are running a different commit than the one you deployed — the deploy has *not* happened, whatever the page looks like) or **2** (the running image cannot resolve its own commit, so nothing has been proven). It probes `/nginx-health`, `/api/healthz` and `/api/health/schema` and checks the **bodies**, because an unknown path on `care-web` answers `index.html` with status 200 — a bare successful curl proves nothing |
| 10 | PACS connectivity | the `node`-based `/system` probe in `CARE_ERP_PREDEPLOYMENT_GATE.md` §C (**`care-api` has no `wget`**) · `curl -fsS http://127.0.0.1:3010/care/build-info.json` · `node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}"` | Orthanc does not answer from inside the API container. `ORTHANC_INTERNAL_URL` defaults to `http://care-orthanc:8042` (`docker-compose.yml:336`), but **`care-pacs` is a different compose project on its own bridge network (`care-pacs-net`)**, so that name only resolves if the two projects share a network — the reason `ORTHANC_CHANGES_POLLER` exists and must be `false` when `care-erp-sync` runs. Measured on the clinic box 2026-10-13: `care-orthanc` does **not** resolve from `care-api`, and the live `ORTHANC_INTERNAL_URL` is the interface address `http://172.16.1.139:8042`, which answered HTTP 200 in 50–67 ms — so this leg works through an address, not through Docker DNS, and it will break silently if that interface is renumbered. The viewer's own address comes from `OHIF_URL` in the deployed environment (it may be `/ohif`, relative to the ERP origin); **there is no `OHIF_PUBLIC_BASE_URL` in compose** — that name appears only as a commented example in `.env.example`. A PACS failure does not stop reports: the frozen-image path prints a reference image with the PACS down, which `pacsImagePicker.request.test.ts` pins. Full read-only check sequence: `CARE_ERP_CLINIC_READINESS_CHECKS.md` §C |
| 11 | Clinical reporting smoke | in the browser at `http://172.16.1.139:${HOST_PORT:-8888}`: open a worklist row → one Quick Select finding → save → reopen → Print → Download PDF → durable PDF | any step differs from the same report before the deploy. What has to be true: the UHID is the patient's own code and never a numeric FK; the accession prints **only** where the server can prove it belongs to that patient (#954); attached images keep their order; a caption prints with the radiologist's own capitalisation and an absent caption prints no blank band. `pnpm preview:reports` renders the same chain locally with no server and no database — use it before you blame the NAS |
| 12 | Rollback | `git reset --hard <previous-sha>` · `docker compose up -d --build` · re-run steps 8–9 | see §11: migrations are **forward-only**, so rollback means the older app runs against the newer schema (safe, because migrations only ADD) or the image IDs from step 5 are used to retag. Never edit or delete a ledger row to make a finding disappear, and never re-run a destructive migration file; if data is implicated, `bash scripts/synology-restore.sh <artifact>` into a scratch container first and confirm, then restore for real |

**Steps 3 and 4 are not optional and not interchangeable.** Step 3 is the only thing
that makes step 12 possible; step 4 is the only thing that can tell you the database you
are about to migrate is not the database the ledger thinks you have.

Two things this sequence deliberately does not do: it does not rotate any credential
(`deploy/synology/care.env` and `hope.env` are reported in §13 and left alone by owner
decision), and it does not touch Git history.

## 12a. The same deploy from Container Manager (how the clinic actually deploys)

`deploy-synology.sh` is not the only supported path — DSM's Container Manager can build
and start the same project, and on this box it is the one in use. It is safe **only** in
the order below, because the two things the shell script does automatically — advance the
checkout to `origin/main`, and refresh the version stamps in `.env` — are exactly the two
things Container Manager cannot do. Everything here runs against the **existing** project
`care-erp-github`; nothing creates a second one, and that is the point of steps 1 and 6.

| # | Step | Where | Stop if |
|---|---|---|---|
| 1 | Identity of what is live now | `node scripts/ops-preflight.mjs` | `deploy.project_identity` or `deploy.volume_identity` is **FAIL** or **UNKNOWN**. The project name a Container Manager task uses comes from the task, not the folder, so this is the only place it can be checked; a second project on the same compose file reuses the patient database and creates fresh empty upload volumes |
| 2 | Backup + restore proof, ledger audit | §12 steps 3 and 4 | either fails. Container Manager takes no backup and runs no audit |
| 3 | Advance the checkout | `git fetch origin main` · `git rev-parse origin/main` · `git checkout main` · `git reset --hard origin/main` in `/volume1/docker/care-erp-github/care-on-synology1` | the SHA shown is not the one reviewed. `git status --porcelain` must be empty — a dirty checkout means the build will ship local edits nobody reviewed |
| 4 | Record the rollback target | `node scripts/ops-preflight.mjs --record-rollback --auto` | it writes nothing and prints what it could not read. Do this **before** the rebuild; afterwards the old image IDs no longer exist |
| 5 | Check the commit this checkout will claim | `node scripts/build-identity.mjs --git-dir .git --print` | `identitySource` is not `build-context-git`, or `staleStampDetected` is `true` and you expected `.env` to be current. The image resolves its own SHA from `.git/HEAD` and `.git/refs`, so a `.env` left behind by the last `deploy-synology.sh` run can no longer be mistaken for the build identity |
| 6 | Build and deploy the **existing** project | Container Manager → **Project** → `care-erp-github` → **Build** (or the project's update action). Do not use "Create Project", and do not re-deploy from the compose-file wizard under a new name | the UI offers a different project name, or the volumes it lists are not `care_main_db_data` / `care-erp-github_uploads_data` / `care-erp-github_object_storage`. A redownloaded-or-recreated project is how the clinic's uploaded bill scans disappear while the accounting data stays perfect |
| 7 | Migrations + schema verification | §12 steps 6 and 7 (`care-db-patch-v2` and `care-schema-verify` must both be `exited 0`) | anything else. Container Manager's "started" status says nothing about the two one-shot containers the API waits on |
| 8 | Prove what is actually running | `node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}"` · `node scripts/verify-deployed-identity.mjs --expected <sha from step 3>` | the identity check exits **1**: the containers are a different commit than the deploy intended. Exit **2** means the image cannot name its own commit, so nothing is proven — re-run step 5 and rebuild |
| 9 | Clinical smoke + record | §12 steps 11 and 12's `echo "<sha>" > .git-deployed` | the report differs from the same report before the deploy |

Rollback from Container Manager is the same §11 procedure with the same constraint: the
images are built, not pulled, so retagging the IDs recorded in step 4 is the only way back
without a rebuild, and migrations are forward-only. `docker compose down -v`,
`docker volume prune`, and deleting the project to "start again" are not rollback — they
delete the patient database and the upload volumes with it.


## 13. Secrets in tracked files — reported, not corrected here

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

**Update 2026-10-15 (PR-I11A), and the paragraph above is now partly superseded.**
The Hope pair described in it is gone from every tracked file:
`HOPE_PARTNER_KEY` / `INTEGRATION_HOPE_SIGNING_SECRET` (with HOPE's
`CARE_PARTNER_KEY` / `CARE_CALLBACK_SECRET` copies) are blank in the templates,
`deploy-synology.sh` no longer appends them, neither bootstrap can fall back to a
committed default, the step-2c gate fails an armed host that is missing one or still
holds a published value, and CI runs
`node scripts/check-no-committed-secrets.mjs --baseline scripts/committed-secrets-baseline.json`
so nothing new can be added. Because this repository is public, those two values must
be treated as disclosed: **there is now a written procedure**,
`docs/hope-care-integration/06_CREDENTIAL_ROTATION.md`, and
`node scripts/integration-credential-posture.mjs` answers "which host still holds a
published value, and do the two sides agree?" without printing one.
Everything else in the list above is **unchanged and still live** — `JWT_SECRET`,
`SESSION_SECRET`, `BACKUP_PASSPHRASE`, `CRON_SECRET`, `SUPER_ADMIN_USB_KEY`,
`INTERNAL_API_KEY`, `OCR_WORKER_TOKEN` and `hope.env`'s own session key are recorded
in the baseline as the owner's rotation decision, each with its own blast radius
(`BACKUP_PASSPHRASE` seals the encrypted backups the warning above refers to; the
session keys sign every staff login).

