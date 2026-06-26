#!/usr/bin/env bash
# ─── Synology NAS Restore Script for Care Diagnostics ───────────────────────
# Restores a downloaded pg_dump backup into the local Synology PostgreSQL.
# Run this manually when you need to sync the latest data from Replit.
#
# Usage:
#   bash synology-restore.sh /volume1/backups/caredeoghar/caredeoghar_20260531_030000.sql.gz
#
# ──────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_FILE="${1:-}"
LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:password@localhost:5432/caredeoghar}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <backup-file.sql.gz or backup-file.sql.gz.enc>"
  echo "Example: $0 /volume1/backups/caredeoghar/caredeoghar_20260531_030000.sql.gz.enc"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

# Decrypt if the file ends with .enc
if [[ "${BACKUP_FILE}" == *.enc ]]; then
  if [[ -z "${BACKUP_PASSPHRASE}" ]]; then
    read -sp "Enter backup passphrase: " BACKUP_PASSPHRASE
    echo ""
  fi
  
  echo "Decrypting and restoring from ${BACKUP_FILE}..."
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:${BACKUP_PASSPHRASE}" -in "${BACKUP_FILE}" | gunzip -c | psql "${LOCAL_DB_URL}"
else
  echo "Restoring from plaintext ${BACKUP_FILE}..."
  gunzip -c "${BACKUP_FILE}" | psql "${LOCAL_DB_URL}"
fi

echo "Restore complete."

