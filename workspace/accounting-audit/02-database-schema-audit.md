# 02 — Database Schema & Constraint Audit

> Which financial invariants the **database itself** enforces vs. which are
> only defended in application code (and therefore bypassable by any other
> writer, migration, or bug). Companion to `09-data-quality-findings.md`, which
> lists the anomaly-detection queries.

---

## 1. Headline: the database enforces almost nothing financial

**DQ-01 (P0, CONFIRMED-class):** There are **zero `CHECK` constraints** anywhere
in the financial schema (`lib/db/drizzle/0000_dear_forge.sql` and siblings).
Every money invariant — non-negative amounts, `refund ≤ paid`,
`discount ≤ subtotal`, `paid ≤ total`, `tax ≥ 0` — is enforced *only* in
TypeScript, if at all. The DB will accept a `-5000.00` bill, a `999%` discount,
or a refund larger than every payment, if any code path or manual SQL writes it.

**DQ-02 (P0):** The hand-written reconcile DDL
`migrations/zz_schema_reconcile_20260709.sql:142` bootstraps `bills`,
`payments` and `vouchers` with **no unique constraints and no foreign keys**,
and `bill_number DEFAULT ''` (only a *non-unique* index). This diverges from the
Drizzle baseline `0000_dear_forge.sql:122` which *does* make `bill_number`
unique. Whichever DDL actually ran in production determines whether duplicate
invoice numbers, duplicate gateway transactions, and orphan payment/voucher rows
are DB-legal. **This must be checked against the live schema** (see
`accounting-data-audit.sql` §schema-introspection). Until confirmed, treat
uniqueness as **not guaranteed at the database level**.

---

## 2. Table-by-table constraint gaps

### 2.1 `bills` (`schema/bills.ts:7`)
- ✅ `bill_number` unique (Drizzle baseline). ⚠️ possibly dropped by reconcile DDL (DQ-02).
- ❌ No CHECK on any amount (DQ-01).
- ❌ No `branch_id` / facility linkage — a two-entity group (Care Diagnostics +
  Hope Hospital) cannot attribute a bill to a registration (GST-08).
- ❌ `status` is free `text` default `'pending'` — no enum/constraint; any string
  is storable.
- ❌ No soft-delete column; deletion is physical (see `03`, `07`).
- ⚠️ Six mutable cached money columns, ten writers, no reconciliation (DQ-03).
- ⚠️ `client_ref` idempotency column was historically dropped from the Drizzle
  model, so retried creations were never recognised — legacy duplicate
  bills/orders may persist (DQ-16). Now present (`bills.ts:37`) but old data
  cannot be trusted.

### 2.2 `payments` (`schema/bills.ts:48`)
- ❌ **No unique constraint** on `(bill_id, reference_number)` or on
  `reference_number`. Idempotency for gateway settlement is application-only
  (DQ-04). See `04-gateway-and-reconciliation-audit.md §3`.
- ❌ No CHECK `amount <> 0` or sign rules; refunds are negative rows, so the sign
  carries semantics with no DB guard.
- ❌ No receipt entity — a payment is the closest thing to a receipt, so
  "one active receipt per payment" is **structurally inexpressible** (DQ-07).
- `method` is free `text`; report code hardcodes method lists and silently drops
  unknown methods (RPT-04).

### 2.3 `vouchers` / `accounts` (`schema/accounting.ts`)
- ❌ Single-row voucher cannot express debit/credit *imbalance* — the "balanced"
  property is tautological, so a trial-balance "balanced ✔" is near-meaningless
  (DQ-08, RPT-14).
- ❌ `debit_account_id` / `credit_account_id` are `text` with **no FK** to
  `accounts` (DQ-09). Postings can dangle.
- ❌ `vouchers.date` and `expenses.expense_date` and `bills.due_date` are stored
  as **`text`**, not `date`/`timestamptz` (DQ-10) — no DB-level date validity,
  and string comparison for ranges.
- ❌ Voucher numbering is `COUNT(*)+1` (`auto-voucher.ts:101`) and vouchers can be
  hard-deleted, so numbers are **recycled** (DQ-17). Uniqueness index + a retry
  loop is the only guard; a gap-free monotonic series is not guaranteed.

### 2.4 `expenses` (`schema/expenses.ts:5`)
- ❌ No user identity column; `approved_by` is optional free text (DQ-15).
- ❌ No CHECK on amount; no evidence-required constraint.

### 2.5 `day_closures` (`schema/dayClosures.ts:12`)
- ❌ Stores totals but **not the identity set of payments it certified**, so a
  close cannot be reconciled to "exactly these payment rows"; backdated inserts
  into a closed window are undetectable at the DB level (DQ-12).

### 2.6 `audit_logs` (`schema/auditLogs.ts:32`)
- ⚠️ Hash-chain scaffold exists but **admits unhashed rows by default** (DQ-13),
  so the chain is not tamper-evident end-to-end.
- ❌ `bill_audits` / `voucher_audits` rows lack `user_id`, IP, user-agent and a
  chain hash (SEC-12); attribution is spoofable free text (SEC-07, DQ-11).

---

## 3. Required database constraints (recommended, backward-compatible)

Each is additive DDL; none renames or drops existing columns. Apply after the
data-quality script confirms no existing rows violate them (violations must be
quarantined first — see `11-remediation-roadmap.md` Phase 0/1).

| Invariant | Recommended constraint | Table |
|---|---|---|
| Non-negative money | `CHECK (subtotal>=0 AND discount>=0 AND tax_amount>=0 AND total_amount>=0 AND paid_amount>=0 AND refund_amount>=0)` | bills |
| Discount bound | `CHECK (discount <= subtotal)` | bills |
| Refund bound | `CHECK (refund_amount <= total_amount)` | bills |
| Invoice uniqueness | `UNIQUE (bill_number)` (re-assert; verify reconcile DDL) | bills |
| Gateway idempotency | `UNIQUE (provider, provider_txn_id)` (new columns) | payments |
| Payment→bill integrity | `FOREIGN KEY (bill_id) REFERENCES bills(id)` (assert present) | payments |
| Voucher account integrity | migrate `*_account_id` to integer + `FOREIGN KEY … REFERENCES accounts(id)` | vouchers |
| Status domain | `CHECK (status IN ('pending','partial','paid','cancelled'))` | bills |
| Typed dates | migrate `text` dates → `date`/`timestamptz` | vouchers, expenses, bills |

> ⚠️ CA-validation dependency: `tax_amount` is hardcoded `0` today (DQ-14); a
> non-negative check is safe, but any *tax-computation* rule must be validated by
> the organisation's CA before it drives real invoices.
