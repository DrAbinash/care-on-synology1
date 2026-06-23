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

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <backup-file.sql.gz>"
  echo "Example: $0 /volume1/backups/caredeoghar/caredeoghar_20260531_030000.sql.gz"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

echo "Restoring from ${BACKUP_FILE}..."

# Extract and pipe directly to psql
gunzip -c "${BACKUP_FILE}" | psql "${LOCAL_DB_URL}"

echo "Restore complete."
