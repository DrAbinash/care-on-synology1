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
 && corepack prepare pnpm@9.15.4 --activate
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
 && pnpm --filter @workspace/api-server --prod --ignore-scripts deploy /api-deploy


# -----------------------------------------------------------------------------
# Stage: api
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends tini curl && rm -rf /var/lib/apt/lists/*
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
