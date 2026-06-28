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
