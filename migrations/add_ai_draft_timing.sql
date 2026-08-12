-- AI draft timing: on_arrival (DICOM intake) vs scheduled (night window).
-- Idempotent additive column for ai_scheduler_config.
ALTER TABLE ai_scheduler_config
  ADD COLUMN IF NOT EXISTS draft_timing TEXT NOT NULL DEFAULT 'on_arrival';
