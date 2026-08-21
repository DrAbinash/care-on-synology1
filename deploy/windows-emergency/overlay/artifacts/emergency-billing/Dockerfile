# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

# Keep the git-clone layout inside the image so these repo-relative paths
# resolve the same way they do on a workstation:
#   artifacts/emergency-billing/package.json  → file:../../lib/emergency-billing
#   artifacts/emergency-billing/tsconfig.json → extends ../../tsconfig.base.json
#   lib/emergency-billing/tsconfig.json       → extends ../../tsconfig.base.json
# Flattening to /src/app (or omitting tsconfig.base.json) breaks npm + tsc + esbuild.
WORKDIR /src
COPY tsconfig.base.json /src/tsconfig.base.json
COPY lib/emergency-billing /src/lib/emergency-billing
COPY artifacts/emergency-billing /src/artifacts/emergency-billing
WORKDIR /src/artifacts/emergency-billing
RUN npm install && npm run build

FROM node:22-bookworm-slim
ARG GIT_COMMIT=unknown
ARG APP_VERSION=1.0.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client curl tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/artifacts/emergency-billing/dist ./dist
COPY --from=build /src/artifacts/emergency-billing/public ./public
COPY --from=build /src/artifacts/emergency-billing/node_modules ./node_modules
COPY --from=build /src/artifacts/emergency-billing/package.json ./
COPY backup.sh /app/backup.sh
RUN chmod +x /app/backup.sh
ENV NODE_ENV=production
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_SHA=$GIT_COMMIT
ENV APP_VERSION=$APP_VERSION
EXPOSE 8898
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD curl -fsS http://127.0.0.1:8898/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.mjs"]
