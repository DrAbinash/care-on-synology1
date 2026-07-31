#!/bin/sh
# =============================================================================
# care-api entrypoint — auto-wire Hope ↔ Care before the server listens
# =============================================================================
# Same role as care-db-patch-v2 for schema: zero operator steps after
# `docker compose up`. Primary bootstrap is TypeScript in index.ts; this
# optional pre-listen pass uses the standalone .mjs when `pg` is resolvable.
# Failures are non-fatal — the API must still start.
# =============================================================================
set -eu

if [ -n "${HOPE_PARTNER_KEY:-}" ] \
  || [ "${HOPE_CARE_INTEGRATION_FORCE:-}" = "1" ] \
  || [ -n "${INTEGRATION_HOPE_SIGNING_SECRET:-}" ] \
  || [ -n "${INTEGRATION_HOPE_CALLBACK_URL:-}" ]; then
  if [ -f ./scripts/bootstrap-hope-care-integration.mjs ]; then
    if node -e "import('pg').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "[api-entrypoint] Running Hope↔Care integration bootstrap…"
      node ./scripts/bootstrap-hope-care-integration.mjs \
        || echo "[api-entrypoint] Hope↔Care bootstrap failed (non-fatal) — TS startup will retry"
    else
      echo "[api-entrypoint] pg not resolvable here — Hope↔Care bootstrap deferred to API startup"
    fi
  fi
else
  echo "[api-entrypoint] Hope integration env not set — skipping partner bootstrap"
fi

exec node --enable-source-maps ./dist/index.mjs
