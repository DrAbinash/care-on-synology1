# OP_SOP_002: Billing Desk & Discount Approvals
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Establish rigorous guidelines for generating bills, handling payments, processing corporate/insurance tie-ups, and managing staff discount limits in the ERP.
*   **Scope**: Front office billing desk, Cashier cabin, and Finance department.
*   **Responsibility**: Billing Clerks, Cashiers, and Finance Manager.

---

## 2. Step-by-Step Workflow

### A. Billing Desk Operation
1.  Search and select the patient from the **Patient Directory**.
2.  Click **New Bill**. Select the tests/procedures requested by the physician.
3.  The ERP automatically computes subtotal and applicable taxes.
4.  **Discount Application**:
    *   If no discount is requested, proceed to payment.
    *   If a discount is required, select a reason from the **Discount Reasons** dropdown (e.g., "Physician Referral", "Staff Relative", "EWS").
    *   Enter the discount amount. The ERP will validate the amount against the billing staff's max allowed discount percentage.
    *   If it exceeds the staff's limit, the ERP blocks the save. Promptly request a supervisor or admin to apply their credentials.
5.  Save the Bill. It is marked as `pending`.

### B. Payment Collection & Cashier Settlement
1.  Open the **Billing Desk** screen and locate the pending bill.
2.  Ask the patient for their payment method: **Cash**, **Card**, or **Online (QR)**.
3.  If **Cash**: Collect the amount, place it in the cash drawer, and click **Record Payment** in the ERP.
4.  If **Online (QR)**: Open the UPI dynamic QR screen, wait for the patient to pay. The ICICI/HDFC webhook will auto-reconcile. Once verification shows successful, print the receipt.
5.  Verify the Invoice status is updated to `paid` or `partial`.
6.  The ERP automatically generates a corresponding Receipts Voucher (RV).

---

## 3. ERP Modules & Screens Involved
*   **Billing Dashboard**: `http://<local-ip>:8888/erp/billing`
*   **Collect Payment Modal**: "Collect Payment" button inside the invoice view.
*   **Discount Approvals**: "Admin Override" dialog when applying discounts above limits.

---

## 4. Common Errors & Troubleshooting

| Error | Cause | Corrective Action / Troubleshooting |
| :--- | :--- | :--- |
| **Max Discount Blocked** | Applied discount exceeds the login user's profile limit. | Ask the Shift Admin to override or enter supervisor PIN. |
| **Outstanding Mismatch** | A refunded bill shows the old balance. | The forensic consistency patch is active. Ensure you did not change any formulas. If balance does not update, run Books Sanity Check (`/api/books-sanity`). |

---

## 5. Escalation Path
1.  **Level 1**: Cashier Supervisor.
2.  **Level 2**: Accountant (for financial ledger discrepancies).
3.  **Level 3**: IT Administrator (for hardware printer/scanner or POS terminal issues).

---

## 6. Daily Checklist
- [ ] Log out of the billing screen at the end of the shift.
- [ ] Verify cashier drawer opening balance matches cash-in-hand.
- [ ] Confirm all UPI QR receipts match the daily collection logs in the gateway portal.

---

## 7. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
