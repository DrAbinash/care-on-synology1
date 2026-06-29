-- =============================================================================
-- Fix: columns added by runStartupMigrations() in index.ts that must also
-- exist before schema verification runs (which happens before API startup).
-- =============================================================================
--
-- Root cause: These columns are created by ALTER TABLE statements inside
-- runStartupMigrations() in artifacts/api-server/src/index.ts.
-- runStartupMigrations() runs when the API starts.
-- The schema verifier (db-patch-v2 Step 6) runs BEFORE the API starts.
-- This creates a chicken-and-egg: verifier checks columns that only
-- exist after the API runs, but the API is blocked until verifier passes.
--
-- Fix: mirror every verified column here so db-patch-v2 creates them
-- before the verifier checks them. All statements are ADD COLUMN IF NOT
-- EXISTS — idempotent, safe on fresh and already-migrated databases.
-- When runStartupMigrations() later runs, IF NOT EXISTS makes it a no-op.
--
-- All column definitions match index.ts exactly (same type, same default).
-- =============================================================================

-- ── clinic_settings ──────────────────────────────────────────────────────────

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS active_payment_gateway        TEXT    NOT NULL DEFAULT 'icici';

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS icici_enabled                 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS icici_merchant_id             TEXT    NOT NULL DEFAULT '';

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes  INTEGER NOT NULL DEFAULT 30;

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS form_f_billing_prompt         BOOLEAN NOT NULL DEFAULT FALSE;

-- ── radiology_worklist ───────────────────────────────────────────────────────

ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS ai_feedback                   TEXT;

ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_score                   TEXT    NOT NULL DEFAULT 'RED';

-- ── patient_reports ──────────────────────────────────────────────────────────

ALTER TABLE patient_reports
  ADD COLUMN IF NOT EXISTS style_preset_used             TEXT;

-- ── users ────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_start_page            TEXT;

-- ── Additional columns found missing at API startup ──────────────────────────
-- These are referenced by seedBootstrapAdminIfNeeded() and runStartupMigrations()
-- before they have a chance to CREATE them, causing the API to crash.

-- clinic_settings: UPI QR columns (referenced in INSERT INTO clinic_settings)
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS upi_qr_image_url    TEXT    NOT NULL DEFAULT 'NA';

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS upi_vpa             TEXT    NOT NULL DEFAULT 'NA';

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS upi_qr_enabled      BOOLEAN NOT NULL DEFAULT FALSE;

-- clinic_settings: security/session columns (referenced in INSERT INTO clinic_settings)
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS default_max_concurrent_sessions   INTEGER NOT NULL DEFAULT 3;

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS max_failed_login_attempts         INTEGER NOT NULL DEFAULT 5;

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS account_lockout_duration_minutes  INTEGER NOT NULL DEFAULT 30;

-- users: pacs_network_profile (Drizzle ORM INSERT includes all schema columns)
-- Defined in lib/db/src/schema/users.ts but never added to SQL migrations
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pacs_network_profile  TEXT;
