# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY lib/emergency-billing /src/lib/emergency-billing
COPY artifacts/emergency-billing /src/app
WORKDIR /src/app
RUN npm install && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client curl tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/app/dist ./dist
COPY --from=build /src/app/public ./public
COPY --from=build /src/app/node_modules ./node_modules
COPY --from=build /src/app/package.json ./
ENV NODE_ENV=production
EXPOSE 8898
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD curl -fsS http://127.0.0.1:8898/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.mjs"]
