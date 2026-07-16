-- CARE USG Companion (Phase 1) — companion_runs telemetry table
-- Records what the USG Companion did per study so the Dashboard
-- "Companion Status" card can report extraction success/failure, average
-- imported measurements, average time saved, machine used, and the most-common
-- missing measurements. TELEMETRY ONLY — never duplicates measurement storage.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS companion_runs (
  id                       SERIAL PRIMARY KEY,

  worklist_id              INTEGER,
  study_instance_uid       TEXT,
  accession_number         TEXT,
  patient_id               INTEGER,

  detected_study_type      TEXT,
  template_id              TEXT,
  protocol_applied         TEXT,

  machine_manufacturer     TEXT,
  machine_model            TEXT,
  machine_name             TEXT,

  extraction_status        TEXT NOT NULL DEFAULT 'none',
  status                   TEXT NOT NULL DEFAULT 'assembled',

  measurements_expected    INTEGER NOT NULL DEFAULT 0,
  measurements_found       INTEGER NOT NULL DEFAULT 0,
  measurements_imported    INTEGER NOT NULL DEFAULT 0,
  missing_measurements_json TEXT NOT NULL DEFAULT '[]',

  readiness_score          INTEGER NOT NULL DEFAULT 0,
  time_saved_seconds       INTEGER NOT NULL DEFAULT 0,

  warnings_json            TEXT NOT NULL DEFAULT '[]',

  created_by               TEXT,
  created_by_id            INTEGER,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS companion_runs_study_idx   ON companion_runs (study_instance_uid);
CREATE INDEX IF NOT EXISTS companion_runs_status_idx  ON companion_runs (status);
CREATE INDEX IF NOT EXISTS companion_runs_machine_idx ON companion_runs (machine_manufacturer);
CREATE INDEX IF NOT EXISTS companion_runs_created_idx ON companion_runs (created_at);
