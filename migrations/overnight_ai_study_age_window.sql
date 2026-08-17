-- Overnight AI study-age eligibility window (additive; default 'all' preserves
-- the previous unbounded night-batch query). Today vs last_24h are distinct.
-- Rollback:
--   ALTER TABLE ai_scheduler_config DROP COLUMN IF EXISTS study_age_window;
--   ALTER TABLE ai_scheduler_config DROP COLUMN IF EXISTS study_age_custom_from;
--   ALTER TABLE ai_scheduler_config DROP COLUMN IF EXISTS study_age_custom_to;

ALTER TABLE ai_scheduler_config
  ADD COLUMN IF NOT EXISTS study_age_window text NOT NULL DEFAULT 'all';
ALTER TABLE ai_scheduler_config
  ADD COLUMN IF NOT EXISTS study_age_custom_from timestamptz;
ALTER TABLE ai_scheduler_config
  ADD COLUMN IF NOT EXISTS study_age_custom_to timestamptz;
-- Existing Draft automation saves draft_timing; some DBs never got the column.
ALTER TABLE ai_scheduler_config
  ADD COLUMN IF NOT EXISTS draft_timing text NOT NULL DEFAULT 'scheduled';

-- Overnight enqueue uses ON CONFLICT (idempotency_key). Some DBs never applied
-- add_radiology_ops_v1.sql's unique index.
CREATE UNIQUE INDEX IF NOT EXISTS dicom_retry_queue_idem_uq
  ON dicom_retry_queue(idempotency_key);
