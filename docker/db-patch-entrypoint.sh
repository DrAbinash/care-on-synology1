#!/bin/sh
# =============================================================================
# db-patch-entrypoint.sh — Zero-touch schema migration for Care Diagnostics ERP
# =============================================================================
#
# DESIGN:
#   Every future Drizzle migration and feature migration is detected and applied
#   AUTOMATICALLY. No file needs to be edited when new migrations are added.
#
#   Drizzle migrations:  detected from lib/db/drizzle/meta/_journal.json
#   Feature migrations:  auto-discovered from migrations/ in alphabetical order
#   Column patches:      applied from runStartupMigrations() in the API itself
#
# STARTUP ORDER (enforced by docker-compose depends_on):
#   care-db (healthy)
#     → care-db-patch-v2  (this script, exits 0 or fails hard)
#       → care-api         (starts ONLY after this exits 0)
#         → care-web       (starts ONLY after care-api is healthy)
#
# FAILURE BEHAVIOUR:
#   Any psql error → set -e causes immediate non-zero exit.
#   docker-compose service_completed_successfully condition means care-api
#   NEVER starts if this script exits non-zero. Schema mismatch is impossible.
#
# LOGS:
#   ✓ Database connected
#   ✓ Migration tracking ready
#   ✓ Drizzle migration applied: 0005_mri_protocol_specs
#   ✓ Feature migration applied: add_bill_order_idempotency.sql
#   ✓ Schema fingerprint recorded
#   ✓ All migrations complete — API may start
#   or
#   ✗ Migration FAILED — API will NOT start
#
# =============================================================================

set -e

DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-erp}"
DB_NAME="${DB_NAME:-diagnostic_erp}"
DRIZZLE_DIR="/migrations/drizzle"
FEATURE_DIR="/migrations/feature"
JOURNAL="${DRIZZLE_DIR}/meta/_journal.json"

# Terminal colours (only when connected to a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; NC=''
fi

ok()   { echo "${GREEN}  ✓ ${1}${NC}"; }
fail() { echo "${RED}  ✗ ${1}${NC}"; exit 1; }
info() { echo "${BLUE}  ▸ ${1}${NC}"; }
warn() { echo "${YELLOW}  ! ${1}${NC}"; }

echo ""
echo "============================================================"
echo "  Care Diagnostics ERP — Schema Migration"
echo "  Host: ${DB_HOST}  DB: ${DB_NAME}  User: ${DB_USER}"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"
echo ""

# ── Step 1: Wait for PostgreSQL ───────────────────────────────────────────────
info "Waiting for PostgreSQL…"
MAX_WAIT=60
waited=0
until pg_isready -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -q 2>/dev/null; do
  if [ "${waited}" -ge "${MAX_WAIT}" ]; then
    fail "PostgreSQL did not become ready after ${MAX_WAIT}s — aborting"
  fi
  sleep 2
  waited=$((waited + 2))
done
ok "Database connected (${DB_HOST}/${DB_NAME})"

# Helpers
psql_q() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
       -v ON_ERROR_STOP=1 -q "$@" 2>&1 || fail "psql failed: $*"
}
psql_val() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -tAq -c "$1" 2>/dev/null
}

# ── Step 2: Bootstrap migration tracking ─────────────────────────────────────
info "Bootstrapping migration tracking…"

psql_q -c 'DROP TABLE IF EXISTS "public"."__drizzle_migrations";'
psql_q -c 'CREATE SCHEMA IF NOT EXISTS "drizzle";'
psql_q -c '
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    "id"         SERIAL  PRIMARY KEY,
    "hash"       TEXT    NOT NULL,
    "created_at" BIGINT
  );
'

# Schema fingerprint table — records every migration applied, with timestamp
# Used by the API health check to verify schema is current before serving traffic
psql_q -c '
  CREATE TABLE IF NOT EXISTS "public"."schema_migrations_log" (
    "id"          SERIAL  PRIMARY KEY,
    "name"        TEXT    NOT NULL,
    "kind"        TEXT    NOT NULL DEFAULT '"'"'drizzle'"'"',
    "applied_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "sha256"      TEXT    NOT NULL,
    UNIQUE ("name", "kind")
  );
'

ok "Migration tracking ready"

# ── Step 3: Auto-apply Drizzle migrations from journal ───────────────────────
echo ""
info "Reading Drizzle journal from ${JOURNAL}…"

if [ ! -f "${JOURNAL}" ]; then
  fail "Journal not found at ${JOURNAL} — check bind mount"
fi

# Parse journal using python3 (available in postgres:16-alpine via pyenv or we use awk/grep)
# Use pure shell + grep approach — no python dependency needed
# Journal format: entries array with "tag" and "when" fields

applied_drizzle=0
skipped_drizzle=0

# Extract tags in order using grep + sed — pure POSIX
# Each entry looks like: { "idx": N, "version": "7", "when": NNN, "tag": "XXXX", ... }
tags=$(grep '"tag"' "${JOURNAL}" | sed 's/.*"tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
whens=$(grep '"when"' "${JOURNAL}" | sed 's/.*"when"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/')

# Zip tags and whens — process them together line by line
# Use temporary file to process pairs
tmpfile=$(mktemp)
paste <(echo "${tags}") <(echo "${whens}") > "${tmpfile}" 2>/dev/null || {
  # Fallback: process just tags with a fixed timestamp
  echo "${tags}" | while read -r t; do echo "${t} 0"; done > "${tmpfile}"
}

while IFS='	 ' read -r tag when; do
  [ -z "${tag}" ] && continue
  file="${DRIZZLE_DIR}/${tag}.sql"

  if [ ! -f "${file}" ]; then
    warn "Migration SQL not found: ${tag}.sql — skipping"
    continue
  fi

  # Compute SHA-256 of the file
  hash=$(sha256sum "${file}" | awk '{print $1}')

  # Check if already in Drizzle tracking table
  already=$(psql_val "SELECT COUNT(*) FROM drizzle.__drizzle_migrations WHERE hash = '${hash}';")

  if [ "${already}" = "1" ]; then
    info "  [skip] ${tag} (already applied)"
    skipped_drizzle=$((skipped_drizzle + 1))
    continue
  fi

  echo ""
  info "  [apply] ${tag}…"

  # Strip Drizzle breakpoint comments and execute
  sed 's/--> statement-breakpoint//g' "${file}" | \
    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
         -v ON_ERROR_STOP=1 -q || fail "Drizzle migration FAILED: ${tag}"

  # Record in Drizzle tracking table
  when_val="${when:-$(date +%s%3N)}"
  psql_q -c "
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES ('${hash}', ${when_val})
    ON CONFLICT DO NOTHING;
  "

  # Record in our schema log
  psql_q -c "
    INSERT INTO public.schema_migrations_log (name, kind, sha256)
    VALUES ('${tag}', 'drizzle', '${hash}')
    ON CONFLICT (name, kind) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = NOW();
  "

  ok "  Drizzle migration applied: ${tag}"
  applied_drizzle=$((applied_drizzle + 1))
done < "${tmpfile}"
rm -f "${tmpfile}"

echo ""
ok "Drizzle migrations: ${applied_drizzle} applied, ${skipped_drizzle} already current"

# ── Step 4: Auto-apply feature migrations (alphabetical, fully automatic) ────
echo ""
info "Scanning feature migrations in ${FEATURE_DIR}…"

if [ ! -d "${FEATURE_DIR}" ]; then
  warn "Feature migrations directory not found — skipping"
else
  applied_feature=0
  skipped_feature=0

  # Process all .sql files in alphabetical order — no manual registration needed
  for file in $(ls "${FEATURE_DIR}"/*.sql 2>/dev/null | sort); do
    [ -f "${file}" ] || continue
    name=$(basename "${file}")

    hash=$(sha256sum "${file}" | awk '{print $1}')

    # Check if already applied via our log table
    already=$(psql_val "
      SELECT COUNT(*) FROM public.schema_migrations_log
      WHERE name = '${name}' AND kind = 'feature' AND sha256 = '${hash}';
    ")

    if [ "${already}" = "1" ]; then
      info "  [skip] ${name} (already applied)"
      skipped_feature=$((skipped_feature + 1))
      continue
    fi

    # Check if it was previously applied with a different hash (file changed).
    # IMPORTANT: we do NOT re-apply on hash change.
    # Feature migrations run exactly once. Re-applying risks running a migration
    # against tables that may not exist (e.g. payment_logs created post-API-start).
    # If a file genuinely needs to be re-applied, do so manually.
    # We just update the hash in the log and warn the operator.
    changed=$(psql_val "
      SELECT COUNT(*) FROM public.schema_migrations_log
      WHERE name = '${name}' AND kind = 'feature' AND sha256 != '${hash}';
    ")

    if [ "${changed}" = "1" ]; then
      warn "  ${name}: file content has changed since last apply."
      warn "    Old hash recorded in log — updating to current hash."
      warn "    NOT re-applying. If re-apply needed, do it manually."
      psql_q -c "
        UPDATE public.schema_migrations_log
        SET sha256 = '${hash}', applied_at = NOW()
        WHERE name = '${name}' AND kind = 'feature';
      "
      skipped_feature=$((skipped_feature + 1))
      continue
    fi

    echo ""
    info "  [apply] ${name}…"

    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
         -v ON_ERROR_STOP=1 -q -f "${file}" || fail "Feature migration FAILED: ${name}"

    # Record in schema log
    psql_q -c "
      INSERT INTO public.schema_migrations_log (name, kind, sha256)
      VALUES ('${name}', 'feature', '${hash}')
      ON CONFLICT (name, kind) DO NOTHING;
    "

    ok "  Feature migration applied: ${name}"
    applied_feature=$((applied_feature + 1))
  done

  echo ""
  ok "Feature migrations: ${applied_feature} applied, ${skipped_feature} already current"
fi

# ── Step 5: Record schema fingerprint for API health check ───────────────────
echo ""
info "Recording schema fingerprint…"

total_applied=$(psql_val "SELECT COUNT(*) FROM public.schema_migrations_log;")
last_applied=$(psql_val "SELECT MAX(applied_at) FROM public.schema_migrations_log;")

# Store the current deployment fingerprint in a simple key/value table
psql_q -c "
  CREATE TABLE IF NOT EXISTS public.schema_deploy_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO public.schema_deploy_state (key, value)
  VALUES
    ('total_migrations', '${total_applied}'),
    ('last_migration_at', '${last_applied:-never}'),
    ('patch_version', '$(date -u +%Y%m%d%H%M%S)'),
    ('db_patch_ok', 'true')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
"

ok "Schema fingerprint recorded (${total_applied} migrations total)"

# ── Step 5b: Record ERP version metadata ─────────────────────────────────────
# These env vars are set by docker-compose build args → Dockerfile ENV
# and passed through to the db-patch container's environment.
# We store them in schema_deploy_state so /api/system/version and
# /api/health/schema can read them without needing the API to be running.
ERP_VER="${ERP_VERSION:-unknown}"
BUILD_NO="${BUILD_NUMBER:-0}"
RELEASE="${RELEASE_NAME:-}"
GIT_SHA="${GIT_COMMIT:-unknown}"
GIT_BR="${GIT_BRANCH:-unknown}"
GIT_TG="${GIT_TAG:-unknown}"
BUILD_DT="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

psql_q -c "
  INSERT INTO public.schema_deploy_state (key, value)
  VALUES
    ('erp_version',      '${ERP_VER}'),
    ('build_number',     '${BUILD_NO}'),
    ('release_name',     '${RELEASE}'),
    ('git_commit',       '${GIT_SHA}'),
    ('git_branch',       '${GIT_BR}'),
    ('git_tag',          '${GIT_TG}'),
    ('build_date',       '${BUILD_DT}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
"
ok "ERP version recorded: v${ERP_VER} build ${BUILD_NO} (${RELEASE})"

# ── Step 6: SQL-based schema verification ─────────────────────────────────────
# This runs inside the postgres:alpine container using psql.
# It checks tables and columns that are known to have caused production failures.
# The full deep verification (all 150+ tables) runs in the separate
# care-schema-verify Node.js service which has access to the migration SQL files.
echo ""
info "Running SQL schema verification…"

# ── 6a: Check core tables exist ─────────────────────────────────────────────
check_table() {
  tbl="$1"
  exists=$(psql_val "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '${tbl}' AND table_type = 'BASE TABLE';
  ")
  if [ "${exists}" != "1" ]; then
    fail "SCHEMA FAIL: table '${tbl}' is missing — API will NOT start"
  fi
}

# Core tables that MUST exist for the API to function at all
check_table "users"
check_table "clinic_settings"
check_table "patients"
check_table "bills"
check_table "payments"
check_table "orders"
check_table "order_tests"
check_table "diagnostic_tests"
check_table "doctors"
check_table "ledgers"
check_table "radiology_worklist"
ok "Core tables: all present"

# ── 6b: Check critical columns — full diagnostic output ─────────────────────
# Queries every expected column and prints a detailed per-table report
# if anything is missing. No column failure remains hidden.
info "Checking critical schema columns…"

# Get a per-row result: one row per missing column (table, column)
missing_detail=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -tAq -c "
  SELECT t.tbl || '|' || t.col
  FROM (VALUES
    ('radiology_worklist', 'ai_feedback')
    ('radiology_worklist', 'ai_draft_status')
    ('radiology_worklist', 'source_pacs')
    ('radiology_worklist', 'source_ae_title')
    ('radiology_worklist', 'match_score')
    ('radiology_worklist', 'assigned_radiologist')
    ('radiology_worklist', 'patient_match_status')
    ('clinic_settings', 'ollama_enabled')
    ('clinic_settings', 'ollama_base_url')
    ('clinic_settings', 'ollama_model')
    ('bills', 'client_ref')
    ('bills', 'cancelled_at')
    ('bills', 'refund_amount')
    ('bills', 'original_total')
    ('orders', 'client_ref')
    ('orders', 'collected_at')
    ('order_tests', 'status')
    ('order_tests', 'cancelled_at')
    ('diagnostic_tests', 'department')
    ('diagnostic_tests', 'test_type')
    ('diagnostic_tests', 'room_id')
    ('patients', 'age_value')
    ('patients', 'age_unit')
    ('patients', 'ledger_id')
    ('printer_settings', 'barcode_enabled')
    ('printer_settings', 'token_enabled')
    ('patient_reports', 'style_preset_used')
    ('users', 'sidebar_theme')
    ('users', 'default_start_page')
    ('users', 'pacs_network_profile')
    ('order_tests', 'cancelled_by_name')
    ('order_tests', 'cancellation_reason')
    ('diagnostic_tests', 'room_number')
    ('diagnostic_tests', 'outsourced_lab_id')
    ('clinic_settings', 'kiosk_enabled')
    ('clinic_settings', 'kiosk_payment_gateway')
    ('clinic_settings', 'kiosk_upi_vpa')
    ('clinic_settings', 'kiosk_upi_name')
    ('clinic_settings', 'kiosk_welcome_message')
    ('clinic_settings', 'kiosk_allowed_test_ids')
    ('clinic_settings', 'sidebar_theme')
    ('clinic_settings', 'bill_default_paper_size')
    ('clinic_settings', 'bill_show_code')
    ('clinic_settings', 'bill_show_category')
    ('clinic_settings', 'day_close_auto_print')
    ('clinic_settings', 'commission_discount_mode')
    ('clinic_settings', 'lan_only_login')
    ('clinic_settings', 'lan_allowed_ips')
    ('clinic_settings', 'fido2_enabled')
    ('clinic_settings', 'registered_address')
    ('clinic_settings', 'icici_enabled')
    ('clinic_settings', 'icici_merchant_id')
    ('clinic_settings', 'icici_aggregator_id')
    ('clinic_settings', 'icici_secret_key')
    ('clinic_settings', 'online_booking_services')
    ('clinic_settings', 'service_images')
    ('clinic_settings', 'service_images_enabled')
    ('clinic_settings', 'vip_percentage')
    ('clinic_settings', 'disclaimer_text')
    ('clinic_settings', 'disclaimer_refund_percentage')
    ('clinic_settings', 'disclaimer_cancellation_window_hours')
    ('clinic_settings', 'disclaimer_display_position')
    ('clinic_settings', 'disclaimer_font_size')
    ('clinic_settings', 'disclaimer_enabled')
    ('online_bookings', 'icici_transaction_id')
    ('online_bookings', 'icici_provider_ref_id')
    ('online_bookings', 'age_value')
    ('online_bookings', 'age_unit')
    ('online_bookings', 'gender')
    ('clinic_settings', 'active_payment_gateway')
    ('clinic_settings', 'enable_card_payment')
    ('clinic_settings', 'enable_qr_payment')
    ('clinic_settings', 'enable_vip_booking')
    ('clinic_settings', 'enable_payment_logos')
    ('clinic_settings', 'enable_payment_timer')
    ('clinic_settings', 'custom_icici_banner_url')
    ('clinic_settings', 'custom_phonepe_banner_url')
    ('clinic_settings', 'custom_bharatpe_banner_url')
    ('clinic_settings', 'custom_payu_banner_url')
    ('kiosk_payment_sessions', 'patient_details')
    ('kiosk_payment_sessions', 'gateway')
    ('kiosk_payment_sessions', 'icici_transaction_id')
    ('kiosk_payment_sessions', 'icici_provider_ref_id')
    ('dicom_modalities', 'watch_folder_path')
    ('dicom_modalities', 'c_store_port')
    ('dicom_modalities', 'usb_auto_import_enabled')
    ('dicom_modalities', 'non_dicom_import_enabled')
    ('dicom_nodes', 'preferred_retrieve_method')
    ('radiology_worklist', 'dicom_patient_id')
    ('radiology_worklist', 'dicom_metadata')
    ('radiology_worklist', 'ai_draft_json')
    ('radiology_worklist', 'ai_feedback_at')
    ('radiology_worklist', 'match_points')
    ('radiology_worklist', 'match_reasons')
    ('radiology_worklist', 'match_warnings')
    ('radiology_worklist', 'match_decision')
    ('radiology_worklist', 'match_approved_by')
    ('radiology_worklist', 'match_approved_at')
    ('radiology_worklist', 'match_override_reason')
    ('diagnostic_tests', 'modality_id')
    ('diagnostic_tests', 'floor_label')
    ('ai_normal_report_templates', 'category')
    ('users', 'max_concurrent_sessions')
    ('clinic_settings', 'session_idle_timeout_minutes')
    ('clinic_settings', 'default_max_concurrent_sessions')
    ('clinic_settings', 'form_f_billing_prompt')
    ('clinic_settings', 'form_f_address_required')
    ('clinic_settings', 'form_f_guardian_required')
    ('portal_sessions', 'ip_address')
    ('portal_sessions', 'user_agent')
    ('portal_sessions', 'last_activity_at')
    ('users', 'failed_login_attempts')
    ('users', 'locked_until')
    ('clinic_settings', 'max_failed_login_attempts')
    ('clinic_settings', 'account_lockout_duration_minutes')
    ('audit_logs', 'previous_hash')
    ('audit_logs', 'chain_hash')
    ('users', 'remote_login_enabled')
    ('online_bookings', 'time_slot')
    ('online_bookings', 'failure_reason')
    ('clinic_settings', 'online_booking_enabled')
    ('clinic_settings', 'razorpay_key_id')
    ('clinic_settings', 'online_booking_ledger_id')
    ('clinic_settings', 'vip_queue_enabled')
    ('clinic_settings', 'payu_enabled')
    ('clinic_settings', 'payu_merchant_key')
    ('clinic_settings', 'online_booking_allowed_test_ids')
    ('ledgers', 'is_walk_in')
    ('radiology_studies', 'priority')
    ('radiology_studies', 'priority_reason')
    ('radiology_studies', 'priority_overridden_at')
    ('radiology_studies', 'priority_overridden_by')
    ('usg_report_drafts', 'verified_by')
    ('usg_report_drafts', 'verified_at')
    ('usg_report_drafts', 'amended_by')
    ('usg_report_drafts', 'amended_at')
    ('usg_report_drafts', 'prior_version_id')
    ('usg_report_drafts', 'critical_alert_id')
    ('usg_report_drafts', 'finalized_report_hash')
    ('usg_report_drafts', 'finalized_pdf_version_id')
    ('usg_report_drafts', 'amendment_reason')
    ('usg_report_drafts', 'sync_status')
    ('usg_report_drafts', 'locked_by')
    ('usg_measurements', 'right_kidney_length_mm')
    ('usg_measurements', 'right_kidney_width_mm')
    ('usg_measurements', 'right_kidney_thickness_mm')
    ('usg_measurements', 'left_kidney_length_mm')
    ('usg_measurements', 'left_kidney_width_mm')
    ('usg_measurements', 'left_kidney_thickness_mm')
    ('usg_measurements', 'right_cortical_thickness_mm')
    ('usg_measurements', 'left_cortical_thickness_mm')
    ('usg_measurements', 'prostate_length_mm')
    ('usg_measurements', 'prostate_width_mm')
    ('usg_measurements', 'prostate_height_mm')
    ('usg_measurements', 'thyroid_right_lobe_length_mm')
    ('usg_measurements', 'thyroid_right_lobe_width_mm')
    ('usg_measurements', 'thyroid_right_lobe_thickness_mm')
    ('usg_measurements', 'thyroid_left_lobe_length_mm')
    ('usg_measurements', 'thyroid_left_lobe_width_mm')
    ('usg_measurements', 'thyroid_left_lobe_thickness_mm')
    ('usg_measurements', 'thyroid_isthmus_mm')
    ('usg_measurements', 'thyroid_nodule_size_mm')
    ('usg_measurements', 'thyroid_tirads_score')
    ('usg_measurements', 'liver_span_mm')
    ('usg_measurements', 'cbd_mm')
    ('usg_measurements', 'gb_wall_mm')
    ('usg_measurements', 'uterus_length_mm')
    ('usg_measurements', 'uterus_width_mm')
    ('usg_measurements', 'uterus_height_mm')
    ('usg_measurements', 'right_ovary_length_mm')
    ('usg_measurements', 'right_ovary_width_mm')
    ('usg_measurements', 'right_ovary_height_mm')
    ('usg_measurements', 'left_ovary_length_mm')
    ('usg_measurements', 'left_ovary_width_mm')
    ('usg_measurements', 'left_ovary_height_mm')
    ('usg_measurements', 'follicle_count')
    ('usg_measurements', 'largest_follicle_mm')
    ('form_f_records', 'gestational_age_weeks')
    ('form_f_records', 'gestational_age_days')
    ('doctors', 'address')
    ('doctors', 'area')
  ) AS t(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name   = t.tbl
      AND c.column_name  = t.col
  )
  ORDER BY t.tbl, t.col;
" 2>&1)

if [ -n "${missing_detail}" ] && [ "${missing_detail}" != "" ]; then
  echo ""
  echo "${RED}  ✗ SCHEMA FAIL: Missing columns — API will NOT start${NC}"
  echo ""
  echo "  The following columns are expected by the ERP but not present in PostgreSQL:"
  echo ""

  # Print grouped by table for readability
  current_table=""
  echo "${missing_detail}" | while IFS='|' read -r tbl col; do
    if [ "${tbl}" != "${current_table}" ]; then
      echo "    Table: ${tbl}"
      current_table="${tbl}"
    fi
    echo "      ✗ ${col}"
  done

  echo ""
  echo "  Root cause: column defined in Drizzle TS schema but missing from SQL migrations."
  echo "  Fix:        git pull && docker compose up -d --build"
  echo "  Manual:     docker compose run --rm care-migrate"
  echo "  Report:     docker compose run --rm care-migrate node /repo/scripts/db-schema-report.cjs"
  echo ""
  exit 1
fi
ok "Critical columns: all present (181/181)"

# ── 6c: Record detailed schema state ────────────────────────────────────────
table_count=$(psql_val "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
col_count=$(psql_val "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public';")
idx_count=$(psql_val "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public';")

psql_q -c "
  INSERT INTO public.schema_deploy_state (key, value)
  VALUES
    ('live_table_count', '${table_count}'),
    ('live_column_count', '${col_count}'),
    ('live_index_count', '${idx_count}'),
    ('schema_verify_at', '$(date -u +%Y-%m-%dT%H:%M:%SZ)'),
    ('schema_verify_status', 'sql_pass')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
"

ok "Schema state recorded: ${table_count} tables, ${col_count} columns, ${idx_count} indexes"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "${GREEN}  ✓ All migrations complete — API may start${NC}"
echo "  Drizzle:  ${applied_drizzle} applied"
echo "  Feature:  ${applied_feature} applied"
echo "  Total:    ${total_applied} migrations tracked"
echo "  Time:     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"
echo ""
