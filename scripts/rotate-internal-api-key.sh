#!/bin/bash
# Generate a strong INTERNAL_API_KEY and patch the Synology .env template.
# After running, also update care_erp_sync.py ERP_INTERNAL_API_KEY on the NAS
# (Orthanc sidecar) — both must match or DICOM study intake stops.
#
# Usage:
#   bash scripts/rotate-internal-api-key.sh              # updates deploy/synology/care.env
#   bash scripts/rotate-internal-api-key.sh --apply .env # patch live .env beside compose

set -euo pipefail

TARGET="deploy/synology/care.env"
if [ "${1:-}" = "--apply" ] && [ -n "${2:-}" ]; then
  TARGET="$2"
fi

if [ ! -f "$TARGET" ]; then
  echo "✗ File not found: $TARGET" >&2
  exit 1
fi

NEW_KEY="$(openssl rand -base64 32 | tr -d '\n')"

if grep -qE '^INTERNAL_API_KEY=' "$TARGET"; then
  sed -i "s|^INTERNAL_API_KEY=.*|INTERNAL_API_KEY=${NEW_KEY}|" "$TARGET"
else
  printf '\nINTERNAL_API_KEY=%s\n' "$NEW_KEY" >> "$TARGET"
fi

echo "✓ Updated INTERNAL_API_KEY in $TARGET"
echo ""
echo "Next steps (required for DICOM intake):"
echo "  1. If production uses a separate .env beside docker-compose.yml, copy the new value:"
echo "       grep '^INTERNAL_API_KEY=' $TARGET >> your-live-.env   # or edit manually"
echo "  2. On the Orthanc/NAS host, set the SAME value in care_erp_sync.py"
echo "     (variable ERP_INTERNAL_API_KEY, usually line ~44)."
echo "  3. Redeploy: bash deploy-synology.sh"
echo ""
echo "The new key is stored only in $TARGET — it is not printed here."
