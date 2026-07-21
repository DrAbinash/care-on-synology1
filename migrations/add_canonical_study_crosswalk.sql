-- ============================================================================
-- Phase P0 / Gate G3 — Canonical Study crosswalk + ai_job_queue.study_id FK
-- ============================================================================
-- Idempotent (safe to run any number of times), forward- and backward-
-- compatible, and production-safe:
--   * CREATE TABLE / INDEX ... IF NOT EXISTS
--   * INSERT ... ON CONFLICT DO NOTHING
--   * the foreign key is added NOT VALID, so it enforces NEW rows immediately
--     without a blocking validation scan of existing ai_job_queue rows.
-- References only pre-existing core tables (radiology_studies, ai_job_queue),
-- so it may apply in any alphabetical position relative to other migrations.
--
-- Rollback (run manually if ever needed — NOT auto-applied):
--   ALTER TABLE ai_job_queue DROP CONSTRAINT IF EXISTS ai_job_queue_study_id_fkey;
--   DROP TABLE IF EXISTS canonical_study;
-- ============================================================================

-- 1. The thin crosswalk table: one row per canonical DICOM study identity.
CREATE TABLE IF NOT EXISTS canonical_study (
  id                  SERIAL PRIMARY KEY,
  study_instance_uid  TEXT NOT NULL,
  radiology_study_id  INTEGER REFERENCES radiology_studies(id),
  worklist_id         INTEGER,
  dicom_incoming_id   INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One canonical study per DICOM Study Instance UID.
CREATE UNIQUE INDEX IF NOT EXISTS canonical_study_uid_key
  ON canonical_study (study_instance_uid);
CREATE INDEX IF NOT EXISTS canonical_study_rad_study_idx
  ON canonical_study (radiology_study_id);

-- 2. Backfill from studies that already carry a Study Instance UID.
--    ON CONFLICT keeps the first mapping and makes re-runs a no-op.
INSERT INTO canonical_study (study_instance_uid, radiology_study_id)
SELECT study_instance_uid, id
FROM radiology_studies
WHERE study_instance_uid IS NOT NULL
  AND study_instance_uid <> ''
ON CONFLICT (study_instance_uid) DO NOTHING;

-- 3. ai_job_queue.study_id → radiology_studies.id foreign key.
--    Added NOT VALID: enforces referential integrity for every NEW insert
--    (the route now resolves study_id server-side) without locking or scanning
--    the existing table. A later `VALIDATE CONSTRAINT` may be run out-of-band
--    once any legacy orphan rows are reconciled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_job_queue_study_id_fkey'
  ) THEN
    ALTER TABLE ai_job_queue
      ADD CONSTRAINT ai_job_queue_study_id_fkey
      FOREIGN KEY (study_id) REFERENCES radiology_studies(id) NOT VALID;
  END IF;
END $$;
