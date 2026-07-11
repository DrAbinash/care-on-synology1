# Drizzle Full Schema Verification — Care Diagnostics ERP
## Multi-Source | Three Operating Modes | Zero-Touch Deployment

---

## Overview

Every deployment automatically verifies that the PostgreSQL database schema
**exactly matches** what the Drizzle migrations define — using five independent
sources cross-checked against each other.

The API (`care-api`) **never starts** with an incomplete or mismatched schema.

---

## Five Verification Sources

```
Source 1: Drizzle migration SQL files    lib/db/drizzle/0000_*.sql … 0005_*.sql
Source 2: Drizzle migration journal      lib/db/drizzle/meta/_journal.json
Source 3: Feature SQL migrations         migrations/*.sql (alphabetical order)
Source 4: schema_deploy_state table      Records from previous deployment
Source 5: Live PostgreSQL schema         information_schema + pg_catalog
```

**Cross-checks performed:**

| Check | Sources | Failure Level |
|---|---|---|
| Journal entries have SQL files | 2 ↔ 1 | Error |
| SQL files are in journal | 1 ↔ 2 | Warning |
| Applied migration checksums match files | 3 ↔ 4 | Warning (drift detected) |
| Expected tables exist | 1+3 ↔ 5 | **FAIL** |
| Expected columns exist | 1+3 ↔ 5 | **FAIL** |
| Column types compatible | 1+3 ↔ 5 | Warning |
| Indexes exist | 1+3 ↔ 5 | Warning |
| FK reference tables exist | 1+3 ↔ 5 | Warning |
| Journal is in order | 2 | Error |

---

## Three Operating Modes

### 1. VERIFY Mode (default — read-only)

```bash
# Automatic on every deployment (care-schema-verify container)
# Or run manually:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify

# With verbose output (shows all warnings, type mismatches, index details):
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --verbose

# JSON output for CI/monitoring:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --json
```

**What VERIFY does:**
- Reads all migration SQL files
- Reads _journal.json
- Reads schema_deploy_state from DB
- Queries information_schema and pg_catalog
- Diffs all sources
- Writes `STARTUP_SCHEMA_VERIFICATION.md`
- Updates `schema_deploy_state.schema_verify_status` = `full_pass` or `full_fail`
- Exits 0 (PASS) or 1 (FAIL)
- Never modifies any schema or data

**Output files written:**
```
STARTUP_SCHEMA_VERIFICATION.md     Self-diagnostics summary
.schema-verify-results.json        Machine-readable results for downstream tools
```

---

### 2. REPAIR Mode (safe DDL only)

```bash
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --repair --verbose
```

**What REPAIR does:**
- Runs all VERIFY checks first
- For each missing table: `CREATE TABLE IF NOT EXISTS`
- For each missing column: `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- Skips missing indexes (index definitions cannot be reconstructed from name alone — re-run migrations instead)
- Re-runs VERIFY after repair
- Writes `DB_SCHEMA_VERIFICATION_REPORT.md`

**REPAIR is allowed:**
```sql
CREATE TABLE IF NOT EXISTS ...
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
CREATE TYPE IF NOT EXISTS ...
```

**REPAIR never does:**
```sql
DROP TABLE                  -- never
DROP COLUMN                 -- never
DELETE ...                  -- never
TRUNCATE ...                -- never
ALTER COLUMN TYPE ...       -- never (too risky)
RENAME COLUMN ...           -- never (breaks existing code)
UPDATE ...                  -- never
```

**When to use REPAIR:**
- Drizzle migration SQL has columns that weren't added by a feature migration
- A new feature migration was added but db-patch-v2 didn't pick it up yet
- After a partial deployment failure

**Repair vs full re-deploy:**
Repair is faster but less thorough. If in doubt, always prefer:
```bash
git pull && docker compose up -d --build
```

---

### 3. RESET Mode (TRIAL ONLY)

```bash
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --reset
```

**This mode:**
- Prints an explicit warning with exact data impact
- Requires you to type `RESET CONFIRMED` to proceed
- Drops ALL tables in the public schema (CASCADE)
- Drops the drizzle schema

**Data that will be permanently lost:**
- All patient records
- All bills, payments, refunds
- All radiology reports and worklists
- All clinic settings (reconfigurable)
- All user accounts (recreated from bootstrap)
- All DICOM match history

**Data NOT affected by reset:**
- Orthanc PACS studies (separate volume)
- OHIF configuration (separate volume)
- Application code (unchanged)

**Use ONLY when:**
- This is the trial deployment with no real patient data
- Migrations are stuck in an unrecoverable state
- `docker compose up -d --build` still fails after multiple attempts

**Safer alternative (try this first):**
```bash
# 1. Try a clean redeploy:
docker compose down
docker compose up -d --build

# 2. Try repair mode:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --repair

# 3. If all else fails, use --reset (trial only)
```

---

## What Is Verified

| Object | Verified | Failure Level | Notes |
|---|---|---|---|
| Tables (all expected) | ✓ | **FAIL** | Runtime-created → warning |
| Columns (all expected) | ✓ | **FAIL** | Per table, per column |
| Column data types | ✓ | Warning | Semantic equivalence groups |
| NOT NULL status | ✓ | Warning | DB more permissive = OK |
| Default values | ✓ | Informational | |
| Primary keys | ✓ | Informational | |
| Unique constraints | ✓ | Informational | |
| Foreign keys (ref tables) | ✓ | Warning | |
| Indexes | ✓ | Warning | Performance, not correctness |
| JSONB columns | ✓ | Informational | Reported in startup MD |
| Serial/Identity columns | ✓ | Informational | |
| PostgreSQL extensions | ✓ | Informational | pgvector etc. |
| Views | ✓ | Informational | |
| Triggers | ✓ | Informational | |
| Check constraints | ✓ | Informational | |
| Sequences | ✓ | Informational | |
| Migration journal order | ✓ | Error | |
| Checksum drift | ✓ | Warning | |
| Journal ↔ SQL files | ✓ | Error/Warning | |

### Type Equivalence Groups

These are treated as identical during comparison:

```
text = varchar = character varying = character
integer = serial = int4 = int
bigint = bigserial = int8
boolean = bool
jsonb = json
numeric = decimal
timestamptz = timestamp with time zone
timestamp = timestamp without time zone
real = float4
double precision = float8
```

---

## Startup Order (enforced by docker-compose)

```
┌─────────────────────────────────────────────┐
│                   care-db                    │
│   healthcheck: pg_isready (every 5s)        │
└──────────────────┬──────────────────────────┘
                   │ service_healthy
                   ▼
┌─────────────────────────────────────────────┐
│              care-db-patch-v2                │
│   docker/db-patch-entrypoint.sh             │
│   • Apply Drizzle migrations (auto)         │
│   • Apply feature migrations (auto)         │
│   • SQL schema verification (Step 6)        │
│   • Sets db_patch_ok=true                   │
│   • Sets schema_verify_status=sql_pass      │
│   EXIT 0 on success / EXIT 1 on failure     │
└──────────────────┬──────────────────────────┘
                   │ service_completed_successfully
                   ▼
┌─────────────────────────────────────────────┐
│             care-schema-verify               │
│   scripts/db-schema-verify.cjs --verify     │
│   Multi-source verification:                │
│   • Parses all SQL migration files          │
│   • Cross-checks journal ↔ SQL files        │
│   • Detects checksum drift                  │
│   • Diffs expected ↔ live schema            │
│   • Writes STARTUP_SCHEMA_VERIFICATION.md   │
│   • Sets schema_verify_status=full_pass     │
│   EXIT 0 on pass / EXIT 1 on fail           │
└──────────────────┬──────────────────────────┘
                   │ service_completed_successfully
                   ▼
┌─────────────────────────────────────────────┐
│                  care-api                    │
│   healthcheck: GET /api/health/schema       │
│   4-gate check:                             │
│   Gate 1: db_patch_ok=true                  │
│   Gate 2: schema_verify_status=full_pass    │
│   Gate 3: 22 critical columns inline        │
│   Gate 4: ≥6 Drizzle migrations             │
│   HTTP 200 on all pass / 503 on fail        │
└──────────────────┬──────────────────────────┘
                   │ service_healthy
                   ▼
┌─────────────────────────────────────────────┐
│                  care-web                    │
│   nginx — serves ERP frontend               │
└─────────────────────────────────────────────┘
```

---

## Deployment Workflow

### Normal deployment (only two commands ever needed)

```bash
# SSH into Synology NAS
ssh admin@192.168.1.137
cd /volume1/docker/care-erp-github/care-on-synology1

# Pull and deploy — everything else is automatic
git pull
docker compose up -d --build
```

The system automatically:
1. Detects new Drizzle migrations from `_journal.json`
2. Applies all Drizzle migrations in order
3. Auto-discovers and applies new feature migrations alphabetically
4. Runs full multi-source schema verification
5. Detects any schema drift
6. Refuses API startup if verification fails
7. Writes `STARTUP_SCHEMA_VERIFICATION.md`
8. Serves the ERP frontend

### Monitoring a deployment

```bash
# Watch migration container
docker compose logs -f care-db-patch-v2

# Watch schema verifier (shows cross-check output)
docker compose logs -f care-schema-verify

# Check API started successfully
docker compose logs care-api --tail 20

# Check health endpoint
curl http://localhost:8080/api/health/schema | python3 -m json.tool

# View startup verification report
cat STARTUP_SCHEMA_VERIFICATION.md
```

---

## Manual Commands

### Run schema verification
```bash
# Default (verbose)
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --verbose

# JSON output
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --json

# Quiet (exit code only)
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --quiet
```

### Generate report
```bash
docker compose run --rm care-migrate node /repo/scripts/db-schema-report.cjs
cat DB_SCHEMA_VERIFICATION_REPORT.md
```

### Run repair
```bash
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --repair --verbose
```

### Run migration only
```bash
docker compose run --rm care-migrate
```

### View health
```bash
curl http://localhost:8080/api/health/schema
curl http://localhost:8080/health
```

### Check migration state in DB
```bash
docker exec -it care-db psql -U erp -d diagnostic_erp -c \
  "SELECT key, value, updated_at FROM schema_deploy_state ORDER BY key;"
```

---

## Adding New Migrations

### New Drizzle migration
```bash
# On development machine:
cd lib/db
pnpm drizzle-kit generate
# Creates: lib/db/drizzle/0006_description.sql (and updates _journal.json)

git add lib/db/drizzle/0006_description.sql lib/db/drizzle/meta/_journal.json
git commit -m "db: migration 0006_description"
git push

# On Synology — automatically applied:
git pull && docker compose up -d --build
```

### New feature migration (ADD COLUMN, index, seed data)
```bash
# Create in migrations/ with a descriptive name (alphabetical sort controls order)
cat > migrations/add_new_column.sql << 'SQL'
-- Add new_column to clinic_settings
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS new_column text;
SQL

git add migrations/add_new_column.sql
git commit -m "db: add new_column to clinic_settings"
git push

# On Synology — automatically applied:
git pull && docker compose up -d --build
```

No other files need to be changed. The verifier auto-discovers everything.

---

## Troubleshooting

### `care-schema-verify` exits 1 (FAIL)

```bash
# See exact errors:
docker compose logs care-schema-verify

# Common causes:
# 1. db-patch-v2 failed → check:
docker compose logs care-db-patch-v2

# 2. Feature migration not applied → run repair:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --repair

# 3. Source inconsistency → check journal vs SQL files:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --verbose
```

### `care-api` health check fails (503)

```bash
# Check what gate is failing:
curl http://localhost:8080/api/health/schema | python3 -m json.tool
# Look for: error, missing columns, schema_verify_status

# If schema_verify_status is "sql_pass" but not "full_pass":
# → care-schema-verify container failed
docker compose logs care-schema-verify

# If db_patch_ok is not "true":
# → care-db-patch-v2 failed
docker compose logs care-db-patch-v2

# Fix and redeploy:
docker compose up -d --build
```

### Migration applied but column still missing

This means a migration SQL file doesn't contain the expected `ADD COLUMN`.
```bash
# Find which file should add the column:
grep -r "column_name" migrations/ lib/db/drizzle/

# If the column is only in runStartupMigrations() in index.ts:
# It's added by the API on first startup. Run the API once, then check.
docker compose up -d --no-recreate
curl http://localhost:8080/health
```

### Checksum drift warning

A feature migration file was modified after it was applied.
```bash
# See which file drifted:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --verbose
# Look for "Checksum drift" warning

# If the change is intentional, re-apply:
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --repair
```

### Out-of-order journal warning

The `_journal.json` has non-sequential idx values.
```bash
cat lib/db/drizzle/meta/_journal.json | python3 -m json.tool
# Fix: re-run drizzle-kit generate on dev machine and commit
```

---

## Synology-Specific Notes

### Container Manager vs CLI

The deployment can be initiated from either:
```bash
# CLI (recommended — see full logs):
ssh admin@192.168.1.137
cd /volume1/docker/care-erp-github/care-on-synology1
git pull && docker compose up -d --build

# Container Manager GUI:
# Project → care-erp → Build and run
# (Less visible — check logs via Container Manager → Logs)
```

### Viewing logs

```bash
# SSH then:
docker compose logs care-db-patch-v2 --tail 50
docker compose logs care-schema-verify --tail 50
docker compose logs care-api --tail 50
```

### Startup report location

`STARTUP_SCHEMA_VERIFICATION.md` is written to the repo root:
```
/volume1/docker/care-erp-github/care-on-synology1/STARTUP_SCHEMA_VERIFICATION.md
```

### Port reference

```
care-db:              localhost:5400 (PostgreSQL)
care-api:             localhost:8080 (internal)
care-web:             localhost:8888 (ERP)
Orthanc PACS:         localhost:8042
OHIF Viewer:          localhost:3010
Open WebUI:           localhost:3000
```

---

## Rollback Workflow

```bash
# Option 1: Roll back to previous git commit
docker compose down
git log --oneline -5            # find the commit to roll back to
git checkout abc1234            # check out that commit
docker compose up -d --build

# Option 2: Use a checkpoint tag (created before major changes)
git checkout checkpoint/before-full-schema-verify
docker compose up -d --build

# Rollback is safe: migrations are idempotent, already-applied
# migrations are skipped by SHA-256 hash check
```

---

## schema_deploy_state Keys Reference

The `public.schema_deploy_state` table stores deployment metadata:

| Key | Set By | Meaning |
|---|---|---|
| `db_patch_ok` | db-patch-entrypoint.sh | `"true"` = migrations completed without error |
| `schema_verify_status` | db-patch-entrypoint.sh + verifier | `"sql_pass"` = SQL check OK; `"full_pass"` = full verify OK |
| `live_table_count` | db-patch-entrypoint.sh | Table count at deploy time |
| `live_column_count` | db-patch-entrypoint.sh | Column count at deploy time |
| `live_index_count` | db-patch-entrypoint.sh | Index count at deploy time |
| `schema_verify_at` | Both | ISO timestamp of last verification |
| `schema_verify_tables_ok` | db-schema-verify.cjs | Tables that passed |
| `schema_verify_cols_ok` | db-schema-verify.cjs | Columns that passed |
| `schema_verify_issues` | db-schema-verify.cjs | Count of failures |
| `total_migrations` | db-patch-entrypoint.sh | Total migrations tracked |
| `patch_version` | db-patch-entrypoint.sh | Deployment timestamp |
| `last_migration_at` | db-patch-entrypoint.sh | Timestamp of most recent migration |

---

_Care Diagnostics ERP · Hospital RIS/PACS · Deoghar, Jharkhand_
