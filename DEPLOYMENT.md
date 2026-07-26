# Care Diagnostics ERP — Zero-Touch Deployment Guide

## TL;DR — Every future deployment is exactly two commands

```bash
git pull
docker compose up -d --build
```

Nothing else is ever required. Schema migrations run automatically.

---

## How it works

### Single source of truth for schema

Five components can theoretically touch the database. Only one of them
actually applies schema *changes* in a normal deployment — everything else is
either read-only or restricted to safe, additive compatibility patches:

| Component | Role | Mutates schema? |
|---|---|---|
| `care-db-patch-v2` | **THE official migration container.** Applies every Drizzle (`lib/db/drizzle/*.sql`) and feature (`migrations/*.sql`) migration, tracked and idempotent. | Yes — this is its whole job. |
| `care-schema-verify` | Compares live DB against every migration file. **Read-only by default.** | Only if `SCHEMA_REPAIR=true` is explicitly set. |
| `care-api` startup | `runStartupMigrations()` — belt-and-suspenders compatibility patches. | Only `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX ... IF NOT EXISTS`. No new `RENAME`/`DROP` logic is allowed here going forward. |
| `care-migrate` | Alternate Drizzle TypeScript migrator. **Manual/emergency only** (`profiles: [manual]`) — never runs in a normal `docker compose up`. | Yes, but only when an operator runs it deliberately. |
| `care-db` | PostgreSQL itself. Never recreated by a normal rebuild. | N/A — just storage. |

### Startup order (enforced by `docker-compose depends_on`)

```
care-db (PostgreSQL)
    │  healthcheck: pg_isready (every 5s, up to 30 retries)
    ▼
care-db-patch-v2  ← THE ONLY SCHEMA MIGRATION STEP
    │  Runs docker/db-patch-entrypoint.sh
    │  1. Prints exact DB target (deployment guard)
    │  2. Verifies/stamps DB identity (system_database_identity)
    │  3. Acquires the migration lock (schema_migration_lock)
    │  4. Applies Drizzle + feature migrations
    │  Exits 0 on success, non-zero on any failure
    │  condition: service_completed_successfully
    ▼
care-schema-verify  ← READ-ONLY REPORT (unless SCHEMA_REPAIR=true)
    │  Same DB-target printout + identity check as above.
    │  Reports drift; does NOT block on drift by default.
    │  DOES block (exit 1) on a DB identity mismatch, or on drift
    │  if SCHEMA_VERIFY_STRICT=true.
    │  condition: service_completed_successfully
    ▼
care-api  (Express.js)
    │  Only starts after BOTH care-db-patch-v2 AND care-schema-verify exit 0
    │  Read-only identity check + advisory lock before its own
    │  ADD COLUMN IF NOT EXISTS compatibility patches run
    │  healthcheck: GET /health (every 15s, up to 5 retries)
    │  condition: service_healthy
    ▼
care-web  (nginx)
    Only starts after care-api is healthy
```

If **any step fails**, everything downstream does NOT start. You will never have
an API running against an old (or wrong) schema.

### Safety guards added on top of the migration flow

**Deployment guard (DB target printout).** Both `care-db-patch-v2` and
`care-schema-verify` print the exact host, port, database name, username,
`current_database()`, `current_schema()`, and server address before touching
anything. A misconfigured `.env` pointing at the wrong Postgres is now
immediately visible in `docker compose logs`, instead of silently succeeding
against the wrong target.

**DB identity check (`system_database_identity`).** The first time
`care-db-patch-v2` ever runs against a given database, it stamps a
`system_database_identity` row with `app_name='care-erp'` (configurable via
`APP_NAME`). Every run after that — by `care-db-patch-v2`, `care-schema-verify`,
or `care-api`'s own startup — verifies the stamp still matches. If it doesn't
(wrong `DATABASE_URL`, wrong `DB_HOST`, or a restored backup from a different
project/environment), the mismatched component refuses to run migrations and
fails loudly instead of touching what might be the wrong database.

**Migration lock (`schema_migration_lock`).** Before applying any change,
`care-db-patch-v2` and `care-schema-verify --repair` acquire a row-level lock
in `schema_migration_lock` (an atomic `UPDATE ... WHERE`, not a session-scoped
advisory lock, since `db-patch-entrypoint.sh` opens many short-lived
connections rather than holding one session open). `care-api`'s startup
migrations use a real `pg_advisory_lock` instead, since that function holds a
single connection for its whole duration. Either way, two migration runs can
never race each other. A stale lock (a container that crashed mid-migration)
auto-expires after 10 minutes.

---

### What `care-db-patch-v2` does (automatically, on every deployment)

**Step 0 — Deployment guard, identity check, migration lock**
Prints the exact DB target (host/port/database/user/`current_database()`/
`current_schema()`/server address), verifies or stamps
`system_database_identity`, then acquires `schema_migration_lock`. See
"Safety guards" above for the full rationale. Fails loudly (exit 1, nothing
downstream starts) on an identity mismatch or an unavailable lock.

**Step 1 — Wait for PostgreSQL**
Polls `pg_isready` every 2 seconds. Fails after 60 seconds.

**Step 2 — Bootstrap migration tracking**
Creates `drizzle.__drizzle_migrations` and `public.schema_migrations_log` tables.
Both are idempotent — safe to run when they already exist.

**Step 3 — Apply Drizzle migrations (auto-detected)**
Reads `lib/db/drizzle/meta/_journal.json` and applies every migration in journal
order. Skips migrations already in `drizzle.__drizzle_migrations` by SHA-256 hash.

**No hardcoded list.** Adding a new Drizzle migration file and updating the journal
is all that is needed — it will be applied on the next deployment automatically.

**Step 4 — Apply feature migrations (auto-discovered)**
Scans `migrations/*.sql` in alphabetical order. Applies files that haven't been
recorded in `schema_migrations_log`. Skips already-applied files by SHA-256 hash.

**No registration required.** Drop a new `.sql` file in `migrations/` and it will
be applied on the next deployment.

**Step 5 — Schema verification**
Checks that critical columns exist after all migrations run. If any column is
missing, the script exits non-zero → `care-api` never starts → `care-web` never
starts. You get a hard failure instead of a silent runtime error.

Columns checked:
- `radiology_worklist.ai_feedback` (caused "column does not exist" in prod)
- `radiology_worklist.source_pacs`
- `radiology_worklist.ai_draft_status`
- `clinic_settings.ollama_enabled`
- `clinic_settings.active_payment_gateway`
- `clinic_settings.icici_enabled`
- `bills.client_ref`
- `orders.client_ref`

**Step 6 — Schema fingerprint**
Records deployment metadata in `schema_deploy_state`:
- `db_patch_ok = 'true'`
- `total_migrations = N`
- `patch_version = YYYYMMDDHHMMSS`

---

### What `care-schema-verify` does (read-only by default)

Runs after `care-db-patch-v2` completes, using the full workspace (Node.js +
`scripts/db-schema-verify.cjs`). It parses **every** migration SQL file —
`CREATE TABLE`, `ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN`, `RENAME TO`
(table rename), `ALTER COLUMN ... TYPE`, `DROP INDEX`/`CREATE INDEX` — in
true chronological order, so a column or table that was renamed/dropped in a
later migration is correctly recognized as gone, not "expected forever."
This is what actually fixes the class of bug where a deprecated column kept
reappearing after every redeploy.

```bash
# What runs automatically (docker-compose.yml default):
node scripts/db-schema-verify.cjs --verbose

# Equivalent to:
SCHEMA_REPAIR=false SCHEMA_VERIFY_STRICT=false node scripts/db-schema-verify.cjs --verbose
```

**Default behavior — verify only, non-blocking on drift:**
- Reports every mismatch found (missing tables/columns, type mismatches,
  missing indexes) to `STARTUP_SCHEMA_VERIFICATION.md` and the container
  logs.
- Does **not** modify the schema.
- Does **not** block `care-api` from starting just because drift was found
  — ordinary drift is informational, reviewed by a human, not an
  emergency.
- **Always** blocks (exit 1) on a DB identity mismatch, regardless of any
  other setting — that's not "drift", it's "this might be the wrong
  database".

**Opt-in auto-repair** (`SCHEMA_REPAIR=true` in `.env`, or `--repair` for a
one-off manual run):
- Applies safe, additive-only DDL: `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Never `DROP`s, never modifies existing data.
- Takes the migration lock first, so it can't race `care-db-patch-v2`.
- Re-verifies afterward; exits non-zero if repair didn't fully fix things.

**Opt-in strict mode** (`SCHEMA_VERIFY_STRICT=true` in `.env`):
- Restores the old "any drift blocks deployment" behavior, without
  enabling auto-repair. Use this if you want to be forced to look at every
  deploy before `care-api` starts.

```bash
# One-off manual repair run (does NOT change the .env default):
docker compose run --rm -e SCHEMA_REPAIR=true care-schema-verify

# Review what would happen without applying anything:
docker compose run --rm care-schema-verify node scripts/db-schema-verify.cjs --verify --verbose
```

---

### What `care-api` does on startup

The API's `runStartupMigrations()` function applies a second, smaller set of
idempotent `ADD COLUMN IF NOT EXISTS` patches (belt-and-suspenders). Before
it does anything, it runs the same read-only DB identity check as the other
two components (failing loudly — logged, not silent — if the database looks
wrong) and takes a `pg_advisory_lock` so it can't race a concurrent
`care-db-patch-v2` run. These patches are non-fatal to the API process
because `care-db-patch-v2` already guaranteed the schema; **new
`RENAME COLUMN`/`DROP COLUMN` logic should not be added here** — write a
`migrations/*.sql` file instead so `care-db-patch-v2` applies it once, in a
tracked way.

The API exposes two health endpoints:

```
GET /health
→ 200 { ok: true }  always (liveness check)

GET /api/health/schema
→ 200 { ok: true, state: { db_patch_ok, total_migrations, patch_version } }
→ 503 { ok: false, error: "...", missing: [...] }  if schema is behind
```

Docker uses `/api/health/schema` as the readiness probe before allowing
`care-web` to start.

---

## Adding new migrations

### New Drizzle migration

```bash
# On your development machine:
cd lib/db
pnpm drizzle-kit generate

# This creates:
#   lib/db/drizzle/0006_your_description.sql
#   (and updates meta/_journal.json automatically)

git add lib/db/drizzle/0006_your_description.sql lib/db/drizzle/meta/_journal.json
git commit -m "db: add migration 0006_your_description"
git push
```

On the next `docker compose up -d --build`, the migration is applied automatically.

### New feature migration (ADD COLUMN, seed data, indexes)

```bash
# Create a new file in migrations/ with a descriptive name
# Prefix with a number to control order (alphabetical sort)
cat > migrations/0010_add_referral_pacs_profile.sql << 'SQL'
-- Adds pacs_network_profile column that was missing in production
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS pacs_network_profile TEXT;
SQL

git add migrations/0010_add_referral_pacs_profile.sql
git commit -m "db: add pacs_network_profile column migration"
git push
```

On the next `docker compose up -d --build`, the migration is applied automatically.
No other file needs to be changed.

---

## Deployment commands

### Normal deployment (code + schema changes)

```bash
# SSH into Synology NAS
ssh admin@192.168.1.137

# Navigate to project
cd /volume1/care-erp  # or wherever the repo is

# Pull and deploy
git pull
docker compose up -d --build
```

### Monitor the deployment

```bash
# Watch migration logs (runs in db-patch-v2)
docker compose logs -f care-db-patch-v2

# Watch schema verification report (read-only unless SCHEMA_REPAIR=true)
docker compose logs -f care-schema-verify

# Watch API startup
docker compose logs -f care-api --tail 100

# Check schema health after deployment
curl http://localhost:8080/api/health/schema
# → { "ok": true, "state": { "db_patch_ok": "true", "total_migrations": "42", ... } }

# Check all services
docker compose ps
```

### If a migration fails

```bash
# See the exact error
docker compose logs care-db-patch-v2

# care-api will NOT have started — confirm:
docker compose ps
# care-db-patch-v2   Exited (1)   ← migration failed
# care-api           Created      ← never started

# Fix the failing SQL file, then redeploy:
git pull
docker compose up -d --build
```

### Rollback (if needed)

```bash
# Rollback to previous image (images are cached by Docker)
docker compose down
git checkout HEAD~1  # or specific tag
docker compose up -d --build

# If data was changed: restore from the daily backup
# Backup location: configured in docker-compose OBJECT_STORAGE_DIR
```

---

## Production verification checklist

After every deployment, verify:

```bash
# 1. All containers running
docker compose ps

# 2. Schema is current
curl http://localhost:8080/api/health/schema

# 3. API is responding
curl http://localhost:8080/health

# 4. ERP login works
curl -s http://localhost:8888/erp/ | grep -q "Care Diagnostics" && echo "ERP OK"

# 5. Migration log (how many applied)
docker compose logs care-db-patch-v2 | tail -20

# 6. WhatsApp Cloud API (if ff_whatsapp_cloud_api is enabled) — see
#    docs/WHATSAPP_CLOUD_API_SETUP.md for first-time setup.
curl -fsS -H "Authorization: Bearer $WHATSAPP_AUTOMATION_SECRET" \
  http://localhost:8080/api/internal/automations/whatsapp/health
```

Expected output:
```
✓ Database connected
✓ Migration tracking ready
▸ [skip] 0000_dear_forge (already applied)
▸ [skip] 0001_warm_leopardon (already applied)
...
✓ Drizzle migrations: 0 applied, 6 already current
✓ Feature migrations: 0 applied, 9 already current
✓ Schema fingerprint recorded
✓ Schema verification passed — all critical columns present
✓ All migrations complete — API may start
```

---

## Environment variables (.env)

Required — deployment fails if missing or placeholder:

```bash
JWT_SECRET=<64-char random string>      # openssl rand -hex 32
SESSION_SECRET=<64-char random string>  # openssl rand -hex 32
ICICI_SECRET_KEY=<from ICICI dashboard>
```

Optional but important:

```bash
DB_USER=erp
DB_PASSWORD=changeme        # change in production
DB_NAME=diagnostic_erp
DB_HOST_PORT=5400           # host port for PostgreSQL
DB_BIND_ADDR=127.0.0.1      # interface the DB port binds to. Loopback by default:
                            # a bare "5400:5432" binds 0.0.0.0, which put the
                            # database on the whole clinic network (and the
                            # internet, if the NAS forwards it). To reach it from
                            # a Windows DB client, bind the Tailscale interface
                            # (DB_BIND_ADDR=100.x.y.z) rather than 0.0.0.0.
                            # Note: Ollama does NOT need this — the API calls OUT
                            # to OLLAMA_URL, it never connects to Postgres.
HOST_PORT=8888              # host port for the ERP web interface
PUBLIC_BASE_URL=https://caredeoghar.com
ORTHANC_URL=http://192.168.1.137:8042
ENABLE_SCHEDULERS=1         # enable cron jobs (billing, PACS watchdog, etc.)

# Schema architecture guards (see "Safety guards" above) — safe to leave at
# their defaults; only change these deliberately, one deploy at a time.
APP_NAME=care-erp           # DB identity stamp — must be the same across
                             # care-db-patch-v2 / care-schema-verify / care-api
APP_ENVIRONMENT=production  # informational, stored alongside the identity stamp
SCHEMA_REPAIR=false         # true = care-schema-verify auto-repairs (ADD-only)
SCHEMA_VERIFY_STRICT=false  # true = any schema drift blocks care-api startup
```

---

## Architecture overview

```
Synology NAS (192.168.1.137)
├── care-db          PostgreSQL 16           port 5400 (host, loopback-bound)
├── care-db-patch-v2 Migration runner        (runs once per deploy, exits)
├── care-api         Express.js API          port 8080 (internal)
└── care-web         nginx (SPA + proxy)     port 8888 (host → Cloudflare)

Windows AI PC (192.168.1.250)
└── Ollama           LLM inference           port 11434 (LAN only, NOT public)

Cloudflare Tunnel
├── caredeoghar.com       → Synology:8888 (ERP)
└── webui.caredeoghar.com → Synology:3000 (Open WebUI)

Orthanc PACS:  http://192.168.1.137:8042
OHIF Viewer:   http://192.168.1.137:3010
```

---

## Safe Synology rebuild steps (exact commands)

**A normal redeploy should only ever rebuild `care-api` and `care-web`.**
`care-db` is never recreated. `care-db-patch-v2` and `care-schema-verify` run
automatically as part of the same `docker compose up -d --build` — you never
invoke them separately — but neither one requires an image rebuild of its
own beyond what Docker's layer cache already handles quickly.

```bash
# 1. SSH into the Synology NAS
ssh admin@192.168.1.137
cd /volume1/care-erp   # or wherever the repo is checked out

# 2. Pull the latest code
git pull

# 3. Rebuild and restart — this is the ENTIRE deploy
docker compose up -d --build

# What actually happens, in order, every time:
#   care-db            → untouched (already running, healthy)
#   care-db-patch-v2    → recreated fresh, runs migrations, exits 0, removed
#   care-schema-verify  → recreated fresh, verifies (read-only), exits 0, removed
#   care-api            → image rebuilt from source, container recreated
#   care-web            → image rebuilt from source, container recreated

# 4. Confirm everything came up clean
docker compose ps
docker compose logs --tail 30 care-db-patch-v2
docker compose logs --tail 30 care-schema-verify
curl -s http://localhost:8080/health
```

**What this never does:**
- Never deletes the `care-db` container.
- Never touches the `db_data` Postgres volume — no patient, billing, or
  report data is ever at risk from a normal redeploy.
- Never runs `care-schema-verify` in repair mode (no `SCHEMA_REPAIR=true`
  unless you've explicitly set it in `.env` for this deploy).
- Never runs `care-migrate` (manual/emergency only, see below).

**If you specifically need a one-off schema repair** (reviewed
`STARTUP_SCHEMA_VERIFICATION.md`, decided the drift is safe to auto-fix):
```bash
docker compose run --rm -e SCHEMA_REPAIR=true care-schema-verify
# then redeploy normally — SCHEMA_REPAIR was NOT saved to .env, so the next
# normal `docker compose up -d --build` goes back to read-only verify.
```

**If a deploy fails with a DB IDENTITY MISMATCH:** stop. Do not re-run, do
not add `SCHEMA_REPAIR=true`. Check `DATABASE_URL`/`DB_HOST`/`DB_NAME` in
`.env` — this almost always means `.env` is pointing at the wrong database
(a different project's Postgres, a restored backup, or a typo introduced
while editing `.env`).

---

## Operational Health & Deployment Smoke Test

After every Container Manager rebuild, verify the system is actually
operational — in about a minute — with the smoke test or the admin dashboard.
Both run the **same** checks (application, database, authentication, core ERP,
radiology/PACS, queue displays, integrations, storage/backup) and report each
as **PASS / WARNING / FAIL / SKIPPED / UNKNOWN**. No secrets or PHI are ever
returned.

### One-command smoke test (terminal)

Run it inside the api container (it has `DATABASE_URL` and all env already):

```bash
# From the Synology host:
docker compose exec care-api pnpm smoke:production
# or, equivalently, directly:
docker compose exec care-api node dist/smoke-cli.mjs
```

Options (repository-standard flags):

| Flag | Effect |
|---|---|
| `--json` | Machine-readable JSON to stdout (for CI / scripts) |
| `--base-url <url>` | API base to probe (default `http://localhost:$PORT`) |
| `--include-optional` | Also run optional integration checks (n8n, Evolution, payment, public site) |
| `--timeout <ms>` | Per-check timeout (default 5000) |
| `--save-result` | Persist the run into `operational_health_runs` (history) |
| `--transactional` | Also run the rollback-isolated create/read/update probe (never commits) |
| `--strict` | Make an UNKNOWN overall exit non-zero too |

**Exit codes:** `0` = all required checks passed (warnings are non-fatal and
reported separately); `1` = a required check FAILed (or, with `--strict`, an
UNKNOWN overall). This makes it safe to gate a deploy script on the exit code.

Example:

```text
CARE-ERP DEPLOYMENT SMOKE TEST
PASS  API Health                     API responding (12ms)
PASS  PostgreSQL connection          connection succeeded (14ms)
PASS  Admin endpoint rejects anon    admin health endpoint correctly rejects anonymous access (401)
PASS  Orthanc connectivity           Orthanc reachable, version 1.12.4 (8ms)
WARN  Orthanc → ERP sync freshness   last successful sync was 37 min ago
PASS  Queue USG                      queue/usg responds (200)
SKIP  Evolution API                  Evolution API not configured (set EVOLUTION_API_URL to enable)
Overall: WARNING
Version: 2.0.0 (build 1) commit a1b2c3d4
Duration: 840ms
```

### Admin dashboard

Route (owner/admin only): **`/radiology/operational-health`** — in the
sidebar under **Radiology & Imaging → Operational Health**. Shows the overall
banner, per-category service cards (status + latency + message + expandable
safe details + recommended action), application version / Git commit / build
time, a **Refresh** (live) and **Run full smoke test** (persists) button,
FAIL/WARNING/ALL filters, and the recent smoke-test run history.

Backed by (admin-gated: `requireStaffAuth` + `requireAdminRole`):
`GET /api/admin/operations/health` (live), `POST /api/admin/operations/smoke-run`
(run + persist), `GET /api/admin/operations/history`.

Run history is stored in `operational_health_runs` with **bounded retention** —
each write (admin run or CLI `--save-result`) prunes to the newest 200 rows
(`OPS_HISTORY_RETENTION`), so the table cannot grow without limit and needs no
background worker.

### What each status means

| Status | Meaning |
|---|---|
| **PASS** | Check succeeded. |
| **WARNING** | Non-fatal — e.g. stale-but-present sync, no recent DICOM past threshold, an optional integration down. Never fails the deploy. |
| **FAIL** | A required check failed (API/DB/auth/core-ERP/Orthanc-when-configured). Investigate before considering the deploy healthy. |
| **SKIPPED** | Not applicable — an unconfigured optional integration, or a check that only runs in another mode. Never a failure. |
| **UNKNOWN** | Could not be verified (e.g. a column/table absent in this environment, a probe timeout). Honest — never masquerades as PASS. |

### Optional-integration env vars

These are checked **only when configured** (otherwise SKIPPED, never FAIL):

| Variable | Enables the check for |
|---|---|
| `N8N_HEALTH_URL` (or `N8N_URL`) | n8n reachability |
| `EVOLUTION_API_URL` | Evolution API reachability — **deprecated, unrelated to CARE's WhatsApp integration** (Meta Cloud API, configured via Admin → Integrations → WhatsApp); kept only as an optional legacy probe |
| `PUBLIC_BASE_URL` (or `NETWORK_PUBLIC_DOMAIN`) | Public website / reverse proxy reachability |
| `ORTHANC_URL` / `ORTHANC_INTERNAL_URL` (+ `ORTHANC_USERNAME`/`ORTHANC_PASSWORD`) | Orthanc `/system` connectivity + auth |
| `OHIF_URL` | OHIF viewer reachability |

### Troubleshooting common failures

| Symptom | Likely cause / fix |
|---|---|
| `FAIL API Health` from the CLI | `--base-url` wrong, or care-api not up. Check `docker compose ps` and `docker compose logs care-api`. |
| `FAIL Required configuration` | `JWT_SECRET` / `SESSION_SECRET` / `DATABASE_URL` missing from the api container env — set them in Container Manager and redeploy. |
| `FAIL Admin endpoint rejects anon → returned 200` | The admin endpoint is not behind auth — a real security regression; do not ship. |
| `FAIL Orthanc … unavailable / authentication failed` | care-orthanc down or `ORTHANC_USERNAME`/`ORTHANC_PASSWORD` wrong. Distinguished explicitly from a stale sync. |
| `WARN Orthanc → ERP sync freshness` | Sync is working but the last success is older than the threshold — usually benign after a quiet period; investigate only if it keeps growing. |
| `UNKNOWN Schema verification state` | `schema_deploy_state` absent — expected outside the container migration pipeline (dev). In production it should be PASS. |

---

## Rebuilding only part of the stack — quick reference

| Situation | What to rebuild | What to leave alone |
|---|---|---|
| Frontend or backend code change | `care-api`, `care-web` | `care-db`, DB volume, uploads volume |
| Database migration (new `.sql` file added) | Let `care-db-patch-v2` + `care-schema-verify` run automatically as part of a normal `docker compose up -d --build` — no separate step needed | `care-migrate` (manual/emergency only, see below) |
| Stale build cache / weird UI or API bugs after a pull | OK to delete and rebuild `care-api`/`care-web` containers and images | **Never** delete the `care-db` container or its volume just to "fix" a cache issue |

**Never delete unless specifically intended:**
- The `care-db` container itself
- The Postgres data volume (`db_data` — this is every patient's data)
- The uploaded-files volume (`object_storage` — reports, scanned documents, photos)

**`care-migrate` is manual/emergency only.** It is tagged `profiles: [manual]` in
`docker-compose.yml`, so a normal `docker compose up -d` will never start it —
this is intentional, to prevent it from ever running a competing migration
alongside `care-db-patch-v2` during a routine rebuild. Only run it yourself,
deliberately, when troubleshooting a migration issue outside the normal flow:
```bash
docker compose --profile manual run --rm care-migrate
```

---



| Don't | Why |
|---|---|
| `pnpm db:push` or `drizzle-kit push` in production | Not needed. db-patch-v2 handles it. |
| `pnpm db:migrate` manually | Not needed. db-patch-v2 handles it. |
| Edit hardcoded migration lists | Not needed. Migration detection is automatic. |
| `docker compose down -v` | Deletes the database volume. Use `docker compose down` only. |
| Touch db-patch-entrypoint.sh for new migrations | Not needed. Just add .sql files. |
| `docker compose run --rm care-migrate` during a routine deploy | Not needed — and no longer possible by accident. `care-db-patch-v2` already handles all automatic migrations; `care-migrate` requires `--profile manual` and is for emergency troubleshooting only. |
| Set `SCHEMA_REPAIR=true` permanently in `.env` | Defeats the point of read-only-by-default verification. Use it for one deploy at a time via `docker compose run --rm -e SCHEMA_REPAIR=true care-schema-verify`, then remove it. |
| Add new `RENAME COLUMN`/`DROP COLUMN` logic to `runStartupMigrations()` in `src/index.ts` | Write a `migrations/*.sql` file instead — `care-db-patch-v2` is the single source of truth for schema mutation, per-file tracked and applied exactly once. |
| Manually `UPDATE system_database_identity` to "fix" an identity mismatch without first confirming which database is actually correct | The mismatch is the safety net working as intended — investigate `.env` first (see "If a deploy fails with a DB IDENTITY MISMATCH" above). |

