import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Force Node/V8 and any downstream libraries to treat IST as the local
// timezone.  This fixes getFullYear()/getMonth()/getDate() and any
// toLocaleDateString() call that omits an explicit timeZone.
process.env.TZ = "Asia/Kolkata";

// Load a workspace-root .env file (if present) before anything reads
// process.env. By default dotenv does NOT override variables that are
// already set, so the values injected by Replit's runtime always win.
const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env",
);
dotenv.config({ path: rootEnv });

import app from "./app";
import { initializePluginLoader } from "./plugin-loader";
initializePluginLoader(app);

import { logger } from "./lib/logger";
import { startCronScheduler } from "./cron";
import { ensureDefaultLedger } from "./routes/ledgers";
import { backfillExpirePublicTokens } from "./routes/patient-reports";
import { db, usersTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { validateRadiologyConfig } from "./lib/pacs/pacsConfig.js";
import { shouldForceBootstrapReset } from "./lib/bootstrapAdmin.js";

// Bootstrap admin account for fresh production databases.
//
// Default behaviour: only seeds when the `users` table is completely
// empty (typical right after the first publish to a brand-new prod DB).
// Once any user exists this is a no-op forever, so it's safe to leave in.
//
// Force mode: set BOOTSTRAP_ADMIN_FORCE=1 in deployment secrets to
// upsert the bootstrap account even when the table already has rows.
// Use this once when you need to reset the role/PIN on an existing
// bootstrap row (e.g. you seeded a super_admin but want a regular admin
// because you don't have the USB pen-drive yet). Remove the env var
// after the next publish so subsequent restarts don't keep overwriting
// PIN changes made through the UI.
//
// Defaults: role=super_admin, PIN=1234. Override via BOOTSTRAP_ADMIN_EMAIL /
// BOOTSTRAP_ADMIN_NAME / BOOTSTRAP_ADMIN_PIN / BOOTSTRAP_ADMIN_ROLE.
// "super_admin" is the initial privileged account used to bootstrap the
// super-admin portal; it can then create or manage additional accounts.
/**
 * Pure decision function, extracted so it can be unit tested without
 * mocking the rest of index.ts's startup side effects. See
 * lib/bootstrapAdmin.ts for the implementation and full explanation.
 */

async function seedBootstrapAdminIfNeeded(): Promise<void> {
  try {
    // FIXED: this was hardcoded to `true`, which silently ignored
    // BOOTSTRAP_ADMIN_FORCE entirely and reset the bootstrap admin's PIN
    // back to the default on EVERY container restart — including normal
    // Synology Container Manager rebuilds — even after the doctor had
    // already changed it through the UI. Now correctly reads the env var
    // and defaults to false (safe) when unset, matching the documented
    // behavior in the comment block above and in .env.example.
    const force = shouldForceBootstrapReset(process.env);

    if (force) {
      logger.warn(
        "BOOTSTRAP_ADMIN_FORCE is enabled. The bootstrap admin account will be reset to its " +
        "default PIN/role on this startup. Disable this in production after logging in — " +
        "remove BOOTSTRAP_ADMIN_FORCE from .env and redeploy, or the PIN will keep resetting " +
        "on every restart.",
      );
    }

    const anyUser = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    if (anyUser.length > 0 && !force) return; // already populated, no force flag

    const email = (process.env["BOOTSTRAP_ADMIN_EMAIL"] || "abinashsingh@gmail.com").toLowerCase();
    const name = process.env["BOOTSTRAP_ADMIN_NAME"] || "Dr Abinash Kumar";
    const plainPin = process.env["BOOTSTRAP_ADMIN_PIN"] || "1234";
    const role = process.env["BOOTSTRAP_ADMIN_ROLE"] || "super_admin";
    const hash = await bcrypt.hash(plainPin, 12);

    const allModulePermissions = [
      "/", "/patients", "/orders", "/register", "/billing", "/doctors",
      "/report-generator", "/referrals", "/discounts", "/tests", "/payments",
      "/reports", "/inventory", "/accounting", "/settings",
    ];
    const permissionsJson = JSON.stringify(allModulePermissions);

    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(usersTable)
        .set({
          name,
          role,
          permissions: permissionsJson,
          pin: hash,
          isActive: true,
          mustChangePin: false,
        })
        .where(eq(usersTable.email, email));
      logger.warn(
        { email, role, force },
        "Bootstrap admin updated (existing row reset to bootstrap defaults). " +
          "Sign in and change the PIN, then unset BOOTSTRAP_ADMIN_FORCE.",
      );
    } else {
      await db.insert(usersTable).values({
        name,
        email,
        role,
        permissions: permissionsJson,
        pin: hash,
        isActive: true,
        mustChangePin: false,
      });
      logger.warn(
        { email, role },
        "Seeded bootstrap admin user. Sign in and change the PIN immediately.",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed/update bootstrap admin");
  }
}

// ── Startup schema migrations ──────────────────────────────────────────────────
// Idempotent ALTER TABLE / CREATE TABLE IF NOT EXISTS statements that extend
// the schema without requiring a full Drizzle migration pipeline. Safe to run
// on every startup because every clause uses IF NOT EXISTS / ADD COLUMN IF.
async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE order_tests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE order_tests ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT;
      ALTER TABLE order_tests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
      ALTER TABLE order_tests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

      -- ── Backfill: close commission leak on historical cancelled bills ────
      -- Any bill cancelled before the cascade-fix (May 2026) left its
      -- order_tests rows in 'active' state, so commission reports kept
      -- accruing for the referring doctor. This idempotent UPDATE marks
      -- those tests as cancelled with a clear audit-friendly reason.
      UPDATE order_tests ot
         SET status = 'cancelled',
             cancellation_reason = COALESCE(ot.cancellation_reason,
               'Backfill: parent bill ' || b.bill_number || ' was cancelled'),
             cancelled_at = COALESCE(ot.cancelled_at, b.cancelled_at, NOW()),
             cancelled_by_name = COALESCE(ot.cancelled_by_name, b.cancelled_by_name, 'system-backfill')
        FROM bills b
       WHERE ot.order_id = b.order_id
         AND b.status = 'cancelled'
         AND ot.status <> 'cancelled';
      -- ── Permanently ensure bootstrap owner is always super_admin ────────
      -- Runs unconditionally on every startup so the owner account can
      -- never be accidentally demoted or locked out.
      UPDATE users
         SET role = 'super_admin'
       WHERE email = 'abinashsingh@gmail.com'
         AND role <> 'super_admin';

      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'Pathology';
      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS room_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS test_type TEXT NOT NULL DEFAULT 'inhouse';
      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS outsourced_lab_id INTEGER;
      CREATE TABLE IF NOT EXISTS outsourced_labs (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        gstin TEXT,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS kiosk_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS quick_doctor_ids TEXT NOT NULL DEFAULT '[null,null,null,null,null,null,null,null]';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS kiosk_payment_gateway TEXT NOT NULL DEFAULT 'upi';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS kiosk_upi_vpa TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS kiosk_upi_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS kiosk_welcome_message TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS kiosk_allowed_test_ids TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS sidebar_theme TEXT NOT NULL DEFAULT 'navy';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS bill_default_paper_size TEXT NOT NULL DEFAULT 'A5';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS bill_show_code BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS bill_show_category BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS day_close_auto_print BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS commission_discount_mode TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS lan_only_login BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS lan_allowed_ips TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS fido2_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE printer_settings ADD COLUMN IF NOT EXISTS barcode_enabled TEXT NOT NULL DEFAULT 'true';
      ALTER TABLE printer_settings ADD COLUMN IF NOT EXISTS token_enabled TEXT NOT NULL DEFAULT 'true';
      -- ── Work / Registered address columns ──
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS registered_address TEXT NOT NULL DEFAULT '';
      -- ICICI Orange PG
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS icici_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS icici_merchant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS icici_aggregator_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS icici_secret_key TEXT NOT NULL DEFAULT '';
      -- Online booking granular services & service images settings
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS online_booking_services TEXT NOT NULL DEFAULT '{"opd":true,"emergency":true,"usg":true,"xray":true,"ct":true,"mri":true,"pathology":true,"packages":true,"home_collection":true,"doctor":true}';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS service_images TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS service_images_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      -- VIP and Disclaimer settings
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS vip_percentage NUMERIC(5,2) NOT NULL DEFAULT '50.00';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_text TEXT NOT NULL DEFAULT 'Online booking charges are subject to the centre''s cancellation policy. In case of cancellation after confirmation, administrative charges may be deducted from the refundable amount.';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_refund_percentage INTEGER NOT NULL DEFAULT 90;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_cancellation_window_hours INTEGER NOT NULL DEFAULT 24;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_display_position TEXT NOT NULL DEFAULT 'bottom';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_font_size TEXT NOT NULL DEFAULT 'sm';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_enabled BOOLEAN NOT NULL DEFAULT TRUE;

      -- ICICI online bookings
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS icici_transaction_id TEXT;
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS icici_provider_ref_id TEXT;
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS age_value INTEGER;
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS age_unit TEXT;
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS gender TEXT;

      -- Refactored Payment Gateway Settings
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS active_payment_gateway TEXT NOT NULL DEFAULT 'icici';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS enable_card_payment BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS enable_qr_payment BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS enable_vip_booking BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS enable_payment_logos BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS enable_payment_timer BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS custom_icici_banner_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS custom_phonepe_banner_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS custom_bharatpe_banner_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS custom_payu_banner_url TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS payment_logs (
        id SERIAL PRIMARY KEY,
        booking_ref TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        gateway TEXT NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        status TEXT NOT NULL,
        request_payload TEXT,
        response_payload TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Backfill safety net: on any deployment where payment_logs was ──
      -- created by an older version of this CREATE TABLE (before amount /
      -- error_message existed), CREATE TABLE IF NOT EXISTS above is a
      -- no-op and the columns never get added. These ALTER statements are
      -- idempotent (IF NOT EXISTS) and guarantee both columns always exist,
      -- regardless of when the table was first created.
      ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2) NOT NULL DEFAULT 0;
      ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS error_message TEXT;

      CREATE INDEX IF NOT EXISTS idx_payment_logs_booking_ref
        ON payment_logs (booking_ref);

      CREATE INDEX IF NOT EXISTS idx_payment_logs_booking_ref
        ON payment_logs (booking_ref);

      -- ── Ensure clinic_settings always has exactly one default row ────
      -- The settings UI relies on this row existing so PUT updates succeed.
      INSERT INTO clinic_settings (
        id, name, tagline, address, email, phone, website, gstin, logo_data_url, footer_note, updated_at,
        form_f_test_ids, quick_test_ids, patient_photo_enabled, portal_enabled, portal_heading, portal_welcome_message,
        portal_allow_appointment_booking, portal_allow_profile_edit, show_tat_on_bill, bill_print_copies, qr_on_bill_enabled,
        online_booking_enabled, razorpay_key_id, online_booking_ledger_id, vip_queue_enabled, kiosk_enabled, kiosk_upi_vpa,
        kiosk_upi_name, kiosk_welcome_message, kiosk_allowed_test_ids, sidebar_theme, bill_default_paper_size, bill_show_code,
        bill_show_category, payu_enabled, payu_merchant_key, day_close_auto_print, commission_discount_mode, lan_only_login,
        lan_allowed_ips, fido2_enabled, phonepe_enabled, phonepe_merchant_id, bharatpe_enabled, bharatpe_merchant_id,
        cashfree_enabled, cashfree_app_id, online_booking_allowed_test_ids, session_idle_timeout_minutes,
        default_max_concurrent_sessions, max_failed_login_attempts, account_lockout_duration_minutes, form_f_billing_prompt,
        form_f_address_required, form_f_guardian_required, registered_address, online_booking_allowed_package_ids,
        upi_qr_image_url, upi_vpa, upi_qr_enabled, icici_enabled, icici_merchant_id, icici_aggregator_id
      )
      SELECT 1, 'Care Diagnostics', 'Diagnostic & Pathology Services', 'CARE DIAGNOSTICS Subhash Chowk Castair Town Near Bajla Mahila College Deoghar 814112', 'CARE.DEOGHAR@GMAIL.COM', '9973497200', 'www.carediagnostics.in', '', null, 'Thank you for choosing our diagnostic services.', NOW(), '[]', '[null null null null null null]', false, false, 'Welcome', 'Welcome to our portal', true, true, false, 1, true, false, '', 1, false, false, 'NA', 'NA', 'Welcome to Kiosk', '[]', 'navy', 'A5', true, true, false, 'NA', true, 'none', false, '[]', false, false, 'NA', false, 'NA', false, 'NA', '[]', 30, 3, 5, 30, false, true, true, 'Jayshankar Bhawan Bilasi Town Deoghar Ward No 27 Hiralal Pal Road Deoghar Jharkhand 814112', '[]', 'NA', 'NA', false, false, 'NA', 'NA'
      WHERE NOT EXISTS (SELECT 1 FROM clinic_settings LIMIT 1);

      -- ── One-time correction: earlier seeds above stored the literal
      -- placeholder text 'GSTIN_NOT_SET' / 'RZP_KEY_NOT_SET' instead of an
      -- empty string for "not configured" fields. Since these are
      -- non-empty strings, bill print templates (which check "if gstin is
      -- set, print it") treated them as real values and printed
      -- "GSTIN: GSTIN_NOT_SET" on every invoice.
      --
      -- Both columns are TEXT NOT NULL DEFAULT '' (see
      -- lib/db/src/schema/clinicSettings.ts), so the fix must use '' here,
      -- not NULL — an earlier version of this migration used NULL and
      -- violated the NOT NULL constraint on every startup, which aborted
      -- this entire migration batch (including unrelated statements like
      -- outsourced_labs setup that run later in the same transaction).
      -- Empty string is safe: all read paths already treat '' the same as
      -- "not configured" (row.gstin ?? "", clinic?.gstin ? ... : ""),
      -- since both are falsy.
      --
      -- Safe to run every startup — only touches rows still holding the
      -- exact placeholder text or a leftover NULL from a prior failed run;
      -- a no-op once corrected. Idempotent, non-destructive.
      UPDATE clinic_settings SET gstin = '' WHERE gstin = 'GSTIN_NOT_SET' OR gstin IS NULL;
      UPDATE clinic_settings SET razorpay_key_id = '' WHERE razorpay_key_id = 'RZP_KEY_NOT_SET' OR razorpay_key_id IS NULL;
      CREATE TABLE IF NOT EXISTS day_closures (
        id SERIAL PRIMARY KEY,
        closure_date TEXT NOT NULL,
        closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_by_user_id INTEGER,
        closed_by_name TEXT NOT NULL DEFAULT '',
        covered_from_ts TIMESTAMPTZ,
        covered_to_ts TIMESTAMPTZ NOT NULL,
        expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_upi NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_card NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_cheque NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_other NUMERIC(12,2) NOT NULL DEFAULT 0,
        actual_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
        actual_upi NUMERIC(12,2) NOT NULL DEFAULT 0,
        actual_card NUMERIC(12,2) NOT NULL DEFAULT 0,
        actual_cheque NUMERIC(12,2) NOT NULL DEFAULT 0,
        actual_other NUMERIC(12,2) NOT NULL DEFAULT 0,
        variance NUMERIC(12,2) NOT NULL DEFAULT 0,
        variance_note TEXT NOT NULL DEFAULT '',
        bills_count INTEGER NOT NULL DEFAULT 0,
        payments_count INTEGER NOT NULL DEFAULT 0,
        total_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_actual NUMERIC(12,2) NOT NULL DEFAULT 0,
        staff_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'closed',
        reopened_at TIMESTAMPTZ,
        reopened_by_user_id INTEGER,
        reopened_by_name TEXT NOT NULL DEFAULT '',
        reopen_reason TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS day_closures_covered_to_idx ON day_closures(covered_to_ts);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sidebar_theme TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS default_start_page TEXT;
      CREATE TABLE IF NOT EXISTS kiosk_payment_sessions (
        id SERIAL PRIMARY KEY,
        payment_link_id TEXT NOT NULL UNIQUE,
        session_ref TEXT NOT NULL,
        test_ids TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        patient_name TEXT NOT NULL,
        patient_details TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        gateway TEXT NOT NULL DEFAULT 'razorpay',
        razorpay_payment_id TEXT,
        icici_transaction_id TEXT,
        icici_provider_ref_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes'
      );
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS patient_details TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS gateway TEXT NOT NULL DEFAULT 'razorpay';
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS icici_transaction_id TEXT;
      ALTER TABLE kiosk_payment_sessions ADD COLUMN IF NOT EXISTS icici_provider_ref_id TEXT;
      -- Voluson USG / expanded DICOM import columns
      ALTER TABLE dicom_modalities ADD COLUMN IF NOT EXISTS watch_folder_path TEXT;
      ALTER TABLE dicom_modalities ADD COLUMN IF NOT EXISTS c_store_port INTEGER;
      ALTER TABLE dicom_modalities ADD COLUMN IF NOT EXISTS usb_auto_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE dicom_modalities ADD COLUMN IF NOT EXISTS non_dicom_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE TABLE IF NOT EXISTS dicom_nodes (
        id SERIAL PRIMARY KEY,
        ae_title TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 104,
        modality TEXT NOT NULL DEFAULT 'OT',
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        auto_pull BOOLEAN NOT NULL DEFAULT FALSE,
        pull_interval_seconds INTEGER NOT NULL DEFAULT 300,
        query_lookback_hours INTEGER NOT NULL DEFAULT 24,
        conquest_ae_title TEXT NOT NULL DEFAULT '',
        conquest_host TEXT NOT NULL DEFAULT '',
        conquest_port INTEGER NOT NULL DEFAULT 5678,
        preferred_retrieve_method TEXT NOT NULL DEFAULT 'C_MOVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- Rename old dicom_nodes columns for databases created before May 2026
      -- Idempotent: safe to run repeatedly regardless of which columns already exist.
      DO $$
      DECLARE
        has_minutes BOOLEAN;
        has_seconds BOOLEAN;
        has_pull_query_days BOOLEAN;
        has_lookback_hours BOOLEAN;
      BEGIN
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dicom_nodes' AND column_name = 'pull_interval_minutes') INTO has_minutes;
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dicom_nodes' AND column_name = 'pull_interval_seconds') INTO has_seconds;

        IF has_minutes AND NOT has_seconds THEN
          -- Clean case: only the old column exists, rename and convert minutes -> seconds
          ALTER TABLE dicom_nodes RENAME COLUMN pull_interval_minutes TO pull_interval_seconds;
          UPDATE dicom_nodes SET pull_interval_seconds = COALESCE(pull_interval_seconds * 60, 300) WHERE pull_interval_seconds IS NOT NULL;
        ELSIF has_minutes AND has_seconds THEN
          -- Both exist (e.g. a prior partial migration ran): keep pull_interval_seconds,
          -- drop the stale legacy column rather than crashing on a duplicate-column rename.
          RAISE WARNING 'dicom_nodes has both pull_interval_minutes and pull_interval_seconds; dropping legacy pull_interval_minutes and keeping pull_interval_seconds';
          ALTER TABLE dicom_nodes DROP COLUMN pull_interval_minutes;
        ELSIF has_seconds THEN
          -- Already migrated, nothing to do.
          NULL;
        ELSE
          -- Neither exists yet; CREATE TABLE IF NOT EXISTS above already defines
          -- pull_interval_seconds for fresh installs, so this should not happen.
          RAISE WARNING 'dicom_nodes has neither pull_interval_minutes nor pull_interval_seconds';
        END IF;

        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dicom_nodes' AND column_name = 'pull_query_days') INTO has_pull_query_days;
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dicom_nodes' AND column_name = 'query_lookback_hours') INTO has_lookback_hours;

        IF has_pull_query_days AND NOT has_lookback_hours THEN
          ALTER TABLE dicom_nodes RENAME COLUMN pull_query_days TO query_lookback_hours;
          UPDATE dicom_nodes SET query_lookback_hours = COALESCE(query_lookback_hours * 24, 24) WHERE query_lookback_hours IS NOT NULL;
        ELSIF has_pull_query_days AND has_lookback_hours THEN
          RAISE WARNING 'dicom_nodes has both pull_query_days and query_lookback_hours; dropping legacy pull_query_days and keeping query_lookback_hours';
          ALTER TABLE dicom_nodes DROP COLUMN pull_query_days;
        END IF;
      END $$;
      ALTER TABLE dicom_nodes ADD COLUMN IF NOT EXISTS preferred_retrieve_method TEXT NOT NULL DEFAULT 'C_MOVE';

      -- Default Voluson USG entry (idempotent)
      INSERT INTO dicom_modalities (machine_name, modality, ae_title, ip_address, port, location, manufacturer, auto_send_enabled, is_active, query_enabled, retrieve_enabled, retrieve_method, destination_pacs, watch_folder_path, c_store_port, usb_auto_import_enabled, non_dicom_import_enabled, notes)
      SELECT 'Voluson USG', 'US', 'Voluson', '172.16.1.46', 104, 'Radiology Wing - USG', 'GE Healthcare Voluson', true, true, true, true, 'C_STORE_OR_WATCH_FOLDER', 'CONQUEST', '/var/dicom/incoming/voluson', 11112, true, true, 'GE Voluson ultrasound machine with C-STORE receive, watch folder, USB/DICOMDIR and non-DICOM JPG/PNG fallback support'
      WHERE NOT EXISTS (SELECT 1 FROM dicom_modalities WHERE ae_title = 'Voluson');

      -- Default Voluson node for pull agent (idempotent)
      INSERT INTO dicom_nodes (ae_title, host, port, modality, description, location, is_active, auto_pull, pull_interval_seconds, query_lookback_hours, conquest_ae_title, conquest_host, conquest_port, preferred_retrieve_method)
      SELECT 'Voluson', '172.16.1.46', 104, 'US', 'GE Voluson USG machine', 'Radiology Wing - USG', true, true, 900, 24, '', '', 5678, 'C_STORE_OR_WATCH_FOLDER'
      WHERE NOT EXISTS (SELECT 1 FROM dicom_nodes WHERE ae_title = 'Voluson');

      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS dicom_patient_id TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS patient_match_status TEXT NOT NULL DEFAULT 'UNMATCHED';
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS source_pacs TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS source_ae_title TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS dicom_metadata TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_draft_status TEXT NOT NULL DEFAULT 'NONE';
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_draft_json TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_feedback TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS ai_feedback_at TIMESTAMPTZ;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS assigned_radiologist TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_score TEXT NOT NULL DEFAULT 'RED';
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_points INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_reasons TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_warnings TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_decision TEXT NOT NULL DEFAULT 'PENDING';
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_approved_by TEXT;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_approved_at TIMESTAMPTZ;
      ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS match_override_reason TEXT;

      -- ── Fix: bad/duplicate DICOM accession numbers crashing intake ──────
      -- radiology_worklist.accession_number was NOT NULL + globally UNIQUE.
      -- Real-world DICOM data from misconfigured modalities sometimes pushes
      -- non-unique junk into AccessionNumber (e.g. a referring doctor's name
      -- instead of a real accession), which made POST
      -- /api/internal/radiology/studies fail with
      -- "duplicate key value violates unique constraint
      -- radiology_worklist_accession_uq" and reject genuinely new studies.
      --
      -- study_instance_uid is the actual globally-unique DICOM identifier,
      -- so that's what should be enforced at the DB level instead.
      -- Accession number becomes an optional, non-unique display/reference
      -- field. Schema-only change — no rows are deleted or modified.
      ALTER TABLE radiology_worklist ALTER COLUMN accession_number DROP NOT NULL;
      DROP INDEX IF EXISTS radiology_worklist_accession_uq;
      CREATE INDEX IF NOT EXISTS radiology_worklist_accession_idx
        ON radiology_worklist (accession_number);

      -- Enforce true uniqueness on study_instance_uid (nulls excluded, so
      -- older/incomplete rows without a UID are unaffected). Wrapped in a
      -- guard: if any pre-existing rows already have duplicate non-null
      -- UIDs (which the DB never prevented before today), creating the
      -- index would fail — that must not abort the rest of startup. If it
      -- is skipped, re-run after resolving duplicates
      -- (SELECT study_instance_uid, COUNT(*) FROM radiology_worklist WHERE
      -- study_instance_uid IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1).
      DO $$
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS radiology_worklist_uid_uq
          ON radiology_worklist (study_instance_uid)
          WHERE study_instance_uid IS NOT NULL;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'radiology_worklist_uid_uq: skipped — existing duplicate study_instance_uid values found, resolve manually then re-deploy';
      END $$;

      ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS style_preset_used TEXT;

      CREATE TABLE IF NOT EXISTS radiology_institutional_styles (
        id SERIAL PRIMARY KEY,
        preset_name TEXT NOT NULL DEFAULT 'Care Diagnostics Default',
        section_order TEXT NOT NULL DEFAULT 'Technique,Findings,Impression',
        show_clinical_history BOOLEAN NOT NULL DEFAULT TRUE,
        show_comparison BOOLEAN NOT NULL DEFAULT TRUE,
        show_recommendation BOOLEAN NOT NULL DEFAULT TRUE,
        show_critical_communication BOOLEAN NOT NULL DEFAULT TRUE,
        show_measurements BOOLEAN NOT NULL DEFAULT TRUE,
        heading_style TEXT NOT NULL DEFAULT 'underlined',
        abnormal_emphasis TEXT NOT NULL DEFAULT 'bold_abnormal',
        spacing TEXT NOT NULL DEFAULT 'standard',
        print_layout TEXT NOT NULL DEFAULT 'letterhead',
        margins TEXT NOT NULL DEFAULT 'standard',
        font_size TEXT NOT NULL DEFAULT 'standard',
        show_radiologist_name BOOLEAN NOT NULL DEFAULT TRUE,
        show_degree BOOLEAN NOT NULL DEFAULT TRUE,
        show_reg_number BOOLEAN NOT NULL DEFAULT TRUE,
        show_digital_signature BOOLEAN NOT NULL DEFAULT TRUE,
        show_timestamp BOOLEAN NOT NULL DEFAULT TRUE,
        show_qr_verification BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO radiology_institutional_styles (
        id, preset_name, section_order, show_clinical_history, show_comparison,
        show_recommendation, show_critical_communication, show_measurements,
        heading_style, abnormal_emphasis, spacing, print_layout, margins, font_size,
        show_radiologist_name, show_degree, show_reg_number, show_digital_signature,
        show_timestamp, show_qr_verification
      ) VALUES (
        1, 'Care Diagnostics Default', 'Technique,Findings,Impression', true, true,
        true, true, true, 'underlined', 'bold_abnormal', 'standard', 'letterhead', 'standard', 'standard',
        true, true, true, true, true, true
      ) ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS pacs_settings (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT,
        category TEXT NOT NULL DEFAULT 'general',
        is_secret BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(key, category)
      );
      CREATE TABLE IF NOT EXISTS dicom_modalities (
        id SERIAL PRIMARY KEY,
        machine_name TEXT NOT NULL,
        modality TEXT,
        ae_title TEXT,
        ip_address TEXT,
        port INTEGER,
        location TEXT,
        auto_send_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_connection_status TEXT,
        last_seen_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pacs_logs (
        id SERIAL PRIMARY KEY,
        log_type TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        source TEXT,
        event_type TEXT,
        message TEXT NOT NULL,
        study_instance_uid TEXT,
        accession_number TEXT,
        patient_id TEXT,
        modality TEXT,
        payload TEXT,
        error_stack TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS audit_runs (
        id SERIAL PRIMARY KEY,
        period_from TEXT NOT NULL,
        period_to TEXT NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        completed_by TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        notes TEXT,
        anomaly_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        total_impact NUMERIC(14,2) NOT NULL DEFAULT 0,
        snapshot JSONB NOT NULL,
        email_sent_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS audit_runs_generated_at_idx ON audit_runs(generated_at DESC);
      -- Belt-and-suspenders dedupe: even if two cron processes (or a process
      -- restart loop) both try to fire the same monthly audit, the DB itself
      -- guarantees only one cron-source row per (period_from, period_to).
      -- Manual audits intentionally can repeat for the same period.
      CREATE UNIQUE INDEX IF NOT EXISTS audit_runs_cron_unique_idx
        ON audit_runs(period_from, period_to) WHERE source = 'cron';

      -- ── Floors / Rooms / Modalities (Location master) ───────────────────
      CREATE TABLE IF NOT EXISTS floors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL DEFAULT '',
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL DEFAULT '',
        floor_id INTEGER REFERENCES floors(id) ON DELETE SET NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS modalities (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL DEFAULT '',
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS room_id INTEGER;
      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS modality_id INTEGER;
      ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS floor_label TEXT NOT NULL DEFAULT '';

      -- Phase 5: AI Quality Scores (computed metrics from radiologist feedback)
      CREATE TABLE IF NOT EXISTS ai_quality_scores (
        id SERIAL PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_key TEXT,
        date_from TIMESTAMPTZ NOT NULL,
        date_to TIMESTAMPTZ NOT NULL,
        total_drafts INTEGER NOT NULL DEFAULT 0,
        total_with_feedback INTEGER NOT NULL DEFAULT 0,
        helpful_count INTEGER NOT NULL DEFAULT 0,
        needs_improvement_count INTEGER NOT NULL DEFAULT 0,
        inaccurate_count INTEGER NOT NULL DEFAULT 0,
        helpful_rate REAL NOT NULL DEFAULT 0,
        quality_score REAL NOT NULL DEFAULT 0,
        avg_turnaround_minutes REAL,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_qs_scope_key_idx ON ai_quality_scores(scope, scope_key);
      CREATE INDEX IF NOT EXISTS ai_qs_date_idx ON ai_quality_scores(date_from, date_to);
      CREATE INDEX IF NOT EXISTS ai_qs_computed_idx ON ai_quality_scores(computed_at DESC);

      -- Phase 3: AI-Powered DICOM Findings
      CREATE TABLE IF NOT EXISTS ai_dicom_findings (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER NOT NULL,
        study_instance_uid TEXT,
        accession_number TEXT,
        modality TEXT,
        body_part TEXT,
        study_description TEXT,
        suggested_findings TEXT,
        suggested_impression TEXT,
        confidence_score REAL,
        ai_safety_label TEXT NOT NULL DEFAULT 'AI Draft – Requires Radiologist Review',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_id INTEGER,
        reviewed_by_name TEXT,
        reviewed_at TIMESTAMPTZ,
        reviewed_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_dicom_findings_wl_idx ON ai_dicom_findings(worklist_id);
      CREATE INDEX IF NOT EXISTS ai_dicom_findings_uid_idx ON ai_dicom_findings(study_instance_uid);
      CREATE INDEX IF NOT EXISTS ai_dicom_findings_status_idx ON ai_dicom_findings(status);

      -- Phase 9: RAG Vector Store (document embeddings)
      CREATE TABLE IF NOT EXISTS rag_document_embeddings (
        id SERIAL PRIMARY KEY,
        document_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        embedding_dimension INTEGER DEFAULT 384,
        modality TEXT,
        patient_id INTEGER,
        study_id INTEGER,
        source_url TEXT,
        source_title TEXT,
        search_count INTEGER NOT NULL DEFAULT 0,
        last_searched_at TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rag_doc_doc_id_idx ON rag_document_embeddings(document_id);
      CREATE INDEX IF NOT EXISTS rag_doc_type_idx ON rag_document_embeddings(document_type);
      CREATE INDEX IF NOT EXISTS rag_doc_modality_idx ON rag_document_embeddings(modality);
      CREATE INDEX IF NOT EXISTS rag_doc_patient_idx ON rag_document_embeddings(patient_id);

      -- Phase 10: RAG Search Queries log
      CREATE TABLE IF NOT EXISTS rag_search_queries (
        id SERIAL PRIMARY KEY,
        query_text TEXT NOT NULL,
        embedding TEXT,
        top_k INTEGER NOT NULL DEFAULT 5,
        results_json TEXT,
        user_id INTEGER,
        user_name TEXT,
        duration_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rag_search_query_idx ON rag_search_queries(query_text);
      CREATE INDEX IF NOT EXISTS rag_search_user_idx ON rag_search_queries(user_id);

      -- Phase 7: Anomaly Detection / Alerting
      CREATE TABLE IF NOT EXISTS anomaly_alerts (
        id SERIAL PRIMARY KEY,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        message TEXT NOT NULL,
        scope TEXT,
        related_id INTEGER,
        related_table TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        acknowledged_by_id INTEGER,
        acknowledged_by_name TEXT,
        acknowledged_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS anomaly_alert_type_idx ON anomaly_alerts(alert_type);
      CREATE INDEX IF NOT EXISTS anomaly_alert_severity_idx ON anomaly_alerts(severity);
      CREATE INDEX IF NOT EXISTS anomaly_alert_status_idx ON anomaly_alerts(status);
      CREATE INDEX IF NOT EXISTS anomaly_alert_scope_idx ON anomaly_alerts(scope, related_id);

      -- Phase 15: Report Template Versioning
      CREATE TABLE IF NOT EXISTS report_template_versions (
        id SERIAL PRIMARY KEY,
        template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        name TEXT NOT NULL,
        created_by_id INTEGER,
        created_by_name TEXT,
        change_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rtv_template_idx ON report_template_versions(template_id);
      CREATE INDEX IF NOT EXISTS rtv_version_idx ON report_template_versions(template_id, version);

      -- Phase 16: AI Billing Code Suggestions
      CREATE TABLE IF NOT EXISTS ai_billing_suggestions (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER NOT NULL,
        report_id INTEGER,
        cpt_codes TEXT,
        icd_codes TEXT,
        overall_confidence REAL,
        ai_safety_label TEXT NOT NULL DEFAULT 'AI Draft – Requires Radiologist Review',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_id INTEGER,
        reviewed_by_name TEXT,
        reviewed_at TIMESTAMPTZ,
        reviewed_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_billing_wl_idx ON ai_billing_suggestions(worklist_id);
      CREATE INDEX IF NOT EXISTS ai_billing_status_idx ON ai_billing_suggestions(status);

      -- Phase 17: Peer Review Assignments
      CREATE TABLE IF NOT EXISTS peer_review_assignments (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL,
        worklist_id INTEGER,
        assigned_to_id INTEGER NOT NULL,
        assigned_to_name TEXT,
        assigned_by_id INTEGER,
        assigned_by_name TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'pending',
        ai_confidence_score INTEGER,
        auto_assigned_reason TEXT,
        completed_at TIMESTAMPTZ,
        completed_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pra_report_idx ON peer_review_assignments(report_id);
      CREATE INDEX IF NOT EXISTS pra_assignee_idx ON peer_review_assignments(assigned_to_id, status);
      CREATE INDEX IF NOT EXISTS pra_status_idx ON peer_review_assignments(status);

      -- Phase 18: Turnaround Time Analytics
      CREATE TABLE IF NOT EXISTS turnaround_times (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER NOT NULL,
        study_id INTEGER,
        modality TEXT,
        radiologist_id INTEGER,
        radiologist_name TEXT,
        minutes_to_report REAL,
        minutes_to_first_review REAL,
        minutes_to_peer_review REAL,
        date_bucket TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS tat_wl_idx ON turnaround_times(worklist_id);
      CREATE INDEX IF NOT EXISTS tat_date_idx ON turnaround_times(date_bucket);
      CREATE INDEX IF NOT EXISTS tat_modality_idx ON turnaround_times(modality, date_bucket);
      CREATE INDEX IF NOT EXISTS tat_rad_idx ON turnaround_times(radiologist_id, date_bucket);

      -- Phase 19: AI Training Data Export
      CREATE TABLE IF NOT EXISTS ai_training_data_exports (
        id SERIAL PRIMARY KEY,
        export_name TEXT NOT NULL,
        modality TEXT,
        date_from TEXT,
        date_to TEXT,
        min_quality_score INTEGER,
        records_count INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        file_path TEXT,
        exported_by_id INTEGER,
        exported_by_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS tde_status_idx ON ai_training_data_exports(status);
      CREATE INDEX IF NOT EXISTS tde_name_idx ON ai_training_data_exports(export_name);

      -- Phase 20: Report Quality Gates
      CREATE TABLE IF NOT EXISTS report_quality_gates (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL UNIQUE,
        findings_present BOOLEAN NOT NULL DEFAULT FALSE,
        impression_present BOOLEAN NOT NULL DEFAULT FALSE,
        signature_present BOOLEAN NOT NULL DEFAULT FALSE,
        clinical_history_present BOOLEAN NOT NULL DEFAULT FALSE,
        technique_present BOOLEAN NOT NULL DEFAULT FALSE,
        comparison_present BOOLEAN NOT NULL DEFAULT FALSE,
        all_passed BOOLEAN NOT NULL DEFAULT FALSE,
        failed_checks TEXT,
        passed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rqg_report_idx ON report_quality_gates(report_id);
      CREATE INDEX IF NOT EXISTS rqg_passed_idx ON report_quality_gates(all_passed);

      -- Phase 21: Critical Finding Escalation
      CREATE TABLE IF NOT EXISTS critical_findings (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL,
        worklist_id INTEGER,
        patient_id INTEGER,
        finding_keywords TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'high',
        status TEXT NOT NULL DEFAULT 'pending_notification',
        notified_at TIMESTAMPTZ,
        notified_to TEXT,
        notification_method TEXT,
        escalation_reason TEXT,
        escalated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS cf_report_idx ON critical_findings(report_id);
      CREATE INDEX IF NOT EXISTS cf_status_idx ON critical_findings(status);
      CREATE INDEX IF NOT EXISTS cf_patient_idx ON critical_findings(patient_id);

      -- Phase 22: AI Provider Health Monitor
      CREATE TABLE IF NOT EXISTS ai_provider_health_logs (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        endpoint_url TEXT,
        model TEXT,
        latency_ms INTEGER,
        status TEXT NOT NULL,
        status_code INTEGER,
        error_message TEXT,
        is_success BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS aphl_provider_idx ON ai_provider_health_logs(provider);
      CREATE INDEX IF NOT EXISTS aphl_status_idx ON ai_provider_health_logs(status);
      CREATE INDEX IF NOT EXISTS aphl_created_idx ON ai_provider_health_logs(created_at);

      -- Phase 24: AI Voice-to-Text Transcription
      CREATE TABLE IF NOT EXISTS ai_voice_transcriptions (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        report_id INTEGER,
        patient_id INTEGER,
        radiologist_id INTEGER,
        radiologist_name TEXT,
        audio_url TEXT,
        audio_duration_seconds REAL,
        raw_transcript TEXT,
        confidence_score REAL,
        corrected_text TEXT,
        inserted_into_report BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'pending',
        modality TEXT,
        body_part TEXT,
        ai_safety_label TEXT NOT NULL DEFAULT 'AI Draft – Requires Radiologist Review',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS avt_worklist_idx ON ai_voice_transcriptions(worklist_id);
      CREATE INDEX IF NOT EXISTS avt_report_idx ON ai_voice_transcriptions(report_id);
      CREATE INDEX IF NOT EXISTS avt_rad_idx ON ai_voice_transcriptions(radiologist_id);
      CREATE INDEX IF NOT EXISTS avt_status_idx ON ai_voice_transcriptions(status);
      CREATE INDEX IF NOT EXISTS avt_created_idx ON ai_voice_transcriptions(created_at);

      -- Phase 25: AI Patient Communication Assistant
      CREATE TABLE IF NOT EXISTS ai_patient_communications (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        report_id INTEGER,
        patient_id INTEGER,
        communication_type TEXT NOT NULL DEFAULT 'result_summary',
        language TEXT NOT NULL DEFAULT 'en',
        original_text TEXT,
        ai_draft TEXT,
        ai_safety_label TEXT NOT NULL DEFAULT 'AI Draft – Requires Radiologist Review',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_id INTEGER,
        reviewed_by_name TEXT,
        reviewed_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        sent_by_id INTEGER,
        sent_by_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS apc_patient_idx ON ai_patient_communications(patient_id);
      CREATE INDEX IF NOT EXISTS apc_status_idx ON ai_patient_communications(status);
      CREATE INDEX IF NOT EXISTS apc_type_idx ON ai_patient_communications(communication_type);
      CREATE INDEX IF NOT EXISTS apc_created_idx ON ai_patient_communications(created_at);

      -- Phase 26: One-Click Normal Report Templates
      CREATE TABLE IF NOT EXISTS ai_normal_report_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        modality TEXT NOT NULL,
        body_part TEXT,
        category TEXT NOT NULL DEFAULT 'normal',
        findings TEXT NOT NULL,
        impression TEXT NOT NULL,
        technique TEXT,
        clinical_history TEXT,
        comparison TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE ai_normal_report_templates ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'normal';
      CREATE INDEX IF NOT EXISTS anrt_modality_idx ON ai_normal_report_templates(modality);
      CREATE INDEX IF NOT EXISTS anrt_sort_idx ON ai_normal_report_templates(sort_order);
      CREATE INDEX IF NOT EXISTS anrt_category_idx ON ai_normal_report_templates(category);
      CREATE UNIQUE INDEX IF NOT EXISTS anrt_name_modality_uq ON ai_normal_report_templates(name, modality);

      -- Seed default report templates (idempotent) -- Phase 27: Expanded to pathology, trauma, screening
      INSERT INTO ai_normal_report_templates (name, modality, body_part, category, findings, impression, technique, sort_order)
      VALUES
        ('MRI Brain – Normal', 'MRI', 'brain', 'normal',
         'Brain parenchyma shows normal signal intensity on all sequences. No evidence of acute infarction, hemorrhage, or mass lesion. Ventricles are normal in size and configuration. No midline shift. No abnormal enhancement. Grey-white matter differentiation is preserved. No restricted diffusion. No blooming on GRE/SWI. Major intracranial vessels show normal flow voids.',
         'Normal MRI brain.',
         'MRI brain performed on 1.5T/3T scanner with T1, T2, FLAIR, DWI, and post-contrast sequences.', 1),
        ('MRI Brain – Senile Changes with Fazekas Grade 1', 'MRI', 'brain', 'pathology',
         'Multiple small punctate hyperintense foci seen in the periventricular and deep white matter on T2/FLAIR sequences, consistent with chronic small vessel ischemic changes (Fazekas Grade 1). No acute infarct. No mass lesion. Ventricles mildly prominent for age. No midline shift. No abnormal enhancement.',
         'Age-related white matter changes (Fazekas Grade 1). No acute pathology.',
         'MRI brain on 1.5T/3T with T1, T2, FLAIR, DWI, GRE/SWI, and post-contrast sequences.', 2),
        ('MRI Brain – Screening Cervical Spine Normal', 'MRI', 'brain', 'screening',
         'Brain: Normal signal intensity on all sequences. No acute infarct, hemorrhage, or mass lesion. Ventricles normal. No midline shift.\nCervical Spine: Normal alignment. Vertebral bodies show normal height and signal. Intervertebral discs maintain normal height. Spinal canal is capacious at all levels. No cord signal abnormality. No ligamentous injury.',
         'Normal MRI brain. Normal cervical spine screening.',
         'MRI brain with cervical spine screening on 1.5T/3T scanner.', 3),
        ('MRI Brain – Neurocysticercosis', 'MRI', 'brain', 'pathology',
         'Multiple cystic lesions seen in the cerebral parenchyma, bilateral cerebral hemispheres, and basal ganglia. Lesions show scolex on T2/FLAIR. Ring enhancement on post-contrast T1 in vesicular and colloidal stages. Surrounding edema in colloidal stage lesions. No hydrocephalus. No midline shift. Ventricles normal.',
         'Multiple intracranial neurocysticercosis lesions in various stages (vesicular, colloidal, calcified).',
         'MRI brain on 1.5T/3T with T1, T2, FLAIR, DWI, and post-contrast sequences.', 4),
        ('MRI Brain – Stroke Acute Infarct', 'MRI', 'brain', 'pathology',
         'Acute infarct seen in the right MCA territory involving the right frontal and parietal lobes. Bright signal on DWI with corresponding low ADC values. No significant mass effect. Mild sulcal effacement. No hemorrhagic transformation. MRA shows segmental occlusion of the right M1 segment. Rest of the brain parenchyma normal.',
         'Acute infarct in right MCA territory. Right M1 occlusion on MRA.',
         'MRI brain with DWI, MRA, and post-contrast sequences on 1.5T/3T scanner.', 5),
        ('MRI Cervical Spine – Normal', 'MRI', 'cervical spine', 'normal',
         'Normal cervical lordosis. Vertebral bodies show normal height, alignment, and marrow signal. Intervertebral discs show normal height and signal (C2-C7). No disc herniation. Spinal canal is capacious at all levels (AP diameter >13 mm). No cord signal abnormality. No ligamentous injury. No prevertebral soft tissue swelling. Foraminal spaces are patent bilaterally.',
         'Normal MRI cervical spine.',
         'MRI cervical spine on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 10),
        ('MRI Cervical Spine – Whole Spine Screening', 'MRI', 'cervical spine', 'screening',
         'Cervical: Normal alignment. Discs normal. Canal capacious. No cord signal abnormality.\nDorsal: Normal alignment. Discs normal. No cord signal abnormality. No syrinx.\nLumbar: Normal alignment. Discs normal. No canal stenosis. No nerve root compression. Conus medullaris at L1 level.',
         'Normal whole spine screening (cervical, dorsal, lumbar).',
         'Whole spine MRI screening on 1.5T/3T scanner.', 11),
        ('MRI Cervical Spine – Disc Prolapse', 'MRI', 'cervical spine', 'pathology',
         'Posterior disc herniation at C5-C6 level with bilateral foraminal narrowing. Spinal canal AP diameter reduced to 9 mm at C5-C6 with moderate cord compression. T2 hyperintense signal within the cord at C5-C6 level suggestive of myelomalacia. Mild disc bulge at C4-C5. Rest of the discs show normal height and signal.',
         'C5-C6 disc herniation with moderate canal stenosis and cord signal change.',
         'MRI cervical spine on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 12),
        ('MRI LS Spine – Normal', 'MRI', 'lumbar spine', 'normal',
         'Normal lumbar lordosis. Vertebral bodies show normal height and marrow signal. Intervertebral discs show normal height and signal (L1-L5). No disc herniation. Spinal canal is capacious at all levels (AP diameter >12 mm). No cord signal abnormality. Conus medullaris at L1 level. No nerve root compression. Foraminal spaces are patent bilaterally. No spondylolisthesis.',
         'Normal MRI LS spine.',
         'MRI LS spine on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 20),
        ('MRI LS Spine – Whole Spine Screening', 'MRI', 'lumbar spine', 'screening',
         'Cervical: Normal alignment. Discs normal. Canal capacious. No cord signal abnormality.\nDorsal: Normal alignment. Discs normal. No cord signal abnormality. No syrinx.\nLumbar: Normal alignment. Discs normal. No canal stenosis. No nerve root compression. Conus medullaris at L1 level.',
         'Normal whole spine screening (cervical, dorsal, lumbar).',
         'Whole spine MRI screening on 1.5T/3T scanner.', 21),
        ('MRI LS Spine – Koch''s TB (Pott Spine)', 'MRI', 'lumbar spine', 'pathology',
         'L1-L2 vertebral bodies show T1 hypointense and T2 hyperintense signal with loss of disc height. Paravertebral cold abscess measuring approximately 4.2 x 2.8 cm. Epidural extension causing mild thecal sac compression. Involvement of posterior elements. Post-contrast shows heterogeneous enhancement of affected vertebral bodies and abscess wall. No cord signal abnormality.',
         'L1-L2 spondylodiscitis with paravertebral abscess, consistent with Koch''s spine (Pott disease).',
         'MRI LS spine with whole spine screening on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 22),
        ('MRI LS Spine – Fracture Trauma', 'MRI', 'lumbar spine', 'trauma',
         'L2 vertebral body shows compression fracture with anterior wedge deformity (loss of anterior height ~40%). T2 hyperintense signal within the vertebral body consistent with marrow edema. Retropulsion of posterior superior cortex into spinal canal with mild canal compromise. No cord signal abnormality. Interspinous ligament injury at L1-L2. Prevertebral soft tissue edema.',
         'L2 compression fracture with mild canal compromise. Interspinous ligament injury at L1-L2.',
         'MRI LS spine on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 23),
        ('MRI LS Spine – Disc Herniation with Radiculopathy', 'MRI', 'lumbar spine', 'pathology',
         'L4-L5: Large posterolateral disc herniation with left S1 nerve root compression. Left neural foramen stenosis.\nL5-S1: Broad-based disc bulge with bilateral foraminal narrowing.\nSpinal canal AP diameter at L4-L5 reduced to 8 mm. No cord signal abnormality. Conus at L1. Ligamentum flavum hypertrophy at L4-L5.',
         'L4-L5 disc herniation with left S1 radiculopathy. L5-S1 disc bulge with bilateral foraminal stenosis.',
         'MRI LS spine on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 24),
        ('MRI LS Spine – Spondylolisthesis', 'MRI', 'lumbar spine', 'pathology',
         'Grade 2 anterolisthesis of L4 over L5. Bilateral pars interarticularis defects (lytic) at L4. Degenerative disc disease at L4-L5 with disc space narrowing and loss of T2 signal. Spinal canal stenosis at L4-L5 with bilateral L5 nerve root compression. No cord signal abnormality.',
         'L4 spondylolisthesis Grade 2 with bilateral pars defects and L4-L5 canal stenosis.',
         'MRI LS spine on 1.5T/3T with T1, T2, STIR, and post-contrast sequences.', 25),
        ('MRI Brain with Contrast – Normal', 'MRI', 'brain', 'contrast',
         'Brain parenchyma shows normal signal intensity on all sequences. No evidence of mass lesion, abscess, or demyelinating plaque. Ventricles normal. No midline shift. No abnormal enhancement on post-contrast T1. No dural enhancement. No leptomeningeal enhancement. Pituitary gland normal. Optic nerves and chiasm normal.',
         'Normal contrast-enhanced MRI brain.',
         'Contrast-enhanced MRI brain on 1.5T/3T with T1, T2, FLAIR, DWI, and post-gadolinium sequences.', 30),
        ('MRI Brain with Contrast – Metastases', 'MRI', 'brain', 'pathology',
         'Multiple ring-enhancing lesions seen in bilateral cerebral hemispheres, cerebellum, and basal ganglia. Largest lesion in the right frontal lobe measuring 2.1 x 1.8 cm with surrounding vasogenic edema. No hemorrhage. No hydrocephalus. Enhancing dural-based lesion along the left parietal convexity. No midline shift.',
         'Multiple intracranial metastases with ring enhancement. Dural-based metastasis.',
         'Contrast-enhanced MRI brain on 1.5T/3T with T1, T2, FLAIR, DWI, and post-gadolinium sequences.', 31),
        ('MRI Brain with Contrast – Meningitis', 'MRI', 'brain', 'pathology',
         'Diffuse leptomeningeal enhancement along the cerebral convexities, basal cisterns, and Sylvian fissures. Mild hydrocephalus with ventriculomegaly. No intraparenchymal abscess. No venous sinus thrombosis. No mass lesion. No midline shift.',
         'Diffuse leptomeningeal enhancement consistent with meningitis. Mild hydrocephalus.',
         'Contrast-enhanced MRI brain on 1.5T/3T with T1, T2, FLAIR, DWI, and post-gadolinium sequences.', 32),
        ('CT Brain – Normal', 'CT', 'brain', 'normal',
         'Normal grey-white matter differentiation. No acute intracranial hemorrhage. No evidence of acute infarction. Ventricles are normal in size and configuration. No midline shift. Basal cisterns are patent. Calvarium and skull base show intact cortical margins. No fracture.',
         'Normal CT brain.',
         'NCCT brain performed on multi-detector CT scanner.', 40),
        ('CT Brain – Trauma (EDH + SDH)', 'CT', 'brain', 'trauma',
         'Right temporoparietal extra-axial biconvex hyperdense collection consistent with acute epidural hematoma measuring 1.8 cm in maximum thickness. Left frontoparietal crescentic hyperdense collection consistent with acute subdural hematoma measuring 0.9 cm in thickness. 4 mm midline shift to the left. Right temporal bone fracture line. Right temporal lobe contusion.',
         'Right acute EDH. Left acute SDH. 4 mm midline shift. Right temporal bone fracture.',
         'NCCT brain performed on multi-detector CT scanner.', 41),
        ('CT Brain – Hemorrhagic Stroke', 'CT', 'brain', 'pathology',
         'Large acute intraparenchymal hemorrhage in the left basal ganglia/thalamic region measuring approximately 4.5 x 3.2 x 3.8 cm with surrounding edema. Blood extends into the left lateral ventricle. Mild hydrocephalus. 3 mm midline shift to the right. No calvarial fracture. No extra-axial collection.',
         'Left basal ganglia/thalamic hemorrhage with intraventricular extension. Mild hydrocephalus with 3 mm shift.',
         'NCCT brain performed on multi-detector CT scanner.', 42),
        ('CT Brain – Ischemic Stroke (Early Changes)', 'CT', 'brain', 'pathology',
         'Loss of grey-white matter differentiation in the right insular ribbon and basal ganglia. Hyperdense right MCA sign (dense vessel sign). Mild sulcal effacement in the right MCA territory. No hemorrhage. No mass effect. No midline shift. Ventricles normal.',
         'Early ischemic changes in right MCA territory. Hyperdense right MCA sign.',
         'NCCT brain performed on multi-detector CT scanner.', 43),
        ('CT Chest – Normal', 'CT', 'chest', 'normal',
         'Normal lung parenchyma bilaterally. No nodules, masses, or consolidation. No pleural effusion. No pneumothorax. Hilar and mediastinal lymph nodes are within normal size limits. Heart size normal. No pericardial effusion. Visualized upper abdomen unremarkable.',
         'Normal CT chest.',
         'CECT chest performed on multi-detector CT scanner.', 50),
        ('CT Chest – COVID-19 Pneumonia', 'CT', 'chest', 'pathology',
         'Bilateral peripheral and subpleural ground-glass opacities predominantly in the lower lobes. Crazy-paving pattern in bilateral lower lobes. Mild interlobular septal thickening. No significant pleural effusion. No pneumothorax. Hilar and mediastinal nodes within normal size. CORADS 5.',
         'Bilateral COVID-19 pneumonia (CORADS 5) with ground-glass opacities and crazy-paving pattern.',
         'HRCT chest performed on multi-detector CT scanner.', 51),
        ('CT Chest – Pulmonary Embolism', 'CT', 'chest', 'pathology',
         'Filling defects in the bilateral main pulmonary arteries extending into the lobar and segmental branches. Right heart strain with RV dilatation (RV/LV ratio >1). No pneumothorax. Small bilateral pleural effusions. No lung parenchymal consolidation.',
         'Bilateral pulmonary embolism with right heart strain.',
         'CT pulmonary angiography (CTPA) on multi-detector CT scanner.', 52),
        ('CT Abdomen – Normal', 'CT', 'abdomen', 'normal',
         'Liver: Normal size, contour, and attenuation. No focal lesions.\nGallbladder: Normal wall thickness. No stones.\nSpleen: Normal size and attenuation.\nPancreas: Normal size and attenuation. No duct dilatation.\nKidneys: Normal size and attenuation. No hydronephrosis. No stones.\nAdrenals: Normal.\nBowel: No obstruction. No free fluid.\nNo lymphadenopathy. No free air.',
         'Normal CT abdomen.',
         'CECT abdomen performed on multi-detector CT scanner.', 60),
        ('CT Abdomen – Acute Pancreatitis', 'CT', 'abdomen', 'pathology',
         'Pancreas: Enlarged, edematous pancreas with peripancreatic fat stranding. Fluid collections in the lesser sac and peripancreatic region. Balthazar Grade C. No necrosis.\nGallbladder: Small stone in the gallbladder neck.\nLiver: Normal.\nSpleen: Normal.\nKidneys: Normal.\nBowel: No obstruction.',
         'Acute pancreatitis (Balthazar Grade C). Gallbladder stone.',
         'CECT abdomen performed on multi-detector CT scanner.', 61),
        ('CT Abdomen – Liver Abscess', 'CT', 'abdomen', 'pathology',
         'Large hypodense lesion in the right lobe of liver (segment V/VI) measuring 5.2 x 4.1 x 4.5 cm with peripheral rim enhancement. No gas within the abscess. Mild perihepatic fluid. Rest of the liver parenchyma normal. No biliary dilatation. Gallbladder normal. Spleen normal. No lymphadenopathy.',
         'Right lobe liver abscess (segment V/VI) with rim enhancement.',
         'CECT abdomen performed on multi-detector CT scanner.', 62),
        ('CT KUB – Normal', 'CT', 'kidney ureter bladder', 'normal',
         'Both kidneys normal in size and attenuation. No hydronephrosis. No renal calculi. Ureters are normal caliber throughout. Bladder is well-distended with normal wall thickness. No intraluminal filling defect. Prostate normal in size. No pelvic lymphadenopathy. No free fluid.',
         'Normal CT KUB.',
         'NCCT KUB performed on multi-detector CT scanner.', 70),
        ('CT KUB – Right Renal Calculus with Hydronephrosis', 'CT', 'kidney ureter bladder', 'pathology',
         'Right kidney: 1.2 cm calculus in the right renal pelvis with moderate hydronephrosis (calyceal dilatation). 6 mm calculus in the right proximal ureter at the level of L3 with proximal ureteric dilatation. Perinephric fat stranding.\nLeft kidney: Normal. No calculi. No hydronephrosis.\nBladder: Normal.\nProstate: Normal.',
         'Right renal pelvis calculus (1.2 cm) with moderate hydronephrosis. Right proximal ureteric calculus (6 mm).',
         'NCCT KUB performed on multi-detector CT scanner.', 71),
        ('CT KUB – Bilateral Renal Stones', 'CT', 'kidney ureter bladder', 'pathology',
         'Right kidney: Multiple renal calculi (largest 8 mm in lower pole). Mild hydronephrosis.\nLeft kidney: Multiple renal calculi (largest 6 mm in upper pole). Mild hydronephrosis.\nNo ureteric calculi.\nBladder: Normal. No vesical calculus.\nProstate: Normal.',
         'Bilateral renal calculi with mild hydronephrosis.',
         'NCCT KUB performed on multi-detector CT scanner.', 72),
        ('USG Abdomen – Normal', 'USG', 'abdomen', 'normal',
         'Liver: Normal size, echotexture, and outline. No focal lesions. Portal vein normal.\nGallbladder: Normal size and wall thickness. No stones. No sludge.\nSpleen: Normal size and echotexture.\nPancreas: Normal size and echotexture. No duct dilatation.\nKidneys: Normal size and corticomedullary differentiation. No hydronephrosis. No stones.\nBladder: Normal wall thickness. No mass. No stone.\nProstate: Normal size. No nodules.\nNo ascites. No lymphadenopathy.',
         'Normal USG abdomen.',
         'USG abdomen performed with convex probe (3.5-5 MHz).', 80),
        ('USG Abdomen – Fatty Liver Grade 2', 'USG', 'abdomen', 'pathology',
         'Liver: Enlarged (span 16 cm). Diffusely increased echotexture with increased attenuation. Portal vein walls poorly visualized. Liver echotexture brighter than renal cortex. Grade 2 fatty liver.\nGallbladder: Normal.\nSpleen: Normal.\nPancreas: Normal.\nKidneys: Normal.\nBladder: Normal.\nProstate: Normal.\nNo ascites.',
         'Grade 2 fatty liver.',
         'USG abdomen performed with convex probe (3.5-5 MHz).', 81),
        ('USG Abdomen – Liver Cirrhosis with Ascites', 'USG', 'abdomen', 'pathology',
         'Liver: Small, shrunken liver with coarse echotexture and nodular surface. Surface nodularity on high-frequency probe. Portal vein dilated (13 mm). Splenic vein dilated (10 mm).\nGallbladder: Wall thickened.\nSpleen: Enlarged (14 cm).\nAscites: Moderate ascites in perihepatic, perisplenic, and pelvic regions.\nNo focal liver lesion.',
         'Liver cirrhosis with portal hypertension, splenomegaly, and moderate ascites.',
         'USG abdomen performed with convex probe (3.5-5 MHz).', 82),
        ('USG KUB – Normal', 'USG', 'kidney ureter bladder', 'normal',
         'Right kidney: Normal size (10.5 cm), corticomedullary differentiation preserved. No hydronephrosis. No calculi.\nLeft kidney: Normal size (10.2 cm), corticomedullary differentiation preserved. No hydronephrosis. No calculi.\nUreters: Not dilated. No calculi.\nBladder: Well-distended. Normal wall thickness. No mass. No stone. No debris.\nProstate: Normal size (approx 20 cc). No nodules.\nNo free fluid.',
         'Normal USG KUB.',
         'USG KUB performed with convex probe (3.5-5 MHz).', 90),
        ('USG KUB – Right Hydronephrosis with Stone', 'USG', 'kidney ureter bladder', 'pathology',
         'Right kidney: Moderate hydronephrosis with calyceal dilatation. 12 mm echogenic focus with posterior acoustic shadowing in the renal pelvis. Cortical thinning noted.\nLeft kidney: Normal.\nRight ureter: Dilated proximal ureter (8 mm) with 6 mm stone at the VUJ.\nLeft ureter: Normal.\nBladder: Normal.\nProstate: Normal.',
         'Right hydronephrosis with renal pelvis calculus (12 mm). Right VUJ stone (6 mm).',
         'USG KUB performed with convex probe (3.5-5 MHz).', 91),
        ('USG KUB – Prostate Enlargement (BPH)', 'USG', 'kidney ureter bladder', 'pathology',
         'Prostate: Enlarged (approx 45 cc). Transitional zone enlargement with heterogeneous echotexture. Intravesical protrusion. Post-void residual urine 80 ml.\nBladder: Wall thickened (trabeculated). Small diverticulum.\nBoth kidneys: Normal. No hydronephrosis.\nNo ureteric dilatation.',
         'Benign prostatic hyperplasia (approx 45 cc) with post-void residual.',
         'USG KUB performed with convex probe (3.5-5 MHz).', 92),
        ('USG Pregnancy Anomaly Scan – Normal', 'USG', 'fetus', 'normal',
         'Single live intrauterine fetus in cephalic presentation.\nBiometry: BPD, HC, AC, FL correspond to gestational age. EFW appropriate.\nHead: Intact cranium. Normal ventricles. Normal posterior fossa.\nSpine: Intact vertebral column. No open defects.\nHeart: Four-chamber view normal. Great vessels normal.\nAbdomen: Stomach bubble present. Normal kidneys. Normal bladder.\nExtremities: All four limbs present.\nPlacenta: Anterior, Grade II. Not low-lying.\nLiquor: Normal AFI.\nNo gross anomalies.',
         'Normal anomaly scan. Single live intrauterine fetus in cephalic presentation.',
         'Anomaly scan performed with convex probe (3.5-5 MHz).', 100),
        ('USG Pregnancy – IUGR with Oligohydramnios', 'USG', 'fetus', 'pathology',
         'Single live intrauterine fetus in cephalic presentation.\nBiometry: All parameters below 10th centile for gestational age. EFW below 10th centile.\nUterine artery Doppler: Bilateral notching.\nUmbilical artery: Raised PI (1.5). End-diastolic flow present.\nMCA: Reduced PI.\nAmniotic fluid: AFI 5 cm (oligohydramnios).\nPlacenta: Grade III. No calcifications.\nNo gross structural anomalies.',
         'Intrauterine growth restriction (IUGR) with oligohydramnios. Uterine artery notching.',
         'Anomaly scan with Doppler performed with convex probe (3.5-5 MHz).', 101),
        ('X-Ray Chest PA – Normal', 'X-Ray', 'chest', 'normal',
         'Both lung fields are clear. No focal opacities. No consolidation. No pleural effusion. No pneumothorax. Cardiothoracic ratio is within normal limits. Hilar shadows are normal. Diaphragm contours are smooth. Costophrenic angles are sharp. Bony thorax is intact. No fracture.',
         'Normal chest X-ray.',
         'Chest PA view performed on digital radiography system.', 110),
        ('X-Ray Chest PA – Tuberculosis (PTB)', 'X-Ray', 'chest', 'pathology',
         'Right upper lobe: Fibrocavitary lesion with surrounding fibrosis. Volume loss.\nLeft upper lobe: Fibrotic streaks and nodular opacities.\nBilateral apical pleural thickening.\nHilar: Bilateral hilar lymphadenopathy with calcification.\nNo pleural effusion. No pneumothorax. Cardiac silhouette normal.',
         'Bilateral upper lobe fibrocavitary lesions with volume loss. Findings consistent with active pulmonary tuberculosis.',
         'Chest PA view performed on digital radiography system.', 111),
        ('X-Ray Chest PA – Pneumonia', 'X-Ray', 'chest', 'pathology',
         'Right lower lobe: Homogeneous opacity with air bronchogram consistent with consolidation.\nLeft lung: Clear.\nNo pleural effusion. No pneumothorax. Cardiac silhouette normal. Hilar shadows normal.\nBony thorax intact.',
         'Right lower lobe pneumonia.',
         'Chest PA view performed on digital radiography system.', 112),
        ('X-Ray Knee AP/Lateral – Normal', 'X-Ray', 'knee', 'normal',
         'Normal alignment of the knee joint. Joint spaces are well-preserved. No osteophytes. No subchondral sclerosis or cysts. No fracture. No soft tissue swelling. Patella is in normal position. No effusion.',
         'Normal knee X-ray.',
         'Knee AP and lateral views performed on digital radiography system.', 120),
        ('X-Ray Knee AP/Lateral – Osteoarthritis', 'X-Ray', 'knee', 'pathology',
         'Medial compartment: Joint space narrowing. Subchondral sclerosis. Osteophyte formation. Subchondral cysts.\nLateral compartment: Preserved.\nPatellofemoral joint: Mild degenerative changes.\nNo fracture. No loose bodies. Mild soft tissue swelling.',
         'Bilateral knee osteoarthritis (medial compartment predominant).',
         'Knee AP and lateral views performed on digital radiography system.', 121),
        ('X-Ray Knee AP/Lateral – Fracture', 'X-Ray', 'knee', 'trauma',
         'Transverse fracture of the lateral tibial plateau with depression of the articular surface. Step-off of approximately 4 mm. No intra-articular fragment. No patellar fracture. No fibular fracture. Moderate joint effusion. Soft tissue swelling.',
         'Lateral tibial plateau fracture with articular depression.',
         'Knee AP and lateral views performed on digital radiography system.', 122),
        ('X-Ray LS Spine AP/Lateral – Normal', 'X-Ray', 'lumbar spine', 'normal',
         'Normal lumbar lordosis. Vertebral bodies show normal height and alignment. No fracture. No lytic or sclerotic lesion. Disc spaces are preserved. No spondylolisthesis. Pedicles are intact. No sacral anomaly.',
         'Normal LS spine X-ray.',
         'LS spine AP and lateral views performed on digital radiography system.', 130),
        ('X-Ray LS Spine AP/Lateral – Degenerative Changes', 'X-Ray', 'lumbar spine', 'pathology',
         'L4-L5: Disc space narrowing. Osteophyte formation. Subchondral sclerosis. Endplate irregularity.\nL5-S1: Disc space narrowing. Mild osteophyte formation.\nNo spondylolisthesis. No fracture. No lytic or sclerotic lesion.',
         'Degenerative disc disease at L4-L5 and L5-S1.',
         'LS spine AP and lateral views performed on digital radiography system.', 131),
        ('X-Ray LS Spine AP/Lateral – Compression Fracture', 'X-Ray', 'lumbar spine', 'trauma',
         'L1 vertebral body: Compression fracture with anterior wedge deformity (loss of anterior height ~35%). Intact posterior cortex. No retropulsion. No spondylolisthesis. Rest of the vertebral bodies normal. No other fracture.',
         'L1 compression fracture with anterior wedge deformity.',
         'LS spine AP and lateral views performed on digital radiography system.', 132),
        ('X-Ray Pelvis AP – Normal', 'X-Ray', 'pelvis', 'normal',
         'Both hip joints show normal alignment. Joint spaces are preserved. No fracture. No lytic or sclerotic lesion. Sacroiliac joints are normal. Symphysis pubis is intact. No soft tissue swelling. No calcification.',
         'Normal pelvis X-ray.',
         'Pelvis AP view performed on digital radiography system.', 140),
        ('X-Ray Pelvis AP – Right Hip Fracture', 'X-Ray', 'pelvis', 'trauma',
         'Right femoral neck: Complete fracture with displaced femoral head. Garden Type IV. Shortening and external rotation of the right lower limb.\nLeft hip: Normal.\nNo acetabular fracture. No pubic rami fracture.',
         'Right femoral neck fracture (Garden Type IV).',
         'Pelvis AP view performed on digital radiography system.', 141),
        ('X-Ray Pelvis AP – Avascular Necrosis (AVN)', 'X-Ray', 'pelvis', 'pathology',
         'Right femoral head: Sclerotic margins with subchondral radiolucency (crescent sign). Flattening of the femoral head. Mild joint space narrowing.\nLeft femoral head: Normal.\nBoth sacroiliac joints normal.',
         'Right femoral head avascular necrosis (Ficat Stage III).',
         'Pelvis AP view performed on digital radiography system.', 142)
      ON CONFLICT (name, modality) DO NOTHING;

      -- ── LAN-only login gate ──────────────────────────────────────────────
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS lan_only_login BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS lan_allowed_ips TEXT NOT NULL DEFAULT '[]';

      -- ── FIDO2 / WebAuthn optional toggle ───────────────────────────────
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS fido2_enabled BOOLEAN NOT NULL DEFAULT FALSE;

      -- ── Hospital-Grade Safety Phase 1 (May 2026) ─────────────────────
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_concurrent_sessions INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes INTEGER NOT NULL DEFAULT 30;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS default_max_concurrent_sessions INTEGER NOT NULL DEFAULT 3;

      -- ── Form F required field toggles (May 2026) ────────────────────
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS form_f_billing_prompt BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS form_f_address_required BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS form_f_guardian_required BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
      ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
      ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      -- ── Hospital-Grade Safety Phase 2: Account Lockout (May 2026) ───────────
      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS max_failed_login_attempts INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS account_lockout_duration_minutes INTEGER NOT NULL DEFAULT 30;

      -- ── Hospital-Grade Safety Phase 3: Tamper-evident audit chain (May 2026) ─
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_name TEXT NOT NULL DEFAULT 'system',
        role TEXT NOT NULL DEFAULT 'system',
        action TEXT NOT NULL,
        module TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        old_value TEXT,
        new_value TEXT,
        ip_address TEXT,
        user_agent TEXT,
        reason TEXT,
        previous_hash TEXT NOT NULL DEFAULT '',
        chain_hash TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_hash TEXT NOT NULL DEFAULT '';

      -- Backfill legacy rows: compute chain hashes chronologically so the
      -- chain is consistent.  We process in batches of 1000 to avoid memory
      -- pressure on large tables.
      DO $$
      DECLARE
        r RECORD;
        prev_hash TEXT := '';
        payload TEXT;
        h TEXT;
      BEGIN
        FOR r IN SELECT id, user_id, user_name, role, action, module,
                        entity_type, entity_id, old_value, new_value,
                        reason, ip_address, user_agent, created_at
                   FROM audit_logs
                  WHERE chain_hash = ''
                  ORDER BY id ASC
        LOOP
          payload := jsonb_build_object(
            'userId',       r.user_id,
            'userName',     r.user_name,
            'role',         r.role,
            'action',       r.action,
            'module',       r.module,
            'entityType',   r.entity_type,
            'entityId',     r.entity_id,
            'oldValue',     r.old_value,
            'newValue',     r.new_value,
            'reason',       r.reason,
            'ipAddress',    r.ip_address,
            'userAgent',    r.user_agent,
            'createdAt',    r.created_at,
            'previousHash', prev_hash
          )::text;
          h := encode(digest(payload, 'sha256'), 'hex');
          UPDATE audit_logs
             SET previous_hash = prev_hash,
                 chain_hash = h
           WHERE id = r.id;
          prev_hash := h;
        END LOOP;
      END $$;

      -- ── Remote super-admin login bypass ────────────────────────────────
      ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

      -- ── Online bookings time slot ────────────────────────────────────────
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS time_slot TEXT NOT NULL DEFAULT '';

      -- ── ICICI payment gateway column additions ───────────────────────────
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS icici_transaction_id TEXT;
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS icici_provider_ref_id TEXT;
      ALTER TABLE online_bookings ADD COLUMN IF NOT EXISTS failure_reason TEXT;

      -- ── Payment Log Table ────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS payment_logs (
        id SERIAL PRIMARY KEY,
        booking_ref TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        gateway TEXT NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        status TEXT NOT NULL,
        request_payload TEXT,
        response_payload TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Online booking payment gateway columns ───────────────────────────
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS online_booking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS razorpay_key_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS online_booking_ledger_id INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS vip_queue_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS payu_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS payu_merchant_key TEXT NOT NULL DEFAULT '';
      -- ── Online booking test whitelist ────────────────────────────────────
      ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS online_booking_allowed_test_ids TEXT NOT NULL DEFAULT '[]';

      -- ── Walk-in ledger designation ────────────────────────────────────────
      ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT false;
      -- Auto-detect existing book by name pattern if none is marked yet
      UPDATE ledgers SET is_walk_in = true
      WHERE id = (
        SELECT id FROM ledgers
        WHERE (LOWER(name) LIKE '%walk%' OR LOWER(name) LIKE '%self%referral%')
          AND is_default = false
        ORDER BY id DESC
        LIMIT 1
      )
      AND NOT EXISTS (SELECT 1 FROM ledgers WHERE is_walk_in = true);

      -- Backfill historical walk-in records: move bills, orders, patients,
      -- and appointments with no referring doctor into the Walk-in ledger.
      -- All idempotent — moved rows are no longer on ledger_id=1.
      UPDATE bills b
         SET ledger_id = wl.id
        FROM orders o, ledgers wl
       WHERE o.id = b.order_id
         AND b.ledger_id = 1
         AND o.doctor_id IS NULL
         AND wl.is_walk_in = true;

      UPDATE orders o
         SET ledger_id = wl.id
        FROM ledgers wl
       WHERE o.ledger_id = 1
         AND o.doctor_id IS NULL
         AND wl.is_walk_in = true;

      UPDATE patients p
         SET ledger_id = wl.id
        FROM orders o, ledgers wl
       WHERE p.id = o.patient_id
         AND p.ledger_id = 1
         AND o.doctor_id IS NULL
         AND wl.is_walk_in = true;

      -- Walk-in appointment ledger backfill: skip if orders.appointment_id does not exist yet
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'appointment_id') THEN
          UPDATE appointments a
             SET ledger_id = wl.id
            FROM orders o, ledgers wl
           WHERE a.id = o.appointment_id
             AND a.ledger_id = 1
             AND o.doctor_id IS NULL
             AND wl.is_walk_in = true;
        END IF;
      END $$;

      -- ── Enterprise Radiology Phase 1 ──
      ALTER TABLE radiology_studies ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'routine';
      ALTER TABLE radiology_studies ADD COLUMN IF NOT EXISTS priority_reason TEXT;
      ALTER TABLE radiology_studies ADD COLUMN IF NOT EXISTS priority_overridden_at TIMESTAMPTZ;
      ALTER TABLE radiology_studies ADD COLUMN IF NOT EXISTS priority_overridden_by TEXT;
      CREATE INDEX IF NOT EXISTS radiology_studies_priority_idx ON radiology_studies(priority);

      CREATE TABLE IF NOT EXISTS radiology_priority_rules (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        priority TEXT NOT NULL,
        body_part_pattern TEXT,
        study_desc_pattern TEXT,
        modality_list TEXT,
        referring_doctor_pattern TEXT,
        keywords TEXT,
        location_pattern TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS radiologist_assignment_rules (
        id SERIAL PRIMARY KEY,
        modality TEXT NOT NULL,
        body_part TEXT,
        subspecialty TEXT,
        shift_start TEXT,
        shift_end TEXT,
        primary_radiologist_id INTEGER NOT NULL,
        backup_radiologist_id INTEGER,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS radiologist_subspecialties (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        subspecialty TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS radiologist_workloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        assigned_count INTEGER NOT NULL DEFAULT 0,
        in_progress_count INTEGER NOT NULL DEFAULT 0,
        pending_count INTEGER NOT NULL DEFAULT 0,
        today_reported_count INTEGER NOT NULL DEFAULT 0,
        last_assigned_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Phase 2: Report verification + peer review + critical findings + TAT ──
      CREATE TABLE IF NOT EXISTS radiology_report_verifications (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_prelim',
        prelim_by INTEGER,
        prelim_at TIMESTAMPTZ,
        peer_reviewer_id INTEGER,
        peer_reviewed_at TIMESTAMPTZ,
        peer_review_notes TEXT,
        verified_by INTEGER,
        verified_at TIMESTAMPTZ,
        final_by INTEGER,
        final_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS radiology_critical_findings (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        finding TEXT NOT NULL,
        severity TEXT NOT NULL,
        category TEXT,
        notified_clinician TEXT,
        notified_at TIMESTAMPTZ,
        notification_method TEXT,
        acknowledged_by TEXT,
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS radiology_tat_tracking (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL UNIQUE,
        priority TEXT NOT NULL DEFAULT 'routine',
        study_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        prelim_completed_at TIMESTAMPTZ,
        final_completed_at TIMESTAMPTZ,
        prelim_minutes INTEGER,
        final_minutes INTEGER,
        sla_breached BOOLEAN NOT NULL DEFAULT FALSE,
        sla_minutes INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Phase 3: Structured templates + AI enhancement + measurements ──
      CREATE TABLE IF NOT EXISTS radiology_structured_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        modality TEXT NOT NULL,
        body_part TEXT,
        description TEXT,
        template TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS radiology_ai_enhancements (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        findings_json TEXT,
        impression_draft TEXT,
        measurement_extracts_json TEXT,
        ai_model TEXT,
        ai_version TEXT,
        reviewed_by INTEGER,
        reviewed_at TIMESTAMPTZ,
        accepted BOOLEAN,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS radiology_dicom_measurements (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        measurement_type TEXT NOT NULL,
        value TEXT NOT NULL,
        unit TEXT,
        reference_range TEXT,
        dicom_tag TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Phase 4: Multi-site + teleradiology + DICOM routing ──
      CREATE TABLE IF NOT EXISTS teleradiology_sites (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        pacs_url TEXT,
        ae_title TEXT,
        modality_list TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        timezone_offset INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS radiology_multi_site_worklist (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL,
        study_id INTEGER NOT NULL,
        external_accession_number TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_sync_at TIMESTAMPTZ,
        last_sync_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dicom_routing_optimization_log (
        id SERIAL PRIMARY KEY,
        study_instance_uid TEXT,
        source_ae_title TEXT,
        target_ae_title TEXT,
        routing_decision TEXT NOT NULL,
        reason TEXT,
        load_factor INTEGER,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── FIDO2 / WebAuthn staff credentials ──
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        device_name TEXT,
        transports TEXT,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Sync queue + checkpoints (offline-first desktop sync) ──
      CREATE TABLE IF NOT EXISTS sync_queue (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        local_id INTEGER,
        cloud_id INTEGER,
        payload JSONB,
        conflict_strategy TEXT NOT NULL DEFAULT 'server_wins',
        is_synced BOOLEAN NOT NULL DEFAULT FALSE,
        synced_at TIMESTAMPTZ,
        sync_result TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        id SERIAL PRIMARY KEY,
        table_name TEXT NOT NULL UNIQUE,
        last_pulled_at TIMESTAMPTZ,
        last_pushed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS radiology_text_macros (
        id SERIAL PRIMARY KEY,
        created_by TEXT NOT NULL,
        shortcut TEXT NOT NULL,
        expansion TEXT NOT NULL,
        modality TEXT,
        is_global BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rad_macros_creator_idx ON radiology_text_macros(created_by);
      CREATE INDEX IF NOT EXISTS rad_macros_shortcut_idx ON radiology_text_macros(shortcut);
      CREATE INDEX IF NOT EXISTS rad_macros_modality_idx ON radiology_text_macros(modality);
      CREATE TABLE IF NOT EXISTS radiology_report_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        heading_case TEXT NOT NULL DEFAULT 'all_caps',
        section_spacing TEXT NOT NULL DEFAULT 'spaced',
        impression_style TEXT NOT NULL DEFAULT 'bulleted',
        show_end_of_report_footer BOOLEAN NOT NULL DEFAULT TRUE,
        footer_text TEXT,
        header_line_1 TEXT,
        header_line_2_source TEXT NOT NULL DEFAULT 'template_name',
        header_line_2_custom TEXT,
        workspace_layout TEXT NOT NULL DEFAULT '3_panel',
        print_mode TEXT NOT NULL DEFAULT 'letterhead',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rad_prefs_user_idx ON radiology_report_preferences(user_id);

      CREATE TABLE IF NOT EXISTS structured_report_templates (
        id SERIAL PRIMARY KEY,
        template_name TEXT NOT NULL,
        modality TEXT NOT NULL,
        body_part TEXT NOT NULL,
        study_type TEXT,
        sections_json TEXT NOT NULL DEFAULT '{}',
        default_findings TEXT,
        default_impression TEXT,
        macros_json TEXT NOT NULL DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_preset BOOLEAN NOT NULL DEFAULT FALSE,
        created_by TEXT,
        updated_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS srt_modality_idx ON structured_report_templates(modality);
      CREATE INDEX IF NOT EXISTS srt_body_part_idx ON structured_report_templates(body_part);
      CREATE INDEX IF NOT EXISTS srt_preset_idx ON structured_report_templates(is_preset);

      CREATE TABLE IF NOT EXISTS radiology_image_references (
        id SERIAL PRIMARY KEY,
        draft_id INTEGER NOT NULL,
        study_id INTEGER,
        series_number TEXT,
        image_number TEXT,
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rad_img_refs_draft_idx ON radiology_image_references(draft_id);
      CREATE INDEX IF NOT EXISTS rad_img_refs_study_idx ON radiology_image_references(study_id);

      -- ── USG enterprise additions (Phase 5+) ───────────────────────────────
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS verified_by      TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS amended_by       TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS amended_at       TIMESTAMPTZ;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS prior_version_id INTEGER;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS critical_alert_id INTEGER;

      CREATE TABLE IF NOT EXISTS usg_audit_log (
        id                  SERIAL PRIMARY KEY,
        entity_type         TEXT NOT NULL,
        entity_id           INTEGER,
        action              TEXT NOT NULL,
        performed_by        TEXT NOT NULL,
        performed_by_id     INTEGER,
        performed_by_role   TEXT,
        study_instance_uid  TEXT,
        patient_id          INTEGER,
        details             TEXT NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_audit_entity_idx  ON usg_audit_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS usg_audit_study_idx   ON usg_audit_log(study_instance_uid);
      CREATE INDEX IF NOT EXISTS usg_audit_patient_idx ON usg_audit_log(patient_id);
      CREATE INDEX IF NOT EXISTS usg_audit_user_idx    ON usg_audit_log(performed_by_id);
      CREATE INDEX IF NOT EXISTS usg_audit_created_idx ON usg_audit_log(created_at);

      CREATE TABLE IF NOT EXISTS radiology_normal_snippets (
        id SERIAL PRIMARY KEY,
        shortcut TEXT NOT NULL,
        label TEXT NOT NULL,
        modality TEXT,
        body_part TEXT,
        text TEXT NOT NULL,
        impression TEXT,
        recommendation TEXT,
        is_global BOOLEAN NOT NULL DEFAULT FALSE,
        created_by TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rad_snippets_shortcut_idx ON radiology_normal_snippets(shortcut);
      CREATE INDEX IF NOT EXISTS rad_snippets_modality_idx ON radiology_normal_snippets(modality);

      CREATE TABLE IF NOT EXISTS radiologist_style_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        impression_style TEXT NOT NULL DEFAULT 'concise',
        terminology_level TEXT NOT NULL DEFAULT 'standard',
        auto_number_impressions BOOLEAN NOT NULL DEFAULT TRUE,
        include_differential BOOLEAN NOT NULL DEFAULT FALSE,
        include_measurements BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS radiology_report_lifecycle_log (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        draft_id INTEGER,
        action TEXT NOT NULL,
        actor_id INTEGER,
        actor_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rad_lifecycle_study_idx ON radiology_report_lifecycle_log(study_id);
      CREATE INDEX IF NOT EXISTS rad_lifecycle_action_idx ON radiology_report_lifecycle_log(action);

      -- Enterprise Banking Upgrade (May 2026)
      CREATE TABLE IF NOT EXISTS reconciliation_logs (
        id SERIAL PRIMARY KEY,
        bank_transaction_id INTEGER NOT NULL,
        bill_id INTEGER,
        payment_id INTEGER,
        voucher_id INTEGER,
        confidence_score INTEGER NOT NULL DEFAULT 0,
        match_strategy TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'pending',
        review_reason TEXT,
        auto_closed BOOLEAN NOT NULL DEFAULT FALSE,
        auto_closed_amount NUMERIC(14,2),
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        resolution_note TEXT,
        match_metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS rec_log_bank_txn_idx ON reconciliation_logs(bank_transaction_id);
      CREATE INDEX IF NOT EXISTS rec_log_status_idx ON reconciliation_logs(status);
      CREATE INDEX IF NOT EXISTS rec_log_bill_idx ON reconciliation_logs(bill_id);

      CREATE TABLE IF NOT EXISTS fraud_alerts (
        id SERIAL PRIMARY KEY,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        bill_id INTEGER,
        payment_id INTEGER,
        bank_transaction_id INTEGER,
        user_id INTEGER,
        user_name TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        affected_amount NUMERIC(14,2),
        evidence JSONB,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        resolution_note TEXT,
        resolution_action TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fraud_status_idx ON fraud_alerts(status);
      CREATE INDEX IF NOT EXISTS fraud_type_idx ON fraud_alerts(alert_type);
      CREATE INDEX IF NOT EXISTS fraud_severity_idx ON fraud_alerts(severity);

      CREATE TABLE IF NOT EXISTS shift_closures (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        shift_label TEXT NOT NULL DEFAULT 'Morning',
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        expected_cash NUMERIC(12,2) NOT NULL DEFAULT '0',
        expected_upi NUMERIC(12,2) NOT NULL DEFAULT '0',
        expected_card NUMERIC(12,2) NOT NULL DEFAULT '0',
        expected_cheque NUMERIC(12,2) NOT NULL DEFAULT '0',
        expected_other NUMERIC(12,2) NOT NULL DEFAULT '0',
        expected_total NUMERIC(12,2) NOT NULL DEFAULT '0',
        actual_cash NUMERIC(12,2) NOT NULL DEFAULT '0',
        actual_upi NUMERIC(12,2) NOT NULL DEFAULT '0',
        actual_card NUMERIC(12,2) NOT NULL DEFAULT '0',
        actual_cheque NUMERIC(12,2) NOT NULL DEFAULT '0',
        actual_other NUMERIC(12,2) NOT NULL DEFAULT '0',
        actual_total NUMERIC(12,2) NOT NULL DEFAULT '0',
        variance NUMERIC(12,2) NOT NULL DEFAULT '0',
        variance_note TEXT NOT NULL DEFAULT '',
        denominations JSONB,
        denomination_total NUMERIC(12,2),
        bank_deposit_amount NUMERIC(12,2),
        bank_deposit_ref TEXT,
        supervisor_id INTEGER,
        supervisor_name TEXT,
        approved_at TIMESTAMPTZ,
        approval_note TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        user_day_closure_id INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS shift_user_idx ON shift_closures(user_id);
      CREATE INDEX IF NOT EXISTS shift_status_idx ON shift_closures(status);
      CREATE INDEX IF NOT EXISTS shift_date_idx ON shift_closures(started_at);

      CREATE TABLE IF NOT EXISTS gateway_transactions (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        external_transaction_id TEXT,
        external_order_id TEXT,
        amount NUMERIC(14,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        gateway_fee NUMERIC(14,2),
        tax_on_fee NUMERIC(14,2),
        net_settled NUMERIC(14,2),
        settlement_utr TEXT,
        settlement_date TIMESTAMPTZ,
        settlement_status TEXT NOT NULL DEFAULT 'pending',
        method TEXT,
        method_detail TEXT,
        payer_vpa TEXT,
        payer_phone TEXT,
        bill_id INTEGER,
        payment_id INTEGER,
        status TEXT NOT NULL DEFAULT 'initiated',
        failure_reason TEXT,
        raw_payload JSONB,
        reconciliation_status TEXT NOT NULL DEFAULT 'unreconciled',
        bank_transaction_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gw_txn_provider_idx ON gateway_transactions(provider);
      CREATE INDEX IF NOT EXISTS gw_txn_status_idx ON gateway_transactions(status);
      CREATE INDEX IF NOT EXISTS gw_txn_bill_idx ON gateway_transactions(bill_id);
      CREATE INDEX IF NOT EXISTS gw_txn_ext_id_idx ON gateway_transactions(external_transaction_id);

      CREATE TABLE IF NOT EXISTS refund_requests (
        id SERIAL PRIMARY KEY,
        bill_id INTEGER NOT NULL,
        payment_id INTEGER NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        reason TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_by_id INTEGER,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'requested',
        approved_by TEXT,
        approved_by_id INTEGER,
        approved_at TIMESTAMPTZ,
        approval_note TEXT,
        rejected_by TEXT,
        rejected_at TIMESTAMPTZ,
        rejection_reason TEXT,
        gateway_refund_id TEXT,
        gateway_refund_status TEXT,
        gateway_refund_raw JSONB,
        completed_at TIMESTAMPTZ,
        completed_by TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS refund_bill_idx ON refund_requests(bill_id);
      CREATE INDEX IF NOT EXISTS refund_status_idx ON refund_requests(status);

      -- ── Enterprise Radiology / PACS ──
      CREATE TABLE IF NOT EXISTS radiologist_performance_stats (
        id SERIAL PRIMARY KEY,
        radiologist_id INTEGER NOT NULL,
        radiologist_name TEXT NOT NULL,
        period_type TEXT NOT NULL DEFAULT 'daily',
        period_date TEXT NOT NULL,
        total_studies INTEGER NOT NULL DEFAULT 0,
        reported_studies INTEGER NOT NULL DEFAULT 0,
        preliminary_reports INTEGER NOT NULL DEFAULT 0,
        final_reports INTEGER NOT NULL DEFAULT 0,
        avg_tat_minutes INTEGER,
        stat_studies INTEGER NOT NULL DEFAULT 0,
        emergency_studies INTEGER NOT NULL DEFAULT 0,
        routine_studies INTEGER NOT NULL DEFAULT 0,
        ai_drafts_used INTEGER NOT NULL DEFAULT 0,
        ai_drafts_accepted INTEGER NOT NULL DEFAULT 0,
        critical_findings_flagged INTEGER NOT NULL DEFAULT 0,
        modality_breakdown TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS perf_stats_rad_period_idx ON radiologist_performance_stats(radiologist_id, period_type, period_date);
      CREATE INDEX IF NOT EXISTS perf_stats_date_idx ON radiologist_performance_stats(period_date);

      CREATE TABLE IF NOT EXISTS critical_findings_alerts (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        study_id INTEGER,
        accession_number TEXT NOT NULL,
        patient_id INTEGER,
        patient_name TEXT NOT NULL,
        modality TEXT NOT NULL DEFAULT 'OT',
        study_description TEXT,
        severity TEXT NOT NULL DEFAULT 'high',
        finding_type TEXT NOT NULL,
        description TEXT NOT NULL,
        flagged_by TEXT NOT NULL,
        flagged_by_id INTEGER,
        ai_confidence NUMERIC(3,2),
        acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
        acknowledged_by TEXT,
        acknowledged_at TIMESTAMPTZ,
        escalated_to TEXT,
        escalation_sent BOOLEAN NOT NULL DEFAULT FALSE,
        notification_channels TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS cf_alert_worklist_idx ON critical_findings_alerts(worklist_id);
      CREATE INDEX IF NOT EXISTS cf_alert_status_idx ON critical_findings_alerts(status);
      CREATE INDEX IF NOT EXISTS cf_alert_severity_idx ON critical_findings_alerts(severity);
      CREATE INDEX IF NOT EXISTS cf_alert_created_idx ON critical_findings_alerts(created_at);

      CREATE TABLE IF NOT EXISTS ai_server_health_log (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT,
        endpoint TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        latency_ms INTEGER,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        error_message TEXT,
        http_status INTEGER,
        tokens_used INTEGER,
        quota_remaining INTEGER,
        check_type TEXT NOT NULL DEFAULT 'actual_call',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_health_provider_idx ON ai_server_health_log(provider);
      CREATE INDEX IF NOT EXISTS ai_health_status_idx ON ai_server_health_log(status);
      CREATE INDEX IF NOT EXISTS ai_health_created_idx ON ai_server_health_log(created_at);

      CREATE TABLE IF NOT EXISTS pacs_archive_lifecycle (
        id SERIAL PRIMARY KEY,
        study_instance_uid TEXT NOT NULL UNIQUE,
        accession_number TEXT,
        modality TEXT,
        patient_id INTEGER,
        original_size_bytes NUMERIC(20,0),
        compressed_size_bytes NUMERIC(20,0),
        compression_ratio NUMERIC(5,2),
        compression_method TEXT,
        tier TEXT NOT NULL DEFAULT 'hot',
        last_accessed_at TIMESTAMPTZ,
        moved_to_tier_at TIMESTAMPTZ,
        scheduled_for_archive_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        restored_at TIMESTAMPTZ,
        restore_count INTEGER NOT NULL DEFAULT 0,
        auto_compressed BOOLEAN NOT NULL DEFAULT FALSE,
        retention_days INTEGER,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS archive_uid_idx ON pacs_archive_lifecycle(study_instance_uid);
      CREATE INDEX IF NOT EXISTS archive_tier_idx ON pacs_archive_lifecycle(tier);
      CREATE INDEX IF NOT EXISTS archive_patient_idx ON pacs_archive_lifecycle(patient_id);

      CREATE TABLE IF NOT EXISTS watchdog_status (
        id SERIAL PRIMARY KEY,
        service_name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_heartbeat TIMESTAMPTZ,
        last_error TEXT,
        restart_count INTEGER NOT NULL DEFAULT 0,
        max_restarts INTEGER NOT NULL DEFAULT 5,
        auto_restart_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        check_interval_seconds INTEGER NOT NULL DEFAULT 60,
        next_check_at TIMESTAMPTZ,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS watchdog_status_idx ON watchdog_status(status);
      CREATE INDEX IF NOT EXISTS watchdog_heartbeat_idx ON watchdog_status(last_heartbeat);

      CREATE TABLE IF NOT EXISTS ris_sync_status (
        id SERIAL PRIMARY KEY,
        sync_type TEXT NOT NULL,
        source_system TEXT NOT NULL,
        target_system TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        last_sync_at TIMESTAMPTZ,
        next_sync_at TIMESTAMPTZ,
        items_pending INTEGER NOT NULL DEFAULT 0,
        items_synced INTEGER NOT NULL DEFAULT 0,
        items_failed INTEGER NOT NULL DEFAULT 0,
        avg_sync_time_ms INTEGER,
        error_message TEXT,
        error_count INTEGER NOT NULL DEFAULT 0,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ris_sync_type_idx ON ris_sync_status(sync_type);
      CREATE INDEX IF NOT EXISTS ris_sync_status_idx ON ris_sync_status(status);

      -- ── USG Auto-Measurement Extraction ──
      CREATE TABLE IF NOT EXISTS usg_measurements (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        study_id INTEGER,
        study_instance_uid TEXT,
        accession_number TEXT,
        patient_id INTEGER,
        extraction_run_id INTEGER,
        source TEXT NOT NULL DEFAULT 'ocr',
        overall_confidence TEXT NOT NULL DEFAULT 'low',
        bpd TEXT, bpd_confidence TEXT,
        hc TEXT, hc_confidence TEXT,
        ac TEXT, ac_confidence TEXT,
        fl TEXT, fl_confidence TEXT,
        crl TEXT, crl_confidence TEXT,
        efw TEXT, efw_confidence TEXT,
        ga TEXT, ga_confidence TEXT,
        edd TEXT, edd_confidence TEXT,
        fhr TEXT, fhr_confidence TEXT,
        placenta_position TEXT,
        liquor_afi TEXT,
        fetal_presentation TEXT,
        uterus_size TEXT, uterus_size_confidence TEXT,
        endometrium TEXT, endometrium_confidence TEXT,
        right_ovary TEXT, right_ovary_confidence TEXT,
        left_ovary TEXT, left_ovary_confidence TEXT,
        follicles TEXT,
        adnexal_lesion TEXT,
        liver_size TEXT, liver_size_confidence TEXT,
        spleen_size TEXT, spleen_size_confidence TEXT,
        right_kidney TEXT, right_kidney_confidence TEXT,
        left_kidney TEXT, left_kidney_confidence TEXT,
        cbd TEXT, cbd_confidence TEXT,
        gb_wall TEXT, gb_wall_confidence TEXT,
        prostate_volume TEXT, prostate_volume_confidence TEXT,
        extra_measurements_json TEXT NOT NULL DEFAULT '{}',
        manufacturer TEXT,
        manufacturer_model TEXT,
        institution_name TEXT,
        study_description TEXT,
        study_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending_review',
        reviewed_by TEXT,
        reviewed_at TIMESTAMPTZ,
        review_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_meas_study_uid_idx ON usg_measurements(study_instance_uid);
      CREATE INDEX IF NOT EXISTS usg_meas_worklist_idx ON usg_measurements(worklist_id);
      CREATE INDEX IF NOT EXISTS usg_meas_status_idx ON usg_measurements(status);
      CREATE INDEX IF NOT EXISTS usg_meas_patient_idx ON usg_measurements(patient_id);

      CREATE TABLE IF NOT EXISTS usg_extraction_logs (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        study_instance_uid TEXT,
        accession_number TEXT,
        extraction_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        frames_processed INTEGER NOT NULL DEFAULT 0,
        frames_failed INTEGER NOT NULL DEFAULT 0,
        sr_found BOOLEAN NOT NULL DEFAULT FALSE,
        ai_normalized BOOLEAN NOT NULL DEFAULT FALSE,
        error_message TEXT,
        duration_ms INTEGER,
        triggered_by TEXT NOT NULL DEFAULT 'auto',
        triggered_by_user_id INTEGER,
        raw_ocr_text_json TEXT,
        raw_sr_json TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS usg_log_study_idx ON usg_extraction_logs(study_instance_uid);
      CREATE INDEX IF NOT EXISTS usg_log_worklist_idx ON usg_extraction_logs(worklist_id);
      CREATE INDEX IF NOT EXISTS usg_log_status_idx ON usg_extraction_logs(status);

      CREATE TABLE IF NOT EXISTS usg_key_images (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        study_instance_uid TEXT,
        accession_number TEXT,
        patient_id INTEGER,
        series_instance_uid TEXT,
        sop_instance_uid TEXT,
        series_number TEXT,
        image_number TEXT,
        frame_number INTEGER NOT NULL DEFAULT 1,
        label TEXT NOT NULL DEFAULT '',
        wado_url TEXT,
        thumbnail_base64 TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_by TEXT,
        added_by_user_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_key_img_study_idx ON usg_key_images(study_instance_uid);
      CREATE INDEX IF NOT EXISTS usg_key_img_worklist_idx ON usg_key_images(worklist_id);

      -- ── USG Doppler / Doppler Module ──
      CREATE TABLE IF NOT EXISTS usg_doppler_measurements (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        study_instance_uid TEXT,
        accession_number TEXT,
        patient_id INTEGER,
        extraction_run_id INTEGER,
        vessel_name TEXT NOT NULL DEFAULT '',
        side TEXT NOT NULL DEFAULT 'unknown',
        psv TEXT,
        edv TEXT,
        ri TEXT,
        pi TEXT,
        sd_ratio TEXT,
        waveform_label TEXT,
        waveform_description TEXT,
        confidence TEXT NOT NULL DEFAULT 'low',
        source TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'pending_review',
        reviewed_by TEXT,
        reviewed_at TIMESTAMPTZ,
        review_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_dop_study_idx    ON usg_doppler_measurements(study_instance_uid);
      CREATE INDEX IF NOT EXISTS usg_dop_worklist_idx ON usg_doppler_measurements(worklist_id);
      CREATE INDEX IF NOT EXISTS usg_dop_status_idx   ON usg_doppler_measurements(status);
      CREATE INDEX IF NOT EXISTS usg_dop_patient_idx  ON usg_doppler_measurements(patient_id);

      -- ── USG Extraction Settings (singleton, id=1) ──
      CREATE TABLE IF NOT EXISTS usg_extraction_settings (
        id SERIAL PRIMARY KEY,
        ocr_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ai_normalize_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sr_priority_mode BOOLEAN NOT NULL DEFAULT TRUE,
        auto_reject_low_confidence BOOLEAN NOT NULL DEFAULT TRUE,
        human_review_required BOOLEAN NOT NULL DEFAULT TRUE,
        auto_finalize BOOLEAN NOT NULL DEFAULT FALSE,
        confidence_threshold REAL NOT NULL DEFAULT 0.80,
        low_confidence_cutoff REAL NOT NULL DEFAULT 0.60,
        max_frames_to_ocr INTEGER NOT NULL DEFAULT 20,
        ge_ae_title TEXT NOT NULL DEFAULT 'GE_USG',
        ge_ip TEXT NOT NULL DEFAULT '',
        ge_port TEXT NOT NULL DEFAULT '11112',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO usg_extraction_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

      -- ── USG Machine Profiles ──
      CREATE TABLE IF NOT EXISTS usg_machine_profiles (
        id SERIAL PRIMARY KEY,
        machine_name TEXT NOT NULL,
        manufacturer TEXT NOT NULL DEFAULT 'GE',
        model_name TEXT,
        ae_title TEXT,
        ip_address TEXT,
        port TEXT NOT NULL DEFAULT '11112',
        modality TEXT NOT NULL DEFAULT 'USG',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        capabilities TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_machine_active_idx ON usg_machine_profiles(active);

      -- ── USG Report Drafts ──
      CREATE TABLE IF NOT EXISTS usg_report_drafts (
        id SERIAL PRIMARY KEY,
        worklist_id INTEGER,
        study_instance_uid TEXT,
        patient_id INTEGER,
        accession_number TEXT,
        template_type TEXT NOT NULL DEFAULT 'WHOLE_ABDOMEN',
        draft_content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        auto_filled_from_measurement_id INTEGER,
        auto_filled_from_doppler_id INTEGER,
        created_by TEXT,
        finalized_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finalized_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS usg_draft_study_idx    ON usg_report_drafts(study_instance_uid);
      CREATE INDEX IF NOT EXISTS usg_draft_worklist_idx ON usg_report_drafts(worklist_id);
      CREATE INDEX IF NOT EXISTS usg_draft_status_idx   ON usg_report_drafts(status);
      CREATE INDEX IF NOT EXISTS usg_draft_patient_idx  ON usg_report_drafts(patient_id);

      -- Phase 9: medico-legal safety columns
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS verified_by      TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS amended_by       TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS amended_at       TIMESTAMPTZ;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS prior_version_id INTEGER;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS critical_alert_id INTEGER;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS finalized_report_hash   TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS finalized_pdf_version_id TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS amendment_reason       TEXT;
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS sync_status           TEXT NOT NULL DEFAULT 'synced';
      ALTER TABLE usg_report_drafts ADD COLUMN IF NOT EXISTS locked_by              TEXT;

      -- Structured measurement numeric fields (Phase 9)
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_kidney_length_mm        REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_kidney_width_mm         REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_kidney_thickness_mm    REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_kidney_length_mm         REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_kidney_width_mm          REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_kidney_thickness_mm     REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_cortical_thickness_mm  REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_cortical_thickness_mm   REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS prostate_length_mm            REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS prostate_width_mm             REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS prostate_height_mm            REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_right_lobe_length_mm  REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_right_lobe_width_mm   REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_right_lobe_thickness_mm REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_left_lobe_length_mm   REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_left_lobe_width_mm    REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_left_lobe_thickness_mm REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_isthmus_mm            REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_nodule_size_mm        REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS thyroid_tirads_score          TEXT;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS liver_span_mm                 REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS cbd_mm                        REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS gb_wall_mm                    REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS uterus_length_mm              REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS uterus_width_mm               REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS uterus_height_mm               REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_ovary_length_mm         REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_ovary_width_mm          REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS right_ovary_height_mm          REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_ovary_length_mm          REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_ovary_width_mm           REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS left_ovary_height_mm          REAL;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS follicle_count                INTEGER;
      ALTER TABLE usg_measurements ADD COLUMN IF NOT EXISTS largest_follicle_mm           REAL;

      CREATE TABLE IF NOT EXISTS usg_report_amendments (
        id SERIAL PRIMARY KEY,
        draft_id INTEGER NOT NULL,
        prior_version_id INTEGER NOT NULL,
        amendment_reason TEXT NOT NULL DEFAULT '',
        amended_by TEXT NOT NULL,
        amended_by_id INTEGER,
        prior_content TEXT NOT NULL DEFAULT '',
        new_content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_amend_draft_idx ON usg_report_amendments(draft_id);
      CREATE INDEX IF NOT EXISTS usg_amend_prior_idx ON usg_report_amendments(prior_version_id);

      CREATE TABLE IF NOT EXISTS usg_finding_image_links (
        id SERIAL PRIMARY KEY,
        draft_id INTEGER NOT NULL,
        finding_index INTEGER NOT NULL DEFAULT 0,
        image_id INTEGER NOT NULL,
        frame_number INTEGER,
        annotation_label TEXT,
        measurement_reference TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS usg_fimg_draft_idx ON usg_finding_image_links(draft_id);
      CREATE INDEX IF NOT EXISTS usg_fimg_image_idx ON usg_finding_image_links(image_id);

      -- ── Form F: Gestational Age (weeks + days) replaces old 14(a) prenatal result ──
      ALTER TABLE form_f_records ADD COLUMN IF NOT EXISTS gestational_age_weeks TEXT NOT NULL DEFAULT '';
      ALTER TABLE form_f_records ADD COLUMN IF NOT EXISTS gestational_age_days TEXT NOT NULL DEFAULT '';

      -- ── Doctor address + area for marketing / area-based search ──
      ALTER TABLE doctors ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE doctors ADD COLUMN IF NOT EXISTS area TEXT;

      -- ── Role-Permissions Matrix (May 2026) ──
      -- Granular per-role, per-module permission table.  The UI super-admin
      -- portal edits this; at every staff login we derive the legacy
      -- users.permissions JSON array from this table so existing ERP routes
      -- and sidebar filtering keep working without code changes everywhere.
      CREATE TABLE IF NOT EXISTS role_permissions (
        id SERIAL PRIMARY KEY,
        role TEXT NOT NULL,
        module TEXT NOT NULL,
        can_view BOOLEAN NOT NULL DEFAULT FALSE,
        can_create BOOLEAN NOT NULL DEFAULT FALSE,
        can_edit BOOLEAN NOT NULL DEFAULT FALSE,
        can_delete BOOLEAN NOT NULL DEFAULT FALSE,
        can_print BOOLEAN NOT NULL DEFAULT FALSE,
        can_reprint BOOLEAN NOT NULL DEFAULT FALSE,
        can_refund BOOLEAN NOT NULL DEFAULT FALSE,
        can_export BOOLEAN NOT NULL DEFAULT FALSE,
        can_approve BOOLEAN NOT NULL DEFAULT FALSE,
        can_finalize BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(role, module)
      );
    `);

    // ── AI tables (Phase 1: prompt templates, Phase 4: model routing) ──────
    // Idempotent creation so fresh/prod deploys have these tables without a
    // separate drizzle migration. Schema mirrors lib/db/src/schema.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_prompt_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        modality TEXT NOT NULL,
        prompt_content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_prompt_tpl_modality_idx ON ai_prompt_templates (modality);
      CREATE INDEX IF NOT EXISTS ai_prompt_tpl_active_idx ON ai_prompt_templates (is_active);
      CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_tpl_name_uq ON ai_prompt_templates (name);
      CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_tpl_name_lower_uq ON ai_prompt_templates (lower(name));

      CREATE TABLE IF NOT EXISTS ai_model_routes (
        id SERIAL PRIMARY KEY,
        task_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ai_model_routes_task_uq ON ai_model_routes (task_key);
    `);

    // ── Spinal measurements + smart macros (Phase 27+ spine tracker) ─────
    await client.query(`
      CREATE TABLE IF NOT EXISTS spinal_measurements (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        draft_id INTEGER,
        patient_id INTEGER,
        worklist_id INTEGER,
        vertebra_level TEXT NOT NULL,
        canal_ap TEXT,
        canal_transverse TEXT,
        canal_area TEXT,
        cord_ap TEXT,
        cord_transverse TEXT,
        cord_area TEXT,
        disc_height TEXT,
        stenosis_grade TEXT NOT NULL DEFAULT 'none',
        stenosis_notes TEXT,
        left_foraminal TEXT NOT NULL DEFAULT 'normal',
        right_foraminal TEXT NOT NULL DEFAULT 'normal',
        alignment TEXT NOT NULL DEFAULT 'normal',
        alignment_notes TEXT,
        measured_by TEXT NOT NULL,
        measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS spinal_measurements_study_idx ON spinal_measurements (study_id);
      CREATE INDEX IF NOT EXISTS spinal_measurements_draft_idx ON spinal_measurements (draft_id);
      CREATE INDEX IF NOT EXISTS spinal_measurements_level_idx ON spinal_measurements (vertebra_level);
      CREATE INDEX IF NOT EXISTS spinal_measurements_stenosis_idx ON spinal_measurements (stenosis_grade);

      CREATE TABLE IF NOT EXISTS radiology_smart_macros (
        id SERIAL PRIMARY KEY,
        created_by TEXT NOT NULL,
        shortcut TEXT NOT NULL,
        expansion TEXT NOT NULL,
        modality TEXT,
        body_part TEXT,
        is_measurement_macro BOOLEAN NOT NULL DEFAULT FALSE,
        measurement_params TEXT,
        auto_suggest_on BOOLEAN NOT NULL DEFAULT FALSE,
        is_global BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS smart_macros_creator_idx ON radiology_smart_macros (created_by);
      CREATE INDEX IF NOT EXISTS smart_macros_shortcut_idx ON radiology_smart_macros (shortcut);
      CREATE INDEX IF NOT EXISTS smart_macros_modality_idx ON radiology_smart_macros (modality);
      CREATE INDEX IF NOT EXISTS smart_macros_body_part_idx ON radiology_smart_macros (body_part);

      -- Echo Cardiology tables
      CREATE TABLE IF NOT EXISTS echo_measurements (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        patient_id INTEGER,
        height_cm REAL, weight_kg REAL, bsa REAL,
        bp_systolic INTEGER, bp_diastolic INTEGER, heart_rate INTEGER,
        ivsd REAL, ivss REAL, lvidd REAL, lvids REAL, lvpwd REAL, lvpws REAL,
        la_diameter REAL, la_volume REAL, la_volume_index REAL,
        ra_size REAL, aortic_root REAL, ascending_aorta REAL,
        rv_basal REAL, rv_mid REAL, rv_length REAL, tapase REAL, rvsp REAL,
        ef_simpson REAL, ef_teichholz REAL, fractional_shortening REAL,
        lv_mass REAL, lv_mass_index REAL, lvh BOOLEAN,
        relative_wall_thickness REAL, lv_geometry VARCHAR(30),
        mv_e REAL, mv_a REAL, mv_ea_ratio REAL, mv_decel_time REAL,
        mv_ee_prime REAL, septal_e_prime REAL, lateral_e_prime REAL,
        av_velocity REAL, av_gradient REAL, av_area REAL,
        tr_velocity REAL, tr_gradient REAL,
        pulmonary_velocity REAL, pulmonary_gradient REAL,
        diastolic_dysfunction_grade VARCHAR(20), pulmonary_hypertension BOOLEAN,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS echo_valve_assessment (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        valve_name VARCHAR(20) NOT NULL,
        morphology VARCHAR(20), stenosis VARCHAR(20),
        stenosis_notes TEXT, regurgitation VARCHAR(20),
        regurgitation_notes TEXT, additional_findings TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS echo_regional_wall (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        segment VARCHAR(30) NOT NULL,
        motion VARCHAR(20) NOT NULL DEFAULT 'normal',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS echo_reports (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        patient_id INTEGER,
        left_ventricle TEXT, right_ventricle TEXT,
        left_atrium TEXT, right_atrium TEXT,
        interatrial_septum TEXT, interventricular_septum TEXT,
        aortic_valve TEXT, mitral_valve TEXT,
        tricuspid_valve TEXT, pulmonary_valve TEXT,
        pericardium TEXT, doppler_findings TEXT,
        impression TEXT, recommendation TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        ai_draft TEXT,
        critical_alerts_acknowledged BOOLEAN DEFAULT FALSE,
        reviewed_by INTEGER, reviewed_at TIMESTAMPTZ,
        finalized_by INTEGER, finalized_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS echo_audit_logs (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        action VARCHAR(40) NOT NULL,
        performed_by VARCHAR(100) NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_echo_studies (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        ga_weeks INTEGER, ga_days INTEGER,
        edd VARCHAR(20), lmp VARCHAR(20),
        fetal_heart_rate INTEGER,
        situs VARCHAR(20), cardiac_axis VARCHAR(20), cardiac_position VARCHAR(20),
        av_concordance VARCHAR(20), va_concordance VARCHAR(20),
        ra_normal BOOLEAN, la_normal BOOLEAN, rv_normal BOOLEAN, lv_normal BOOLEAN,
        four_chamber_view VARCHAR(20), lvot VARCHAR(20), rvot VARCHAR(20),
        three_vessel_view VARCHAR(20), three_vessel_trachea_view VARCHAR(20),
        aortic_arch VARCHAR(20), ductal_arch VARCHAR(20),
        interatrial_septum TEXT, interventricular_septum TEXT,
        mitral_valve VARCHAR(20), tricuspid_valve VARCHAR(20),
        aortic_valve VARCHAR(20), pulmonary_valve VARCHAR(20),
        rhythm VARCHAR(20), rhythm_notes TEXT,
        umbilical_artery_pi REAL, umbilical_artery_ri REAL,
        ductus_venosus_pi REAL, ductus_venosus_a_wave VARCHAR(10),
        mca_pi REAL, mca_ri REAL, cpr REAL,
        suspected_abnormalities TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        ai_draft TEXT,
        critical_alerts_acknowledged BOOLEAN DEFAULT FALSE,
        reviewed_by INTEGER, reviewed_at TIMESTAMPTZ,
        finalized_by INTEGER, finalized_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_echo_audit_logs (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        action VARCHAR(40) NOT NULL,
        performed_by VARCHAR(100) NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Fetal USG Level-4 tables
      CREATE TABLE IF NOT EXISTS fetal_usg_studies (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        study_type VARCHAR(40) NOT NULL DEFAULT 'unknown',
        trimester VARCHAR(10) NOT NULL DEFAULT 'unknown',
        lmp VARCHAR(20),
        ga_weeks INTEGER,
        ga_days INTEGER,
        edd VARCHAR(20),
        lmp_ga INTEGER,
        biometric_ga INTEGER,
        composite_ga INTEGER,
        parity VARCHAR(20),
        gravida INTEGER,
        is_twin BOOLEAN DEFAULT FALSE,
        chorionicity VARCHAR(20),
        amnionicity VARCHAR(20),
        doppler_study_done BOOLEAN DEFAULT FALSE,
        bpp_done BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) NOT NULL DEFAULT 'received',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_usg_measurements (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES fetal_usg_studies(id),
        crl NUMERIC(6,2), msd NUMERIC(6,2), yolk_sac NUMERIC(6,2), fetal_heart_rate INTEGER,
        nt NUMERIC(5,2), nasal_bone VARCHAR(20), ductus_venosus VARCHAR(20), tricuspid_flow VARCHAR(20),
        bpd NUMERIC(6,2), hc NUMERIC(6,2), ac NUMERIC(6,2), fl NUMERIC(6,2), hl NUMERIC(6,2),
        efw NUMERIC(8,2), efw_percentile NUMERIC(5,2),
        afi NUMERIC(5,1), afi_interpretation VARCHAR(30), sdp NUMERIC(5,1),
        placenta_location VARCHAR(30), placenta_grade VARCHAR(10), presentation VARCHAR(20),
        cervical_length NUMERIC(5,2), cervical_length_interpretation VARCHAR(30),
        umbilical_artery_pi NUMERIC(5,2), umbilical_artery_ri NUMERIC(5,2), umbilical_artery_sd NUMERIC(5,2),
        mca_pi NUMERIC(5,2), mca_ri NUMERIC(5,2), cpr NUMERIC(5,2),
        ductus_venosus_pi NUMERIC(5,2), ductus_venosus_a_wave VARCHAR(10),
        uterine_artery_pi NUMERIC(5,2), uterine_artery_ri NUMERIC(5,2),
        extracted_from VARCHAR(20) DEFAULT 'manual', confidence_score INTEGER,
        twin_a_fhr INTEGER, twin_a_bpd NUMERIC(6,2), twin_a_hc NUMERIC(6,2), twin_a_ac NUMERIC(6,2), twin_a_fl NUMERIC(6,2), twin_a_efw NUMERIC(8,2), twin_a_presentation VARCHAR(20),
        twin_b_fhr INTEGER, twin_b_bpd NUMERIC(6,2), twin_b_hc NUMERIC(6,2), twin_b_ac NUMERIC(6,2), twin_b_fl NUMERIC(6,2), twin_b_efw NUMERIC(8,2), twin_b_presentation VARCHAR(20),
        discordance_percent NUMERIC(5,2),
        bpp_fetal_breathing INTEGER, bpp_fetal_movement INTEGER, bpp_fetal_tone INTEGER, bpp_afi INTEGER, bpp_total INTEGER,
        nst_done BOOLEAN DEFAULT FALSE, nst_result VARCHAR(30),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_usg_checklists (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES fetal_usg_studies(id),
        skull_brain VARCHAR(20) DEFAULT 'not_assessed',
        face VARCHAR(20) DEFAULT 'not_assessed',
        spine VARCHAR(20) DEFAULT 'not_assessed',
        thorax VARCHAR(20) DEFAULT 'not_assessed',
        heart_four_chamber VARCHAR(20) DEFAULT 'not_assessed',
        outflow_tracts VARCHAR(20) DEFAULT 'not_assessed',
        abdomen VARCHAR(20) DEFAULT 'not_assessed',
        stomach_bubble VARCHAR(20) DEFAULT 'not_assessed',
        kidneys VARCHAR(20) DEFAULT 'not_assessed',
        urinary_bladder VARCHAR(20) DEFAULT 'not_assessed',
        cord_insertion VARCHAR(20) DEFAULT 'not_assessed',
        limbs VARCHAR(20) DEFAULT 'not_assessed',
        placenta VARCHAR(20) DEFAULT 'not_assessed',
        liquor VARCHAR(20) DEFAULT 'not_assessed',
        cervix VARCHAR(20) DEFAULT 'not_assessed',
        notes TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_usg_reports (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES fetal_usg_studies(id),
        findings TEXT,
        impression TEXT,
        recommendation TEXT,
        ai_draft TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        reviewed_by INTEGER,
        reviewed_at TIMESTAMPTZ,
        finalized_by INTEGER,
        finalized_at TIMESTAMPTZ,
        critical_alerts_acknowledged BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_usg_audit_logs (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES fetal_usg_studies(id),
        action VARCHAR(40) NOT NULL,
        performed_by VARCHAR(100) NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_usg_critical_alerts (
        id SERIAL PRIMARY KEY,
        study_id INTEGER NOT NULL REFERENCES fetal_usg_studies(id),
        alert_type VARCHAR(40) NOT NULL,
        alert_message TEXT NOT NULL,
        acknowledged BOOLEAN DEFAULT FALSE,
        acknowledged_by VARCHAR(100),
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fetal_usg_template_preferences (
        id SERIAL PRIMARY KEY,
        doctor_id INTEGER NOT NULL,
        study_type VARCHAR(40) NOT NULL,
        template_json JSON NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    logger.info("Startup migrations applied");
  } catch (err) {
    logger.error({ err }, "Startup migration failed — partial-cancel / outsourced-labs features may not work");
  } finally {
    client.release();
  }
}

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — exiting");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — continuing");
  // Do NOT exit: crashing on every unhandled rejection prevents the server
  // from ever passing its startup health check if a background operation
  // (cron job, startup backfill, etc.) rejects in the production environment.
  // Log the rejection so it is visible in deployment logs and investigate.
});

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen({ port, exclusive: true }, () => {
  logger.info({ port }, "Server listening");

  // Cron schedulers must NOT run on autoscale deployments: containers can
  // scale to zero and miss firing windows, and every cold start would
  // re-init the scheduler. Enable them only on always-on hosts (Reserved VM,
  // local dev, or the Windows desktop bundle) by setting ENABLE_SCHEDULERS=1.
  if (process.env["ENABLE_SCHEDULERS"] === "1" || process.env["ENABLE_SCHEDULERS"] === "true") {
    startCronScheduler();
    logger.info("Cron schedulers enabled (ENABLE_SCHEDULERS set)");
  } else {
    logger.info("Cron schedulers disabled (set ENABLE_SCHEDULERS=1 to enable)");
  }

  // In-process DICOM pull agent can also start independently of schedulers
  const enableDimse =
    process.env["ENABLE_DICOM_PULL_AGENT"] === "1" ||
    process.env["ENABLE_DICOM_PULL_AGENT"] === "true";
  if (enableDimse) {
    import("./services/dicom-pull-agent/dimse-agent").then((mod) => {
      if (!mod.isDimsePullAgentRunning()) {
        mod.startDimsePullAgent();
        logger.info("In-process DIMSE pull agent started (ENABLE_DICOM_PULL_AGENT set)");
      }
    }).catch((err) => {
      logger.error({ err }, "Failed to load DIMSE pull agent module");
    });
  }

  runStartupMigrations().catch((e) => {
    // runStartupMigrations runs ADD COLUMN IF NOT EXISTS patches that are also
    // done by db-patch-v2, so failures here are non-fatal (db-patch-v2 already
    // guaranteed the schema). Log and continue — do NOT crash the API server
    // because the migrations here are belt-and-suspenders, not the primary path.
    logger.error({ err: e }, "Startup migration warning (non-fatal — schema was verified by db-patch-v2)");
  });
  ensureDefaultLedger().catch((e) => logger.error({ err: e }, "Failed to seed default ledger"));
  backfillExpirePublicTokens().catch((e) => logger.error({ err: e }, "Failed to backfill public token expiry"));

  // seedBootstrapAdmin: run immediately and await — if the admin row is missing
  // the system is unusable. Log the error clearly but do not crash (the row may
  // have been manually deleted; the rest of the API still works).
  seedBootstrapAdminIfNeeded().catch((e) => {
    logger.error({ err: e }, "Failed to seed/update bootstrap admin — login may not work");
  });

  // Seed OHIF_URL + WADO_URL and other configuration values from env into pacs_settings
  // so the centralized configuration service can read them from DB without needing hardcoded IP fallbacks.
  // Uses ON CONFLICT DO NOTHING — never overwrites an admin-configured value.
  (async () => {
    try {
      const defaultHost = process.env.ORTHANC_URL 
        ? new URL(process.env.ORTHANC_URL).hostname 
        : "192.168.1.137";
      const erpBase = process.env["PUBLIC_BASE_URL"] || `http://${defaultHost}:8888`;

      const pairs: Array<{ key: string; value: string | undefined; category: string }> = [
        { key: "ohif_base_url",      value: process.env["OHIF_URL"] || `http://${defaultHost}:3010`,       category: "viewer" },
        { key: "wado_uri_base_url",  value: process.env["WADO_URL"] || `http://${defaultHost}:8042/wado`,  category: "viewer" },
        { key: "dicom_web_base_url",  value: `${process.env["ORTHANC_URL"] || `http://${defaultHost}:8042`}/dicom-web`, category: "viewer" },
        { key: "pacs_ip",            value: defaultHost,                                                   category: "viewer" },
        { key: "pacs_port",          value: "5678",                                                        category: "viewer" },
        { key: "pacs_ae_title",      value: "ORTHANC",                                                     category: "viewer" },
        { key: "orthanc_url",        value: process.env["ORTHANC_URL"] || `http://${defaultHost}:8042`,    category: "orthanc" },
        { key: "orthanc_ae_title",   value: process.env["ORTHANC_AE_TITLE"] || "ORTHANC",                  category: "orthanc" },
        { key: "orthanc_ip",         value: defaultHost,                                                   category: "orthanc" },
        { key: "orthanc_dicom_port", value: "4242",                                                        category: "orthanc" },
        { key: "orthanc_http_port",  value: "8042",                                                        category: "orthanc" },
        { key: "orthanc_dicomweb_url", value: `${process.env["ORTHANC_URL"] || `http://${defaultHost}:8042`}/dicom-web`, category: "orthanc" },
        { key: "orthanc_wado_url",    value: `${process.env["ORTHANC_URL"] || `http://${defaultHost}:8042`}/wado`,      category: "orthanc" },
        { key: "conquest_ae_title",   value: process.env["CONQUEST_AE_TITLE"] || "CONQUESTPACS",            category: "conquest" },
        { key: "conquest_ip",         value: process.env["CONQUEST_HOST"] || defaultHost,                  category: "conquest" },
        { key: "conquest_port",       value: process.env["CONQUEST_PORT"] || "5678",                       category: "conquest" },
        { key: "conquest_wado_url",   value: "",                                                            category: "conquest" },
        { key: "erp_lan_url",         value: erpBase,                                                       category: "erp" },
        { key: "erp_internal_api_url", value: `${erpBase}/api/internal`,                                    category: "erp" },
      ];
      for (const { key, value, category } of pairs) {
        if (!value) continue;
        await pool.query(
          `INSERT INTO pacs_settings (key, value, category, is_secret)
           VALUES ($1, $2, $3, false)
           ON CONFLICT (key, category) DO NOTHING`,
          [key, value, category]
        );
      }
      logger.info("PACS env vars seeded into pacs_settings (idempotent, no automatic replacements)");
      validateRadiologyConfig().then((warnings) => {
        if (warnings.length > 0) {
          logger.warn({ warnings }, `Radiology settings startup validation warnings:\n${warnings.map(w => ` - ${w}`).join("\n")}`);
        } else {
          logger.info("Radiology Settings startup validation passed successfully.");
        }
      }).catch((err) => {
        logger.error({ err }, "Failed to run startup validation for Radiology Settings");
      });
    } catch (e) {
      logger.warn({ err: e }, "Could not seed PACS env vars into pacs_settings");
    }
  })();
});

server.on("error", (err) => {
  logger.error({ err }, "Server failed to bind — exiting");
  process.exit(1);
});

// ─── Graceful shutdown ─────────────────────────────────────────────
// SIGINT  = Ctrl+C from terminal
// SIGTERM = Docker stop / platform shutdown signal

function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully...");

  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });

  // Force exit after 10 seconds if connections are stuck
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
