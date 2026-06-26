# ROLE_SOP_001: Cashier Daily Operations & Closure
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Role Responsibilities
The Cashier is responsible for drawer reconciliations, collecting cash/digital payments, validating receipts, and closing the daily financial shift in the ERP.

---

## 2. Step-by-Step Daily Workflow

### A. Morning Opening (Shift Start)
1.  Arrive 15 minutes before the front desk opens.
2.  Log into the ERP using your personal cashier credentials.
3.  Count the physical cash float (opening balance) in the drawer.
4.  Enter the opening balance into the **My Daily Summary** screen.
5.  Confirm the drawer status is set to **Open**.

### B. Mid-Day Transactions
1.  Collect cash/digital payments for walk-ins and referrals.
2.  Always verify payments in the ERP before printing the final receipt.
3.  For UPI payments, confirm the transaction status shows success in the ICICI/HDFC gateway dashboard.
4.  Do NOT keep loose change on the counter; immediately file cash into the drop box.

### C. Evening Shift Closing
1.  At the end of the shift, open the **My Daily Summary** screen.
2.  Count the physical cash, card receipts, and digital transaction logs.
3.  Enter the physical cash count in the "Actual Cash" field.
4.  The ERP will compute the drift:
    $$\text{drift} = \text{Actual Cash} - \text{Expected Cash}$$
5.  If there is a drift:
    *   Re-count the cash.
    *   Verify all manual payment logs are entered.
    *   If drift remains, document the reason in the closing notes (e.g. "₹10 short change given").
6.  Click **Submit Day Close**. This freezes the cashier ledger for the day.

---

## 3. ERP Screens Used
*   **My Daily Summary**: `http://<local-ip>:8888/erp/my-daily-summary`
*   **Cash Desk Console**: `http://<local-ip>:8888/erp/billing/collect`

---

## 4. Common Mistakes & Troubleshooting

*   **Expected cash does not match**: Check if cash was refunded but not recorded in the ERP under "/refund". All refunds must be entered.
*   **Failed transaction logged as paid**: If a card payment failed but was recorded as paid in the ERP, immediately perform a payment correction transaction under billing admin options to void the payment entry.

---

## 5. Escalation Path
1.  **Level 1**: Chief Accountant (for cash variances > ₹100).
2.  **Level 2**: Finance Director (for system-wide transaction mismatches).

---

## 6. Daily Checklist
- [ ] Drawer locked during lunch breaks.
- [ ] Shift close submitted before leaving the hospital premises.
- [ ] Opening and closing balances documented in physical logbook.

---

## 7. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
