# Disaster Recovery Audit — Care Diagnostics ERP & PACS Ecosystem

This document establishes the official disaster recovery (DR) protocols, backup catalogs, recovery time objectives (RTO), single points of failure (SPOF), and system hardening recommendations for the Care Diagnostics ERP.

---

## 1. Executive Summary & Recovery Time Estimates

The Care Diagnostics infrastructure operates on-premise on a Synology NAS with cloud-routed remote access. The table below summarizes RTO (Recovery Time Objective) and RPO (Recovery Point Objective) for each disaster scenario:

| Failure Mode | Impact Level | Recovery Time Estimate (RTO) | Data Loss Limit (RPO) | Recovery Complexity |
| :--- | :--- | :--- | :--- | :--- |
| **Power Failure** | High | 15 – 30 minutes | 0 (with UPS shutdown) | Low (Auto-start) |
| **Cloudflare Outage** | Medium | 10 – 15 minutes | 0 (Local reading functional) | Low (DNS bypass) |
| **OHIF / Weasis Failure** | Medium | 15 – 30 minutes | 0 | Low (Rebuild/Reinstall) |
| **ERP Container Loss** | High | 15 – 30 minutes | 0 (Metadata in PG volume) | Medium (Compose up) |
| **Orthanc / Conquest Loss**| High | 1 – 2 hours | < 24 hours (Prior backups) | Medium (Resync DB) |
| **Database Corruption** | Critical | 1 – 2 hours | < 24 hours (Daily dump) | High (Pg_restore) |
| **Docker Corruption** | Critical | 2 – 4 hours | 0 | High (Daemon purge) |
| **NAS Hardware Failure** | Critical | 4 – 8 hours | < 24 hours | Critical (Bare metal) |

---

## 2. Disaster Recovery Procedures & Backup Catalog

### 2.1 Backup Locations & Retention Policies

- **ERP Database Dump**: 
  - **Path**: `/volume1/care-diagnostics/backups/daily_backups/`
  - **Format**: Custom PostgreSQL archive format (`.dump`) generated via `pg_dump`.
  - **Schedule**: Every day at 03:00 AM.
  - **Retention**: Last 30 days kept locally; last 7 days replicated to cloud.
- **Orthanc DICOM Binaries**:
  - **Path**: `/volume1/docker/orthanc/db/`
  - **Retention**: Persistent local storage synced to external cold drive weekly.
- **Conquest DICOM Binaries**:
  - **Path**: `/volume1/docker/conquest/data/`
  - **Retention**: Persistent database store.
- **Synology Configuration & Shared Folders**:
  - **Tool**: Synology Hyper Backup.
  - **Destination**: Secondary NAS and Synology C2 Cloud Storage.
  - **Schedule**: Every day at 04:00 AM.

---

### 2.2 Component-Wise Recovery Procedures

#### A. NAS Hardware Failure
- **Symptom**: Synology NAS does not power on, RAID storage crashed, or blue light of death.
- **Recovery Steps**:
  1. Procure a compatible replacement Synology NAS unit.
  2. Install the hard drives in the same order (migrating the RAID volume) or mount a new array.
  3. Reinstall DSM (DiskStation Manager).
  4. Restore shared folders and permissions using **Hyper Backup** from C2 Cloud or the secondary NAS.
  5. Launch Docker (Container Manager) and redeploy the ERP using the backup docker-compose file.
  6. Restore the database from the latest `.dump` file (see Database Recovery section).

#### B. Database Corruption
- **Symptom**: PostgreSQL log reports `invalid page header`, container crashes on query loop, or Drizzle ORM fails schema matching.
- **Recovery Steps**:
  1. Stop the active API container to prevent write locks: `docker stop care-api`.
  2. Drop the corrupted database: `docker exec -it care-db dropdb -U erp diagnostic_erp`.
  3. Re-create the database: `docker exec -it care-db createdb -U erp diagnostic_erp`.
  4. Locate the latest healthy backup: `/volume1/care-diagnostics/backups/daily_backups/db_backup_YYYY-MM-DD.dump`.
  5. Run pg_restore:
     ```bash
     docker exec -i care-db pg_restore -U erp -d diagnostic_erp --clean --no-owner < /volume1/care-diagnostics/backups/daily_backups/db_backup_date.dump
     ```
  6. Re-launch the API container: `docker start care-api` and run `pnpm run typecheck` to verify schema compliance.

#### C. Orthanc Loss
- **Symptom**: Orthanc container fails to start, SQLite database is corrupted, or `/system` REST API returns 500.
- **Recovery Steps**:
  1. Stop and remove the Orthanc container: `docker-compose down orthanc`.
  2. Inspect `/volume1/docker/orthanc/db/` for corruption. If corrupted, rename the directory to `db_corrupted` and create a clean `db` directory.
  3. Rebuild the Orthanc instance: `docker-compose up -d orthanc`.
  4. Restore DICOM files from the weekly cold backup or invoke the DICOM Puller agent to fetch missing studies from modality storage.

#### D. Conquest Loss
- **Symptom**: Conquest service does not respond to C-ECHO port `5678`, or `dicom.ini` is missing.
- **Recovery Steps**:
  1. Verify the `dicom.ini` configuration file in `/volume1/docker/conquest/`.
  2. Restart the Conquest container.
  3. If storage index is corrupt, invoke Conquest's database rebuild utility to index the stored raw `.dcm` files:
     ```bash
     docker exec -it conquest regindex
     ```

#### E. ERP Container Loss
- **Symptom**: Node API server stops responding, logs show `process exited with status 1`, or Vite index is unreachable.
- **Recovery Steps**:
  1. Pull the latest repository snapshot: `git pull origin production`.
  2. Rebuild the application package: `pnpm run build`.
  3. Redeploy using Docker Compose:
     ```bash
     docker-compose down && docker-compose up -d --build
     ```

#### F. Cloudflare Outage
- **Symptom**: External portal displays `502 Bad Gateway` or `Cloudflare Tunnel offline`. Local client operations (inside the clinic LAN) remain functional.
- **Recovery Steps**:
  1. Radiologists inside the clinic bypass Cloudflare and connect directly to the local LAN IP address of Nginx (e.g. `http://192.168.1.100:80`).
  2. Check the tunnel daemon logs: `docker logs cloudflared`.
  3. Re-authenticate or restart the tunnel service: `docker restart cloudflared`.

#### G. OHIF / Weasis Failure
- **Symptom**: Viewers display "Study not found" or Weasis desktop links do not launch.
- **Recovery Steps**:
  - **OHIF**: Inspect the `/ohif/` proxy configurations in Nginx. Verify that the WADO-RS JSON metadata endpoint is returning correct study tags from Orthanc.
  - **Weasis**: Prompt the user to reinstall the Weasis desktop app to re-register the `weasis://` URL protocol handler on the workstation client.

#### H. Docker Corruption
- **Symptom**: Docker daemon is unresponsive, container volumes refuse to mount, or kernel panels hang.
- **Recovery Steps**:
  1. Restart Synology Container Manager or restart the Docker daemon:
     ```bash
     synoservice --restart pkgctl-Docker
     ```
  2. If the Docker storage driver is corrupted, purge Docker system state:
     ```bash
     docker system prune -a --volumes
     ```
  3. Redeploy the containers using Compose.

#### I. Power Failure
- **Symptom**: Total blackout at the clinic.
- **Recovery Steps**:
  1. Ensure the Synology NAS is connected to a smart UPS (Uninterruptible Power Supply) via USB.
  2. Configure DSM settings: **Control Panel > Hardware & Power > UPS** to auto-enter **Safe Mode** when battery is low, preventing hard drive file corruption.
  3. Once grid power is restored, configure the NAS to **Restart automatically after a power failure**, which auto-boots Nginx, Postgres, and the PACS.

---

## 3. Single Points of Failure (SPOF)

1. **Single Synology Hardware Device**: If the physical DiskStation motherboard fails, the entire clinic pipeline is disabled.
2. **On-Premise Internet Upload Bandwidth**: Online booking portals and teleradiology uploads depend heavily on the local clinic's internet connection.
3. **Unencrypted Database Dumps**: Locally generated daily backup dumps are stored in plaintext. If the NAS is physically stolen, patient data is exposed.

---

## 4. Recommended Hardening Improvements

- [ ] **Dual-NAS High Availability**: Implement Synology High Availability (SHA) clustering with two active-passive NAS units for real-time automatic failover.
- [ ] **Backup Encryption**: Modify the backup execution scripts to zip and encrypt database dumps using a secure AES-256 key before saving to DiskStation volumes:
  ```bash
  pg_dump -U erp diagnostic_erp | gpg --symmetric --cipher-algo AES256 --passphrase-file /etc/backup_key.txt > db_backup.sql.gpg
  ```
- [ ] **Automated Restore Testing**: Set up a weekly CI cron task that automatically downloads the latest backup dump and restores it to a sandbox testing container to confirm zero SQL dump corruption.
- [ ] **Dual WAN Failover Router**: Install a dual-WAN load balancer at the clinic routing local traffic over a backup 4G/5G connection during primary fiber line outages.
