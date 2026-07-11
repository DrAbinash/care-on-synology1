# Disaster Recovery & Business Continuity Audit
## Care Diagnostics ERP Production Readiness

This audit analyzes the disaster recovery (DR) preparedness, infrastructure dependencies, backup catalog, and recovery runbooks for **Care Diagnostics ERP** under a complete host failure scenario (motherboard failure, disk crash, RAID corruption, ransomware, etc.) on the primary Synology NAS.

---

## Phase 1 — Complete Infrastructure Inventory

In a production hospital environment, the Care Diagnostics ecosystem comprises multiple interconnected software and hardware layers:

```mermaid
graph TD
    classDef external fill:#f9f,stroke:#333,stroke-width:2px;
    classDef client fill:#bbf,stroke:#333,stroke-width:2px;
    classDef nas fill:#dfd,stroke:#333,stroke-width:2px;

    %% Modalities and LAN Clients
    Mod CT/MRI/USG:::external -->|DIMSE C-STORE/C-FIND| Conquest[Conquest PACS Container]
    Conquest -->|DICOM Route| Orthanc[Orthanc PACS Container]
    Bridge[Local Windows DICOM Bridge]:::client -->|DIMSE C-MOVE/C-FIND| Mod
    Bridge -->|HTTPS Poll/Push| ERP_API[Care ERP API Container]

    %% NAS Infrastructure Stack
    subgraph Synology NAS LAN Subnet: 192.168.1.0/24
        ERP_Web[Care ERP Web Container]:::nas -->|Proxy Requests| ERP_API
        ERP_API -->|Query/Write| PG[PostgreSQL 16 DB Container]
        Orthanc -->|WADO/WADO-RS| OHIF[OHIF Web Viewer]
        Orthanc -->|WADO/Local Launch| Weasis[Weasis Desktop Launcher]
    end

    %% Cloud Routing and External access
    CloudTunnel[Cloudflare Tunnel]:::external <-->|Secure Ingress| ERP_Web
    Tailscale[Tailscale VPN]:::external <-->|Direct LAN Access| ERP_API
    External_Client[Teleradiologist / Online Booking]:::client <-->|HTTPS| CloudTunnel
    Internal_Workstation[Clinic Desktop / Diagnostic Console]:::client <-->|Local IP / Tailscale| ERP_Web
```

### Dependency Catalog & Infrastructure Impact

| Component | Host / Location | Primary Role | Down-time Impact on Clinical Workflow |
| :--- | :--- | :--- | :--- |
| **ERP Web (`care-web`)** | Docker on Synology | Serves the React frontend application over Nginx (Port `8888`/`80`). | **CRITICAL**: Staff cannot register patients, view lists, billing, or launch reports. |
| **ERP API (`care-api`)** | Docker on Synology | Runs Express backend Node.js server (Port `8080`), processes business logic. | **CRITICAL**: Complete backend breakdown. Frontend and billing APIs will fail. |
| **PostgreSQL DB (`db`)** | Docker on Synology | PostgreSQL 16 database storing patient details, bills, ledger vouchers, and user sessions. | **CRITICAL**: No patient registration, reports saving, or financial operations. |
| **Orthanc PACS** | Docker on Synology | Acts as the primary active DICOM archive storing clinical USG, X-Ray, CT, MRI images. | **HIGH**: Doctors cannot load scans into OHIF viewer; report dictation halts. |
| **OHIF Web Viewer** | Docker on Synology | Web-based diagnostic viewer integrated into the reporting dashboard. | **HIGH**: Radiologists cannot read scans online. |
| **Weasis Viewer** | Local Workstations | Desktop-native DICOM viewer launched via protocol handler `weasis://`. | **MEDIUM**: Fallback for radiologists if OHIF fails or for complex multi-planar reconstruction. |
| **Conquest PACS** | Docker on Synology | Raw DICOM ingestion gateway, receives pushes directly from imaging modalities. | **HIGH**: DICOM files cannot be sent from machines to the PACS pipeline. |
| **Cloudflare Tunnel** | Docker on Synology | Bridges the local ERP port to the public internet securely (`caredeoghar.com`). | **MEDIUM**: Breaks external online bookings, SMS links, and off-site teleradiology. LAN works. |
| **Tailscale** | Synology DSM / Docker | Provides secure, encrypted peer-to-peer overlay network for remote doctor access. | **MEDIUM**: Remote reporting radiologists cannot access local PACS streams. |
| **Local Windows DICOM Bridge** | Dedicated Workstation PC | Polls ERP and executes `C-FIND`/`C-MOVE` on private modality networks (`172.16.1.x`). | **HIGH**: Auto-ingestion of modality scans halts; manual PACS upload required. |
| **Physical Modalities** | Clinic Exam Rooms | Ultrasound (USG), X-Ray, CT, MRI machines generating raw DICOM files. | **CRITICAL**: Physical patient scanning stops (outside ERP control). |

---

## Phase 2 — Backup Catalog Audit

An audit of the backup structure reveals critical architectural vulnerabilities regarding storage locations and recovery pipelines.

### Active Backup Inventory

| Backup Target | Generation Method | Frequency | Storage Location | Off-site Replication | Encrypted? | Verified? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL Database** | `pg_dump` via DSM task or `synology-backup.sh` | Daily at 03:00 IST | `/volume1/backups/caredeoghar/` (Local NAS) | **No** (Only local NAS and Replit pull) | **No** (Stored in plaintext SQL/GZ) | **No** (No automated restore checks) |
| **Orthanc DICOM Binaries** | File system level sync of `/volume1/docker/orthanc/db/` | Weekly (Manual) | External cold-storage drive | **No** | **No** (Plain DICOM files) | **No** (Manual check only) |
| **Conquest DICOM Files** | Persistent database index `/volume1/docker/conquest/data/` | None (Relies on raw storage) | Local NAS volume | **No** | **No** | **No** |
| **Local Bridge Config** | File-based `.env` on local Windows PC | None (One-time setup) | Local Workstation PC disk | **No** | **No** | **No** |
| **Cloudflare/Tailscale Keys**| Config files / Tunnel JSON credentials | None (Created once) | `/volume1/docker/` config folders | **No** | **No** | **No** |

### Critical Backup Catalog Findings:
1. **Single Disk Volatility**: The daily database backups (`.sql.gz`) are written directly to `/volume1/backups/` on the **same physical Synology NAS** hosting the active database volume. In a chassis/motherboard/RAID controller failure, both the live DB and local backups are lost simultaneously.
2. **Lack of Encryption**: Storing plaintext `.sql` or `.sql.gz` backups on DiskStation volumes poses an immense HIPAA/DPCO data breach risk if the NAS is physically stolen from the clinic.
3. **No Automatic Restore Verification**: Backups are run blindly. There is no automated dry-run restoration checking to verify if dump files are corrupted or schema-incompatible.

---

## Phase 3 — Recovery Runbook Audit

### Scenario A: Synology NAS Motherboard Failure (RAID Disks Healthy)
*If the physical Synology NAS motherboard fails but the storage array (HDD/SSD RAID) is fully intact.*

#### 1. Hardware Swap & DSM Installation
1. Label all physical drives with their corresponding bay numbers (1 to N) to preserve the RAID order.
2. Procure an identical or compatible Synology NAS chassis (e.g., matching DSM version capability).
3. Insert the physical drives into the new NAS in the exact same bay order.
4. Power on the new NAS and connect to the local network. Open `find.synology.com` in a browser.
5. Select **Migration** when prompted by the DSM installation wizard (choose "Keep files and settings"). Do NOT choose "Clean Install".
6. Complete the setup and restore system settings.

#### 2. Service Verification
1. Open Synology **Container Manager** (Docker).
2. Because settings are preserved, the containers and volumes (`db_data`, `object_storage`) will map correctly.
3. Start the Docker stack via SSH or Container Manager UI:
   ```bash
   cd /volume1/care-diagnostics/
   docker-compose up -d
   ```
4. Verify application logs:
   ```bash
   docker logs care-api
   ```

---

### Scenario B: Entire NAS Stolen, Burned, or RAID Corrupted (Complete Bare Metal Restore)
*Total hardware failure where all live data and local backups are completely unrecoverable.*

#### 1. Bare Metal Environment Setup
1. Setup a fresh Synology NAS (or any Linux/Ubuntu server running Docker).
2. Install Git, Node.js (v18+), pnpm, and Docker:
   ```bash
   sudo apt update && sudo apt install -y git docker-compose nodejs npm
   sudo npm install -g pnpm
   ```
3. Clone the Care Diagnostics ERP codebase:
   ```bash
   git clone https://github.com/caredeoghar/caredeoghar.git /volume1/care-diagnostics
   cd /volume1/care-diagnostics
   ```

#### 2. Restoring the PostgreSQL Database
1. Locate the latest off-site backup (e.g., from Replit Sync API, email backups, or cold storage drive). Let's assume `care_db_daily_20260625.sql.gz`.
2. Extract the backup file:
   ```bash
   gunzip -k care_db_daily_20260625.sql.gz
   ```
3. Initialize the Docker stack to boot a clean Postgres database:
   ```bash
   docker-compose up -d db
   ```
4. Re-create the database instance:
   ```bash
   docker exec -it care-db psql -U erp -d postgres -c "DROP DATABASE IF EXISTS diagnostic_erp;"
   docker exec -it care-db psql -U erp -d postgres -c "CREATE DATABASE diagnostic_erp;"
   ```
5. Restore the schema and patient records:
   ```bash
   docker exec -i care-db psql -U erp -d diagnostic_erp < care_db_daily_20260625.sql
   ```

#### 3. Rebuilding the Docker Services
1. Set up the `.env` file by copying `.env.example` and filling in the credentials (e.g., `JWT_SECRET`, `SESSION_SECRET`, `ICICI_SECRET_KEY`).
2. Run database migrations to catch up any missing commits:
   ```bash
   pnpm install --frozen-lockfile
   pnpm db:deploy
   ```
3. Rebuild and launch the remaining web and api services:
   ```bash
   docker-compose up -d --build
   ```

#### 4. Re-mapping Orthanc PACS & Conquest
1. Deploy Orthanc using its native Docker compose file.
2. Orthanc's underlying SQLite file `/volume1/docker/orthanc/db/` must be restored from the weekly cold storage.
3. If no Orthanc cold storage is available, run the **DICOM Bridge Agent** to pull last 30 days of scans directly from physical modalities into Conquest, which auto-routes to Orthanc.

---

### Scenario C: Database Corruption (PostgreSQL Fails to Start or Files Corrupted)
*Logs show database corruption errors like `invalid page header` or `PANIC: could not locate a valid checkpoint record`.*

1. Stop the application API server to halt writes:
   ```bash
   docker stop care-api
   ```
2. Stop the PostgreSQL container and inspect the volume directory:
   ```bash
   docker stop care-db
   ```
3. If database filesystem corruption is confirmed, wipe the damaged PostgreSQL directory:
   ```bash
   docker volume rm caredeoghar_db_data
   ```
4. Restart PostgreSQL container to initialize a clean data volume:
   ```bash
   docker-compose up -d db
   ```
5. Verify PostgreSQL is healthy:
   ```bash
   docker exec -it care-db pg_isready -U erp -d diagnostic_erp
   ```
6. Restore the database from the last night's backup:
   ```bash
   gunzip -c /volume1/backups/caredeoghar/care_db_daily_20260625.sql.gz | docker exec -i care-db psql -U erp -d diagnostic_erp
   ```
7. Start the API container and run sanity checks:
   ```bash
   docker start care-api
   ```

---

### Scenario D: Orthanc Storage Database Index Corruption
*Orthanc runs but searches return no studies, throws internal SQLite errors, or UI hangs on loading PACS worklist.*

1. Stop the Orthanc container:
   ```bash
   docker-compose stop orthanc
   ```
2. Make a backup copy of the corrupted folder:
   ```bash
   mv /volume1/docker/orthanc/db /volume1/docker/orthanc/db_corrupted
   ```
3. Restore the SQLite database file (`orthanc.db`) and DICOM payload folder (`AnonymizedStore`) from the last cold storage snapshot.
4. If no snapshot is available, initialize a clean database structure:
   ```bash
   mkdir -p /volume1/docker/orthanc/db
   docker-compose start orthanc
   ```
5. Re-ingest the raw DICOM files stored under `/volume1/docker/conquest/data/` using Orthanc Import API:
   ```bash
   curl -X POST http://localhost:8042/tools/lookup --data-binary @/volume1/docker/conquest/data/...
   ```

---

### Scenario E: Windows DICOM Bridge Service Host Machine Fails
*The dedicated clinic PC running the Node.js bridge to ultrasound/CT fails to boot.*

1. Procure a replacement Windows PC inside the same LAN subnet.
2. Install **Node.js LTS (v18 or v20)**.
3. Clone or copy the `bridge-service` directory to `C:\DiagnoDicomBridge`.
4. Copy the last-known `.env` or create a new one:
   ```env
   ERP_BASE_URL=https://caredeoghar.com
   INTERNAL_API_KEY=your-shared-internal-api-key
   AGENT_ID=clinic-pc-01
   AGENT_AE_TITLE=DIAGNO_AGENT
   ```
5. Install dependencies and test run:
   ```powershell
   cd C:\DiagnoDicomBridge
   npm install
   node src/index.js
   ```
6. Setup automatic startup using NSSM (Non-Sucking Service Manager):
   ```powershell
   nssm install DiagnoDicomBridge "C:\Program Files\nodejs\node.exe" "C:\DiagnoDicomBridge\src\index.js"
   nssm set DiagnoDicomBridge AppDirectory C:\DiagnoDicomBridge
   nssm start DiagnoDicomBridge
   ```

---

## Phase 4 — Risk Matrix & Critical Recommendations

This matrix outlines the highest-impact architectural vulnerabilities in the Care Diagnostics disaster recovery setup and proposes concrete mitigations.

| Risk Level | Risk Description | Clinical / Operational Impact | Current Mitigation | Actionable Production Recommendation (The Fix) |
| :--- | :--- | :--- | :--- | :--- |
| 🔴 **CRITICAL** | **Single NAS Point of Failure (SPOF)**. Entire clinic runs on a single physical Synology DS923+. | If the NAS motherboard or power supply dies, all hospital services (Registration, Billing, PACS) stop. | None (Manual hardware swap only, RTO: 4-8 hrs). | **Deploy Dual-NAS Synology High Availability (SHA)** with active-passive automatic failover (RTO < 5 min). |
| 🔴 **CRITICAL** | **Backups on Same Disk Array**. Daily database dumps are stored on the same volume as the active database. | Ransomware or drive array failure will wipe out both the live database and all backups. | None. | **Replicate backups immediately to off-site cloud storage** (e.g., AWS S3 or Synology C2) with object locking enabled. |
| 🟡 **HIGH** | **Unencrypted Backups**. Database dumps containing sensitive patient data are stored in plaintext. | Physical theft of the NAS or backup drives results in a major HIPAA compliance breach. | None. | **Integrate AES-256 encryption** into the backup scripts (`gpg --symmetric`) before writing to disk. |
| 🟡 **HIGH** | **No Automated Backup Restoration Tests**. Backups are written but never verified for integrity. | Corrupted backup files may go unnoticed until a recovery attempt fails during a live disaster. | None. | **Implement a weekly automated cron job** that attempts to restore the backup in a sandbox container and logs success. |
| 🟢 **MEDIUM** | **Single Internet Connection (WAN)**. The Cloudflare Tunnel depends on a single ISP. | If the primary fiber line goes down, remote radiologists cannot read scans and online booking fails. | None (LAN works, but remote functions die). | **Implement a Multi-WAN failover router** at the clinic with a backup 4G/5G SIM card connection. |

### Top 5 Critical Vulnerabilities to Fix Immediately:
1. **Unreplicated Backups**: Backups must be copied off-site immediately.
2. **Missing Encryption**: Patient details in dumps must be AES-256 encrypted.
3. **Hardware Redundancy**: A single NAS represents a total shutdown vector.
4. **Lack of Automated Recovery Testing**: The team does not know if backups are valid.
5. **No Local Failover DNS**: If local internet is down, local DNS resolution configuration is needed so local workstations can hit the NAS IP directly without Cloudflare.

---

*Audit completed on: 26 June 2026 23:45 IST | Status: AUDIT COMPLETE — Production Readiness Action Required*
