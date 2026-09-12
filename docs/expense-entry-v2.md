# Expense Entry V2 — Bills & Payables

**Core rule:** BILL VALUE ≠ MONEY PAID.

## Schema
- `expenses` is the **bill header** (`bill_amount`, `payment_status`, vendor/invoice/department, `accounting_status`, void fields).
- `expense_payments` is the **canonical money movement** table (zero rows = unpaid).
- `expense_categories` configurable master (legacy string `category` retained).
- `vouchers.expense_payment_id` durable payment↔voucher link.

## Status derivation
- `totalPaid = 0` → `DUE`
- `0 < totalPaid < bill` → `PART_PAID`
- `totalPaid == bill` → `PAID`
- Overpayment rejected; concurrent payments use `SELECT … FOR UPDATE`.

## Accounting
- Fully paid (single payment = bill): Expense Dr / Cash·Bank Cr (payment voucher).
- Due / part-paid: Accrual JV (Expense Dr / Payable Cr) + payment PV (Payable Dr / Cash·Bank Cr) per payment.
- `accounting_status`: `POSTED | PENDING | FAILED | REVERSED | PARTIAL`.
- Retry: `POST /api/expenses/:id/accounting/retry` (idempotent).

## Day-close / cash (IMPORTANT — posting clock)

Only **cash** rows in `expense_payments` reduce physical cash. UPI/bank = digital (no drawer impact). Unpaid bill = ₹0 cash impact.

**Reconciliation date = `expense_payments.created_at` (posting clock), NOT `payment_date`.**

CARE day-close / daily-summary / my-daily-summary already window every other cash movement
(bills, receipts, refunds) by `created_at`. Expense payments follow the same contract so a
staff drawer closed "today" matches cash that actually left the drawer today.

- `payment_date` = **business / reference date** on the supplier bill or remittance advice
  (may be back-dated). It is shown in the UI and stored for reporting.
- `created_at` = **when CARE recorded the outflow** — this is what hits today's drawer.

A cash payment entered today with `payment_date = 2026-01-01` therefore reduces **today's**
cash drawer, not January's. Do not mix the two clocks.

## Legacy backfill
Historical expenses treated as fully paid: `bill_amount = amount`, one synthetic payment with original `created_at`, **no new vouchers**.

## API
- Legacy `POST /api/expenses` `{ amount, … }` → bill=paid=amount, status PAID.
- V2 fields: `billAmount`, `initialPaymentAmount`, vendor/invoice/tax/department/`paidFromAccountId`.
- `POST|GET /api/expenses/:id/payments`, `POST /api/expenses/:id/void`, payables + categories list endpoints.
- DELETE requires void reason (soft-void, no hard delete).

## UI
Expenses page: Paid / Part Paid / Due entry, Payables tab, detail drawer with payment history + Record Payment, OCR field confidence review, duplicate warnings, void confirmation.
