# syntax=docker/dockerfile:1.7

# =============================================================================
# Care Diagnostics Billing ERP — multi-stage Dockerfile
# =============================================================================


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
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV LOG_LEVEL=info

COPY --from=api-build /repo/artifacts/api-server/dist             ./dist
COPY --from=api-build /repo/artifacts/api-server/package.json     ./package.json
COPY --from=api-build /api-deploy/node_modules                    ./node_modules

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
