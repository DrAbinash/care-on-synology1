# 13 — Executive Summary

CARE ERP • Accounting / Billing / Payment forensic audit
Branch: `claude/care-erp-accounting-audit-mcn6la`

---

## A. Overall conclusion

**Billing-capable but accounting-incomplete — and currently unsafe for
trustworthy financial closing without emergency fixes.**

CARE ERP is a competent **billing + collection** system carrying a **fragile
single-entry voucher overlay** that is presented (in screens and governance
docs) as double-entry accounting. It is **not** a genuine accounting system: the
ledger cannot express balanced multi-line journals, revenue is recognised on a
cash basis by a *fire-and-forget* poster that provably diverges from bills, and
the database enforces essentially none of the money invariants. On top of that
structural weakness sit **five P0 defects** that can destroy or silently corrupt
financial records today.

The skeptical standard applies throughout: a "Trial Balance" screen, a "paid"
status, and a "42 tests passed" note in a doc are **not** evidence of integrity —
each was traced and, where the DB was unreachable, explicitly marked unverified.

## B. Audit scorecard (0 = absent/broken, 10 = production-grade)

| Area | Score | Basis |
|---|---:|---|
| Billing integrity | 3 | Mutable finalised invoices, delete+renumber, 10-writer cached totals |
| Payment integrity | 4 | Per-bill idempotency only, no global txn uniqueness, fire-and-forget vouchers |
| Refund safety | 6 | Refund handler well-built (lock+guard+audit); no credit note |
| Cash control | 2 | Drawer arithmetic double-subtracts; no count-vs-expected variance |
| Bank reconciliation | 2 | Payment-success confused with settlement; no three-way recon |
| Expense control | 2 | Self-approve, unaudited delete, double-post on edit |
| GST readiness | 1 | No tax engine, no HSN, no CGST/SGST split, no credit notes |
| Audit trail | 3 | bill_audits mutable/deletable, actor spoofable, chain admits unhashed |
| Role security | 3 | Settlement needs only auth; body-token super-admin; OTP echoed |
| Reporting accuracy | 3 | UTC/IST mixups, double-counts, cancelled included, gross≠net |
| Database integrity | 2 | Zero CHECK constraints; reconcile DDL may drop uniqueness/FK |
| Concurrency safety | 4 | Refund path locked (good); voucher-number race; cached-total races |
| Test coverage | 3 | Claimed but unverified; no gateway/concurrency/timezone/DB-invariant matrix |
| Double-entry readiness | 2 | Single-row voucher, text account refs, no periods, mutable postings |

## C. Top 10 critical risks (priority order)

1. **P0 · GST-02 / DQ-06** — `DELETE /bills/:id` **renumbers already-issued
   invoices** and hard-deletes their payments, stranding posted vouchers.
   (`bills.ts:1451,1498-1524`)
2. **P0 · SEC-01** — core money-mutations write only to a **mutable, deletable**
   `bill_audits` table; no tamper-evident trail for the numbers that matter.
   (`bills.ts:989`)
3. **P0 · RPT-01** — per-user drawer close **subtracts cash expenses twice**;
   cash reconciliation is arithmetically wrong. (`day-close.ts:672-675`)
4. **P0 · DQ-01** — **zero CHECK constraints** in the financial schema; negative
   bills, over-refunds, >100% discounts are DB-legal. (`0000_dear_forge.sql`)
5. **P0 · DQ-02** — reconcile DDL bootstraps bills/payments/vouchers with **no
   unique constraints and no FKs**. (`zz_schema_reconcile_20260709.sql:142`)
6. **P1 · SEC-11** — client-trusted `customPrice` + inline-payment mass
   assignment at the order/bill boundary → price manipulation. (`orders.ts:216`)
7. **P1 · DQ-04** — **no global uniqueness** for gateway txn identity; webhook vs
   manual-reconcile use different references → duplicate receipts.
8. **P1 · SEC-04 / SEC-05** — webhook signature doesn't bind the amount and has
   no nonce; settlement endpoints require only authentication, not authorization.
9. **P1 · DQ-05 / SEC-03** — expense edit double-posts the ledger; expense delete
   is unaudited and strands vouchers.
10. **P1 · GST-03** — finalised invoices are editable in place (incl. negative
    tax) with no credit note → retroactive turnover changes. (`bills.ts:1364`)

## D. Existing strengths (already done well)

- **Refund handler** (`bills.ts:1140`): `FOR UPDATE` lock, `refund ≤ paid` guard,
  `total_amount` preserved, atomic write + audit row. Use as the template.
- **Webhook signature verification is now mandatory** (rejects missing
  hash/secret) — a real improvement over prior skippable verification.
- **Money stored as `numeric`, not float** — no storage-level float drift.
- Concurrency on the refund path is correctly serialised by row locking.
- Some audit scaffolding exists (`bill_audits`, `voucher_audits`, `audit_logs`
  hash-chain) and a `books-sanity` check — a foundation to build on.
- Tally-compatible account-group vocabulary is defined.

## E. Immediate production safeguards (before deeper work) — Phase 0

Fix the cash double-subtract (1 line); replace bill delete-renumber with
soft-cancel; freeze in-place edits of finalised bills; add DB CHECK/UNIQUE/FK
(after quarantining violators); bind amount+nonce into webhook signatures and
make them retry-safe; add authorization to settlement; reject client prices; stop
echoing the OTP; audit/gate expense delete and reverse-on-edit. Details:
`11-remediation-roadmap.md`.

## F. Long-term accounting architecture

Introduce a **parallel double-entry journal engine** (balanced multi-line
journals, immutable posted entries + reversals, fiscal periods with lock,
opening-aware trial balance, P&L/balance sheet from posted entries, AR/AP
subledgers, cost centres), then migrate reporting onto it. The current `vouchers`
table cannot be upgraded in place. All GST/statutory rules require the
organisation's CA sign-off. Phases 4–5 of the roadmap.

---

### Data-inconsistency status

**UNVERIFIED.** No database was reachable in the audit sandbox, so
`accounting-data-audit.sql` was authored and schema-checked but **not executed**.
Whether existing production data is actually inconsistent (duplicate invoice
numbers, orphan vouchers, `paid ≠ SUM(payments)`, etc.) must be determined by
running that read-only script against a production copy.

### Confidence taxonomy

Findings are tagged CONFIRMED (traced to code with a reproducible mechanism),
PLAUSIBLE (strong code evidence, one runtime assumption unverified), or
NOT-VERIFIED (P3, plausible but unexercised). The 5 P0s and the delete-renumber,
cash double-subtract, expense double-post, and refund-handler strength were
**re-verified by direct read** during synthesis. GST/statutory items are marked
*requires-CA-validation* and are not legal certifications.
