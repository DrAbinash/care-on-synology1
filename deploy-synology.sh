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
#   5. Open browser: http://172.16.1.139:8888
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
# Always deploy from main. The old deploy branch
# feature/website-login-redirection was deleted after the default branch moved
# to main; leaving the script on that name made `git fetch` fail (set -e) or
# reset to a stale local ref — so Synology kept serving old CARE while GitHub
# main received weeks of radiology / billing merges with "nothing changed" in
# the clinic. A leftover topic-branch checkout used to silently "succeed" a
# plain `git pull` the same way; hard-reset to origin/main prevents that.
DEPLOY_BRANCH="main"
info "Pulling latest updates from GitHub (origin/${DEPLOY_BRANCH})..."
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]; then
  warn "On branch '${CURRENT_BRANCH:-detached HEAD}', not ${DEPLOY_BRANCH} — switching."
fi
git fetch origin "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH" 2>/dev/null || git checkout -B "$DEPLOY_BRANCH" "origin/${DEPLOY_BRANCH}"
git reset --hard "origin/${DEPLOY_BRANCH}"
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

# ── Step 2b: Ensure .env (Hope↔Care keys included) ───────────────────────────
# Operator should not have to invent secrets. If .env is missing, seed it from
# the Synology template. If it exists but lacks Hope keys, append them so a
# redeploy of an older .env still wires referrals automatically.
if [ ! -f .env ]; then
  if [ -f deploy/synology/care.env ]; then
    cp deploy/synology/care.env .env
    ok "Created .env from deploy/synology/care.env (Hope integration included)"
  else
    fail ".env missing and deploy/synology/care.env not found"
  fi
else
  ensure_env_key() {
    key="$1"
    val="$2"
    if ! grep -qE "^${key}=" .env 2>/dev/null; then
      printf '\n%s=%s\n' "$key" "$val" >> .env
      info "Appended missing ${key} to .env"
    fi
  }
  ensure_env_key "INTEGRATION_HOPE_CALLBACK_URL" "http://172.16.1.139:7080/api/integration/care-callback"
  ensure_env_key "INTEGRATION_HOPE_SIGNING_SECRET" "7ab91cf3b7a45c4a3b4a6a90aa63ed2be921abc77bbd007f0de60093ba895f0f"
  ensure_env_key "HOPE_CARE_INTEGRATION_FORCE" "1"
  ensure_env_key "HOPE_PARTNER_KEY" "intgk_8ffb1b9c5b982148cfbe89448064cc4986b172bea48fe73b0f622f4a192da7e7"
  ok ".env present (Hope integration keys ensured)"
fi

# ── Step 2c: Reject weak machine-to-machine secrets ───────────────────────────
info "Checking guarded secrets in .env..."
if command -v node >/dev/null 2>&1 && [ -f scripts/check-env-secrets.mjs ]; then
  node scripts/check-env-secrets.mjs --file .env || fail "Weak INTERNAL_API_KEY / CRON_SECRET / WHATSAPP_AUTOMATION_SECRET in .env — run: bash scripts/rotate-internal-api-key.sh"
  ok "Guarded secrets acceptable"
else
  warn "Skipping secret-strength check (node or scripts/check-env-secrets.mjs missing)"
fi

# ── Step 3: Build and start ───────────────────────────────────────────────────
info "Building and starting containers (this takes 3-5 minutes)..."
echo ""

sudo docker compose down --remove-orphans 2>/dev/null || true
# `sudo` resets the environment by default, so the GIT_COMMIT/GIT_BRANCH/
# ERP_VERSION/etc. exported above never reached docker compose's
# ${GIT_COMMIT:-unknown}-style substitution — every deploy silently baked in
# the "unknown"/"0" fallbacks regardless of what was actually deployed.
# Passing them as explicit VAR=value assignments on the sudo command line
# forwards them into the child process regardless of the sudoers env_reset
# policy (unlike relying on `sudo -E`, which some sudoers configs restrict).
sudo \
  GIT_COMMIT="$GIT_COMMIT" \
  GIT_BRANCH="$GIT_BRANCH" \
  GIT_TAG="$GIT_TAG" \
  BUILD_DATE="$BUILD_DATE" \
  ERP_VERSION="$ERP_VERSION" \
  BUILD_NUMBER="$BUILD_NUMBER" \
  RELEASE_NAME="$RELEASE_NAME" \
  docker compose up -d --build

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
echo -e "  ERP Address : ${BOLD}http://172.16.1.139:8888${NC}"
echo -e "  Version     : Care ERP v${ERP_VERSION} build ${BUILD_NUMBER}"
echo -e "  Completed   : $(date '+%d %B %Y  %H:%M')"
echo ""
echo -e "  Hope↔Care   : partner + ff_hope_care_referrals auto on API start"
echo -e "  ${YELLOW}If login doesn't work after 1 minute, run:${NC}"
echo -e "  ${YELLOW}docker logs care-api --tail 40${NC}"
echo ""
