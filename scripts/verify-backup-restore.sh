#!/usr/bin/env bash
# ─── Care Diagnostics — Prove a backup is RESTORABLE ──────────────────────────
#
# Restores a real backup artifact into a throwaway PostgreSQL container and
# queries it. Exit 0 means the artifact genuinely restores. Anything else means
# it does not. There is no in-between and no "probably fine".
#
# Usage:
#   bash verify-backup-restore.sh [BACKUP_DIR_OR_FILE]
#
#   BACKUP_PASSPHRASE=...   # or SESSION_SECRET=... for scheduler-written files
#   bash verify-backup-restore.sh /volume1/backups/caredeoghar
#
# Environment:
#   BACKUP_DIR            searched when no path is given, so this script and
#                         scripts/synology-nas-backup.sh agree on where the
#                         backups live without the operator repeating it
#   DB_NAME               the database the artifact must claim to come from
#                         (default: diagnostic_erp)
#   VERIFY_READY_TIMEOUT  seconds to wait for the throwaway server (default 60)
#
# ── One program, two copies ───────────────────────────────────────────────────
# SOP/RECOVERY/13_RESTORE/verify-backup-restore.sh is a byte-identical copy of
# this file, not a wrapper. The recovery binder has to keep working when the
# repository is not on the box — which is exactly the state during a disaster —
# so the SOP directory carries the real script. `scripts/` is the one that is
# edited; the copy is regenerated from it, and
# artifacts/api-server/src/lib/backupRestorability.test.ts plus
# scripts/backupScripts.test.mjs fail CI if the two ever differ.
#
# They differed for a long time, and the divergence was not cosmetic: the SOP
# copy was the pre-rewrite version that restored nothing, printed
# "Patients: 0   Bills: 0", and then said
# "🎉 BACKUP VERIFICATION SUCCESSFUL! Backup file integrity is 100% valid." and
# exited 0. It also published the sandbox on port 5499 with a hard-coded
# password, which put a restored copy of the clinic's patient database on every
# interface of the NAS for the length of the run.
#
# ── Why this was rewritten ────────────────────────────────────────────────────
# The previous version could not verify the backups this product actually
# writes. Four defects, each of which alone produced a false "successful":
#
#   1. It searched only for  caredeoghar_*.sql.gz[.enc]  — the naming used by
#      scripts/synology-backup.sh. The in-app scheduler writes
#      backup_<jobName>_<timestamp>.sql.enc, so the hourly backups were never
#      found at all.
#   2. It piped unconditionally through `gunzip -c`. The scheduler's artifact is
#      NOT gzipped, so decryption succeeded and decompression then died with
#      "not in gzip format".
#   3. It ran psql without ON_ERROR_STOP. A DATA-ONLY dump (TRUNCATE + INSERT,
#      no CREATE TABLE — what exportDatabaseSqlFallback emits when pg_dump is
#      missing) errors on every statement while psql still exits 0.
#   4. It printed "100% valid" on a restore that produced ZERO rows.
#
# Defect 3 is not hypothetical. Production ran for months on DATA-ONLY
# artifacts that reported success, matched their SHA-256, and kept the backup
# dead-man alert green.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TARGET="${1:-}"
DB_NAME="${DB_NAME:-diagnostic_erp}"
SANDBOX_CONTAINER="care-db-restore-sandbox"
SANDBOX_DB="diagnostic_erp_restore_test"
SANDBOX_USER="postgres"
SANDBOX_PASS="sandbox-$$-$(date +%s)"
VERIFY_READY_TIMEOUT="${VERIFY_READY_TIMEOUT:-60}"

fail() { echo ""; echo "❌ VERIFICATION FAILED: $*"; echo ""; exit 1; }
note() { echo "   $*"; }

for bin in docker openssl gzip gunzip grep find mktemp stat; do
  command -v "$bin" >/dev/null 2>&1 || fail "'$bin' is not installed or not on PATH.
   This is a missing tool on the machine you are running, not a problem with the
   backup — do not read it as 'there are no backups'."
done

# ── 1. Locate the artifact ────────────────────────────────────────────────────
# Both naming families, newest first:
#   caredeoghar_*.sql.gz[.enc]   the shell backup scripts     (gzipped)
#   backup_*_*.sql[.enc]         the in-app scheduler         (NOT gzipped)
if [[ -z "${TARGET}" ]]; then
  # Where the writers actually put things. /volume1/backups/caredeoghar is the
  # historical path and still holds years of copies on the clinic box;
  # /volume1/backup/care-erp/db is what synology-nas-backup.sh defaults to now.
  # A verifier whose default disagrees with the backup job's destination answers
  # "no backup found" on a healthy box, and under pressure that reads as "we
  # have no backups" — so take $BACKUP_DIR first, then every known root.
  SEARCHED=()
  [[ -n "${BACKUP_DIR:-}" ]] && SEARCHED+=("${BACKUP_DIR}")
  SEARCHED+=(/volume1/backup/care-erp/db /volume1/backups/caredeoghar)
  for candidate in "${SEARCHED[@]}"; do
    [[ -d "${candidate}" ]] || continue
    TARGET="${candidate}"
    break
  done
  [[ -n "${TARGET}" ]] || fail "No backup directory to search.
   Pass one:  bash verify-backup-restore.sh /volume1/backup/care-erp/db
   Looked in: ${SEARCHED[*]}"
fi

if [[ -f "${TARGET}" ]]; then
  BACKUP="${TARGET}"
else
  [[ -d "${TARGET}" ]] || fail "No such file or directory: ${TARGET}"
  echo "🔍 Searching ${TARGET} for the newest backup artifact..."
  BACKUP=$(find "${TARGET}" -maxdepth 2 -type f \
    \( -name "caredeoghar_*.sql.gz" -o -name "caredeoghar_*.sql.gz.enc" \
       -o -name "backup_*.sql" -o -name "backup_*.sql.enc" \
       -o -name "care_db_daily_*.sql.gz" \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  [[ -n "${BACKUP}" ]] || fail "No backup artifact found in ${TARGET}.
   Looked for caredeoghar_*.sql.gz[.enc] and backup_*.sql[.enc].
   Note: the newest file is chosen by modification time, and the in-app
   scheduler writes into a per-job subdirectory — point this script at that
   directory (the job's destinationPath) if you mean a specific job."
fi

echo "✅ Artifact: ${BACKUP}"
note "size: $(du -h "${BACKUP}" | cut -f1)   modified: $(date -r "${BACKUP}" '+%Y-%m-%d %H:%M:%S')"

# ── 1b. The sidecar the backup job wrote, if there is one ─────────────────────
# scripts/synology-nas-backup.sh records WHAT it captured next to the artifact.
# That turns "is this our database?" from an inference out of a file name into a
# checked fact, and it catches an artifact whose bytes changed after publication
# (a partial copy off a half-mounted share, a hand-edited file, bit rot) before
# spending ten minutes restoring it.
META=""
ARTIFACT_SHA=""
if [[ -f "${BACKUP}.meta" ]]; then
  META="${BACKUP}.meta"
  meta_get() { grep -m1 "^$1=" "${META}" 2>/dev/null | cut -d= -f2- || true; }
  SOURCE_DB=$(meta_get source_database)
  EXPORTER=$(meta_get exporter)
  SCHEMA_COMPLETE=$(meta_get schema_complete)
  ARTIFACT_SHA=$(meta_get sha256_artifact)
  note "sidecar: exporter=${EXPORTER:-?} schema_complete=${SCHEMA_COMPLETE:-?} server=$(meta_get server_version)"
  # The preflight gate refuses a PASS for a restore proof whose artifact carries no
  # dump-time census, so say here, before the ten-minute restore, whether this
  # artifact can earn one. Counting the lines rather than trusting `census_tables=`
  # because the operator may be holding a sidecar the current job never wrote.
  CENSUS_EDGES=$(grep -c '^census_before\.' "${META}" 2>/dev/null || true)
  if [[ "${CENSUS_EDGES:-0}" -gt 0 ]]; then
    note "census: ${CENSUS_EDGES} table(s) bracketed at dump time ($(meta_get census_tables))"
  else
    note "census: none. This artifact cannot be shown to hold what the database held when it was dumped — only that its highest ids look plausible. Verify a backup taken by the current scripts/synology-nas-backup.sh to get a proof the deploy gate will call complete."
  fi
  if [[ -z "${SOURCE_DB}" ]]; then
    # scripts/synology-backup.sh pulls the CLOUD instance and cannot name its
    # database from here, so its sidecar records a source_url instead. Nothing is
    # being hidden — but nothing about the source is being confirmed either.
    note "sidecar records no source_database (a remote pull) — which database this came from is NOT confirmed here"
  elif [[ "${SOURCE_DB}" != "${DB_NAME}" ]]; then
    fail "This artifact was taken from database '${SOURCE_DB}', not '${DB_NAME}'.
   The file name says caredeoghar/backup_*, and on this box a second stack has
   written identical names out of a different database. Restoring it would put
   the wrong clinic's records in front of staff.
   If ${SOURCE_DB} really is what you meant to verify:  DB_NAME=${SOURCE_DB} bash \$0 ..."
  fi
  if [[ -n "${ARTIFACT_SHA}" ]]; then
    # Hash the BYTES via stdin, not the path: sha256sum prefixes the digest line
    # with a backslash when the file name needs escaping, and `cut -d' '` then
    # carries that backslash into the comparison — a Windows or oddly-named path
    # would refuse a perfectly good backup.
    ACTUAL_SHA=$(sha256sum < "${BACKUP}" | cut -d' ' -f1)
    [[ "${ACTUAL_SHA}" == "${ARTIFACT_SHA}" ]] || fail "The bytes on disk are not the bytes the backup job published.
   recorded  sha256 ${ARTIFACT_SHA}
   found     sha256 ${ACTUAL_SHA}
   The copy is truncated, half-written, or was modified after it was taken. It
   may still restore, but it is not the backup that was verified when it was
   written, so it is not evidence of anything."
  fi
else
  note "no .meta sidecar — this artifact predates the sidecar, or the in-app scheduler wrote it. Source database cannot be confirmed."
fi

WORK="$(mktemp -d)"

HEARTBEAT_PID=""
cleanup() {
  # If interrupted mid-restore (Ctrl+C), the heartbeat loop below would
  # otherwise be orphaned and print forever — kill it on every exit path,
  # not just the normal one.
  [[ -n "${HEARTBEAT_PID}" ]] && kill "${HEARTBEAT_PID}" >/dev/null 2>&1
  rm -rf "${WORK}"
  docker rm -f "${SANDBOX_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
PAYLOAD="${WORK}/payload"

# ── 2. Decrypt ────────────────────────────────────────────────────────────────
# Mirrors lib/backupCrypto.candidatePassphrases(): BACKUP_PASSPHRASE first, then
# SESSION_SECRET. The scheduler encrypts with whichever is set, and production
# ran on SESSION_SECRET for a long time, so trying only one is not enough.
#
# The secret goes to openssl through its ENVIRONMENT, never as an argument:
# a restore of this artifact runs for minutes, and `-pass "pass:$SECRET"` is
# readable by anyone who can run `ps -ef` on the box for that window — or in a
# support screenshot of the command they typed.
if [[ "${BACKUP}" == *.enc ]]; then
  DECRYPTED=0
  for label in BACKUP_PASSPHRASE SESSION_SECRET; do
    pass="${!label:-}"
    [[ -n "${pass}" ]] || continue
    if env "CARE_VERIFY_SECRET=${pass}" openssl enc -d -aes-256-cbc -pbkdf2 \
         -pass env:CARE_VERIFY_SECRET -in "${BACKUP}" -out "${PAYLOAD}" 2>/dev/null; then
      echo "✅ Decrypted using ${label}"
      DECRYPTED=1
      break
    fi
  done
  unset pass
  if [[ "${DECRYPTED}" -eq 0 ]]; then
    fail "Could not decrypt. Set BACKUP_PASSPHRASE (or SESSION_SECRET) to the value
   that was in force WHEN THIS FILE WAS WRITTEN.
   Rotating SESSION_SECRET without first setting BACKUP_PASSPHRASE to the previous
   value makes older artifacts undecryptable — candidatePassphrases() has no
   previous-secret slot."
  fi
else
  cp "${BACKUP}" "${PAYLOAD}"
fi

# ── 3. Decompress only if it really is gzip ───────────────────────────────────
# Sniff the magic bytes rather than trusting the filename: both families end in
# .enc but only one is compressed.
if [[ "$(head -c 2 "${PAYLOAD}" | od -An -tx1 | tr -d ' \n')" == "1f8b" ]]; then
  gzip -t "${PAYLOAD}" 2>/dev/null || fail "Payload looks like gzip but fails 'gzip -t' — the artifact is corrupt."
  gunzip -c "${PAYLOAD}" > "${PAYLOAD}.sql"
  mv "${PAYLOAD}.sql" "${PAYLOAD}"
  echo "✅ Decompressed (gzip)"
else
  echo "✅ Not compressed — using as-is"
fi

SQL_BYTES=$(stat -c%s "${PAYLOAD}")
[[ "${SQL_BYTES}" -gt 0 ]] || fail "Decoded payload is empty."
note "decoded SQL: $(numfmt --to=iec "${SQL_BYTES}" 2>/dev/null || echo "${SQL_BYTES} bytes")"

# ── 4. Refuse a DATA-ONLY dump before touching a database ─────────────────────
# This is the check that would have caught the real incident. A schema-complete
# pg_dump contains CREATE TABLE; exportDatabaseSqlFallback emits TRUNCATE +
# INSERT only and stamps its own "WARNING: DATA ONLY" header.
if ! grep -qim1 '^CREATE TABLE' "${PAYLOAD}"; then
  fail "This artifact is DATA ONLY — no CREATE TABLE statements.
   It cannot rebuild the database from nothing; it can only be loaded into a
   schema that already exists.

   Cause: pg_dump was unavailable in the api container, so the scheduler fell
   through to exportDatabaseSqlFallback(). Check the backup job's notes — a good
   artifact records  exporter=pg_dump.

   Take a known-good backup RIGHT NOW, straight from the database container.
   postgres:16-alpine ships pg_dump, so this does not depend on the api image:

     docker exec care-db pg_dump -U erp -d diagnostic_erp \\
       --no-owner --no-privileges --clean --if-exists \\
       | gzip > /volume1/backups/caredeoghar_\$(date +%Y%m%d_%H%M%S).sql.gz

   Then re-run this script against that file."
fi
echo "✅ Schema-complete (CREATE TABLE present)"

# ── 5. Restore into a throwaway container ─────────────────────────────────────
docker rm -f "${SANDBOX_CONTAINER}" >/dev/null 2>&1 || true
echo "🐋 Starting throwaway PostgreSQL 16..."
# No published port: nothing outside this host needs to reach the sandbox, and
# a restore sandbox full of real patient data must not be exposed.
# Durability is deliberately OFF. This container is docker rm -f'd the moment
# this script exits, success or failure — it never survives to be relied on,
# so there is nothing here for fsync/WAL-sync to protect. Restoring is
# otherwise almost entirely fsync-bound: a real 96 MB/439-table/~1270-index
# production dump was observed taking several minutes with defaults, on this
# exact NAS, with the postgres log showing a checkpoint that synced just 774
# buffers (4.7%) taking 92 seconds — 11s of that in fsync across 1148 files.
# From the outside that is indistinguishable from a hang. The point of this
# script is to prove the SQL and the data are correct, not to prove crash
# safety of a database that is deleted seconds later — so pay none of that
# cost. Arguments after the image name are passed to the postgres server
# (this is the official image's own supported form; any leading "-c" is
# auto-prefixed with the `postgres` command by its entrypoint).
docker run --name "${SANDBOX_CONTAINER}" \
  -e POSTGRES_DB="${SANDBOX_DB}" \
  -e POSTGRES_USER="${SANDBOX_USER}" \
  -e POSTGRES_PASSWORD="${SANDBOX_PASS}" \
  -d postgres:16-alpine \
  -c fsync=off \
  -c synchronous_commit=off \
  -c full_page_writes=off \
  -c checkpoint_timeout=30min \
  -c max_wal_size=4GB \
  >/dev/null

# The official postgres image starts in TWO phases on a cold container: a
# temporary internal instance runs initdb and creates ${SANDBOX_DB}, then it
# shuts down and the real long-running server starts. pg_isready accepts
# connections during BOTH phases — it does not check that any particular
# database exists, only that something is listening. Waiting on it alone is a
# race: it can report ready while the temp instance is still up (or mid
# restart), and the very next command — the actual restore — then fails with
# "database ... does not exist" against a backup that was never the problem.
#
# Poll with the exact operation the restore is about to perform instead, so
# there is no gap between "ready" and "actually restorable".
echo "⏳ Waiting for PostgreSQL to finish initializing ${SANDBOX_DB}..."
READY=0
for _ in $(seq "${VERIFY_READY_TIMEOUT}"); do
  if docker exec "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" -c 'SELECT 1' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[[ "${READY}" -eq 1 ]] || fail "Throwaway PostgreSQL never became queryable after ${VERIFY_READY_TIMEOUT}s.
   'docker logs ${SANDBOX_CONTAINER}' may show why. This is the sandbox not
   starting — the artifact has not been judged either way."

echo "⚡ Restoring — a large dump can legitimately take several minutes; a heartbeat below confirms it is still working, not stuck."
# A large restore with no visible output for minutes is indistinguishable
# from a hang. Print progress in the background so it never looks dead again.
( SECS=0
  while true; do
    sleep 30
    SECS=$((SECS + 30))
    echo "   ... still restoring (${SECS}s elapsed)"
  done
) &
HEARTBEAT_PID=$!

# ON_ERROR_STOP=1 is what makes this a test rather than a formality: without it
# psql exits 0 having failed every single statement.
RESTORE_LOG="${WORK}/restore.log"
RESTORE_OK=1
docker exec -i "${SANDBOX_CONTAINER}" \
      psql -v ON_ERROR_STOP=1 -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" \
      < "${PAYLOAD}" > "${RESTORE_LOG}" 2>&1 || RESTORE_OK=0

kill "${HEARTBEAT_PID}" >/dev/null 2>&1 || true
wait "${HEARTBEAT_PID}" 2>/dev/null || true
HEARTBEAT_PID=""

if [[ "${RESTORE_OK}" -eq 0 ]]; then
  echo "── last 20 lines of restore output ──"
  tail -20 "${RESTORE_LOG}"
  fail "psql aborted on the first error (ON_ERROR_STOP). This artifact does not restore cleanly."
fi
echo "✅ Restore completed with no errors"

# ── 6. Prove data actually landed ─────────────────────────────────────────────
q() {
  docker exec -i "${SANDBOX_CONTAINER}" psql -U "${SANDBOX_USER}" -d "${SANDBOX_DB}" \
    -t -A -c "$1" 2>/dev/null || echo "ERROR"
}

TABLES=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
[[ "${TABLES}" != "ERROR" && "${TABLES}" -gt 0 ]] || fail "No tables present after restore."

echo "📊 Restored contents:"
printf '   %-22s %s\n' "tables" "${TABLES}"
ZERO_CORE=0
for t in patients bills payments vouchers patient_reports; do
  c=$(q "SELECT count(*) FROM ${t};")
  printf '   %-22s %s\n' "${t}" "${c}"
  [[ "${c}" == "ERROR" ]] && fail "Core table '${t}' is missing from the restored database."
  if [[ "${t}" == "patients" || "${t}" == "bills" ]] && [[ "${c}" == "0" ]]; then
    ZERO_CORE=1
  fi
done

# A running clinic with NO patients or NO bills is not a successful restore —
# either count on its own means the dump captured an empty table, which is the
# shape the DATA-ONLY incident had. The previous script reported "100% valid" in
# exactly that case.
if [[ "${ZERO_CORE}" -eq 1 ]]; then
  fail "Schema restored, but patients/bills are EMPTY. For a running clinic that is
   an empty backup, not a valid one. Check what the backup job actually captured."
fi

echo ""
echo "🎉 PASS — this artifact restores, and the restored database has data."
echo "   $(basename "${BACKUP}") → ${TABLES} tables, core data present."
[[ -n "${SOURCE_DB:-}" ]] && note "source database: ${SOURCE_DB}   exporter: ${EXPORTER:-not recorded}"
echo ""
echo "   What this did NOT prove:"
echo "     · that the restored rows equal what the live database holds right now —"
echo "       compare the counts above against  docker exec care-db psql -U erp -d ${DB_NAME} -Atc \"select count(*) from patients\""
echo "     · that the restore is fast enough for your RPO/RTO, only that it completes"
echo "     · anything about the copies this script did not read: it verified ONE"
echo "       artifact, the newest in $(dirname "${BACKUP}")."
