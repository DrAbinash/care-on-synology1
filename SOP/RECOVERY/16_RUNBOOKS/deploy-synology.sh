#!/bin/bash
# RETIRED — DO NOT RUN. Pointer only, no deployment steps.
#
# The one deployment program is ./deploy-synology.sh at the repository root.
# This copy was 51 lines while the live script was 292, and 16_RUNBOOKS listed it
# as the script for "immediate sysadmin execution" — running it would have
# deployed a stale checkout with `pnpm db:deploy` and no health check, then
# reported success. See SOP/RECOVERY/01_INFRASTRUCTURE/deploy-synology.sh for the
# full history, docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md for the procedure, and
# scripts/ops-preflight.mjs (deploy.config_single_source) for the guard.
#
# From the repository root, in this order:
#   node scripts/ops-preflight.mjs
#   bash deploy-synology.sh
echo "RETIRED — DO NOT RUN. Run ./deploy-synology.sh from the repository root instead." >&2
exit 1
