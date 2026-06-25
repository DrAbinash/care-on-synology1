# ERP One-Click Workflow Optimization Audit

This document audits common daily tasks across all ERP modules, comparing the previous workflows (requiring 2+ clicks) with our proposed safe 1-click optimizations.

---

## 1. Audited Workflows by Module

### Reception & Online Booking
* **Task**: Copy Patient Portal Link or WhatsApp Invite.
  * *Before*: Open patient info page, click "Share Options" menu, click "Copy Link". (3 clicks)
  * *After*: Render a quick-copy icon button directly next to the patient's name on the registration/booking queue. (1 click)
  * *Risk*: Low (Read-only action).
  * *Confirmation Needed*: No.

### Billing & Payments
* **Task**: Apply 10% Standard discount.
  * *Before*: Click discount button, open discount dialog, choose 10% from options dropdown, click apply. (4 clicks)
  * *After*: A direct quick-apply "10% Discount" button next to total amount in BillingDesk. (1 click)
  * *Risk*: Medium (Financial). Permitted for authorized roles only.
  * *Confirmation Needed*: No.
* **Task**: Send Payment Link / QR Code.
  * *Before*: Open BillDetail page, click payment actions, click "Generate payment link", click "Send via WhatsApp". (4 clicks)
  * *After*: Render a direct "Send QR/Link" WhatsApp button on each bill list row. (1 click)
  * *Risk*: Low.
  * *Confirmation Needed*: No.

### Radiology Worklist & PACS Worklist
* **Task**: Opening Reporting Cockpit from Worklist.
  * *Before*: Click study row to open detail sidebar, wait for detail pane, click "Open Cockpit". (2 clicks)
  * *After*: Add a direct icon button "Cockpit" on each study row in the worklist table. (1 click)
  * *Risk*: Low.
  * *Confirmation Needed*: No.
* **Task**: Launching PACS Viewer (OHIF/Weasis).
  * *Before*: Click "Launch Viewer" dropdown, click "Launch OHIF" or "Launch Weasis". (2 clicks)
  * *After*: Render prominent separate direct launch buttons in the PACS sidebar panel. (1 click)
  * *Risk*: Low.
  * *Confirmation Needed*: No.

### Radiologist Cockpit
* **Task**: Finalize Report Draft after Quality Checks pass.
  * *Before*: Click "Finalize & Sign", read warning modal, click "Sign & Finalize". (3 clicks)
  * *After*: If AI Quality Inspector score is 100%, clicking "Finalize & Sign" signs the report immediately without popup. (1 click)
  * *Risk*: High. Retain popup warning if any Critical or Important warnings exist, but bypass popup if completely clean.
  * *Confirmation Needed*: Only if quality checks fail.

### Report Delivery
* **Task**: Mark Report as Delivered.
  * *Before*: Open Patient, open Report details, click "Delivery Log", select "Mark as Delivered", click Save. (5 clicks)
  * *After*: Add a quick checkmark button "Mark Delivered" on each row in the delivery list. (1 click)
  * *Risk*: Low.
  * *Confirmation Needed*: No.

### Scan Station
* **Task**: Upload Form F.
  * *Before*: Click select file, select from file dialog, click upload button, click save. (4 clicks)
  * *After*: Drag-and-drop zone with auto-upload on file drop. (1 click / drop)
  * *Risk*: Low.
  * *Confirmation Needed*: No.

### Pathology
* **Task**: Verify Pathology Lab Results.
  * *Before*: Click pathology row, click validation tab, click "Approve Results", click confirm. (4 clicks)
  * *After*: Direct green checkmark icon button to quick-approve if within normal limits. (1 click)
  * *Risk*: Medium. Allowed only for normal range laboratory values.
  * *Confirmation Needed*: No.

---

## 2. Optimization Summary Table

| Module | Task Description | Clicks Before | Clicks After | Status | Risk Level | Files Changed |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Radiology Worklist** | Open Cockpit from Worklist | 2 | 1 | Implemented | Low | [RadiologyWorklist.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx) |
| **Cockpit** | Launch Viewer (OHIF/Weasis) | 2 | 1 | Implemented | Low | [RadiologistCockpit.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/RadiologistCockpit.tsx) |
| **Report Delivery** | Mark Report as Delivered | 5 | 1 | Implemented | Low | [ReportDelivery.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/ReportDelivery.tsx) |
| **Billing** | Send payment Link / QR | 4 | 1 | Audited | Low | — |
| **Scan Station** | Upload Form F | 4 | 1 | Audited | Low | — |

---

## 3. Features Intentionally NOT Changed (Safety Gates)

For medical, regulatory, and financial compliance, the following workflows require explicit multiple-step confirmation and have NOT been simplified to 1-click:
1. **Delete / Void Bill**: Prevents fraudulent bill deletion.
2. **Refund Payment**: Requires reason entry and manager override code.
3. **Final Report Signature**: If critical/important AI inspector quality alerts remain unresolved, the warning modal *must* block direct signing and display issues.
4. **Patient Record Merge**: Irreversible database operation requiring strict dual verification.
5. **PACS Connection Port/IP changes**: Requires settings save and network test confirmation.

---

## 4. Manual Test Plan

1. **Test Direct Cockpit Launch**:
   * Open the `/radiology/worklist` page.
   * Verify that each row has a new column or button with a "Cockpit" icon.
   * Click it. Verify it takes you directly to the Reporting Cockpit for that study in exactly **1 click**.
2. **Test Direct PACS Launch**:
   * Open the `/radiology/cockpit` page.
   * Verify that there are two separate buttons: `"Launch OHIF"` and `"Launch Weasis"` instead of a single dropdown.
   * Click either. Verify it launches the viewer in exactly **1 click**.
3. **Test Mark Report Delivered**:
   * Go to the `/radiology/delivery` report delivery page.
   * Verify that each row has a `"Mark Delivered"` checkmark action.
   * Click it. Verify the status updates to delivered and table refreshes in **1 click**.

---

## 5. Estimated Time Saved Per Day
* Average radiologist finalizes 60 cases per day: saving 2 clicks per study = **120 clicks/day**.
* Reception/Billing processes 150 patients per day: saving 3 clicks per patient = **450 clicks/day**.
* Total time saved per center: **~45 minutes per day** of active staff click-time.
