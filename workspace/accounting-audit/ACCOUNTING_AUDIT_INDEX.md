# CARE ERP — Accounting Forensic Audit — Index

Audit-first, evidence-based review of the Accounting, Billing, Payment, Expense,
Cash, Bank, Ledger, GST, Refund, Discount, Credit and Reconciliation systems.

- **Branch:** `claude/care-erp-accounting-audit-mcn6la`
- **Scope:** read-only audit. **No production behaviour was changed.** Only audit
  documents, a read-only SQL script, and a PDF report were produced.
- **Data-inconsistency status:** UNVERIFIED (no DB reachable; SQL authored, not run).

## Verdict

**Billing + collection system with a fragile single-entry voucher overlay — NOT
a genuine accounting system.** Structurally accounting-incomplete, and currently
unsafe for trustworthy closing without the Phase 0 emergency fixes.

## Findings tally

| Severity | Count |
|---|---:|
| P0 — critical financial-integrity risk | **5** |
| P1 — high risk | **16** |
| P2 — medium risk | **28** |
| P3 — low / maintainability | **13** |
| **Total** | **62** |

Removed by adversarial verification: 0. (Verification refined severity/verdict on
several findings; none were refuted out.)

## Documents

| # | File | Contents |
|---|---|---|
| 01 | [01-accounting-system-map.md](01-accounting-system-map.md) | System & financial-domain map, entities, money representation, model classification |
| 02 | [02-database-schema-audit.md](02-database-schema-audit.md) | Constraint gaps (CHECK/UNIQUE/FK), recommended additive DDL |
| 03 | [03-billing-payment-flow-audit.md](03-billing-payment-flow-audit.md) | Bill create → pay → refund → cancel → discount; delete-renumber P0 |
| 04 | [04-gateway-and-reconciliation-audit.md](04-gateway-and-reconciliation-audit.md) | Webhooks, signatures, idempotency, three-way reconciliation design |
| 05 | [05-cash-expense-and-closing-audit.md](05-cash-expense-and-closing-audit.md) | Drawer close (cash double-subtract P0), expenses, day-close |
| 06 | [06-gst-and-invoice-audit.md](06-gst-and-invoice-audit.md) | Tax engine absence, HSN/SAC, credit notes, invoice numbering |
| 07 | [07-security-and-permissions-audit.md](07-security-and-permissions-audit.md) | AuthN/Z, segregation of duties, audit-trail integrity |
| 08 | [08-reporting-accuracy-audit.md](08-reporting-accuracy-audit.md) | Date semantics, double-counts, gross-vs-net, UTC/IST |
| 09 | [09-data-quality-findings.md](09-data-quality-findings.md) | Schema-level anomalies feeding the SQL script |
| 10 | [10-accounting-gap-analysis.md](10-accounting-gap-analysis.md) | Double-entry gap, governance drift, target architecture |
| 11 | [11-remediation-roadmap.md](11-remediation-roadmap.md) | Phase 0–6 plan, PR breakdown, BC/migration notes |
| 12 | [12-test-strategy.md](12-test-strategy.md) | Billing/gateway/concurrency/timezone/DB-invariant matrix |
| 13 | [13-executive-summary.md](13-executive-summary.md) | Verdict, scorecard, top-10 risks, strengths, safeguards |
| — | [accounting-data-audit.sql](accounting-data-audit.sql) | Read-only anomaly-detection script (safe on a prod copy) |
| — | `CARE-ERP-Accounting-Audit.pdf` | Illustrated report (charts, flowcharts, diagrams) |

## The 5 P0 findings

1. **GST-02 / DQ-06** — bill delete renumbers issued invoices + hard-deletes payments (`bills.ts:1451`)
2. **SEC-01** — money-mutations bypass tamper-evident chain; `bill_audits` mutable/deletable (`bills.ts:989`)
3. **RPT-01** — per-user drawer close subtracts cash expenses twice (`day-close.ts:672`)
4. **DQ-01** — zero CHECK constraints in the financial schema (`0000_dear_forge.sql`)
5. **DQ-02** — reconcile DDL creates bills/payments/vouchers with no UNIQUE/FK (`zz_schema_reconcile_20260709.sql:142`)

## How this audit was produced

Multi-agent forensic pass (subsystem mapping → dimension audits → adversarial
verification of every P0/P1/P2 → synthesis). Several agents hit transient API
overload/session limits late in the run; the four dimension docs (06–09) and the
SQL script were produced by the workflow, and docs 01–05, 10–13 plus this index
were authored during synthesis from the verified-findings set, with the five P0s
and other top findings **re-confirmed by direct source reads**. Nothing here is a
legal/CA certification; GST items are flagged *requires-CA-validation*.
