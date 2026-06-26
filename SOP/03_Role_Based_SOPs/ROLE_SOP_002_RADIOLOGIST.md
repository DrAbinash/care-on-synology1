# ROLE_SOP_002: Radiologist Workflow & Dashboard Controls
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Role Responsibilities
The Radiologist is responsible for reading medical scans (USG, CT, MRI, X-ray), dictating findings using the AI assistant, verifying reports, and signing off clinical studies.

---

## 2. Step-by-Step Daily Workflow

### A. Study Selection & Worklist Loading
1.  Log into the ERP and navigate to the **Radiology Worklist**.
2.  Filter the worklist by your assigned modality (e.g. "USG" or "CT").
3.  Select a study showing the status **Ready to Read** (indicates DICOM push is complete).
4.  Review patient history, previous reports, and referral notes.

### B. Launching the Viewer
1.  Click **Launch Viewer** (OHIF or Weasis).
2.  The system automatically adapters the viewer URL using the local network profile:
    *   If working inside the clinic: connects via LAN (`192.168.1.137`).
    *   If reading remotely: connects via Tailscale IP or Cloudflare tunnel.
3.  Examine the slices, utilize multi-planar reconstruction (MPR) tools if required, and note findings.

### C. Report Dictation & Generation
1.  Return to the **Radiology Dashboard** tab.
2.  Click **Create Report**.
3.  Select the corresponding template (e.g. "USG Abdomen Normal").
4.  Use **Voice Dictation** to enter clinical findings:
    *   Click the microphone icon.
    *   Dictate clearly. The AI transcriber will translate speech to text.
5.  Click **AI Assistant** to check for measurements or to request structured report formatting.
6.  Click **AI Inspector** to verify that findings do not conflict (e.g., mismatching lateralities).

### D. Digital Signing
1.  Click **Review Report**.
2.  If satisfied, click **Approve & Digital Sign**.
3.  The report PDF is instantly locked and published. Patients receive an SMS link automatically.

---

## 3. ERP Screens Used
*   **Radiology Dashboard**: `http://<local-ip>:8888/erp/radiology`
*   **OHIF Viewer**: Integrated via dynamic frame routing.

---

## 4. Common Errors & Troubleshooting

*   **Study shows "No Images"**: The technician failed to execute the C-STORE push from the modality console. Call the technician room.
*   **Voice dictation delayed**: Internet line drop is slowing API response. Switch to manual keyboard typing fallback.

---

## 5. Escalation Path
1.  **Level 1**: Chief Radiologist.
2.  **Level 2**: IT Helpdesk (for viewer launch errors).

---

## 6. Daily Checklist
- [ ] Network profile set correctly (LAN/Tailscale) before shift starts.
- [ ] Digital signature credential active.
- [ ] Verify patient details match the DICOM header tags before signing.

---

## 7. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
