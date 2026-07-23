-- =============================================================================
-- Migration: recall / follow-up engine — recall_rules + recall_queue.
--
-- Self-contained: soft references only (patient_id, report_id, rule_id are plain
-- integers, no FK), so alphabetical ordering is irrelevant (named zzzz_* to sort
-- last). Idempotent DDL-add only — no DROP / DELETE / UPDATE. Feature-flagged
-- OFF (ff_recall_engine).
-- =============================================================================

CREATE TABLE IF NOT EXISTS recall_rules (
  id               serial PRIMARY KEY,
  label            text        NOT NULL,
  match_type       text        NOT NULL DEFAULT 'all',   -- all | test
  match_value      text,
  interval_days    integer     NOT NULL,
  channel          text        NOT NULL DEFAULT 'whatsapp',
  message_template text        NOT NULL DEFAULT '',
  enabled          boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recall_rules_enabled_idx ON recall_rules (enabled);

CREATE TABLE IF NOT EXISTS recall_queue (
  id                  serial PRIMARY KEY,
  patient_id          integer     NOT NULL,
  report_id           integer,
  rule_id             integer,
  test_name           text,
  phone               text,
  patient_name        text,
  due_date            text        NOT NULL,               -- YYYY-MM-DD (IST)
  status              text        NOT NULL DEFAULT 'pending', -- pending | sent | snoozed | opted_out | cancelled
  channel             text        NOT NULL DEFAULT 'whatsapp',
  message_snapshot    text,
  sent_at             timestamptz,
  provider_message_id text,
  reminders_count     integer     NOT NULL DEFAULT 0,
  last_error          text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recall_queue_status_idx  ON recall_queue (status);
CREATE INDEX IF NOT EXISTS recall_queue_due_idx     ON recall_queue (due_date);
CREATE INDEX IF NOT EXISTS recall_queue_patient_idx ON recall_queue (patient_id);
-- Idempotency for generation: one recall per (patient, report, rule).
CREATE UNIQUE INDEX IF NOT EXISTS recall_queue_dedupe_uq ON recall_queue (patient_id, report_id, rule_id);

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_recall_engine', FALSE, 'Recall / follow-up engine (rules + queue + daily WhatsApp reminders)')
ON CONFLICT (key) DO NOTHING;
