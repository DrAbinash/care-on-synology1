-- Background AI Report Composer (text composition jobs).
-- Separate from overnight vision ai_draft_status / ai_shadow_pipeline.
-- Safe to re-run: IF NOT EXISTS / defaults.

CREATE TABLE IF NOT EXISTS ai_report_compose_jobs (
  id serial PRIMARY KEY,
  study_id integer,
  worklist_id integer,
  report_id integer,
  job_kind text NOT NULL DEFAULT 'FULL_REPORT',
  status text NOT NULL DEFAULT 'QUEUED',
  source_report_revision text NOT NULL,
  source_findings_hash text NOT NULL,
  source_impression_hash text NOT NULL,
  source_recommendation_hash text NOT NULL DEFAULT '',
  input_hash text NOT NULL,
  input_snapshot_json text NOT NULL,
  output_plan_json text,
  tracked_changes_json text,
  proposed_findings text,
  proposed_impression text,
  proposed_recommendation text,
  validation_json text,
  model text,
  fallback_used boolean NOT NULL DEFAULT false,
  latency_ms integer,
  safe_error text,
  created_by text,
  created_by_staff_id integer,
  applied_by text,
  applied_by_staff_id integer,
  queue_job_id integer,
  priority integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  applied_at timestamptz,
  discarded_at timestamptz,
  snapshot_pruned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_report_compose_jobs_worklist_idx ON ai_report_compose_jobs (worklist_id);
CREATE INDEX IF NOT EXISTS ai_report_compose_jobs_study_idx ON ai_report_compose_jobs (study_id);
CREATE INDEX IF NOT EXISTS ai_report_compose_jobs_status_idx ON ai_report_compose_jobs (status);
CREATE INDEX IF NOT EXISTS ai_report_compose_jobs_input_hash_idx ON ai_report_compose_jobs (worklist_id, input_hash, status);

-- Partial unique: only one active identical job per revision+hash+kind
CREATE UNIQUE INDEX IF NOT EXISTS ai_report_compose_jobs_idem_uq
  ON ai_report_compose_jobs (worklist_id, source_report_revision, input_hash, job_kind)
  WHERE status IN ('QUEUED', 'COMPOSING');

ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_compose_status text NOT NULL DEFAULT 'NONE';
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_compose_job_id integer;
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_compose_updated_at timestamptz;

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS report_composer_background_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS report_composer_review_before_apply boolean NOT NULL DEFAULT true;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS report_composer_auto_compose boolean NOT NULL DEFAULT false;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS report_composer_concurrency integer NOT NULL DEFAULT 1;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS report_composer_snapshot_retention_days integer NOT NULL DEFAULT 14;
