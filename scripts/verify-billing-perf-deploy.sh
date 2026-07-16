#!/bin/bash
# verify-billing-perf-deploy.sh — read-only production check for the billing
# save-and-print performance work.
#
# WHY THIS EXISTS
#   The July 2026 save-and-print fix (PR #3: query parallelization + index
#   migration) was reported as producing "no improvement at all". There are
#   only two ways that happens:
#     (a) the fix never reached the running containers — nothing auto-deploys
#         on this NAS; code and migrations only ship when someone runs
#         `bash deploy-synology.sh` (which does `docker compose up -d --build`
#         and re-runs the care-db-patch-v2 migration container), or
#     (b) the fix deployed fine but the dominant cost is elsewhere (it was:
#         the awaited post-commit fan-out, per-request session-touch writes,
#         and per-commit fsync latency — addressed in the follow-up fix that
#         ships alongside this script).
#   This script tells you which world you are in, in about 30 seconds.
#
# USAGE (SSH into the Synology, from the compose project directory):
#   bash scripts/verify-billing-perf-deploy.sh
#
# Read-only: performs SELECTs, SHOWs, greps, and docker inspect only.

set -u

DB_CONTAINER="${DB_CONTAINER:-care-db}"
API_CONTAINER="${API_CONTAINER:-care-api}"
DB_USER="${DB_USER:-erp}"
DB_NAME="${DB_NAME:-diagnostic_erp}"

DOCKER="docker"
if ! $DOCKER ps >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

psql_q() {
  $DOCKER exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -t -A -c "$1" 2>&1
}

section() { printf '\n== %s ==\n' "$1"; }

echo "Billing save-and-print deployment verification ($(date))"

section "1. Is the July 2026 code fix inside the RUNNING api container?"
# The identifier `existingRecentRows` exists only in the fixed bills.ts and the
# api bundle is built unminified, so it survives into /app/dist/index.mjs.
FIX_COUNT=$($DOCKER exec "$API_CONTAINER" grep -c existingRecentRows /app/dist/index.mjs 2>/dev/null || echo "ERR")
if [ "$FIX_COUNT" = "ERR" ]; then
  echo "  Could not inspect $API_CONTAINER — is it running?"
elif [ "$FIX_COUNT" -ge 1 ] 2>/dev/null; then
  echo "  PASS: PR #3 query-parallelization code IS deployed (marker found ${FIX_COUNT}x)."
else
  echo "  FAIL: deployed api bundle predates the July 2026 fix."
  echo "        -> run: bash deploy-synology.sh   (rebuilds images + reruns migrations)"
fi
# Marker from the follow-up fix (async radiology fan-out + slow-save logging).
FOLLOWUP_COUNT=$($DOCKER exec "$API_CONTAINER" grep -c "slow bill save" /app/dist/index.mjs 2>/dev/null || echo "0")
if [ "$FOLLOWUP_COUNT" -ge 1 ] 2>/dev/null; then
  echo "  PASS: follow-up fix (async study fan-out) is deployed too."
else
  echo "  INFO: follow-up fix (async study fan-out) not deployed yet."
fi

section "2. Were the five perf indexes ever created?"
IDX=$(psql_q "SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_bills_bill_number_numeric','idx_bills_patient_created','idx_tokens_date_ledger_no','idx_test_tokens_date_dept_no','idx_radiology_studies_accession_prefix') ORDER BY indexname;")
IDX_COUNT=$(printf '%s\n' "$IDX" | grep -c idx_ || true)
echo "  Found ${IDX_COUNT}/5 indexes:"
printf '%s\n' "$IDX" | sed 's/^/    /'
if [ "$IDX_COUNT" -lt 5 ]; then
  echo "  FAIL: index migration never applied. The care-db-patch-v2 container"
  echo "        only runs during 'docker compose up' — an api-only restart skips it."
  echo "        -> run: bash deploy-synology.sh"
fi

section "3. Migration log + deploy stamp"
psql_q "SELECT name, kind, applied_at FROM schema_migrations_log WHERE name LIKE 'billing_save_print%';" | sed 's/^/  migrations_log: /'
psql_q "SELECT key, value, updated_at FROM schema_deploy_state WHERE key IN ('git_commit','git_branch','build_date');" | sed 's/^/  deploy_state:   /'
echo "  (git_commit 'unknown' just means compose ran without deploy-synology.sh's env exports)"

section "4. Postgres write-latency settings (per-commit fsync floor)"
psql_q "SHOW synchronous_commit;" | sed 's/^/  synchronous_commit: /'
psql_q "SHOW shared_buffers;"     | sed 's/^/  shared_buffers:     /'
echo "  Stock settings + HDD volume = every COMMIT pays a WAL fsync (10-50ms+)."
echo "  The follow-up fix cuts the number of commits gating each save."

section "5. Measure where the time actually goes (do this after deploying)"
cat <<'EOF'
  a) Log in to the ERP as admin, do 2-3 Save & Prints, then open:
       http://<NAS-IP>:8888/erp/diagnostics
     Read the rows for POST /api/orders and POST /api/bills:
       - avg well under ~500ms but the desk still feels slow
           -> the wait is client-side (print preview modal, browser print
              dialog, workstation) — check the workstation's role-based
              print settings and DevTools console for [fetchApi] retry warnings.
       - avg in the seconds
           -> server-side; check container logs for the phase breakdown:
              docker logs care-api 2>&1 | grep -E "slow (bill save|order create)"
  b) On the slow workstation, open DevTools console and run: navigator.onLine
     'false' on a working LAN previously added a hidden 10s stall per request
     (fixed in this branch, but confirms the machine misreports connectivity).
EOF

echo
echo "Done. All checks were read-only."
