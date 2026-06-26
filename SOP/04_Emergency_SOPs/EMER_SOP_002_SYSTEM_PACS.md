# EMER_SOP_002: Server, Database & PACS Crash Protocols
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Restore clinical operation during server OS crashes, database corruption, or PACS storage failures.
*   **Scope**: PostgreSQL Database, Orthanc/Conquest PACS, and Docker daemon.
*   **Responsibility**: IT Administrator and System Administrators.

---

## 2. Step-by-Step Recovery Procedures

### A. Database Corruption Recovery
1.  Verify the database status:
    ```bash
    docker exec -it care-db pg_isready -U erp -d diagnostic_erp
    ```
2.  If log records show block corruption (`PANIC: could not locate valid checkpoint record`):
    *   Stop the API container to prevent lock escalations: `docker stop care-api`.
    *   Drop and re-create the database instance.
    *   Locate the latest daily backup (`.sql.gz`) in `/volume1/backups/caredeoghar/`.
    *   Import the backup:
        ```bash
        gunzip -c care_db_daily_YYYYMMDD.sql.gz | docker exec -i care-db psql -U erp -d diagnostic_erp
        ```
    *   Start the API container: `docker start care-api`.

### B. Orthanc PACS Storage Failure
1.  Check the Orthanc container status:
    ```bash
    docker ps | grep orthanc
    ```
2.  If Orthanc SQLite database is corrupted:
    *   Stop the Orthanc container.
    *   Restore the `/volume1/docker/orthanc/db/` directory from the weekly cold storage copy.
    *   Restart the container.
3.  If no cold storage copy is available:
    *   Create a clean database folder.
    *   Start Orthanc container.
    *   Re-ingest raw files from the Conquest archive `/volume1/docker/conquest/data/`.

---

## 3. Reference to Recovery Catalog
For detailed scripts, configuration parameters, and bare-metal Synology NAS restore guides, refer directly to:
*   **[DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/14_BUSINESS_CONTINUITY/DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md)**
*   **[RESTORE.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/13_RESTORE/RESTORE.md)**

---

## 4. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
