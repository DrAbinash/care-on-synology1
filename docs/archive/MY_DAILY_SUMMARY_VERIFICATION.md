# MY DAILY SUMMARY VERIFICATION
**Forensic Audit — Phase 3 & Phase 4**
*Care Diagnostics Billing ERP | Read-Only Audit | 2026-06-26*

---

## DATA SOURCE: `GET /api/dashboard/my-daily-summary`
**File:** `api-server/src/routes/my-daily-summary.ts`  
**Frontend:** `diagnostic-erp/src/pages/MyDailySummary.tsx`

---

## TIME FILTER

```javascript
// dayBoundsRange(from, to):
start = new Date(`${from}T00:00:00+05:30`)   // IST midnight start
end   = new Date(`${to}T23:59:59.999+05:30`) // IST midnight end

// Applied to:
//   bills.createdAt      → bills CREATED in period
//   payments.createdAt   → payments RECORDED in period
//   bills.cancelledAt    → bills CANCELLED in period (separate query)
//   expenses.expenseDate → expenses on this date
```

**Timezone:** All bounds are IST (`+05:30`). ✅ Correct for India.

---

## EVERY DISPLAYED VALUE — SOURCE AND FORMULA

### 1. Gross Billing (activeBilling)

| Field | Database Source | Formula |
|-------|----------------|---------|
| `grossBilling` | `bills.totalAmount` | Σ(totalAmount) for bills created in period, status ≠ "cancelled" |
| `grossBilledIncludingCancelled` | same | Σ(totalAmount) for ALL bills including cancelled |
| **NOTE:** totalAmount = subtotal − discount + taxAmount (taxAmount = 0) | | |

**Date Filter:** `bills.createdAt >= start AND bills.createdAt < end` ✅  
**GST Handling:** `taxAmount` column exists but is hardcoded to 0 at bill creation. ⚠  
**Refund Handling:** Since refunds mutate `totalAmount`, a refunded bill shows REDUCED grossBilling amount. ⚠

---

### 2. Outstanding

```javascript
const trueOutstanding = (r) => {
  const bal = Math.max(0, Number(r.balanceAmount ?? 0));
  const ref = Math.max(0, Number(r.refundAmount ?? 0));
  return Math.max(0, bal - ref);
}
outstanding = Σ(trueOutstanding) for active bills in period
```

**Formula:** `MAX(0, balanceAmount − refundAmount)` for each active bill  
**Why subtract refundAmount?** After a refund, balanceAmount may be positive (the refunded portion shows as "still due"), so refundAmount is subtracted to get true money still owed.  
**Risk:** If refund > balance (over-refund edge case), trueOutstanding could be 0 but should be verified by Books Sanity.

---

### 3. Cash In / Cash Collection

```javascript
isDigital(method) = ["upi","card","online","bank","cheque","neft","rtgs"].includes(m) 
                    || m.startsWith("web booking")

cashIn = Σ(amount) for positive payments where !isDigital(method)
cashRefunded = Σ(|amount|) for negative payments where !isDigital(method)
cashCollection = cashIn − cashRefunded
```

**Date Filter:** `payments.createdAt >= start AND payments.createdAt < end` ✅  
**Refund Attribution:** Cash refunds reduce cashCollection on the DATE OF REFUND. ✅ Correct.

---

### 4. Digital Collection

```javascript
digitalIn = Σ(amount) for positive payments where isDigital(method)
digitalRefunded = Σ(|amount|) for negative payments where isDigital(method)
netDigital = digitalIn − digitalRefunded
digitalCollection = digitalIn  // legacy: gross digital (not net)
```

⚠ **DISCREPANCY:** `digitalCollection` returned by the API is `digitalIn` (gross), not `netDigital`. The `netDigital` field is computed but exposed separately. Dashboards that display `digitalCollection` show gross digital, which is pre-refund.

---

### 5. Physical Cash in Hand

```javascript
physicalCashInHand = cashCollection − cashExpenses
                   = (cashIn − cashRefunded) − cashExpenses
```

**Expenses Source:** `expenses` table, `expense_date >= from AND expense_date <= to AND payment_mode = 'cash'`  
**⚠ IMPORTANT:** Expenses use `expense_date` (date field), not `createdAt` (timestamp). This means a backdated expense entry can reduce today's physical cash even if it was entered on a different date.

---

### 6. Dues Collected (Old Bill Payments)

```javascript
duesPaymentRows = payments where:
  payments.createdAt >= start   (payment today)
  payments.createdAt < end
  bills.createdAt < start       (bill predates period)
  payments.amount > 0           (positive only)
duesCollectedTotal = Σ(paymentAmount) for these
```

✅ Correctly separated from today's billing.  
✅ Bill predating is checked via `bills.createdAt < start` (IST-bounded).  
⚠ Dues collected via cash affect `cashIn` — correctly included in physicalCashInHand.

---

### 7. Refunds & Cancellations

```javascript
refundItems = allPaymentRows where amount < 0
              (payments recorded today, regardless of bill date)
refundAmount = Σ(|amount|) for refundItems
cancelledAmount = Σ(totalAmount) for bills cancelled BY this staff today
refundsAndCancellations = refundAmount + cancelledAmount
```

⚠ **Cancellation without refund:** A cancelled bill with unpaid balance has `cancelledAmount` included in `refundsAndCancellations`, but no money actually left. This overstates effective refunds in the summary field.

---

### 8. Discounts Given

```javascript
discountsGiven = Σ(discount) for activeBills (bills created today, not cancelled)
```

**Source:** `bills.discount` column (applied at bill creation).  
**Date filter:** Applied to bill creation date.  
**Note:** Discounts granted on OLD bills via super-edit will NOT appear in today's discountsGiven — they appear on the original bill's date.

---

### 9. Expenses

```javascript
cashExpenses   = SUM(amount) WHERE payment_mode = 'cash'    AND expense_date BETWEEN from AND to
digitalExpenses = SUM(amount) WHERE payment_mode != 'cash'  AND expense_date BETWEEN from AND to
totalExpenses  = cashExpenses + digitalExpenses
```

**⚠ Uses `expense_date` (date string), not `created_at` (timestamp).** This means:
- Backdated expenses will reduce the ENTRY DATE's summary, not today's summary.
- A staff member can enter an expense for yesterday and it reduces yesterday's cash.
- No lock prevents entry of future-dated expenses.

---

## PHASE 4 — BACKDATED REFUND AUDIT

### Scenario: Bill Date 20 June, Refund Date 26 June

```
QUESTION 1: Is today's cash reduced today?
ANSWER: ✅ YES
    - Refund payment row has createdAt = 26 June (NOW())
    - cashRefunded on 26 June increases
    - physicalCashInHand on 26 June decreases
    - Cash physically leaves the drawer on 26 June

QUESTION 2: Is today's digital collection reduced (if online refund)?
ANSWER: ✅ YES for digitalRefunded
        ⚠ PARTIAL for digitalCollection display
    - digitalRefunded on 26 June increases
    - netDigital on 26 June decreases
    - BUT: displayed digitalCollection = digitalIn (gross), not netDigital
    - This means the dashboard may show gross digital, not net of refunds

QUESTION 3: Does today's My Daily Summary show today's refund?
ANSWER: ✅ YES
    - refundItems is filtered by payments.createdAt (today's date)
    - refundAmount increases
    - refundsAndCancellations increases

QUESTION 4: Does Expected Cash reduce today?
ANSWER: ✅ YES
    - physicalCashInHand = cashIn − cashRefunded − cashExpenses
    - cashRefunded includes today's cash refunds

QUESTION 5: Does Cash Closing reduce today?
ANSWER: ✅ YES
    - Day-close summarizeWindow() reads all payments (positive and negative)
    - Negative payments (refunds) reduce the cash totals in the day-close window

QUESTION 6: Does today's Daily Collection correctly account for money leaving?
ANSWER: ✅ YES (with caveat)
    - Daily Summary correctly shows cash leaving today
    - New Reconciliation module also shows backdated refunds separately

QUESTION 7: Does original bill remain historically recorded on original billing date?
ANSWER: ✅ YES (partial)
    - bills.createdAt is IMMUTABLE — stays as 20 June
    - bills.bill_number stays as the 20 June sequence number
    - HOWEVER: bills.totalAmount is MUTATED on refund (see Critical Finding below)
    - HOWEVER: bills.paid_amount, bills.refund_amount are also mutated
    
    ✅ SAFE: bill.createdAt, bill.bill_number
    ⚠ MUTATED: bill.totalAmount, bill.paid_amount, bill.balance_amount, bill.refund_amount

QUESTION 8: Are historical revenue reports preserved correctly?
ANSWER: ⚠ PARTIALLY
    - The bills.totalAmount for the 20 June bill has been REDUCED by the refund
    - If you query "Revenue on 20 June" via bills.totalAmount, 
      you will get a LOWER number than was actually billed
    - The original amount is NOT stored anywhere after a refund
    - bills.originalTotal exists but it's set equal to totalAmount at bill creation
      and is not updated when refund occurs → it correctly holds the original billed amount
      (lines 496-513 of bills.ts: originalTotal = totalAmount at creation time)
    
    ✅ bills.original_total = original billed amount (not mutated by refund)
    ⚠ bills.total_amount = currently reduced by refund
    
    RECOMMENDATION: Revenue reports should use bills.original_total, not bills.total_amount

QUESTION 9: Are refund reports separated by bill date vs refund date?
ANSWER: ⚠ NOT FULLY SEPARATE IN UI
    - The API provides billCreatedAt on each refund item in my-daily-summary
    - BUT: the Daily Summary report does not expose a "refund by bill date" view
    - The new Reconciliation module shows backdatedRefunds as an informational row
    - Management cannot currently run: "All refunds by original bill date"
    
    DATA IS AVAILABLE to build this report (payments.billId → bills.createdAt)
    but no report endpoint exists for it yet.

QUESTION 10: Can management answer both revenue and cash-outflow questions?
ANSWER: ⚠ PARTIAL
    Revenue on 20 June: Query bills WHERE createdAt = 20 June AND use original_total
    Cash outflow from refunds on 26 June: Query payments WHERE createdAt = 26 June AND amount < 0
    
    These queries CAN be answered from the database but the ERP UI does not currently
    expose a report that shows both views simultaneously.
```

---

## SUMMARY TABLE — MY DAILY SUMMARY ACCURACY

| Metric | Source | Accuracy | Risk |
|--------|--------|----------|------|
| Gross Billing | bills.totalAmount (today) | ⚠ Mutated by refunds | HIGH |
| Net Collected | grossBilling − outstanding | ⚠ Derived from mutated totalAmount | HIGH |
| Cash In | payments today, cash method | ✅ Correct | LOW |
| Cash Refunded | payments today, negative, cash | ✅ Correct | LOW |
| Physical Cash in Hand | cashIn − cashRefunded − cashExp | ✅ Correct | LOW |
| Digital Collection | digitalIn (gross, not net) | ⚠ Shows gross, not net-of-refund | MEDIUM |
| Discounts Given | bills.discount, today's bills | ✅ Correct | LOW |
| Dues Collected | payments on prior-date bills | ✅ Correct | LOW |
| Outstanding | balance − refundAmount | ✅ Correct | LOW |
| Expenses | expense_date filter | ⚠ Backdatable | LOW |
| Backdated Refunds | New: identified via bill date | ✅ Now visible (new module) | LOW |
| Cancellation Count | cancelledAt filter | ✅ Correct | LOW |
