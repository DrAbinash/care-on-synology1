# 10 — Accounting Gap Analysis & Double-Entry Readiness

> What CARE ERP would need to become a *complete accounting system* rather than a
> billing + collection system. Framed as gaps against a standard hospital/
> diagnostic accounting platform.

---

## 1. Model gap: single-entry voucher overlay, not double-entry

| Concept | Present? | Evidence / gap |
|---|---|---|
| Chart of accounts | Partial | `accounts` + Tally groups (`accounting.ts:6-34`); no enforcement, `code` optional |
| General ledger | ❌ | No ledger-line entity; `vouchers` is single-row |
| Journal / journal line | ❌ | `vouchers` = 1 debit + 1 credit + 1 amount (DQ-08) |
| Balanced multi-line posting | ❌ | Cannot express > 2 legs (no GST split, no discount leg) |
| Account referential integrity | ❌ | `debit/credit_account_id` are `text`, no FK (DQ-09) |
| Fiscal period / period lock | ❌ | No FY concept, no Apr-1 boundary, no year-end close (RPT-18) |
| Posting date vs document date | ❌ | Dates are `text`; posting time = webhook/create time (RPT-10,17) |
| Immutable posted entries | ❌ | Vouchers hard-deletable (SEC-02); bills super-editable (GST-03) |
| Reversal (vs destructive edit) | ❌ | Edits mutate in place; delete renumbers (GST-02) |
| Trial balance (opening-aware) | ❌ | Ranged TB ignores pre-range movement (RPT-14) |
| P&L / balance sheet from entries | ❌ | Reports recomputed from operational tables (RPT-08) |
| AR / AP subledgers | ❌ | No receivable/payable ledger; credit billing untracked |
| Idempotency keys on postings | ❌ | Fire-and-forget, COUNT(*) numbering (RPT-15, DQ-17) |

**Consequence:** the "Trial Balance" and "P&L" screens are *reconstructions from
mutable operational data*, not readouts of a posted, balanced ledger. A
"balanced ✔" flag is near-tautological (RPT-14) and therefore not evidence of
correctness.

## 2. Governance-vs-reality drift

- `ACCOUNTING_PROTECTED_FILES.md` names a protected `ledger_lines`
  (`ledgerLinesTable`) table that **does not exist** in schema or code. The
  change-control narrative protects a table that was never built.
- `FINANCIAL_FREEZE_RULEBOOK.md` claims "42 core financial regression tests
  passed / 100/100". This must be validated against the actual test suite
  (see `12-test-strategy.md`); a claim in a doc is not a passing test.

## 3. Target future architecture (design only — DO NOT build during audit)

Additive, alongside existing tables (existing bills/payments/vouchers keep
working; new engine posts in parallel, then becomes source of truth):

```
accounting_accounts          -- typed COA, FK-enforced
accounting_fiscal_periods    -- open/closed, lockable
accounting_journals          -- header: source doc, status(draft|posted|reversed), idempotency_key
accounting_journal_lines     -- N lines per journal, debit/credit, account FK, cost_center
accounting_parties           -- patient/corporate/vendor/TPA subledger
accounting_payment_allocations
accounting_bank_transactions -- UTR-level bank feed
accounting_gateway_settlements
accounting_reconciliation_sessions
accounting_audit_events      -- append-only, hash-chained, actor+IP+device
```

Invariants the engine must guarantee:
- Every posted journal: `SUM(debit) = SUM(credit)` (DB trigger / CHECK on a
  materialised balance).
- Posted journals are **immutable**; corrections are **reversal journals**.
- `idempotency_key` UNIQUE per source event (payment, refund, settlement).
- Source-document linkage (bill/payment/refund/expense id) on every journal.
- Currency, branch, cost-centre, created-by/approved-by/posted-by/reversed-by,
  timestamps, external references.

## 4. Immediate (pre-architecture) gaps that must close first

These are not "future accounting"; they are integrity holes in the *current*
billing system and block trustworthy books today:

1. Stop destructive edits/deletes of bills, payments, vouchers, expenses
   (GST-02, SEC-01/02/03, DQ-06).
2. Enforce money invariants at the DB (DQ-01, DQ-02).
3. Make voucher posting reliable (not fire-and-forget) and reconcilable
   (RPT-15, DQ-05).
4. Global gateway-txn uniqueness + amount-bound signatures (DQ-04, SEC-04).
5. Correct the cash-close arithmetic (RPT-01).

## 5. Readiness score

Double-entry readiness: **2 / 10.** The data model actively resists double
entry (single-row voucher, text account refs, no periods, mutable postings). A
parallel journal engine is required; the current `vouchers` table cannot be
"upgraded" in place without a schema redesign and backfill. See
`11-remediation-roadmap.md` Phase 5.
