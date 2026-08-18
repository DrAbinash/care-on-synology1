-- =============================================================================
-- MASTER RUNTIME COLUMNS MIGRATION
-- =============================================================================
--
-- Consolidates ADD COLUMN statements from runStartupMigrations() in index.ts
-- so they run in db-patch-v2 BEFORE the API starts.
--
-- SAFE columns (table in Drizzle migrations): unconditional IF NOT EXISTS
-- RUNTIME columns (table created by API): wrapped in DO $$ existence check
--
-- 100% idempotent. Safe on fresh and existing databases.
-- =============================================================================

-- ── ai_normal_report_templates ────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ai_normal_report_templates') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='ai_normal_report_templates' AND column_name='category') THEN
      ALTER TABLE ai_normal_report_templates ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'normal';
    END IF;
  ELSE
    RAISE NOTICE 'ai_normal_report_templates not yet created — columns will be added by API startup';
  END IF;
END $$;

-- ── audit_logs ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='audit_logs') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='audit_logs' AND column_name='previous_hash') THEN
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT NOT NULL DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='audit_logs' AND column_name='chain_hash') THEN
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_hash TEXT NOT NULL DEFAULT '';
    END IF;
  ELSE
    RAISE NOTICE 'audit_logs not yet created — columns will be added by API startup';
  END IF;
END $$;

-- ── clinic_settings ───────────────────────────────────────────────────────────

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS kiosk_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS kiosk_payment_gateway TEXT NOT NULL DEFAULT 'upi';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS kiosk_upi_vpa TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS kiosk_upi_name TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS kiosk_welcome_message TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS kiosk_allowed_test_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS sidebar_theme TEXT NOT NULL DEFAULT 'navy';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS bill_default_paper_size TEXT NOT NULL DEFAULT 'A5';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS bill_show_code BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS bill_show_category BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS day_close_auto_print BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS commission_discount_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS lan_only_login BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS lan_allowed_ips TEXT NOT NULL DEFAULT '[]';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS fido2_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS registered_address TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS icici_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS icici_merchant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS icici_aggregator_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS icici_secret_key TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS online_booking_services TEXT NOT NULL DEFAULT '{"opd":true,"emergency":true,"usg":true,"xray":true,"ct":true,"mri":true,"pathology":true,"packages":true,"home_collection":true,"doctor":true}';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS service_images TEXT NOT NULL DEFAULT '{}';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS service_images_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS vip_percentage NUMERIC(5,2) NOT NULL DEFAULT '50.00';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS disclaimer_text TEXT NOT NULL DEFAULT 'Online booking charges are subject to the centre''s cancellation policy. In case of cancellation after confirmation, administrative charges may be deducted from the refundable amount.';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS disclaimer_refund_percentage INTEGER NOT NULL DEFAULT 90;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS disclaimer_cancellation_window_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS disclaimer_display_position TEXT NOT NULL DEFAULT 'bottom';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS disclaimer_font_size TEXT NOT NULL DEFAULT 'sm';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS disclaimer_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS active_payment_gateway TEXT NOT NULL DEFAULT 'icici';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS enable_card_payment BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS enable_qr_payment BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS enable_vip_booking BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS enable_payment_logos BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS enable_payment_timer BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS custom_icici_banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS custom_phonepe_banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS custom_bharatpe_banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS custom_payu_banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS lan_only_login BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS lan_allowed_ips TEXT NOT NULL DEFAULT '[]';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS fido2_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS default_max_concurrent_sessions INTEGER NOT NULL DEFAULT 3;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS form_f_billing_prompt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS form_f_address_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS form_f_guardian_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS max_failed_login_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS account_lockout_duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS online_booking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS razorpay_key_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS online_booking_ledger_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS vip_queue_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS payu_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS payu_merchant_key TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS online_booking_allowed_test_ids TEXT NOT NULL DEFAULT '[]';

-- ── diagnostic_tests ──────────────────────────────────────────────────────────

ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'Pathology';
ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS room_number TEXT NOT NULL DEFAULT '';
ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS test_type TEXT NOT NULL DEFAULT 'inhouse';
ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS outsourced_lab_id INTEGER;
ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS room_id INTEGER;
ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS modality_id INTEGER;
ALTER TABLE diagnostic_tests
  ADD COLUMN IF NOT EXISTS floor_label TEXT NOT NULL DEFAULT '';

-- ── dicom_modalities ──────────────────────────────────────────────────────────

ALTER TABLE dicom_modalities
  ADD COLUMN IF NOT EXISTS watch_folder_path TEXT;
ALTER TABLE dicom_modalities
  ADD COLUMN IF NOT EXISTS c_store_port INTEGER;
ALTER TABLE dicom_modalities
  ADD COLUMN IF NOT EXISTS usb_auto_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dicom_modalities
  ADD COLUMN IF NOT EXISTS non_dicom_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── dicom_nodes ───────────────────────────────────────────────────────────────

ALTER TABLE dicom_nodes
  ADD COLUMN IF NOT EXISTS preferred_retrieve_method TEXT NOT NULL DEFAULT 'C_MOVE';

-- ── doctors ───────────────────────────────────────────────────────────────────

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS degree TEXT;

-- ── form_f_records ────────────────────────────────────────────────────────────

ALTER TABLE form_f_records
  ADD COLUMN IF NOT EXISTS gestational_age_weeks TEXT NOT NULL DEFAULT '';
ALTER TABLE form_f_records
  ADD COLUMN IF NOT EXISTS gestational_age_days TEXT NOT NULL DEFAULT '';

-- ── kiosk_payment_sessions ────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='kiosk_payment_sessions') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='kiosk_payment_sessions' AND column_name='patient_details') THEN
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS patient_details TEXT NOT NULL DEFAULT '{}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='kiosk_payment_sessions' AND column_name='gateway') THEN
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS gateway TEXT NOT NULL DEFAULT 'razorpay';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='kiosk_payment_sessions' AND column_name='icici_transaction_id') THEN
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS icici_transaction_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='kiosk_payment_sessions' AND column_name='icici_provider_ref_id') THEN
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS icici_provider_ref_id TEXT;
    END IF;
  ELSE
    RAISE NOTICE 'kiosk_payment_sessions not yet created — columns will be added by API startup';
  END IF;
END $$;

-- ── ledgers ───────────────────────────────────────────────────────────────────

ALTER TABLE ledgers
  ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT false;

-- ── online_bookings ───────────────────────────────────────────────────────────

ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS icici_transaction_id TEXT;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS icici_provider_ref_id TEXT;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS age_value INTEGER;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS age_unit TEXT;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS time_slot TEXT NOT NULL DEFAULT '';
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS icici_transaction_id TEXT;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS icici_provider_ref_id TEXT;
ALTER TABLE online_bookings
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- ── order_tests ───────────────────────────────────────────────────────────────

ALTER TABLE order_tests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE order_tests
  ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT;
ALTER TABLE order_tests
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE order_tests
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- ── patient_reports ───────────────────────────────────────────────────────────

ALTER TABLE patient_reports
  ADD COLUMN IF NOT EXISTS style_preset_used TEXT;

-- ── portal_sessions ───────────────────────────────────────────────────────────

ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── printer_settings ──────────────────────────────────────────────────────────

ALTER TABLE printer_settings
  ADD COLUMN IF NOT EXISTS barcode_enabled TEXT NOT NULL DEFAULT 'true';
ALTER TABLE printer_settings
  ADD COLUMN IF NOT EXISTS token_enabled TEXT NOT NULL DEFAULT 'true';

-- ── radiology_studies ─────────────────────────────────────────────────────────

ALTER TABLE radiology_studies
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'routine';
ALTER TABLE radiology_studies
  ADD COLUMN IF NOT EXISTS priority_reason TEXT;
ALTER TABLE radiology_studies
  ADD COLUMN IF NOT EXISTS priority_overridden_at TIMESTAMPTZ;
ALTER TABLE radiology_studies
  ADD COLUMN IF NOT EXISTS priority_overridden_by TEXT;

-- ── radiology_worklist ────────────────────────────────────────────────────────

ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS dicom_patient_id TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS patient_match_status TEXT NOT NULL DEFAULT 'UNMATCHED';
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS source_pacs TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS source_ae_title TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS dicom_metadata TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS ai_draft_status TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS ai_draft_json TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS ai_feedback TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS ai_feedback_at TIMESTAMPTZ;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS assigned_radiologist TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_score TEXT NOT NULL DEFAULT 'RED';
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_reasons TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_warnings TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_decision TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_approved_by TEXT;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_approved_at TIMESTAMPTZ;
ALTER TABLE radiology_worklist
  ADD COLUMN IF NOT EXISTS match_override_reason TEXT;

-- ── users ─────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sidebar_theme TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_start_page TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS remote_login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── usg_measurements ──────────────────────────────────────────────────────────

ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_kidney_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_kidney_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_kidney_thickness_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_kidney_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_kidney_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_kidney_thickness_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_cortical_thickness_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_cortical_thickness_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS prostate_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS prostate_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS prostate_height_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_right_lobe_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_right_lobe_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_right_lobe_thickness_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_left_lobe_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_left_lobe_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_left_lobe_thickness_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_isthmus_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_nodule_size_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS thyroid_tirads_score TEXT;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS liver_span_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS cbd_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS gb_wall_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS uterus_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS uterus_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS uterus_height_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_ovary_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_ovary_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS right_ovary_height_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_ovary_length_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_ovary_width_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS left_ovary_height_mm REAL;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS follicle_count INTEGER;
ALTER TABLE usg_measurements
  ADD COLUMN IF NOT EXISTS largest_follicle_mm REAL;

-- ── usg_report_drafts ─────────────────────────────────────────────────────────

ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS amended_by TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS prior_version_id INTEGER;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS critical_alert_id INTEGER;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS amended_by TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS prior_version_id INTEGER;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS critical_alert_id INTEGER;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS finalized_report_hash TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS finalized_pdf_version_id TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS amendment_reason TEXT;
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE usg_report_drafts
  ADD COLUMN IF NOT EXISTS locked_by TEXT;
