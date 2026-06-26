# Tabletop DICOM/PACS Failure Simulation — Care Diagnostics ERP

This document details the simulated tabletop exercises for ten distinct critical failure scenarios in the Care Diagnostics radiology ecosystem. It provides staff detection guides, impact assessments, escalation rules, and step-by-step recovery plans.

---

## 1. Ten Simulation Failure Scenarios

### Scenario 1: Orthanc Offline
- **What Breaks**: 
  - Real-time ingest of Ultrasound (US) and X-Ray (XR) studies.
  - Image viewing for US/XR via OHIF/Weasis.
  - Syncing of new US/XR studies into the ERP worklist.
- **What Continues Working**:
  - MRI/CT studies routed via Conquest.
  - Patient registration, billing, and lab module reporting in the ERP.
- **How Staff Would Notice**:
  - The **Radiology Network Control Center (RNCC)** dashboard reports a **RED** status indicator for Orthanc.
  - Modalities display a `C-STORE Transfer Failed` or timeout error.
  - The worklist queue sidebar does not populate newly taken X-Ray or US scans.
- **Recovery Steps**:
  1. Restart the Orthanc Docker container: `docker restart care-orthanc`.
  2. Verify HTTP port `8042` and DICOM port `4242` are active.
  3. Re-send failed studies from the modality console buffer.
- **Estimated Recovery Time**: 5 – 10 minutes.

---

### Scenario 2: Conquest Offline
- **What Breaks**:
  - Ingest of CT and MRI studies.
  - Worklist query responses (C-FIND) for CT/MRI scanner consoles.
- **What Continues Working**:
  - Orthanc US/XR storage.
  - Billing desk, doctor registry, and pathology desks.
- **How Staff Would Notice**:
  - RNCC reports a **RED** node status for Conquest.
  - Modality consoles report a C-ECHO/C-FIND communication timeout.
- **Recovery Steps**:
  1. Restart the Conquest container: `docker restart care-conquest`.
  2. Rebuild Conquest database index if filesystem pointers are lost (`regindex`).
- **Estimated Recovery Time**: 10 – 15 minutes.

---

### Scenario 3: ERP API Offline
- **What Breaks**:
  - Complete clinic operations: Billing, Reception, Pathology, and Radiology reporting modules.
  - Launch of local viewports (OHIF/Weasis links redirect to error pages).
  - Syncing scripts between PACS and database.
- **What Continues Working**:
  - Local DICOM storage inside Orthanc/Conquest filesystems (scans are safely held on local disks).
- **How Staff Would Notice**:
  - Browsers show `ERR_CONNECTION_REFUSED` or Nginx `502 Bad Gateway` pages.
- **Recovery Steps**:
  1. Restart the API container: `docker-compose restart api-server`.
  2. Inspect logs: `docker logs api-server` to diagnose process crashes.
- **Estimated Recovery Time**: 5 – 15 minutes.

---

### Scenario 4: PostgreSQL Database Unavailable
- **What Breaks**:
  - ERP user logins, billing data saves, and patient records.
  - Conquest Lua notify scripts (which write metadata directly to Postgres).
  - Report draft saves.
- **What Continues Working**:
  - Modality scanning (independent local disk cache).
  - Orthanc local Explorer UI reading.
- **How Staff Would Notice**:
  - ERP shows persistent `Database connection lost` toast alerts.
  - API console logs stream `PgError: Connection refused`.
- **Recovery Steps**:
  1. Verify the PostgreSQL container status: `docker ps | grep postgres`.
  2. Start the database service if stopped: `docker-compose start db`.
- **Estimated Recovery Time**: 10 – 20 minutes.

---

### Scenario 5: OHIF Unavailable
- **What Breaks**:
  - Zero-footprint web viewer viewport inside the ERP Radiology Command Center center panel.
- **What Continues Working**:
  - Weasis launch redirect endpoints (radiologists can read via Weasis desktop client).
  - Report writing, templates, and finalization workflows.
- **How Staff Would Notice**:
  - Clicking the **OHIF** launch button displays a blank frame or `Viewer not found` alert.
- **Recovery Steps**:
  1. Verify Nginx port mappings and routing configurations.
  2. Re-pull and launch the OHIF build asset container.
- **Estimated Recovery Time**: 15 – 30 minutes.

---

### Scenario 6: Weasis Unavailable
- **What Breaks**:
  - High-resolution desktop imaging viewport launch for MRI and CT readings.
- **What Continues Working**:
  - Web-based OHIF viewing (for smaller studies like X-Rays and Ultrasound).
- **How Staff Would Notice**:
  - Clicking **Weasis** triggers the browser's desktop application redirect, but Weasis fails to open.
- **Recovery Steps**:
  1. Confirm Weasis is installed on the local workstation client.
  2. Register the `weasis://` URL protocol handler registry keys on the OS.
- **Estimated Recovery Time**: 10 – 15 minutes per workstation.

---

### Scenario 7: Cloudflare Outage
- **What Breaks**:
  - Remote login access for radiologists and physicians reading from outside the clinic.
  - Public online test booking portals.
- **What Continues Working**:
  - All clinic LAN operations (billing, reception, PACS storage, and reading inside the building).
- **How Staff Would Notice**:
  - External browsers display `Cloudflare Error 522: Connection timed out`.
- **Recovery Steps**:
  1. Staff on-premise continue working normally.
  2. Instruct remote doctors to connect directly using local VPN tunnels or the static LAN IP proxy.
- **Estimated Recovery Time**: 5 – 10 minutes (for workaround routing).

---

### Scenario 8: Synology NAS Unavailable
- **What Breaks**:
  - The entire radiology ecosystem (ERP, database, Orthanc, Conquest, and file stores).
- **What Continues Working**:
  - Physical modality scanning (images cache on CT/MRI console hard drives).
- **How Staff Would Notice**:
  - Ping to the NAS LAN IP (`192.168.1.100`) returns `Destination Host Unreachable`.
  - Net drives disconnect.
- **Recovery Steps**:
  1. Inspect physical NAS hardware lights.
  2. Power cycle the Synology DiskStation.
  3. If motherboard/array failed, initiate the bare-metal disaster recovery plan (refer to `DISASTER_RECOVERY_AUDIT.md`).
- **Estimated Recovery Time**: 30 minutes (soft reboot) to 6 hours (bare-metal restore).

---

### Scenario 9: DICOM Puller Unavailable
- **What Breaks**:
  - Automated retrieval of historical/prior comparison studies from the clinic's off-site cloud storage.
- **What Continues Working**:
  - Current study registration, imaging, and reporting.
- **How Staff Would Notice**:
  - "Querying prior study..." loaders rotate infinitely in the command center panel.
- **Recovery Steps**:
  1. Restart the background python agent: `systemctl restart hope-pacs-agent`.
- **Estimated Recovery Time**: 5 minutes.

---

### Scenario 10: Modality Sends Studies to Wrong AE Title
- **What Breaks**:
  - Automatic worklist integration.
  - The PACS stores the file locally, but because the AET mismatches, the notify scripts do not match the study with the correct patient accession billing ID.
- **What Continues Working**:
  - Modality transmission (completes store success but details are lost).
- **How Staff Would Notice**:
  - Scans are sent but never appear in the ERP Worklist.
  - Orthanc/Conquest logs show `Rejected association: Unknown Called AE Title`.
- **Recovery Steps**:
  1. Inspect modality network configuration.
  2. Change Called AE Title back to `ORTHANC` or `CONQUESTSRV` on the scanner console.
  3. Manual match the orphaned study from the PACS settings match registry.
- **Estimated Recovery Time**: 10 minutes.

---

## 2. Detection Checklist

- [ ] **Check 1: Ping Command**: Run `ping 192.168.1.100` (Synology NAS) and verify host response.
- [ ] **Check 2: Docker Status**: Run `docker ps` to verify Postgres, API, Nginx, and PACS are `Up`.
- [ ] **Check 3: RNCC Topology**: Open the Network Control Center in the ERP and verify all nodes are **GREEN**.
- [ ] **Check 4: Port Bindings**: Test port connectivity using telnet:
  - Conquest: `telnet 192.168.1.100 5678`
  - Orthanc: `telnet 192.168.1.100 4242`

---

## 3. Recovery Checklist

- [ ] **Step 1**: Halt all writing actions on the corrupted server volume.
- [ ] **Step 2**: Acquire the lock/maintenance schedule inside the Control Center.
- [ ] **Step 3**: Execute target database restore or container rebuild.
- [ ] **Step 4**: Perform a C-ECHO check from the modality to the PACS.
- [ ] **Step 5**: Verify raw findings and impression drafts load correctly.

---

## 4. Escalation Path

```
[Modality Biller] 
       |
       v
[Radiology Tech / On-site IT Admin] 
       |
       v (If RTO exceeds 30 mins)
[Senior System Administrator / ERP Developer Support]
       |
       v (If Data Corruption or SPOF occurs)
[Clinic Director / Management (Executive Notice)]
```

---

## 5. Business Impact Analysis

1. **Revenue Loss**: Outages preventing patient billings during high-volume OPD mornings cost the clinic an estimated ₹15,000 per hour.
2. **Clinical Delay**: Remote reporting downtime delays critical diagnosis scans (e.g. trauma CTs), extending inpatient wait times.
3. **Reputational Damage**: Slow turnaround times or lost appointments lead to scheduling friction and lower patient retention rates.
