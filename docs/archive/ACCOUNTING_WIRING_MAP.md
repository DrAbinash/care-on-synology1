# ACCOUNTING WIRING MAP
**Complete Ledger Flow — Care Diagnostics Billing ERP**
*Read-Only Audit | 2026-06-26*

---

## CHART OF ACCOUNTS (Auto-Created by auto-voucher.ts)

| Account Name | Type | Tally Group | Created By |
|-------------|------|-------------|-----------|
| Cash in Hand | cash | Cash-in-Hand | Auto on first cash payment |
| UPI Collections | bank | Bank Accounts | Auto on first UPI payment |
| Card Collections | bank | Bank Accounts | Auto on first card payment |
| Online Collections | bank | Bank Accounts | Auto on first online payment |
| Cheque Collections | bank | Bank Accounts | Auto on first cheque payment |
| Bank Account | bank | Bank Accounts | Auto on first bank payment |
| NEFT/RTGS Collections | bank | Bank Accounts | Auto on first NEFT/RTGS |
| Diagnostic Services Revenue | income | Direct Income | Auto on first any payment |

**Manual accounts** can be added via `POST /api/accounting/accounts` (admin UI).

---

## VOUCHER TYPES SUPPORTED

| Voucher Type | Internal Code | Tally Equivalent | When Created |
|-------------|---------------|------------------|-------------|
| Receipt | `receipt` | Receipt | Payment received (auto) |
| Payment | `payment` | Payment | Refund issued (auto) |
| Contra | `contra` | Contra | Bank transfer (manual) |
| Journal | `journal` | Journal | Adjustments (manual) |
| Bank Transfer | `bank_transfer` | Contra | Inter-bank (manual) |
| Sales | `sales` | Sales | N/A (manual) |
| Purchase | `purchase` | Purchase | N/A (manual) |

---

## DOUBLE-ENTRY WIRING — EVERY EVENT

### Bill Created + Cash Payment
```
Receipt Voucher (RV-YYYYMM-NNNN)
    DEBIT:  Cash in Hand               +₹amount
    CREDIT: Diagnostic Services Revenue +₹amount
Date: TODAY (IST)
Reference: bill_number
```

### Bill Created + UPI Payment
```
Receipt Voucher
    DEBIT:  UPI Collections            +₹amount
    CREDIT: Diagnostic Services Revenue +₹amount
```

### Bill Created + Card Payment
```
Receipt Voucher
    DEBIT:  Card Collections           +₹amount
    CREDIT: Diagnostic Services Revenue +₹amount
```

### Split Payment (Cash + UPI)
```
Receipt Voucher #1 (cash portion)
    DEBIT:  Cash in Hand               +₹cashAmount
    CREDIT: Diagnostic Services Revenue +₹cashAmount

Receipt Voucher #2 (UPI portion)
    DEBIT:  UPI Collections            +₹upiAmount
    CREDIT: Diagnostic Services Revenue +₹upiAmount
```
*(Each split payment generates a separate voucher)*

### Cash Refund
```
Payment Voucher (PV-YYYYMM-NNNN)
    DEBIT:  Diagnostic Services Revenue -₹refundAmount
    CREDIT: Cash in Hand               -₹refundAmount
Date: TODAY (IST) — date of refund, not bill date
Reference: original bill_number
```

### Digital (UPI) Refund
```
Payment Voucher
    DEBIT:  Diagnostic Services Revenue -₹refundAmount
    CREDIT: UPI Collections             -₹refundAmount
```

### Expenses (⚠ DISCONNECTED — No Auto-Voucher)
```
❌ NO VOUCHER GENERATED
Expenses are recorded in the expenses table but do NOT
automatically generate accounting vouchers.
Cash paid for expenses reduces physical cash in the daily
summary (via expenses filter) but leaves NO trace in the
voucher ledger / accounting module.
```
> **This is a MISSING WIRING.** Every expense should generate:
> ```
> Payment Voucher
>     DEBIT:  [Expense Account e.g. "Office Expenses"]   +₹amount
>     CREDIT: Cash in Hand / Bank Account                -₹amount
> ```

### Online Gateway Payment (⚠ INCOMPLETE)
```
Online payments (method="online") are EXCLUDED at billing time:
    bills.ts line 491: validPayments excludes method="online"
    → paidAmount = 0, no voucher generated
    → Awaits gateway callback to post receipt

❌ No webhook handler found for ICICI/HDFC
    → No auto-voucher fires for online payments
    → No reconciliation mechanism implemented
```

---

## LEDGER STRUCTURE (Multi-Book)

```
ledgers table:
    id=1  Default / Walk-in (is_walk_in=true by default or auto-detected)
    id=N  Doctor-specific ledgers (referral books)

Bill-to-ledger assignment:
    1. If order has explicit ledger_id → use that
    2. Else if order has doctor_id → use doctor's ledger
    3. Else → use walk-in ledger (getWalkInLedgerId())

Bill number format: YYYYMM + 4-digit sequence (GLOBAL max, not per-ledger)
    → All ledgers share the same bill number sequence
    → No collision possible even with multiple ledgers
```

---

## TALLY EXPORT COMPATIBILITY

### Tally Group Mapping (accounting.ts)

```
"Current Assets"           → Assets
"Fixed Assets"             → Assets
"Current Liabilities"      → Liabilities
"Capital Account"          → Capital Account
"Direct Income"            → Income
"Indirect Income"          → Income
"Direct Expenses"          → Expenses
"Indirect Expenses"        → Expenses
"Cash-in-Hand"             → Current Assets
"Bank Accounts"            → Current Assets
"Bank OD Accounts"         → Bank OD Accounts
"Duties & Taxes"           → Current Liabilities
"Sundry Debtors"           → Current Assets
```

### What Works for Tally Export
- ✅ Voucher type names match Tally (Receipt, Payment, Contra, Journal)
- ✅ Tally parent group hierarchy implemented
- ✅ Account codes and opening balances supported
- ✅ GST fields (gstApplicable, gstNumber) on accounts
- ✅ PAN field on accounts
- ✅ IFSC, bank name, account number for bank reconciliation

### What's Missing for Tally
- ⚠ No XML/TDL export for Tally import (manual entry or future build)
- ⚠ GST tax amount = 0 on all bills (no GST posting until enabled)
- ⚠ Expenses not in voucher ledger (missing for day book)
- ⚠ No pharmacy GST separation (no pharmacy module exists)
- ⚠ No contra entries for bank deposits from cash
- ⚠ No "Sundry Debtor" for credit/corporate/insurance billing

---

## GST STATUS

| Aspect | Status | Notes |
|--------|--------|-------|
| tax_amount field on bills | ✅ Exists | Always 0 currently |
| GST registration number on accounts | ✅ Exists | `gstNumber` column |
| GST calculation at billing | ❌ Not implemented | `taxAmount = 0` hardcoded |
| GST separate ledger | ❌ Not implemented | No "Duties & Taxes" auto-posting |
| Pharmacy GST | N/A | No pharmacy module |
| GST on diagnostic services | Typically exempt under Notification 12/2017 | Confirm with CA |

---

## ORPHAN POSTING RISKS

| Risk | Likelihood | Description |
|------|-----------|-------------|
| Payment row without voucher | LOW | auto-voucher is non-blocking — failure silently logged |
| Voucher without payment row | VERY LOW | Voucher requires billId but no FK to payments |
| Bill without order | ⚠ POSSIBLE | If order deleted via SA, bill references dead orderId |
| Voucher after day close | LOW | No lock prevents vouchers after closure |
| Duplicate voucher | VERY LOW | 3-retry loop + unique constraint protects |

### Orphan Detection Query (recommended for CA audit)

```sql
-- Vouchers without matching bills
SELECT v.* FROM vouchers v
LEFT JOIN bills b ON b.id = v.bill_id
WHERE v.bill_id IS NOT NULL AND b.id IS NULL;

-- Bills with payments but no vouchers
SELECT b.id, b.bill_number, SUM(p.amount) AS total_paid
FROM bills b
JOIN payments p ON p.bill_id = b.id
WHERE p.amount > 0
GROUP BY b.id, b.bill_number
HAVING b.id NOT IN (SELECT DISTINCT bill_id FROM vouchers WHERE bill_id IS NOT NULL);
```

---

## LEDGER AUDIT VERDICT

| Item | Status |
|------|--------|
| Every cash bill posts correctly | ✅ Yes (auto-voucher) |
| Every refund reverses correctly | ✅ Yes (PV auto-generated) |
| Advances adjust correctly | ❌ No advance module |
| Online settlements reconcile | ❌ No gateway webhook |
| GST posts correctly | ❌ Not implemented (tax=0) |
| Pharmacy GST separate | N/A — no pharmacy |
| No orphan postings | ✅ Mostly — auto-voucher silently fails |
| No duplicate postings | ✅ Unique constraint + retry |
| Expenses in ledger | ❌ Missing — not auto-vouchered |
