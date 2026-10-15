# CARE ERP — Backup & Restore

_Everything patient/report/billing-related lives in one PostgreSQL database (`diagnostic_erp`) in the `care-db` container — backing that up backs up everything. All commands here use `docker exec`, so nothing extra needs installing on the NAS._

> **Golden rule:** a backup you have never restored is not a backup. `verify-backup-restore.sh` below is not optional — a backup job reporting "success" does not mean the file is usable. This system ran for months with backups that reported success, matched their checksum, and could not be restored.

> **Before trusting a `pg_dump` as "everything", read `docs/CARE_ERP_BACKUP_COVERAGE.md`.**
> The sentence above is true of the *database*, and this ERP does not keep everything in
> the database: invoice attachments, referral documents, frozen key-image pixels and
> `audit_logs` rows past their retention sit on paths no dump contains. `docker-compose.yml:418-422`
> says it about the volume this document's own backup does not take — "DB backup alone is
> NOT sufficient for frozen key-image evidence". The matrix lists every dataset, where it
> physically lives, and whether anything protects it.

> **To see what is actually in the backup destination right now** (every artifact, what its
> `.meta` sidecar claims, which checksums were recomputed, and which restores were ever
> proved), run it on the NAS with the `node` that Synology ships — `pnpm` is not on PATH there:
> ```sh
> BACKUP_DIR=/volume1/backup/care-erp/db node scripts/ops-backup-inventory.mjs --verify-checksums
> ```
> (`pnpm ops:backup-inventory` is the same tool on a dev box.) It reads the directory and reaches
> no verdict; it takes no backup and restores nothing.

---

## The short version

```bash
# 1. Take a backup
docker exec care-db pg_dump -U erp -d diagnostic_erp \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > /path/you/choose/caredeoghar_$(date +%Y%m%d_%H%M%S).sql.gz

# 2. Prove it restores (mandatory — do this every time, not just once)
bash scripts/verify-backup-restore.sh /path/you/choose

# 3. If you ever need to restore for real, see "Restore" below.
```

If step 2 prints **`🎉 PASS`**, you have a real, restorable backup. Anything else, keep reading.

---

## 1. Taking a backup

### Manual, right now (works regardless of anything else)

```bash
mkdir -p /path/you/choose   # any writable directory, e.g. /volume1/data/care-backups
bash -c 'set -o pipefail
OUT=/path/you/choose/caredeoghar_$(date +%Y%m%d_%H%M%S).sql.gz
docker exec care-db pg_dump -U erp -d diagnostic_erp \
  --no-owner --no-privileges --clean --if-exists | gzip > "$OUT" \
  && echo "OK  $OUT  ($(du -h "$OUT" | cut -f1))" \
  || { echo "FAILED — deleting truncated file"; rm -f "$OUT"; exit 1; }'
```

`gzip > file` alone hides pg_dump failures — the `bash -c 'set -o pipefail ...'` wrapper above is what makes a failed dump delete itself instead of leaving a broken file that looks fine. This runs `pg_dump` **inside** the `care-db` container and writes the output via your own shell — it does not depend on the api container, its image, or any environment variable being set correctly.

### Automatic (in-app scheduler)

Settings → Backup & Replication in the ERP configures scheduled jobs (`DB`, `CONFIG`, `FULL`), encrypted and written to a `destinationPath` you choose there. Check what's configured and whether it's actually working:

```bash
docker exec care-db psql -U erp -d diagnostic_erp -c \
  "SELECT j.job_name, j.destination_path, j.is_enabled, l.status, l.completed_at, l.notes
     FROM backup_jobs j LEFT JOIN backup_job_logs l ON l.job_id = j.id
    ORDER BY l.completed_at DESC NULLS LAST LIMIT 5;" -x
```

Look for `exporter=pg_dump` in the `notes` of a healthy job. If it says `exporter=fallback`, that backup is **not schema-complete** and cannot rebuild a database from nothing — treat it as broken and use the manual method above instead. Then check the destination directory on the NAS actually has the file:

```bash
ls -la /path/from/the/destination_path/column/above
```

If that's empty while the job reports success, the container isn't mounted at that path — the app is writing into its own throwaway filesystem, not the NAS. Fix the mount in `docker-compose.yml` (`api.volumes`), then `docker compose up -d --force-recreate --no-deps api`, and confirm:

```bash
docker inspect care-api --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

Your `destination_path` should appear on the left of one of those lines.

---

## 2. Verifying a backup restores

```bash
bash scripts/verify-backup-restore.sh /path/to/backup/dir-or-file
```

With no argument it searches `$BACKUP_DIR` first and then the two known roots
(`/volume1/backup/care-erp/db`, `/volume1/backups/caredeoghar`), so the scheduled
job's own destination needs no repeating. Point it at a **directory of a specific
job** when several jobs share a parent: it takes the newest file by modification
time, and the `config` job writes last every hour.

It decrypts (trying `BACKUP_PASSPHRASE` then `SESSION_SECRET`, matching what the
app itself tries), decompresses only if the bytes really are gzip, refuses anything
that isn't schema-complete, restores into a **throwaway** container with no
published port and `ON_ERROR_STOP=1`, then checks patients/bills actually landed.
It prints `🎉 PASS` or tells you exactly what's wrong.

If the artifact has a `.meta` sidecar (written by `scripts/synology-nas-backup.sh`
since this change), what the job recorded is checked before any restore starts:

* `source_database` must equal `DB_NAME` (default `diagnostic_erp`) — so a copy of
  the wrong database, with a plausible file name, is refused rather than restored
  in front of staff. Override deliberately with `DB_NAME=… bash $0 …`.
* `sha256_artifact` must match the bytes on disk — a truncated or hand-edited copy
  fails here instead of halfway through a restore.
* the **backup-time census** is named: `census: 7 table(s) bracketed at dump time
  (…)`, or `census: none`. That bracket — row count, lowest id, highest id and the
  sum of ids for each core table, taken immediately before the dump and immediately
  after it — is what the in-app verifier's `backup_census_match` step grades the
  restored copy against, and it is the only completeness argument that does not
  assume ids are dense, that history is never deleted, or that nobody rebuilt a
  sequence after 03:00. `verify-backup-restore.sh` reports which kind of artifact it
  is holding so you know before the restore; the grading, and the `UNKNOWN` the
  deploy gate holds a census-free proof at, happen in `restoreVerification.ts`.

Artifacts without a sidecar (older copies, the in-app scheduler's own files) still
get the full restore proof; the script just says plainly that the source database
is not confirmed.

If your artifact is encrypted, do not type the passphrase into the command line —
it would sit in this box's shell history forever:

```bash
read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
bash scripts/verify-backup-restore.sh /path/to/backup
unset BACKUP_PASSPHRASE
```

(`SESSION_SECRET=<value from when the file was written>` works the same way if the
scheduler encrypted it instead.)

A large backup (hundreds of MB, hundreds of tables) can legitimately take a few minutes to restore — you'll see `... still restoring (30s elapsed)` rather than silence. That's normal, not stuck.

### The binder copy, and which file to edit

`SOP/RECOVERY/13_RESTORE/verify-backup-restore.sh` is a **byte-identical copy** of
`scripts/verify-backup-restore.sh`, not a wrapper: the recovery folder has to work
when nothing else does. `scripts/` is the one you edit. Until this was written down
the two were different programs and the copy in the binder was the older one — the
one that restored nothing, printed `Patients: 0  Bills: 0`, and then said
`🎉 BACKUP VERIFICATION SUCCESSFUL! Backup file integrity is 100% valid.` with
exit status 0. `scripts/backupScripts.test.mjs` now runs every script in
`12_BACKUPS/` and `13_RESTORE/` and fails CI if it differs from, or behaves
differently to, its `scripts/` twin.


---

## 3. Restore

### Into a fresh test database (safe — always do this first)

```bash
# 1. If encrypted, decrypt on the host first. The passphrase goes in through the
#    environment — `-pass "pass:$SECRET"` would put it in `ps -ef` for the whole
#    restore, and in this box's shell history forever.
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE \
  -in backup.sql.gz.enc -out backup.sql.gz
# If that errors with "bad decrypt", the file used the OLD SESSION_SECRET
# instead — try that value in place of $BACKUP_PASSPHRASE above.

# 2. If it's gzipped (filename ends .sql.gz), decompress:
gunzip backup.sql.gz    # -> backup.sql
# Scheduler-written files (backup_<job>_*.sql) are already plain SQL — skip this step.

# 3. Create an empty test database and load into it
docker exec care-db psql -U erp -d postgres -c "CREATE DATABASE diagnostic_erp_restore;"
docker exec -i care-db psql -v ON_ERROR_STOP=1 -U erp -d diagnostic_erp_restore < backup.sql

# 4. Sanity check
docker exec care-db psql -U erp -d diagnostic_erp_restore -tAc \
  "SELECT (SELECT count(*) FROM patients) AS patients, (SELECT count(*) FROM bills) AS bills;"

# 5. Clean up the test copy when done
docker exec care-db psql -U erp -d postgres -c "DROP DATABASE diagnostic_erp_restore;"
```

`ON_ERROR_STOP=1` matters — without it, `psql` can fail every single statement and still exit 0, silently reporting a restore that never happened.

### Over the live database (deliberate rollback — data loss if done carelessly)

Only do this when you mean to roll the whole database back to the backup's point in time.

```bash
docker compose stop web api                       # stop writers first

# safety net: back up the CURRENT state before you overwrite it
docker exec care-db pg_dump -U erp -d diagnostic_erp | gzip > pre_restore_$(date +%s).sql.gz

docker exec -i care-db psql -v ON_ERROR_STOP=1 -U erp -d diagnostic_erp < backup.sql   # --clean drops+recreates objects

docker compose up -d                               # bring the app back
```

If the backup is **older** than the currently-deployed schema, restart with a rebuild afterward so pending migrations reapply cleanly: `docker compose up -d --build`.

---

## Where to keep backups

At least **two copies in two places** — one on this NAS, one synced elsewhere (a second NAS, Hyper Backup, `rsync`/`scp` off-box). A backup that only exists on the machine it protects doesn't protect against that machine failing.
