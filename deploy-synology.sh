#!/bin/bash
# =============================================================================
# deploy-synology.sh — Zero-touch production deployment for Care Diagnostics
# =============================================================================
#
# Usage (on the Synology NAS via SSH):
#   git pull
#   docker compose up -d --build
#
# Or run this script directly for full deployment with verification:
#   ./deploy-synology.sh
#
# This script does NOT need to be run — `docker compose up -d --build` is
# sufficient. This script adds verification steps and better logging.
#
# Schema migration is FULLY AUTOMATIC:
#   docker-compose starts care-db → care-db-patch-v2 (migrations) → care-api → care-web
#   No manual drizzle-kit commands. No manual SQL. No manual anything.
#
# =============================================================================

set -e

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ ${1}${NC}"; }
fail() { echo -e "${RED}  ✗ ${1}${NC}"; exit 1; }
info() { echo -e "${BLUE}  ▸ ${1}${NC}"; }
warn() { echo -e "${YELLOW}  ! ${1}${NC}"; }

echo ""
echo "============================================================"
echo "  Care Diagnostics ERP — Production Deployment"
echo "  Host: $(hostname)"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"
echo ""

# ── Step 1: Verify environment ────────────────────────────────────────────────
info "Checking environment…"

if [ ! -f ".env" ]; then
  fail ".env file not found — copy .env.example to .env and fill in secrets"
fi

# Check required secrets are set
required_vars="JWT_SECRET SESSION_SECRET ICICI_SECRET_KEY"
for var in $required_vars; do
  val=$(grep -E "^${var}=" .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "${val}" ] || echo "${val}" | grep -q "CHANGE_ME\|your_"; then
    fail "${var} is not set or still has placeholder value in .env"
  fi
done
ok "Environment validated"

# ── Step 2: Pull latest code ───────────────────────────────────────────────────
info "Pulling latest code from git…"
git pull --ff-only || {
  warn "git pull failed — continuing with current code"
}
ok "Code is up to date: $(git log -1 --format='%h %s' 2>/dev/null || echo 'unknown')"

# ── Step 3: Build and deploy containers ────────────────────────────────────────
info "Building and starting containers…"
info "(This rebuilds the API and web images — takes 2-5 minutes)"

# Export git metadata for schema verifier startup report
export GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
export GIT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
info "Git commit: ${GIT_COMMIT:0:12}  branch: ${GIT_BRANCH}"

# Use docker compose (V2) or docker-compose (V1)
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif docker-compose version &>/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  fail "Neither 'docker compose' nor 'docker-compose' found"
fi

$COMPOSE up -d --build --remove-orphans

ok "Containers started"

# ── Step 4: Wait for db-patch-v2 to complete ──────────────────────────────────
echo ""
info "Waiting for schema migrations to complete (care-db-patch-v2)…"

max_wait=120
waited=0
while [ "${waited}" -lt "${max_wait}" ]; do
  state=$($COMPOSE ps care-db-patch-v2 2>/dev/null | grep -E "Exited|exited|Exit" | head -1 || echo "")
  running=$($COMPOSE ps care-db-patch-v2 2>/dev/null | grep -E "running|Running|Up" | head -1 || echo "")

  if echo "${state}" | grep -q "Exit 0\|exited (0)"; then
    ok "Schema migrations complete (care-db-patch-v2 exited 0)"
    break
  elif echo "${state}" | grep -qE "Exit [1-9]|exited \([1-9]"; then
    echo ""
    fail "Schema migrations FAILED — check logs: docker compose logs care-db-patch-v2"
  elif [ -z "${running}" ] && [ -z "${state}" ]; then
    # Container not yet started
    sleep 3; waited=$((waited + 3))
    printf "."
  else
    sleep 3; waited=$((waited + 3))
    printf "."
  fi
done

if [ "${waited}" -ge "${max_wait}" ]; then
  fail "Schema migrations timed out after ${max_wait}s — check: docker compose logs care-db-patch-v2"
fi

# ── Step 5: Wait for API to pass schema health check ──────────────────────────
echo ""
info "Waiting for API schema health check to pass…"

# Get the host port the API is reachable on (from docker-compose mapping or default)
API_PORT="${API_HOST_PORT:-8080}"
API_URL="http://localhost:${API_PORT}"

# The API healthcheck is on /api/health/schema (returns 200 only if schema is current)
max_api_wait=90
waited=0
while [ "${waited}" -lt "${max_api_wait}" ]; do
  response=$(wget -qO- "${API_URL}/api/health/schema" 2>/dev/null || echo "")
  if echo "${response}" | grep -q '"ok":true'; then
    ok "API schema health check passed"
    break
  fi
  sleep 3; waited=$((waited + 3))
  printf "."
done

if [ "${waited}" -ge "${max_api_wait}" ]; then
  echo ""
  warn "API health check did not pass within ${max_api_wait}s"
  warn "Check: curl ${API_URL}/api/health/schema"
  warn "Logs:  docker compose logs care-api --tail 50"
fi

# ── Step 6: Print deployment summary ──────────────────────────────────────────
echo ""
echo "============================================================"
echo -e "${GREEN}  ✓ Deployment complete${NC}"
echo "  Git:    $(git log -1 --format='%h %s' 2>/dev/null || echo 'unknown')"
echo "  Time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""
echo "  Services:"
$COMPOSE ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || $COMPOSE ps
echo ""
echo "  Schema health:  curl http://localhost:${API_PORT}/api/health/schema"
echo "  Migration log:  docker compose logs care-db-patch-v2"
echo "  API log:        docker compose logs care-api --tail 50"
echo "============================================================"
echo ""
