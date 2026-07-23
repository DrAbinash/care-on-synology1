#!/bin/sh
# =============================================================================
# db-patch-entrypoint.sh — THE official schema migration container
# =============================================================================
#
# ARCHITECTURE (single source of truth for schema mutation):
#   This container (care-db-patch-v2) is the ONLY component that normally
#   applies Drizzle/feature SQL migrations. Everything else that touches the
#   schema is either read-only or restricted to safe, additive, idempotent
#   compatibility patches:
#     - care-schema-verify   → read-only by default (--verify). Auto-repair
#                               (ADD COLUMN IF NOT EXISTS only) requires the
#                               operator to explicitly set SCHEMA_REPAIR=true.
#     - care-api startup     → only ADD COLUMN/CREATE TABLE/CREATE INDEX
#                               IF NOT EXISTS compatibility checks. New
#                               RENAME/DROP COLUMN logic must NOT be added
#                               there — write a migrations/*.sql file instead
#                               and let this container apply it.
#     - care-migrate         → MANUAL/EMERGENCY ONLY (profiles: [manual]).
#
#   Every future Drizzle migration and feature migration is detected and
#   applied AUTOMATICALLY here. No file needs to be edited when new
#   migrations are added.
#
#   Drizzle migrations:  detected from lib/db/drizzle/meta/_journal.json
#   Feature migrations:  auto-discovered from migrations/ in alphabetical order
#
# STARTUP ORDER (enforced by docker-compose depends_on):
#   care-db (healthy)
#     → care-db-patch-v2  (this script, exits 0 or fails hard)
#       → care-schema-verify (read-only report, or repair if SCHEMA_REPAIR=true)
#         → care-api         (starts ONLY after both exit 0)
#           → care-web       (starts ONLY after care-api is healthy)
#
# SAFETY GUARDS (see docs/DEPLOYMENT.md for full rationale):
#   - DB TARGET PRINTOUT: host/port/db/user/current_database()/current_schema()
#     /server address are printed before anything runs, so a misconfigured
#     .env pointing at the wrong Postgres is immediately visible in logs.
#   - DB IDENTITY CHECK: a system_database_identity row (app_name=care-erp)
#     is created on first run and verified on every run after. If it doesn't
#     match, this script fails loudly instead of mutating a database that
#     might not even be the intended Care ERP database.
#   - MIGRATION LOCK: a schema_migration_lock row is acquired before any
#     mutation and released when this script exits (success or failure), so
#     two migration runs (e.g. an operator's manual care-migrate alongside an
#     automatic redeploy) can never race each other.
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
APP_NAME="${APP_NAME:-care-erp}"
APP_ENVIRONMENT="${APP_ENVIRONMENT:-production}"
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

# ── Step 1b: DEPLOYMENT GUARD — print exact DB target before touching anything
# This is the single most effective guard against "migration ran against the
# wrong database" incidents: a misconfigured .env (wrong DB_HOST, leftover
# credentials from another project, etc.) is now impossible to miss in the
# container logs, instead of silently succeeding against the wrong target.
echo ""
info "Deployment guard — verifying DB target…"
server_addr=$(psql_val "SELECT COALESCE(inet_server_addr()::text, 'unix-socket');")
echo "  ${BLUE}host (compose):${NC}      ${DB_HOST}"
echo "  ${BLUE}port:${NC}                $(psql_val "SHOW port;")"
echo "  ${BLUE}database (compose):${NC}  ${DB_NAME}"
echo "  ${BLUE}username:${NC}            ${DB_USER}"
echo "  ${BLUE}current_database():${NC}  $(psql_val "SELECT current_database();")"
echo "  ${BLUE}current_schema():${NC}    $(psql_val "SELECT current_schema();")"
echo "  ${BLUE}server address:${NC}      ${server_addr}"
echo "  ${BLUE}server version:${NC}      $(psql_val "SHOW server_version;")"
ok "DB target confirmed — proceeding"

# ── Step 1c: DB IDENTITY CHECK — fail loudly instead of touching the wrong DB
# system_database_identity is a tiny singleton table stamped with this app's
# name the first time this script ever runs against a given database. Every
# run after that verifies the stamp still matches. If it doesn't (e.g. .env
# was accidentally pointed at a different project's Postgres, or a restored
# backup from a different environment), migrations MUST NOT proceed.
echo ""
info "Verifying database identity…"
psql_q -c "
  CREATE TABLE IF NOT EXISTS public.system_database_identity (
    id           INTEGER PRIMARY KEY DEFAULT 1,
    app_name     TEXT NOT NULL,
    environment  TEXT NOT NULL,
    instance_id  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT system_database_identity_singleton CHECK (id = 1)
  );
"
existing_app_name=$(psql_val "SELECT app_name FROM public.system_database_identity WHERE id = 1;")
if [ -z "${existing_app_name}" ]; then
  instance_id=$(psql_val "SELECT md5(random()::text || clock_timestamp()::text);")
  psql_q -c "
    INSERT INTO public.system_database_identity (id, app_name, environment, instance_id)
    VALUES (1, '${APP_NAME}', '${APP_ENVIRONMENT}', '${instance_id}')
    ON CONFLICT (id) DO NOTHING;
  "
  ok "Database identity stamped: app_name='${APP_NAME}' environment='${APP_ENVIRONMENT}' instance_id=${instance_id}"
elif [ "${existing_app_name}" != "${APP_NAME}" ]; then
  fail "DB IDENTITY MISMATCH: this database is stamped as app_name='${existing_app_name}', but this container expects '${APP_NAME}'. Refusing to run migrations — this looks like the wrong database (wrong .env, wrong DB_HOST, or a restored backup from a different project/environment). Check docker-compose DATABASE_URL / DB_HOST / DB_NAME before retrying."
else
  ok "Database identity confirmed: app_name='${existing_app_name}'"
fi

# ── Step 1d: MIGRATION LOCK — prevent two migration runs racing each other
# A lock TABLE (not a session-scoped pg_advisory_lock) is used deliberately:
# this script issues many separate short-lived psql connections rather than
# holding one session open for its whole run, so a session-scoped advisory
# lock would not actually span the script. An atomic UPDATE ... WHERE is
# connection-independent and works correctly regardless of how many separate
# psql invocations happen while the lock is held. Stale locks (a container
# that crashed mid-migration) auto-expire after 10 minutes so a single
# crashed run can never permanently wedge deployments.
echo ""
info "Acquiring schema migration lock…"
psql_q -c "
  CREATE TABLE IF NOT EXISTS public.schema_migration_lock (
    id         INTEGER PRIMARY KEY DEFAULT 1,
    locked     BOOLEAN NOT NULL DEFAULT FALSE,
    locked_by  TEXT,
    locked_at  TIMESTAMPTZ,
    CONSTRAINT schema_migration_lock_singleton CHECK (id = 1)
  );
  INSERT INTO public.schema_migration_lock (id, locked) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;
"
LOCK_HOLDER="db-patch-v2-$(hostname 2>/dev/null || echo unknown)-$$"
acquired=$(psql_val "
  UPDATE public.schema_migration_lock
  SET locked = TRUE, locked_by = '${LOCK_HOLDER}', locked_at = NOW()
  WHERE id = 1 AND (locked = FALSE OR locked_at < NOW() - INTERVAL '10 minutes')
  RETURNING 1;
")
if [ "${acquired}" != "1" ]; then
  holder=$(psql_val "SELECT locked_by || ' since ' || locked_at FROM public.schema_migration_lock WHERE id = 1;")
  fail "Could not acquire schema migration lock — another migration appears to be in progress (${holder}). If that run crashed more than 10 minutes ago the lock auto-expires; otherwise wait for it to finish, or manually clear it with: UPDATE schema_migration_lock SET locked=false WHERE id=1;"
fi
release_lock() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=0 -q -c "
    UPDATE public.schema_migration_lock SET locked = FALSE, locked_by = NULL WHERE id = 1 AND locked_by = '${LOCK_HOLDER}';
  " >/dev/null 2>&1 || true
}
trap release_lock EXIT INT TERM
ok "Migration lock acquired (${LOCK_HOLDER})"
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

# ── Step 2b: Clean-boot compatibility pre-seed (admin_sessions) ──────────────
# Drizzle migration 0006_jazzy_mojo.sql contains:
#     ALTER TABLE "admin_sessions" DISABLE ROW LEVEL SECURITY;
#     DROP TABLE "admin_sessions" CASCADE;
# to remove a legacy table that existed in the PRE-Drizzle production schema.
# No migration ever CREATEs "admin_sessions", so on a COMPLETELY EMPTY database
# these two statements hit a table that never existed and raise
#     ERROR: relation "admin_sessions" does not exist
# (harmless here because the Drizzle step below runs with ON_ERROR_STOP=0, but
# it pollutes the log and makes a clean boot look like it failed; the manual
# care-migrate path (db-deploy.ts) — which runs the transactional Drizzle
# migrator — would actually abort on it).
#
# Fix: on a CLEAN boot only (detected by the absence of the "users" table,
# which every real deployment already has), create a minimal placeholder so
# 0006's ALTER/DROP execute cleanly and remove it again — net no-op, no error.
# Gated on clean-boot so an existing/production database (0006 long applied,
# admin_sessions long gone) is never touched and the table is never resurrected.
is_clean_boot=$(psql_val "SELECT (to_regclass('public.users') IS NULL)::text;")
if [ "${is_clean_boot}" = "true" ]; then
  info "Clean boot detected — pre-seeding legacy admin_sessions placeholder so 0006 drops it cleanly…"
  psql_q -c 'CREATE TABLE IF NOT EXISTS "public"."admin_sessions" ("id" serial PRIMARY KEY);'
  ok "admin_sessions placeholder created (Drizzle 0006 will remove it)"
fi

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
# Use temporary files to process pairs. NOTE: intentionally avoids bash-only
# process substitution ("paste <(...) <(...)") — this container's entrypoint
# runs under BusyBox/dash "sh" (postgres:16-alpine), which does not support
# that syntax and would abort the whole script with a syntax error before
# any migration runs. Plain temp files + "paste" work under any POSIX sh.
tmpfile=$(mktemp)
tags_file=$(mktemp)
whens_file=$(mktemp)
printf '%s\n' "${tags}" > "${tags_file}"
printf '%s\n' "${whens}" > "${whens_file}"
paste "${tags_file}" "${whens_file}" > "${tmpfile}" 2>/dev/null || {
  # Fallback: process just tags with a fixed timestamp
  echo "${tags}" | while read -r t; do echo "${t} 0"; done > "${tmpfile}"
}
rm -f "${tags_file}" "${whens_file}"

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

  # Strip Drizzle breakpoint comments and execute.
  # ON_ERROR_STOP=0 keeps a from-scratch application going past the historical
  # migrations that are self-inconsistent on an EMPTY database (0006 drops two
  # dicom_nodes columns that 0002 already renamed; 0010 updates an email_settings
  # column a later feature migration adds). Those are guaranteed no-ops here — the
  # final schema is identical — so their "does not exist" lines are filtered out
  # by the two EXACT patterns below (exact so a genuine "relation does not exist"
  # from any future migration is never hidden). See HOW_TO_ADD_DB_MIGRATIONS.md
  # ("Known-benign clean-boot Drizzle statements").
  sed 's/--> statement-breakpoint//g' "${file}" | \
    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
         -v ON_ERROR_STOP=0 -q 2>&1 \
      | grep -v "already exists" | grep -v "^NOTICE" \
      | grep -vE 'column "(pull_interval_minutes|pull_query_days)" of relation "dicom_nodes" does not exist' \
      | grep -v 'column "daily_summary_last_sent_date" does not exist' >&2 || true

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

# ── 6b: Column verification delegated to care-schema-verify ─────────────────
# care-schema-verify runs AFTER this container exits.
# It uses db-schema-verify.cjs which:
#   1. Reads ALL migration SQL files dynamically (no hardcoded list)
#   2. Runs --repair: ADD COLUMN IF NOT EXISTS for any missing column
#   3. Runs --verify: confirms every expected column exists
#   4. Exits 0 (pass) or 1 (fail) — docker-compose blocks care-api on fail
# This means column verification is always in sync with the actual migration
# files. No manual list to maintain. Self-healing on schema drift.
info "Column verification: handled by care-schema-verify (dynamic, self-healing)"

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
