-- BEND-1 — CARE Radiology Backend v1 closure. Additive and idempotent.
--
--  1. radiology_redelivery_obligations — durable D10 amended-report
--     re-delivery duties (per revision + channel + recipient; recipients
--     stored masked + fingerprinted, raw addresses stay in report_shares).
--  2. radiology_pacs_archive_revisions — PACS archive state per report
--     REVISION (the per-study columns keep only the latest attempt).
--  3. radiology_ops_checks — latest operational verification results
--     (audit chain / drift / backup / restore verification).
--  4. dicom_retry_queue gains durable job-execution columns (it had retry
--     fields but no worker; the radiology job runner now drains it).

CREATE TABLE IF NOT EXISTS radiology_redelivery_obligations (
  id SERIAL PRIMARY KEY,
  root_report_id INTEGER NOT NULL,
  report_id INTEGER NOT NULL,
  sequence_number INTEGER NOT NULL,
  channel TEXT NOT NULL,
  recipient_masked TEXT NOT NULL,
  recipient_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_share_id INTEGER,
  source_report_id INTEGER,
  failure_reason TEXT,
  acted_by TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rro_root_idx ON radiology_redelivery_obligations(root_report_id);
CREATE INDEX IF NOT EXISTS rro_report_idx ON radiology_redelivery_obligations(report_id);
CREATE INDEX IF NOT EXISTS rro_status_idx ON radiology_redelivery_obligations(status);
-- ONE open obligation per (revision, channel, recipient): duplicates are
-- impossible at the database level, not just by application discipline.
CREATE UNIQUE INDEX IF NOT EXISTS rro_open_unique_idx
  ON radiology_redelivery_obligations(report_id, channel, recipient_fingerprint)
  WHERE status IN ('pending', 'acknowledged', 'queued', 'failed');

CREATE TABLE IF NOT EXISTS radiology_pacs_archive_revisions (
  id SERIAL PRIMARY KEY,
  study_id INTEGER NOT NULL,
  report_id INTEGER NOT NULL,
  root_report_id INTEGER,
  sequence_number INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  orthanc_instance_id TEXT,
  detail TEXT,
  attempted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rpar_study_idx ON radiology_pacs_archive_revisions(study_id);
CREATE UNIQUE INDEX IF NOT EXISTS rpar_report_uq ON radiology_pacs_archive_revisions(report_id);
CREATE INDEX IF NOT EXISTS rpar_status_idx ON radiology_pacs_archive_revisions(status);

CREATE TABLE IF NOT EXISTS radiology_ops_checks (
  id SERIAL PRIMARY KEY,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail JSONB,
  ran_by TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS roc_name_time_idx ON radiology_ops_checks(check_name, ran_at);

ALTER TABLE IF EXISTS dicom_retry_queue ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE IF EXISTS dicom_retry_queue ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE IF EXISTS dicom_retry_queue ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE IF EXISTS dicom_retry_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS dicom_retry_queue ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS dicom_retry_queue ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Plain (non-partial) unique index: PostgreSQL treats NULLs as distinct, so
-- keyless rows are unlimited, and ON CONFLICT (idempotency_key) can infer a
-- plain index (it cannot infer a partial one without a matching predicate).
DROP INDEX IF EXISTS dicom_retry_queue_idem_uq;
CREATE UNIQUE INDEX IF NOT EXISTS dicom_retry_queue_idem_uq
  ON dicom_retry_queue(idempotency_key);
CREATE INDEX IF NOT EXISTS dicom_retry_queue_ready_idx
  ON dicom_retry_queue(status, next_retry_at);
