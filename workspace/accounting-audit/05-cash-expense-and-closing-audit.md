# 05 — Cash, Expense & Daily-Closing Audit

> Trace of `day-close.ts`, `daily-summary.ts`, `expenses.ts`, `dayClosures`
> schema. The question the brief poses: *can the system detect missing cash?*
> Short answer: **no — and worse, the drawer arithmetic is wrong.**

---

## 1. Cash drawer / day close

### 1.1 P0 — cash expenses subtracted twice (`day-close.ts:672-675`)

Confirmed by direct read. In `summarizeUserWindow` (the per-cashier drawer
close):

```ts
const { cashExpenses } = splitCashExpenses(expRows);
totals.cash  -= cashExpenses;
totals.total -= cashExpenses;
totals.cash  -= cashExpenses;   // ← duplicated
totals.total -= cashExpenses;   // ← duplicated
```

Every cashier whose window contains a cash expense has their **expected cash
understated by exactly the expense amount**. The physical cash count will then
appear to *exceed* the system expectation by that amount — a phantom surplus —
masking real shortfalls of the same size. **RPT-01.** This is a one-line fix but
a P0 because it corrupts the core cash-reconciliation number.

### 1.2 The closing equation is not enforceable

The brief's target invariant:

```
opening + receipts + transfers_in − refunds − cash_expenses − deposits − transfers_out
   = expected closing cash
```

- There is **no opening-balance / shift-open concept** and no
  physical-count-vs-expected variance capture with supervisor sign-off.
- **DQ-12 (P2):** `day_closures` (`schema/dayClosures.ts:12`) stores totals but
  **not the identity set of payments certified**, so a close cannot be
  reconciled to "exactly these rows"; **backdated inserts into a closed window
  are undetectable.**
- **RPT-09 (P3):** day close is a *rolling window* with a point-in-time IST
  label, **not a calendar day**, so it is incomparable to the calendar-day
  reports (`day-close.ts:198`). Two "day" numbers in the product mean different
  things.
- **RPT-03 (P2):** `netCollection` / `physicalCashInHand` in `daily-summary.ts`
  double-subtract cancellations, mix date bases, and drop cash received against
  old dues (`daily-summary.ts:136`).

**Conclusion:** "daily collection" is *computed from invoices/payments*, not
reconciled against a counted drawer, and the computation itself is defective.
The system **cannot reliably detect missing cash.**

## 2. Expenses (`expenses.ts`)

### 2.1 P1 — editing an expense double-posts the ledger (`expenses.ts:159-168`)

Confirmed by read. On `PATCH /:id`, if `amount` or `paymentMode` changed, the
code fires a **new** `autoVoucherForExpense` for the *full updated amount* with
`expenseId + "-edit"`, while **"the original PV remains for audit."** No reversal
of the original voucher. Editing a ₹100 expense to ₹120 leaves **₹220** of
expense in the ledger for a single ₹120 expense. **DQ-05.**

### 2.2 P1 — create / self-approve / hard-delete under one permission (`expenses.ts:211`)

- `DELETE /:id` (`expenses.ts:211-217`) hard-deletes the expense with **no audit
  row, no reason, no super-admin gate** (unlike bill delete). The posted
  voucher(s) survive → ledger keeps an expense the operational table says is
  gone. **SEC-03.**
- `approved_by` is a **free-text body field** (`expenses.ts:121`), not a verified
  session identity — the same actor can create, approve and delete. No
  segregation of duties. **DQ-15 / SEC-03.**
- No evidence-required constraint; expenses can be created without an attachment,
  backdated (`expense_date` is writable text), or duplicated.

### 2.3 Date-basis inconsistency (`RPT-05`, P1)

Expense **reports** key on the backdatable `expense_date`, while
**reconciliation** keys on `created_at` (`advanced-dashboard.ts:104`). The same
expense can appear in one day's P&L and a different day's cash reconciliation.

## 3. Purchase / vendor payable

- Expenses and `outsource_vendor_invoices` carry **TDS** fields but **zero GST**
  data (GST-11) and no partial-vendor-payment ledger. Vendor payables and ageing
  are not modeled.

## 4. Severity roll-up

| ID | Sev | One-line |
|---|---|---|
| RPT-01 | **P0** | Per-user drawer close subtracts cash expenses twice |
| DQ-05 | **P1** | Expense edit double-posts the voucher (original retained) |
| SEC-03 | **P1** | Expense create/self-approve/hard-delete under one perm; delete unaudited |
| RPT-05 | **P1** | Expense report date basis (expense_date) ≠ reconciliation (created_at) |
| RPT-03 | P2 | daily-summary double-subtracts cancellations, mixes date bases |
| DQ-12 | P2 | Day close not reconcilable to its payment set; backdating undetectable |
| DQ-15 | P2 | Expenses carry no verified user identity; approval optional free text |
| RPT-09 | P3 | Day close is a rolling window mislabeled as a day |
