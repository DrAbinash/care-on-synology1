# REFUND ACCOUNTING AUDIT
**Forensic Deep-Dive — Phase 4**
*Care Diagnostics Billing ERP | 2026-06-26*

---

## REFUND MECHANISM (bills.ts — POST /:id/refund)

### What Happens in the Database

```
BEFORE REFUND (Bill #202006-0042, created 20 June):
    bills.total_amount   = 1000.00   (original billed)
    bills.paid_amount    = 1000.00   (fully paid)
    bills.refund_amount  = 0.00
    bills.balance_amount = 0.00
    bills.status         = "paid"
    payments: [{ amount: 1000, method: "cash", createdAt: 20-Jun }]

AFTER REFUND (₹500, method=cash, date=26 June):
    bills.total_amount   = 500.00    ← ⚠ MUTATED (was 1000.00)
    bills.paid_amount    = 500.00    ← reduced
    bills.refund_amount  = 500.00    ← increased
    bills.balance_amount = 0.00      ← still balanced
    bills.status         = "paid"    ← newPaid(500) >= newTotal(500)
    
    payments:
        { amount: +1000, method: "cash", createdAt: 20-Jun }  ← original
        { amount:  -500, method: "cash", createdAt: 26-Jun }  ← refund row
```

### bills.original_total — The Safety Net

```
bills.original_total = 1000.00  ← SET AT BILL CREATION, NEVER MUTATED
```

This column preserves the originally billed amount. It is the only correct source for historical revenue.

---

## CRITICAL FINDING: totalAmount MUTATION

### The Code (bills.ts line 1053-1056)
```typescript
const newPaid = Math.max(0, Math.round((currentPaid - amount) * 100) / 100);
const newRefund = Math.round((currentRefund + amount) * 100) / 100);
const newTotal = Math.max(0, Math.round((currentTotal - amount) * 100) / 100)); // ← BUG
const newBalance = Math.max(0, Math.round((newTotal - newPaid) * 100) / 100));
```

### Why This Is Problematic

| Accounting Approach | totalAmount after ₹500 refund on ₹1000 bill |
|--------------------|---------------------------------------------|
| **Current (ERP)** | ₹500 (mutated) |
| **Standard (Correct)** | ₹1000 (unchanged) |

Standard accounting practice: the original bill amount (₹1000) is a historical fact. A refund creates a **credit note / reverse entry**, not a modification of the original invoice.

### Impact on Reports

| Report / Query | Impact |
|----------------|--------|
| `grossBilling` (daily summary) | ✅ Uses bills created TODAY → if refund is on an old bill, grossBilling of OLD date is reduced |
| `netCollectedOnMyBills` | ⚠ Uses current `totalAmount` for bills created today |
| `outstanding` | ✅ Not directly affected (uses balanceAmount − refundAmount) |
| Historical "Revenue on 20 June" query | ⚠ Returns ₹500 if using totalAmount, should return ₹1000 |
| `books-sanity` period totals | ⚠ `SUM(total_amount)` is lower than actual billed amount |
| CA/Tally export | ⚠ Understates revenue, overstates contra |

---

## WHAT CORRECTLY WORKS (REFUND DATE ATTRIBUTION)

### 26 June My Daily Summary:

```
refundItems = payments WHERE createdAt >= 26Jun-00:00 IST 
                         AND createdAt < 26Jun-23:59 IST
                         AND amount < 0

cashRefunded = ₹500   ← correctly shows today's cash outflow
cashCollection = cashIn − cashRefunded  ← correctly reduced today
physicalCashInHand = cashCollection − cashExpenses  ← correct
```

✅ Cash leaves the drawer on 26 June and is correctly accounted on 26 June.

### 20 June My Daily Summary (if you re-run):
```
allBillRows for 20 June: includes this bill
bills.totalAmount = ₹500 (MUTATED)  ← wrong for historical report
bills.originalTotal = ₹1000 (CORRECT)

grossBilling on 20 June = ₹500 per current query (should be ₹1000)
```
⚠ Historical 20 June report now understates revenue by ₹500.

---

## DUAL-VIEW ACCOUNTING (Phase 4, Question 10)

### Can management answer BOTH:
1. "What revenue was GENERATED on 20 June?" → ₹1000  
2. "How much cash LEFT the clinic on 26 June due to refunds?" → ₹500

**CURRENT STATE:**

| Question | Correct Answer | Current ERP Answer | Correct? |
|----------|---------------|-------------------|----------|
| Revenue generated 20 June | ₹1000 | ₹500 (via total_amount) | ❌ |
| Revenue generated 20 June | ₹1000 | ₹1000 (via original_total) | ✅ (if queried correctly) |
| Cash outflow on 26 June | ₹500 | ₹500 | ✅ |
| Refund amount for the bill | ₹500 | ₹500 (bills.refund_amount) | ✅ |

**Correct SQL for historical revenue:**
```sql
SELECT SUM(original_total) 
FROM bills 
WHERE created_at::date = '2026-06-20' 
  AND status != 'cancelled';
```

**Correct SQL for today's cash outflow from refunds:**
```sql
SELECT ABS(SUM(amount)) 
FROM payments 
WHERE amount < 0 
  AND created_at::date = '2026-06-26'
  AND method IN ('cash');
```

---

## REFUND SEPARATION BY DATE (Phase 4, Question 9)

### By Refund Date (today's cash outflow):
```sql
-- Already in My Daily Summary via refundItems
SELECT p.*, b.bill_number, b.created_at AS bill_date
FROM payments p
JOIN bills b ON b.id = p.bill_id
WHERE p.amount < 0
  AND p.created_at::date = '2026-06-26';  -- refund date
```

### By Bill Date (which month's revenue was reversed):
```sql
-- Not in current UI — needs new report
SELECT p.*, b.bill_number, b.created_at AS bill_date
FROM payments p
JOIN bills b ON b.id = p.bill_id
WHERE p.amount < 0
  AND b.created_at::date = '2026-06-20';  -- bill date
```

⚠ The ERP currently does NOT expose the second query in any report page.

---

## SAFE PRODUCTION RECOMMENDATION

### Immediate Fix Required (HIGH RISK):
Do **not** modify `bills.total_amount` on refund. Instead:

```typescript
// CORRECT refund accounting:
const newPaid    = currentPaid - amount;
const newRefund  = currentRefund + amount;
// total_amount STAYS UNCHANGED
// balance_amount = totalAmount - newPaid  (shows money owed back)
```

But this requires verifying that:
1. All reports that show "net bill value" use `total_amount − refund_amount`
2. Outstanding calculation already does: `balance_amount − refund_amount` (correct)
3. Status logic handles the case where `newPaid < 0` (impossible with validation)

> **RECOMMENDATION:** Before changing this, run a full report impact analysis. The current implementation has a consistent internal logic (total, paid, balance always balanced), but it breaks historical totals. The fix is to:
> 1. Keep `total_amount = original_total` (never mutate)
> 2. Track net value as `total_amount − refund_amount`
> 3. Balance: `balance_amount = (total_amount − refund_amount) − paid_amount`

---

## REFUND EDGE CASES

| Scenario | Handled | Notes |
|----------|---------|-------|
| Refund > paid amount | ✅ Rejected | Line 1046: amount > currentPaid → 400 error |
| Partial refund | ✅ Correct | paidAmount reduces, refundAmount increases |
| Full refund on paid bill | ✅ Status → "pending" | newPaid=0, status=pending |
| Refund on cancelled bill | ✅ Stays "cancelled" | Line 1058: if cancelled, stays cancelled |
| Refund on partial bill | ✅ Works | Status recalculated correctly |
| Duplicate concurrent refunds | ✅ Row-lock | `SELECT ... FOR UPDATE` prevents over-refund |
| Refund after month-end close | ⚠ Allowed | No hard stop on closed periods |
| Refund after financial close | ⚠ Allowed | No lock mechanism |
