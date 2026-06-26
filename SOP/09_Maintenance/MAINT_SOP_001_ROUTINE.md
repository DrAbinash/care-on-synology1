# MAINT_SOP_001: Routine Maintenance Schedules & Health Checks
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Prevent system stagnation, database bloat, and hardware degradation via scheduled infrastructure, Docker container, and server maintenance checks.
*   **Scope**: Database, Docker service, local bridge workstation client, and physical NAS hardware.
*   **Responsibility**: System Administrators and IT Support staff.

---

## 2. Step-by-Step Maintenance Workflows

### A. Daily Maintenance (Automated)
1.  **Storage Check**: Verify NAS filesystem usage is below 85% capacity.
2.  **Container Health Check**: Confirm docker containers are healthy:
    ```bash
    docker ps -a
    ```
3.  **Logs Audit**: Check API server log for database connectivity errors.

### B. Weekly Maintenance (Sundays)
1.  **Backup Test**: Run the automated restore script `verify-backup-restore.sh`.
2.  **Docker System Prune**: Clean up dangling volumes and unused images:
    ```bash
    docker system prune -f
    ```
3.  **UPS Battery Review**: Confirm smart UPS connection is reporting correct charging capacity via Synology DSM hardware panel.

### C. Monthly Maintenance (First Sunday)
1.  **Database VACUUM**: Execute query optimization commands to reclaim space and rebuild indexes on PostgreSQL:
    ```sql
    VACUUM ANALYZE;
    ```
2.  **SMART Hard Drive Test**: Run a quick SMART health check on all Synology drives via DSM Storage Manager.

### D. Quarterly Maintenance
1.  **Restore Drill**: Manually restore the latest database dump into a staging environment and verify patient/billing record consistency.
2.  **DSM Update**: Install security patches and DSM operating system updates.

---

## 3. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
