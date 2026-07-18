-- ============================================================================
-- Phase P3 — AI Clinical Workflow config (Gates G10/G11)
-- ============================================================================
-- Additive, idempotent, forward/backward compatible. Seeds a SAFE default:
-- the master flag is OFF and every modality policy is 'disabled', so a fresh
-- deployment shows AI to nobody until an admin explicitly enables it.
-- Rollback (manual — NOT auto-applied):
--   DROP TABLE IF EXISTS ai_draft_feedback;
--   DROP TABLE IF EXISTS ai_radiologist_preferences;
--   DROP TABLE IF EXISTS ai_modality_policies;
--   DROP TABLE IF EXISTS ai_scheduler_config;
--   DROP TABLE IF EXISTS ai_feature_policies;
--   DELETE FROM feature_flags WHERE key = 'ff_radiology_ai';
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_feature_policies (
  id         SERIAL PRIMARY KEY,
  scope      TEXT NOT NULL,
  scope_key  TEXT NOT NULL DEFAULT '*',
  enabled    BOOLEAN NOT NULL DEFAULT false,
  mode       TEXT NOT NULL DEFAULT 'shadow',
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_feature_policy_scope_key ON ai_feature_policies (scope, scope_key);

CREATE TABLE IF NOT EXISTS ai_scheduler_config (
  id                     SERIAL PRIMARY KEY,
  night_start            TEXT NOT NULL DEFAULT '23:00',
  night_end              TEXT NOT NULL DEFAULT '06:00',
  quiet_start            TEXT NOT NULL DEFAULT '08:00',
  quiet_end              TEXT NOT NULL DEFAULT '20:00',
  gpu_limit_percent      INTEGER NOT NULL DEFAULT 90,
  cpu_limit_percent      INTEGER NOT NULL DEFAULT 80,
  max_concurrent_jobs    INTEGER NOT NULL DEFAULT 2,
  max_retries            INTEGER NOT NULL DEFAULT 3,
  include_priors         BOOLEAN NOT NULL DEFAULT true,
  include_ocr            BOOLEAN NOT NULL DEFAULT true,
  skip_finalized_reports BOOLEAN NOT NULL DEFAULT true,
  skip_unchanged_studies BOOLEAN NOT NULL DEFAULT true,
  updated_by             TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_modality_policies (
  id         SERIAL PRIMARY KEY,
  modality   TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'disabled',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_modality_policy_key ON ai_modality_policies (modality);

CREATE TABLE IF NOT EXISTS ai_radiologist_preferences (
  id                             SERIAL PRIMARY KEY,
  staff_id                       INTEGER NOT NULL REFERENCES staff(id),
  auto_generate_draft            BOOLEAN NOT NULL DEFAULT false,
  auto_open_draft                BOOLEAN NOT NULL DEFAULT false,
  preferred_report_style         TEXT NOT NULL DEFAULT 'structured',
  show_confidence_badges         BOOLEAN NOT NULL DEFAULT true,
  show_evidence_thumbnails       BOOLEAN NOT NULL DEFAULT true,
  auto_compare_with_prior        BOOLEAN NOT NULL DEFAULT true,
  auto_load_measurements         BOOLEAN NOT NULL DEFAULT true,
  preferred_language             TEXT NOT NULL DEFAULT 'en',
  structured_reporting_preference BOOLEAN NOT NULL DEFAULT true,
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_radiologist_pref_staff_key ON ai_radiologist_preferences (staff_id);

CREATE TABLE IF NOT EXISTS ai_draft_feedback (
  id                 SERIAL PRIMARY KEY,
  draft_id           INTEGER NOT NULL,
  study_instance_uid TEXT NOT NULL,
  finding_key        TEXT,
  action             TEXT NOT NULL,
  edited_text        TEXT,
  staff_id           INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_draft_feedback_draft_idx  ON ai_draft_feedback (draft_id);
CREATE INDEX IF NOT EXISTS ai_draft_feedback_action_idx ON ai_draft_feedback (action);

-- SAFE DEFAULTS ─────────────────────────────────────────────────────────────
-- Master flag OFF (AI off for everyone until an admin turns it on).
INSERT INTO feature_flags (key, enabled, description)
VALUES ('ff_radiology_ai', false, 'Master switch for the Radiology AI Platform (Phase P3). OFF by default.')
ON CONFLICT (key) DO NOTHING;

-- One scheduler config row with defaults.
INSERT INTO ai_scheduler_config (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ai_scheduler_config);

-- Every modality starts 'disabled'.
INSERT INTO ai_modality_policies (modality, mode) VALUES
  ('MR','disabled'), ('CT','disabled'), ('CR','disabled'),
  ('US','disabled'), ('MG','disabled'), ('Doppler','disabled')
ON CONFLICT (modality) DO NOTHING;
