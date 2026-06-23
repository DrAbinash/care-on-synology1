# Backup Guide: Care Diagnostics ERP / RIS-PACS Platform

Patient data is critical. There are two primary backup methods:
1. **Local Docker Backup** (Directly backing up the active database and file storage from the Synology NAS)
2. **Replit Sync Backup** (Syncing data from a remote Replit instance)

---

## 1. Local Database & File Backup (Recommended)

Run these commands directly on the host (Synology NAS via SSH, Windows PowerShell, or VPS) to backup the active database and uploaded files.

### A. Database Backup (pg_dump)
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

You can automate database backups via the DSM UI:
1. Open **DSM Control Panel** → **Task Scheduler**.
2. Click **Create** → **Scheduled Task** → **User-defined script**.
3. Under the **General** tab:
   * **Task name**: `Care Diagnostics DB Backup`
   * **User**: `root`
4. Under the **Schedule** tab:
   * Select **Run on the following days: Daily** at `03:00` AM.
5. Under **Run Config**:
   * Add the following script command:
     ```bash
     mkdir -p /volume1/care-diagnostics/backups
     docker exec -t care-db pg_dump -U erp -d diagnostic_erp | gzip > /volume1/care-diagnostics/backups/care_db_daily_$(date +%Y%m%d).sql.gz
     # Purge files older than 30 days
     find /volume1/care-diagnostics/backups/ -name "care_db_daily_*.sql.gz" -mtime +30 -delete
     ```
6. Click **OK** to save the task.

---

## 3. Remote Replit Sync Backup (API-Based)

If syncing from Replit, you can use the configured helper script:
```bash
bash scripts/synology-backup.sh
```
* **Required env vars**: `CAREDEOGHAR_API_KEY` (containing your Replit API key).
* **Backup Destination**: `/volume1/backups/caredeoghar`
