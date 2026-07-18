# Phase P0 — Migration Guide

Covers the one P0 migration, `migrations/add_canonical_study_crosswalk.sql`. Follows the repo's
migration framework (`HOW_TO_ADD_DB_MIGRATIONS.md`): SQL files in `migrations/` are auto-applied in
alphabetical order by `docker/db-patch-entrypoint.sh` on every deploy. You never run anything manually
in normal operation.

## What it does

1. Creates `canonical_study` (thin crosswalk keyed on `study_instance_uid`).
2. Backfills it from `radiology_studies` rows that already carry a `study_instance_uid`.
3. Adds the `ai_job_queue.study_id → radiology_studies.id` foreign key, **`NOT VALID`**.

## Properties

- **Idempotent** — `CREATE TABLE/INDEX IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, and a
  `pg_constraint` existence guard around the `ALTER TABLE`. Safe to run any number of times.
- **Forward-compatible** — additive only; no column drops or type changes.
- **Backward-compatible** — existing rows are untouched; the FK is `NOT VALID`, so it enforces new
  inserts without scanning or locking the historical table.
- **Correctly ordered** — references only Drizzle core tables (`radiology_studies`, `ai_job_queue`),
  which exist before any `migrations/*.sql` runs. Verified by `node scripts/check-migration-order.cjs`.

## Pre-deploy verification (no database needed)

```sh
node scripts/check-migration-order.cjs     # migration ordering is safe
node scripts/grounding-check.cjs           # docs/code agree (incl. this migration)
```

## Post-deploy verification (against the live DB)

```sql
-- crosswalk exists and is populated
SELECT count(*) FROM canonical_study;

-- FK is present (validated = false is expected until the optional VALIDATE step)
SELECT conname, convalidated
FROM pg_constraint
WHERE conname = 'ai_job_queue_study_id_fkey';

-- any legacy orphan job rows (must be empty before validating the FK)
SELECT j.id, j.study_id
FROM ai_job_queue j
LEFT JOIN radiology_studies s ON s.id = j.study_id
WHERE s.id IS NULL;
```

## Optional: validate the FK (after reconciling any orphans)

Run out-of-band once the orphan query above returns zero rows. `VALIDATE` takes only a `SHARE UPDATE
EXCLUSIVE` lock (does not block reads/writes):

```sql
ALTER TABLE ai_job_queue VALIDATE CONSTRAINT ai_job_queue_study_id_fkey;
```

## Rollback (manual — never place these in `migrations/`)

```sql
ALTER TABLE ai_job_queue DROP CONSTRAINT IF EXISTS ai_job_queue_study_id_fkey;
DROP TABLE IF EXISTS canonical_study;
```

Both are lossless: the FK drop is instant; `canonical_study` holds only derived mapping data that the
migration's backfill can rebuild. Do **not** add these statements as a `migrations/*.sql` file — the
framework applies migrations forward-only, and a `DROP` there would run on every deploy.

## Related runtime configuration (Task 3 / G2)

- `AI_EGRESS_ALLOWLIST` (optional env, comma-separated `host` or `host:port`) — when set, it is the
  authoritative allowlist for outbound AI endpoints, even in Local/LAN mode. Leave unset to preserve
  legacy behavior (now additionally hardened: the `100.64.0.0/10` tailnet range is blocked outside
  Local/LAN mode, and cloud-metadata hosts are always blocked). No schema change; no migration.
