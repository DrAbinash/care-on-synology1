-- ============================================================================
-- Enterprise attendance foundation — immutable raw punches + import-run ledger.
-- Additive, non-financial, idempotent. Filename sorts AFTER
-- staff_hr_people_platform.sql (the "_z_" segment) — these tables reference only
-- the Drizzle-core `staff` table plus each other, so ordering is not strictly
-- required, but the name keeps the staff_hr_* group together and ordered.
--
-- SAFETY: CREATE TABLE/INDEX IF NOT EXISTS only; alters no existing table;
-- touches no financial table. import_runs is created BEFORE raw_punches (which
-- FKs it). Verified by scripts/check-migration-order.cjs.
-- Mirrors lib/db/src/schema/attendance.ts — keep in sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS attendance_import_runs (
  id                 SERIAL PRIMARY KEY,
  source             TEXT NOT NULL,
  device_id          TEXT,
  status             TEXT NOT NULL DEFAULT 'completed',
  total_count        INTEGER NOT NULL DEFAULT 0,
  inserted_count     INTEGER NOT NULL DEFAULT 0,
  duplicate_count    INTEGER NOT NULL DEFAULT 0,
  failed_count       INTEGER NOT NULL DEFAULT 0,
  started_by_user_id INTEGER,
  started_by_name    TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS attendance_import_runs_source_idx ON attendance_import_runs (source);

CREATE TABLE IF NOT EXISTS attendance_raw_punches (
  id            SERIAL PRIMARY KEY,
  staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  source        TEXT NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'unknown',
  punch_ts      TIMESTAMPTZ NOT NULL,
  device_id     TEXT,
  template_id   INTEGER,
  score         INTEGER,
  dedupe_key    TEXT NOT NULL,
  import_run_id INTEGER REFERENCES attendance_import_runs(id) ON DELETE SET NULL,
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS attendance_raw_punches_staff_idx ON attendance_raw_punches (staff_id);
CREATE INDEX IF NOT EXISTS attendance_raw_punches_staff_ts_idx ON attendance_raw_punches (staff_id, punch_ts);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_raw_punches_dedupe_uq ON attendance_raw_punches (dedupe_key);
