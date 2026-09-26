#!/bin/bash
# =============================================================================
# verify-deploy-metadata.sh
# Smoke-check that deploy-time Git / version.json metadata resolves to real
# values (same sources as deploy-synology.sh). Exit 0 on success.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "OK: $*"; }

GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "none")
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

[[ "$GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "GIT_COMMIT not a 40-char SHA (got: $GIT_COMMIT)"
[[ -n "$GIT_BRANCH" && "$GIT_BRANCH" != "unknown" ]] || \
  echo "WARN: GIT_BRANCH is '$GIT_BRANCH' (detached HEAD is OK for tags)"
[[ "$GIT_TAG" == "none" || -n "$GIT_TAG" ]] || fail "GIT_TAG empty"
[[ "$BUILD_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || \
  fail "BUILD_DATE not UTC ISO (got: $BUILD_DATE)"

if [[ ! -f version.json ]]; then
  fail "version.json missing"
fi

ERP_VERSION=$(python3 -c "import json; print(json.load(open('version.json')).get('version',''))")
BUILD_NUMBER=$(python3 -c "import json; print(json.load(open('version.json')).get('buildNumber',0))")
RELEASE_NAME=$(python3 -c "import json; print(json.load(open('version.json')).get('releaseName',''))")

[[ -n "${ERP_VERSION:-}" ]] || fail "ERP_VERSION empty"
[[ -n "${BUILD_NUMBER:-}" ]] || fail "BUILD_NUMBER empty"

# Compose / Dockerfile contract still present
grep -q 'GIT_COMMIT: \${GIT_COMMIT' docker-compose.yml || fail "compose missing GIT_COMMIT build arg"
grep -q 'ARG GIT_COMMIT=' Dockerfile || fail "Dockerfile missing GIT_COMMIT ARG"
grep -q 'upsert_env_key "GIT_COMMIT"' deploy-synology.sh || fail "deploy-synology.sh missing .env upsert for GIT_COMMIT"
grep -q 'git describe --tags --exact-match' deploy-synology.sh || fail "deploy-synology.sh should use exact-match for GIT_TAG"

ok "GIT_COMMIT=$GIT_COMMIT"
ok "GIT_BRANCH=$GIT_BRANCH"
ok "GIT_TAG=$GIT_TAG"
ok "BUILD_DATE=$BUILD_DATE"
ok "ERP_VERSION=$ERP_VERSION BUILD_NUMBER=$BUILD_NUMBER RELEASE_NAME=${RELEASE_NAME:-}"
ok "deploy metadata sources look healthy"
