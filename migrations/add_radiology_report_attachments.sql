-- Externally-produced final reports (composed in Word, exported as PDF/DOCX)
-- attached against a radiology study. See lib/db/src/schema/radiology.ts for
-- the full rationale — modeled directly on outsource_reports.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS radiology_report_attachments (
  id          SERIAL PRIMARY KEY,
  study_id    INTEGER NOT NULL,
  patient_id  INTEGER NOT NULL,
  file_path   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  uploaded_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_report_attachments_study_idx
  ON radiology_report_attachments (study_id);
