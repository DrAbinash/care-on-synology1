#!/bin/sh
# Manual logical dump of the Emergency Billing database.
# Usage (on DS225+): docker compose exec care-emergency-api /bin/sh /app/backup.sh
# Does not touch Hyper Backup vaults.
set -eu
DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$DIR/care_emergency_manual_${STAMP}.sql"
pg_dump --no-owner --format=plain --dbname="$DATABASE_URL" --file="$FILE"
echo "Wrote $FILE"
ls -lh "$DIR"
