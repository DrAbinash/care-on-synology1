#!/usr/bin/env bash
# ============================================================================
# synology-backup.sh — pull the CLOUD (Replit) instance's database onto this NAS
# ============================================================================
# WHAT THIS IS NOT: this is not the clinic's local CARE backup. It downloads a
# dump from https://caredeoghar.replit.app — a DIFFERENT database on a different
# host — so it can never protect the data the NAS itself writes. The primary,
# on-box path is scripts/synology-nas-backup.sh; the in-app scheduler writes its
# own encrypted copies alongside it. CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md
# records this script as retired for the clinic's recovery; documents that still
# call it the "active backup execution script" are wrong and have been corrected.
#
# Keep it only if the cloud instance still needs a copy on-prem. Schedule it in
# ADDITION to the on-box dump, never instead of it.
#
# Requires: curl. Set CAREDEOGHAR_API_KEY and optionally BACKUP_PASSPHRASE in the
# task environment — never on a command line, and never in a tracked file.
# ============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/volume1/backups/caredeoghar}"
API_KEY="${CAREDEOGHAR_API_KEY:-}"
API_BASE="${CAREDEOGHAR_API_BASE:-https://caredeoghar.replit.app}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
KEEP_MIN_COPIES="${KEEP_MIN_COPIES:-2}"
MIN_BYTES="${MIN_BYTES:-10240}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="${BACKUP_DIR}/caredeoghar_${TIMESTAMP}.sql.gz"
PARTIAL="${DEST}.part"
LOG="${BACKUP_DIR}/backup.log"

log(){ echo "[$(date +%Y-%m-%dT%H:%M:%S)] $*" | tee -a "${LOG}"; }
# Remove only what THIS run wrote and did not publish. A failed pull must never
# touch an existing good copy — and it must not leave a file named like a backup
# that the restore operator then picks up.
fail(){ log "ERROR: $*"; rm -f "${PARTIAL}" "${DEST}.enc" "${CONFIG_FILE:-}"; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is not installed or not on PATH"
if [ -n "${BACKUP_PASSPHRASE}" ] && ! command -v openssl >/dev/null 2>&1; then
  fail "BACKUP_PASSPHRASE is set but openssl is not on PATH"
fi
[ -n "${API_KEY}" ] || fail "CAREDEOGHAR_API_KEY is not set — refusing to pull an unauthenticated 'backup'"

mkdir -p "${BACKUP_DIR}" || fail "cannot create ${BACKUP_DIR}"
[ -w "${BACKUP_DIR}" ] || fail "${BACKUP_DIR} is not writable"

log "Starting backup pull from ${API_BASE} (cloud instance, NOT this NAS's database)"

# ─── DOWNLOAD ────────────────────────────────────────────────────────────────
# The bearer key goes to curl through a 0600 config file, not argv: `ps -ef`, a
# shell history line or a screenshot of a running command must not be enough to
# read the clinic's database export endpoint.
CONFIG_FILE=$(mktemp "${BACKUP_DIR}/.curlcfg.XXXXXX") || fail "cannot create the curl config file"
chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
{
  printf 'header = "Authorization: Bearer %s"\n' "${API_KEY}"
} > "${CONFIG_FILE}"

HTTP_CODE=$(curl -s -o "${PARTIAL}" --config "${CONFIG_FILE}" --max-time 300 \
  -w "%{http_code}" "${API_BASE}/api/internal/backup/download?format=gzip") || \
  fail "curl could not complete the download (network, TLS or timeout)"
rm -f "${CONFIG_FILE}"

[ "${HTTP_CODE}" = "200" ] || fail "HTTP ${HTTP_CODE} from the backup endpoint — nothing was downloaded"

# ─── VERIFY: 200 IS NOT A BACKUP ─────────────────────────────────────────────
# This script used to declare success on the status code alone. The endpoint can
# answer 200 with an error body, an empty body, or a dump of the database that
# instance happens to be pointed at, and every one of those landed here named
# caredeoghar_<ts>.sql.gz and logged "Backup saved".
[ -s "${PARTIAL}" ] || fail "the endpoint returned HTTP 200 with an empty body — no backup was downloaded"

BYTES=$(stat -c%s "${PARTIAL}" 2>/dev/null || stat -f%z "${PARTIAL}")
[ "${BYTES}" -ge "${MIN_BYTES}" ] || fail "downloaded ${BYTES} bytes, below the ${MIN_BYTES} floor — this is not a database dump of that clinic"

gzip -t "${PARTIAL}" 2>/dev/null || fail "downloaded bytes are not valid gzip — the endpoint did not return a compressed dump"

HEADER=$(gzip -dc "${PARTIAL}" 2>/dev/null | head -20 | grep -c "^-- PostgreSQL database dump$" || true)
[ "${HEADER}" -ge 1 ] || fail "no pg_dump banner in the downloaded bytes — refusing to store a non-dump as a backup"

TAIL=$(gzip -dc "${PARTIAL}" 2>/dev/null | tail -5 | grep -c "^-- PostgreSQL database dump complete$" || true)
[ "${TAIL}" -ge 1 ] || fail "dump is TRUNCATED — no 'database dump complete' marker; the transfer or the export ended early"

TABLES=$(gzip -dc "${PARTIAL}" 2>/dev/null | grep -c "^CREATE TABLE" || true)
[ "${TABLES}" -ge 1 ] || fail "dump contains no CREATE TABLE — it is DATA ONLY and cannot rebuild a database"

SHA=$(sha256sum < "${PARTIAL}" | cut -d' ' -f1)
mv "${PARTIAL}" "${DEST}" || fail "could not publish ${DEST}"
log "Backup saved: ${DEST} (${BYTES} bytes, ${TABLES} CREATE TABLE, sha256 ${SHA})"

# ─── ENCRYPTION (OPTIONAL) ───────────────────────────────────────────────────
FINAL="${DEST}"
if [ -n "${BACKUP_PASSPHRASE}" ]; then
  if env BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE}" openssl enc -aes-256-cbc -salt -pbkdf2 \
       -pass env:BACKUP_PASSPHRASE -in "${DEST}" -out "${DEST}.enc"; then
    ROUNDTRIP="${DEST}.roundtrip"
    if env BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE}" openssl enc -d -aes-256-cbc -pbkdf2 \
         -pass env:BACKUP_PASSPHRASE -in "${DEST}.enc" -out "${ROUNDTRIP}" \
       && [ "$(sha256sum < "${ROUNDTRIP}" | cut -d' ' -f1)" = "${SHA}" ]; then
      rm -f "${ROUNDTRIP}" "${DEST}"
      FINAL="${DEST}.enc"
      log "Encrypted and round-trip verified: ${FINAL}"
    else
      rm -f "${ROUNDTRIP}"
      fail "encrypted copy does not decrypt back to the original — keeping the plaintext rather than reporting a lost backup"
    fi
  else
    fail "encryption failed — keeping the plaintext ${DEST}"
  fi
fi

{
  echo "artifact=$(basename "${FINAL}")"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source_url=${API_BASE} (CLOUD INSTANCE — not this NAS's database)"
  echo "exporter=remote /api/internal/backup/download"
  echo "schema_complete=true"
  echo "create_tables=${TABLES}"
  echo "bytes=$(stat -c%s "${FINAL}" 2>/dev/null || stat -f%z "${FINAL}")"
  echo "encrypted=$([ -n "${BACKUP_PASSPHRASE}" ] && echo yes || echo no)"
  echo "sha256_sql_gzipped=${SHA}"
  echo "sha256_artifact=$(sha256sum < "${FINAL}" | cut -d' ' -f1)"
} > "${FINAL}.meta.partial" && mv "${FINAL}.meta.partial" "${FINAL}.meta" || fail "could not write the .meta sidecar"

# ─── RETENTION, WITH A FLOOR ─────────────────────────────────────────────────
REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'caredeoghar_*.sql.gz' -o -name 'caredeoghar_*.sql.gz.enc' \) | wc -l | tr -d ' ')
CANDIDATES=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'caredeoghar_*.sql.gz' -o -name 'caredeoghar_*.sql.gz.enc' \) \
  -mtime +"${RETENTION_DAYS}" -printf '%T@ %p\n' 2>/dev/null | sort -rn)
PURGED=0
if [ -n "${CANDIDATES}" ]; then
  while read -r _ path; do
    [ -z "${path}" ] && continue
    if [ "${REMAINING}" -le "${KEEP_MIN_COPIES}" ]; then
      log "Retention stopped at ${KEEP_MIN_COPIES} copies — not deleting the last known-good backups"
      break
    fi
    rm -f "${path}" "${path}.meta"
    PURGED=$((PURGED + 1))
    REMAINING=$((REMAINING - 1))
  done <<< "${CANDIDATES}"
fi
[ "${PURGED}" -gt 0 ] && log "Purged ${PURGED} backup(s) older than ${RETENTION_DAYS} days (floor ${KEEP_MIN_COPIES})"

log "Backup complete: ${FINAL}"
