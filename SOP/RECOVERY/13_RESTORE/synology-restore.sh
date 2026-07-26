#!/usr/bin/env bash
# ─── Synology NAS Restore Script for Care Diagnostics ───────────────────────
# Restores a backup produced by EITHER of the two backup paths in this repo:
#
#   1. scripts/synology-backup.sh   → caredeoghar_<ts>.sql.gz[.enc]  (GZIPPED)
#   2. the in-app scheduler (cron.ts) → backup_<job>_<ts>.sql.enc    (NOT gzipped)
#
# Both are the same openssl AES-256-CBC/PBKDF2 envelope, but only the first is
# compressed. This script used to pipe unconditionally through `gunzip -c`,
# which meant the artifacts the application itself produces every hour — and
# whose own success notes say "Restore with: scripts/synology-restore.sh" —
# died at "gunzip: not in gzip format". It now sniffs the gzip magic bytes
# (1f 8b) after decryption and decompresses only when the stream really is
# compressed, so both artifact shapes restore with the same command.
#
# Usage:
#   bash synology-restore.sh /volume1/backups/caredeoghar/caredeoghar_20260531_030000.sql.gz
#   bash synology-restore.sh /volume1/backups/caredeoghar/backup_nightly_2026-07-26T02-00-00.sql.enc
#
# ──────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_FILE="${1:-}"
LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:password@localhost:5432/caredeoghar}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <backup-file.sql[.gz][.enc]>"
  echo "Example: $0 /volume1/backups/caredeoghar/caredeoghar_20260531_030000.sql.gz.enc"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

for bin in psql openssl; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: '${bin}' is not installed or not on PATH — cannot restore."
    exit 1
  fi
done

# Decrypted (but still possibly gzipped) SQL lands here. Removed on any exit
# path, including failure, so a plaintext copy of the whole database is never
# left behind on the NAS.
WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT
PAYLOAD="${WORK_DIR}/payload"

if [[ "${BACKUP_FILE}" == *.enc ]]; then
  if [[ -z "${BACKUP_PASSPHRASE}" ]]; then
    read -rsp "Enter backup passphrase: " BACKUP_PASSPHRASE
    echo ""
  fi

  echo "Decrypting ${BACKUP_FILE}..."
  if ! openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:${BACKUP_PASSPHRASE}" \
       -in "${BACKUP_FILE}" -out "${PAYLOAD}"; then
    echo "ERROR: Decryption failed. Wrong passphrase, or the file was encrypted"
    echo "       with a different BACKUP_PASSPHRASE / SESSION_SECRET than the one supplied."
    exit 1
  fi
else
  cp "${BACKUP_FILE}" "${PAYLOAD}"
fi

# Sniff the gzip magic bytes rather than trusting the filename: the in-app
# scheduler writes an uncompressed .sql.enc, synology-backup.sh writes a
# compressed .sql.gz.enc, and both end in .enc.
MAGIC="$(head -c 2 "${PAYLOAD}" | od -An -tx1 | tr -d ' \n')"
if [[ "${MAGIC}" == "1f8b" ]]; then
  echo "Payload is gzipped — decompressing..."
  gunzip -c "${PAYLOAD}" > "${PAYLOAD}.sql"
  mv "${PAYLOAD}.sql" "${PAYLOAD}"
fi

# A schema-complete pg_dump contains CREATE TABLE. The fallback exporter in
# backupReplication.ts emits TRUNCATE + INSERT only and stamps its own
# "-- WARNING: DATA ONLY" header. Restoring one of those into an empty
# database appears to work — psql just reports errors per statement — and
# leaves you with nothing. Say so before touching the target database.
if ! grep -qim1 "^CREATE TABLE" "${PAYLOAD}"; then
  echo ""
  echo "WARNING: this dump contains no CREATE TABLE statements — it is DATA ONLY."
  echo "         It can only be restored into a database whose schema already"
  echo "         exists. Run the migrations against ${LOCAL_DB_URL%%\?*} first,"
  echo "         then re-run this script."
  echo ""
  read -rp "Continue anyway? [y/N] " CONFIRM
  [[ "${CONFIRM}" == "y" || "${CONFIRM}" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

echo "Restoring into the target database..."
# ON_ERROR_STOP so a mid-restore failure exits non-zero instead of printing
# per-statement errors and finishing with "Restore complete."
psql -v ON_ERROR_STOP=1 -f "${PAYLOAD}" "${LOCAL_DB_URL}"

echo "Restore complete."
