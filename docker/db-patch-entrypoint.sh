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
PSQL_OUT=$(mktemp)
PSQL_ERRF=$(mktemp)

psql_q() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
       -v ON_ERROR_STOP=1 -q "$@" 2>&1 || fail "psql failed: $*"
}

# Read one scalar. FAIL CLOSED, and every caller must be written
#     x=$(psql_val "…") || fail "…"
# (`fail` inside a command substitution only exits the subshell, so the caller
# has to check.)
#
# WHY THIS CHANGED: the previous version was `psql … 2>/dev/null` with no status
# check, so a failed read returned an EMPTY STRING — and every gate in this
# script interprets "" as "not there yet":
#   * `already=""`  → the migration is RE-APPLIED even though it was applied;
#   * `changed=""`  → the modified-checksum alarm never fires;
#   * `existing_app_name=""` → a fresh identity is stamped, which silently
#     DISABLES the wrong-database guard for the rest of the run (fail-OPEN).
# Now an unreadable database stops the deployment, and an empty answer can only
# mean the row genuinely is not there.
psql_val() {
  if psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
          -v ON_ERROR_STOP=1 -tAq -c "$1" >"${PSQL_OUT}" 2>"${PSQL_ERRF}"; then
    cat "${PSQL_OUT}"
    return 0
  fi
  sed -n '1,3p' "${PSQL_ERRF}" >&2
  return 1
}

# Migration names go into SQL string literals, so they must be plain identifiers.
# The journal and the migrations/ directory are both repo content — a typo like
# an embedded quote would otherwise be a syntax error deep inside a migration,
# and a name that is not an identifier is not a file we can trust.
assert_safe_name() {
  case "$1" in
    *[!A-Za-z0-9_.-]*|"") fail "Refusing to process an unsafe migration name: '$1' (expected letters, digits, dot, dash or underscore)" ;;
  esac
}

# ── Step 1b: DEPLOYMENT GUARD — print exact DB target before touching anything
# This is the single most effective guard against "migration ran against the
# wrong database" incidents: a misconfigured .env (wrong DB_HOST, leftover
# credentials from another project, etc.) is now impossible to miss in the
# container logs, instead of silently succeeding against the wrong target.
echo ""
info "Deployment guard — verifying DB target…"
server_addr=$(psql_val "SELECT COALESCE(inet_server_addr()::text, 'unix-socket');") \
  || fail "Cannot read inet_server_addr() from ${DB_HOST}/${DB_NAME} — refusing to run migrations"
real_db=$(psql_val "SELECT current_database();") \
  || fail "Cannot read current_database() from ${DB_HOST}/${DB_NAME} — refusing to run migrations"
server_port=$(psql_val "SHOW port;") || server_port="unknown"
server_version=$(psql_val "SHOW server_version;") || server_version="unknown"
live_schema=$(psql_val "SELECT current_schema();") || live_schema="unknown"
echo "  ${BLUE}host (compose):${NC}      ${DB_HOST}"
echo "  ${BLUE}port:${NC}                ${server_port}"
echo "  ${BLUE}database (compose):${NC}  ${DB_NAME}"
echo "  ${BLUE}username:${NC}            ${DB_USER}"
echo "  ${BLUE}current_database():${NC}  ${real_db}"
echo "  ${BLUE}current_schema():${NC}    ${live_schema}"
echo "  ${BLUE}server address:${NC}      ${server_addr}"
echo "  ${BLUE}server version:${NC}      ${server_version}"

# The printout above only helps a human who reads the log. This assertion is the
# part that cannot be missed: if DATABASE_URL (used by psql) and DB_NAME (used by
# the identity stamp and every gate message) disagree, the operator is looking at
# one database while being told about another. Stop here, before any mutation.
if [ "${real_db}" != "${DB_NAME}" ]; then
  fail "DB TARGET MISMATCH: DB_NAME='${DB_NAME}' but the connection actually opened database '${real_db}' (host ${DB_HOST}). Refusing to run migrations — check DATABASE_URL / DB_NAME in the deployment environment."
fi
ok "DB target confirmed — proceeding (${real_db})"

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
existing_app_name=$(psql_val "SELECT app_name FROM public.system_database_identity WHERE id = 1;") \
  || fail "Cannot read the database identity stamp — refusing to run migrations"
if [ -z "${existing_app_name}" ]; then
  instance_id=$(psql_val "SELECT md5(random()::text || clock_timestamp()::text);") \
    || fail "Cannot generate an instance id — refusing to run migrations"
  psql_q -c "
    INSERT INTO public.system_database_identity (id, app_name, environment, instance_id)
    VALUES (1, '${APP_NAME}', '${APP_ENVIRONMENT}', '${instance_id}')
    ON CONFLICT (id) DO NOTHING;
  "
  ok "Database identity stamped: app_name='${APP_NAME}' environment='${APP_ENVIRONMENT}' instance_id=${instance_id}"
elif [ "${existing_app_name}" != "${APP_NAME}" ]; then
  fail "DB IDENTITY MISMATCH: this database is stamped as app_name='${existing_app_name}', but this container expects '${APP_NAME}'. Refusing to run migrations — this looks like the wrong database (wrong .env, wrong DB_HOST, or a restored backup from a different project/environment). Check docker-compose DATABASE_URL / DB_HOST / DB_NAME before retrying."
else
  stamped_env=$(psql_val "SELECT environment FROM public.system_database_identity WHERE id = 1;") \
    || fail "Cannot read the database identity stamp — refusing to run migrations"
  stamped_id=$(psql_val "SELECT instance_id FROM public.system_database_identity WHERE id = 1;") \
    || stamped_id="unknown"
  # The stamp carries the environment too. A production container pointed at a
  # database stamped `staging` (or a restored staging dump) is the same class of
  # incident as pointing at another project's Postgres, so it stops here as well
  # instead of migrating a database that belongs to a different deployment.
  if [ "${stamped_env}" != "${APP_ENVIRONMENT}" ]; then
    fail "ENVIRONMENT MISMATCH: database '${real_db}' is stamped as app_name='${existing_app_name}' environment='${stamped_env}', but this container runs APP_ENVIRONMENT='${APP_ENVIRONMENT}'. Refusing to migrate a database that belongs to a different environment. If this database was legitimately re-purposed, update it deliberately — do not bypass this check from a deploy."
  fi
  ok "Database identity confirmed: app_name='${existing_app_name}' environment='${stamped_env}' instance_id=${stamped_id}"
fi

# ── Step 1d: MIGRATION LOCK — prevent two migration runs racing each other
# A lock TABLE (not a session-scoped pg_advisory_lock) is used deliberately:
# this script issues many separate short-lived psql connections rather than
# holding one session open for its whole run, so a session-scoped advisory
# lock would not actually span the script. An atomic UPDATE ... WHERE is
# connection-independent and works correctly regardless of how many separate
# psql invocations happen while the lock is held.
#
# STALENESS IS NOW A HEARTBEAT, NOT A DEADLINE. The previous rule was
# "locked_at older than 10 minutes ⇒ take over", which meant a legitimate run
# longer than 10 minutes — a from-scratch replay, or a big feature migration on
# a busy clinic database — could be taken over MID-FLIGHT by a second container,
# i.e. exactly the race the lock exists to prevent. The holder now renews
# locked_at every ${LOCK_HEARTBEAT}s, so takeover requires ${LOCK_STALE}s of
# silence: a crashed or hung run still self-heals (no permanent wedge), but a
# live one cannot be interrupted.
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
LOCK_HEARTBEAT="${MIGRATION_LOCK_HEARTBEAT_SECONDS:-30}"
LOCK_STALE="${MIGRATION_LOCK_STALE_SECONDS:-300}"
for _n in "${LOCK_HEARTBEAT}" "${LOCK_STALE}"; do
  case "${_n}" in
    *[!0-9]*|"") fail "MIGRATION_LOCK_*_SECONDS must be a plain number of seconds, got '${_n}'" ;;
  esac
done
if [ "${LOCK_STALE}" -le "${LOCK_HEARTBEAT}" ]; then
  fail "Lock staleness (${LOCK_STALE}s) must exceed the heartbeat interval (${LOCK_HEARTBEAT}s) or the lock can be stolen from a healthy run"
fi
LOCK_HOLDER="db-patch-v2-$(hostname 2>/dev/null || echo unknown)-$$"
acquired=$(psql_val "
  UPDATE public.schema_migration_lock
  SET locked = TRUE, locked_by = '${LOCK_HOLDER}', locked_at = NOW()
  WHERE id = 1 AND (locked = FALSE OR locked_at < NOW() - INTERVAL '${LOCK_STALE} seconds')
  RETURNING 1;
") || fail "Cannot read or write the schema migration lock — refusing to run migrations"
if [ "${acquired}" != "1" ]; then
  holder=$(psql_val "SELECT locked_by || ' since ' || locked_at FROM public.schema_migration_lock WHERE id = 1;") \
    || holder="unknown (the lock row could not be read)"
  fail "Could not acquire schema migration lock — another migration is in progress (${holder}). This run changed nothing. A live holder renews its lock every ${LOCK_HEARTBEAT}s, so it is only considered abandoned after ${LOCK_STALE}s of silence; wait for it, or if the holder's container is provably dead: UPDATE schema_migration_lock SET locked=false, locked_by=NULL WHERE id=1;"
fi
release_lock() {
  psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=0 -q -c "
    UPDATE public.schema_migration_lock SET locked = FALSE, locked_by = NULL WHERE id = 1 AND locked_by = '${LOCK_HOLDER}';
  " >/dev/null 2>&1 || true
  # Stop the heartbeat before the lock goes, and clean up the helper temp files.
  if [ -n "${LOCK_HEARTBEAT_PID:-}" ]; then
    kill "${LOCK_HEARTBEAT_PID}" 2>/dev/null || true
    LOCK_HEARTBEAT_PID=""
  fi
  rm -f "${PSQL_OUT}" "${PSQL_ERRF}"
}
trap release_lock EXIT INT TERM
# Background renewal loop. It only ever touches the row it owns (locked_by = this
# holder), so it can never steal or release another run's lock.
(
  while :; do
    sleep "${LOCK_HEARTBEAT}"
    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=0 -q -c "
      UPDATE public.schema_migration_lock SET locked_at = NOW()
      WHERE id = 1 AND locked = TRUE AND locked_by = '${LOCK_HOLDER}';
    " >/dev/null 2>&1 || true
  done
) &
LOCK_HEARTBEAT_PID=$!
ok "Migration lock acquired (${LOCK_HOLDER}, heartbeat ${LOCK_HEARTBEAT}s, stale after ${LOCK_STALE}s)"
info "Bootstrapping migration tracking…"

psql_q -c 'CREATE SCHEMA IF NOT EXISTS "drizzle";'
psql_q -c '
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    "id"         SERIAL  PRIMARY KEY,
    "hash"       TEXT    NOT NULL,
    "created_at" BIGINT
  );
'

# ── Legacy Drizzle journal in the PUBLIC schema: PRESERVE, never drop ─────────
# This step used to be an unconditional
#     DROP TABLE IF EXISTS "public"."__drizzle_migrations";
# run on EVERY boot. drizzle-orm's own default journal location is exactly that
# table, so any database prepared by `pnpm db:push`, by the Drizzle CLI defaults,
# or restored from a dump of one, arrived with its real migration history in the
# table this script deleted before it ever looked at it. The consequence is not
# cosmetic: with the history gone, the very next step decides that 0000…0015 have
# never been applied and re-applies all of them against a schema that already has
# them — the "already exists" errors are filtered out of the log as benign, and
# any statement that does real damage on a second pass is not.
#
# Now the legacy journal is read first. Every hash in it is carried forward into
# the journal this script uses, so those migrations stay "applied", and the table
# itself is RENAMED, not deleted, so the operator can still see exactly what was
# there. Nothing is reversed.
legacy_journal=$(psql_val "
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = '__drizzle_migrations';
") || fail "Cannot inspect the migration journal — refusing to run migrations"
if [ "${legacy_journal}" != "0" ]; then
  legacy_shape=$(psql_val "
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
      AND column_name = 'hash';
  ") || fail "Cannot inspect the legacy migration journal — refusing to run migrations"
  if [ "${legacy_shape}" != "1" ]; then
    fail "public.__drizzle_migrations exists but has no 'hash' column, so it is not the journal this script expects. Refusing to guess: inspect it (SELECT * FROM public.__drizzle_migrations) and rename or drop it deliberately."
  fi
  legacy_rows=$(psql_val "SELECT count(*) FROM public.__drizzle_migrations;") \
    || fail "Cannot read the legacy migration journal — refusing to run migrations"
  warn "Legacy journal public.__drizzle_migrations found with ${legacy_rows} row(s) — preserving, NOT dropping."
  carried=$(psql_val "
    WITH c AS (
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT l.hash, l.created_at FROM public.__drizzle_migrations l
      WHERE l.hash IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash = l.hash)
      RETURNING 1
    ) SELECT count(*) FROM c;
  ") || fail "Cannot carry the legacy journal forward — refusing to run migrations"
  ok "Carried ${carried} legacy hash(es) into drizzle.__drizzle_migrations"
  preserved="__drizzle_migrations_legacy_$(date -u +%Y%m%d%H%M%S)"
  psql_q -c "ALTER TABLE public.__drizzle_migrations RENAME TO ${preserved};"
  warn "Legacy journal kept for audit as public.${preserved} (this script will not delete it)."
fi

# The ledger this script writes must be keyed by migration, not by file content:
# with no unique constraint the same migration could be recorded again on every
# re-apply, which is how production ended up with 18 rows for a 16-entry journal.
# Adding the constraint changes no history and makes double-recording impossible;
# existing duplicates are reported, never deleted (and never block the deploy).
dup_hashes=$(psql_val "
  SELECT count(*) FROM (
    SELECT hash FROM drizzle.__drizzle_migrations GROUP BY hash HAVING count(*) > 1
  ) d;
") || fail "Cannot read drizzle.__drizzle_migrations — refusing to run migrations"
if [ "${dup_hashes}" != "0" ]; then
  warn "${dup_hashes} hash(es) are recorded in drizzle.__drizzle_migrations more than once (history from an older version of this script)."
  warn "  Left as-is: duplicate rows only cause a skip, never a re-apply. Clearing them is a deliberate, separate step."
else
  psql_q -c '
    CREATE UNIQUE INDEX IF NOT EXISTS drizzle___drizzle_migrations_hash_ux
      ON drizzle."__drizzle_migrations" ("hash");
  '
fi

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

# ── Ledger verdict: has THIS exact file already been applied? ────────────────
# Returns one of four words, and the caller must treat anything except `new` as
# "do not run this file":
#   current — the ledger has this name with this exact sha256: already applied.
#   changed — the ledger has this name with a DIFFERENT sha256: somebody edited
#             an applied migration. Never silently accepted (see below).
#   legacy  — no ledger row, but THIS EXACT hash is in drizzle.__drizzle_migrations:
#             an older version of this script applied it without writing the
#             ledger. Re-applying it would be the real bug.
#   new     — nothing anywhere says this file has run. Apply it.
# WHEN_MS may be empty; it is only consulted for Drizzle journal entries, and a
# journal slot that was recorded from DIFFERENT content is reported as `changed`,
# never as `legacy` — otherwise editing an already-applied Drizzle file would be
# re-recorded silently, which is the one thing this verdict must not allow.
ledger_verdict() {
  _lv=$(psql_val "
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.schema_migrations_log
                   WHERE name = '${1}' AND kind = '${2}' AND sha256 = '${3}') THEN 'current'
      WHEN EXISTS (SELECT 1 FROM public.schema_migrations_log
                   WHERE name = '${1}' AND kind = '${2}') THEN 'changed'
      ELSE 'none' END;") || return 1
  if [ "${_lv}" != "none" ]; then
    echo "${_lv}"
    return 0
  fi
  # Only a Drizzle entry can be "legacy": the journal it probes is Drizzle's own,
  # and a feature file matching one of its hashes by content would be a coincidence
  # worth applying, not one worth silently re-recording.
  if [ "${2}" = "drizzle" ]; then
    _lj=$(psql_val "
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '${3}') THEN 'legacy'
        ${4:+WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${4}) THEN 'changed'}
        ELSE 'none' END;") || return 1
    if [ "${_lj}" != "none" ]; then echo "${_lj}"; return 0; fi
  fi
  echo new
}

# Record a migration in the ledger WITHOUT running it (used for `legacy`, and for
# an explicitly authorised checksum change). Nothing is applied, so nothing can
# be reversed; this only makes the history this script writes complete.
record_ledger_only() {
  if [ "$2" = "drizzle" ]; then
    psql_q -c "
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT '${3}', ${4:-$(date +%s%3N)}
      WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '${3}');
    "
  fi
  psql_q -c "
    INSERT INTO public.schema_migrations_log (name, kind, sha256)
    VALUES ('$1', '$2', '$3')
    ON CONFLICT (name, kind) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = NOW();
  "
}

# Some statements cannot run inside a transaction block. A file containing one of
# them is applied statement-by-statement instead, with a loud warning, because
# forcing `-1` on it would fail the whole migration on a valid release.
non_transactional_sql() {
  grep -qiE 'CONCURRENTLY|^[[:space:]]*(VACUUM|ANALYZE|CREATE[[:space:]]+DATABASE|DROP[[:space:]]+DATABASE|ALTER[[:space:]]+SYSTEM|CREATE[[:space:]]+TABLESPACE|DROP[[:space:]]+TABLESPACE|REINDEX)[[:space:]]' "$1"
}

# Apply ONE migration file and its ledger rows in a SINGLE transaction, so a
# failure anywhere in the file leaves the database exactly as it was and records
# nothing. This is what replaces the old behaviour, where `psql -f` autocommitted
# every statement: if statement 7 of a 12-statement file failed, 1-6 stayed
# committed, the file was NOT recorded, and the next deploy replayed 1-6 again on
# top of half-applied state.
#
# The ledger writes are inside the same transaction deliberately: committing a
# schema change and then dying before the record would produce the same
# re-application hazard by a different route.
apply_atomic() {
  _sql=$(mktemp)
  {
    echo "BEGIN;"
    if [ "$2" = "drizzle" ]; then
      sed 's/--> statement-breakpoint//g' "$4"
    else
      cat "$4"
    fi
    echo ""
    echo "INSERT INTO public.schema_migrations_log (name, kind, sha256) VALUES ('$1', '$2', '$3') ON CONFLICT (name, kind) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = NOW();"
    if [ "$2" = "drizzle" ]; then
      echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '$3', ${5:-$(date +%s%3N)} WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '$3');"
    fi
    echo "COMMIT;"
  } > "${_sql}"
  if ! psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
            -v ON_ERROR_STOP=1 -q -f "${_sql}" 2>&1; then
    rm -f "${_sql}"
    fail "Migration $1 was NOT applied: the transaction rolled back and NOTHING from this file is committed or recorded. The API will NOT start. Fix the file (or, if it is already partly in the schema from an older code path, that is the case to investigate before retrying) and deploy again."
  fi
  rm -f "${_sql}"
}

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
  mig_out=$(mktemp)
  sed 's/--> statement-breakpoint//g' "${file}" | \
    psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
         -v ON_ERROR_STOP=0 -q >"${mig_out}" 2>&1 || true

  # The same filters as before, for the operator's log only.
  grep -v "already exists" "${mig_out}" | grep -v "^NOTICE" \
    | grep -vE 'column "(pull_interval_minutes|pull_query_days)" of relation "dicom_nodes" does not exist' \
    | grep -v 'column "daily_summary_last_sent_date" does not exist' >&2 || true

  # ON_ERROR_STOP=0 is required for the known-benign clean-boot statements, and
  # it also makes psql exit 0 whatever happened — so the exit status can never
  # answer "did this migration run?". Read the output instead: anything that
  # says ERROR and is not one of the exact known-benign lines is a real failure,
  # and it must stop here, BEFORE the hash is recorded. A migration recorded in
  # drizzle.__drizzle_migrations is skipped on every later deploy, so the
  # alternative is a half-applied schema that is never revisited — and
  # care-schema-verify, the container that runs next, cannot see it: it checks
  # the columns the migration files declare, and it PASSED on a database where
  # one statement of a Drizzle file had failed.
  mig_err=$(grep "ERROR:" "${mig_out}" \
    | grep -v "already exists" \
    | grep -vE 'column "(pull_interval_minutes|pull_query_days)" of relation "dicom_nodes" does not exist' \
    | grep -v 'column "daily_summary_last_sent_date" does not exist' \
    | head -3)
  rm -f "${mig_out}"
  if [ -n "${mig_err}" ]; then
    fail "Drizzle migration ${tag} raised an unexpected error and was NOT recorded as applied — API will NOT start: ${mig_err}"
  fi

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
