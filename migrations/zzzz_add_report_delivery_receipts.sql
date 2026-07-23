-- =============================================================================
-- Migration: report_delivery_receipts — read-receipt + delivery-status tracking
-- for STAFF-SELECTED WhatsApp report sends (+ unread reminders).
--
-- Self-contained: soft references only (report_id, patient_id are plain
-- integers, no FK), so alphabetical ordering is irrelevant (named zzzz_* to
-- sort last). Idempotent DDL-add only — no DROP / DELETE / UPDATE. Safe to run
-- on every deployment. Feature-flagged OFF (ff_report_delivery_receipts).
-- =============================================================================

CREATE TABLE IF NOT EXISTS report_delivery_receipts (
  id                   serial PRIMARY KEY,
  report_id            integer,
  patient_id           integer,
  provider_message_id  text,
  phone                text        NOT NULL,
  channel              text        NOT NULL DEFAULT 'whatsapp',
  report_number        text,
  test_name            text,
  patient_name         text,
  viewer_url           text,
  status               text        NOT NULL DEFAULT 'sent',   -- sent | delivered | read | failed
  sent_at              timestamptz NOT NULL DEFAULT now(),
  delivered_at         timestamptz,
  read_at              timestamptz,
  failed_at            timestamptz,
  sent_by              text,
  sent_by_name         text,
  reminders_count      integer     NOT NULL DEFAULT 0,
  last_reminder_at     timestamptz,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rdr_report_idx        ON report_delivery_receipts (report_id);
CREATE INDEX IF NOT EXISTS rdr_patient_idx       ON report_delivery_receipts (patient_id);
CREATE INDEX IF NOT EXISTS rdr_status_idx        ON report_delivery_receipts (status);
CREATE INDEX IF NOT EXISTS rdr_provider_msg_idx  ON report_delivery_receipts (provider_message_id);

-- Report delivery mode toggle (manual | auto) surfaced in WhatsApp settings.
-- Additive column with a safe default; manual = staff selects reports bill/
-- test-wise, auto = report auto-sends on verify (kept in sync with
-- auto_send_on_verify by the tracking settings endpoint).
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS report_delivery_mode text NOT NULL DEFAULT 'manual';

-- Feature flag (shadow-mode; disabled by default).
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_report_delivery_receipts', FALSE, 'WhatsApp report delivery read-receipts + unread reminders (staff-selected sends)')
ON CONFLICT (key) DO NOTHING;
