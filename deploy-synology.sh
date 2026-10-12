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
# Populated live from Git / version.json — never hard-coded. Fail soft to
# unknown/none/0 so a missing git binary or detached empty worktree cannot
# abort a deploy. docker-compose.yml passes these as build.args → Dockerfile
# ARG/ENV. Dockerfile ARG defaults (0.0.0 / unknown) are only placeholders;
# the values below are what compose actually injects.
export GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
export GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
# Exact tag on HEAD only; otherwise "none" (not an abbreviated SHA from --always).
export GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "none")
export BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ERP_VERSION / BUILD_NUMBER / RELEASE_NAME come from version.json via
# scripts/bump-build.cjs (monotonic buildNumber). No new versioning scheme.
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
ok "Version: Care ERP v${ERP_VERSION} build ${BUILD_NUMBER} (${RELEASE_NAME:-unnamed})"
ok "Git: ${GIT_COMMIT:0:12} branch=${GIT_BRANCH} tag=${GIT_TAG} date=${BUILD_DATE}"

# Stamp git/build metadata into version.json so Container Manager rebuilds that
# bake /app/version.json (but forget compose build-args) still expose a real SHA
# via resolveVersionInfo()'s version.json fallback — never invent a fake SHA.
if command -v node >/dev/null 2>&1 && [ -f version.json ]; then
  node -e "
    const fs = require('fs');
    const v = JSON.parse(fs.readFileSync('version.json','utf8'));
    v.gitCommit = process.env.GIT_COMMIT || v.gitCommit || 'unknown';
    v.gitBranch = process.env.GIT_BRANCH || v.gitBranch || 'unknown';
    v.gitTag = process.env.GIT_TAG || v.gitTag || 'none';
    v.buildDate = process.env.BUILD_DATE || v.buildDate || null;
    if (process.env.ERP_VERSION) v.version = process.env.ERP_VERSION;
    if (process.env.BUILD_NUMBER) v.buildNumber = Number(process.env.BUILD_NUMBER);
    if (process.env.RELEASE_NAME) v.releaseName = process.env.RELEASE_NAME;
    fs.writeFileSync('version.json', JSON.stringify(v, null, 2) + '\n');
  " && ok "Stamped git metadata into version.json for image bake"
fi

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

# Upsert build identity into .env so `docker compose` / Container Manager
# ${VAR:-fallback} interpolation works even when the shell env is empty
# (Container Manager rebuilds do not inherit the exports above). .env is in
# .dockerignore — these keys are for compose host-side substitution only.
upsert_env_key() {
  key="$1"
  val="$2"
  tmp=$(mktemp)
  if [ -f .env ]; then
    grep -vE "^${key}=" .env > "$tmp" || true
  else
    : > "$tmp"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" .env
}
upsert_env_key "GIT_COMMIT" "$GIT_COMMIT"
upsert_env_key "GIT_BRANCH" "$GIT_BRANCH"
upsert_env_key "GIT_TAG" "$GIT_TAG"
upsert_env_key "BUILD_DATE" "$BUILD_DATE"
upsert_env_key "ERP_VERSION" "$ERP_VERSION"
upsert_env_key "BUILD_NUMBER" "$BUILD_NUMBER"
upsert_env_key "RELEASE_NAME" "$RELEASE_NAME"
ok "Wrote build metadata into .env for compose / Container Manager"

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
# HOST_PORT lives in .env — `docker compose` interpolates it, the shell does not
# — and the gate below must probe the port the clinic actually opens rather than
# a number copied into a script (the last one was wrong, and quietly).
HOST_PORT=8888
if [ -f .env ]; then
  RAW_HOST_PORT=$(grep -E '^HOST_PORT=' .env | tail -1 | cut -d= -f2-)
  PARSED=$(printf '%s' "$RAW_HOST_PORT" | tr -d '[:space:]"' | tr -d "'")
  case "$PARSED" in
    ''|*[!0-9]*) : ;;           # not a number: keep the compose default
    *) HOST_PORT="$PARSED" ;;
  esac
fi
ok "ERP address to verify: http://localhost:${HOST_PORT}"

# Kept because a failed migration has a log worth showing the owner. What was
# wrong before: the loop only ever `break`ed on success or non-zero exit, so a
# container that never appeared (`docker inspect` → "missing 0") or one still
# running at 120s fell straight through, and the script went on to print
# DEPLOYMENT COMPLETE. Now a timeout is a failure.
info "Waiting for database migrations..."
MIGRATION_TIMEOUT=${MIGRATION_TIMEOUT_SECONDS:-240}
waited=0
migrated=false
while [ $waited -lt $MIGRATION_TIMEOUT ]; do
  state=$(sudo docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' care-db-patch-v2 2>/dev/null || echo "missing -1")
  status=$(echo $state | awk '{print $1}')
  code=$(echo $state | awk '{print $2}')

  if [ "$status" = "exited" ] && [ "$code" = "0" ]; then
    ok "Database migrations complete"
    migrated=true
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

if [ "$migrated" != "true" ]; then
  echo ""
  sudo docker inspect --format='  care-db-patch-v2 is {{.State.Status}} (exit {{.State.ExitCode}})' care-db-patch-v2 2>/dev/null || echo "  No care-db-patch-v2 container exists."
  sudo docker logs care-db-patch-v2 --tail 30 2>/dev/null
  fail "Migrations did not complete within ${MIGRATION_TIMEOUT}s. Nothing was verified — fix this before the clinic opens the ERP."
fi

# ── Step 5: Verify the deployment on the endpoint the ERP actually publishes ──
# This used to be `wget http://localhost:8080/api/health/schema` in a 90s loop.
# Nothing publishes 8080 on the host: `grep -n ':8080' docker-compose.yml`
# returns only care-api's in-container healthcheck, the API service has no
# `ports:` block at all, and the ERP is published as ${HOST_PORT:-8888}:80. So
# the probe failed on every deploy ever made, the loop timed out, and the
# banner printed anyway. The gate now checks the published address AND the
# containers, and it has to pass for the script to succeed.
info "Verifying the deployment (containers and endpoints)..."
NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  fail "node is required to verify the deployment, and it is not on PATH. Refusing to claim success unchecked."
fi
DEPLOY_TIMEOUT=${DEPLOY_HEALTH_TIMEOUT_SECONDS:-300}
echo ""
# `sudo` for the node process so its own `docker inspect` needs no nested sudo;
# the absolute node path is used because root's PATH does not always have node.
if ! sudo "$NODE_BIN" scripts/deploy-health.mjs --wait --timeout-seconds "$DEPLOY_TIMEOUT" --host-port "$HOST_PORT"; then
  echo ""
  echo -e "${RED}  ✗ The deployment did not pass its health checks.${NC}"
  echo -e "${RED}  Nothing above was assumed — each line is what the NAS actually answered.${NC}"
  echo ""
  echo "  Read the failing line, then:"
  echo "    sudo docker logs care-api --tail 60"
  echo "    sudo docker logs care-db-patch-v2 --tail 40"
  echo "    sudo docker logs care-schema-verify --tail 40"
  echo ""
  fail "Deployment NOT verified. Do not use the ERP until the check above passes."
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}============================================================${NC}"
echo -e "${BOLD}${GREEN}  ✓ DEPLOYMENT COMPLETE — HEALTH CHECKED${NC}"
echo -e "${BOLD}${GREEN}============================================================${NC}"
echo ""
echo -e "  ERP Address : ${BOLD}http://172.16.1.139:${HOST_PORT}${NC}"
echo -e "  Version     : Care ERP v${ERP_VERSION} build ${BUILD_NUMBER}"
echo -e "  Completed   : $(date '+%d %B %Y  %H:%M')"
echo ""
echo -e "  Verified    : care-db, care-db-patch-v2, care-schema-verify, care-api,"
echo -e "                care-web + /nginx-health, /api/healthz, /api/health/schema"
echo -e "  ${YELLOW}If login doesn't work after 1 minute, run:${NC}"
echo -e "  ${YELLOW}docker logs care-api --tail 40${NC}"
echo ""
