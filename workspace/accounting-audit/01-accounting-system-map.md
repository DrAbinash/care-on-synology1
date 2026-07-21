# 01 — CARE ERP Accounting System Map

> Forensic audit • audit-first • evidence-based. This document maps the *actual
> implemented* financial surface traced through schema, routes, services and
> print templates — not filenames or UI labels. Every claim carries a
> `file:line` anchor. Where the running system could not be exercised (no
> database reachable in the audit sandbox), the fact is marked **UNVERIFIED**.

Audit date: 2026-07-16 • Branch: `claude/care-erp-accounting-audit-mcn6la`

---

## 1. Repository shape

CARE ERP is a TypeScript monorepo:

| Layer | Location | Role |
|---|---|---|
| API server | `artifacts/api-server/src` | Express routes, services, payment webhooks, reports, exports |
| ERP frontend | `artifacts/diagnostic-erp/src` | React billing desk, dashboards, print templates |
| Shared DB | `lib/db/src/schema` + `lib/db/drizzle` | Drizzle ORM schema + generated SQL migrations |
| Ad-hoc migrations | `migrations/*.sql` | Hand-written reconcile/patch DDL applied on top of Drizzle |
| Governance docs | `SOP/`, `ACCOUNTING_PROTECTED_FILES.md`, `FINANCIAL_FREEZE_RULEBOOK.md` | Change-control narrative |

Money handling is concentrated in a small number of route files:
`bills.ts`, `accounting.ts`, `expenses.ts`, `gateway-webhooks.ts`,
`day-close.ts`, `daily-summary.ts`, `reports.ts`, `advanced-dashboard.ts`,
`ledgers.ts`, `orders.ts`, `public-booking.ts`, plus the posting service
`lib/auto-voucher.ts`.

---

## 2. Financial domain map (entities that actually exist)

| Table (schema file) | PK | Money columns | Type | Uniqueness | FK | Audit |
|---|---|---|---|---|---|---|
| `bills` (`schema/bills.ts:7`) | `serial id` | subtotal, discount, tax_amount, total_amount, paid_amount, balance_amount, refund_amount, original_total | `numeric(10,2)` | `bill_number` unique | order_id, patient_id | via `bill_audits` (mutable) |
| `payments` (`schema/bills.ts:48`) | `serial id` | amount | `numeric(10,2)` | **none** | bill_id | none |
| `accounts` (`schema/accounting.ts:34`) | `serial id` | opening_balance | `numeric(14,2)` | `code` unique | — | — |
| `vouchers` (`schema/accounting.ts:53`) | `serial id` | amount | `numeric(12,2)` | `voucher_number` unique | **none** (account ids are `text`) | `voucher_audits` |
| `voucher_audits` (`schema/accounting.ts:72`) | `serial id` | — | — | — | none | is the audit |
| `expenses` (`schema/expenses.ts:5`) | `serial id` | amount | `numeric` | — | — | none |
| `online_bookings` (`schema/onlineBookings.ts`) | `serial id` | amount | `numeric` | per-bill txn only | — | — |
| `day_closures` (`schema/dayClosures.ts`) | `serial id` | totals snapshot | `numeric` | — | — | — |
| `ledgers` (`schema/ledgers.ts:5`) | `serial id` | — | — | `name` unique | — | — |
| `audit_logs` (`schema/auditLogs.ts`) | `serial id` | — | — | — | — | hash-chain scaffold |

**Notes on representation**
- Monetary amounts are stored as PostgreSQL `numeric` (fixed precision) — **not
  float** — a genuine strength (`schema/bills.ts:12-28`). No float drift *in
  storage*. However *in-flight* arithmetic is JavaScript `Number` (see
  `bills.ts` refund math, `day-close.ts` bucketing), so rounding discipline is
  application-dependent.
- `ledgers` here is a **customer-group / walk-in grouping table**, NOT an
  accounting ledger. Do not confuse it with a general ledger.
- The governance file `ACCOUNTING_PROTECTED_FILES.md` lists a protected table
  `ledger_lines` (`ledgerLinesTable`). **That table does not exist** anywhere in
  `lib/db/src/schema` or code (grep: matches only in documentation). Governance
  drift — see finding cross-reference in `10-accounting-gap-analysis.md`.

### 2.1 Naming inconsistency of amount fields
`total_amount`, `paid_amount`, `balance_amount`, `refund_amount`,
`original_total`, `subtotal`, plus report-layer `netCollection`,
`physicalCashInHand`, `receivedAmount`. These are **cached, independently
written** representations of the same money, not distinct concepts. `bills`
alone exposes six mutable money columns with **ten independent writers** and no
reconciliation mechanism (DQ-03). The single source of truth (`SUM(payments)`)
and the cached `paid_amount` can silently diverge.

---

## 3. The money-flow, end to end

```
Service selection (orders)
    → price (client-supplied customPrice trusted, SEC-11 orders.ts:216)
    → bill create (tax_amount HARDCODED 0, bills.ts:549)
    → payment rows (no receipt entity; DQ-07)
    → cached totals on bill (paid/balance/refund; 10 writers, DQ-03)
    → fire-and-forget voucher (auto-voucher.ts; never throws → ledger drift)
    → reports recomputed from mutable operational tables (RPT-08)
    → day close (rolling window; cash double-subtract, RPT-01 P0)
```

Online path:
```
public booking → gateway order → provider redirect/QR
    → S2S webhook (signature verify mandatory now; amount not signature-bound HDFC, SEC-04)
    → settleBill (per-bill idempotency only; DQ-04)
    → booking confirm + payment row (dated at webhook processing time, RPT-10)
```

---

## 4. Accounting-model classification

**Verdict: a billing + collection system with a fragile single-entry voucher
overlay. It is NOT a genuine (double-entry) accounting system.**

Evidence the model is *not* double-entry:
- `vouchers` (`accounting.ts:53`) is a **single-row, two-column** record: exactly
  one `debit_account_id`, one `credit_account_id`, one `amount`. It cannot
  represent a split/multi-line journal (e.g. revenue + CGST + SGST as separate
  credit lines). There is no `journal` / `journal_line` entity. (DQ-08)
- `debit_account_id` / `credit_account_id` are **`text`** with **no foreign key**
  to `accounts` (whose PK is `serial`/integer). Postings can reference nothing.
  (DQ-09)
- Posting is **fire-and-forget**: `autoVoucherForPayment` "never throws — any
  failure is logged but NEVER blocks billing" (`auto-voucher.ts:126,181`). The
  ledger is therefore *best-effort* and provably divergeable from `bills`.
- Revenue is recognised on **payment** (cash basis), not on billing.
- No chart-of-accounts enforcement, no fiscal periods, no period lock, no trial
  balance that respects opening movement (RPT-14), no P&L/balance-sheet derived
  from balanced entries.

What *does* exist (billing-system features):
- Bills, payments, refunds (as negative payment rows), cancellations (status
  flip), discounts, a Tally-compatible **account group** vocabulary
  (`accounting.ts:6-32`), a voucher register, `voucher_audits`, day-closures,
  and a `books-sanity` check.

Conclusion for stakeholders: treat current outputs as **operational collection
tracking**, not audited books. The presence of a "vouchers" table and a
"Trial Balance" screen is **not** proof of accounting integrity (see the
skeptical-standard findings in `08` and `10`).

---

## 5. Cross-document index of subsystems

| Subsystem | Detailed in |
|---|---|
| Database schema & constraints | `02-database-schema-audit.md`, `09-data-quality-findings.md` |
| Billing / payment / refund / discount flows | `03-billing-payment-flow-audit.md` |
| Gateway, webhooks, idempotency, reconciliation | `04-gateway-and-reconciliation-audit.md` |
| Cash drawer, day-close, expenses | `05-cash-expense-and-closing-audit.md` |
| GST, invoice, credit/debit notes | `06-gst-and-invoice-audit.md` |
| Security, permissions, segregation of duties | `07-security-and-permissions-audit.md` |
| Reporting accuracy & date semantics | `08-reporting-accuracy-audit.md` |
| Accounting-model gap & double-entry readiness | `10-accounting-gap-analysis.md` |
| Phased remediation | `11-remediation-roadmap.md` |
| Test strategy | `12-test-strategy.md` |
| Executive summary & scorecard | `13-executive-summary.md` |
| Read-only data anomaly script | `accounting-data-audit.sql` |
