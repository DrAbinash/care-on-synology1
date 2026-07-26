#!/usr/bin/env bash
# ─── Care Diagnostics — Prove a backup is RESTORABLE ──────────────────────────
#
# Restores a real backup artifact into a throwaway PostgreSQL container and
# queries it. Exit 0 means the artifact genuinely restores. Anything else means
# it does not. There is no in-between and no "probably fine".
#
# Usage:
#   bash verify-backup-restore.sh [BACKUP_DIR_OR_FILE]
#
#   BACKUP_PASSPHRASE=...   # or SESSION_SECRET=... for scheduler-written files
#   bash verify-backup-restore.sh /volume1/backups/caredeoghar
#
# ── Why this was rewritten ────────────────────────────────────────────────────
# The previous version could not verify the backups this product actually
# writes. Four defects, each of which alone produced a false "successful":
#
#   1. It searched only for  caredeoghar_*.sql.gz[.enc]  — the naming used by
#      scripts/synology-backup.sh. The in-app scheduler writes
#      backup_<jobName>_<timestamp>.sql.enc, so the hourly backups were never
#      found at all.
#   2. It piped unconditionally through `gunzip -c`. The scheduler's artifact is
#      NOT gzipped, so decryption succeeded and decompression then died with
#      "not in gzip format".
#   3. It ran psql without ON_ERROR_STOP. A DATA-ONLY dump (TRUNCATE + INSERT,
#      no CREATE TABLE — what exportDatabaseSqlFallback emits when pg_dump is
#      missing) errors on every statement while psql still exits 0.
#   4. It printed "100% valid" on a restore that produced ZERO rows.
#
# Defect 3 is not hypothetical. Production ran for months on DATA-ONLY
# artifacts that reported success, matched their SHA-256, and kept the backup
# dead-man alert green.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TARGET="${1:-/volume1/backups/caredeoghar}"
SANDBOX_CONTAINER="care-db-restore-sandbox"
SANDBOX_DB="diagnostic_erp_restore_test"
SANDBOX_USER="postgres"
SANDBOX_PASS="sandbox-$$-$(date +%s)"

fail() { echo ""; echo "❌ VERIFICATION FAILED: $*"; echo ""; exit 1; }
note() { echo "   $*"; }

for bin in docker openssl; do
  command -v "$bin" >/dev/null 2>&1 || fail "'$bin' is not installed or not on PATH."
done

# ── 1. Locate the artifact ────────────────────────────────────────────────────
# Both naming families, newest first:
#   caredeoghar_*.sql.gz[.enc]   scripts/synology-backup.sh   (gzipped)
#   backup_*_*.sql[.enc]         the in-app scheduler         (NOT gzipped)
if [[ -f "${TARGET}" ]]; then
  BACKUP="${TARGET}"
else
  [[ -d "${TARGET}" ]] || fail "No such file or directory: ${TARGET}"
  echo "🔍 Searching ${TARGET} for the newest backup artifact..."
  BACKUP=$(find "${TARGET}" -maxdepth 2 -type f \
    \( -name "caredeoghar_*.sql.gz" -o -name "caredeoghar_*.sql.gz.enc" \
       -o -name "backup_*.sql" -o -name "backup_*.sql.enc" \
       -o -name "care_db_daily_*.sql.gz" \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  [[ -n "${BACKUP}" ]] || fail "No backup artifact found in ${TARGET}.
   Looked for caredeoghar_*.sql.gz[.enc] and backup_*.sql[.enc]."
fi

echo "✅ Artifact: ${BACKUP}"
note "size: $(du -h "${BACKUP}" | cut -f1)   modified: $(date -r "${BACKUP}" '+%Y-%m-%d %H:%M:%S')"

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "${WORK}"
  docker rm -f "${SANDBOX_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
PAYLOAD="${WORK}/payload"

# ── 2. Decrypt ────────────────────────────────────────────────────────────────
# Mirrors lib/backupCrypto.candidatePassphrases(): BACKUP_PASSPHRASE first, then
# SESSION_SECRET. The scheduler encrypts with whichever is set, and production
# ran on SESSION_SECRET for a long time, so trying only one is not enough.
if [[ "${BACKUP}" == *.enc ]]; then
  DECRYPTED=0
  for label in BACKUP_PASSPHRASE SESSION_SECRET; do
    pass="${!label:-}"
    [[ -n "${pass}" ]] || continue
    if openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:${pass}" \
         -in "${BACKUP}" -out "${PAYLOAD}" 2>/dev/null; then
      echo "✅ Decrypted using ${label}"
      DECRYPTED=1
      break
    fi
  done
  if [[ "${DECRYPTED}" -eq 0 ]]; then
    fail "Could not decrypt. Set BACKUP_PASSPHRASE (or SESSION_SECRET) to the value
   that was in force WHEN THIS FILE WAS WRITTEN.
   Rotating SESSION_SECRET without first setting BACKUP_PASSPHRASE to the previous
   value makes older artifacts undecryptable — candidatePassphrases() has no
   previous-secret slot."
  fi
else
  cp "${BACKUP}" "${PAYLOAD}"
fi

# ── 3. Decompress only if it really is gzip ───────────────────────────────────
# Sniff the magic bytes rather than trusting the filename: both families end in
# .enc but only one is compressed.
if [[ "$(head -c 2 "${PAYLOAD}" | od -An -tx1 | tr -d ' \n')" == "1f8b" ]]; then
  gzip -t "${PAYLOAD}" 2>/dev/null || fail "Payload looks like gzip but fails 'gzip -t' — the artifact is corrupt."
  gunzip -c "${PAYLOAD}" > "${PAYLOAD}.sql"
  mv "${PAYLOAD}.sql" "${PAYLOAD}"
  echo "✅ Decompressed (gzip)"
else
  echo "✅ Not compressed — using as-is"
fi

SQL_BYTES=$(stat -c%s "${PAYLOAD}")
[[ "${SQL_BYTES}" -gt 0 ]] || fail "Decoded payload is empty."
note "decoded SQL: $(numfmt --to=iec "${SQL_BYTES}" 2>/dev/null || echo "${SQL_BYTES} bytes")"

# ── 4. Refuse a DATA-ONLY dump before touching a database ─────────────────────
# This is the check that would have caught the real incident. A schema-complete
# pg_dump contains CREATE TABLE; exportDatabaseSqlFallback emits TRUNCATE +
# INSERT only and stamps its own "WARNING: DATA ONLY" header.
if ! grep -qim1 '^CREATE TABLE' "${PAYLOAD}"; then
  fail "This artifact is DATA ONLY — no CREATE TABLE statements.
   It cannot rebuild the database from nothing; it can only be loaded into a
   schema that already exists.

   Cause: pg_dump was unavailable in the api container, so the scheduler fell
   through to exportDatabaseSqlFallback(). Check the backup job's notes — a good
   artifact records  exporter=pg_dump.

   Take a known-good backup RIGHT NOW, straight from the database container.
   postgres:16-alpine ships pg_dump, so this does not depend on the api image:

     docker exec care-db pg_dump -U erp -d diagnostic_erp \\
       --no-owner --no-privileges --clean --if-exists \\
       | gzip > /volume1/backups/caredeoghar_\$(date +%Y%m%d_%H%M%S).sql.gz

   Then re-run this script against that file."
fi
echo "✅ Schema-complete (CREATE TABLE present)"

# ── 5. Restore into a throwaway container ─────────────────────────────────────
docker rm -f "${SANDBOX_CONTAINER}" >/dev/null 2>&1 || true
echo "🐋 Starting throwaway PostgreSQL 16..."
# No published port: nothing outside this host needs to reach the sandbox, and
# a restore sandbox full of real patient data must not be exposed.
docker run --name "${SANDBOX_CONTAINER}" \
  -e POSTGRES_DB="${SANDBOX_DB}" \
  -e POSTGRES_USER="${SANDBOX_USER}" \
  -e POSTGRES_PASSWORD="${SANDBOX_PASS}" \
  -d postgres:16-alpine >/dev/null

# The official postgres image starts in TWO phases on a cold container: a
# temporary internal instance runs initdb and creates ${SANDBOX_DB}, then it
# shuts down and the real long-running server starts. pg_isready accepts
# connections during BOTH phases — it does not check that any particular
# database exists, only that something is listening. Waiting on it alone is a
# race: it can report ready while the temp instance is still up (or mid
# restart), and the very next command — the actual restore — then fails with
# "database ... does not exist" against a backup that was never the problem.
#
# Poll with the exact operation the restore is about to perform instead, so
# there is no gap between "ready" and "actually restorable".
echo "⏳ Waiting for PostgreSQL to finish initializing ${SANDBOX_DB}..."
READY=0
for _ in $(seq 60); do
  if docker exec "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" -c 'SELECT 1' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[[ "${READY}" -eq 1 ]] || fail "Throwaway PostgreSQL never became queryable after 60s.
   'docker logs ${SANDBOX_CONTAINER}' may show why."

echo "⚡ Restoring..."
# ON_ERROR_STOP=1 is what makes this a test rather than a formality: without it
# psql exits 0 having failed every single statement.
RESTORE_LOG="${WORK}/restore.log"
if ! docker exec -i "${SANDBOX_CONTAINER}" \
      psql -v ON_ERROR_STOP=1 -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" \
      < "${PAYLOAD}" > "${RESTORE_LOG}" 2>&1; then
  echo "── last 20 lines of restore output ──"
  tail -20 "${RESTORE_LOG}"
  fail "psql aborted on the first error (ON_ERROR_STOP). This artifact does not restore cleanly."
fi
echo "✅ Restore completed with no errors"

# ── 6. Prove data actually landed ─────────────────────────────────────────────
q() {
  docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" \
    -t -A -c "$1" 2>/dev/null || echo "ERROR"
}

TABLES=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
[[ "${TABLES}" != "ERROR" && "${TABLES}" -gt 0 ]] || fail "No tables present after restore."

echo "📊 Restored contents:"
printf '   %-22s %s\n' "tables" "${TABLES}"
ZERO_CORE=0
for t in patients bills payments vouchers patient_reports; do
  c=$(q "SELECT count(*) FROM ${t};")
  printf '   %-22s %s\n' "${t}" "${c}"
  [[ "${c}" == "ERROR" ]] && fail "Core table '${t}' is missing from the restored database."
  if [[ "${t}" == "patients" || "${t}" == "bills" ]] && [[ "${c}" == "0" ]]; then
    ZERO_CORE=1
  fi
done

# A live clinic with zero patients AND zero bills is not a successful restore.
# The previous script reported "100% valid" in exactly that case.
if [[ "${ZERO_CORE}" -eq 1 ]]; then
  fail "Schema restored, but patients/bills are EMPTY. For a running clinic that is
   an empty backup, not a valid one. Check what the backup job actually captured."
fi

echo ""
echo "🎉 PASS — this artifact is restorable."
echo "   $(basename "${BACKUP}") → ${TABLES} tables, core data present."
echo ""
echo "   Keep it. Until now nothing in this system had been proven to restore."
