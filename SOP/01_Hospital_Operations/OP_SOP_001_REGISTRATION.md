# OP_SOP_001: Patient Registration & Booking Workflow
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Standardize the intake of patients to ensure correct spelling, unique patient records, and proper scheduling metadata in the ERP database.
*   **Scope**: Front-desk reception, self-service kiosks, and online booking imports.
*   **Responsibility**: Front Desk Executives, Kiosk Supervisors, and Registrars.

---

## 2. Step-by-Step Workflow

### A. Reception Desk Walk-In Registration
1.  Ask the patient if they have visited Care Diagnostics before.
2.  If **YES**, search by Phone Number or Patient Name inside the **Patient Directory** screen. Do NOT create a new record.
3.  If **NO**, open the **Add Patient** screen:
    *   Verify spelling matching their national ID card.
    *   Enter primary Mobile Number (10 digits).
    *   Enter Date of Birth (ensure accuracy for pediatric/geriatric discount checking).
    *   Select Gender and Referral Doctor (if any).
4.  Submit to save the patient record. A unique Patient ID (e.g. `PAT-XXXX`) is automatically generated.
5.  Assign the patient to the requested diagnostic category (OPD, Pathology, USG, CT, etc.) and create a new **Bill**.

### B. Online Booking Import
1.  Open the **Online Bookings** dashboard in the ERP.
2.  Review pending requests from the online portal (`caredeoghar.com`).
3.  Cross-reference the booking with available slots in the Queue Management console.
4.  Verify that the online payment transaction shows `paid` (ICICI/HDFC gateway webhook verification).
5.  Click **Approve Booking**. The patient record is automatically created or matched, and the bill is generated.

---

## 3. ERP Modules & Screens Involved
*   **Patient Directory Screen**: `http://<local-ip>:8888/erp/patients`
*   **Add Patient Dialog**: Click "Add Patient" on the Directory page.
*   **Online Bookings Desk**: `http://<local-ip>:8888/erp/bookings`

---

## 4. Common Errors & Troubleshooting

| Error | Cause | Corrective Action / Troubleshooting |
| :--- | :--- | :--- |
| **Duplicate Patient Record Created** | Staff failed to search the phone number prior to hitting "Add Patient". | Notify the Super Admin immediately to execute a database merge of the duplicate IDs. |
| **Online Booking webhook pending** | Patient paid online but internet drop interrupted S2S callback. | Open **Gateway Reconciliation Desk**, locate the Booking Reference, and click **Force Reconcile** to query ICICI. |

---

## 5. Escalation Path
1.  **Level 1**: Kiosk Supervisor (for operational issues).
2.  **Level 2**: IT Administrator (for billing desk sync errors or network timeouts).
3.  **Level 3**: Super Admin (for patient ID merges and database edits).

---

## 6. Daily Checklist
- [ ] Kiosk screen is wiped clean and calibrated.
- [ ] Search phone number first before adding a new patient record.
- [ ] Confirm referral doctor spelling matches the reference list.

---

## 7. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
