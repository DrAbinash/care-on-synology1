# EMER_SOP_001: Power & Internet Failure Emergency Protocols
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Establish backup routing, LAN fallback, and physical recovery guidelines during power grid failure or ISP internet outages.
*   **Scope**: Entire clinic LAN infrastructure and external cloud tunnels.
*   **Responsibility**: IT Support staff, Duty Officers, and Lobby Managers.

---

## 2. Step-by-Step Emergency Procedures

### A. Power Failure (Grid Outage)
1.  **Immediate UPS Check**: Verify that the primary Synology NAS, main switches, and routers are running on the Uninterruptible Power Supply (UPS).
2.  **Orderly Shutdown (If outage > 15 min)**:
    *   If grid power is not restored within 15 minutes, access DSM (Synology Control Panel > Hardware & Power > UPS) and verify the NAS has automatically entered **Safe Mode** to protect RAID volumes.
    *   Do NOT attempt to force reboot the NAS until grid power is stable.
3.  **Restoration**:
    *   Once power is restored, verify the NAS restarts automatically.
    *   Confirm that Nginx, PostgreSQL, and Orthanc containers boot successfully:
        ```bash
        docker ps
        ```

### B. Internet / ISP Failure
1.  **LAN Mode Activation**:
    *   Workstations inside the clinic do NOT require active internet to access the ERP.
    *   Instruct staff to bypass the public URL (`caredeoghar.com`) and access the server directly via local LAN IP:
        ```
        Staff ERP: http://192.168.1.137:8888/erp/
        ```
2.  **WAN Failover**:
    *   If external access (online bookings, teleradiologist access) is critical, activate the backup 4G/5G WAN gateway router.
    *   Verify the Cloudflare Tunnel container automatically reconnects on the backup WAN interface.
3.  **Teleradiology Fallback**:
    *   If internet cannot be restored, export DICOM studies onto USB media and transport them physically, or route scans over the backup mobile hotspot network profile.

---

## 3. ERP Modules & Screens Affected
*   **Public Online Portal**: Unreachable during WAN outage.
*   **Local ERP Front Desk**: Fully operational over LAN.

---

## 4. Troubleshooting Checklist
- [ ] UPS battery levels verified above 50%.
- [ ] Direct LAN ping to `192.168.1.137` is successful.
- [ ] Cloudflared docker status is `running`.

---

## 5. Escalation Path
1.  **Level 1**: IT Support Technician (on-site).
2.  **Level 2**: Internet Service Provider (ISP) Support Hotline.
3.  **Level 3**: IT Administrator (for NAS shutdown overrides).

---

## 6. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
