# DEP_SOP_002: Lab & Pathology Workflows
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Define standard laboratory protocols for patient sample collection, barcoding, test processing, and report signatures in the ERP.
*   **Scope**: Pathology collection center, processing lab, and pathologist review console.
*   **Responsibility**: Phlebotomists, Lab Technicians, and Pathologists.

---

## 2. Step-by-Step Workflow

### A. Sample Collection & Barcoding
1.  Verify patient identity by asking their name and date of birth.
2.  Open the **Sample Collection Queue** in the ERP. Confirm the tests ordered match the prescription.
3.  Click **Collect Sample** in the ERP.
4.  The barcode printer will automatically print a label containing the Sample ID, Patient Name, and Test Code.
5.  Affix the barcode label securely onto the collection vial.
6.  Draw the blood/urine sample as per clinical protocol.
7.  Mark the sample status as **Collected** in the ERP.

### B. Lab Processing & Result Entry
1.  Transfer the barcoded vial to the processing lab.
2.  Load the sample into the analyzer.
3.  Once processing is complete, open the **Lab Results Entry** screen.
4.  Enter the numerical values for the test parameters (e.g., Hemoglobin, WBC, glucose).
5.  If the value falls outside the normal range, the ERP will automatically flag it as *high/low/critical*.
6.  Save the results. The status changes to **Pending Review**.

### C. Pathologist Verification & Signing
1.  The Pathologist logs into the **Pathology Dashboard**.
2.  Filter the worklist by "Pending Review".
3.  Review flagged parameter results and clinical notes.
4.  If correct, click **Approve & Digital Sign**.
5.  The ERP generates a PDF report containing the pathologist's digital signature and updates status to **Completed**.

---

## 3. ERP Modules & Screens Involved
*   **Sample Collection Dash**: `http://<local-ip>:8888/erp/pathology/collect`
*   **Results Entry Screen**: `http://<local-ip>:8888/erp/pathology/results`
*   **Pathology Review Console**: `http://<local-ip>:8888/erp/pathology/review`

---

## 4. Common Errors & Troubleshooting

| Error | Cause | Corrective Action / Troubleshooting |
| :--- | :--- | :--- |
| **Barcode Scan Mismatch** | Label smudge or printer alignment drift. | Print a replacement label using the "Re-print Barcode" button in the Patient profile. |
| **Flagged Critical Value Not Alerting** | Reference ranges in DB are misconfigured. | Notify the pathology supervisor to update reference templates inside settings. |

---

## 5. Escalation Path
1.  **Level 1**: Lab Supervisor.
2.  **Level 2**: Pathology Department Head.
3.  **Level 3**: IT Support (for database schema or digital signature sync issues).

---

## 6. Daily Checklist
- [ ] Calibrate lab analyzers before processing samples.
- [ ] Stock barcode label printer with correct size roll.
- [ ] Confirm digital signature certificate is loaded and valid.

---

## 7. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
