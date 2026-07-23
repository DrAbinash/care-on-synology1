# HOW TO ADD DB MIGRATIONS

Every new schema change — new table, new column, seed data, index — must go through this process. Once you follow these steps, the change deploys automatically every time Synology rebuilds and starts the project. You never run anything manually and you never edit `docker/db-patch-entrypoint.sh`.

> **This doc previously described a "Step 2 — register it in db-patch-entrypoint.sh"
> manual registration step. That step no longer exists.** `docker/db-patch-entrypoint.sh`
> now auto-discovers every `migrations/*.sql` file and applies it in plain
> **alphabetical filename order** — there is nothing to register. This is why
> Step 1's naming rule below is now load-bearing, not just style: get the
> filename wrong and the migration can silently apply in the wrong order.

---

## The steps

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

**Naming rule — if your migration depends on a table created by another
`migrations/*.sql` file (an `ALTER TABLE`, `CREATE INDEX ... ON`, foreign key,
or trigger targeting that table), your filename MUST sort alphabetically
after the file that creates it.** The simplest way to guarantee this: make
your filename start with the *exact* basename of the prerequisite file
(including its `.sql`-stripped stem), then append your own suffix — a
filename that is an exact prefix of another always sorts before it, e.g.:

```
migrations/add_usg_companion_runs.sql                          ← creates companion_runs
migrations/add_usg_companion_runs_autopopulation_columns.sql   ← alters companion_runs, sorts after by construction
```

Do **not** name a dependent migration after the *feature* ("companion") —
name it after the *file it depends on*. This is exactly the bug this
convention exists to prevent: `add_companion_autopopulation_columns.sql`
sorted alphabetically *before* `add_usg_companion_runs.sql` ("c" < "u"),
so the container tried to `ALTER TABLE companion_runs` before that table
existed, and — because a single failed feature migration hard-stops the
whole deploy — every migration alphabetically after it was silently never
applied either. See `MIGRATION_FRAMEWORK_AUDIT.md` for the full incident.

Before committing, run the ordering check locally — it statically simulates
the exact execution order `docker/db-patch-entrypoint.sh` uses and fails if
anything would break:

```sh
node scripts/check-migration-order.cjs
```

This also runs automatically as part of `pnpm test`
(`scripts/check-migration-order.test.cjs`), so a bad ordering fails CI/local
test runs before it ever reaches a deploy.

That is all. On the next deployment `care-db-patch-v2` discovers and applies
this file automatically before `care-api` starts — no other file to edit.

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

Run `node scripts/check-migration-order.cjs` (or `pnpm test`). Commit the file. Deploy. Done —
nothing else to edit or register.

---

## How migrations are actually discovered and ordered

There is no registry file and no list to maintain. `docker/db-patch-entrypoint.sh`
runs, in this fixed order, every deployment:

```
docker compose up -d
        ↓
care-db starts → healthcheck passes
        ↓
care-db-patch-v2 starts → runs db-patch-entrypoint.sh:
  [1] Wait for PostgreSQL, verify DB target + identity, acquire migration lock
  [2] Bootstrap drizzle.__drizzle_migrations + public.schema_migrations_log tracking tables
  [3] Apply lib/db/drizzle/*.sql — in lib/db/drizzle/meta/_journal.json order
      (skip any whose file hash is already recorded)
  [4] Apply migrations/*.sql — auto-discovered, in PLAIN ALPHABETICAL FILENAME
      ORDER (`ls migrations/*.sql | sort`), skip any whose file hash is
      already recorded. A migration is applied via `psql -v ON_ERROR_STOP=1`:
      if it errors, the whole script exits non-zero IMMEDIATELY — every
      migration alphabetically after the failing one never runs, this
      deploy attempt or any retry of it, until the broken file is fixed.
  [5] Record schema fingerprint + version metadata
  [6] SQL-based core table check (fails loud if e.g. `users`/`patients` missing)
  exits 0
        ↓
care-api starts (only if step above exited 0 — docker-compose service_completed_successfully)
        ↓
care-web starts
```

Step [3] always fully completes before step [4] begins — so any table created
by a Drizzle migration is always available to every feature migration,
regardless of feature-migration filenames. The risk is entirely **within**
step [4]: two feature migrations where one depends on a table the other
creates, ordered wrong by their filenames. See the naming rule above — and
run `node scripts/check-migration-order.cjs` to have this checked for you
instead of reasoning through it by hand.

---

## Rules summary

| ✅ Always do | ❌ Never do |
|---|---|
| `CREATE TABLE IF NOT EXISTS` | `DROP TABLE` |
| `ADD COLUMN IF NOT EXISTS` | `ALTER TABLE ... DROP COLUMN` |
| `CREATE INDEX IF NOT EXISTS` | `TRUNCATE` |
| `INSERT ... ON CONFLICT DO NOTHING` | `DELETE FROM` without a filter |
| Add `DEFAULT` on every new `NOT NULL` column | `NOT NULL` column with no `DEFAULT` |
| Name a dependent migration after the file it depends on (prefix rule above) | Name a dependent migration after the *feature*, ignoring what it depends on |
| Run `node scripts/check-migration-order.cjs` before committing | Assume alphabetical order "probably" works out |
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

## Known-benign clean-boot Drizzle statements

Two historical Drizzle migrations are self-inconsistent when applied to a
**completely empty** database (they were generated by `drizzle-kit` against a
schema that had already been hand-edited). On an existing production DB they are
long applied and never re-run, so they are invisible there; on a fresh install
they emit harmless `... does not exist` lines:

| Migration | Statement | Why it is a no-op on a clean DB |
|---|---|---|
| `0006_jazzy_mojo` | `ALTER TABLE dicom_nodes DROP COLUMN pull_interval_minutes / pull_query_days` | `0002_dicom_rename` already renamed those columns away, so they are gone |
| `0010_daily_summary_multi_time` | `UPDATE email_settings … WHERE daily_summary_last_sent_date IS NOT NULL` | that column is added by a later `migrations/*.sql`, so there is nothing to back-fill yet |

Both paths handle these safely and the final schema is identical either way:
- `docker/db-patch-entrypoint.sh` runs Drizzle migrations with `ON_ERROR_STOP=0`
  and filters out exactly these two lines (exact patterns, so a genuine
  "does not exist" is never hidden).
- `lib/db/scripts/db-deploy.ts` (the manual `care-migrate` path) applies each
  statement individually and tolerates the same benign cleanups — which is what
  lets `care-migrate` bootstrap an empty database end-to-end.
- `pnpm db:smoke` proves a clean boot + a populated re-run still yields the
  correct schema, so a genuinely broken Drizzle migration (one that fails *hard*)
  would fail the test suite; only these two known no-ops are tolerated.

**Do not "fix" these by editing `0006`/`0010`.** Editing an applied migration
changes its file hash, which forces a one-time full re-apply on every existing
production database (0006 is ~2600 lines and would re-run ~40 `ADD CONSTRAINT`
statements as swallowed "already exists" errors). The runtime tolerance above is
the safe handling.

## Cleanly re-baselining the Drizzle history (scheduled maintenance)

To remove these historical artifacts *at the source* (a "clean" history), squash
`0000`–`00NN` into a single idempotent baseline. This is safe **only with the
production database in hand** and must be validated before deploying:

1. On a copy of production, `pg_dump --schema-only` the live schema.
2. Convert it to a fully idempotent baseline: `CREATE TABLE IF NOT EXISTS`,
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and
   `DO $$ … $$` guards for constraints (Postgres has no `ADD CONSTRAINT IF NOT
   EXISTS`). No `DROP`, no `RENAME`, no data statements.
3. Replace `0000`–`00NN` with this single `0000_baseline.sql`, rewrite
   `meta/_journal.json` to reference only it, and delete the old snapshots.
4. **Backfill tracking on existing DBs:** existing installs have the OLD hashes
   in `drizzle.__drizzle_migrations`. The new baseline hash is unknown to them,
   so on first deploy the entrypoint applies the baseline — every statement is an
   idempotent no-op against the already-present schema — and records the new
   hash. Verify against a production clone first: apply the baseline to the clone
   and diff its schema against production (`pg_dump --schema-only` both, compare).
5. On a fresh DB the single baseline creates everything with zero DROP/rename
   churn — the two benign warnings disappear for good.

Do this only as a deliberate, reviewed maintenance step — never as a drive-by
edit, and never without the production-clone diff in step 4.

