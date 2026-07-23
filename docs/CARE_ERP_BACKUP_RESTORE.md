# CARE ERP — Backup & Restore

_How to back up the CARE ERP database and restore from a backup. Every command here was tested round-trip (`pg_dump → restore into a fresh DB → signed report byte-identical`). All patient/report/billing data lives in one PostgreSQL database (`diagnostic_erp`) in the `care-db` container (volume `care_main_db_data`) — backing that up backs up everything._

> **Golden rule:** a backup you have never restored is not a backup. Do the "Try it once" drill below at least once.

---

## What a backup is
A single **logical `pg_dump`** of `diagnostic_erp`, gzip-compressed. It is taken with `--clean --if-exists --no-owner --no-privileges`, so restoring it re-creates every object cleanly on any PostgreSQL 16 server. Typical size is small (a few MB) and grows with data.

## Three ways to take a backup (pick one)

### A. Automated nightly on the NAS (recommended)
1. Copy `scripts/synology-nas-backup.sh` to `/volume1/scripts/care-backup.sh`, `chmod +x` it.
2. (Optional) set `BACKUP_PASSPHRASE` inside it to encrypt — **store that passphrase somewhere safe; without it an encrypted backup cannot be restored.**
3. DSM → **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**, daily 03:00:
   ```sh
   bash /volume1/scripts/care-backup.sh
   ```
   It dumps straight from the `care-db` container (works even if `care-api` is down), verifies the gzip, encrypts if configured, and prunes copies older than `RETENTION_DAYS` (14).

### B. Manual, one command (on the NAS shell)
```sh
docker exec care-db pg_dump -U erp -d diagnostic_erp \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > /volume1/backups/caredeoghar_$(date +%Y%m%d_%H%M%S).sql.gz
```
Verify it is valid before trusting it:
```sh
gzip -t /volume1/backups/caredeoghar_*.sql.gz && echo "gzip OK"
```

### C. Via the API (pull to another machine)
`GET /api/internal/backup/download?format=gzip` with `Authorization: Bearer $INTERNAL_API_KEY` streams the same dump. Handy for pulling to an off-site box:
```sh
curl -fsS -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://<nas>:8888/api/internal/backup/download?format=gzip" -o care_backup.sql.gz
```

## Encryption (optional)
If `BACKUP_PASSPHRASE` is set, the file is `…sql.gz.enc` (AES-256-CBC, PBKDF2). Decrypt before restoring:
```sh
openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_PASSPHRASE" \
  -in care_backup.sql.gz.enc -out care_backup.sql.gz
```

---

## Restore

### Restore target rules
- **Test / disaster recovery →** restore into a **fresh empty database** (safe, non-destructive). This is the default and what the second-NAS DR uses.
- **Overwrite the live DB →** only when you deliberately want to roll the whole database back. Stop the app first and take a fresh backup of the current state before overwriting.

### Restore into a FRESH database (safe — always do this first)
```sh
# 1. decrypt if needed (see above), so you have care_backup.sql.gz
# 2. create an empty DB
docker exec care-db psql -U erp -d postgres -c "CREATE DATABASE diagnostic_erp_restore;"
# 3. load the dump
gunzip -c care_backup.sql.gz | docker exec -i care-db psql -U erp -d diagnostic_erp_restore
# 4. sanity check
docker exec care-db psql -U erp -d diagnostic_erp_restore -tAc \
  "SELECT (SELECT count(*) FROM patients) AS patients, (SELECT count(*) FROM bills) AS bills;"
```
A clean restore reports no `ERROR:` lines (the `--clean --if-exists` "does not exist" NOTICEs on a fresh DB are harmless). You now have a verified copy in `diagnostic_erp_restore` without touching production.

### Restore OVER the live database (deliberate rollback)
```sh
docker compose stop web api                       # stop writers
docker exec care-db pg_dump -U erp -d diagnostic_erp | gzip > /volume1/backups/pre_restore_$(date +%s).sql.gz   # safety net
gunzip -c care_backup.sql.gz | docker exec -i care-db psql -U erp -d diagnostic_erp   # --clean drops+recreates
docker compose up -d                              # bring the app back
pnpm operations:verify-deployment                 # confirm green
```
> If the dump is **older** than the current schema, run the schema reconcile after restoring so later migrations aren't skipped as "already applied":
> `node scripts/generate-schema-reconcile.cjs --date $(date +%Y%m%d)` then `docker compose up -d --build`. (See `HOW_TO_ADD_DB_MIGRATIONS.md`.)

---

## Try it once (10-minute drill — no risk to production)
1. Take a manual backup (method B above).
2. Restore it into `diagnostic_erp_restore` (the FRESH-database steps).
3. Run the sanity check — patient/bill counts should match production.
4. Drop the test copy when done: `docker exec care-db psql -U erp -d postgres -c "DROP DATABASE diagnostic_erp_restore;"`

If step 3 matches, your backups are trustworthy. This drill was validated in the repo: a signed report's content hash was byte-identical after a full `pg_dump → restore` round-trip.

## Where backups should live
Keep **at least two copies in two places** — e.g. `/volume1/backups` on the primary NAS **and** a copy synced to the second NAS (Synology **Hyper Backup** or a `scp`/`rsync` in the same scheduled task). The second-NAS disaster-recovery guide relies on a backup being reachable from the standby NAS.
