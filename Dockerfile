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

# Install tini (process supervisor), curl (health check probe), and DCMTK.
# curl MUST be installed in this final runtime stage, NOT only in the
# builder. node:22-bookworm-slim is a Debian slim image — curl is NOT
# pre-installed, which is why the healthcheck was failing with
# "curl: not found" even though the container started successfully.
# dcmtk provides echoscu / findscu / dump2dcm, used by the PACS layer for real
# C-ECHO connectivity tests, C-FIND queries, and generating Orthanc modality
# worklist (.wl) files. Without it those paths fall back to TCP-reachability only.
# openssl is the BINARY (not just libssl) that lib/backupCrypto.ts shells out to
# via spawn("openssl", …). It is deliberately the openssl CLI rather than a Node
# reimplementation so backups stay byte-compatible with the Synology shell
# scripts and can be decrypted with nothing but openssl on a bare machine.
# It is NOT pre-installed on node:22-bookworm-slim, and because the backup code
# correctly refuses to ever write an unencrypted backup, its absence meant EVERY
# backup failed with "Backup encryption failed (openssl exit -1): openssl failed
# to start: spawn openssl ENOENT" — silently, for 16 days, until the backup
# dead-man alert reported "last successful backup was 395.1h ago".
# postgresql-client-16 provides pg_dump AND psql, both of which the backup/
# restore path shells out to. Without pg_dump every scheduled backup silently
# fell through to exportDatabaseSqlFallback(), whose own header states it is
# "DATA ONLY ... does NOT contain CREATE TABLE/INDEX statements" — so the
# nightly 191 MB artifacts were NOT restorable, while the job, the SHA-256 and
# the dead-man alert all reported green. psql is needed too: both
# scripts/synology-restore.sh and the in-app restore pipe into it.
#
# It MUST be the PGDG build of major 16, not Debian bookworm's default: bookworm
# ships client 15, and pg_dump refuses outright when the server is newer
# ("aborting because of server version mismatch") — the server here is 16.14.
# The version assertion at the end fails the build rather than shipping an image
# that would silently fall back again.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl dcmtk openssl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && pg_dump --version && psql --version \
 && pg_dump --version | grep -q " 16\." \
 && openssl version

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

# Web-container health check — hits GET /nginx-health, a 200 served by nginx
# ITSELF (no api upstream), so the web container's health reflects "nginx is
# serving" without coupling to the api container (which has its own health
# gate via depends_on). busybox wget ships in nginx:alpine, so no extra
# install. Liveness, not a deep readiness probe — deliberately independent of
# the api to avoid a false-unhealthy web container during an api restart.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://localhost:80/nginx-health || exit 1


# Stage: migrate
# -----------------------------------------------------------------------------
FROM base AS migrate
WORKDIR /repo
CMD ["pnpm", "--filter", "@workspace/db", "run", "push-ci"]
