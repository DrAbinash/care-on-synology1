#!/bin/bash
# =============================================================================
# RETIRED — DO NOT RUN THIS FILE.
# =============================================================================
#
# This is a pointer, not a deployment script. It has no steps, and running it
# does nothing except print this message and fail.
#
# WHY IT WAS REMOVED
#   Until 2026-10-14 this path held a 51-line copy of the real deploy script
#   (install → build → pnpm db:deploy → compose up) while the live program at
#   the repository root had grown to 292 lines. Both this folder's index and
#   SOP/RECOVERY/README.md called the copy the "Active production deployment
#   script", so an operator following the recovery binder would have:
#     • deployed whatever commit was already in the folder — it never fetched
#       origin/main, which is the only branch Synology is allowed to run;
#     • run `pnpm db:deploy` instead of the care-db-patch-v2 container, so the
#       migration ledger and the schema-verify gate were skipped entirely;
#     • exported every .env value through `xargs`, which mangles quoted secrets;
#     • printed "Deployment completed successfully!" with no health check at all.
#   A false-success deploy on the box that holds patient records.
#
# WHAT TO RUN INSTEAD
#   From the deployment checkout (the repository root — this binder lives inside
#   it, so the live file is always reachable from here):
#
#     cd /volume1/docker/care-erp-github/care-on-synology1
#     node scripts/ops-preflight.mjs      # read-only gate, run it FIRST
#     bash deploy-synology.sh             # the one deployment program
#
#   docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md is the procedure, and
#   scripts/ops-preflight.mjs (`deploy.config_single_source`) fails CI if a
#   runnable second copy of this file ever comes back.
#
# IF GITHUB IS UNREACHABLE
#   Do not substitute an old copy. The stack does not need this script — it needs
#   the checkout it already has. From the repository root, with the tree you
#   want to run already checked out:
#
#     sudo docker compose up -d --build
#
#   then verify with `node scripts/deploy-health.mjs --host-port 8888`, and treat
#   "the clinic is running an older build" as the expected, acceptable outcome.
#   Deploying a stale build is recoverable; deploying an unverified one is not.
# =============================================================================

echo "RETIRED — DO NOT RUN. The only deployment program is ./deploy-synology.sh at the repository root." >&2
echo "See the header of this file, or docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md." >&2
exit 1
