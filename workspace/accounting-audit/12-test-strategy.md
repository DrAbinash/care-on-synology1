# 12 — Test Strategy & Required Test Matrix

> The audit could **not** execute the suite (no database reachable in the audit
> sandbox), so `FINANCIAL_FREEZE_RULEBOOK.md`'s "42 tests passed / 100/100" is
> **UNVERIFIED**. This document specifies the matrix that *should* exist and maps
> each row to the finding it would have caught.

---

## 1. Coverage gaps (inferred from the defects that reached `main`)

The presence of P0/P1 defects like the cash double-subtract (RPT-01) and the
delete-renumber (GST-02) implies the current suite does **not** cover:
drawer arithmetic with cash expenses, invoice-number immutability, expense-edit
ledger effects, gateway idempotency across paths, or DB-level invariants.

## 2. Billing matrix

| Case | Asserts | Guards finding |
|---|---|---|
| Normal cash bill | totals, one payment, one voucher | DQ-03, RPT-15 |
| UPI bill | method bucketed, not dropped | RPT-04 |
| Split payment (cash+UPI) | `SUM(payments)=paid` | DQ-03 |
| Partial payment then balance | status transitions | §billing |
| Over-payment | rejected or flagged (no silent `paid>total`) | DQ-01 |
| Discounted bill | discount≤subtotal enforced at DB | DQ-01 |
| Free bill | zero total handled | — |
| Cancelled bill | status flip, revenue reversed, not double-subtracted in reports | RPT-03/08 |
| Edit before finalize | allowed | GST-03 |
| **Edit after finalize** | **rejected / reversal-only** | GST-03 |
| **Delete issued bill** | **soft-cancel; number NOT reused; later numbers unchanged; vouchers reversed** | GST-02, DQ-06 |
| Negative amount via super-edit | rejected at zod + DB | GST-03, DQ-01 |
| Client-supplied customPrice | ignored; server price used | SEC-11 |

## 3. Payment-gateway matrix

| Case | Asserts | Guards |
|---|---|---|
| Successful payment | one payment, one booking, one voucher | DQ-04 |
| Failed / pending | no confirmation | — |
| **Duplicate callback (same txn)** | exactly one payment | DQ-04 |
| **Duplicate across paths (webhook vs manual reconcile)** | still one payment | DQ-04 |
| Invalid signature | 4xx/5xx, gateway retries, no settle | SEC-04, SEC-10 |
| **Replay with tampered amount** | rejected (amount signature-bound) | SEC-04 |
| Callback after midnight | dated to gateway timestamp, correct FY-day | RPT-10 |
| Refund / partial refund | negative payment, credit note issued | GST-04 |
| Duplicate refund | rejected (refund≤paid) | refund handler ✅ |

## 4. Concurrency matrix

| Case | Asserts | Guards |
|---|---|---|
| Two cashiers pay one bill | `paid` correct, no lost update | DQ-03 |
| Two refunds on one payment | serialised by `FOR UPDATE`; no over-refund | refund ✅ |
| Duplicate invoice generation under load | unique `bill_number` holds | DQ-02 |
| Two vouchers racing on COUNT(*)+1 number | unique index + retry, no dup | DQ-17 |
| Close drawer while payment arrives | payment attributed to correct window | DQ-12 |

## 5. Reporting / timezone matrix (Asia/Kolkata; server runs UTC)

| Case | Asserts | Guards |
|---|---|---|
| Payment & invoice same IST day | same day bucket | RPT-06/07 |
| 23:59 IST vs 00:01 IST | correct IST day, not UTC | RPT-07/16/17 |
| Mar-31 vs Apr-1 (FY boundary) | correct FY series/period | RPT-18, GST-13 |
| Refund on a later date | counted in refund period, not payment period | RPT-20 |
| Cancelled bill in daily totals | excluded once, on cancel day | RPT-03/08 |
| Cash close vs calendar report | reconcile or clearly labeled different | RPT-09 |
| Gross vs net revenue across dashboards | consistent definition | RPT-20 |

## 6. Database-invariant tests (run against a schema migration test DB)

Assert each constraint from `02 §3` actually rejects: negative amounts,
`discount>subtotal`, `refund>total`, duplicate `bill_number`, duplicate
`(provider, provider_txn_id)`, orphan payment (bad `bill_id`), voucher with a
non-existent account id.

## 7. Recommended tooling

- Integration tests against an ephemeral Postgres (testcontainers / docker) so
  DB constraints are exercised, not mocked.
- A CI job that runs `accounting-data-audit.sql` against a production *copy* and
  fails on any non-zero anomaly count.
- Property-based tests for the money invariants in `11 §Phase 1`.
