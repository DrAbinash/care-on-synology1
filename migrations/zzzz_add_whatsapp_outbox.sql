-- =============================================================================
-- Migration: WhatsApp outbox + unified settings/automation columns
--
-- Meta WhatsApp Cloud API foundation build. Additive only — no DROP, no
-- DELETE, no data-changing UPDATE, no column removed or retyped. Safe to run
-- on every deployment. Self-contained (soft references only — patient_id /
-- appointment_id / bill_id / report_id / outbox_id are plain integers except
-- wa_delivery_attempts.outbox_id, which does take a real FK to wa_outbox
-- since that table exists solely to record attempts against it), so
-- alphabetical ordering relative to other migrations is irrelevant (named
-- zzzz_* to sort near the end, matching this repo's convention).
--
-- New feature flag ff_whatsapp_cloud_api ships DISABLED, and every new
-- automation toggle below defaults to preserving CURRENT behavior once that
-- flag is eventually turned on (i.e. flipping the flag does not silently
-- change what an already-configured clinic's WhatsApp already does) — see
-- artifacts/api-server/src/services/whatsapp/WhatsAppOutbox.ts for exactly
-- which columns gate which send path.
-- =============================================================================

-- ── wa_outbox — single enqueue point for every outbound WhatsApp send ──────────
CREATE TABLE IF NOT EXISTS wa_outbox (
  id                       serial PRIMARY KEY,
  patient_id               integer,
  appointment_id            integer,
  bill_id                  integer,
  report_id                integer,
  phone_number_id           text,
  recipient_phone           text        NOT NULL,
  message_purpose           text        NOT NULL, -- appointment_reminder | dues_reminder | report_ready | bill_created | payment_link | otp | chatbot_reply | manual_staff_send | test_send
  template_key              text,
  template_version           text,
  payload_json              text        NOT NULL DEFAULT '{}',
  idempotency_key            text        NOT NULL,
  status                   text        NOT NULL DEFAULT 'queued', -- queued | processing | accepted | sent | delivered | read | retry_scheduled | failed | dead_letter | suppressed
  priority                 integer     NOT NULL DEFAULT 5,
  attempt_count             integer     NOT NULL DEFAULT 0,
  max_attempts              integer     NOT NULL DEFAULT 5,
  next_attempt_at            timestamptz NOT NULL DEFAULT now(),
  locked_at                 timestamptz,
  locked_by                 text,
  provider_message_id        text,
  last_error_code            text,
  last_error_message         text,
  suppressed_reason          text,
  created_by                text        NOT NULL DEFAULT 'system',
  created_at                timestamptz NOT NULL DEFAULT now(),
  processing_started_at       timestamptz,
  sent_at                  timestamptz,
  delivered_at              timestamptz,
  read_at                  timestamptz,
  failed_at                 timestamptz,
  dead_lettered_at            timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: a duplicate key is a no-op that returns the existing row
-- rather than a constraint-violation error the caller has to catch.
CREATE UNIQUE INDEX IF NOT EXISTS wa_outbox_idempotency_key_uq ON wa_outbox (idempotency_key);
-- Dispatcher claim query: status + next_attempt_at.
CREATE INDEX IF NOT EXISTS wa_outbox_status_next_attempt_idx ON wa_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS wa_outbox_recipient_phone_idx ON wa_outbox (recipient_phone);
CREATE INDEX IF NOT EXISTS wa_outbox_patient_idx ON wa_outbox (patient_id);
CREATE INDEX IF NOT EXISTS wa_outbox_provider_message_idx ON wa_outbox (provider_message_id);

-- ── wa_delivery_attempts — per-attempt log for the dispatcher + admin diagnostics ──
CREATE TABLE IF NOT EXISTS wa_delivery_attempts (
  id                   serial PRIMARY KEY,
  outbox_id             integer     NOT NULL REFERENCES wa_outbox(id),
  attempt_no            integer     NOT NULL,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  responded_at           timestamptz,
  http_status            integer,
  provider_error_code     text,
  response_sanitized      text, -- truncated, no access tokens, no raw PHI payload
  success               boolean     NOT NULL DEFAULT false,
  retry_scheduled_at       timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_delivery_attempts_outbox_idx ON wa_delivery_attempts (outbox_id);

-- ── whatsapp_settings — unified provider/credentials/automation/consent/webhook columns ──

-- Provider (section A)
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS business_display_name text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS graph_api_version text NOT NULL DEFAULT 'v21.0';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_successful_check_at timestamptz;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_check_error text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_check_error_at timestamptz;

-- Credentials (section B) — app_secret was entirely missing, so webhook
-- signature verification had nowhere to read a secret from even in principle.
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS app_secret text NOT NULL DEFAULT '';

-- Webhook diagnostics (section D)
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_webhook_verified_at timestamptz;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_webhook_received_at timestamptz;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_valid_signature_at timestamptz;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS last_rejected_signature_at timestamptz;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS rejected_signature_count integer NOT NULL DEFAULT 0;

-- Automation controls (section E). shadow_mode + block_non_allowlisted
-- default TRUE — new installs (and this migration running against an
-- existing one) start in the safest state; an admin must explicitly opt out
-- of shadow mode from the unified settings page.
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS test_allowlist text NOT NULL DEFAULT '[]';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS block_non_allowlisted boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS outbound_messaging_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS inbound_processing_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS report_ready_messages_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS payment_messages_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS quiet_hours_start text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS quiet_hours_end text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS max_retry_attempts integer NOT NULL DEFAULT 5;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS retry_delay_base_seconds integer NOT NULL DEFAULT 30;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS daily_message_limit integer NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS monthly_message_budget_warning integer NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS emergency_paused boolean NOT NULL DEFAULT false;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS emergency_paused_reason text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS emergency_paused_at timestamptz;

-- Consent and safety (section G). transactional/reminder default allowed
-- (matches existing behavior); marketing defaults OFF and is not wired to
-- any send path in this change (out of scope — see task description).
-- stop_start_handling_enabled and phi_protection_enabled are DISPLAY-ONLY
-- reflections of behavior that is always-on in WhatsAppBotEngine (STOP/START
-- opt-out, DOB gate before PHI) — they are intentionally not read as a real
-- toggle anywhere, so this column can never be used to accidentally disable
-- a legally-required opt-out or a PHI safeguard from the settings UI.
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS transactional_messages_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS reminder_messages_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS marketing_messages_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS stop_start_handling_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS phi_protection_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS secure_report_link_required boolean NOT NULL DEFAULT true;

-- ── whatsapp_numbers — per-number app_secret override + diagnostics ────────────
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS app_secret text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS business_account_id text NOT NULL DEFAULT '';
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS last_receipt_at timestamptz;
ALTER TABLE whatsapp_numbers ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'unknown'; -- unknown | ok | error

-- ── wa_templates — local version tracking + active flag, per section F ─────────
ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS local_version text NOT NULL DEFAULT '1';
ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS last_synchronized_at timestamptz;
ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- ── wa_contacts — consent audit trail (when/why consent changed) ───────────────
ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS consent_updated_at timestamptz;
ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS consent_source text NOT NULL DEFAULT '';

-- Feature flag — ships disabled. The dispatcher, inbound processing gate,
-- test-send action, and n8n internal automation endpoints all check this
-- flag in addition to their own settings columns above.
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_whatsapp_cloud_api', FALSE, 'Meta WhatsApp Cloud API outbox, dispatcher, and n8n automation endpoints (foundation build — see docs/WHATSAPP_CLOUD_API_SETUP.md)')
ON CONFLICT (key) DO NOTHING;
