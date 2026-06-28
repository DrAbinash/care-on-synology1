# Drizzle Full Schema Verification — Care Diagnostics ERP

## What this system does

Every deployment automatically verifies that the live PostgreSQL database
**exactly matches** what the Drizzle schema and all migration SQL files define.
The API never starts with an incomplete schema.

---

## Verification layers

### Layer 1 — `db-patch-v2` (SQL, runs in postgres:alpine)
Runs `docker/db-patch-entrypoint.sh` which:
1. Applies all Drizzle migrations (auto-detected from `_journal.json`)
2. Applies all feature migrations (auto-discovered from `migrations/*.sql`)
3. Runs Step 6: SQL-based schema verification
   - Checks 12 core tables exist
   - Checks 40 critical columns with a single SQL `VALUES` query
   - Records `schema_verify_status = 'sql_pass'` in `schema_deploy_state`
   - Records `live_table_count`, `live_column_count`, `live_index_count`

### Layer 2 — `care-schema-verify` (Node.js CJS, runs in migrate image)
Runs `scripts/db-schema-verify.cjs` which:
1. Parses ALL `CREATE TABLE` and `ALTER TABLE` statements from every migration SQL file
2. Queries `information_schema` and `pg_catalog` for the live schema
3. Diffs expected vs actual:
   - All expected tables must exist
   - All expected columns must exist (by name and table)
   - Column data types compared with semantic equivalence (varchar = text, json = jsonb, etc.)
   - Indexes verified (missing indexes = warning, not failure)
4. Exits 0 on pass, 1 on fail → `care-api` never starts on failure

### Layer 3 — `/api/health/schema` (TypeScript, runs in care-api)
Four-gate check on every request:
1. `db_patch_ok = 'true'` (db-patch-v2 completed)
2. `schema_verify_status = 'sql_pass'` or `'full_pass'` (verification passed)
3. 22 critical columns verified inline against `information_schema`
4. At least 6 Drizzle migrations applied (sanity check)

Returns `200 { ok: true }` only when all four gates pass.

---

## Startup order (enforced by `docker-compose depends_on`)

```
care-db (PostgreSQL)
    │  healthcheck: pg_isready
    ▼
care-db-patch-v2
    │  Applies migrations (Steps 1-5)
    │  SQL schema verification (Step 6)
    │  Sets db_patch_ok=true, schema_verify_status=sql_pass
    │  condition: service_completed_successfully
    ▼
care-schema-verify
    │  Full CJS schema verification (150+ tables, 1000+ columns)
    │  Exits 0 on pass, 1 on fail
    │  condition: service_completed_successfully
    ▼
care-api
    │  /api/health/schema: 4-gate check
    │  healthcheck: GET /api/health/schema
    │  condition: service_healthy
    ▼
care-web (nginx)
    Only starts after care-api is healthy
```

---

## Manual commands (run on Synology NAS)

### Run schema verification manually
```bash
cd /volume1/docker/care-erp-github/care-on-synology1

# Full verification with verbose output
docker compose run --rm schema-verify

# Or using the migrate container directly:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verbose
```

### Generate schema report
```bash
docker compose run --rm care-migrate node /repo/scripts/db-schema-report.cjs
# → writes DB_SCHEMA_VERIFICATION_REPORT.md

# View the report:
cat DB_SCHEMA_VERIFICATION_REPORT.md
```

### Check health endpoint
```bash
curl http://localhost:8080/api/health/schema | python3 -m json.tool
```

Expected response on healthy system:
```json
{
  "ok": true,
  "state": {
    "db_patch_ok": "true",
    "schema_verify_status": "sql_pass",
    "live_table_count": "95",
    "live_column_count": "1247",
    "total_migrations": "15",
    "patch_version": "20260628120000"
  },
  "migrationCounts": {
    "drizzle": 6,
    "feature": 9
  },
  "ts": "2026-06-28T12:00:00.000Z"
}
```

### Run migration manually
```bash
docker compose run --rm care-migrate
```

### View migration logs
```bash
docker compose logs care-db-patch-v2
docker compose logs care-schema-verify
docker compose logs care-api --tail 50
```

### Check migration state in DB directly
```bash
# Connect to the running DB
docker exec -it care-db psql -U erp -d diagnostic_erp

-- Migration tracking
SELECT * FROM public.schema_migrations_log ORDER BY applied_at;
SELECT * FROM drizzle.__drizzle_migrations ORDER BY id;

-- Deploy state
SELECT * FROM public.schema_deploy_state ORDER BY key;

-- Live table count
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';

-- Find any expected column that's missing
SELECT t.tbl, t.col FROM (VALUES
  ('radiology_worklist', 'ai_feedback'),
  ('clinic_settings', 'ollama_enabled')
) AS t(tbl, col)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=t.tbl AND c.column_name=t.col
);
```

---

## Adding new migrations

### New Drizzle migration (schema change)
```bash
# On development machine:
cd lib/db
pnpm drizzle-kit generate

# Commit the new .sql file and updated _journal.json
git add lib/db/drizzle/0006_*.sql lib/db/drizzle/meta/_journal.json
git commit -m "db: migration 0006"
git push

# On Synology: automatically applied on next deploy
git pull && docker compose up -d --build
```

### New feature migration (ADD COLUMN, seed data, index)
```bash
# Create in migrations/ with a descriptive name
echo "ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS new_feature boolean DEFAULT false;" \
  > migrations/add_new_feature.sql

git add migrations/add_new_feature.sql
git commit -m "db: add new_feature column"
git push

# On Synology: automatically applied on next deploy
git pull && docker compose up -d --build
```

No other files need to be changed. The verifier auto-discovers all SQL files.

---

## What `db-schema-verify.cjs` checks

The script parses every `CREATE TABLE` and `ALTER TABLE` statement from:
- `lib/db/drizzle/0000_dear_forge.sql` through `0005_mri_protocol_specs.sql`
- All `migrations/*.sql` feature migration files

And verifies against `information_schema`:

| Check | Pass Criteria | Fail Behaviour |
|---|---|---|
| Table exists | All `CREATE TABLE` tables present | **FAIL** (hard error) |
| Column exists | All columns in each table present | **FAIL** (hard error) |
| Column type | Semantically equivalent types | Warning (not fail) |
| Indexes | All `CREATE INDEX` indexes present | Warning (not fail) |
| Migration count | ≥6 Drizzle migrations applied | **FAIL** |
| Feature migrations | Recorded in schema_migrations_log | Warning |

### Type equivalence groups
These are treated as identical during comparison:
- `text` = `varchar` = `character varying`
- `integer` = `serial` = `int4`
- `bigint` = `bigserial`
- `boolean` = `bool`
- `jsonb` = `json`
- `numeric` = `decimal`
- `timestamptz` = `timestamp with time zone`

---

## Schema state flags

The `public.schema_deploy_state` table stores:

| Key | Set By | Meaning |
|---|---|---|
| `db_patch_ok` | db-patch-v2 Step 7 | Migrations completed without error |
| `schema_verify_status` | db-patch-v2 Step 6 | `sql_pass` = critical columns OK |
| `live_table_count` | db-patch-v2 Step 6 | Number of tables in live DB |
| `live_column_count` | db-patch-v2 Step 6 | Number of columns in live DB |
| `live_index_count` | db-patch-v2 Step 6 | Number of indexes in live DB |
| `schema_verify_at` | db-patch-v2 Step 6 | Timestamp of last verification |
| `total_migrations` | db-patch-v2 Step 5 | Total migrations tracked |
| `patch_version` | db-patch-v2 Step 5 | Deployment timestamp |

---

## Rollback and reset

### Rollback (preserve data)
```bash
# Roll back to previous git commit
docker compose down
git checkout HEAD~1
docker compose up -d --build
```

### Schema reset (TRIAL ONLY — destroys all data)

> ⚠️ Only for the trial deployment. This destroys ALL patient data, bills, and settings.

```bash
# 1. Stop and remove containers
docker compose down

# 2. Delete the database volume
docker volume ls  # find the volume name, usually: care-erp_db_data
docker volume rm care-erp_db_data

# 3. Rebuild from scratch — all migrations run fresh
docker compose up -d --build

# Data lost:
#   - All patient records
#   - All bills and payments
#   - All radiology reports
#   - All settings (reconfigurable)
#   - All user accounts (recreated from bootstrap)
#
# Data preserved:
#   - Application code (unchanged)
#   - PACS/DICOM studies (separate Orthanc volume)
#   - OHIF configuration (separate)
```

When to use this:
- Schema migrations are stuck in an inconsistent state
- You've been testing and want a clean slate
- The trial has no real patient data
- `docker compose up -d --build` plus migrations still fail

Safer alternative first:
```bash
docker compose run --rm care-migrate    # try re-running migrations
docker compose up -d --build            # try full redeploy
docker compose logs care-db-patch-v2    # read the error message
```

