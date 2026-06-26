# Financial Freeze Rulebook
## Care Diagnostics ERP Production Governance

This document establishes the permanent **Financial Freeze Policy** for the Care Diagnostics ERP accounting system. All financial code is locked and must be treated with the same rigor and security protocols as core banking software.

---

## 1. The Core Policy

> [!IMPORTANT]
> **No developer may modify any financial or accounting code in the production codebase without following the Change Control Policy.**
> Any change to calculations, schema, or voucher wiring without verification, automated tests run, and Super Admin sign-off is strictly prohibited.

---

## 2. Protected Modules & Subsystems

The accounting engine is divided into nine protected subsystems. Any modification of code, configuration, or DB columns inside these subsystems requires the change control process:

1.  **Billing Engine**: Computes subtotal, tax, discount, total, and balance.
2.  **Accounting Engine**: Generates ledger double-entry lines and voucher transactions.
3.  **Voucher Engine**: Controls voucher numbering, type constraints (RV, PV, etc.), and balance locks.
4.  **Refund Engine**: Processes partial/full cancellations, auto-vouchers, and balance adjustments.
5.  **Ledger Engine**: Tracks doctor-wise and referral-wise commissions, dues, and payouts.
6.  **Gateway Accounting**: Direct webhook ingestion, signature validation, and auto-reconciliation.
7.  **Daily Summary**: Cash drawer reconciliation, digital reconciliation, and backdated logs.
8.  **Money Trail**: Historical ledger lines audit validation.
9.  **Tally Export**: Structure of the Tally XML export templates.

---

## 3. Financial Invariants

The following invariants are mathematically locked. No update or route may violate these rules under any operational sequence:

### Invariant 1: Canonical Bill Balance
The balance of any bill must always equal the total amount minus paid and refund amounts, bounded at zero:
$$\text{balanceAmount} = \max(0, \text{totalAmount} - \text{paidAmount} - \text{refundAmount})$$
*   *Why it exists*: Ensures the outstanding list represents the true net money still owed by the patient.
*   *What breaks if changed*: Outstanding collections count is distorted, and the daily summary cash drawer will mismatch.

### Invariant 2: Total Amount Preservation
The `totalAmount` field must represent the gross billed value (original subtotal - discount + tax) and **must never be mutated** when refunds are processed.
$$\text{totalAmount} = \text{subtotal} - \text{discount} + \text{taxAmount}$$
*   *Why it exists*: Preserves historical revenue recognition reports.
*   *What breaks if changed*: Daily, weekly, and monthly reports overstate or understate gross billed revenue.

### Invariant 3: Double-Entry Ledger Zero-Sum
Every transaction voucher must have balanced debits and credits:
$$\sum \text{debits} - \sum \text{credits} = 0$$
*   *Why it exists*: Ensures the Trial Balance and Ledger accounts balance perfectly.
*   *What breaks if changed*: Drift in Trial Balance, making export to Tally/ERP software invalid.

### Invariant 4: Cancelled Bill Outstanding Lock
Any bill marked as `cancelled` must have `balanceAmount = "0.00"` and `status = "cancelled"`:
$$\text{cancelled} \implies \text{balanceAmount} = 0$$
*   *Why it exists*: Prevents voided bills from appearing as unpaid dues.
*   *What breaks if changed*: Mismatches in the Due Payments report and outstanding collections dashboards.

---

## 4. Released Status

All 42 core financial regression tests have passed. Financial Integrity is verified at **100/100**. This rulebook represents the permanent production governance state.
