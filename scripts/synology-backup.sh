#!/usr/bin/env bash
# ─── Synology NAS Daily Backup Script for Care Diagnostics ───────────────────
# Downloads a pg_dump SQL backup from the Replit API server and stores it on
# the Synology NAS. Intended to be run via DSM Task Scheduler (Control Panel →
# Task Scheduler → Create → Scheduled Task → User-defined script) at 03:00 IST.
#
# Requires:
#   - curl (installed by default on Synology DSM)
#   - INTERNAL_API_KEY from Replit Secrets (set below or via DSM environment)
#   - Replit app is deployed and accessible
#
# Setup:
#   1. Copy this file to /volume1/scripts/caredeoghar-backup.sh on Synology
#   2. chmod +x /volume1/scripts/caredeoghar-backup.sh
#   3. Set BACKUP_DIR and API_KEY below
#   4. In DSM Task Scheduler, add a daily task at 03:00 running:
#        bash /volume1/scripts/caredeoghar-backup.sh
#
# ──────────────────────────────────────────────────────────

set -euo pipefail

# ─── CONFIGURATION ───────────────────────────────────────────
BACKUP_DIR="/volume1/backups/caredeoghar"
API_KEY="${CAREDEOGHAR_API_KEY:-}"  # Set in DSM environment or hardcode here
API_BASE="https://caredeoghar.replit.app"
RETENTION_DAYS=7

# You can also hardcode the key (not recommended for production):
# API_KEY="your-internal-api-key-here"

# ─── VALIDATION ─────────────────────────────────────────────────
if [[ -z "${API_KEY}" ]]; then
  echo "ERROR: API_KEY is not set. Set CAREDEOGHAR_API_KEY environment variable or edit this script."
  exit 1
fi

# ─── PREPARE ────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="caredeoghar_${TIMESTAMP}.sql.gz"
DEST="${BACKUP_DIR}/${FILENAME}"
LOG="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting backup from ${API_BASE}" | tee -a "${LOG}"

# ─── DOWNLOAD ──────────────────────────────────────────────────────
HTTP_CODE=$(curl -s -o "${DEST}" -w "%{http_code}" \
  --max-time 300 \
  -H "Authorization: Bearer ${API_KEY}" \
  "${API_BASE}/api/internal/backup/download?format=gzip")

if [[ "${HTTP_CODE}" -ne 200 ]]; then
  echo "[${TIMESTAMP}] ERROR: Backup failed with HTTP ${HTTP_CODE}" | tee -a "${LOG}"
  rm -f "${DEST}"
  exit 1
fi

SIZE=$(du -h "${DEST}" | cut -f1)
echo "[${TIMESTAMP}] Backup saved: ${DEST} (${SIZE})" | tee -a "${LOG}"

# ─── RETENTION CLEANUP ─────────────────────────────────────────────────────
REMOVED=$(find "${BACKUP_DIR}" -name "caredeoghar_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [[ "${REMOVED}" -gt 0 ]]; then
  echo "[${TIMESTAMP}] Purged ${REMOVED} old backup(s) older than ${RETENTION_DAYS} days" | tee -a "${LOG}"
fi

echo "[${TIMESTAMP}] Backup complete." | tee -a "${LOG}"
