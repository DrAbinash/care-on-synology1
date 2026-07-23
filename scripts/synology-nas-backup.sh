#!/usr/bin/env bash
# =============================================================================
# synology-nas-backup.sh — Docker-native DB backup for the CARE ERP on Synology
# =============================================================================
# Dumps the live PostgreSQL database straight out of the `care-db` container with
# pg_dump (the same --clean --if-exists logical dump the app's backup endpoint
# uses), gzips it, optionally encrypts it (AES-256-CBC), verifies it is a
# non-empty valid gzip, and prunes old copies. Unlike the API-pull method it does
# NOT need care-api to be up — so it still works during an incident.
#
# SETUP on the Synology NAS (do once):
#   1. Copy this file to /volume1/scripts/care-backup.sh
#   2. chmod +x /volume1/scripts/care-backup.sh
#   3. Edit CONTAINER / DB_USER / DB_NAME below if yours differ (defaults match
#      docker-compose.yml). Optionally set BACKUP_PASSPHRASE to encrypt.
#   4. DSM → Control Panel → Task Scheduler → Create → Scheduled Task →
#      User-defined script, run daily at 03:00:
#        bash /volume1/scripts/care-backup.sh
#
# RESTORE: see docs/CARE_ERP_BACKUP_RESTORE.md.
# =============================================================================
set -euo pipefail

# ─── CONFIG (defaults match docker-compose.yml) ──────────────────────────────
CONTAINER="${CARE_DB_CONTAINER:-care-db}"
DB_USER="${DB_USER:-erp}"
DB_NAME="${DB_NAME:-diagnostic_erp}"
BACKUP_DIR="${BACKUP_DIR:-/volume1/backups/caredeoghar}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"   # set to encrypt; keep this secret safe — it is required to restore

TS=$(date +%Y%m%d_%H%M%S)
LOG="${BACKUP_DIR}/backup.log"
DEST="${BACKUP_DIR}/caredeoghar_${TS}.sql.gz"

log(){ echo "[$(date +%Y-%m-%dT%H:%M:%S)] $*" | tee -a "${LOG}"; }

mkdir -p "${BACKUP_DIR}"
log "Starting backup of ${DB_NAME} from container ${CONTAINER}"

# ─── DUMP + GZIP (fails loudly; PIPESTATUS catches a mid-stream pg_dump error) ─
if ! docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" \
       --no-owner --no-privileges --clean --if-exists 2>>"${LOG}" | gzip > "${DEST}"; then
  log "ERROR: pg_dump/gzip pipeline failed"; rm -f "${DEST}"; exit 1
fi
if [ "${PIPESTATUS[0]:-1}" -ne 0 ]; then
  log "ERROR: pg_dump exited non-zero — discarding truncated dump"; rm -f "${DEST}"; exit 1
fi

# ─── VERIFY the gzip is valid and non-trivial ────────────────────────────────
if ! gzip -t "${DEST}" 2>/dev/null; then
  log "ERROR: backup is not a valid gzip"; rm -f "${DEST}"; exit 1
fi
BYTES=$(stat -c%s "${DEST}" 2>/dev/null || stat -f%z "${DEST}")
if [ "${BYTES}" -lt 10240 ]; then
  log "ERROR: backup suspiciously small (${BYTES} bytes) — discarding"; rm -f "${DEST}"; exit 1
fi
log "Backup OK: ${DEST} ($(du -h "${DEST}" | cut -f1))"

# ─── OPTIONAL ENCRYPTION (AES-256-CBC, PBKDF2) ───────────────────────────────
if [ -n "${BACKUP_PASSPHRASE}" ]; then
  if openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${BACKUP_PASSPHRASE}" -in "${DEST}" -out "${DEST}.enc"; then
    rm -f "${DEST}"; DEST="${DEST}.enc"
    log "Encrypted: ${DEST} ($(du -h "${DEST}" | cut -f1))"
  else
    log "ERROR: encryption failed"; exit 1
  fi
fi

# ─── RETENTION ───────────────────────────────────────────────────────────────
PURGED=$(find "${BACKUP_DIR}" \( -name 'caredeoghar_*.sql.gz' -o -name 'caredeoghar_*.sql.gz.enc' \) \
           -mtime +"${RETENTION_DAYS}" -delete -print | wc -l | tr -d ' ')
[ "${PURGED}" -gt 0 ] && log "Purged ${PURGED} backup(s) older than ${RETENTION_DAYS} days"

log "Backup complete: ${DEST}"
