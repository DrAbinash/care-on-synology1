-- ============================================================================
-- Phase P2 (SHADOW) — AI Gateway Capability Registry + Evaluation Framework
-- ============================================================================
-- Additive, idempotent, forward/backward compatible. No clinical table touched.
-- Rollback (manual — NOT auto-applied):
--   DROP TABLE IF EXISTS ai_evaluation_case_results;
--   DROP TABLE IF EXISTS ai_evaluation_runs;
--   DROP TABLE IF EXISTS ai_golden_cases;
--   DROP TABLE IF EXISTS ai_model_versions;
--   DROP TABLE IF EXISTS ai_model_capabilities;
-- ============================================================================

-- G7 — Capability Registry (per-model capabilities + digest pinning).
CREATE TABLE IF NOT EXISTS ai_model_capabilities (
  id                      SERIAL PRIMARY KEY,
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  model_digest            TEXT,
  supports_vision         BOOLEAN NOT NULL DEFAULT false,
  supports_grounded_json  BOOLEAN NOT NULL DEFAULT false,
  supports_long_context   BOOLEAN NOT NULL DEFAULT false,
  phi_eligible            BOOLEAN NOT NULL DEFAULT false,
  is_local                BOOLEAN NOT NULL DEFAULT false,
  max_tokens              INTEGER,
  is_enabled              BOOLEAN NOT NULL DEFAULT true,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_capability_provider_model_key
  ON ai_model_capabilities (provider, model);

-- G8 — model/prompt version lifecycle (shadow → candidate → live).
CREATE TABLE IF NOT EXISTS ai_model_versions (
  id             SERIAL PRIMARY KEY,
  version_ref    TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  model_digest   TEXT,
  prompt_version TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'shadow',
  approved_by    TEXT,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_version_ref_key ON ai_model_versions (version_ref);

-- G8 — golden dataset.
CREATE TABLE IF NOT EXISTS ai_golden_cases (
  id                        SERIAL PRIMARY KEY,
  case_key                  TEXT NOT NULL,
  modality                  TEXT,
  study_instance_uid        TEXT,
  reference_json            JSONB NOT NULL,
  reference_criticals_json  JSONB,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_golden_case_key ON ai_golden_cases (case_key);

-- G8 — evaluation runs + per-case results.
CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
  id              SERIAL PRIMARY KEY,
  version_ref     TEXT NOT NULL,
  golden_set_size INTEGER NOT NULL DEFAULT 0,
  metrics_json    JSONB,
  passed          BOOLEAN NOT NULL DEFAULT false,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_eval_run_version_idx ON ai_evaluation_runs (version_ref);

CREATE TABLE IF NOT EXISTS ai_evaluation_case_results (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER NOT NULL REFERENCES ai_evaluation_runs(id),
  case_key        TEXT NOT NULL,
  passed          BOOLEAN NOT NULL DEFAULT false,
  validation_ok   BOOLEAN NOT NULL DEFAULT false,
  critical_recall INTEGER,
  diffs_json      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_eval_case_run_idx ON ai_evaluation_case_results (run_id);
