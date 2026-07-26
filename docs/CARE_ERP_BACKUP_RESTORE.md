# CARE ERP — Backup & Restore

_Everything patient/report/billing-related lives in one PostgreSQL database (`diagnostic_erp`) in the `care-db` container — backing that up backs up everything. All commands here use `docker exec`, so nothing extra needs installing on the NAS._

> **Golden rule:** a backup you have never restored is not a backup. `verify-backup-restore.sh` below is not optional — a backup job reporting "success" does not mean the file is usable. This system ran for months with backups that reported success, matched their checksum, and could not be restored.

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

This decrypts (trying `BACKUP_PASSPHRASE` then `SESSION_SECRET`, matching what the app itself tries), decompresses if needed, refuses anything that isn't schema-complete, and restores into a **throwaway** container — never your real database — then checks patients/bills actually landed. It prints `🎉 PASS` or tells you exactly what's wrong.

If your artifact is encrypted, pass the passphrase:

```bash
SESSION_SECRET=YOUR_OLD_SESSION_SECRET_VALUE \
  bash scripts/verify-backup-restore.sh /path/to/backup
```

(replace `YOUR_OLD_SESSION_SECRET_VALUE` with whatever `SESSION_SECRET` was set to when this file was written)

A large backup (hundreds of MB, hundreds of tables) can legitimately take a few minutes to restore — you'll see `... still restoring (30s elapsed)` rather than silence. That's normal, not stuck.

---

## 3. Restore

### Into a fresh test database (safe — always do this first)

```bash
# 1. If encrypted, decrypt on the host first:
openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_PASSPHRASE" \
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
