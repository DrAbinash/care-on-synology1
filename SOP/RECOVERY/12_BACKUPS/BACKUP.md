# Backup Guide: Care Diagnostics ERP / RIS-PACS Platform

Patient data is critical. There are two primary backup methods:
1. **Local Docker Backup** (Directly backing up the active database and file storage from the Synology NAS)
2. **Replit Sync Backup** (Syncing data from a remote Replit instance)

---

## 1. Local Database & File Backup (Recommended)

Run these commands directly on the host (Synology NAS via SSH, Windows PowerShell, or VPS) to backup the active database and uploaded files.

### A. Database Backup (pg_dump)

For anything the clinic relies on, run `scripts/synology-nas-backup.sh` (section
2) instead of the ad-hoc line below: it is the same `pg_dump`, plus a source
database check, a completion-marker check, atomic publication and a sidecar. The
manual form is still useful for a one-off copy you intend to verify immediately.

To backup the PostgreSQL database into a single `.sql.gz` file:
```bash
# Synology / Linux SSH
docker exec -t care-db pg_dumpall -U erp | gzip > /volume1/care-diagnostics/backups/db_backup_$(date +%Y%m%d).sql.gz

# Windows PowerShell
docker exec -t care-db pg_dumpall -U erp | gzip > db_backup_$(Get-Date -Format "yyyyMMdd").sql.gz
```

### B. File Uploads (Object Storage) Backup
To backup the uploaded reports, patient photos, and attachments:
```bash
# Synology / Linux SSH
tar -czf /volume1/care-diagnostics/backups/storage_backup_$(date +%Y%m%d).tar.gz -C /volume1/care-diagnostics/deploy/postgres_data .
```

---

## 2. Automated Daily Backup on Synology NAS

**Use the maintained script, not an inline pipe.** DSM → Control Panel → Task
Scheduler → Create → Scheduled Task → User-defined script, `root`, daily at
`03:00`:

```bash
BACKUP_PASSPHRASE="$(cat /volume1/scripts/.passphrase)" bash /volume1/care-diagnostics/scripts/synology-nas-backup.sh
```

`scripts/synology-nas-backup.sh` asks the server which database it is dumping and
refuses anything else, writes to a `.partial` and publishes with `mv`, requires
the dump banner **and** the `-- PostgreSQL database dump complete` trailer,
requires at least one `CREATE TABLE`, refuses a dump below 10 KiB, records a
`.meta` sidecar (source database, server version, exporter, sha256, **and a
census of the core tables taken immediately before and immediately after the
dump**), encrypts only after a round-trip check proves the encrypted copy decrypts
back to the same bytes, and never prunes below `KEEP_MIN_COPIES`.

The census is four numbers per table — row count, lowest id, highest id, sum of
ids — and nothing else. It is what turns a restore proof from "the artifact
restored, and its highest ids look plausible" into "the artifact held what the
database held at 03:00, and here is the bracket it had to fall inside". A
high-water id cannot see history deleted after the dump, a rebuilt sequence, or a
dump of the wrong database that happens to have a plausible top id; a row count
compared against the *live* table fails a perfect restore, because the clinic keeps
writing while a backup ages. `CARE_BACKUP_CENSUS_TABLES` overrides the table list;
a census that cannot be taken is recorded as `census_error=` and never costs the
nightly backup.

The inline form of this section used to be:

```bash
docker exec -t care-db pg_dump -U erp -d diagnostic_erp | gzip > …/care_db_daily_$(date +%Y%m%d).sql.gz
find …/backups/ -name "care_db_daily_*.sql.gz" -mtime +30 -delete
```

Do not schedule it. `gzip -t` on the result is not proof PostgreSQL can restore
it; a pipe that dies mid-`COPY` still produces a valid gzip; nothing checks which
database was behind the socket; and the `find … -delete` line runs whether or not
the dump succeeded, so one bad night can remove every older copy. That is the
shape of the incident this product actually had: hourly artifacts reported
success, matched their checksum, and could not rebuild a database.

---

## 3. Remote Replit Sync Backup & Optional Encryption (API-Based)

`scripts/synology-backup.sh` downloads a dump from the **old cloud (Replit)
instance**. Its database is not this clinic's database, and it is not a copy of
anything on this NAS. It is retired as the clinic's backup (see
`CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md`) and must never be scheduled *instead
of* section 2. Run it only when you deliberately want the cloud instance's data.

```bash
bash scripts/synology-backup.sh
```
* **Required env vars**:
  * `CAREDEOGHAR_API_KEY` (the cloud instance's key; passed to curl through a
    `0600` config file, never on the command line).
  * `BACKUP_PASSPHRASE` (passphrase to encrypt the backup file using AES-256-CBC, optional).
* **Backup Destination**: `$BACKUP_DIR`, default `/volume1/backups/caredeoghar`

A 200 response is not a backup: the file must be non-empty, gzip-valid, carry the
dump banner and completion trailer, and contain `CREATE TABLE`, or the run fails
and publishes nothing.

When `BACKUP_PASSPHRASE` is set, the backup will be saved as `caredeoghar_YYYYMMDD_HHMMSS.sql.gz.enc` (encrypted via OpenSSL PBKDF2).

---

## 4. Proving a copy restores

A backup that has never been restored is a hypothesis. Run:

```bash
bash scripts/verify-backup-restore.sh "$BACKUP_DIR"
```

It restores the real artifact into a throwaway container with no published port,
with `ON_ERROR_STOP=1`, refuses a DATA-ONLY dump, checks the `.meta` sidecar's
source database and sha256, and fails if `patients` or `bills` land empty. Exit 0
is the only evidence that counts. `SOP/RECOVERY/13_RESTORE/verify-backup-restore.sh`
is a byte-identical copy of that script for the binder, and CI fails if the two
ever differ — read the `scripts/` one when changing it.

Before it starts, the verifier tells you which kind of artifact it is holding:
`census: 7 table(s) bracketed at dump time (…)`, or `census: none`. A
census-bearing artifact is judged against the numbers the job recorded while the
dump ran, which is the only completeness argument that survives a row deleted after
the dump or a sequence that was rebuilt. An older artifact is still worth
restoring — it simply cannot be shown to be complete, so verify a backup taken by
the current script instead of recording a proof the deploy gate will hold at
UNKNOWN.

Record the result so the gate can see it:

```bash
node scripts/ops-preflight.mjs --record-restore --artifact caredeoghar_YYYYMMDD_HHMMSS.sql.gz --tables 439 --patients 8123
```

The attestation is read from that artifact's `.meta` and is never typed. A proof
pointed at an artifact with no census is recorded as unattested, and
`restore.evidence` answers UNKNOWN with the command above as its remedy.


