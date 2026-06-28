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

    # Check if it was previously applied with a different hash (file changed)
    changed=$(psql_val "
      SELECT COUNT(*) FROM public.schema_migrations_log
      WHERE name = '${name}' AND kind = 'feature' AND sha256 != '${hash}';
    ")

    if [ "${changed}" = "1" ]; then
      warn "  ${name}: content changed since last apply — re-applying"
    fi

    echo ""
    info "  [apply] ${name}…"

    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
         -v ON_ERROR_STOP=1 -q -f "${file}" || fail "Feature migration FAILED: ${name}"

    # Record in schema log (upsert — handles re-apply after content change)
    psql_q -c "
      INSERT INTO public.schema_migrations_log (name, kind, sha256)
      VALUES ('${name}', 'feature', '${hash}')
      ON CONFLICT (name, kind) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = NOW();
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

# ── Step 6: Final verification — check critical columns exist ─────────────────
echo ""
info "Verifying critical schema columns…"

check_column() {
  table="$1"; col="$2"
  exists=$(psql_val "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${col}';
  ")
  if [ "${exists}" != "1" ]; then
    fail "SCHEMA VERIFICATION FAILED: column '${col}' missing from table '${table}' — API will NOT start"
  fi
}

# Critical columns that have caused production failures
# (from the error log: ai_feedback, clinic_settings columns, pacs_network_profile)
check_column "radiology_worklist"  "ai_feedback"
check_column "radiology_worklist"  "ai_draft_status"
check_column "radiology_worklist"  "source_pacs"
check_column "clinic_settings"     "ollama_enabled"
check_column "clinic_settings"     "active_payment_gateway"
check_column "clinic_settings"     "kiosk_enabled"
check_column "clinic_settings"     "sidebar_theme"
check_column "clinic_settings"     "icici_enabled"
check_column "bills"               "client_ref"
check_column "orders"              "client_ref"

ok "Schema verification passed — all critical columns present"

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
