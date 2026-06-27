# SYNOLOGY_DB_MIGRATION_DEPLOYMENT.md

**Date:** June 27, 2026  
**Scope:** Automatic, safe, repeatable DB schema migration for Synology Container Manager  
**Status:** ✅ Implemented

---

## 1. Existing Containers Found

| Container Name | Image | Role |
|---|---|---|
| `care-db` | `postgres:16-alpine` | Primary PostgreSQL database |
| `care-migrate` | `care-erp-migrate:latest` | Drizzle migration runner |
| `care-db-patch-v2` | `postgres:16-alpine` | Legacy imperative column patcher |
| `care-api` | `care-erp-api:latest` | Express.js backend API |
| `care-web` | `care-erp-web:latest` | nginx static frontend |

---

## 2. Pre-Existing Migration Container Behaviour (Before This Fix)

**What `care-migrate` was doing:**

- Built from `Dockerfile` target `migrate`
- CMD: `pnpm --filter @workspace/db run push-ci`
- `push-ci` → runs `lib/db/scripts/db-deploy.ts`
- Had `depends_on: db (service_healthy)` ✅
- **Missing `restart: "no"`** → Docker would restart it on every container start ❌
- **`care-api` did NOT depend on `care-migrate`** → API could start with incomplete schema ❌
- `care-api` depended on `care-db-patch-v2` only
- `care-migrate` ran in **parallel with** `care-db-patch-v2` — race condition ❌

**`db-deploy.ts` behaviour (before hardening):**

- Connected to Postgres immediately (no retry loop) → failed if called before PG fully ready
- Seeded Drizzle migration history for existing DBs ✅
- Ran Drizzle file-based migrator (`migrate()`) ✅
- Exited non-zero on failure ✅
- Did not log password ✅

---

## 3. Existing Drizzle Setup

**Config:** `lib/db/drizzle.config.ts`
- Schema source: `lib/db/src/schema/index.ts`
- Migrations output: `lib/db/drizzle/`
- Dialect: `postgresql`

**Migration journal:** `lib/db/drizzle/meta/_journal.json`

| Index | Tag | Purpose |
|---|---|---|
| 0 | `0000_dear_forge` | Full initial schema (all core tables) |
| 1 | `0001_warm_leopardon` | Radiology report generator tables |
| 2 | `0002_dicom_rename` | DICOM node column renames + USG fields |
| 3 | `0003_online_booking_packages` | `online_booking_allowed_package_ids` column |
| 4 | `0004_seed_pacs_viewer_defaults` | PACS viewer defaults seed |

**Migration strategy: Drizzle file-based (`migrate()`)**
- Uses `drizzle.__drizzle_migrations` table to track applied migrations
- Applies `.sql` files in order from journal
- Safe, repeatable, idempotent
- Does NOT use `drizzle-kit push` (which is destructive/interactive)

---

## 4. Files Modified

### `docker-compose.yml` (MODIFIED)

**Changes:**

1. **`migrate` service** — added `restart: "no"` so container does not restart after migration completes
2. **`db-patch-v2` service** — changed `depends_on` from `db (healthy)` to `migrate (service_completed_successfully)`. This enforces ordering: migrate first, then patch.
3. **`api` service** — changed `depends_on` to require BOTH `migrate` AND `db-patch-v2` to complete successfully before API starts
4. **`web` service** — unchanged (depends on `api`)

**New startup ordering:**

```
care-db (healthy)
    ↓
care-migrate (completes successfully)
    ↓
care-db-patch-v2 (completes successfully)
    ↓
care-api (starts)
    ↓
care-web (starts)
```

### `lib/db/scripts/db-deploy.ts` (HARDENED)

**Changes:**

1. Added **PostgreSQL wait loop** (`waitForPostgres`) — retries 30× every 3 seconds before giving up
2. Improved **safe connection string logging** — masks password
3. Added **ON CONFLICT DO NOTHING** to migration history seeding INSERT
4. Improved structured logging (clearly delineated success/failure blocks)
5. **No logic changes** — strategy unchanged (seed history if existing DB, then run Drizzle migrator)

---

## 5. Final Docker Compose Flow

```yaml
db:          healthcheck every 5s (pg_isready), 30 retries
migrate:     restart: "no" — depends_on: db (healthy)
db-patch-v2: restart: "no" — depends_on: migrate (completed_successfully)
api:         restart: unless-stopped — depends_on: db (healthy) + migrate (completed) + db-patch-v2 (completed)
web:         restart: unless-stopped — depends_on: api
```

**Dependency graph:**

```
care-db ──[healthy]──► care-migrate ──[completed]──► care-db-patch-v2 ──[completed]──► care-api ──► care-web
   └────────────────────────────────────────────────────────────────────[healthy]──────► care-api
```

---

## 6. Exact Migration Command Used

The `care-migrate` container runs:

```bash
pnpm --filter @workspace/db run push-ci
```

Which resolves to:

```bash
tsx lib/db/scripts/db-deploy.ts
```

**What `db-deploy.ts` does step by step:**

```
1. Validate DATABASE_URL (exit 1 if missing)
2. Wait for PostgreSQL — retries 30× with 3s interval
3. Connect to database
4. DROP TABLE IF EXISTS "public"."__drizzle_migrations"   (clean up legacy location)
5. CREATE SCHEMA IF NOT EXISTS "drizzle"                  (ensure drizzle schema exists)
6. Check if drizzle.__drizzle_migrations exists
7. Check if clinic_settings table exists (existing DB detection)
8. IF existing DB with no migration history:
     CREATE TABLE drizzle.__drizzle_migrations IF NOT EXISTS
     For each journal entry: compute SHA-256 hash of .sql file, INSERT ... ON CONFLICT DO NOTHING
9. Run Drizzle migrate() — applies any .sql files not yet in migration table
10. Exit 0 on success / exit 1 on failure
```

**Why this command and not `drizzle-kit push`:**

| Command | Mode | Safe for production? |
|---|---|---|
| `drizzle-kit push` | Interactive diff tool — prompts to drop tables | ❌ Dangerous, hangs in CI |
| `drizzle-kit push --force` | Non-interactive but can drop tables | ❌ Destructive |
| `drizzle-kit migrate` | Applies pending .sql files — same as `migrate()` | ✅ But needs TTY |
| `db-deploy.ts (migrate())` | Non-interactive, file-based, idempotent | ✅ **Used** |

---

## 7. What `care-db-patch-v2` Is Doing

`care-db-patch-v2` is a **one-time imperative column patcher** that was created to fix:

> `PostgreSQL error 42703: column "ollama_known_models" does not exist`

It runs a series of `ALTER TABLE IF EXISTS ... ADD COLUMN IF NOT EXISTS` statements against `clinic_settings`, `online_bookings`, and creates the `payment_logs` table.

**Columns it patches (40 total):**

| Table | Columns Added |
|---|---|
| `clinic_settings` | Payment gateway (10), Ollama (8), Scanner/scan station (9), Security/session (4), Form-F (3), Online booking/disclaimer (13) |
| `online_bookings` | `failure_reason`, `icici_transaction_id`, `icici_provider_ref_id` |
| *(new)* `payment_logs` | Full table creation |

---

## 8. Should `care-db-patch-v2` Remain?

**Verdict: RETAIN — but it now runs AFTER `care-migrate`, not in parallel.**

**Reasons to keep it:**

1. **All columns are now in the Drizzle schema** — so `care-migrate` will create them on fresh installs via migration files. But on the **existing production database** (which predates some migrations), these columns may be missing from the tracked migration files and the patch-v2 is the proven fix.

2. **All statements are `ADD COLUMN IF NOT EXISTS`** — completely idempotent, zero risk of data loss on re-run.

3. **It adds `payment_logs` table** — `CREATE TABLE IF NOT EXISTS` is safe to re-run.

4. **It costs ~2 seconds** on an existing DB where all columns already exist (all operations are no-ops).

5. **It is the battle-tested fix** for the `ollama_known_models` production error.

**Action taken:**
- `restart: "no"` confirmed (was already set) — it runs once and exits
- `depends_on` changed from `db (healthy)` → `migrate (service_completed_successfully)` so it always runs **after** Drizzle migrations complete, eliminating the race condition

**Future plan (optional, not immediate):**
Once the production DB has been migrated to schema version 5+, these columns will already exist via Drizzle migrations. At that point `db-patch-v2` can be removed entirely with zero risk.

---

## 9. Manual Migration Command

### Via Docker Compose (recommended)

```bash
# Run migration once (does not restart)
docker compose run --rm care-migrate

# Or if docker compose v2 not available:
docker-compose run --rm care-migrate
```

### Via Synology Container Manager

In the Synology Container Manager UI:
1. Go to your project
2. Click **"Run"** on the `care-migrate` container directly
3. It will execute `pnpm --filter @workspace/db run push-ci` and exit

### Via shell (for manual emergency apply)

```bash
# Direct psql patch (same as db-patch-v2 but manual)
docker exec -it care-db psql -U erp -d diagnostic_erp

# Inside psql:
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS ollama_known_models jsonb DEFAULT '[]'::jsonb;
-- etc.
\q
```

---

## 10. Synology-Specific Deployment Instructions

### Synology Compose Version Compatibility

Synology Container Manager uses Docker Compose v2. The condition `service_completed_successfully` **is supported** in Compose spec v2 (which Synology Container Manager uses since DSM 7.2+).

If you are on an older Synology DSM that doesn't support `service_completed_successfully`, see the fallback section below.

### Standard Deployment Steps (Synology Container Manager)

**Step 1: Update files on NAS**
```bash
# SSH into Synology, navigate to project folder
cd /volume1/docker/care-diagnostics   # (your actual path)

# Pull latest (if using git)
git pull origin main

# OR copy files via File Station
```

**Step 2: Rebuild images**
```bash
docker compose build --no-cache
```
Or in Synology Container Manager UI: **Build** the project.

**Step 3: Start the project**
```bash
docker compose up -d
```

The startup order is automatic:
1. `care-db` starts, healthcheck passes
2. `care-migrate` runs migration, exits 0
3. `care-db-patch-v2` runs column patch, exits 0
4. `care-api` starts
5. `care-web` starts

**Step 4: Verify migration logs**
```bash
docker logs care-migrate
docker logs care-db-patch-v2
```

### Fallback: If Synology Does NOT Support `service_completed_successfully`

If you see compose errors about `service_completed_successfully`, use this fallback `depends_on` in your compose:

```yaml
# Fallback for older Synology DSM
api:
  depends_on:
    db:
      condition: service_healthy
    # Remove migrate and db-patch-v2 conditions
    # Instead run migrations manually before starting api:
    #   docker compose run --rm care-migrate
    #   docker compose run --rm care-db-patch-v2
```

Then start services manually in order:
```bash
docker compose up -d care-db
docker compose run --rm care-migrate
docker compose run --rm care-db-patch-v2
docker compose up -d care-api care-web
```

---

## 11. Logs to Check

### Migration success check
```bash
docker logs care-migrate 2>&1 | grep -E "(✅|❌|🚀|complete|FAILED)"
```

Expected success output:
```
==========================================
🛠️   CARE DIAGNOSTICS DB DEPLOYMENT
==========================================
Connection: postgres://erp:***@db:5432/diagnostic_erp
Environment: production
Time:        2026-06-27T...
==========================================

⏳  Waiting for PostgreSQL to be ready...
✅  PostgreSQL ready (attempt 1/30)

🚀  Running Drizzle migrator for pending changes...

==========================================
✅  DATABASE DEPLOYMENT COMPLETE
==========================================
```

### Patch-v2 success check
```bash
docker logs care-db-patch-v2 2>&1 | grep -E "(complete|error|PATCH)"
```

Expected:
```
DB PATCH V2 — safety column backfill
PostgreSQL is ready. Applying idempotent column additions...
DB PATCH V2 — complete.
```

### API startup check
```bash
docker logs care-api 2>&1 | head -30
```

### Full project status
```bash
docker compose ps
```

Expected:
```
NAME                IMAGE                    STATUS
care-db             postgres:16-alpine       Up X minutes (healthy)
care-migrate        care-erp-migrate:latest  Exited (0) X minutes ago
care-db-patch-v2    postgres:16-alpine       Exited (0) X minutes ago
care-api            care-erp-api:latest      Up X minutes
care-web            care-erp-web:latest      Up X minutes
```

### If migration fails
```bash
docker logs care-migrate --tail 50
# Look for "❌ MIGRATION FAILED:" line
```

---

## 12. Rollback Plan

### Code rollback (if deploy broke something)
```bash
git checkout checkpoint/before-migrate-fix
docker compose build --no-cache
docker compose up -d
```

### Database rollback

Drizzle file-based migrations are **forward-only** — there are no auto-generated rollback scripts. 

For column additions (the only type of migration used):
- Column additions are safe to leave in place — they have defaults and are nullable
- Data is never lost by these migrations

For emergency manual rollback of a specific column:
```sql
-- Only do this if you are CERTAIN the column was just added and is empty
ALTER TABLE some_table DROP COLUMN IF EXISTS some_new_column;
```

**Always restore from backup before dropping columns on production.**

### Database backup (before any schema change)
```bash
docker exec care-db pg_dump -U erp diagnostic_erp > /volume1/backup/diagnostic_erp_$(date +%Y%m%d_%H%M%S).sql
```

---

## 13. Remaining Risks

| Risk | Severity | Status |
|---|---|---|
| Synology DSM < 7.2 may not support `service_completed_successfully` | Medium | Fallback documented in section 10 |
| Migration history seeding is first-run only — if seeding fails mid-way, re-run is safe | Low | `ON CONFLICT DO NOTHING` protects against duplicates |
| `care-db-patch-v2` has no `depends_on: migrate` check — if migrate errors but exits non-zero, patch-v2 will not run | Low | By design — `service_completed_successfully` enforces this |
| `db-deploy.ts` uses `waitForPostgres` with 30 retries × 3s = 90s max wait — if DB takes longer, migration fails | Low | 90 seconds is generous for Synology cold start |
| No row-level security on production tables | Medium | Outside scope of this migration task |
| `0004_seed_pacs_viewer_defaults` seeds local IP addresses (172.16.1.139) | Low | These are environment-specific; update via ERP Settings → PACS |
| `care-db-patch-v2` not yet removed — runs on every deployment (safe no-ops, costs ~2s) | Low | Retained intentionally; removal deferred to after DB is confirmed on schema v5+ |

---

## Summary

| Before | After |
|---|---|
| `care-migrate` had no `restart: "no"` | `restart: "no"` set |
| `care-migrate` ran in parallel with `db-patch-v2` (race) | `db-patch-v2` depends on `migrate` completing first |
| `care-api` depended only on `db-patch-v2` | `care-api` depends on both `migrate` AND `db-patch-v2` |
| `db-deploy.ts` connected to PG immediately (no retry) | 30-retry wait loop added |
| Migration failure could silently allow API to start | API blocks until both migration steps exit 0 |
| `db-deploy.ts` INSERT had no conflict protection | `ON CONFLICT DO NOTHING` added |

