# syntax=docker/dockerfile:1.7
# RETIRED — DO NOT RUN. Pointer only.
#
# The live image definition is ./Dockerfile at the repository root (223 lines).
# This binder copy stopped being updated at 87 lines: it has no
# ARG GIT_COMMIT/GIT_BRANCH/ERP_VERSION/BUILD_NUMBER bake, so an image built from
# it reports version "unknown" forever and no deploy can be attributed to a
# commit — which is the one thing a rollback decision needs.
#
# What to use instead, from the repository root:
#   docker compose build --no-cache api      # what deploy-synology.sh does
#   node scripts/ops-preflight.mjs           # repo + build-identity checks
#
# SOP/RECOVERY/03_DOCKER/docker-compose.yml is retired for the same reason.
