# MONEY FLOW FORENSIC AUDIT
**Care Diagnostics Billing ERP — Production Readiness Financial Audit**
*Generated: 2026-06-26 | Checkpoint: `0727b3c3` | Status: READ-ONLY AUDIT*

---

## AUDIT SCOPE

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Financial Architecture Discovery | ✅ Complete |
| 2 | Complete Money Trail | ✅ Complete |
| 3 | My Daily Summary Forensic Audit | See separate document |
| 4 | Back-Dated Refund Audit | See separate document |
| 5 | Calculation Verification | See FINANCIAL_CALCULATION_MATRIX.md |
| 6 | Ledger Audit | See ACCOUNTING_WIRING_MAP.md |
| 7 | Payment Gateway Audit | Included below |
| 8 | Edge Cases | Included below |
| 9 | Fraud & Leak Detection | Included below |

---

## PHASE 1 — FINANCIAL ARCHITECTURE

### Core Database Tables (Financial)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `bills` | Master billing record | `id, bill_number, subtotal, discount, tax_amount, total_amount, paid_amount, balance_amount, refund_amount, status, order_id, patient_id, ledger_id, created_by_name, cancelled_by_name, cancelled_at` |
| `payments` | Every cash movement (positive = receipt, negative = refund) | `id, bill_id, amount, method, reference_number, recorded_by_name, notes, created_at` |
| `orders` | Service orders (pre-billing) | `id, patient_id, doctor_id, total_amount, ledger_id, status` |
| `order_tests` | Individual tests on an order | `id, order_id, test_id, price, status, cancelled_by_name` |
| `expenses` | Operational expenses | `id, expense_id, category, amount, expense_date, payment_mode, approved_by` |
| `accounts` | Chart of accounts (Tally-compatible) | `id, name, type, tally_group, opening_balance` |
| `vouchers` | Accounting vouchers (double-entry) | `id, voucher_number, type, date, debit_account_id, credit_account_id, amount, bill_id` |
| `ledgers` | Multi-book support (per doctor/branch) | `id, name, is_default, is_walk_in` |
| `day_closures` | Day-close records | `id, status, covered_from_ts, covered_to_ts` |
| `user_day_closures` | Per-staff day-close | `id, staff_name, closure_date` |
| `bill_audits` | Full audit trail for every bill mutation | `id, bill_id, edited_by, change_type, old_value, new_value, reason` |
| `voucher_audits` | Audit trail for voucher mutations | same shape |

### API Routes Affecting Money

| Route | Method | Financial Function |
|-------|--------|--------------------|
| `POST /api/bills` | Create | Creates bill + payment rows + auto-voucher |
| `PUT /api/bills/:id` | Update | Edit discount / status; writes bill_audits |
| `POST /api/bills/:id/cancel` | Cancel | Marks cancelled + zeros balance + optional refund |
| `POST /api/bills/:id/refund` | Refund | Negative payment row + updates bill balances |
| `PATCH /api/bills/:id/super-edit` | Super edit | SA-only: can change subtotal/discount/tax |
| `DELETE /api/bills/:id` | Delete | SA-only: deletes + renumbers; deletes payment rows |
| `POST /api/payments` | Add payment | Due collection on existing bill |
| `GET /api/daily-summary` | Read | Admin daily summary (date-filtered) |
| `GET /api/dashboard/my-daily-summary` | Read | Staff personal summary |
| `POST /api/expenses` | Create | Operational expense entry |
| `GET /api/accounting/vouchers` | Read | Voucher ledger |
| `POST /api/accounting/vouchers` | Create | Manual accounting voucher |
| `GET /api/books-sanity` | Read | Anomaly detection across bills/payments |
| `GET /api/day-close/*` | Day close | Shift/day close workflow |
| `GET /api/ledgers` | Read | Multi-book management |

---

## PHASE 2 — COMPLETE MONEY TRAIL

### Standard Cash Transaction

```
Patient Visit
    ↓
Patient Registration (patients table)
    ↓
Order Created (orders + order_tests tables)
    ↓ [orderId → bill creation]
Bill Created (bills table)
    totalAmount = subtotal − discount + taxAmount (taxAmount = 0 currently)
    paidAmount = Σ(inline payments)
    balanceAmount = totalAmount − paidAmount
    status = "paid" | "partial" | "pending"
    ↓
Payment Rows Inserted (payments table)
    amount > 0, method = "cash" | "upi" | "card" | "online" | "cheque"
    ↓
Auto-Voucher Generated (auto-voucher.ts → vouchers table)
    Receipt Voucher (RV):
        DEBIT:  Cash-in-Hand / UPI Collections / Card Collections
        CREDIT: Diagnostic Services Revenue
    ↓
Queue Token Generated (tokens table)
    ↓
Radiology Study Created if needed (studies table)
    ↓
WhatsApp notification sent (non-blocking)
    ↓
Daily Summary includes this bill in:
    - grossBilling (+)
    - paymentItems → cashIn / digitalIn
    - physicalCashInHand
```

### Refund Trail (Backdated — old bill)

```
Bill created: 20 June 2026
Refund triggered: 26 June 2026
    ↓
POST /api/bills/:id/refund
    ↓
DB TRANSACTION (row-lock on bill):
    1. VALIDATE: amount ≤ paidAmount
    2. INSERT payments(amount = -refundAmount, method, recordedByName, createdAt = NOW())
    3. UPDATE bills SET:
        paidAmount  -= refundAmount
        refundAmount += refundAmount
        totalAmount  -= refundAmount   ← ⚠ SEE AUDIT NOTE BELOW
        balanceAmount = newTotal − newPaid
        status = pending/partial/paid
    4. INSERT bill_audits (changeType = "refund")
    ↓
Auto-Voucher Generated:
    Payment Voucher (PV):
        DEBIT:  Diagnostic Services Revenue  (reversing income)
        CREDIT: Cash-in-Hand / UPI (where money goes out)
    Date: TODAY (26 June) — NOT original bill date
    ↓
26 June Daily Summary:
    - refundItems includes this payment (amount < 0, createdAt = 26 June)
    - cashRefunded increases (if method=cash)
    - cashCollection (= cashIn − cashRefunded) decreases
    - physicalCashInHand decreases ← cash physically leaves the drawer today
    20 June Daily Summary:
    - UNCHANGED — original bill stays in 20 June records
    - bills.createdAt remains 20 June
```

> **⚠ CRITICAL AUDIT NOTE — totalAmount mutation on refund:**
> 
> In `bills.ts` line 1055: `const newTotal = Math.max(0, Math.round((currentTotal - amount) * 100) / 100);`
> 
> **The bill's `totalAmount` is reduced by the refund amount.** This is NOT standard accounting practice. Normally:
> - `totalAmount` should remain the ORIGINAL billed amount (historical record)
> - Only `paidAmount` and `refundAmount` should change
> - `balanceAmount` should reflect the net position
>
> **Impact:** If you look at a refunded bill, the `totalAmount` shows a REDUCED amount, not the original. This affects:
> 1. `grossBilling` calculation in daily-summary.ts (uses `totalAmount` of active bills — these are now lower)
> 2. Historical revenue reports that query `totalAmount` 
> 3. Any report that joins bills and expects `totalAmount` to match the original billed amount
>
> **Risk Rating: HIGH** — distorts historical revenue figures

### Cancellation Trail

```
POST /api/bills/:id/cancel
    ↓
DB TRANSACTION (row-lock):
    1. UPDATE bills SET status="cancelled", cancelled_at=NOW(), balance_amount="0.00"
    2. INSERT bill_audits (changeType="cancelled")
    3. UPDATE order_tests SET status="cancelled" (commission cascade)
    4. Optional: INSERT payments(amount=-paidAmount) if autoRefund body included
    ↓
Auto-Voucher (only if autoRefund):
    Payment Voucher — same as refund flow
    ↓
Daily Summary (day of cancellation):
    - cancelledByMeRows: filtered by cancelledByName + cancelledAt
    - cancelledAmount includes this bill's totalAmount
    - NOTE: If no autoRefund, the money stays as paidAmount on the cancelled bill
      → This triggers Books Sanity check #4 (unrefunded cancelled bill)
```

### Due Collection Trail (Old Bill Payment)

```
POST /api/payments (separate from bill creation)
    OR bill creation with partial payment, later followed-up
    ↓
payments table INSERT (positive amount, createdAt = today)
    ↓
UPDATE bills SET paidAmount, balanceAmount, status
    ↓
Auto-Voucher: Receipt Voucher (today's date)
    ↓
My Daily Summary:
    duesPaymentRows: payments where bill.createdAt < today's start
    duesCollectedTotal: sum of these payments
    These are separated from "today's billing" intentionally
```

---

## PHASE 7 — PAYMENT GATEWAY AUDIT

### Current Gateway Status

| Gateway | Status | Notes |
|---------|--------|-------|
| ICICI | Not found in routes | No `/api/icici` or ICICI webhook route found |
| HDFC | Not found in routes | No `/api/hdfc` route found |
| Staff QR | Via public-booking.ts | QR codes for walk-in payment |
| Kiosk QR | kiosk.ts | Patient kiosk QR flow |
| Online Booking | public-booking.ts (68 KB) | Full booking + payment flow |
| Bill Desk QR | Not found | Not implemented |

> **⚠ RISK: ICICI and HDFC gateway routes are NOT implemented** in the API server. The UI shows gateway settings but there are no backend webhook receivers for payment callbacks. Any online payment initiated via ICICI/HDFC has no reconciliation mechanism.

### Online Payment Flow (public-booking.ts)

```
Customer → Book online → POST /api/public-booking/
    ↓
Bill created with method="online" (excluded from inline payments at billing)
    → Note: bills.ts line 491: method "online" is excluded from validPayments
    → paidAmount = 0, status = "pending"
    ↓
Payment gateway redirect/QR
    ↓
Callback (webhook) → marks payment received
    → No ICICI/HDFC webhook handler found in routes/
    → Manual reconciliation required for gateway settlements
```

### Duplicate Payment Protection

- **Double-bill guard (bills.ts line 397-407):** Checks if order already has active bill → returns 409
- **10-second guard (line 409-424):** Prevents rapid duplicate bills for same patient within 10 seconds
- **Voucher duplicate guard (auto-voucher.ts line 122):** Retries on unique constraint violation (23505) up to 3 times

---

## PHASE 8 — EDGE CASES AUDIT

| Edge Case | Handling | Risk |
|-----------|----------|------|
| Partial payment | Supported — status="partial", balanceAmount tracks remainder | ✅ Low |
| Split payments | Supported — multiple payment rows per bill in single transaction | ✅ Low |
| Advance adjustment | NOT IMPLEMENTED as separate advance module | ⚠ Medium |
| Refund after several days | Fully supported — negative payment on old bill | ✅ Low |
| Refund after month-end | Supported — but totalAmount mutation crosses months | ⚠ HIGH |
| Refund after financial close | No hard stop — can refund anytime, even on closed day | ⚠ Medium |
| Cancelled bill | Supported — cascades to order_tests, zeroes balance | ✅ Low |
| Cancelled receipt | Not in UI — SA delete removes payments entirely | ⚠ Medium |
| Duplicate payment callback | No gateway callbacks implemented — N/A | ⚠ High (gap) |
| Gateway success, ERP failure | No webhook — manual entry required | ⚠ High |
| ERP success, gateway failure | Bill created but no money collected | ⚠ Medium |

---

## PHASE 11 — FRAUD & LEAK DETECTION

### Built-in Anomaly Checks (books-sanity.ts)

| Check | Severity | Description |
|-------|----------|-------------|
| Cancelled bill + active order_tests | HIGH | Commission leak — referral doctor still gets paid |
| total ≠ subtotal − discount + tax | HIGH | Arithmetic drift from super-admin edit |
| paid_amount ≠ Σ(payments) | HIGH | Payment ledger drift — bill and payment rows disagree |
| Cancelled bill with positive paid_amount | MEDIUM | Money never returned to patient |
| Discount > 50% of subtotal | LOW | Large discount flagged for CA review |
| Super-admin edit trail | LOW | Every SA edit, deletion, override for CA review |

### NEW FINDINGS FROM THIS AUDIT

| Finding | Location | Risk | Recommendation |
|---------|----------|------|----------------|
| **totalAmount reduced on refund** | bills.ts L1055 | HIGH | Keep originalTotal, deduct only from paidAmount |
| **No ICICI/HDFC webhook handlers** | routes/ directory | HIGH | Implement gateway webhook receivers |
| **GST tax_amount hardcoded to 0** | bills.ts L469 | MEDIUM | Implement GST calculation when required |
| **Expenses not linked to accounting** | expenses.ts | MEDIUM | Expense should auto-generate Payment Voucher |
| **Day-close doesn't validate refund cuts off** | day-close.ts | MEDIUM | Should warn if refunds > cash-in |
| **No advance/deposit module** | routes/ | MEDIUM | Patient advances not tracked as separate liability |
| **Auto-voucher fire-and-forget** | bills.ts L577-585 | LOW | Voucher failure silently logged — no alert |
| **Backdated expenses** | expenses.ts | LOW | expense_date can be any date — no validation |
| **No pharmacy GST separation** | No pharmacy route found | N/A | No pharmacy module in this ERP |

---

## SUMMARY RISK MATRIX

| Category | Risk Level | Action Required |
|----------|-----------|-----------------|
| totalAmount mutation on refund | 🔴 HIGH | Fix before production month-end |
| No payment gateway webhooks | 🔴 HIGH | Implement ICICI/HDFC receivers |
| GST implementation (tax=0) | 🟡 MEDIUM | Implement when GST registration required |
| Expense auto-voucher missing | 🟡 MEDIUM | Add auto-voucher trigger on expense creation |
| No advance deposit module | 🟡 MEDIUM | Design if advances are a business requirement |
| Books Sanity checks | 🟢 LOW | Already implemented, run regularly |
| Audit trail coverage | 🟢 LOW | Excellent — every mutation is logged |
| Double-billing protection | 🟢 LOW | Well-implemented — 2-layer guard |
| Refund date accounting | 🟢 LOW | Correctly attributed to refund date, not bill date |
