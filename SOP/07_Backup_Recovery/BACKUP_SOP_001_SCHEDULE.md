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
2.  The script [synology-backup.sh](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/12_BACKUPS/synology-backup.sh) runs as root.
3.  If the environment variable `BACKUP_PASSPHRASE` is defined on the NAS, the script automatically encrypts the SQL file using OpenSSL:
    ```bash
    openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${BACKUP_PASSPHRASE}"
    ```
4.  Confirm backup file `caredeoghar_YYYYMMDD_HHMMSS.sql.gz.enc` is created in `/volume1/backups/caredeoghar/`.

### B. Weekly Sandbox Restore Verification
1.  Every Sunday at `04:00` AM, the IT support team or automated cron must execute the backup verification script:
    ```bash
    bash /volume1/care-diagnostics/scripts/verify-backup-restore.sh
    ```
2.  This script:
    *   Finds the newest `.sql.gz` or `.sql.gz.enc` file.
    *   Spins up a temporary PostgreSQL Docker container on port `5499`.
    *   Imports and restores the database (auto-decrypting if necessary).
    *   Queries patient, bill, and voucher counts to verify database integrity.
    *   Automatically tears down and removes the sandbox container.
3.  Verify the script prints:
    ```
    🎉 BACKUP VERIFICATION SUCCESSFUL! Backup file integrity is 100% valid.
    ```

---

## 3. Reference to Recovery Specifications
For detailed scripts and configuration parameters, refer directly to:
*   **[BACKUP.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/12_BACKUPS/BACKUP.md)**
*   **[RESTORE.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/13_RESTORE/RESTORE.md)**

---

## 4. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
