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

## Day-close / cash
Only **cash** rows in `expense_payments` reduce physical cash. Windowed by payment **`created_at`** (posting clock, same as rest of CARE day-close). UPI/bank = digital (no drawer impact). Unpaid bill = ₹0 cash impact.

## Legacy backfill
Historical expenses treated as fully paid: `bill_amount = amount`, one synthetic payment with original `created_at`, **no new vouchers**.

## API
- Legacy `POST /api/expenses` `{ amount, … }` → bill=paid=amount, status PAID.
- V2 fields: `billAmount`, `initialPaymentAmount`, vendor/invoice/tax/department/`paidFromAccountId`.
- `POST|GET /api/expenses/:id/payments`, `POST /api/expenses/:id/void`, payables + categories list endpoints.
- DELETE requires void reason (soft-void, no hard delete).

## UI
Expenses page: Paid / Part Paid / Due entry, Payables tab, detail drawer with payment history + Record Payment, OCR field confidence review, duplicate warnings, void confirmation.
