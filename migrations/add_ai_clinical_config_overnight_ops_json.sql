-- Overnight AI vision ops + legacy backlog hold metadata (additive JSON blob).
-- Persists pause / Safe Mode / image cap / vision ctx / cutover hold without
-- rewriting dicom_retry_queue rows.
-- Depends on: migrations/add_ai_clinical_config.sql (creates ai_scheduler_config).
-- Rollback:
--   ALTER TABLE ai_scheduler_config DROP COLUMN IF EXISTS overnight_ops_json;

ALTER TABLE ai_scheduler_config
  ADD COLUMN IF NOT EXISTS overnight_ops_json text NOT NULL DEFAULT '{}';
