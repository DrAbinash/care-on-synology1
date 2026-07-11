#!/bin/bash
# =============================================================================
# apply-payment-uniqueness-index.sh
#
# Safely applies the "no duplicate payment" protection to your live database.
#
# WHAT THIS DOES, IN ORDER:
#   1. Backs up your database first (always, no matter what).
#   2. Checks for existing duplicate payments.
#   3. If NONE are found  -> applies the protection automatically, then verifies it.
#   4. If duplicates ARE found -> STOPS. Applies nothing. Shows you the list
#      so you (or Claude, next chat) can review before anything is touched.
#
# HOW TO RUN THIS ON YOUR SYNOLOGY:
#   1. Copy this file into your project folder (same folder as docker-compose.yml)
#   2. Open a terminal there and run:
#        chmod +x apply-payment-uniqueness-index.sh
#        ./apply-payment-uniqueness-index.sh
#   3. Read the output. It will tell you plainly what happened.
# =============================================================================

set -e

# Reads DB_USER / DB_NAME from your .env file if present, otherwise uses the
# same defaults Care ERP uses everywhere else.
if [ -f .env ]; then
  export "$(grep -E '^DB_USER=' .env | xargs)" 2>/dev/null || true
  export "$(grep -E '^DB_NAME=' .env | xargs)" 2>/dev/null || true
fi
DB_USER="${DB_USER:-erp}"
DB_NAME="${DB_NAME:-diagnostic_erp}"
CONTAINER="care-db"

BACKUP_DIR="./backups"
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/pre-payment-index-backup-${TS}.sql"

echo "============================================================"
echo "  Duplicate Payment Protection — Safe Apply"
echo "  Database: ${DB_NAME}  (container: ${CONTAINER})"
echo "============================================================"
echo ""

# ── Step 0: Make sure the database container is actually running ───────────
if ! docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -q true; then
  echo "✗ Container '${CONTAINER}' is not running. Start your stack first:"
  echo "    docker compose up -d"
  exit 1
fi

# ── Step 1: Backup ───────────────────────────────────────────────────────────
echo "▸ Step 1/4: Backing up database to ${BACKUP_FILE} ..."
mkdir -p "${BACKUP_DIR}"
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" "${DB_NAME}" > "${BACKUP_FILE}"
if [ -s "${BACKUP_FILE}" ]; then
  echo "  ✓ Backup complete ($(du -h "${BACKUP_FILE}" | cut -f1))"
else
  echo "  ✗ Backup file is empty — aborting, nothing else will run."
  exit 1
fi
echo ""

# ── Step 2: Check for duplicate payments ─────────────────────────────────────
echo "▸ Step 2/4: Checking for existing duplicate payments ..."
DUP_COUNT=$(docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "
  SELECT COUNT(*) FROM (
    SELECT bill_id, reference_number
    FROM payments
    WHERE reference_number IS NOT NULL
    GROUP BY bill_id, reference_number
    HAVING COUNT(*) > 1
  ) sub;
")
DUP_COUNT=$(echo "${DUP_COUNT}" | tr -d '[:space:]')
echo "  Duplicate bill/reference-number pairs found: ${DUP_COUNT}"
echo ""

if [ "${DUP_COUNT}" != "0" ]; then
  echo "✗ STOPPING HERE. ${DUP_COUNT} duplicate pair(s) found — the protection"
  echo "  index cannot be created until these are reviewed and resolved."
  echo "  Nothing has been changed in your database besides the backup above."
  echo ""
  echo "  Details of the duplicates:"
  docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "
    SELECT
      p.bill_id, b.bill_number, p.reference_number, p.amount, p.method,
      p.recorded_by_name, p.created_at
    FROM payments p
    JOIN bills b ON b.id = p.bill_id
    WHERE p.reference_number IN (
      SELECT reference_number FROM payments
      WHERE reference_number IS NOT NULL
      GROUP BY bill_id, reference_number HAVING COUNT(*) > 1
    )
    ORDER BY p.bill_id, p.reference_number, p.created_at;
  "
  echo ""
  echo "  Copy the table above and share it with Claude next chat — it can"
  echo "  help you decide which row in each pair to keep before we re-run this."
  exit 1
fi

echo "  ✓ No duplicates found. Safe to proceed."
echo ""

# ── Step 3: Create the protective index ───────────────────────────────────────
echo "▸ Step 3/4: Creating the protection (unique index) ..."
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
    idx_payments_bill_ref_unique
  ON payments (bill_id, reference_number)
  WHERE reference_number IS NOT NULL;
"
echo "  ✓ Index created."
echo ""

# ── Step 4: Verify ────────────────────────────────────────────────────────────
echo "▸ Step 4/4: Verifying ..."
RESULT=$(docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'payments' AND indexname = 'idx_payments_bill_ref_unique';
")
RESULT=$(echo "${RESULT}" | tr -d '[:space:]')

echo ""
echo "============================================================"
if [ "${RESULT}" = "idx_payments_bill_ref_unique" ]; then
  echo "  ✓ SUCCESS — duplicate payment protection is now ACTIVE."
  echo "  From now on, the same transaction reference number can never"
  echo "  be recorded twice on the same bill. Cash payments (no reference"
  echo "  number) are unaffected."
  echo ""
  echo "  Backup saved at: ${BACKUP_FILE}"
  echo "  (keep this for a while, in case you ever need to roll back)"
else
  echo "  ✗ Something went wrong — the index was not found after creation."
  echo "  Your backup is safe at: ${BACKUP_FILE}"
  echo "  Share this output with Claude next chat."
fi
echo "============================================================"
