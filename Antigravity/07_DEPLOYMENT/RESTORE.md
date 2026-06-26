# Restore Guide: Care Diagnostics ERP / RIS-PACS Platform

This guide outlines the steps to restore patient database and file uploads from backup files.

---

## 1. Restoring the Database (PostgreSQL)

If restoring to a fresh deployment or recovering from data corruption, follow these steps:

### A. Locate Your SQL Backup
Locate your `.sql.gz` file (e.g. `care_db_daily_20260609.sql.gz`).

### B. Execute Database Restore
Run the following commands on your host system:

#### Linux / Synology NAS (via SSH)
To restore a plaintext backup:
```bash
# 1. Unzip the backup file
gunzip -k care_db_daily_20260609.sql.gz

# 2. Drop the existing database and recreate it
docker exec -it care-db psql -U erp -d postgres -c "DROP DATABASE IF EXISTS diagnostic_erp;"
docker exec -it care-db psql -U erp -d postgres -c "CREATE DATABASE diagnostic_erp;"

# 3. Restore the schema and data
docker exec -i care-db psql -U erp -d diagnostic_erp < care_db_daily_20260609.sql
```

To restore an encrypted backup (`.enc` extension) using the helper restore script:
```bash
# Run the restore script (will prompt for passphrase if BACKUP_PASSPHRASE is not exported)
export BACKUP_PASSPHRASE="your_secure_passphrase"
bash scripts/synology-restore.sh /volume1/backups/caredeoghar/caredeoghar_20260625_030000.sql.gz.enc
```


#### Windows (via PowerShell)
```powershell
# 1. Uncompress the SQL file (using 7-zip or similar)
# 2. Recreate database
docker exec -it care-db psql -U erp -d postgres -c "DROP DATABASE IF EXISTS diagnostic_erp;"
docker exec -it care-db psql -U erp -d postgres -c "CREATE DATABASE diagnostic_erp;"

# 3. Import SQL file
Get-Content care_db_daily_20260609.sql | docker exec -i care-db psql -U erp -d diagnostic_erp
```

---

## 2. Restoring File Uploads (Object Storage)

If restoring patient document files and logos:

### Linux / Synology NAS
```bash
# Extract files directly back into the volume folder
tar -xzf storage_backup_20260609.tar.gz -C /volume1/care-diagnostics/deploy/postgres_data
```

---

## 3. Verify System After Restore
1. Restart the docker stack:
   ```bash
   docker compose restart
   ```
2. Log in to the Staff ERP at `http://<ip>:8888/erp/` and verify patient list count is restored.
3. Check the clinic logo in the admin portal.
