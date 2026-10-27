#!/usr/bin/env bash
# =============================================================================
# synology-nas-backup.sh — the clinic's PRIMARY database backup
# =============================================================================
# Dumps the live PostgreSQL database straight out of the `care-db` container with
# pg_dump (the same --clean --if-exists logical dump the app's backup endpoint
# uses), gzips it, verifies the artifact is a COMPLETE schema-bearing dump of the
# database you asked for, writes a sidecar .meta record, then optionally encrypts
# (AES-256-CBC/PBKDF2) and prunes old copies. It does NOT need care-api to be up,
# so it still works during an incident.
#
# This is the backup the clinic should rely on. scripts/synology-backup.sh pulls
# a DIFFERENT database from the old cloud (Replit) deployment and must never be
# scheduled as this box's local CARE backup.
#
# SETUP on the Synology NAS (do once):
#   1. Copy this file to /volume1/scripts/care-backup.sh
#   2. chmod +x /volume1/scripts/care-backup.sh
#   3. Edit CONTAINER / DB_USER / DB_NAME below if yours differ (defaults match
#      docker-compose.yml). Set BACKUP_PASSPHRASE in the task's environment —
#      never on a command line, and never in a tracked file.
#   4. DSM → Control Panel → Task Scheduler → Create → Scheduled Task →
#      User-defined script, run daily at 03:00:
#        BACKUP_PASSPHRASE="$(cat /volume1/scripts/.passphrase)" bash /volume1/scripts/care-backup.sh
#
# RESTORE: see docs/CARE_ERP_BACKUP_RESTORE.md, then prove any copy restores with
# scripts/verify-backup-restore.sh before you need it.
# =============================================================================
set -euo pipefail

# ─── CONFIG (defaults match docker-compose.yml) ──────────────────────────────
CONTAINER="${CARE_DB_CONTAINER:-care-db}"
DB_USER="${DB_USER:-erp}"
DB_NAME="${DB_NAME:-diagnostic_erp}"
BACKUP_DIR="${BACKUP_DIR:-/volume1/backup/care-erp/db}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Never delete down to nothing: this many verified copies always survive a prune.
KEEP_MIN_COPIES="${KEEP_MIN_COPIES:-2}"
MIN_BYTES="${MIN_BYTES:-10240}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"   # required to restore an encrypted copy — keep it safe

TS=$(date +%Y%m%d_%H%M%S)
LOG="${BACKUP_DIR}/backup.log"
DEST="${BACKUP_DIR}/caredeoghar_${TS}.sql.gz"
PARTIAL="${DEST}.partial"

log(){ echo "[$(date +%Y-%m-%dT%H:%M:%S)] $*" | tee -a "${LOG}"; }
# Cleanup on failure removes the partial and any rejected encrypted copy — never a
# published ${DEST}: after the artifact has been verified and moved into place, a
# later step failing must not destroy the one good copy this run produced.
fail(){ log "ERROR: $*"; rm -f "${PARTIAL}" "${PARTIAL}.tmp" "${DEST}.enc" "${DEST}.meta.partial" "${FINAL:-}.roundtrip" "${DEST}.roundtrip"; exit 1; }

mkdir -p "${BACKUP_DIR}" || fail "cannot create ${BACKUP_DIR}"
[ -d "${BACKUP_DIR}" ] || fail "${BACKUP_DIR} is not a directory"
[ -w "${BACKUP_DIR}" ] || fail "${BACKUP_DIR} is not writable"

for bin in docker gzip; do
  command -v "$bin" >/dev/null 2>&1 || fail "required command '$bin' is not on PATH"
done
if [ -n "${BACKUP_PASSPHRASE}" ] && ! command -v openssl >/dev/null 2>&1; then
  fail "BACKUP_PASSPHRASE is set but openssl is not on PATH — refusing to dump an unencrypted copy of a patient database and call it encrypted"
fi

log "Starting backup of ${DB_NAME} from container ${CONTAINER}"

# ─── 1. PROVE WHICH DATABASE IS BEHIND THAT SOCKET ───────────────────────────
# A dump is only as good as its source. This box has run a second stack beside
# production, and `db_data` on that project is a real patient-shaped database
# with a different history: identical file names, wrong clinic. Ask the server
# itself, and refuse if the answer is not the database configured above.
ACTUAL_DB=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -Atc "select current_database()" 2>/dev/null || echo "")
[ "${ACTUAL_DB}" = "${DB_NAME}" ] || fail "source database is '${ACTUAL_DB:-no answer}', expected '${DB_NAME}' — refusing to back up the wrong database"

SOURCE_VERSION=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -Atc "show server_version" 2>/dev/null || echo "unknown")

# ─── 1b. WHAT THE DATABASE HELD, RECORDED AT DUMP TIME ───────────────────────
# A restore proof has to answer "did the artifact contain what the database held
# when it was taken?", and the only honest reference for that is a measurement made
# at that moment. Without one, completeness is judged against the LIVE table some
# later day — which cannot see history deleted after the dump, and calls a rebuilt
# sequence or a wrong-database artifact a pass as long as the top id looks plausible.
#
# So: census the core tables immediately before the dump and immediately after it.
# pg_dump's contents are a consistent snapshot somewhere inside that bracket, so the
# artifact is required to fall inside it. `restoreVerification.ts` grades that and
# exports `censusSql()`, which `scripts/backupScripts.test.mjs` pins to this
# template byte-for-byte — two definitions of a census is how the check dies.
#
# Counts, min/max ids and an id sum only. No patient data, no identifiers, nothing
# that has to be redacted, and nothing that grows the artifact.
CENSUS_TABLES_DEFAULT="patient_reports radiology_report_drafts patient_report_amendments report_finding_instances radiology_worklist audit_logs radiology_redelivery_obligations"
CENSUS_TABLES="${CARE_BACKUP_CENSUS_TABLES:-${CENSUS_TABLES_DEFAULT}}"
CENSUS_ROW_TEMPLATE=$'SELECT \'@T@\' AS census_table, count(*)::bigint AS row_count, coalesce(min("id"), 0)::bigint AS id_min, coalesce(max("id"), 0)::bigint AS id_max, coalesce(sum("id"), 0)::numeric AS id_sum FROM "@T@"'

census_sql(){
  local sql="" t
  for t in ${CENSUS_TABLES}; do
    if [ -n "${sql}" ]; then sql="${sql} UNION ALL "; fi
    sql="${sql}${CENSUS_ROW_TEMPLATE//@T@/${t}}"
  done
  printf '%s' "${sql}"
}

# Emits `census_<which>.<table>=rows|min|max|idsum`, one line per table. Prints
# nothing and returns non-zero on any failure: the census must never be the reason
# a nightly backup does not happen.
take_census(){
  local which="$1" raw t r mn mx s
  if ! raw=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -AtF'|' -c "$(census_sql)" 2>/dev/null); then
    return 1
  fi
  if [ -z "${raw}" ]; then return 1; fi
  while IFS='|' read -r t r mn mx s; do
    if [ -z "${t}" ]; then continue; fi
    echo "census_${which}.${t}=${r}|${mn}|${mx}|${s}"
  done <<< "${raw}"
}

# Both halves or neither. A `before` without an `after` would make the verifier
# demand the artifact hold EXACTLY the pre-dump row count, and on a busy clinic a
# dump that ran while bills were being written would then fail a perfect backup.
census_block(){
  local before="$1" after="$2" t
  if [ -z "${before}" ] || [ -z "${after}" ]; then return 1; fi
  for t in ${CENSUS_TABLES}; do
    if ! printf '%s\n' "${before}" | grep -q "^census_before\.${t}="; then return 1; fi
    if ! printf '%s\n' "${after}"  | grep -q "^census_after\.${t}=";  then return 1; fi
  done
  printf '%s\n%s\n' "${before}" "${after}"
}

CENSUS_ERROR=""
CENSUS_META=""
CENSUS_BEFORE=$(take_census before) || CENSUS_BEFORE=""
if [ -z "${CENSUS_BEFORE}" ]; then
  CENSUS_ERROR="no pre-dump census could be taken"
  log "WARNING: ${CENSUS_ERROR} — the backup proceeds, but its completeness will be judged by the live high-water bound alone"
fi

# ─── 2. DUMP INTO A PARTIAL FILE ─────────────────────────────────────────────
# Published only after every check below passes, so a crashed or truncated run can
# never leave something named like a backup in the restore operator's way.
if ! docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" \
       --no-owner --no-privileges --clean --if-exists 2>>"${LOG}" | gzip > "${PARTIAL}"; then
  fail "pg_dump/gzip pipeline failed"
fi
if [ "${PIPESTATUS[0]:-1}" -ne 0 ]; then
  fail "pg_dump exited non-zero — discarding truncated dump"
fi

# The far edge of the census bracket, taken before the artifact is re-read for the
# integrity checks below: every second between the dump finishing and this query
# running is a second the clinic kept writing into, and a wide bracket is a census
# that proves less.
CENSUS_AFTER=$(take_census after) || CENSUS_AFTER=""

# ─── 3. VERIFY THE ARTIFACT, NOT JUST THE COMPRESSION ────────────────────────
# `gzip -t` proves the bytes decompress. It does not prove PostgreSQL can restore
# them, and it passes happily on a dump that died in the middle of a COPY.
[ -s "${PARTIAL}" ] || fail "artifact is empty — nothing was dumped"

if ! gzip -t "${PARTIAL}" 2>/dev/null; then
  fail "artifact is not a valid gzip"
fi

BYTES=$(stat -c%s "${PARTIAL}" 2>/dev/null || stat -f%z "${PARTIAL}")
[ "${BYTES}" -ge "${MIN_BYTES}" ] || fail "artifact is ${BYTES} bytes, below the ${MIN_BYTES} floor — too small to be this clinic's database"

# A plain-format pg_dump opens with its own banner and closes with a completion
# marker. Both must be present, and the marker must be the LAST thing in the file:
# that is what distinguishes a finished dump from one the pipe lost halfway.
HEADER=$(gzip -dc "${PARTIAL}" 2>/dev/null | head -20 | grep -c "^-- PostgreSQL database dump$" || true)
[ "${HEADER}" -ge 1 ] || fail "no pg_dump banner in the artifact — this is not a database dump"

TAIL=$(gzip -dc "${PARTIAL}" 2>/dev/null | tail -5 | grep -c "^-- PostgreSQL database dump complete$" || true)
[ "${TAIL}" -ge 1 ] || fail "dump is TRUNCATED — no 'database dump complete' marker. Refusing to publish an incomplete backup"

# Schema-complete or data-only: the in-app fallback emits TRUNCATE + INSERT only,
# which restores into an existing schema and rebuilds nothing. Catching that here
# beats discovering it during a restore, months after the good copies were pruned.
TABLES=$(gzip -dc "${PARTIAL}" 2>/dev/null | grep -c "^CREATE TABLE" || true)
[ "${TABLES}" -ge 1 ] || fail "dump contains no CREATE TABLE — it is DATA ONLY and cannot rebuild the database (pg_dump missing in the container?)"

# ─── 4. FINGERPRINT WHAT WAS BACKED UP ───────────────────────────────────────
# The .meta sidecar is written after publication (below), once the final file name
# is known. No secrets in it: it exists so "which database, which server, complete
# or not, which bytes" is answerable after the fact instead of inferred.
SHA=$(sha256sum < "${PARTIAL}" | cut -d' ' -f1)

# ─── 5. PUBLISH ──────────────────────────────────────────────────────────────
mv "${PARTIAL}" "${DEST}" || fail "could not publish ${DEST}"
log "Backup OK: ${DEST} (${BYTES} bytes, ${TABLES} CREATE TABLE, sha256 ${SHA})"

# ─── 6. OPTIONAL ENCRYPTION (AES-256-CBC, PBKDF2) ────────────────────────────
# The passphrase reaches openssl through its environment, never as an argument:
# `ps -ef` on this box, a shell history entry, or a support screenshot of a
# command line must not be enough to decrypt the clinic's patient database.
FINAL="${DEST}"
if [ -n "${BACKUP_PASSPHRASE}" ]; then
  if env BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE}" openssl enc -aes-256-cbc -salt -pbkdf2 \
       -pass env:BACKUP_PASSPHRASE -in "${DEST}" -out "${DEST}.enc"; then
    # Prove the encrypted copy round-trips to the same bytes BEFORE deleting the
    # plaintext. An encryption that "succeeded" while writing garbage used to
    # destroy the only readable copy on this line.
    ROUNDTRIP="${DEST}.roundtrip"
    if env BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE}" openssl enc -d -aes-256-cbc -pbkdf2 \
         -pass env:BACKUP_PASSPHRASE -in "${DEST}.enc" -out "${ROUNDTRIP}" \
       && [ "$(sha256sum < "${ROUNDTRIP}" | cut -d' ' -f1)" = "${SHA}" ]; then
      rm -f "${ROUNDTRIP}" "${DEST}"
      FINAL="${DEST}.enc"
      log "Encrypted and round-trip verified: ${FINAL}"
    else
      rm -f "${ROUNDTRIP}"
      fail "encrypted copy does not decrypt back to the original — keeping the plaintext ${DEST} and refusing to delete it"
    fi
  else
    rm -f "${DEST}.enc"
    fail "encryption failed — keeping the plaintext ${DEST} rather than reporting a lost backup"
  fi
fi

# ─── 6b. THE SIDECAR RECORD ──────────────────────────────────────────────────
META="${FINAL}.meta"
CENSUS_META=$(census_block "${CENSUS_BEFORE}" "${CENSUS_AFTER}") || CENSUS_META=""
if [ -z "${CENSUS_META}" ] && [ -z "${CENSUS_ERROR}" ]; then
  CENSUS_ERROR="no post-dump census could be taken, so the bracket is incomplete"
  log "WARNING: ${CENSUS_ERROR}"
fi
# sha256_artifact is over the file the operator will actually find (the .enc when
# encrypted); sha256_sql_gzipped is over the dump itself. verify-backup-restore.sh
# checks the first one before it spends ten minutes restoring a copy that was
# truncated on the way to the share.
{
  echo "artifact=$(basename "${FINAL}")"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source_container=${CONTAINER}"
  echo "source_database=${ACTUAL_DB}"
  echo "server_version=${SOURCE_VERSION}"
  echo "exporter=pg_dump"
  echo "schema_complete=true"
  echo "create_tables=${TABLES}"
  echo "bytes=$(stat -c%s "${FINAL}" 2>/dev/null || stat -f%z "${FINAL}")"
  echo "encrypted=$([ -n "${BACKUP_PASSPHRASE}" ] && echo yes || echo no)"
  echo "sha256_sql_gzipped=${SHA}"
  echo "sha256_artifact=$(sha256sum < "${FINAL}" | cut -d' ' -f1)"
  if [ -n "${CENSUS_META}" ]; then
    printf '%s\n' "${CENSUS_META}"
    echo "census_tables=$(printf '%s\n' "${CENSUS_META}" | sed -n 's/^census_before\.\([a-z_0-9]*\)=.*/\1/p' | sort -u | tr '\n' ' ' | sed 's/ $//')"
  fi
  if [ -n "${CENSUS_ERROR}" ]; then
    echo "census_error=${CENSUS_ERROR}"
  fi
} > "${META}.partial" && mv "${META}.partial" "${META}" || fail "could not write ${META}"

# ─── 7. RETENTION, WITH A FLOOR ──────────────────────────────────────────────
# Prune only this script's own artifacts, only after a verified publication, and
# never below KEEP_MIN_COPIES whatever their age: a misconfigured RETENTION_DAYS,
# a clock that jumped, or a month of failed runs must not leave nothing to restore.
CANDIDATES=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'caredeoghar_*.sql.gz' -o -name 'caredeoghar_*.sql.gz.enc' \) \
  -mtime +"${RETENTION_DAYS}" -printf '%T@ %p\n' 2>/dev/null | sort -rn)
REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'caredeoghar_*.sql.gz' -o -name 'caredeoghar_*.sql.gz.enc' \) | wc -l | tr -d ' ')
PURGED=0
if [ -n "${CANDIDATES}" ]; then
  while read -r _ path; do
    [ -z "${path}" ] && continue
    if [ "${REMAINING}" -le "${KEEP_MIN_COPIES}" ]; then
      log "Retention stopped at ${KEEP_MIN_COPIES} copies (${REMAINING} present) — not deleting the last known-good backups"
      break
    fi
    rm -f "${path}" "${path}.meta"
    PURGED=$((PURGED + 1))
    REMAINING=$((REMAINING - 1))
  done <<< "${CANDIDATES}"
fi
[ "${PURGED}" -gt 0 ] && log "Purged ${PURGED} backup(s) older than ${RETENTION_DAYS} days (floor ${KEEP_MIN_COPIES})"

log "Backup complete: ${FINAL}"
