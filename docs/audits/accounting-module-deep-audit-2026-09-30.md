# Accounting Module — Deep Forensic Audit (2026-09-30)

**Repository:** `DrAbinash/care-on-synology1` (branch: `audit/accounting-module-deep-forensic-review`, base `origin/main` @ `27dab054`)
**Scope:** Expense Entry V2, expense categories, vendors/payees, payment lifecycle (unpaid → partial → fully paid, multiple payments), cash/bank/digital modes, payables, payment history, voucher generation/numbering/reversals, VOID, edits after payment, historical records, general ledger / trial balance / P&L / balance sheet, cash book, day-close interaction, expense attachments, duplicate invoice/payment controls, AI scan/OCR wiring, audit log, user attribution.
**Mode:** READ-ONLY. No production code, schema, or data was changed. Evidence references are `file:line` against this commit.
**Method:** Static forensic tracing UI → API → validation → authorization → service → DB transaction → vouchers → payables → daily summary → reports, cross-checked against three DDL sources (Drizzle schema, hand-written migrations, drizzle-kit push) and the test suite. Companion audit: `docs/audits/billing-module-deep-audit-2026-09-30.md` (PR #782).

---

## 1. Executive summary

The Expense Entry V2 core is architecturally sound: `expenses` is a bill header whose value ≠ money paid; `expense_payments` rows are the canonical money-out records; all three reconciliation surfaces (day-close, my-daily-summary, daily-summary) correctly aggregate `expense_payments` with `reversed_at IS NULL AND payment_status <> 'VOID'` on the `created_at` posting clock; partial payments are guarded by `SELECT … FOR UPDATE` + re-read + SUM re-check; and payment vouchers are idempotent through a partial unique index on `vouchers.expense_payment_id`.

However, the audit found **two P0 confirmed defects** that can corrupt the general ledger, **five P1 findings** spanning audit-trail gaps, DDL drift, and unprotected voucher mutations, and a set of P2 design risks around the two coexisting reversal regimes and `reference` overloading. The single most dangerous chain: a category edit on an expense whose accounting post FAILED (or silently PENDING) fires `correctExpenseVoucher` with the **full bill amount**, posting a payment voucher for money never paid — and because real payment vouchers reference the *payment public id* rather than the *expense id*, the correction routine can never see or clean up that voucher.

### Findings index

| ID | Severity | Classification | One-line summary |
|----|----------|----------------|------------------|
| ACC-P0-1 | P0 | CONFIRMED DEFECT | Category edit on a voucher-less (FAILED/silent-PENDING) expense posts a full-bill-amount PV for money never paid |
| ACC-P0-2 | P0 | CONFIRMED DEFECT | `voidExpense` takes no row lock; a payment committed during a void survives on a VOIDed expense |
| ACC-P1-1 | P1 | CONFIRMED DEFECT | Expense create, payment record, void, and accounting retry write **no audit-log rows** |
| ACC-P1-2 | P1 | CONFIRMED DEFECT | Voucher DELETE guard checks only `payment_id`/`bill_id`; expense-linked vouchers are hard-deletable |
| ACC-P1-3 | P1 | CONFIRMED DEFECT | Voucher PATCH trusts client-supplied `editedBy` (audit impersonation) and can rewrite any voucher, including auto-generated ones, with no compensating entry |
| ACC-P1-4 | P1 | CONFIRMED DDL DRIFT | `vouchers.voucher_number` UNIQUE exists only in the Drizzle bootstrap; the hand-written reconcile path creates the table without it — duplicate voucher numbers possible there |
| ACC-P1-5 | P1 | LIKELY DEFECT | `voidExpense` is a multi-step non-transactional sequence; partial failure leaves half-voided state |
| ACC-P2-1 | P2 | DESIGN RISK | Two reversal regimes use different idempotency markers (`narration` vs `particular`); one can re-reverse the other's rows |
| ACC-P2-2 | P2 | DESIGN RISK | `vouchers.reference` is an overloaded string namespace (expenseId, paymentPublicId, bill numbers, void reasons) |
| ACC-P2-3 | P2 | DESIGN RISK | Expense voucher numbering lacks the advisory lock the billing path uses; safety depends entirely on the P1-4 constraint existing |
| ACC-P2-4 | P2 | LIKELY DEFECT | Ledger book reset deletes bills/payments/orders/patients but not vouchers → orphaned vouchers with dangling `bill_id` |
| ACC-P2-5 | P2 | DESIGN RISK | Runtime DDL (`ALTER TABLE ledgers …`) executes inside the read path of `GET /ledgers` |
| ACC-P2-6 | P2 | MISSING CONTROL | No vendor + invoice-number uniqueness anywhere; duplicate-invoice detection is attachment-content-hash only plus an admin report |
| ACC-P3-* | P3 | MISSING TEST / OBSERVATION | See §13; notably the regression test guarding ACC-P0-1 is a source-text assertion, not behavioral |

---

## 2. Architecture overview

```
UI (diagnostic-erp)
  src/pages/Expenses.tsx    → /api/expenses*            (list, create, pay, void, retry, payees, scan-bill, attachments)
  src/pages/Accounting.tsx  → /api/accounting*          (accounts, vouchers CRUD, ledger, trial balance, P&L,
                                                          balance sheet, Tally exports, sync-billing, bank import)
                             /api/day-close, /api/dashboard/my-daily-summary, /api/daily-summary  (reconciliation)
API (api-server)
  routes/index.ts           mounts /expenses + /accounting + /ledgers behind
                            requireStaffAuth + requireStaffPermission("/accounting")   [index.ts:497,530,533,539]
  routes/expenses.ts        thin handlers → lib/expenseV2Service.ts (domain) → lib/auto-voucher.ts (accounting)
  routes/accounting.ts      manual voucher CRUD + reports + admin ops (sync-billing, supersede, dup suspects)
  routes/day-close.ts       drawer reconciliation (requireOwnerOrAdmin on staff-close endpoints)
  cron.ts                   backfillDeferredPaymentVouchers (billing payments only, off-peak, */10)
DB (Postgres)
  expenses, expense_categories, expense_payments, expense_attachments,
  vouchers, voucher_audits, accounts, audit_logs, clinic_settings, ledgers (+ bills/payments from billing)
```

Key design facts verified (not assumed):

- **Bill value ≠ money paid (V2).** `expenses.bill_amount` is the header; every money movement is an `expense_payments` row. `moneyFieldsForExpense` derives `totalPaid`/`balanceDue` from `SUM(active payments)`, and `paymentStatus` is recomputed on every payment (`assertPaymentAllowed` → `DUE | PART_PAID | PAID`).
- **Accounting posts AFTER commit ("Option B").** `createExpenseV2` and `recordExpensePayment` commit the money rows inside a transaction, then call `postAccounting` post-commit; failure is recorded as `accountingStatus = 'FAILED'` and is retryable (`POST /expenses/:id/accounting/retry`, `expenseV2Service.ts:699`).
- **Ledger is computed, not stored.** There is no `ledger_entries` table; `GET /accounting/ledger`, trial balance, P&L, and balance sheet all aggregate `vouchers` (single-row Dr/Cr) on the fly (accounting.ts:445-648).
- **Peak-hour deferral is billing-only.** `autoVoucherForPayment` skips during clinic peak hours (auto-voucher.ts:238) and a cron backfills off-peak (auto-voucher.ts:723); expense vouchers (`autoVoucherForExpense`, `autoVoucherForExpenseAccrual`, `autoVoucherForExpensePayment`) post immediately with no deferral.

---

## 3. Data model

### 3.1 Tables (accounting-relevant)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `expenses` | Bill header (legacy + V2) | `expense_id` (EXP-…), `amount` (legacy), `bill_amount` (V2), `category`, `category_id`, `paid_to`, `expense_date`, `payment_mode`, `payment_status` (DUE/PART_PAID/PAID/VOID), `accounting_status` (PENDING/POSTED/FAILED/REVERSED), `voucher_id`, `accrual_voucher_id`, `created_by`, `approved_by`, `void_*`, `meta_json` |
| `expense_categories` | 13 parent + 28 sub categories | self-FK `parent_id ON DELETE SET NULL`, `is_active`, `sort_order` |
| `expense_payments` | Canonical money-out rows | `payment_public_id` UNIQUE (EXPAY-…), `amount`, `payment_mode`, `paid_from_account_id`, `accounting_status`, `voucher_id`, `reversed_at/by/reason`, `is_legacy_backfill`, `expense_id FK → expenses ON DELETE RESTRICT` (SQL migration only — see §3.3) |
| `vouchers` | Single-row double-entry | `voucher_number`, `type` (payment/receipt/contra/journal/sales/purchase), `date` (IST text), `debit_account_id`, `credit_account_id` (TEXT FK-less), `amount numeric(12,2)`, `particular`, `reference`, `narration`, `bill_id`, `payment_id`, `expense_payment_id`, `performed_by` |
| `voucher_audits` | Tamper-evident voucher edit/delete trail | `voucher_id`, `edited_by`, `reason`, `change_type`, `old_value`, `new_value` |
| `accounts` | Chart of accounts | auto-created per category ("Expenses — <category>"), method accounts (Cash, UPI, Bank…), `Accounts Payable`, `Unclassified Collections` |
| `expense_attachments` | Bill documents | `content_hash` (SHA-256) + indexes, `storage_path` (data/uploads/expenses/), `mime_type` (sniffed), `deleted_at` soft delete |
| `audit_logs` | Generic module audit | written by `auditFromRequest` |
| `clinic_settings` | `expense_self_approval_allowed` (default TRUE) | toggles self-approval guard |

### 3.2 Unique indexes / constraints that matter

| Constraint | Where defined | Effect |
|------------|---------------|--------|
| `vouchers_expense_payment_id_uq` — UNIQUE (`expense_payment_id`) WHERE NOT NULL | `migrations/zzzzzzzzzzzzzzzz_expense_entry_v2_bills_payables_expense_payment_voucher_uq.sql` | Exactly one original PV per payment; duplicates rejected with 23505 → retry reuses winner's voucher (auto-voucher.ts:554-561). Reversals deliberately use `expense_payment_id = NULL` so they cannot collide. |
| `expense_payments.payment_public_id` UNIQUE | V2 migration | EXPAY- sequence uniqueness (per-expense counter table `expense_payment_counter`). |
| `vouchers.voucher_number` UNIQUE | **Drizzle 0000 only** | See ACC-P1-4 — absent from the hand-written bootstrap path. |
| `expense_attachments` 3 indexes incl. `content_hash` | `zzzzzzzzzzzzzzz_expense_attachments.sql` | Duplicate-document detection (409 unless `attachAnyway`). |

### 3.3 THREE DDL sources — confirmed drift (ACC-P1-4)

1. **`lib/db/drizzle/0000_dear_forge.sql`** (drizzle-kit generate): creates `vouchers` **with** `CONSTRAINT "vouchers_voucher_number_unique" UNIQUE("voucher_number")` — but has **no** `expense_payments`, `expense_categories`, `expense_attachments`, no `expense_payment_id` on vouchers.
2. **`care-erp/migrations/*.sql`** (~180 hand-written files, incl. `zz_schema_reconcile_20260709.sql` bootstrap): creates `vouchers` **without** any UNIQUE on `voucher_number` (lines 293-314), uses per-column `ADD COLUMN IF NOT EXISTS` guards; contains the **entire Expense V2 schema** — `expense_payments.expense_id` FK `ON DELETE RESTRICT`, the partial unique index, category seeds, and the legacy backfill (synthetic `EXPAY-LEGACY-<id>` payments preserving original `created_at` so the posting clock is unchanged).
3. **`db:push`** (drizzle-kit push): pushes the Drizzle schema, which does not know the V2 tables.

**Consequence:** whichever environment bootstrapped `vouchers` through the reconcile script (the only path that also carries Expense V2) has **no voucher-number uniqueness**. There, `nextVoucherNumber`'s MAX+retry design silently degrades: the 23505 branch never fires, and two concurrent voucher inserts can take the same number. Nothing in the repo reconciles the two definitions; a `grep` across all root migrations confirms no `ALTER TABLE vouchers … UNIQUE (voucher_number)` exists anywhere. Symmetrically, an environment provisioned by drizzle push lacks the V2 tables/FKs entirely — meaning the true production schema depends on which scripts were run, in which order, and cannot be derived from the repo alone.

### 3.4 Transaction boundaries

| Operation | Transaction | Lock | Post-commit accounting |
|-----------|-------------|------|------------------------|
| `createExpenseV2` (expenseV2Service.ts:267) | single tx (expense + initial payment + counters) | row lock on expense | accrual JV + payment PV; FAILED status on error, retryable |
| `recordExpensePayment` (expenseV2Service.ts:465) | single tx | `SELECT id FROM expenses WHERE id=? FOR UPDATE` (486) + re-read + SUM re-check (493-503) | payment PV; FAILED → retryable |
| `voidExpense` (expenseV2Service.ts:547) | **none** (sequential statements) | **none** | reversals via `reverseVoucherById` |
| `correctExpenseVoucher` (auto-voucher.ts:651) | none (per-row inserts) | none | — |
| Voucher INSERT paths | none (retry on 23505) | billing path uses `pg_advisory_xact_lock`; expense paths do not | — |

---

## 4. State machine

```
                        payment_status (expenses)                 accounting_status (expenses / payments)
  create (paid=0)  →  DUE ──pay──▶ PART_PAID ──pay──▶ PAID       PENDING ──post──▶ POSTED
                        │              │                │          │
                        │              └── void ────────┘         └── post error ──▶ FAILED ──retry──▶ POSTED
                        └──────────────── void ─────────▶ VOID                     VOID ──▶ REVERSED
```

- Transitions to `PART_PAID`/`PAID` are computed **inside the lock** from `SUM(active expense_payments)` — verified correct (expenseV2Service.ts:493-527).
- `VOID` is terminal: `paymentStatus='VOID'`, `accountingStatus='REVERSED'`, all payment rows get `reversed_at` + `accountingStatus='REVERSED'`, each distinct original voucher is reversed **at most once** (Set dedup, expenseV2Service.ts:556-563).
- Payments on a VOIDed expense are rejected — but only via a pre-lock read and an in-lock re-read in `recordExpensePayment`; `voidExpense` performs **no** lock, which is ACC-P0-2.

---

## 5. Accounting model

| Event | Voucher | Dr | Cr | reference | expense_payment_id |
|-------|---------|----|----|-----------|--------------------|
| Expense bill created | Accrual JV (type journal) | Expenses — `<category>` | Accounts Payable | expenseId | NULL |
| Payment recorded | PV (type payment) | Accounts Payable | `<mode account>` or `paid_from_account_id` | **paymentPublicId** | payment id (unique-indexed) |
| Legacy/`correctExpenseVoucher` repost | PV | Expenses — `<category>` | mode account | expenseId | NULL (bypasses unique index) |
| VOID | Reversal rows | swapped Dr/Cr of each original | | expenseId (regardless of original's reference) | NULL |
| Edit correction | Reversal rows | swapped Dr/Cr | | expenseId | NULL |

Account resolution: `ensureAccount("Expenses — <category>")` creates chart-of-accounts rows lazily; `resolveMethodAccount(paymentMode)` maps cash/upi/card/netbanking/bank/cheque to method accounts (auto-voucher.test.ts regression-locks the mapping, incl. insurance → "Unclassified Collections"). Note that the accrual JV debits the **category** expense account while the payment PV debits **Accounts Payable** — a clean accrual→settlement flow.

Cash book semantics: the cash/bank account is the Cr side of payment PVs. The GL "cash book" (any query on the Cash account across vouchers) therefore reflects vouchers, while day-close physical-cash expectations reflect `expense_payments` — these two agree only as long as exactly one PV exists per payment and no phantom PVs exist (see ACC-P0-1).

---

## 6. Voucher lifecycle

### 6.1 Numbering (`nextVoucherNumber`)

- Buckets: `PV-/RV-/JV-/CV-/SV-/PV-` … `-YYYYMM-NNNN` per type+month (prefix `PV` for payment, `RV` receipt, `JV` journal).
- `MAX(voucher_number)` with anchored all-digit regex filter and `::int` cast — not `COUNT` — so gaps from failed inserts don't cause collisions (voucherNumbering.test.ts locks: MAX-not-count, non-numeric exclusion, `::int` cast trap, retry retention, bucket scoping, shared helper across manual POST/sync-billing/bank import).
- Retry: on unique violation, recompute with `+attempt` offset up to 5 tries.
- **Gap:** the billing insert path wraps numbering in `pg_advisory_xact_lock`; none of the expense paths (`autoVoucherForExpense`, `autoVoucherForExpensePayment`, `correctExpenseVoucher`, `reverseVoucherById`) take the lock — correctness rests entirely on the unique constraint that may not exist (ACC-P1-4 / ACC-P2-3).

### 6.2 Idempotency

- Payment PVs: pre-check by `expense_payment_id` (auto-voucher.ts:511-516) **plus** 23505 fallback that reuses the winner's voucher (554-561). Concurrency-tested ("concurrent autoVoucherForExpense(Payment) → exactly one original PV").
- Accrual JV: idempotent via reference/accrual id (concurrency-tested: "concurrent payments create only one accrual JV").
- `reverseVoucherById`: idempotency is a **pre-check only** (swapped Dr/Cr + same amount + same reference + particular `ILIKE 'Reversal |%'`, auto-voucher.ts:585-601) with no unique backstop — two concurrent voids of the same voucher could double-reverse (window is small; void is operator-driven).
- `correctExpenseVoucher`: no idempotency at all for its repost step; its reversals are recognized only by their own narration marker (see ACC-P2-1).

### 6.3 Manual voucher CRUD (`/accounting/vouchers`)

- POST (250): creates any voucher; numbering via the shared MAX helper.
- PATCH (292-360): edits date/amount/particular/remark/performedBy/reference/narration/Dr/Cr on **any** voucher — including auto-generated bill- and payment-linked ones — writing `voucher_audits` rows per field. `editedBy` comes from the **request body** (295), not the session → ACC-P1-3.
- DELETE (362-413): requires reason ≥ 5 chars; blocks `payment_id IS NOT NULL OR bill_id IS NOT NULL`; writes a `voucher_audits` "deleted" row + an `audit_logs` row. **Does not block `expense_payment_id IS NOT NULL` or `reference LIKE 'EXP-%'`** → ACC-P1-2.

---

## 7. Payment lifecycle (verified)

1. `POST /expenses/:id/payments` (expenses.ts:262) → `recordExpensePayment`.
2. Route validates amount > 0 and `paymentDate` presence only; domain does the rest.
3. In-tx: `FOR UPDATE` lock → re-read (VOID re-check) → `SUM(active payments)` → `assertPaymentAllowed` (no overpay: `alreadyPaid + newPayment ≤ billAmount`) → insert payment row `accounting_status='PENDING'` → update expense `payment_status` + `payment_mode`.
4. Post-commit: `postAccounting` posts the PV (idempotent); on failure sets FAILED — recoverable via `/accounting/retry`.
5. Response returns recomputed `money` fields from a fresh read.

Verified invariants: partial→full transitions correct; balance always derived from active payment rows; multiple payments aggregate correctly (50k bill / 20k+10k+20k cash-impact test); payment rows are the authoritative basis for payables (`listPayables` filters `payment_status IN (DUE, PART_PAID)` and sums active payments, expenseV2Service.ts:651-693); payment history preserved (rows never mutated except reversal metadata; `GET /:id/payments` returns full history).

Modes: `paymentMode` defaults to the expense's mode, else `cash`; blank mode = cash (matches schema default and day-close's `splitCashExpenses` blank-mode rule). `paid_from_account_id` overrides the method account for bank/ledger selection — supported end-to-end (auto-voucher.ts:525-530).

---

## 8. VOID / reversal lifecycle

`POST /expenses/:id/void` (expenses.ts:300) and `DELETE /expenses/:id` (559, "void with reason") both funnel to `voidExpense`:

1. Collect voucher ids: each non-reversed payment's `voucher_id`, plus `accrual_voucher_id`, plus expense `voucher_id` — deduplicated by Set so a fully-paid bill's double-stored PV reverses **once** (test-locked).
2. Reverse each via `reverseVoucherById` (swapped Dr/Cr, particular `Reversal | …`, `expense_payment_id=NULL`, narration = void reason, reference = **expenseId**).
3. Mark all payment rows `reversed_at` + `accounting_status='REVERSED'`.
4. Mark expense `payment_status='VOID'`, `accounting_status='REVERSED'`.

Defects: no lock (ACC-P0-2), no wrapping transaction (ACC-P1-5), and the reversal reference is the expenseId even when the original voucher referenced a paymentPublicId — traceability then rests on the copied `particular` string (ACC-P2-2).

---

## 9. Daily-summary / cash reconciliation integration (verified correct)

All three surfaces — this is the module's strongest area:

- **Day-close** (`routes/day-close.ts`, `summarizeWindow`): expense_payments ⋈ expenses with `reversed_at IS NULL AND payment_status <> 'VOID'`, windowed on `created_at`; `splitCashExpenses` treats blank mode as cash (schema-default parity), otherwise `isPhysicalCash`; `applyCashExpenses` subtracts cash expenses from overall and per-approver expected-cash buckets.
- **My-daily-summary** (`routes/my-daily-summary.ts`): identical filters in raw SQL + drawer-owner attribution `COALESCE(NULLIF(TRIM(approved_by),''), NULLIF(TRIM(created_by),''))` via `expenseDrawerOwnerEquals`; line items capped at 200; posting-date rule per DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §16.5.
- **Daily-summary** (`routes/daily-summary.ts`): same aggregate grouped by `payment_mode`.

Attribution is shared JS/SQL via `lib/expenseCashAttribution.ts` and test-locked (expenseCashAttribution.test.ts). **Expected physical cash = collections − cash expense_payments**, computed consistently across all three routes. GL "cash book" (vouchers) is a separate derivation — see §5 for the divergence risk.

---

## 10. RBAC (proven server-side)

- Mount gates: `/expenses`, `/accounting`, `/ledgers` (mutations) all require `requireStaffAuth` + `requireStaffPermission("/accounting")` (routes/index.ts:497, 530, 533, 539). Role defaults (users.ts:64-66): admin, manager, accountant include `/accounting`; staff/frontdesk do not.
- Additional admin-only (`requireAdminRole`): `GET /accounting/duplicate-payment-suspects`, `POST /accounting/payments/:id/supersede`, `POST /accounting/sync-billing` (accounting.ts:1075, 1110, 1208).
- Day-close: staff-close/preview endpoints enforce `requireOwnerOrAdmin`; reopen-after-close requires super-admin (day-close.ts:2149); `my-*` endpoints are self-scoped by session (no gate needed). The router itself mounts with auth only (index.ts:542) — defense is at handler level (observation, see §13).
- Ledger book reset: super-admin token in body (`verifySuperAdmin`) — see ACC-P2-4 for the orphan problem.
- Frontend has **no** role gating (Accounting.tsx / Expenses.tsx) — the server is the sole boundary, which is acceptable given the mount gates, but means every `/accounting`-permitted user (including plain accountants) can: PATCH/DELETE vouchers (P1-2/3), import bank statements (`/accounting/bank-statement/import`, accounting.ts:1421 — posts real payment vouchers), and run sync-billing dry-runs. Only supersede/dup-suspects/sync are admin-gated.
- Self-approval: `clinic_settings.expense_self_approval_allowed` (default TRUE) blocks approving your own expense when disabled — enforced on create and PATCH (test-locked).

---

## 11. Concurrency analysis

| Scenario | Mechanism | Verdict |
|----------|-----------|---------|
| Double-click payment submit | Two in-tx inserts; second re-reads SUM under lock and gets "overpay" 400; distinct `payment_public_id`s so both could insert if amount fits twice | Safe (overpay guard) unless total ≤ bill amount twice — then it is a legitimate double payment, and duplicate-payment-suspects report + attachment hash dedupe are the only detectors (ACC-P2-6) |
| Payment vs payment | FOR UPDATE serializes; SUM re-check under lock | Safe |
| Payment vs auto-voucher idempotency | partial unique index + 23505 reuse | Safe (test-locked) |
| **Payment vs VOID** | `voidExpense` has no lock; reads payment list once | **DEFECT (ACC-P0-2): payment committed after void's list read survives as active money + un-reversed PV on a VOIDed expense; day summary then counts money for a voided bill** |
| VOID vs VOID | second call sees `payment_status='VOID'` → 400 | Safe |
| Voucher numbering races | MAX + retry-on-23505 | Safe **only if** UNIQUE exists (ACC-P1-4); no advisory lock on expense paths (ACC-P2-3) |
| Edit vs payment | PATCH blocks financial-field edits once ledger-linked | Safe; but see ACC-P0-1 for the voucher-less window |

---

## 12. Audit trail

- **Voucher edits/deletes:** every field change and every deletion writes `voucher_audits` (tamper-evident old/new values) — good. DELETE additionally writes `audit_logs` (accounting.ts:399).
- **Expenses:** only **PATCH edit** (expenses.ts:529) and **DELETE-void** (expenses.ts:577) write `audit_logs`. **Create, payment recording, void (POST /:id/void), and accounting retry write nothing** — the money-movement events themselves are unaudited (ACC-P1-1). Note the two void paths differ: `DELETE /:id` is audited, `POST /:id/void` is not, so an operator can void without any audit trace by choosing the other endpoint.
- **Voucher PATCH attribution:** `editedBy` is client-supplied (ACC-P1-3) — the session exists (DELETE uses it at accounting.ts:387-391) but PATCH ignores it, so the tamper-evident trail records whatever name the client posts.
- Payments/voids do carry operator attribution on the rows themselves (`created_by`, `voided_by`, `reversed_by`, `performed_by` on vouchers) — row-level attribution is good; the gap is the central audit log.

---

## 13. Test coverage

Strong suite (23 accounting-related test files). Highlights that lock correct behavior:

- `expenseLifecycle.proof.test.ts`: 50k/20k+10k+20k cash impact; fully-paid void reverses each original voucher at most once; concurrent payments → one accrual JV; day-close posting clock is `created_at`; create is atomic; PATCH blocks financial-field edits; concurrent autoVoucherForExpense(Payment) → exactly one original PV; fully-paid VOID → one reversal with NULL `expense_payment_id`.
- `voucherNumbering.test.ts`: MAX-not-count, regex exclusion, `::int` cast trap, bucket scoping, shared helper across manual POST/sync-billing/bank import.
- `auto-voucher.paymentIdempotency.test.ts`, `auto-voucher.peakDefer.test.ts`, `auto-voucher.test.ts` (method-account regressions), `expenseV2Service.paymentVoucherUnique.test.ts`, `expenseAttachments.test.ts` (13 scenarios), `expensePayables.test.ts`, `expenseCashAttribution.test.ts`, `expensePayeeSearch.test.ts`, `routes/expenses.{audit,approvalSeparation}.test.ts`, `routes/accounting.{supersede,syncBilling}.test.ts` (admin gates, dedupe incl. legacy amount-matched, dryRun), day-close tests.

Gaps (ACC-P3-2, all MISSING TEST):

1. **No behavioral test for ACC-P0-1.** `expenses.audit.test.ts:24-26` asserts the source no longer contains the literal `"-edit"` string — a text grep, not a behavior test. A test that PATCHes category on a FAILED-accounting unpaid bill and asserts **no voucher** is posted would have caught the defect.
2. No test that a deployed schema has `UNIQUE (voucher_number)` (would fail on the reconcile-path schema).
3. No test that DELETE `/accounting/vouchers/:id` rejects expense-linked vouchers.
4. No test that PATCH derives `editedBy` from the session (or rejects spoofed names).
5. No concurrency test VOID vs `recordExpensePayment`.
6. No test that ledger reset orphans no vouchers.
7. No test covering the marker mismatch between the two reversal regimes (a `reverseVoucherById` row surviving a `correctExpenseVoucher` pass unchanged).

---

## 14. Findings — detail and evidence

### ACC-P0-1 — CONFIRMED DEFECT: category edit on a voucher-less expense posts a full-bill-amount PV for money never paid

**Severity: P0 (ledger corruption, GL↔drawer divergence).**

Chain, all verified in source:

1. `PATCH /expenses/:id` blocks `amount`/`paymentMode` always, but blocks `category` only when `hasLedger` is true — `hasLedger` = `voucherId || accrualVoucherId || accountingStatus ∈ {POSTED, PARTIAL, REVERSED}` (expenses.ts:471-495). An expense whose accounting post **FAILED** (or silently remains PENDING with no linked voucher) has `hasLedger = false`.
2. On `categoryChanged`, the handler fires `correctExpenseVoucher` with `amount: Number(expense.amount)` — the **full bill amount** (expenses.ts:541-553).
3. `correctExpenseVoucher` reverses every `type='payment'` voucher with `reference = expenseId` (auto-voucher.ts:663-674) — for a V2 bill that set is normally **empty**, because payment PVs carry `reference = paymentPublicId` (auto-voucher.ts:549).
4. It then calls `autoVoucherForExpense` with no `expensePaymentId` (auto-voucher.ts:706-713), which posts `Dr Expenses — <new category> / Cr <mode account>` for the full bill amount with `reference = expenseId`, `expense_payment_id = NULL` (auto-voucher.ts:372-388) — a phantom cash/bank outflow for money never paid.
5. Because the phantom PV references the expenseId while real payment PVs reference paymentPublicIds, **no later correction, retry, or void reversal can find it**: `retryExpenseAccounting` reconciles by `reference = expenseId` and would reverse it only incidentally; `voidExpense` reverses only vouchers linked via payment/expense voucher ids. Meanwhile `POST /:id/accounting/retry` (expenses.ts:321) may also post the proper payment PVs on top → GL double-counts the bill.
6. Day-close/daily-summary read `expense_payments`, so the drawer is **unaffected** while the GL cash book, P&L, and trial balance are overstated by the bill value — a silent books-vs-cash divergence, the exact class of error this module otherwise guards against.

Trigger realism: any transient DB failure during `postAccounting` (which is designed to fail soft and mark FAILED) plus a staff member "fixing" the category while retrying accounting.

**Evidence:** expenses.ts:458-556 (guard + call), auto-voucher.ts:651-717 (correction), auto-voucher.ts:322-408 (full-amount PV insert), auto-voucher.ts:549 (payment PV reference mismatch), expenses.audit.test.ts:24-26 (text-only regression guard).

**Remediation direction:** a category edit must never post a money voucher for unpaid value. Either (a) block category edits whenever any payment row exists (not merely when a voucher is linked), or (b) make `correctExpenseVoucher` post only a reclassification JV (`Dr Expenses — new / Cr Expenses — old`) for the **paid** amount, or (c) drop `correctExpenseVoucher` from the PATCH path entirely and treat category as bill metadata corrected via void-and-reenter. Also pass `expensePaymentId` (or a dedicated correction marker) so reposts are idempotent, and replace the source-text test with a behavioral one.

### ACC-P0-2 — CONFIRMED DEFECT: `voidExpense` races with `recordExpensePayment`

**Severity: P0 (money rows vs VOID state inconsistency).**

`voidExpense` reads the expense with a plain SELECT (no `FOR UPDATE`, expenseV2Service.ts:550), lists payments once (554), then sequentially reverses vouchers, marks payments reversed, and sets `payment_status='VOID'` — all outside any transaction. A `recordExpensePayment` that commits between the void's read and its payment-row update passes the VOID checks (the expense wasn't VOID yet), inserts an active payment, and posts its PV. Outcome: expense is VOID, but one active `expense_payments` row + one un-reversed PV survive → day summary counts cash-out for a voided bill, GL disagrees with payables, and no retry path repairs it.

**Evidence:** expenseV2Service.ts:547-598 (no lock/tx) vs 485-503 (the locking read it should mirror).

**Remediation direction:** take the same `FOR UPDATE` lock, re-read status and payment list under it, and wrap the void (voucher reversals + payment/expense updates) in one transaction — reversals post-commit if Option B is preserved, but the state transition itself must be atomic.

### ACC-P1-1 — CONFIRMED DEFECT: money-movement events write no audit rows

`auditFromRequest` appears exactly twice in expenses.ts (529 edit, 577 delete-void). Create, `POST /:id/payments`, `POST /:id/void`, `POST /:id/accounting/retry`, and attachment create/delete write no `audit_logs` rows; `expenseV2Service.ts` contains no audit logging at all. For a financial module, recording a payment (money out) and voiding a bill are precisely the events a tamper-evident trail must capture. The asymmetry between the two void endpoints (DELETE audited, POST not) makes the gap exploitable by choice of endpoint.

### ACC-P1-2 — CONFIRMED DEFECT: expense-linked vouchers are hard-deletable

The DELETE guard blocks only `payment_id != null || bill_id != null` (accounting.ts:380). Original expense PVs have `bill_id = NULL`, `payment_id = NULL`, and are identifiable only by `expense_payment_id != null` or `reference = paymentPublicId/expenseId`. Any `/accounting`-permitted user can therefore hard-delete a posted payment voucher (a `voucher_audits` "deleted" row is written, but the expense/payment rows keep `accounting_status='POSTED'` and a dangling `voucher_id`), silently un-posting money from the GL while the drawer still counts it. Extend the guard to `expense_payment_id IS NOT NULL` (and `reference` prefixes `EXP-`/`EXPAY-`).

### ACC-P1-3 — CONFIRMED DEFECT: voucher PATCH trusts client `editedBy` and rewrites auto-generated vouchers

`PATCH /accounting/vouchers/:id` takes `editedBy` from the body (accounting.ts:295) — the audit trail records an attacker-chosen name while the authenticated session is available and is used by DELETE (387). Additionally, PATCH applies to **every** voucher, including bill- and payment-linked auto-generated ones, and can change `amount`, `date`, `reference`, and Dr/Cr accounts without any compensating entry — breaking the invariants "voucher amount = payment amount" and "voucher date = posting date" that the reconciliation clock depends on. Field-level `voucher_audits` rows are written (good), but a single approved edit can desync the GL from `expense_payments`/`payments` with no detection.

**Remediation direction:** derive `editedBy`/`performedBy` from the session; forbid structural edits (amount, Dr/Cr, date, reference) on auto-generated vouchers — route corrections through the source-document flows (void/supersede/correct) which post compensating entries.

### ACC-P1-4 — CONFIRMED DDL DRIFT: voucher-number uniqueness depends on which bootstrap ran

See §3.3. Evidence: `lib/db/drizzle/0000_dear_forge.sql` (UNIQUE present, V2 tables absent) vs `migrations/zz_schema_reconcile_20260709.sql:293-314` (UNIQUE absent) vs the V2 migrations (expense FK + partial unique index exist only there). No migration ever adds the missing UNIQUE. On the reconcile path, duplicate voucher numbers are possible and the numbering retry logic is dead code; on the drizzle path, the V2 module's tables are missing. Fix with a reconciling `ALTER TABLE … ADD CONSTRAINT … UNIQUE (voucher_number)` migration (guarded, after a duplicate check), and pick **one** DDL source of truth.

### ACC-P1-5 — LIKELY DEFECT: `voidExpense` is not transactional

Even without a race, a crash between the reversal inserts and the expense update leaves vouchers reversed but the expense un-VOIDed (or payments un-reversed). The state machine then has no consistent repair path — retrying the void re-collects voucher ids (the Set dedup prevents double reversals of *linked* vouchers, but `reverseVoucherById`'s own pre-check is string/marker-based, see ACC-P2-1). Wrap in a transaction as part of the P0-2 fix.

### ACC-P2-1 — DESIGN RISK: two reversal regimes, two idempotency markers

`correctExpenseVoucher` recognizes its reversals by `narration ILIKE '%reversal of expense%'` (auto-voucher.ts:672-674); `reverseVoucherById` marks its rows by `particular ILIKE 'Reversal |%'` + swapped Dr/Cr (auto-voucher.ts:585-601) with narration = the caller's reason. A `reverseVoucherById` reversal of a `reference = expenseId` payment voucher (e.g. a void of a legacy/auto PV) would **not** be excluded by `correctExpenseVoucher`'s filter and would be re-reversed if a correction ever runs on the same reference. Today the PATCH guard blocks corrections after VOID (`accountingStatus='REVERSED'` ⇒ `hasLedger`), so the path is closed — but it is closed by accident of one status check, not by design. Unify on one marker (e.g. a `reversal_of_voucher_id` column) and enforce idempotency with a unique index rather than string matching.

### ACC-P2-2 — DESIGN RISK: `vouchers.reference` is an overloaded namespace

`reference` carries: expenseId (accrual JVs, legacy/auto PVs, all void reversals), paymentPublicId (payment PVs), bill numbers, and sync-billing/bank-import identifiers — one TEXT column, four semantics, no discriminator column. Historical reconciliation (`retryExpenseAccounting` "reconciles historical vouchers (reference = expenseId)", expenseV2Service.ts:695-697) depends on this overloading, and a void reversal's reference (expenseId) intentionally differs from its original's (paymentPublicId), so parent-child reversal linkage survives only through the copied `particular` text. Verified no prefix collision today (`EXP-` vs `EXPAY-` vs bill numbers), but every new voucher producer must know the convention. Add explicit typed columns (`expense_id`, `reversal_of_voucher_id`) instead of overloading `reference`.

### ACC-P2-3 — DESIGN RISK: expense numbering has no advisory lock

Billing's `postPaymentVoucher` path uses `pg_advisory_xact_lock` around numbering; every expense-side insert relies on retry-on-23505 alone, which is only sound while the P1-4 constraint exists. If P1-4 is fixed, this is acceptable; if it is not, this is the mechanism by which duplicates actually occur.

### ACC-P2-4 — LIKELY DEFECT: ledger reset orphans vouchers

`POST /ledgers/:id/reset` (super-admin, token in body) deletes payments, bill audits, bills, order tests, orders, appointments, patients — but **not vouchers**. Vouchers with `bill_id` pointing at deleted bills survive as orphans in every report and Tally export; the guard only blocks the reset when patients have bills in `('paid','partial')`. Either cascade voucher deletion (with audit) or block the reset while any bill-linked vouchers exist.

### ACC-P2-5 — DESIGN RISK: runtime DDL in the read path

`ensureDefaultLedger()` executes `ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS …` on **every** `GET /ledgers` (ledgers.ts; mounted at routes/index.ts:533-537). Reads that can take schema locks are a production hazard under load, and DDL-in-request normalizes the anti-pattern the migration system exists to prevent. Move to a migration.

### ACC-P2-6 — MISSING CONTROL: no duplicate-invoice control on the expense entity

Duplicate controls verified: attachment content-hash dedupe (409 unless `attachAnyway`), payment PV idempotency, `payment_public_id` uniqueness, and the admin duplicate-payment-suspects report. **No** uniqueness or soft-warning exists on vendor + invoice/reference number at expense creation — the same invoice can be entered twice as two bills, each with its own payments, and only the admin report (amount-matched, manual review) would surface it. Given the module's otherwise strong duplicate posture, a vendor+reference-number warning/unique index is a notable gap.

### ACC-P3 — observations (EXPECTED BEHAVIOR / minor)

- **P3-1** The only regression guard for the edit-correction flow is a source-text assertion (§13 gap 1).
- **P3-2** The seven test gaps enumerated in §13.
- **P3-3** Day-close mounts with auth only (index.ts:542); handler-level `requireOwnerOrAdmin`/super-admin checks carry the authorization. Acceptable but inconsistent with the router-level pattern used for `/accounting`.
- **P3-4** Verified-correct behaviors worth recording as invariants so they don't regress: posting clock = `created_at` on all three summary routes; drawer attribution COALESCE shared JS/SQL; blank-mode = cash; legacy backfill preserves `created_at`; peak-hour deferral is billing-only by design (expense vouchers post immediately — correct, since expense capture is low-frequency); attachment security (magic-byte sniffing, 15MB cap, sanitized unique filenames, path-traversal guard, soft delete, DTOs without host paths); AI scan wiring (`POST /expenses/scan-bill` → `attachFromReceiptDataUrl`, source `AI_SCAN`, `attachAnyway` default true).

---

## 15. Expense Entry V2 — verification matrix (the nine mandated checks)

| # | Claim under test | Verdict | Evidence |
|---|------------------|---------|----------|
| 1 | Partial payment transitions correctly | **VERIFIED** | Lock + re-read + SUM + `assertPaymentAllowed` (expenseV2Service.ts:485-527); test-locked |
| 2 | Remaining balance derived correctly | **VERIFIED** | `moneyFieldsForExpense` sums **active** payments only (`reversed_at IS NULL`); payables use the same source |
| 3 | Fully paid → VOID does not double-reverse | **VERIFIED** | Set dedup of voucher ids (expenseV2Service.ts:556-563); test-locked. Caveat: concurrent voids rely on marker pre-checks only (ACC-P2-1) |
| 4 | Historical voucher reconciliation is safe | **PARTIAL — DESIGN RISK** | `retryExpenseAccounting` reconciles by `reference = expenseId`; sound for accruals/legacy PVs, blind to payment PVs (reference = paymentPublicId), and marker-based exclusion can re-reverse void reversals (ACC-P2-1/2) |
| 5 | Expense + initial payment/accounting are atomic | **VERIFIED** | Single transaction for money rows; accounting post-commit with FAILED status + idempotent retry (Option B, documented in code) |
| 6 | Concurrent payment handling is safe | **VERIFIED against payments; DEFECT against VOID** | Payments serialize under FOR UPDATE; `voidExpense` does not lock (ACC-P0-2) |
| 7 | Payment rows are the authoritative basis for payables | **VERIFIED** | All payables/balances/summaries derive from `expense_payments`; GL is vouchers — divergence only via phantom PVs (ACC-P0-1) |
| 8 | Reversal vouchers cannot collide with normal voucher uniqueness | **VERIFIED** | Reversals insert with `expense_payment_id = NULL` (auto-voucher.ts:631), outside the partial unique index; migration explicitly cleared old collisions and asserts none remain |
| 9 | Financial PATCH operations cannot bypass accounting invariants | **DEFECT** | amount/mode always blocked; category blocked only when `hasLedger` → full-amount phantom PV (ACC-P0-1); voucher PATCH/DELETE bypass invariants directly (ACC-P1-2/3) |

---

## 16. Remediation sequence

**Phase 1 — stop the bleeding (P0):**
1. ACC-P0-1: remove `correctExpenseVoucher` from the PATCH path (or gate it on "no payment rows exist" and post a reclass JV of paid value only). Add behavioral test.
2. ACC-P0-2 / ACC-P1-5: lock + transactionalize `voidExpense`.

**Phase 2 — restore the trail and the guardrails (P1):**
3. ACC-P1-1: `auditFromRequest` on expense create, payment record, both void endpoints, accounting retry, attachment create/delete.
4. ACC-P1-2: extend voucher DELETE guard to `expense_payment_id`/expense references.
5. ACC-P1-3: session-derived `editedBy`; forbid structural edits on auto-generated vouchers.
6. ACC-P1-4: reconciling migration adding `UNIQUE (voucher_number)` (after duplicate scan), `expense_payments.expense_id` FK, and the partial unique index into whichever bootstrap path lacks them; declare one DDL source of truth and delete the others from the deploy path.

**Phase 3 — structural hardening (P2):**
7. ACC-P2-1/2: add `reversal_of_voucher_id` (+ unique) and typed source columns; retire string-marker idempotency and `reference` overloading.
8. ACC-P2-3: advisory lock (or serialize on the fixed unique constraint) for expense numbering.
9. ACC-P2-4: block or cascade ledger resets against vouchers.
10. ACC-P2-5: move `ensureDefaultLedger` DDL to a migration.
11. ACC-P2-6: vendor + invoice-reference duplicate warning/index at creation.

**Phase 4 — tests (P3):** the seven §13 gaps, prioritized by the finding each guards.

---

## Appendix — key file map

| Area | File |
|------|------|
| Domain service | `artifacts/api-server/src/lib/expenseV2Service.ts` |
| Voucher engine | `artifacts/api-server/src/lib/auto-voucher.ts` |
| Expense routes | `artifacts/api-server/src/routes/expenses.ts` |
| Accounting routes (vouchers CRUD, reports, Tally, sync, bank import) | `artifacts/api-server/src/routes/accounting.ts` |
| Reconciliation | `routes/day-close.ts`, `routes/my-daily-summary.ts`, `routes/daily-summary.ts`, `lib/expenseCashAttribution.ts` |
| Attachments | `lib/expenseAttachments.ts` |
| RBAC mounts | `routes/index.ts` (497, 530, 533, 539, 542, 1062, 1065) |
| DDL — drizzle | `lib/db/drizzle/0000_dear_forge.sql` |
| DDL — migrations (authoritative for V2) | `care-erp/migrations/zzzzzzzzzzzzzzzz_expense_entry_v2_bills_payables*.sql`, `zz_schema_reconcile_20260709.sql` |
| Cron backfill (billing only) | `src/cron.ts` (`scheduleDeferredPaymentVouchers`) |
| UI | `artifacts/diagnostic-erp/src/pages/{Expenses,Accounting}.tsx` |

*Audit performed 2026-09-30, read-only, against `origin/main` @ `27dab054`. No production code, schema, or data was modified.*
