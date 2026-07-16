-- CARE USG Companion (Phase 2) — auto-population telemetry columns on companion_runs.
-- Extends the Phase 1 telemetry table so the Dashboard card can report
-- auto-population success %, average edits after auto-population, average report
-- completion, and top rejected measurements. TELEMETRY ONLY.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, every new column has a DEFAULT.

ALTER TABLE companion_runs ADD COLUMN IF NOT EXISTS auto_populated              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companion_runs ADD COLUMN IF NOT EXISTS sections_populated          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_runs ADD COLUMN IF NOT EXISTS edits_after_populate        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_runs ADD COLUMN IF NOT EXISTS report_completion_pct       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_runs ADD COLUMN IF NOT EXISTS rejected_measurements_json  TEXT NOT NULL DEFAULT '[]';
