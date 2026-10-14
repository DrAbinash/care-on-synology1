# BACKUP_SOP_001: Daily Backup Scheduling & Restore Drills
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Protect clinical data and financial records from catastrophic loss via scheduled backups, AES-256 encryption, and automated sandbox restore checks.
*   **Scope**: PostgreSQL database, Orthanc PACS storage, and Synology DSM configuration.
*   **Responsibility**: IT Support staff and System Administrators.

---

## 2. Step-by-Step Backup & Recovery Procedures

### A. Daily Scheduled Backups
1.  Daily database backups are executed automatically via the **Synology Task Scheduler** at `03:00` AM IST.
2.  The script that must run at 03:00 is **`scripts/synology-nas-backup.sh`** — it dumps
    this NAS's own `care-db` container, so it protects the clinic's actual data and works
    even when `care-api` is down. `scripts/synology-backup.sh` (the older helper referenced
    below) pulls a **different** database — the old cloud/Replit instance — and is retired as
    this clinic's backup; see `SOP/RECOVERY/MASTER_RECOVERY_INDEX.md`.
3.  If the environment variable `BACKUP_PASSPHRASE` is defined on the NAS, the script automatically encrypts the SQL file using OpenSSL:
    ```bash
    openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_PASSPHRASE
    ```
4.  Confirm backup file `caredeoghar_YYYYMMDD_HHMMSS.sql.gz.enc` is created in `/volume1/backups/caredeoghar/`.

### B. Weekly Sandbox Restore Verification
1.  Every Sunday at `04:00` AM, the IT support team or automated cron must execute the backup verification script, pointed at the directory the job writes:
    ```bash
    bash /volume1/care-diagnostics/scripts/verify-backup-restore.sh /volume1/backup/care-erp/db
    ```
2.  This script:
    *   Searches `$BACKUP_DIR`, then the two known roots, and takes the newest artifact of either naming family.
    *   Reads the artifact's `.meta` sidecar and **refuses** it if it records a different `source_database` than `DB_NAME`, or if the bytes on disk do not match the recorded `sha256_artifact`.
    *   Decrypts through OpenSSL's environment (never a command-line argument), and decompresses only if the magic bytes say gzip.
    *   Refuses a DATA-ONLY dump before starting any container.
    *   Starts a throwaway PostgreSQL container with **no published port** and restores into it with `ON_ERROR_STOP=1`.
    *   Fails if no tables landed, or if `patients` or `bills` came back empty.
    *   Removes the sandbox on every exit path, including Ctrl+C.
3.  The acceptance criterion is the **exit status**, plus a printed `🎉 PASS` and non-zero row counts. Anything that says "100% valid" is a pre-fix copy of this script and must not be trusted: that wording was printed over a restore of zero rows.
4.  Record the run. A verification nobody wrote down is a verification that did not happen — date it in this folder, together with the artifact name and the counts printed.

---

## 3. Reference to Recovery Specifications
For detailed scripts and configuration parameters, refer directly to:
*   **[BACKUP.md](../RECOVERY/12_BACKUPS/BACKUP.md)**
*   **[RESTORE.md](../RECOVERY/13_RESTORE/RESTORE.md)**

---

## 4. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
