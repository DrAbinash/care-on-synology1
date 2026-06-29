#!/bin/bash
# =============================================================================
# Care Diagnostics ERP — One-Click Deploy
# Dr. Abinash Kumar, Deoghar
# =============================================================================
# HOW TO USE:
#   1. Open Synology terminal (Control Panel → Terminal → SSH)
#   2. Type:  cd /volume1/docker/care-erp-github/care-on-synology1
#   3. Type:  bash deploy-synology.sh
#   4. Wait for "DEPLOYMENT COMPLETE"
#   5. Open browser: http://192.168.1.137:8888
#
# That is ALL you need to do. Nothing else.
# =============================================================================

set -e

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'; BOLD='\033[1m'
ok()   { echo -e "${GREEN}  ✓ ${1}${NC}"; }
fail() { echo -e "${RED}  ✗ ${1}${NC}"; exit 1; }
info() { echo -e "${BLUE}  ▸ ${1}${NC}"; }
warn() { echo -e "${YELLOW}  ! ${1}${NC}"; }

echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  Care Diagnostics ERP — Deployment${NC}"
echo -e "${BOLD}  $(date '+%d %B %Y  %H:%M')${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ── Step 1: Pull latest code ─────────────────────────────────────────────────
info "Pulling latest updates from GitHub..."
git pull --ff-only 2>/dev/null || {
  warn "Could not auto-pull. Trying full fetch..."
  git fetch origin
  git reset --hard origin/feature/website-login-redirection
}
ok "Code updated: $(git log -1 --format='%h — %s')"

# ── Step 2: Set version metadata ─────────────────────────────────────────────
export GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
export GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
export GIT_TAG=$(git describe --tags --always 2>/dev/null || echo "untagged")
export BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -f "scripts/bump-build.cjs" ] && command -v node >/dev/null 2>&1; then
  BUMP=$(node scripts/bump-build.cjs 2>/dev/null || echo "")
  export ERP_VERSION=$(echo "${BUMP}" | grep "^ERP_VERSION=" | cut -d= -f2 || \
    python3 -c "import json; d=json.load(open('version.json')); print(d.get('version','2.0.0'))" 2>/dev/null || echo "2.0.0")
  export BUILD_NUMBER=$(echo "${BUMP}" | grep "^BUILD_NUMBER=" | cut -d= -f2 || \
    python3 -c "import json; d=json.load(open('version.json')); print(d.get('buildNumber',0))" 2>/dev/null || echo "0")
  export RELEASE_NAME=$(echo "${BUMP}" | grep "^RELEASE_NAME=" | cut -d= -f2 || echo "")
else
  export ERP_VERSION=$(python3 -c "import json; d=json.load(open('version.json')); print(d.get('version','2.0.0'))" 2>/dev/null || echo "2.0.0")
  export BUILD_NUMBER=$(python3 -c "import json; d=json.load(open('version.json')); print(d.get('buildNumber',0))" 2>/dev/null || echo "0")
  export RELEASE_NAME=""
fi
ok "Version: Care ERP v${ERP_VERSION} build ${BUILD_NUMBER}"

# ── Step 3: Build and start ───────────────────────────────────────────────────
info "Building and starting containers (this takes 3-5 minutes)..."
echo ""

sudo docker compose down --remove-orphans 2>/dev/null || true
sudo docker compose up -d --build

echo ""
ok "Containers started"

# ── Step 4: Wait for migrations ───────────────────────────────────────────────
info "Waiting for database migrations..."
waited=0
while [ $waited -lt 120 ]; do
  state=$(sudo docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' care-db-patch-v2 2>/dev/null || echo "missing 0")
  status=$(echo $state | awk '{print $1}')
  code=$(echo $state | awk '{print $2}')
  
  if [ "$status" = "exited" ] && [ "$code" = "0" ]; then
    ok "Database migrations complete"
    break
  elif [ "$status" = "exited" ] && [ "$code" != "0" ]; then
    echo ""
    echo -e "${RED}  ✗ Migration failed! Showing logs:${NC}"
    echo ""
    sudo docker logs care-db-patch-v2 --tail 30 2>/dev/null
    echo ""
    fail "Migrations failed. Please share the error above with your developer."
  fi
  
  printf "    Migrating... (${waited}s)\r"
  sleep 5
  waited=$((waited+5))
done

# ── Step 5: Wait for API health ───────────────────────────────────────────────
info "Waiting for ERP to start..."
waited=0
while [ $waited -lt 90 ]; do
  response=$(wget -qO- "http://localhost:8080/api/health/schema" 2>/dev/null || echo "")
  if echo "$response" | grep -q '"ok":true'; then
    ok "ERP is healthy and ready"
    break
  fi
  printf "    Starting... (${waited}s)\r"
  sleep 5
  waited=$((waited+5))
done

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}============================================================${NC}"
echo -e "${BOLD}${GREEN}  ✓ DEPLOYMENT COMPLETE${NC}"
echo -e "${BOLD}${GREEN}============================================================${NC}"
echo ""
echo -e "  ERP Address : ${BOLD}http://192.168.1.137:8888${NC}"
echo -e "  Version     : Care ERP v${ERP_VERSION} build ${BUILD_NUMBER}"
echo -e "  Completed   : $(date '+%d %B %Y  %H:%M')"
echo ""
echo -e "  ${YELLOW}If login doesn't work after 1 minute, run:${NC}"
echo -e "  ${YELLOW}docker logs care-api --tail 20${NC}"
echo ""
