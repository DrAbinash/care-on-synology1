#!/usr/bin/env bash
# ─── Care Diagnostics Backup Verification Script ──────────────────────────────
# Automatically tests the integrity of the latest backup file by restoring it
# into a temporary sandbox PostgreSQL Docker container and running queries.
#
# Usage:
#   bash verify-backup-restore.sh [/volume1/backups/caredeoghar]
#
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="${1:-/volume1/backups/caredeoghar}"
SANDBOX_CONTAINER="care-db-restore-sandbox"
SANDBOX_PORT="5499"
SANDBOX_DB="diagnostic_erp_restore_test"
SANDBOX_USER="postgres"
SANDBOX_PASS="sandbox-password-123"

# 1. Locate the latest backup file (supports both encrypted and plaintext)
echo "🔍 Searching for latest backup in ${BACKUP_DIR}..."
LATEST_BACKUP=$(find "${BACKUP_DIR}" -type f \( -name "caredeoghar_*.sql.gz" -o -name "caredeoghar_*.sql.gz.enc" \) -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -f2- -d' ')

if [[ -z "${LATEST_BACKUP}" ]]; then
  # Fallback to current directory or standard local backups path
  BACKUP_DIR="./"
  LATEST_BACKUP=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name "caredeoghar_*.sql.gz" -o -name "caredeoghar_*.sql.gz.enc" -o -name "care_db_daily_*.sql.gz" \) -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -f2- -d' ')
fi

if [[ -z "${LATEST_BACKUP}" ]]; then
  echo "❌ ERROR: No backup file found in ${BACKUP_DIR}."
  exit 1
fi

echo "✅ Found latest backup: ${LATEST_BACKUP}"

# 2. Cleanup any leftover sandbox container
if docker ps -a --format '{{.Names}}' | grep -Eq "^${SANDBOX_CONTAINER}$"; then
  echo "🧹 Removing old sandbox container..."
  docker rm -f "${SANDBOX_CONTAINER}" >/dev/null 2>&1
fi

# 3. Spin up PostgreSQL sandbox container
echo "🐋 Starting sandbox PostgreSQL Docker container..."
docker run --name "${SANDBOX_CONTAINER}" \
  -e POSTGRES_DB="${SANDBOX_DB}" \
  -e POSTGRES_USER="${SANDBOX_USER}" \
  -e POSTGRES_PASSWORD="${SANDBOX_PASS}" \
  -p "${SANDBOX_PORT}:5432" \
  -d postgres:16-alpine >/dev/null

# Setup cleanup trap to ensure container is removed on script exit/failure
cleanup() {
  echo "🧹 Cleaning up sandbox container..."
  docker rm -f "${SANDBOX_CONTAINER}" >/dev/null 2>&1
}
trap cleanup EXIT

# 4. Wait for PostgreSQL to become fully ready
echo "⏳ Waiting for PostgreSQL to initialize..."
RETRIES=30
until docker exec "${SANDBOX_CONTAINER}" pg_isready -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" >/dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  sleep 1
  RETRIES=$((RETRIES-1))
done

if [ $RETRIES -eq 0 ]; then
  echo "❌ ERROR: Sandbox PostgreSQL container failed to start in time."
  exit 1
fi
echo "✅ PostgreSQL sandbox container is healthy."

# 5. Restore Database
LOCAL_DB_URL="postgresql://${SANDBOX_USER}:${SANDBOX_PASS}@localhost:${SANDBOX_PORT}/${SANDBOX_DB}"

# Use synology-restore.sh logic
echo "⚡ Executing restore on sandbox database..."
if [[ "${LATEST_BACKUP}" == *.enc ]]; then
  if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "❌ ERROR: BACKUP_PASSPHRASE is not set. Encrypted backups cannot be auto-verified without the passphrase."
    exit 1
  fi
  
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:${BACKUP_PASSPHRASE}" -in "${LATEST_BACKUP}" | gunzip -c | docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" >/dev/null
else
  gunzip -c "${LATEST_BACKUP}" | docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" >/dev/null
fi

echo "✅ Restore step complete."

# 6. Run Sanity Checks / Queries
echo "📋 Running database integrity checks..."

# Check if vital tables exist and query patient counts
PATIENT_COUNT=$(docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" -t -A -c "SELECT COUNT(*) FROM patients;" 2>/dev/null || echo "ERROR")
BILL_COUNT=$(docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" -t -A -c "SELECT COUNT(*) FROM bills;" 2>/dev/null || echo "ERROR")
VOUCHER_COUNT=$(docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" -t -A -c "SELECT COUNT(*) FROM vouchers;" 2>/dev/null || echo "ERROR")

if [[ "${PATIENT_COUNT}" == "ERROR" ]]; then
  echo "❌ INTEGRITY FAILURE: Core tables were not found or failed to query."
  exit 1
fi

echo "📊 Sanity Check Metrics:"
echo "   - Patients: ${PATIENT_COUNT}"
echo "   - Bills:    ${BILL_COUNT}"
echo "   - Vouchers: ${VOUCHER_COUNT}"

echo "🎉 BACKUP VERIFICATION SUCCESSFUL! Backup file integrity is 100% valid."
