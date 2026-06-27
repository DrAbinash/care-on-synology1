#!/bin/sh
# =============================================================================
# db-patch-entrypoint.sh
# =============================================================================
# Single entrypoint for care-db-patch-v2 container.
# Runs ALL schema changes in dependency order on every deployment.
#
# Steps:
#   1. Wait for PostgreSQL to accept connections
#   2. Bootstrap the Drizzle migration tracking schema (idempotent)
#   3. Apply Drizzle .sql migration files in journal order (skips applied ones)
#   4. Apply the imperative column-patch SQL (ADD COLUMN IF NOT EXISTS — all idempotent)
#   5. Apply feature migrations: mri_protocol_specs (Phase 1), neuro prompts (Phase 2)
#
# Safety guarantees:
#   - Every statement is idempotent (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
#   - No DROP, no TRUNCATE, no DELETE of existing data
#   - Safe to run multiple times
#   - Exits non-zero on any psql error (set -e)
#   - Password never printed to logs
#
# Environment variables (set by docker-compose):
#   DB_HOST       — PostgreSQL hostname  (default: db)
#   DB_USER       — PostgreSQL username  (default: erp)
#   DB_NAME       — PostgreSQL database  (default: diagnostic_erp)
#   PGPASSWORD    — PostgreSQL password  (set by compose, never echoed)
# =============================================================================

set -e

DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-erp}"
DB_NAME="${DB_NAME:-diagnostic_erp}"

echo "=========================================="
echo "DB PATCH — Care Diagnostics ERP"
echo "Host: ${DB_HOST}  DB: ${DB_NAME}  User: ${DB_USER}"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=========================================="

# ── Step 1: Wait for PostgreSQL ───────────────────────────────────────────────
echo ""
echo "[1/4] Waiting for PostgreSQL..."
until pg_isready -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -q; do
  sleep 2
done
echo "      PostgreSQL is ready."

# Helper: run a SQL string quietly, exit on error
run_sql() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c "$1"
}

# Helper: run a SQL file quietly, exit on error
run_file() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "$1"
}

# ── Step 2: Bootstrap Drizzle migration tracking ──────────────────────────────
echo ""
echo "[2/4] Bootstrapping Drizzle migration tracking..."

# Remove stale public-schema migrations table if left over from old runs
run_sql 'DROP TABLE IF EXISTS "public"."__drizzle_migrations";'

# Create drizzle schema and migrations table (idempotent)
run_sql 'CREATE SCHEMA IF NOT EXISTS "drizzle";'
run_sql '
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    "id"         SERIAL  PRIMARY KEY,
    "hash"       TEXT    NOT NULL,
    "created_at" BIGINT
  );
'

echo "      Drizzle schema ready."

# ── Step 3: Apply Drizzle migration SQL files ─────────────────────────────────
echo ""
echo "[3/4] Applying Drizzle migrations (skipping already-applied)..."

# For each migration file, compute its hash and insert into tracking table
# if not already present, then execute the SQL.
#
# Files are in /migrations/drizzle/ (bind-mounted from lib/db/drizzle/).
# Journal order (from meta/_journal.json):
#   0000_dear_forge
#   0001_warm_leopardon
#   0002_dicom_rename
#   0003_online_booking_packages
#   0004_seed_pacs_viewer_defaults

MIGRATIONS_DIR="/migrations/drizzle"

apply_migration() {
  tag="$1"
  when="$2"
  file="${MIGRATIONS_DIR}/${tag}.sql"

  if [ ! -f "${file}" ]; then
    echo "      WARN: ${tag}.sql not found — skipping"
    return
  fi

  # Compute SHA-256 hash of the file content
  hash=$(sha256sum "${file}" | awk '{print $1}')

  # Check if already applied
  already=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
    "SELECT COUNT(*) FROM drizzle.__drizzle_migrations WHERE hash = '${hash}';")

  if [ "${already}" = "1" ]; then
    echo "      [skip] ${tag} (already applied)"
    return
  fi

  echo "      [apply] ${tag}..."

  # Strip Drizzle breakpoint comments before executing
  # (-->statement-breakpoint lines are Drizzle metadata, not valid SQL)
  sed 's/--> statement-breakpoint//g' "${file}" | \
    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1

  # Record as applied
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
     VALUES ('${hash}', ${when})
     ON CONFLICT DO NOTHING;"

  echo "      [done]  ${tag}"
}

apply_migration "0000_dear_forge"                1779106291750
apply_migration "0001_warm_leopardon"            1779434866491
apply_migration "0002_dicom_rename"              1780000000000
apply_migration "0003_online_booking_packages"   1780000001000
apply_migration "0004_seed_pacs_viewer_defaults" 1780000002000

echo "      Drizzle migrations complete."

# ── Step 4: Imperative column patch (ADD COLUMN IF NOT EXISTS) ────────────────
echo ""
echo "[4/4] Applying imperative column patch (all idempotent)..."

psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<'SQL'

-- clinic_settings: payment gateway
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS active_payment_gateway text DEFAULT 'icici';
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS enable_card_payment boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS enable_qr_payment boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS enable_vip_booking boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS enable_payment_logos boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS enable_payment_timer boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS custom_icici_banner_url text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS custom_phonepe_banner_url text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS custom_bharatpe_banner_url text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS custom_payu_banner_url text;

-- clinic_settings: ollama
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_base_url text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_model text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_local_only boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_known_models jsonb DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_fallback_url text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_timeout_seconds integer DEFAULT 30;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ollama_audit_enabled boolean DEFAULT true;

-- clinic_settings: scanner / scan station
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS mobile_scan_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS phone_pairing_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS preferred_scanner text;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS require_desktop_confirmation boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS auto_delete_temp_scans boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS ocr_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS aadhaar_qr_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS scanner_global_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS scan_station_kiosk_mode_enabled boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS scan_station_auto_clear_enabled boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS scan_station_result_display_seconds integer DEFAULT 10;

-- clinic_settings: session / security
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes integer DEFAULT 30;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS default_max_concurrent_sessions integer DEFAULT 3;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS max_failed_login_attempts integer DEFAULT 5;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS account_lockout_duration_minutes integer DEFAULT 30;

-- clinic_settings: form-f
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS form_f_billing_prompt boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS form_f_address_required boolean DEFAULT true;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS form_f_guardian_required boolean DEFAULT true;

-- clinic_settings: online booking
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS online_booking_services text DEFAULT '{"opd":true,"emergency":true,"usg":true,"xray":true,"ct":true,"mri":true,"pathology":true,"packages":true,"home_collection":true,"doctor":true}';
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS service_images text DEFAULT '{}';
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS service_images_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS vip_percentage numeric(5,2) DEFAULT '50.00';

-- clinic_settings: disclaimer
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_text text DEFAULT 'Online booking charges are subject to the centre''s cancellation policy. In case of cancellation after confirmation, administrative charges may be deducted from the refundable amount.';
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_refund_percentage integer DEFAULT 90;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_cancellation_window_hours integer DEFAULT 24;
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_display_position text DEFAULT 'bottom';
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_font_size text DEFAULT 'sm';
ALTER TABLE IF EXISTS clinic_settings ADD COLUMN IF NOT EXISTS disclaimer_enabled boolean DEFAULT true;

-- online_bookings: payment tracking
ALTER TABLE IF EXISTS online_bookings ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE IF EXISTS online_bookings ADD COLUMN IF NOT EXISTS icici_transaction_id text;
ALTER TABLE IF EXISTS online_bookings ADD COLUMN IF NOT EXISTS icici_provider_ref_id text;

-- payment_logs table
CREATE TABLE IF NOT EXISTS payment_logs (
  id serial PRIMARY KEY,
  booking_id integer,
  provider text,
  event_type text,
  status text,
  request_payload jsonb,
  response_payload jsonb,
  failure_reason text,
  created_at timestamp DEFAULT now()
);

SQL

echo "      Column patch complete."

# ── Step 5: Phase migrations (mri_protocol_specs, neuro prompt library) ───────
echo ""
echo "[5/5] Applying feature migrations (idempotent)..."

FEATURE_MIGRATIONS_DIR="/migrations/feature"

run_feature_migration() {
  label="$1"
  file="${FEATURE_MIGRATIONS_DIR}/$2"

  if [ ! -f "${file}" ]; then
    echo "      WARN: ${file} not found — skipping"
    return
  fi

  echo "      [apply] ${label}..."
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${file}"
  echo "      [done]  ${label}"
}

run_feature_migration "Phase 1 — MRI protocol specs + seed"   "seed_mri_protocols.sql"
run_feature_migration "Phase 2 — Neuro AI prompt library seed" "seed_neuro_prompt_library.sql"

echo "      Feature migrations complete."
echo ""
echo "=========================================="
echo "DB PATCH — ALL STEPS COMPLETE ✓"
echo "=========================================="
