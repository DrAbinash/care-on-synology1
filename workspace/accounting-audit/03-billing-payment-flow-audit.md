# 03 — Billing, Payment, Refund & Discount Flow Audit

> End-to-end trace of the money-touching request paths in
> `artifacts/api-server/src/routes/bills.ts`, `orders.ts`, and the posting
> service `lib/auto-voucher.ts`. Confirmed defects are separated from
> architectural weaknesses and unverified business rules.

---

## 1. Bill creation (`POST /api/bills`, `bills.ts:373`)

Flow: parse → resolve order/patient → compute totals → insert bill → insert
payment(s) → fire voucher.

- **GST-01 / DQ-14 (P2 / confirmed):** `tax_amount` is **hardcoded to `0`**
  (`bills.ts:549`, also `self-registration.ts:192`). No tax-rate config, no
  per-service taxability, no exemption model. The number is not computed; it is
  a literal.
- **SEC-11 (P1, confirmed):** at the order/bill boundary (`orders.ts:216`) a
  client-supplied `customPrice` is trusted and inline payments are accepted with
  weak validation — **price manipulation / mass assignment**. A caller can set
  the price of a service to any value.
- **DQ-07 (P1):** there is **no receipt entity**. A payment row doubles as a
  receipt, so receipt-level uniqueness/immutability is inexpressible.
- Idempotency for network retries relies on `client_ref` (`bills.ts:37`), which
  was historically dropped from the schema so the guard was a no-op — **legacy
  duplicate bills may exist** (DQ-16).

## 2. Payment capture (`paymentsRouter POST /`, `bills.ts:1879`) & cached totals

- Adding a payment updates the bill's cached `paid_amount` / `balance_amount`.
- **DQ-03 (P1):** these cached totals have **ten independent writers** across
  create, add-payment, refund, cancel, super-edit, swap-test, change-doctor,
  ledger-reset, etc., with **no reconciliation** back to `SUM(payments)`. Any
  missed update silently desynchronises the bill from its payment history.
- Voucher posting is fire-and-forget (`auto-voucher.ts`, never throws), so a
  captured payment may **not** appear in the ledger, understating the P&L
  (RPT-15).

## 3. Refund (`POST /api/bills/:id/refund`, `bills.ts:1140`) — **a strength**

This path is correctly engineered and should be the template for others:
- `SELECT … FOR UPDATE` row lock serialises concurrent refunds (`bills.ts:1171`).
- Guard `amount > currentPaid` rejects over-refund (`bills.ts:1178`).
- `total_amount` is **preserved** (never mutated by a refund) for historical
  revenue accuracy (`bills.ts:1187-1195`).
- Refund written as a negative `payments` row + a `bill_audits` row, atomically
  (`bills.ts:1208-1232`).
- Permission-gated: `requireStaffSubPermission("/billing","refund")`.

Residual gaps (not defects in this handler, but system-level):
- **GST-04 (P2):** the refund produces **no credit note** — no numbered GST
  document, as CGST s.34 expects.
- Actor identity falls back to a body field `performedBy` when no session name
  (`bills.ts:1154`) — spoofable attribution (SEC-07).

## 4. Cancellation (`POST /api/bills/:id/cancel`, `bills.ts:950`)

- Cancellation **flips `status` to `cancelled`** (`bills.ts:979-987`); it does not
  reverse the posted revenue voucher and produces no credit note (GST-04).
- **RPT-03 / RPT-08:** downstream reports handle cancellations inconsistently —
  some double-subtract them, some book the cancellation to the bill's *creation*
  day rather than the cancellation day. Historical daily totals therefore change
  retroactively.

## 5. Mutation of finalised bills — **immutability is not enforced**

- **GST-03 (P1, confirmed):** `PATCH /api/bills/:id/super-edit`
  (`bills.ts:1364-1418`) rewrites `subtotal/discount/tax_amount/total_amount`
  **in place** on the issued bill row. The zod schema accepts **any number,
  including negatives** (`api.ts:1956-1962`). `PUT /api/bills/:id`
  (`bills.ts:751-802`) similarly rewrites discount/total. A finalised invoice —
  and therefore a closed period's turnover — can change retroactively, with no
  supplementary (credit/debit-note) document.
- **GST-02 / DQ-06 (P0, confirmed):** `DELETE /api/bills/:id`
  (`bills.ts:1451`) **hard-deletes** the bill and **all its payment rows**
  (`bills.ts:1498-1499`), resets the order, and then **renumbers every later
  invoice in the month down by one** (`bills.ts:1502-1524`). This:
  1. destroys settlement/payment evidence (only one `bill_audits` row survives,
     recording just the old number);
  2. **violates invoice-number immutability** — a number a patient/GST portal
     already saw is reassigned to a different bill;
  3. **strands the posted vouchers**, which still reference the deleted `bill_id`
     and are not reversed → the ledger and `bills` permanently diverge.
  Gated by a super-admin token *in the request body* (SEC-09), not a re-checked
  role. **This is the single most damaging financial defect in the system.**

## 6. Discounts & concessions

- Discount is a bill-level `numeric` field with a free-text `discount_reason`
  (`schema/bills.ts:13-15`). There is **no maximum-discount limit, no approval
  workflow, and no separate approver identity** — the same cashier who bills can
  discount without a second signature (see segregation-of-duties matrix in `07`).
- Because `super-edit`/`PUT` can lower `total`/`discount` **after** payment, a
  cashier/super-admin can reduce a bill after money is received and pocket the
  difference with no immutable trail (SEC-01, GST-03). This is the classic
  "reduce-the-bill-after-collecting" fraud vector the audit brief calls out.

## 7. Partial / split / advance payments

- The `payments` table supports multiple rows per bill, so **partial and split
  tender are representable**. But there is no explicit "advance", "overpayment",
  or "wallet" concept; overpayment would simply make `paid_amount > total_amount`
  with no DB guard (DQ-01) — an accidental over-collection is silently storable.

---

## 8. Flow-level severity roll-up

| ID | Sev | One-line |
|---|---|---|
| GST-02 / DQ-06 | **P0** | Delete renumbers invoices, hard-deletes payments, strands vouchers |
| SEC-11 | **P1** | Client-trusted custom price + inline-payment mass assignment |
| GST-03 | **P1** | Finalised invoices mutable in place (incl. negative), no credit note |
| DQ-03 | **P1** | Cached bill totals: 10 writers, no reconciliation |
| DQ-07 | **P1** | No receipt entity |
| GST-01 / DQ-14 | P2 | tax_amount hardcoded 0 |
| GST-04 | P2 | Refund/cancel produce no credit note |
| Refund handler | ✅ | Correct locking + guards + audit — reuse as template |
