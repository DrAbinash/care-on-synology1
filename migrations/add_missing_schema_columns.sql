-- =============================================================================
-- Forensic fix: columns present in Drizzle TS schema or API startup code
-- but missing from the live database due to hash-skip on previous migrations.
-- All statements are ADD COLUMN IF NOT EXISTS — fully idempotent.
-- =============================================================================

-- clinic_settings: columns from add_api_startup_columns.sql that were skipped
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS ollama_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS ollama_model text;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS active_payment_gateway TEXT NOT NULL DEFAULT 'icici';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS icici_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS icici_merchant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS form_f_billing_prompt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS default_max_concurrent_sessions INTEGER NOT NULL DEFAULT 3;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS max_failed_login_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS account_lockout_duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS upi_qr_image_url TEXT NOT NULL DEFAULT 'NA';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS upi_vpa TEXT NOT NULL DEFAULT 'NA';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS upi_qr_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- radiology_worklist
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_feedback TEXT;
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_score TEXT NOT NULL DEFAULT 'RED';
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_draft_status TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS source_pacs TEXT;
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS source_ae_title TEXT;
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS assigned_radiologist TEXT;
ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS patient_match_status TEXT NOT NULL DEFAULT 'UNMATCHED';

-- patient_reports
ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS style_preset_used TEXT;

-- bills
ALTER TABLE bills ADD COLUMN IF NOT EXISTS original_total numeric(10,2) NOT NULL DEFAULT 0;

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS sidebar_theme TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_start_page TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pacs_network_profile TEXT;
