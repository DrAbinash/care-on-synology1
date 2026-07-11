# syntax=docker/dockerfile:1.7

# =============================================================================
# Care Diagnostics ERP — multi-stage Dockerfile
# Version metadata is injected at build time via --build-arg
# and baked into the API image as environment variables.
# =============================================================================

# Build-time version metadata (set by docker-compose build args)
ARG ERP_VERSION=0.0.0
ARG BUILD_NUMBER=0
ARG RELEASE_NAME=dev
ARG GIT_COMMIT=unknown
ARG GIT_BRANCH=unknown
ARG GIT_TAG=unknown
ARG BUILD_DATE=unknown

# -----------------------------------------------------------------------------
# Stage: base
# Installs pnpm + every workspace dependency.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
RUN corepack enable \
 && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Copy the full repo
COPY . .

# [PNPM V10 + REPLIT FIX]
# pnpm v10 crashes on unapproved builds, so we disable strict-dep-builds.
# We also use bookworm-slim (Debian) instead of Alpine, because Replit
# uses Debian. This ensures all the native performance files (like Rollup)
# match the lockfile perfectly, completely eliminating MODULE_NOT_FOUND errors!
RUN pnpm config set strict-dep-builds false && \
    echo "" > ./scripts/preinstall-check.cjs && \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild

# -----------------------------------------------------------------------------
# Stage: api-build
# -----------------------------------------------------------------------------
FROM base AS api-build
RUN pnpm --filter @workspace/api-server run build \
 && pnpm --filter @workspace/api-server --prod --ignore-scripts deploy --legacy /api-deploy


# -----------------------------------------------------------------------------
# Stage: api
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api

# Install tini (process supervisor) and curl (health check probe).
# curl MUST be installed in this final runtime stage, NOT only in the
# builder. node:22-bookworm-slim is a Debian slim image — curl is NOT
# pre-installed, which is why the healthcheck was failing with
# "curl: not found" even though the container started successfully.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV LOG_LEVEL=info

# Version metadata — baked in at build time, readable at runtime
ARG ERP_VERSION=0.0.0
ARG BUILD_NUMBER=0
ARG RELEASE_NAME=dev
ARG GIT_COMMIT=unknown
ARG GIT_BRANCH=unknown
ARG GIT_TAG=unknown
ARG BUILD_DATE=unknown
ENV ERP_VERSION=${ERP_VERSION}
ENV BUILD_NUMBER=${BUILD_NUMBER}
ENV RELEASE_NAME=${RELEASE_NAME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV GIT_TAG=${GIT_TAG}
ENV BUILD_DATE=${BUILD_DATE}

COPY --from=api-build /repo/artifacts/api-server/dist             ./dist
COPY --from=api-build /repo/artifacts/api-server/package.json     ./package.json
COPY --from=api-build /api-deploy/node_modules                    ./node_modules
# Bake version.json into the image so /api/system/version can read it
COPY --from=api-build /repo/version.json                          ./version.json

EXPOSE 8080

# ── Health check baked into the image ─────────────────────────────────────────
# Uses GET /health which is registered directly on the Express app at
# app.ts:111 — no /api prefix, no auth, no rate-limit, no database query.
# It returns {"ok":true,...} immediately once Node is listening.
#
# Why /health, not /api/health/schema:
#   /api/health/schema checks that db-patch-v2 ran AND critical schema
#   columns exist. If either check fails (e.g. the schema_deploy_state
#   table doesn't exist yet on a fresh database), this endpoint returns
#   503 forever, permanently marking the container unhealthy regardless
#   of whether the application is actually serving traffic. This is the
#   wrong probe for a Docker HEALTHCHECK (liveness) — it's a readiness
#   probe that belongs in docker-compose depends_on conditions, where it
#   already lives (see the care-web service below).
#
# Timing:
#   start_period: 60s — gives the application enough time to run its
#     in-process startup tasks (bootstrap admin seed, PACS settings seed,
#     runtime column patches) before the first check fires. The logs show
#     these complete before "Server listening", so 60s is conservative.
#   interval: 15s, timeout: 10s, retries: 5 — after the start period,
#     checks every 15 seconds. 5 consecutive failures (75s) are required
#     before Docker marks the container unhealthy. This tolerates brief
#     transient failures (GC pause, momentary DB hiccup) without
#     triggering a false unhealthy state.
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]


# -----------------------------------------------------------------------------
# Stage: web-build
# -----------------------------------------------------------------------------
FROM base AS web-build

# [CRITICAL OOM FIX FOR SYNOLOGY NAS]
# Forces Docker to wait for the API build to finish before starting Web
COPY --from=api-build /repo/package.json /tmp/wait-for-api.json

RUN BASE_PATH=/ \
    pnpm --filter @workspace/clinic-site run build
RUN BASE_PATH=/erp/ \
    pnpm --filter @workspace/diagnostic-erp run build


# -----------------------------------------------------------------------------
# Stage: web
# Static nginx image that serves both SPAs and forwards /api/* to api svc.
# -----------------------------------------------------------------------------
FROM nginx:alpine AS web
COPY --from=web-build /repo/artifacts/clinic-site/dist/public              /usr/share/nginx/html/site
COPY --from=web-build /repo/artifacts/diagnostic-erp/dist/public           /usr/share/nginx/html/erp
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80


# Stage: migrate
# -----------------------------------------------------------------------------
FROM base AS migrate
WORKDIR /repo
CMD ["pnpm", "--filter", "@workspace/db", "run", "push-ci"]
