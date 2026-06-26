# RAD_SOP_001: Radiology Modality Integration & Cockpit Workflow
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Define standard operating steps for patient routing, modality imaging processing, PACS ingestion, and reporting.
*   **Scope**: CT Scan, MRI, Ultrasound (USG), X-Ray, Mammography rooms, and Radiologist reporting desks.
*   **Responsibility**: Modality Technicians, PACS Administrators, and Radiologists.

---

## 2. Step-by-Step Clinical Workflow

### A. Patient Arrival & Modality Pre-flight
1.  Verify the patient's identity and match their billing receipt showing payment for the imaging procedure.
2.  Open the **Modality Worklist** in the ERP. Confirm the patient status is set to `ready`.
3.  Instruct the patient to prepare for the scan (e.g. changing into clinical gown, checking for metal objects in MRI).

### B. Image Acquisition & DICOM Push
1.  On the imaging machine console (USG, CT, MRI):
    *   Query the PACS Worklist via C-FIND.
    *   Select the matching patient ID and accession number. Do NOT type details manually to prevent name discrepancies.
2.  Perform the scan.
3.  Upon completion, select the acquired slices on the machine console and execute a **C-STORE Push** to the Conquest/Orthanc PACS gateway:
    *   Target AE Title: `CONQUEST1` or `ORTHANC`
    *   Port: `5678` or `4242`

### C. Radiologist Reading & Dictation
1.  The Radiologist opens the **Radiology Worklist** in the ERP.
2.  Locate the patient's record. If status is **Ready to Read**, click **Launch OHIF Viewer**.
3.  Perform diagnostic reading.
4.  Open the **Voice Dictation** panel, click the microphone, and speak the clinical findings.
5.  Click **AI Assistant** to check formatting and extract standard anatomical measurement templates.
6.  Click **AI Inspector** to scan for logical contradictions in laterality or anatomy.
7.  Click **Approve and Digital Sign**. The report PDF is generated and published.

---

## 3. Reference to PACS Documentation
For details on network profiles, local bridge service setup, and database mapping of PACS studies, refer to:
*   **[PACS_CURRENT_STATE_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/04_PACS_ORTHANC/PACS_CURRENT_STATE_REPORT.md)**
*   **[VIEWER_NETWORK_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/06_NETWORK/VIEWER_NETWORK_AUDIT.md)**

---

## 4. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
