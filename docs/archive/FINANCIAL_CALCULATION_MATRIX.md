# FINANCIAL CALCULATION MATRIX
**Every Formula — Verified | Care Diagnostics Billing ERP**
*Read-Only Audit | 2026-06-26*

---

## BILL-LEVEL FORMULAS

### At Bill Creation

| Formula | Code Location | Correct? | Verification |
|---------|--------------|----------|-------------|
| `totalAmount = subtotal − discount + taxAmount` | bills.ts L470 | ✅ Yes | taxAmount=0 currently |
| `balanceAmount = totalAmount − paidAmount` | bills.ts L493 | ✅ Yes | |
| `paidAmount = Σ(inline payments)` | bills.ts L492 | ✅ Yes | Only non-online, positive |
| `status = "paid"` if `paidAmount >= totalAmount - 0.01` | bills.ts L494 | ✅ Yes | 1p tolerance for float |
| `status = "partial"` if `0 < paidAmount < totalAmount` | bills.ts L494 | ✅ Yes | |
| `status = "pending"` if `paidAmount = 0` | bills.ts L494 | ✅ Yes | |
| `originalTotal = totalAmount` (at creation) | bills.ts L506 | ✅ Yes | Never mutated again |

### At Refund

| Formula | Code Location | Correct? | Issue |
|---------|--------------|----------|-------|
| `newPaid = currentPaid − refundAmount` | bills.ts L1053 | ✅ | |
| `newRefund = currentRefund + refundAmount` | bills.ts L1054 | ✅ | |
| `newTotal = currentTotal − refundAmount` | bills.ts L1055 | ⚠ RISK | Breaks historical revenue |
| `newBalance = MAX(0, newTotal − newPaid)` | bills.ts L1056 | ✅ | Internally consistent |
| `newStatus` logic | bills.ts L1058 | ✅ | Handles cancelled→cancelled |

### At Cancellation

| Formula | Code | Correct? |
|---------|------|----------|
| `balanceAmount = "0.00"` | bills.ts L867 | ✅ Correct |
| `status = "cancelled"` | bills.ts L861 | ✅ |
| Order_tests cascade to cancelled | bills.ts L883 | ✅ Critical |
| paidAmount unchanged (unless autoRefund) | | ✅ |
| totalAmount unchanged on cancel-only | | ✅ |

### At Super-Admin Edit

| Formula | Code Location | Correct? |
|---------|--------------|----------|
| `newTotal = newSubtotal − newDiscount + newTaxAmount` | bills.ts L1238 | ✅ |
| `newBalance = newTotal − paidAmount` | bills.ts L1240 | ✅ |
| `newStatus` logic | bills.ts L1241 | ✅ |
| Subtotal mismatch audit if ≠ order_tests sum | bills.ts L1261 | ✅ Advisory |

---

## DAILY SUMMARY FORMULAS (my-daily-summary.ts)

### Billing Side

| Metric | Formula | Verified |
|--------|---------|---------|
| `grossBilledIncludingCancelled` | `Σ(totalAmount)` all bills in period | ✅ |
| `cancelledOnMyBills` | `Σ(totalAmount)` where status=cancelled, created in period | ✅ |
| `grossBilling` | `Σ(totalAmount)` active bills in period | ✅ |
| `outstanding` | `Σ(MAX(0, balanceAmount − refundAmount))` for active bills | ✅ |
| `netCollectedOnMyBills` | `grossBilling − outstanding` | ✅ |
| `discountsGiven` | `Σ(discount)` active bills in period | ✅ |
| `duesCollectedTotal` | `Σ(paymentAmount)` for payments on prior-date bills | ✅ |

### Cash Side

| Metric | Formula | Verified |
|--------|---------|---------|
| `cashIn` | `Σ(amount)` positive payments, non-digital, in period | ✅ |
| `digitalIn` | `Σ(amount)` positive payments, digital, in period | ✅ |
| `cashRefunded` | `Σ(|amount|)` negative payments, non-digital, in period | ✅ |
| `digitalRefunded` | `Σ(|amount|)` negative payments, digital, in period | ✅ |
| `cashCollection` | `cashIn − cashRefunded` | ✅ |
| `netDigital` | `digitalIn − digitalRefunded` | ✅ |
| `cashExpenses` | `Σ(amount)` expenses where payment_mode=cash, in date range | ✅ |
| `digitalExpenses` | `Σ(amount)` expenses where payment_mode≠cash, in date range | ✅ |
| `physicalCashInHand` | `cashCollection − cashExpenses` | ✅ |
| `digitalCollection` | `digitalIn` (gross, not net) | ⚠ Named misleadingly |
| `totalReceived` | `Σ(amount)` all positive payments in period | ✅ |
| `refundAmount` | `Σ(|amount|)` all negative payments in period | ✅ |
| `cancelledAmount` | `Σ(totalAmount)` bills cancelled BY this staff in period | ✅ |

---

## RECONCILIATION MODULE FORMULAS (daily-summary.ts backend)

*These are the new fields added for the Daily Reconciliation & Cash Flow table.*

| Metric | Formula | Source | Verified |
|--------|---------|--------|---------|
| `newBillingCollected` | `Σ(p.amount)` payments today, bill created today | payments JOIN bills, both today | ✅ |
| `oldDuesCollected` | `Σ(p.amount)` payments today, bill created before today | same, bill.createdAt < today | ✅ |
| `sameDayRefunds` | `Σ(|p.amount|)` negative payments today, bill created today | | ✅ |
| `backdatedRefunds` | `Σ(|p.amount|)` negative payments today, bill created before today | | ✅ |
| `totalRefunded` | `sameDayRefunds + backdatedRefunds` | | ✅ |
| `cashExpenses` | from expenses table, expense_date = today | | ✅ |
| `digitalExpenses` | same | | ✅ |
| `cashCollection` | from summary.cashCollection | cashIn − cashRefunded | ✅ |
| `netDigitalCollection` | `digitalIn − digitalRefunded` | | ✅ |
| `cancelledBillsAmount` | `Σ(total_amount)` cancelled bills where cancelled_at = today | | ✅ |

### Expected Physical Cash Formula (Reconciliation Module)

```
Expected Physical Cash =
    New Billing Collected (cash)
  + Old Dues Collected (cash)
  − Same-Day Refunds (cash)
  − Backdated Refunds (cash)
  − Cash Expenses
```

Or equivalently:
```
Expected Physical Cash = cashCollection − cashExpenses
                       = (cashIn − cashRefunded) − cashExpenses
```

✅ Both approaches converge to the same answer.

---

## BOOKS SANITY FORMULAS (books-sanity.ts)

| Check | SQL Formula | Tests |
|-------|------------|-------|
| Commission leak | `bills.status=cancelled AND order_tests.status≠cancelled` | ✅ |
| Arithmetic drift | `ABS(subtotal − discount + tax_amount − total_amount) > 0.01` | ✅ |
| Payment ledger drift | `ABS(paid_amount − SUM(payments.amount)) > 0.01` | ✅ |
| Unrefunded cancelled | `status=cancelled AND paid_amount > 0.01` | ✅ |
| High discount | `(discount / subtotal) * 100 > 50` | ✅ |
| SA edit trail | `change_type IN (subtotal, taxAmount, totalAmount, deleted, ...)` | ✅ |

---

## COMPLETE RECONCILIATION PROOF

### Example Day (Cash-only for clarity)

```
Opening Cash (from previous day close): ₹5,000 (manual entry)

Revenue Events:
  Bill A (new): subtotal=2000, discount=0, total=2000, paid cash=2000
  Bill B (new): subtotal=1500, discount=100, total=1400, paid cash=1000, balance=400
  Bill C (dues, old bill): paid cash=500

Cash In = 2000 + 1000 + 500 = ₹3,500

Expense Events:
  Office supplies: ₹200 (cash)

Cash Out Events (Refunds):
  Bill D (old, created yesterday): refund cash=₹800

Calculations:
  cashIn         = 3,500
  cashRefunded   = 800
  cashExpenses   = 200
  cashCollection = 3,500 − 800 = ₹2,700
  physCashInHand = 2,700 − 200 = ₹2,500

  grossBilling  = 2000 + 1400 = ₹3,400 (active bills created today, using totalAmount)
  outstanding   = 400 (Bill B balance)
  netCollected  = 3,400 − 400 = ₹3,000

  duesCollected = ₹500 (Bill C)

Reconciliation:
  Expected Closing Cash = Opening (5,000) + cashCollection (2,700) − cashExpenses (200)
                        = ₹7,500

  Alternatively:
  Expected Closing Cash = Opening (5,000) + cashIn (3,500) − cashRefunded (800) − cashExp (200)
                        = ₹7,500 ✅ Both agree

Revenue Verification:
  Gross Billed Today = grossBilling = ₹3,400
  + Dues Collected   = ₹500
  − Outstanding      = ₹400
  = Net Money In from billing = ₹3,500 ✅ equals cashIn
```

---

## FORMULA RISK SUMMARY

| Formula | Risk | Priority |
|---------|------|---------|
| `newTotal = currentTotal − refundAmount` (on refund) | 🔴 HIGH | Fix before next month-end |
| `digitalCollection = digitalIn` (gross not net) | 🟡 MEDIUM | Rename or fix in UI |
| Expenses use `expense_date` not `created_at` | 🟡 MEDIUM | Add backdating guard |
| `taxAmount = 0` hardcoded | 🟡 MEDIUM | Implement when GST required |
| Outstanding = `balance − refund` | 🟢 LOW | Correct but unusual pattern |
| All other formulas | 🟢 LOW | Verified correct |
