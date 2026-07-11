# HOW TO ADD DB MIGRATIONS

Every new schema change — new table, new column, seed data, index — must go through this process. Once you follow these two steps, the change deploys automatically every time Synology rebuilds and starts the project. You never run anything manually.

---

## The two steps

### Step 1 — Create a SQL file in `migrations/`

Create `migrations/your_feature_name.sql`.

**Rules the file must follow:**

- `CREATE TABLE` → always use `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE` → always use `ADD COLUMN IF NOT EXISTS`
- `CREATE INDEX` → always use `CREATE INDEX IF NOT EXISTS`
- `INSERT` data → always use `ON CONFLICT DO NOTHING` or `ON CONFLICT (...) DO NOTHING`
- Never use `DROP`, `TRUNCATE`, or `DELETE` without a column/table existence check
- Never add a `NOT NULL` column without a `DEFAULT` value (existing rows have no value for it)

The file must be safe to run 10 times on the same database with no errors and no data changes after the first run.

---

### Step 2 — Register it in `docker/db-patch-entrypoint.sh`

Open `docker/db-patch-entrypoint.sh` and scroll to the bottom. You will see Step 5:

```sh
run_feature_migration "Phase 1 — MRI protocol specs + seed"   "seed_mri_protocols.sql"
run_feature_migration "Phase 2 — Neuro AI prompt library seed" "seed_neuro_prompt_library.sql"
```

Add one line for your new file:

```sh
run_feature_migration "Phase 3 — Your description here" "your_feature_name.sql"
```

That is all. On the next deployment `care-db-patch-v2` runs this file automatically before `care-api` starts.

---

## Complete example

You want to add a `lesion_followup_tasks` table.

**File: `migrations/lesion_followup_tasks.sql`**

```sql
-- Lesion follow-up task tracker
-- Phase 3 — Measurement Integration
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING

CREATE TABLE IF NOT EXISTS lesion_followup_tasks (
  id              SERIAL PRIMARY KEY,
  patient_id      INTEGER NOT NULL,
  study_id        INTEGER NOT NULL,
  lesion_id       INTEGER,
  task_type       TEXT NOT NULL DEFAULT 'mri_followup',
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'pending',
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lesion_followup_patient_idx ON lesion_followup_tasks (patient_id);
CREATE INDEX IF NOT EXISTS lesion_followup_status_idx  ON lesion_followup_tasks (status);
CREATE INDEX IF NOT EXISTS lesion_followup_due_idx     ON lesion_followup_tasks (due_date);
```

**In `docker/db-patch-entrypoint.sh`, Step 5:**

```sh
run_feature_migration "Phase 1 — MRI protocol specs + seed"    "seed_mri_protocols.sql"
run_feature_migration "Phase 2 — Neuro AI prompt library seed"  "seed_neuro_prompt_library.sql"
run_feature_migration "Phase 3 — Lesion follow-up tasks table"  "lesion_followup_tasks.sql"   # ← add this
```

Commit both files. Deploy. Done.

---

## Current migration registry

These are all files currently wired into auto-deployment:

| Step | File | What it creates |
|------|------|-----------------|
| 3 (Drizzle) | `lib/db/drizzle/0000_dear_forge.sql` | Full initial schema (all core tables) |
| 3 (Drizzle) | `lib/db/drizzle/0001_warm_leopardon.sql` | Radiology report generator tables |
| 3 (Drizzle) | `lib/db/drizzle/0002_dicom_rename.sql` | DICOM node column renames + USG fields |
| 3 (Drizzle) | `lib/db/drizzle/0003_online_booking_packages.sql` | Online booking package column |
| 3 (Drizzle) | `lib/db/drizzle/0004_seed_pacs_viewer_defaults.sql` | PACS viewer default settings |
| 4 (Patch) | inline in entrypoint | ~50 clinic_settings columns, payment_logs table |
| 5 (Feature) | `migrations/seed_mri_protocols.sql` | `mri_protocol_specs`, `mri_protocol_quality_results`, 7 protocol seeds |
| 5 (Feature) | `migrations/seed_neuro_prompt_library.sql` | `ai_prompt_library` neuro prompts for dr_abinash |

**Not yet wired (exist in `migrations/` but not registered):**

| File | What it does | Action needed |
|------|--------------|---------------|
| `migrations/add_ollama_columns_to_clinic_settings.sql` | Older Ollama columns — now covered by Step 4 inline patch | **No action needed** — Step 4 already applies these |
| `migrations/add_performance_indexes.sql` | Performance indexes on bills/payments/vouchers | **Register in Step 5** if not already applied on production |

To wire `add_performance_indexes.sql`:

```sh
# In docker/db-patch-entrypoint.sh Step 5:
run_feature_migration "Performance indexes — bills/payments/vouchers" "add_performance_indexes.sql"
```

---

## Deployment flow (what happens automatically)

```
docker compose up -d
        ↓
care-db starts → healthcheck passes
        ↓
care-db-patch-v2 starts → runs db-patch-entrypoint.sh:
  [1/5] Wait for PostgreSQL
  [2/5] Bootstrap drizzle.__drizzle_migrations table
  [3/5] Apply Drizzle SQL migration files (skip if already applied)
  [4/5] ADD COLUMN IF NOT EXISTS patches
  [5/5] Feature migration files:
        seed_mri_protocols.sql      → runs (skips if tables already exist)
        seed_neuro_prompt_library.sql → runs (skips if rows already exist)
        your_future_file.sql        → runs when you add it
  exits 0
        ↓
care-api starts
        ↓
care-web starts
```

---

## Rules summary

| ✅ Always do | ❌ Never do |
|---|---|
| `CREATE TABLE IF NOT EXISTS` | `DROP TABLE` |
| `ADD COLUMN IF NOT EXISTS` | `ALTER TABLE ... DROP COLUMN` |
| `CREATE INDEX IF NOT EXISTS` | `TRUNCATE` |
| `INSERT ... ON CONFLICT DO NOTHING` | `DELETE FROM` without a filter |
| Add `DEFAULT` on every new `NOT NULL` column | `NOT NULL` column with no `DEFAULT` |
| Register in Step 5 of entrypoint | Leave file in `migrations/` without registering |
| Keep file name descriptive | Reuse an existing file name |

---

## Schema drift after a volume restore (zz_schema_reconcile files)

When the production DB volume is restored from an older backup, its
`schema_migrations_log` / `drizzle.__drizzle_migrations` tracking tables come
back with it — so care-db-patch-v2 skips every migration as "already applied"
even though the restored schema predates later columns/indexes, and
care-schema-verify reports `full_fail`.

Fix: generate a one-shot reconciliation migration —

```bash
node scripts/generate-schema-reconcile.cjs --date YYYYMMDD
```

This writes `migrations/zz_schema_reconcile_<date>.sql` (a new filename, so
the entrypoint is guaranteed to apply it) containing only idempotent,
non-destructive DDL: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE IF EXISTS …
ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` — one statement per
expected object, derived from the same migration sources the verifier parses,
each wrapped in a DO block that downgrades errors to warnings so deployment
can never be blocked. Where the DB already matches, every statement is a
no-op.

To reconcile again after future drift: **delete** the old
`zz_schema_reconcile_*.sql` (removing a migration file never touches the
database) and regenerate with a new `--date` — the entrypoint never re-applies
a changed file under the same name.

## Rollback

If a migration causes a problem:

1. Revert the SQL file and the entrypoint line
2. Deploy — the file will not run again (it is no longer registered)
3. If data was already inserted: write a compensating SQL and apply it manually via `docker exec -it care-db psql -U erp -d diagnostic_erp`

There are no automatic rollbacks. Forward-only migrations only.

