# ACC_SOP_001: General Ledger, Vouchers & Closing Procedures
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Define standard accounting verification procedures, ledger reconciliation rules, and closing runbooks.
*   **Scope**: Accounting department, Finance operations, and Executive audits.
*   **Responsibility**: Cashiers, Staff Accountants, and Chief Financial Officer (CFO).

---

## 2. Step-by-Step Financial Workflows

### A. General Ledger & Double-Entry Verification
1.  All financial transactions are wired in the ERP backend to auto-generate vouchers:
    *   **Receipts Voucher (RV)**: Generated on patient payments.
    *   **Payment Voucher (PV)**: Generated on refunds, cancellations, and expenses.
2.  Open the **Vouchers** screen inside the ERP Accounting module.
3.  Filter by date and verify that for every voucher, the total Debits match total Credits (balance difference = 0).
4.  Open the **Doctor Ledger** and **Referral Ledger** to review calculated commission settlements.

### B. Daily Shift / Cash Closing
1.  Perform the shift close procedures on **My Daily Summary** (as per [ROLE_SOP_001_CASHIER.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/03_Role_Based_SOPs/ROLE_SOP_001_CASHIER.md)).
2.  Verify that all gateway settlements show `matched` inside the reconciliation tables.
3.  If any pending webhooks exist, click **Force Reconcile** to pull latest payment status.
4.  Freeze the daily ledger.

### C. Monthly Close & Tally Export
1.  Verify that no pending/partial bills show mathematical drifts:
    *   Run the Books Sanity check tool inside the Super Admin panel (`/api/books-sanity`).
    *   If any drifts are flagged, execute the automated backfill repair API:
        ```
        POST /api/books-sanity/run-backfill?confirm=true
        ```
2.  Open the **Tally Export** screen.
3.  Select the completed month date range.
4.  Click **Export XML**.
5.  Load the generated XML file into Tally ERP/Prime to import the vouchers into your primary financial system of record.

---

## 3. Reference to Financial Invariant Rules
For details on balance formulas, change logs, and database tables subject to the financial lock policy, refer to:
*   **[FINANCIAL_FREEZE_RULEBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINANCIAL_FREEZE_RULEBOOK.md)**
*   **[ACCOUNTING_PROTECTED_FILES.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/ACCOUNTING_PROTECTED_FILES.md)**

---

## 4. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
