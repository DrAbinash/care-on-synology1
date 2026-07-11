#!/bin/bash
# Verification Script: Abnormality Engine Migration Fix
# Run after deployment to verify everything works

set -e
echo "🔍 Verifying abnormality engine migration fix..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0
PASSED=0

# Helper functions
pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((PASSED++))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  ((FAILED++))
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

echo "════════════════════════════════════════════════════════"
echo "STEP 1: Check migration files"
echo "════════════════════════════════════════════════════════"

if [ -f "migrations/z_add_abnormality_engine.sql" ]; then
  pass "Fixed migration file exists: z_add_abnormality_engine.sql"
else
  fail "Fixed migration file NOT FOUND: z_add_abnormality_engine.sql"
fi

if [ ! -f "migrations/add_abnormality_engine.sql" ]; then
  pass "Old broken file removed: add_abnormality_engine.sql"
else
  fail "Old broken file STILL EXISTS: add_abnormality_engine.sql"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "STEP 2: Verify execution order"
echo "════════════════════════════════════════════════════════"

RADIOLOGY_MIGRATIONS=$(ls -1 migrations/ | grep -E "radiology|abnormality")

# Build array of migration order
mapfile -t MIGRATION_ORDER < <(echo "$RADIOLOGY_MIGRATIONS")

# Expected order
EXPECTED=(
  "add_radiology_navigator_regions.sql"
  "add_radiology_protocols.sql"
  "add_radiology_quick_findings.sql"
  "add_radiology_smart_reporting.sql"
  "z_add_abnormality_engine.sql"
)

CORRECT_ORDER=true
for i in "${!EXPECTED[@]}"; do
  if [ "${MIGRATION_ORDER[$i]}" != "${EXPECTED[$i]}" ]; then
    CORRECT_ORDER=false
    break
  fi
done

if [ "$CORRECT_ORDER" = true ]; then
  pass "Migrations in correct order (z_add_abnormality_engine.sql is LAST)"
  echo "  Order:"
  ls -1 migrations/ | grep -E "radiology|abnormality" | sed 's/^/    /'
else
  fail "Migrations in WRONG order!"
  echo "  Expected:"
  for m in "${EXPECTED[@]}"; do echo "    $m"; done
  echo "  Got:"
  echo "$RADIOLOGY_MIGRATIONS" | sed 's/^/    /'
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "STEP 3: Check Docker services"
echo "════════════════════════════════════════════════════════"

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
  warn "docker-compose command not found (skipping service checks)"
else
  # Check if services are running
  if docker-compose ps | grep -q "care-db"; then
    pass "Database (care-db) is running"
  else
    fail "Database (care-db) is NOT running"
  fi

  if docker-compose ps | grep -q "care-api"; then
    pass "API server (care-api) is running"
  else
    fail "API server (care-api) is NOT running"
  fi

  # Check migration logs
  if docker-compose logs care-db-patch-v2 2>/dev/null | grep -q "z_add_abnormality_engine.sql"; then
    if docker-compose logs care-db-patch-v2 2>/dev/null | grep -q "completed\|COMPLETED"; then
      pass "Migration z_add_abnormality_engine.sql completed successfully"
    else
      fail "Migration z_add_abnormality_engine.sql did NOT complete"
    fi
  else
    warn "Migration z_add_abnormality_engine.sql not yet run (fresh deployment?)"
  fi
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "STEP 4: Check database schema (if DB is running)"
echo "════════════════════════════════════════════════════════"

if ! command -v docker-compose &> /dev/null; then
  warn "docker-compose not available (skipping DB checks)"
elif ! docker-compose ps | grep -q "care-db.*Up"; then
  warn "Database not running (skipping DB checks)"
else
  # Check if radiology_quick_findings exists
  if docker exec care-db psql -U postgres -d care_erp_db -c "SELECT 1 FROM radiology_quick_findings LIMIT 1;" 2>/dev/null | grep -q "1"; then
    pass "Table radiology_quick_findings exists with data"
    
    # Check if properties column exists
    if docker exec care-db psql -U postgres -d care_erp_db -c "SELECT properties FROM radiology_quick_findings LIMIT 1;" 2>/dev/null | grep -q ""; then
      pass "Column 'properties' exists in radiology_quick_findings"
    else
      fail "Column 'properties' NOT found in radiology_quick_findings"
    fi
  else
    warn "Table radiology_quick_findings doesn't exist yet (fresh database?)"
  fi

  # Check if radiology_study_tabs exists
  if docker exec care-db psql -U postgres -d care_erp_db -c "SELECT 1 FROM radiology_study_tabs LIMIT 1;" 2>/dev/null | grep -q "1"; then
    pass "Table radiology_study_tabs exists with data"
    
    # Check if technique_text column exists
    if docker exec care-db psql -U postgres -d care_erp_db -c "SELECT technique_text FROM radiology_study_tabs LIMIT 1;" 2>/dev/null; then
      pass "Column 'technique_text' exists in radiology_study_tabs"
    else
      fail "Column 'technique_text' NOT found in radiology_study_tabs"
    fi
  else
    warn "Table radiology_study_tabs doesn't exist yet (fresh database?)"
  fi
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "STEP 5: Check API health"
echo "════════════════════════════════════════════════════════"

if command -v curl &> /dev/null; then
  if curl -s http://192.168.1.137:3000/health 2>/dev/null | grep -q "ok\|true"; then
    pass "API health check passed"
  else
    warn "Could not reach API at http://192.168.1.137:3000/health"
  fi
else
  warn "curl command not found (skipping health check)"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "FINAL RESULT"
echo "════════════════════════════════════════════════════════"

TOTAL=$((PASSED + FAILED))
echo ""
echo "Passed: ${GREEN}${PASSED}${NC}"
echo "Failed: ${RED}${FAILED}${NC}"
echo "Total:  ${TOTAL}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
  echo "The abnormality engine migration fix is working correctly."
  exit 0
else
  echo -e "${RED}⚠️  SOME CHECKS FAILED!${NC}"
  echo "Please review the failures above and consult the deployment guide."
  exit 1
fi
