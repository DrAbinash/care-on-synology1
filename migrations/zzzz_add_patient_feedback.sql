-- =============================================================================
-- Migration: post-report patient feedback / NPS — feedback_requests +
-- feedback_responses.
--
-- Self-contained: soft references only (patient_id, report_id, request_id are
-- plain integers, no FK), so alphabetical ordering is irrelevant (named zzzz_*
-- to sort last). Idempotent DDL-add only — no DROP / DELETE / UPDATE.
-- Feature-flagged OFF (ff_feedback_nps).
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback_requests (
  id                  serial PRIMARY KEY,
  token               text        NOT NULL,
  patient_id          integer     NOT NULL,
  report_id           integer,
  phone               text,
  patient_name        text,
  test_name           text,
  channel             text        NOT NULL DEFAULT 'whatsapp',
  status              text        NOT NULL DEFAULT 'pending', -- pending | sent | responded | expired
  sent_at             timestamptz,
  responded_at        timestamptz,
  expires_at          timestamptz,
  provider_message_id text,
  last_error          text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_requests_token_uq   ON feedback_requests (token);
-- One invite per report (report_id NULL rows remain distinct in Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS feedback_requests_report_uq  ON feedback_requests (report_id);
CREATE INDEX IF NOT EXISTS feedback_requests_status_idx        ON feedback_requests (status);
CREATE INDEX IF NOT EXISTS feedback_requests_patient_idx       ON feedback_requests (patient_id);

CREATE TABLE IF NOT EXISTS feedback_responses (
  id           serial PRIMARY KEY,
  request_id   integer     NOT NULL,
  patient_id   integer,
  report_id    integer,
  nps_score    integer     NOT NULL,   -- 0..10
  stars        integer,                -- optional 1..5
  comment      text,
  category     text,                   -- promoter | passive | detractor
  user_agent   text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_responses_request_idx   ON feedback_responses (request_id);
CREATE INDEX IF NOT EXISTS feedback_responses_submitted_idx ON feedback_responses (submitted_at);

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_feedback_nps', FALSE, 'Post-report patient feedback / NPS (tokenized WhatsApp links + dashboard)')
ON CONFLICT (key) DO NOTHING;
