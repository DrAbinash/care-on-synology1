-- =============================================================================
-- Migration: operational_health_runs — Deployment Smoke Test / Operational
-- Health run history (Phase 6 of the operations-health feature).
--
-- Self-contained: no foreign keys, no references to other tables, so ordering
-- is irrelevant (named zzzz_* to sort last). Idempotent DDL-add only — no
-- DROP / DELETE / UPDATE. Safe to run on every deployment.
-- =============================================================================

CREATE TABLE IF NOT EXISTS operational_health_runs (
  id              serial PRIMARY KEY,
  run_id          text        NOT NULL,
  trigger         text        NOT NULL,          -- deployment | cli | admin | scheduled
  overall_status  text        NOT NULL,          -- PASS | WARNING | FAIL | SKIPPED | UNKNOWN
  version         text,
  git_commit      text,
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz NOT NULL,
  duration_ms     integer     NOT NULL DEFAULT 0,
  summary_json    jsonb       NOT NULL,
  checks_json     jsonb       NOT NULL,
  initiated_by    text,
  error_summary   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_health_runs_created_idx
  ON operational_health_runs (created_at);
