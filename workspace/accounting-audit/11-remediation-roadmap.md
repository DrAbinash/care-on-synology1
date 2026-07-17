# 11 — Remediation Roadmap (Phased)

> Backward-compatible wherever possible. Preserves existing patient records,
> invoices, receipts, bookings, callbacks, provider references, report URLs, and
> Docker/Synology deployment. No phase renames a public API contract or alters
> payment-provider request formats. Each item cites the finding it closes.

Legend: **BC** = backward-compatible · **MIG** = data migration required.

---

## Phase 0 — Emergency safeguards (days, not weeks)

Goal: stop irreversible financial damage and the worst manipulation vectors.

| # | Action | Closes | BC | MIG |
|---|---|---|---|---|
| 0.1 | Replace `DELETE /bills/:id` **renumber+hard-delete** with soft-cancel (`status='cancelled'`, immutable number); never reassign issued numbers | GST-02, DQ-06 | ✅ | ✅ (backfill deleted-gap audit) |
| 0.2 | Freeze in-place edits of finalised bills (`super-edit`, `PUT`): require a reversal/credit-note path; reject negative amounts at zod | GST-03 | ✅ | — |
| 0.3 | Fix cash double-subtract (delete duplicated two lines) | RPT-01 | ✅ | — |
| 0.4 | Add DB uniqueness + FKs asserted by reconcile DDL; verify live schema matches | DQ-02 | ✅ | verify |
| 0.5 | Add `CHECK` constraints (non-negative, discount≤subtotal, refund≤total) after quarantining violators | DQ-01 | ✅ | ✅ |
| 0.6 | Bind amount+nonce into webhook signatures; reject with 4xx/5xx on failure | SEC-04, SEC-10 | ✅ | — |
| 0.7 | Add authorization (role) checks to settlement/booking-confirm; stop trusting body `performedBy`/token for identity | SEC-05, SEC-07, SEC-09 | ⚠️ | — |
| 0.8 | Reject client-supplied `customPrice`; server-side price lookup | SEC-11 | ⚠️ | — |
| 0.9 | Stop returning OTP in the HTTP response | SEC-06 | ✅ | — |
| 0.10 | Audit + gate expense delete; reverse (not orphan) vouchers on expense edit | SEC-03, DQ-05 | ✅ | — |

Acceptance: no route can destroy or renumber an issued financial document; DB
rejects negative/over-refund/duplicate rows; webhooks are replay-resistant and
retry-safe; cash-close arithmetic verified against a seeded fixture.

## Phase 1 — Financial-integrity foundation

| Scope | Closes | Notes |
|---|---|---|
| Canonical money handling (integer paise or a single `Money` helper) for all in-flight arithmetic | rounding risks | BC |
| Wrap every multi-step financial write in a transaction (assert atomicity) | DQ-03, RPT-15 | BC |
| Introduce a **receipt** entity + one-active-receipt-per-payment | DQ-07 | MIG |
| Make voucher posting reliable (transactional, idempotency key, not fire-and-forget) + a payments↔vouchers reconciler | RPT-15, DQ-05, DQ-17 | MIG |
| Global `UNIQUE(provider, provider_txn_id)` on payments | DQ-04 | MIG |
| Append-only, hash-chained audit events with actor/IP/device | SEC-01, SEC-12, DQ-11, DQ-13 | MIG |
| Finalisation rules: posted bill immutable, corrections via reversal | GST-03, SEC-02 | BC |

Acceptance: `SUM(payments) == bill.paid_amount` for all bills; every payment has
exactly one voucher; audit chain verifies; duplicate gateway txn impossible at DB.

## Phase 2 — Cash & reconciliation

Cashier sessions (open/close, opening balance), physical-count vs expected
variance with supervisor sign-off, day-close bound to an immutable payment set
(DQ-12), gateway settlement + bank-UTR ingestion, three-way reconciliation
(`04 §3`). Fixes RPT-03/09, DQ-12. MIG for new tables.

## Phase 3 — Receivables, payables, expense control

Credit/corporate/TPA subledgers with limits + approval + ageing; vendor payables
+ partial settlement; expense approval workflow with verified approver identity
and mandatory evidence. Closes credit-billing and expense-control gaps
(GST-11, DQ-15, SEC-03).

## Phase 4 — GST & statutory reporting (**CA validation required**)

Per-line HSN/SAC + taxable value + CGST/SGST/IGST split, place of supply,
recipient GSTIN with checksum validation, credit/debit-note series, healthcare
exemption modeling, Bill-of-Supply vs Tax-Invoice templates, reproducible GSTR/
tax register, per-registration (branch) invoice series. Closes GST-01/03/04/05/
07/08/10, RPT-18. **Every rule here must be signed off by the organisation's CA/
GST professional before it drives real documents.**

## Phase 5 — Double-entry accounting core

Parallel journal engine (`10 §3`): balanced multi-line journals, immutable
posted entries + reversals, fiscal periods with lock, opening-aware trial
balance, P&L/balance sheet from posted entries, cost centres. MIG (backfill from
historical bills/payments). Highest effort; depends on Phases 1–2.

## Phase 6 — Advanced controls

Period locking, approval matrix, exception dashboard (auto-flag the anomalies in
`accounting-data-audit.sql`), automated reconciliation, anomaly/fraud detection.

---

## Recommended PR breakdown (Phase 0)

1. `fix/cash-close-double-subtract` (RPT-01) — 1-line, ship first.
2. `fix/bill-delete-soft-cancel` (GST-02/DQ-06) — replace renumber path.
3. `fix/finalised-bill-immutability` (GST-03) — reversal-only edits.
4. `db/financial-constraints` (DQ-01/02) — additive DDL + quarantine report.
5. `sec/webhook-signature-and-authz` (SEC-04/05/10) .
6. `sec/reject-client-price-and-otp-leak` (SEC-11/06).
7. `fix/expense-edit-reverse-and-delete-audit` (DQ-05/SEC-03).

Each PR: unit + integration tests from `12-test-strategy.md`, a migration
dry-run against a production *copy*, and an explicit backward-compatibility note.
