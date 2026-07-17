# 09 — Data-Quality Audit: Findings & Audit Tooling

- **Audit dimension:** DQ (data quality / database-level financial consistency)
- **Date:** 2026-07-16
- **Auditor:** dimension auditor "DQ" (forensic financial-controls audit of CARE ERP)
- **Companion deliverable:** [`accounting-data-audit.sql`](./accounting-data-audit.sql) — 61 read-only checks (DQC-01 … DQC-61)
- **Execution status:** the SQL script was **authored and schema-checked in this audit environment but NOT executed against production data** — no production database (or copy) was reachable from the audit sandbox. Every data-inconsistency status is therefore **UNVERIFIED pending a run** against the Synology PostgreSQL copy. This document's findings are about what the *schema and code* provably permit, and about invariants the schema **cannot even express**.
- **Script validation performed:** the script *was* executed end-to-end (exit 0, zero SQL errors, all 61 checks + summary emitted) against a scratch PostgreSQL 16 database built in this environment from the repo's own DDL (`lib/db/drizzle/0000_dear_forge.sql` + `migrations/zz_schema_reconcile_20260709.sql`, plus `payment_logs` recreated per `lib/db/src/schema/paymentLogs.ts` since that table is created by API startup code, not migrations — see `migrations/add_payment_idempotency_index.sql:21-25`). A synthetic-anomaly smoke test (over-discount bill, zero/negative payments, orphan/`-edit`/self-balancing voucher with a non-ISO date, broken audit-chain row) was then seeded and correctly detected by checks DQC-21/22/28/29/30/31/32/35/37/56/58/59/61 in both the detail output and the final summary. The scratch DB was destroyed afterward. This validates syntax, table/column names, and detection logic — it says nothing about production data.

---

## 1. Scope & method

1. Every financial table and column name used in the SQL script was verified by reading the Drizzle schema sources in `lib/db/src/schema/*.ts` (the snake_case names declared inside `pgTable(...)` calls), including: `bills.ts`, `orders.ts`, `patients.ts`, `ledgers.ts`, `accounting.ts`, `expenses.ts`, `banking.ts`, `onlineBookings.ts`, `paymentLogs.ts`, `paymentGatewayDiagnostics.ts`, `dayClosures.ts`, `userDayClosures.ts`, `auditLogs.ts`, `users.ts` (which hosts `bill_audits`), and `tests.ts` (DB table `diagnostic_tests`, verified at `lib/db/src/schema/tests.ts:5`).
2. The *semantics* of every invariant tested were derived from the code paths that write the data, read in full or in relevant part this run: `artifacts/api-server/src/routes/bills.ts` (creation :373-660, cancel :947-1134, refund :1136-1290, cancel-refund-tests :1706-1830, standalone payment :1880-1948, super-admin delete :1470-1529, gateway reconcile :2300-2388), `artifacts/api-server/src/routes/gateway-webhooks.ts` (settleBill :87-150), `artifacts/api-server/src/services/self-registration.ts` (:120-240), `artifacts/api-server/src/routes/expenses.ts` (:22-32, :120-171), `artifacts/api-server/src/routes/accounting.ts` (:320-344), `artifacts/api-server/src/lib/auto-voucher.ts` (all 247 lines), `artifacts/api-server/src/lib/paymentMethodClassifier.ts` (all 137 lines).
3. DDL divergence was checked against `lib/db/drizzle/0000_dear_forge.sql` (constraint census via grep), `migrations/zz_schema_reconcile_20260709.sql` (bills :142-172, payments :175-186, vouchers :297-313, index section :27077-27301), `migrations/add_payment_idempotency_index.sql`, and `migrations/manual-only/prepare_payment_uniqueness_index.sql`.
4. Where the brief demanded a check the schema cannot express (no receipts table, no journal-line table, no per-line tax), that inability is itself reported as a finding rather than silently skipped.

### Judgment standard applied

A displayed total is not accounting integrity; a `status='paid'` flag is not a verified payment. Checks were designed to *recompute* every cached figure from its underlying ledger rows and to treat every uniqueness claim as false until a database constraint proves it.

---

## 2. How to run the audit script

The script is **pure SELECT** — no INSERT/UPDATE/DELETE, no DDL, no temp tables. It is safe on a production copy (recommended) or, with care, on production itself.

**Option A — docker exec on the Synology NAS** (container name per `docker-compose.yml`, typically the postgres service):

```bash
# copy the script into the container, then run it
docker cp workspace/accounting-audit/accounting-data-audit.sql <postgres-container>:/tmp/
docker exec -it <postgres-container> \
  psql -U <db_user> -d <db_name> -f /tmp/accounting-data-audit.sql \
  > accounting-data-audit-results.txt 2>&1
```

**Option B — connection string from any host that can reach the DB:**

```bash
psql "postgresql://<user>:<pass>@<synology-host>:5432/<db>" \
  -f workspace/accounting-audit/accounting-data-audit.sql \
  -o accounting-data-audit-results.txt
```

Each of the 61 checks prints one row: `check_id | description | anomaly_count | sample_ids` (sample ids are primary-key/business ids only — **no patient names or phone numbers are ever selected**). The final statement prints a consolidated `UNION ALL` summary of all 61 counts, ordered by check id. `anomaly_count = 0` everywhere = clean. Checks explicitly labelled "review" (DQC-12, DQC-41, DQC-51) list items that are *permitted by the application's design* but individually require human sign-off.

---

## 3. What each check tests and why (by section)

### Section 1 — Duplicate identifiers (DQC-01 … DQC-12)

| Check | Invariant | Why it matters |
|---|---|---|
| DQC-01 | `bills.bill_number` unique | The invoice number is the legal/GST identity of a sale. Drizzle declares it unique (`lib/db/src/schema/bills.ts:9`) but the alternative bootstrap DDL creates the table without any unique index (`migrations/zz_schema_reconcile_20260709.sql:142-172`; only non-unique indexes at :27220, :27299). Also, super-admin bill deletion *renumbers* all later bills of the month in-place (`bills.ts:1502-1525`), so a crash mid-renumber can leave duplicates. |
| DQC-02 | `orders.order_number` unique | Same duplication logic; order numbers are generated by COUNT+1 in staff flow and by `Math.random()` suffix in self-registration (`self-registration.ts:153-155`). |
| DQC-03 | `patients.patient_id` (MRN) unique | Two patients sharing an MRN corrupts every downstream financial attribution. |
| DQC-04 | `expenses.expense_id` unique | Generated from a non-atomic read-then-update counter (`routes/expenses.ts:22-32`) — two concurrent expense saves can compute the same `EXP-YYMM-####`. |
| DQC-05 | `vouchers.voucher_number` unique | Numbering is `COUNT(*)+1` per month bucket (`lib/auto-voucher.ts:101-109`) and vouchers can be hard-deleted (`routes/accounting.ts:329-335`), which recycles numbers; reconcile DDL has **no** unique index on it (`zz_schema_reconcile_20260709.sql:297-313`). |
| DQC-06 | one payment row per (bill, gateway reference) | Backed by partial unique index `idx_payments_bill_reference_uq` (`migrations/add_payment_idempotency_index.sql:17-19`, also created at `zz_schema_reconcile_20260709.sql:27207`). Any hit proves the index is absent on that DB *and* a double credit happened. |
| DQC-07 | one gateway reference per bill *globally* | The index above is scoped per bill — the same real-world gateway transaction posted to two *different* bills sails through it. Pure data check; no constraint exists. |
| DQC-08 | provider payment id unique across bookings | `online_bookings` has five per-gateway id columns with **no unique index anywhere** (`lib/db/src/schema/onlineBookings.ts:19-29`). |
| DQC-09 | `gateway_transactions.external_transaction_id` unique per provider | Bare text column (`lib/db/src/schema/banking.ts:267`). |
| DQC-10 | webhook deliveries deduplicated | `webhook_logs` (`banking.ts:93-106`) has no idempotency key; duplicate identical bodies show gateway replays that must each map to exactly one payment. |
| DQC-11 | one `success` payment_log per (booking, gateway) | `payment_logs` has zero uniqueness (`lib/db/src/schema/paymentLogs.ts:3-14`). |
| DQC-12 | no double-keyed cash | Cash rows have `reference_number IS NULL` and are *explicitly excluded* from the unique index (`add_payment_idempotency_index.sql:9-10`); the check flags same-bill same-amount cash pairs within 120 s for human review. |

### Section 2 — Referential integrity (DQC-13 … DQC-26)

Drizzle declares FKs for `payments.bill_id`, `bills.order_id/patient_id`, `order_tests.*` (`bills.ts:10-11,50`; `orders.ts:30-31`), but the reconcile bootstrap creates all three tables **without foreign keys** (`zz_schema_reconcile_20260709.sql:142-186`), and the following link columns have no FK in *any* DDL path: `bills.ledger_id` (`bills.ts:21`), `vouchers.bill_id` (`accounting.ts:67`), `vouchers.debit/credit_account_id` (text, `accounting.ts:58-59`), `expenses.voucher_id` (`expenses.ts:14`), `online_bookings.bill_id/patient_id` (`onlineBookings.ts:32-33`), and every link in `bank_transactions` / `reconciliation_logs` / `refund_requests` / `gateway_transactions` (`banking.ts:45-68,144-166,264-334`). Checks DQC-13…26 sweep all of them. Notably, DQC-23/24 use orphaned audit rows as the *only surviving evidence* of hard-deleted bills and vouchers, because `bill_audits` deliberately has no FK ("bill_audits has no FK constraint so insert before or after is fine" — `bills.ts:1484`) and `DELETE /accounting/vouchers/:id` deletes without any audit row at all (`accounting.ts:329-335`).

### Section 3 — Amount/sign sanity (DQC-27 … DQC-34)

There are **zero CHECK constraints in the entire generated schema** — `grep -c "CHECK" lib/db/drizzle/0000_dear_forge.sql` returns `0` (verified this run). Every sign rule, the discount ≤ subtotal rule (enforced only at creation, `bills.ts:533-536`), the total identity `total = subtotal − discount + tax` (`bills.ts:549-550`), the discount-requires-reason rule (`bills.ts:413-415`), and the refund ≤ collected rule (`bills.ts:1176-1183`) exist solely in route handlers, several of which (PUT `/bills/:id`, super-edit) can bypass them. DQC-33 flags any nonzero `tax_amount` because creation hardcodes `const taxAmount = 0` (`bills.ts:549`) and no line-level tax data exists anywhere to justify a nonzero value.

### Section 4 — Denormalized totals (DQC-35 … DQC-38)

`bills.paid_amount / refund_amount / balance_amount` are cached aggregates rewritten independently by at least ten code paths (payment inserts at `bills.ts:611, 1037, 1208, 1783, 1919, 2074, 2107, 2349`; `gateway-webhooks.ts:122-146`; `public-booking.ts:1328`; `self-registration.ts:202-209`) with no database mechanism keeping them equal to `SUM(payments)`. The verified invariants: refunds insert **negative payment rows** and simultaneously decrement `paid_amount` / increment `refund_amount` (`bills.ts:1206-1226`), so `paid_amount = SUM(all payment rows)`, `refund_amount = −SUM(negative rows)`, `balance = GREATEST(0, total − paid − refund)` (`bills.ts:1189-1195`; same formula in `gateway-webhooks.ts:135`). DQC-35/36/37 recompute all three; DQC-38 cross-checks the four known statuses (`pending|partial|paid|cancelled`, `bills.ts:586, 980, 1198-1200`) against the amounts.

### Section 5 — Cancellation (DQC-39 … DQC-41)

Cancel zeroes the balance (`bills.ts:980-985`) and cascades cancellation into `order_tests` so commission stops accruing (`bills.ts:998-1010`). DQC-39 verifies the zeroing, DQC-40 hunts positive payments timestamped *after* `cancelled_at`, DQC-41 lists cancelled bills still holding net collections (review items — the auto-refund on cancel is optional, `bills.ts:1022-1060`).

### Section 6 — Bill ↔ lines ↔ bookings (DQC-42 … DQC-45)

`subtotal` must equal the sum of non-cancelled `order_tests.price` (`bills.ts:526` at creation; recalculated at `bills.ts:1764-1767` on test cancel). One active bill per order is app-enforced only (`bills.ts:445-501`). One booking per bill is implied by the confirm flow creating a fresh bill per booking (`self-registration.ts:184-200`) but backed by no constraint.

### Section 7 — Gateway ↔ booking (DQC-46 … DQC-50)

The booking state machine is `pending_payment → paid → confirmed | payment_failed | cancelled` (`onlineBookings.ts:30`). The brief's "successful gateway payments without confirmed bookings and vice versa" maps to DQC-46 (success `payment_logs` row but booking not paid/confirmed) and DQC-47/48 (confirmed booking without a bill; paid/confirmed booking with *no* gateway transaction id in any of the five columns *and* no success log). DQC-19 additionally excludes billing-desk synthetic refs (`BILL-<billId>-…`, parsed at `bills.ts:2313-2314`) before flagging orphan logs.

### Section 8 — Day close (DQC-51 … DQC-53)

Day close is *by design* non-blocking: "Bills/payments created AFTER closedAt automatically belong to the next open day — there is no hard block" (`lib/db/src/schema/dayClosures.ts:12-14`). Payments carry only `created_at`; there is no separate business-date column and no insertion-audit, so **backdating is structurally undetectable from data**. What *is* detectable: cash rows created on an IST calendar date after that date's final `closed` closure (DQC-51 — uncounted same-day cash), internally inconsistent closure arithmetic (DQC-52), and inverted/overlapping coverage windows (DQC-53). "Physical cash" is matched strictly as `method='cash'` per the classifier's single-source rule (`lib/paymentMethodClassifier.ts:55-67`: "Only literal cash is physical cash").

### Section 9 — Expenses & vouchers (DQC-54 … DQC-60)

Covers the brief's "expenses missing category/user" to the extent expressible (see DQ-15 — expenses have **no user id column at all**), silent voucher-posting loss (auto-voucher swallows every error, `auto-voucher.ts:181-183, 244-246`), the `-edit` double-posting defect (DQ-05), self-cancelling debit==credit vouchers, unparseable text dates, and voucher references left stale by bill renumbering (DQ-06).

### Section 10 — Audit chain (DQC-61)

Verifies `previous_hash(row N) = chain_hash(row N−1)` by id order using a window function, and flags empty `chain_hash` values, which the schema permits via `.default("")` (`lib/db/src/schema/auditLogs.ts:32-33`). Full SHA-256 recomputation requires the application verifier; the SQL check finds structural breaks only.

### Checks the schema cannot express (reported, not implemented)

- **Duplicate receipt numbers / multiple receipts per payment** — there is **no receipts table** in the schema (verified: no `pgTable("receipt…")` anywhere under `lib/db/src/schema/`); the `payments` row *is* the receipt and its serial `id` is the de facto receipt number. See DQ-07.
- **Voucher debit/credit imbalance** — vouchers are single-row two-account entries (`accounting.ts:53-69`); debit equals credit by construction, so imbalance is unrepresentable and the check is vacuous. Substituted: DQC-58 (debit==credit account) and DQC-29 (non-positive amounts). See DQ-08.
- **Ledger lines without vouchers** — no journal-line/ledger-line table exists. The `ledgers` table is a *patient-group dimension* (name + walk-in flags, `lib/db/src/schema/ledgers.ts:5-11`), not an accounting ledger. See DQ-08.
- **Tax totals vs line items** — `order_tests` has no tax columns (`orders.ts:28-45`), so an invoice-line tax reconciliation cannot be written. Substituted: DQC-31 (total identity) and DQC-33 (any nonzero `tax_amount` is unexplained). See DQ-14.

---

## 4. Strengths observed (verified this run)

These deserve explicit credit, because several are genuinely better than typical small-ERP practice:

1. **Refunds are ledgered, not overwritten.** A refund inserts a negative payment row *and* adjusts the cached totals in the same transaction with a `FOR UPDATE` row lock (`bills.ts:1166-1226`), preserving `paid_amount = SUM(payments)` and leaving a visible history. This is why checks DQC-35/36 are possible at all.
2. **Row-level locking on money mutations.** Cancel (`bills.ts:971-975`), refund (`bills.ts:1166-1170`), cancel-refund-tests (`bills.ts:1728`), standalone payments (`bills.ts:1901-1907`), and webhook settlement (`gateway-webhooks.ts:99-104`) all `SELECT … FOR UPDATE` inside transactions.
3. **Advisory-locked bill numbering** in both allocators (`bills.ts:571`, `self-registration.ts:182`) eliminates the classic duplicate-invoice race.
4. **A real partial unique index on gateway payments** (`add_payment_idempotency_index.sql:17-19`), present in both migration paths (`zz_schema_reconcile_20260709.sql:27207`), plus production remediation tooling (`migrations/manual-only/prepare_payment_uniqueness_index.sql:118-119`).
5. **Disciplined payment-method taxonomy** with an explicit "unknown → suspense, never cash" rule (`paymentMethodClassifier.ts:19-21, 102-104`) and a matching "Unclassified Collections (Needs Review)" ledger account instead of silent cash posting (`auto-voucher.ts:33-37`).
6. **Cancellation cascades to commission-bearing line items** (`bills.ts:998-1010`), closing a common leak where cancelled bills keep accruing referral commission.
7. **Honest engineering self-documentation.** The schema files openly confess past defects (the broken `client_ref` idempotency, `bills.ts:30-37`; `orders.ts:19-23`), which materially helped this audit.
8. **Append-only gateway diagnostics table** with masked secrets by design (`paymentGatewayDiagnostics.ts:5-20`).
9. **An audit hash chain exists at all** (`auditLogs.ts:9-14`) — most systems this size have none; the weaknesses noted in DQ-13 are fixable on a sound foundation.
10. **Fraud-alert taxonomy already anticipates the right abuse cases** (`banking.ts:169-181`: duplicate_utr, bill_deleted_after_collection, backdated_edit, …) even if population of the table wasn't verified here.

---

## 5. Findings

### [DQ-01] P0 — No CHECK constraints anywhere in the financial schema; every money invariant is application-side only
- Severity: P0
- Classification: Missing control
- Location: `lib/db/drizzle/0000_dear_forge.sql` (entire file — `grep -c "CHECK"` = 0, verified this run); representative columns `lib/db/src/schema/bills.ts:12-28` (`subtotal`…`refund_amount`), `lib/db/src/schema/bills.ts:48-57` (`payments.amount`), `lib/db/src/schema/accounting.ts:60` (`vouchers.amount`), `lib/db/src/schema/expenses.ts:10` (`expenses.amount`)
- Current behavior: every financial column is a bare `numeric(...)`/`text` with at most a `DEFAULT`. Nothing at the database level forbids `payments.amount = 0`, negative `bills.total_amount`, `discount > subtotal`, `paid_amount` disagreeing with payment rows, or a bill `status` outside the known set. E.g. `amount: numeric("amount", { precision: 10, scale: 2 }).notNull()` (`bills.ts:51`) — `NOT NULL` is the only constraint.
- Why unsafe: the application does enforce most rules at *some* endpoints (`bills.ts:529-536, 1888-1891`), but other endpoints (PUT `/bills/:id`, super-edit) and any direct DB access bypass them. A single buggy or malicious write path can persist financially impossible records that all reports will faithfully aggregate.
- Failure scenario: a maintenance script (or the super-edit endpoint) writes `discount = 5,000` on a bill with `subtotal = 3,000`; `total_amount` goes negative; the daily revenue report and Tally export both absorb ₹−2,000 with no error anywhere. The anomaly is only discoverable by running DQC-27/30/31 after the fact.
- Recommended correction: add CHECK constraints for the invariants the code already enforces: `amount <> 0` on payments, all bill money columns `>= 0`, `discount <= subtotal`, `ABS(total_amount - (subtotal - discount + tax_amount)) < 0.01`, `status IN (...)`, `vouchers.amount > 0`, `expenses.amount > 0`. Roll out with `NOT VALID` + `VALIDATE CONSTRAINT` after cleaning existing violations found by the audit script.
- Backward compatible: yes for new writes (the constraints codify existing app rules); existing violating rows must be remediated before `VALIDATE`.
- Data migration required: yes — run `accounting-data-audit.sql`, remediate hits from DQC-27…38, then validate constraints.

### [DQ-02] P0 — The reconcile DDL bootstrap creates bills/payments/vouchers with no unique constraints and no foreign keys
- Severity: P0
- Classification: Potential risk (must be validated against the live database)
- Location: `migrations/zz_schema_reconcile_20260709.sql:142-172` (`CREATE TABLE IF NOT EXISTS "bills"` — `bill_number text DEFAULT '' NOT NULL`, no UNIQUE), `:175-186` (`payments` — `bill_id integer DEFAULT 0 NOT NULL`, no FK), `:297-313` (`vouchers` — `voucher_number` without UNIQUE); index section creates only **non-unique** `idx_bills_bill_number` (`:27220`) and `idx_bills_bill_number_numeric` (`:27299`), and no unique index on `voucher_number` anywhere (full-file grep of `CREATE UNIQUE INDEX`, verified this run)
- Current behavior: the repo has (at least) two DDL sources of truth. Drizzle's `0000_dear_forge.sql` path declares `bill_number` / `voucher_number` unique; the idempotent "reconcile" script — designed to run on every deployment and to swallow errors (`EXCEPTION WHEN others THEN RAISE WARNING … SQLERRM`) — creates the same tables constraint-free when they don't exist. Whichever path first created the table on the production NAS determines whether invoice-number uniqueness is enforced at all. Notably the payments partial unique index *is* present in the reconcile path (`:27207`), so the protection level differs per table.
- Why unsafe: uniqueness of invoice and voucher numbers is the backbone of GST/audit correspondence. If production was bootstrapped (or repaired after an incident) via the reconcile path, duplicate `bill_number`s are DB-legal and the 23505-retry logic in voucher numbering never fires, silently allowing duplicate voucher numbers.
- Failure scenario: fresh Synology deployment where the reconcile script runs before Drizzle's migration (or Drizzle's step fails and is warning-swallowed). Two billing counters later hit the COUNT-based voucher allocator concurrently; both insert `RV-202607-0141`; the Tally export now contains two different receipts under one voucher number and the CA's import dedupes one of them — ₹ revenue silently dropped from the books.
- Recommended correction: run `\d bills`, `\d payments`, `\d vouchers` on production to inventory actual constraints; add the missing `UNIQUE` indexes and FKs via `CREATE UNIQUE INDEX CONCURRENTLY` after remediating duplicates surfaced by DQC-01/05; collapse to a single DDL source of truth.
- Backward compatible: yes — adds constraints only.
- Data migration required: yes — duplicate remediation first (DQC-01, DQC-05, DQC-13…16 outputs).

### [DQ-03] P1 — Cached bill totals (`paid_amount`/`refund_amount`/`balance_amount`) have ten independent writers and no reconciliation mechanism
- Severity: P1
- Classification: Architectural weakness
- Location: `lib/db/src/schema/bills.ts:18-19,27` (columns); writers verified this run: `artifacts/api-server/src/routes/bills.ts:599-600, 1037-1052, 1208-1226, 1783-1800, 1919-1937, 2349-2367`; `artifacts/api-server/src/routes/gateway-webhooks.ts:122-146`; `artifacts/api-server/src/services/self-registration.ts:194-209`; plus `public-booking.ts:1328` (grep-verified insert site)
- Current behavior: each writer recomputes `paid/balance/status` in JS from the row it read and writes the result back, e.g. `const newPaid = Number(bill.paidAmount) + amount; … newBalance = Math.max(0, Number(bill.totalAmount) - newPaid - existingRefund)` (`gateway-webhooks.ts:131-135`). There is no trigger, no generated column, no periodic job re-deriving the caches from `payments` (the books-sanity report exists but does not enforce).
- Why unsafe: any writer that forgets one term (historically: the refund term — the "FIX" comments at `bills.ts:1187-1195` and `gateway-webhooks.ts:132-134` show it was previously wrong), or any crash between the payment insert and the bill update on a path without a shared transaction, permanently desynchronizes the cache from the ledger. Dues lists, day-close expected-cash, and revenue reports all read the cache, not the ledger.
- Failure scenario: super-edit sets `totalAmount` on a bill with existing payments without touching `paid_amount` (it recomputes, but from body-supplied figures); a later webhook settlement adds `amount` to the stale `paidAmount` it read; `balance_amount` is now ₹500 lower than `total − SUM(payments) − refund`; the patient is never asked for the remaining ₹500 and the shortfall is invisible until DQC-35/37 is run.
- Recommended correction: (a) run DQC-35/36/37 on a schedule and alert on nonzero counts; (b) medium-term, derive the caches — either a trigger on `payments` maintaining the bill aggregates, or make reports read `SUM(payments)` directly.
- Backward compatible: yes — reconciliation is additive; a trigger changes no API shape.
- Data migration required: yes — one-time resync of caches from `payments` for rows DQC-35/36/37 flags.

### [DQ-04] P1 — No global uniqueness for gateway transaction identity; the only constraint is per-bill
- Severity: P1
- Classification: Missing control
- Location: `lib/db/src/schema/onlineBookings.ts:19-29` (five provider id columns, no unique index), `lib/db/src/schema/banking.ts:267` (`external_transaction_id`), `lib/db/src/schema/paymentLogs.ts:3-14` (no uniqueness at all), `migrations/add_payment_idempotency_index.sql:17-19` (unique only on `(bill_id, reference_number)`)
- Current behavior: the same provider transaction id can legally exist on two `online_bookings` rows, two `gateway_transactions` rows, and — because the payments index is scoped per bill — as payment rows on two *different* bills. Application dedupe is SELECT-then-INSERT (`gateway-webhooks.ts:107-119`; `bills.ts:2342-2347`), which is race-safe only within one bill thanks to the `FOR UPDATE` on the bill row.
- Why unsafe: one real ₹ payment must credit exactly one receivable. Cross-bill and cross-booking duplication of the same gateway reference is precisely how replayed/misrouted callbacks turn into double revenue recognition.
- Failure scenario: a patient pays ₹2,360 via ICICI for booking A; a support operator, reconciling manually, pastes the same UTR while settling bill B at the desk. Both inserts succeed (different `bill_id`). Reports show ₹4,720 collected against one bank credit of ₹2,360; the bank reconciliation shortfall surfaces weeks later with no pointer to the cause. DQC-07/08/09 are the detection net.
- Recommended correction: add unique indexes: `payments(reference_number)` filtered to gateway-style methods (or a dedicated `gateway_ref` column), `gateway_transactions(provider, external_transaction_id)`, and per-provider unique partial indexes on the `online_bookings` id columns.
- Backward compatible: yes, after deduplication; the columns already hold the values.
- Data migration required: yes — dedupe hits from DQC-07/08/09 before index creation.

### [DQ-05] P1 — Editing an expense double-posts it in the voucher ledger (full new amount, original voucher retained)
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/expenses.ts:152-168` (PATCH `/:id`), `artifacts/api-server/src/lib/auto-voucher.ts:195-243` (`autoVoucherForExpense`)
- Current behavior: on amount/payment-mode edit, the route comments "We fire a new PV for the updated amount (the original PV remains for audit)" (`expenses.ts:153`) and calls `autoVoucherForExpense({ expenseId: updatedExpId + "-edit", amount: updatedAmount, … })` (`expenses.ts:160-167`). `autoVoucherForExpense` posts a full debit of `amount` to the expense account (`auto-voucher.ts:224-236`) — not the delta, and nothing reverses the original voucher.
- Why unsafe: every edited expense is counted twice (old amount + full new amount) in trial balance, P&L, and the Tally export. This is not a hypothetical: it is the designed behavior of the only expense-edit endpoint.
- Failure scenario: staff records rent ₹30,000, then corrects a typo to ₹31,000 via PATCH. The books now carry PV#1 ₹30,000 + PV#2 ₹31,000 = ₹61,000 of rent against ₹31,000 actually paid. Monthly P&L understates profit by ₹30,000; the CA reconciling against bank statements chases a phantom payment.
- Recommended correction: on edit, post a reversal (credit) of the original voucher plus a new voucher for the corrected amount — or a single delta journal voucher — and link both to the expense via `expenses.voucher_id`. DQC-56 counts existing `-edit` vouchers for remediation.
- Backward compatible: no for the books — historical `-edit` vouchers must be reversed; API shape unchanged.
- Data migration required: yes — for each DQC-56 hit, post a reversing voucher of the *original* PV amount (with CA sign-off).

### [DQ-06] P1 — Super-admin bill deletion renumbers live invoices, deletes payment rows, and strands voucher references
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/bills.ts:1494-1526` (DELETE `/bills/:id`), `artifacts/api-server/src/lib/auto-voucher.ts:169-172` (vouchers freeze `bill_number` into `reference`)
- Current behavior: the delete transaction hard-deletes all payment rows (`tx.delete(paymentsTable)…`, `bills.ts:1498`), deletes the bill, then rewrites `bill_number` of every later bill in the month to `seq − 1` (`bills.ts:1518-1524`). Vouchers are neither deleted nor updated: `vouchers.bill_id` now points at a missing bill, and every voucher for the renumbered bills still carries the *old* `bill_number` in `reference`/`particular` (`auto-voucher.ts:154-155, 172`).
- Why unsafe: invoice numbers stop being stable identifiers — a printed receipt held by a patient, a voucher in the books, and a Tally export from last week may all reference numbers that now belong to *different* bills. Deleted payments leave revenue vouchers with no underlying payment (unfalsifiable books).
- Failure scenario: bill 2026070042 (₹5,000, paid, receipt printed, RV posted) is deleted. Bills 0043…0090 each shift down one number. The RV for old-0043 (`reference = '2026070043'`) now points at what was 0044. A GST officer sampling invoice 2026070043 against the books finds a voucher for a different patient and amount. Meanwhile the deleted bill's ₹5,000 RV survives with a dangling `bill_id` — revenue with no invoice.
- Recommended correction: never renumber; mark deleted bills `cancelled`/`void` and keep the number burned (standard invoice practice). If deletion must exist, cascade an update to `vouchers.reference` and insert reversal vouchers for the deleted payments. DQC-21/23/60 detect the existing damage.
- Backward compatible: no — removes an existing (dangerous) capability; frontend delete flow must change.
- Data migration required: yes — reconcile DQC-60 mismatches against `bill_audits` history to re-anchor voucher references.

### [DQ-07] P1 — No receipt entity exists; several mandated receipt checks are structurally inexpressible
- Severity: P1
- Classification: Missing control
- Location: `lib/db/src/schema/` (entire directory — no `pgTable("receipt…")`, verified by grep this run); `lib/db/src/schema/bills.ts:48-57` (`payments` — no `receipt_number` column); `bills.ts:41` (`receipt_verification_count` counter confirms receipts are rendered from payments/bills directly)
- Current behavior: what the patient receives as a "receipt" is a rendering of the payment/bill row. There is no receipts table, no receipt number sequence, no record of *which* payment rows were presented on which printed receipt.
- Why unsafe: the audit brief's checks "duplicate receipt numbers" and "multiple receipts per payment" cannot be written at all. If a dispute arises ("I have receipt X for ₹2,000"), the system cannot prove which payment row that paper corresponds to, and a reprinted/altered receipt is indistinguishable from the original. Reprint logging exists for bills (`reprint_reasons` table) but there is no per-receipt identity to log against.
- Failure scenario: a cashier collects ₹2,000 cash, prints a receipt, then deletes… cannot delete, but a super-admin bill deletion (DQ-06) removes the payment row entirely; the patient's paper receipt now references a payment the database says never happened, and no receipt register exists to contradict the deletion.
- Recommended correction: add a `receipts` table (serial receipt_number, payment_id FK, printed_by, printed_at, hash of rendered content) written transactionally with each payment and on every reprint.
- Backward compatible: yes — purely additive.
- Data migration required: optional backfill (one synthetic receipt per historical payment).

### [DQ-08] P2 — Single-row voucher design makes double-entry imbalance and ledger-line checks unrepresentable
- Severity: P2
- Classification: Architectural weakness
- Location: `lib/db/src/schema/accounting.ts:53-69` (`vouchers`: one `amount`, one `credit_account_id`, one `debit_account_id`); `lib/db/src/schema/ledgers.ts:5-11` (`ledgers` is a patient-group dimension, not an accounting ledger)
- Current behavior: a voucher is a single row with exactly one debit and one credit account and one amount. There is no journal-line table; debit always equals credit by construction.
- Why unsafe: the brief's checks "voucher debit/credit imbalance" and "ledger lines without vouchers" are vacuous here — which sounds safe but actually means compound entries (a payment split across GST payable + revenue, a salary voucher with TDS) *cannot be represented correctly at all*; users must fabricate multiple single-row vouchers with no grouping key, and no query can verify the group balances.
- Failure scenario: recording a ₹10,000 receipt of which ₹457 is GST requires two vouchers with no linkage; if the second insert fails (auto-voucher errors are swallowed — `auto-voucher.ts:181-183`), the books are silently short ₹457 and no imbalance check can exist to catch it.
- Recommended correction: introduce `voucher_lines(voucher_id, account_id FK, dr_cr, amount)` with a triggered or job-based `SUM(dr)=SUM(cr)` verification; keep the current table as a view for compatibility.
- Backward compatible: yes with a compatibility view; exports need updating.
- Data migration required: yes — mechanical expansion of each voucher row into two lines.

### [DQ-09] P1 — Voucher account references are free text with no FK; postings can point at nothing
- Severity: P1
- Classification: Missing control
- Location: `lib/db/src/schema/accounting.ts:58-59` (`creditAccountId: text("credit_account_id").notNull(), debitAccountId: text("debit_account_id").notNull()`); writer evidence `artifacts/api-server/src/lib/auto-voucher.ts:85-90` (`ensureAccount` returns `created.id.toString()`), manual edit path `routes/accounting.ts:320` (PATCH updates written without account validation in the code read this run)
- Current behavior: auto-vouchers store the numeric `accounts.id` as a string; nothing prevents any other writer (manual voucher creation/edit, imports) from storing an account *name*, a typo, or an id that was later deleted. The audit script (DQC-22) has to *guess* the representation (`a.id::text = v.debit_account_id`).
- Why unsafe: trial balance and P&L group by account; a voucher whose account string resolves to nothing simply vanishes from statements while remaining in the voucher list — money that is in the books but in no report.
- Failure scenario: an admin edits a voucher and sets `debitAccountId` to "Cash in Hand" (the name, not the id). The ₹8,000 receipt disappears from the Cash-in-Hand ledger and from the trial balance's cash total; the drawer appears ₹8,000 over; staff are investigated for a phantom surplus.
- Recommended correction: convert both columns to `integer REFERENCES accounts(id)` after remediating DQC-22 hits; validate account existence in the PATCH/POST voucher handlers meanwhile.
- Backward compatible: no (column type change) — but a two-step migration (add new int columns, backfill, swap) avoids API breakage.
- Data migration required: yes — resolve non-numeric/orphan references (DQC-22).

### [DQ-10] P2 — Financial dates stored as text (`vouchers.date`, `expenses.expense_date`, `bills.due_date`)
- Severity: P2
- Classification: Missing control
- Location: `lib/db/src/schema/accounting.ts:57`, `lib/db/src/schema/expenses.ts:11`, `lib/db/src/schema/bills.ts:22`
- Current behavior: all three are `text(...)` columns. Auto-voucher writes ISO strings via `toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })` (`auto-voucher.ts:111-113`), but nothing forces other writers to.
- Why unsafe: a voucher dated `"31/03/2026"` or `"2026-3-5"` silently falls out of every string-range period filter (financial-year P&L, GST period exports) without error — period totals are understated with no anomaly signal.
- Failure scenario: an imported bank-statement voucher carries `date = '01-04-2026'`. The FY-2026-27 trial balance's `WHERE date >= '2026-04-01'` misses it; books show a ₹1,00,000 mismatch against the bank that takes days to trace.
- Recommended correction: migrate to `date` columns (Postgres will refuse garbage), or minimally add `CHECK (date ~ '^\d{4}-\d{2}-\d{2}$')`. DQC-59 inventories current violations.
- Backward compatible: yes if values are already ISO; the check constraint is additive.
- Data migration required: yes — normalize any DQC-59 hits first.

### [DQ-11] P2 — Financial actor attribution is unverifiable free text, including hardcoded actor names
- Severity: P2
- Classification: Missing control
- Location: `lib/db/src/schema/bills.ts:23,55` (`created_by_name`, `recorded_by_name`); hardcoded actors: `routes/bills.ts:2355` (`recordedByName: "Super Admin"` on desk gateway reconcile), `routes/gateway-webhooks.ts:96` (`performedBy = "Gateway Webhook"`); `lib/db/src/schema/expenses.ts:15` (`approved_by` nullable text); `lib/db/src/schema/users.ts:57-66` (`bill_audits.edited_by` text)
- Current behavior: no money table stores a `user_id` FK for the acting cashier; day-close per-user attribution joins on the *name string*. The desk gateway-status reconcile stamps every payment "Super Admin" regardless of who initiated it.
- Why unsafe: cash accountability ("who took this ₹?") rests on strings that collide (two staff named the same), change (renames), or are simply wrong (the hardcoded values). Per-user drawer closure (`user_day_closures.user_name`, `lib/db/src/schema/userDayClosures.ts:10`) can mis-bucket collections.
- Failure scenario: two receptionists both display-named "Priya" work the same shift; ₹4,300 cash goes missing; `recorded_by_name = 'Priya'` cannot resolve which drawer was short, and the ICICI desk payments booked to "Super Admin" further muddy the per-user expected-cash totals.
- Recommended correction: add nullable `recorded_by_user_id`/`created_by_user_id` FKs alongside the names, populate from the authenticated session, and stop hardcoding actor names on reconcile paths (carry the initiating session's identity in the payment_log).
- Backward compatible: yes — additive columns; names retained for display.
- Data migration required: optional best-effort backfill by name matching.

### [DQ-12] P2 — Day close cannot be reconciled to the exact payment set it certified, and backdating is undetectable
- Severity: P2
- Classification: Architectural weakness
- Location: `lib/db/src/schema/dayClosures.ts:8-14` (non-blocking coverage-window semantics), `:45-63` (only aggregates + `staff_breakdown`/`test_summary` jsonb snapshots are stored); `lib/db/src/schema/bills.ts:56` (`payments.created_at` is the only time dimension)
- Current behavior: a closure row stores expected/actual aggregates and a jsonb staff breakdown, but no list of the payment ids it covered; payments carry only `created_at` (`defaultNow()`), with no business-date column and no DB-level insert audit. The schema comment is explicit: "Bills/payments created AFTER closedAt automatically belong to the next open day — there is no hard block" (`dayClosures.ts:12-14`).
- Why unsafe: after sign-off, the certified totals cannot be re-derived provably — recomputing `SUM(payments)` over the window today may differ from what was summed at close time if rows were deleted (DQ-06 deletes payment rows!) or if clock-skewed inserts land inside the window, and there is no way to tell which. A cashier who records cash *after* closing (allowed by design) defers it to the next day silently; DQC-51 can flag it, but a *backdated* `created_at` (via direct DB access) is undetectable.
- Failure scenario: day closed at 21:02 with expected cash ₹18,500 = actual. At 21:30 the same cashier records the day's last ₹1,500 cash bill (permitted); the money sits in the drawer overnight uncounted; next evening's expected-cash includes it and the drawer balances — but for 22 hours ₹1,500 existed outside any certified count, invisible unless DQC-51 is run.
- Recommended correction: store the max `payments.id` (watermark) and per-method payment-id checksums on each closure; alert on any payment whose `created_at` falls inside an already-closed window; consider a same-IST-date soft warning in the UI when recording money after close.
- Backward compatible: yes — additive columns and checks.
- Data migration required: no.

### [DQ-13] P2 — Audit-log hash chain admits unhashed rows by default
- Severity: P2
- Classification: Missing control
- Location: `lib/db/src/schema/auditLogs.ts:32-33` (`previousHash: … .notNull().default("")`, `chainHash: … .notNull().default("")`)
- Current behavior: any INSERT that omits the hash columns (a new code path, a manual fix-up, a bulk import) produces a row with empty hashes that is fully DB-legal. The chain property (`previous_hash(N) = chain_hash(N−1)`) is maintained only by the application writer.
- Why unsafe: the chain's evidentiary value collapses if unhashed rows can exist — a tamperer can insert/replace rows with `''` hashes and claim "legacy writer". DQC-61 detects both empty hashes and lag-mismatches, but prevention is absent.
- Failure scenario: an operator with DB access deletes an incriminating `refund` audit row and re-inserts sanitized neighbors with empty hashes; the verification endpoint (application-level) may skip or fail open on empty-hash rows depending on implementation; the SQL check flags them, but only if someone runs it.
- Recommended correction: `CHECK (chain_hash <> '')` (after backfilling legacy rows), plus a REVOKE of UPDATE/DELETE on `audit_logs` from the application role so append-only is enforced by grants, not convention.
- Backward compatible: yes after backfill of legacy empty-hash rows.
- Data migration required: yes — hash-backfill for pre-chain rows.

### [DQ-14] P2 — `tax_amount` is hardcoded to zero at creation and no line-level tax data exists to support any nonzero value
- Severity: P2
- Classification: Requires CA/GST-professional validation
- Location: `artifacts/api-server/src/routes/bills.ts:549-550` (`const taxAmount = 0; const totalAmount = subtotal - discountAmt + taxAmount;`); `lib/db/src/schema/orders.ts:28-45` (`order_tests` has no tax/HSN/SAC columns); `lib/db/src/schema/bills.ts:16` (`tax_amount` column exists regardless)
- Current behavior: every bill is created with zero tax; the column can nevertheless be set by edit paths. No table stores per-line taxable value, rate, or HSN/SAC code, so a tax-vs-line-items reconciliation (mandated by the brief) cannot be expressed — DQC-33 substitutes "any nonzero tax_amount is unexplained".
- Why unsafe: healthcare diagnostic services are commonly GST-exempt in India, so zero *may* be correct — but that is a business ruling, not a code fact, and the moment any taxable supply (e.g. cosmetic procedures, sale of consumables, VIP convenience fees) is billed through this pipeline, the system can neither compute nor evidence the tax. Any nonzero `tax_amount` that appears in data has no supporting breakdown for a GST audit.
- Failure scenario: the hospital starts billing a taxable wellness package through the same desk; staff manually set `tax_amount` via an edit; GSTR filings are prepared from a column with no rate, no HSN, and no line linkage; a departmental audit requests the invoice-level tax computation and none exists.
- Recommended correction: obtain written CA confirmation that all billed services are exempt; if any taxable supply exists or is planned, add per-line `taxable_value/tax_rate/hsn_sac` columns and compute `tax_amount` from them. Keep DQC-33 as a tripwire (expected count: 0).
- Backward compatible: yes — additive schema.
- Data migration required: no (unless taxable history exists — CA call).

### [DQ-15] P2 — Expenses carry no user identity and approval is optional free text; "expenses missing user" is only weakly checkable
- Severity: P2
- Classification: Missing control
- Location: `lib/db/src/schema/expenses.ts:5-19` (full column list: no `user_id`, no `created_by`; `approvedBy: text("approved_by")` nullable; `category`/`description` NOT NULL but empty-string legal)
- Current behavior: an expense records *who was paid* (`paid_to`, optional) and *who approved* (free text, optional) but never who entered it. The brief's check "expenses missing category/user" degrades to DQC-54: blank category/description or empty `approved_by`.
- Why unsafe: cash expenses reduce the drawer (`day-close` subtracts them); an expense with no accountable creator and no approver is an unattributed cash outflow — the classic petty-cash leak shape.
- Failure scenario: ₹6,000 cash expense "misc repairs", `approved_by` empty, entered at 20:55 just before day close; drawer balances because expected cash was reduced; nobody can later say who keyed it in.
- Recommended correction: add `created_by_user_id` FK populated from the session; make `approved_by` (or an approver user-id) mandatory above a threshold; enforce non-empty category via CHECK.
- Backward compatible: yes — additive; threshold rule is new behavior.
- Data migration required: no.

### [DQ-16] P3 — Historically broken client-ref idempotency means legacy duplicate bills/orders may exist and are only heuristically detectable
- Severity: P3
- Classification: Potential risk
- Location: `lib/db/src/schema/bills.ts:30-37` and `lib/db/src/schema/orders.ts:19-23` (in-code confessions: the `clientRef` column was "permanently NULL", making the idempotency check "always a no-op: a genuine network-retried bill creation was never recognized as a retry"); current guard `routes/bills.ts:387-411` (works now), fallback 60-second same-patient fence `bills.ts:444-469`
- Current behavior: the retry-dedup path is fixed (unique indexes on `client_ref` exist in the reconcile DDL at `zz_schema_reconcile_20260709.sql:27077-27082`), but any duplicates created while it was broken persist with `client_ref = NULL` and are indistinguishable from legitimate repeat billing except by heuristics.
- Why unsafe: legacy duplicate bills inflate historical revenue and receivables; duplicate cash payments from the same era inflate collections.
- Failure scenario: during the broken period, a timeout retry created bills 2026050122 and 2026050123 for the same order… (the same-order guard would 409; the realistic case is duplicate *orders* + their bills). Both were paid in cash once; one shows as perpetual dues, distorting the outstanding report ever since.
- Recommended correction: run DQC-12 (cash near-duplicates) and DQC-43 (multiple active bills per order), plus a targeted historical query for same-patient same-amount bills within minutes of each other; remediate via cancellation with reason.
- Backward compatible: yes — investigation only.
- Data migration required: possibly — cancel/refund remediation of confirmed legacy duplicates.

### [DQ-17] P3 — Voucher numbering is COUNT(*)-based and hard deletes recycle numbers
- Severity: P3
- Classification: Potential risk
- Location: `artifacts/api-server/src/lib/auto-voucher.ts:101-109` (`nextVoucherNumber` = `count(*)` over a LIKE-match + 1), `routes/accounting.ts:329-335` (`DELETE /vouchers/:id` hard-deletes with no audit row, no reason, no closed-period check)
- Current behavior: deleting any voucher in a month decrements the count, so the next allocation reuses the highest existing number's slot; the retry loop relies on a 23505 unique violation which (per DQ-02) may not exist on reconcile-bootstrapped DBs.
- Why unsafe: recycled voucher numbers create ambiguous references in exports already taken (a Tally export from before the delete carries a number now pointing at a different entry), compounding DQ-06's stale-reference problem.
- Failure scenario: RV-202607-0300 (₹12,000) is deleted; the next auto-voucher is numbered RV-202607-0300 again for a different ₹3,500 payment; last week's Tally export and this week's disagree about what RV-202607-0300 is.
- Recommended correction: allocate from a monotonic sequence (Postgres `SEQUENCE` per type), never from COUNT; forbid voucher hard-delete (status='void' + audit) — align with DQ-06's no-renumber rule.
- Backward compatible: yes — numbering only moves forward.
- Data migration required: no.

---

## 6. Findings register

| ID | Severity | Classification | Title | Location |
|---|---|---|---|---|
| DQ-01 | P0 | Missing control | No CHECK constraints anywhere in the financial schema | `lib/db/drizzle/0000_dear_forge.sql`; `lib/db/src/schema/bills.ts:12-28,48-57` |
| DQ-02 | P0 | Potential risk | Reconcile DDL bootstrap creates bills/payments/vouchers without unique/FK constraints | `migrations/zz_schema_reconcile_20260709.sql:142-186,297-313,27220,27299` |
| DQ-03 | P1 | Architectural weakness | Cached bill totals have ten writers and no reconciliation mechanism | `lib/db/src/schema/bills.ts:18-19,27`; `routes/bills.ts:599-2367` (multiple); `gateway-webhooks.ts:122-146` |
| DQ-04 | P1 | Missing control | No global uniqueness for gateway transaction identity | `lib/db/src/schema/onlineBookings.ts:19-29`; `banking.ts:267`; `paymentLogs.ts:3-14`; `migrations/add_payment_idempotency_index.sql:17-19` |
| DQ-05 | P1 | Confirmed defect | Expense edits double-post full-amount vouchers | `routes/expenses.ts:152-168`; `lib/auto-voucher.ts:195-243` |
| DQ-06 | P1 | Confirmed defect | Bill deletion renumbers invoices, deletes payments, strands voucher references | `routes/bills.ts:1494-1526`; `lib/auto-voucher.ts:169-172` |
| DQ-07 | P1 | Missing control | No receipt entity; receipt-level checks inexpressible | `lib/db/src/schema/` (absent table); `bills.ts:48-57` |
| DQ-08 | P2 | Architectural weakness | Single-row vouchers make imbalance/ledger-line checks unrepresentable | `lib/db/src/schema/accounting.ts:53-69`; `ledgers.ts:5-11` |
| DQ-09 | P1 | Missing control | Voucher account references are free text with no FK | `lib/db/src/schema/accounting.ts:58-59`; `lib/auto-voucher.ts:85-90` |
| DQ-10 | P2 | Missing control | Financial dates stored as text | `accounting.ts:57`; `expenses.ts:11`; `bills.ts:22` |
| DQ-11 | P2 | Missing control | Actor attribution is free text incl. hardcoded names | `bills.ts:23,55`; `routes/bills.ts:2355`; `gateway-webhooks.ts:96`; `expenses.ts:15` |
| DQ-12 | P2 | Architectural weakness | Day close not reconcilable to certified payment set; backdating undetectable | `lib/db/src/schema/dayClosures.ts:8-14,45-63`; `bills.ts:56` |
| DQ-13 | P2 | Missing control | Audit hash chain admits unhashed rows | `lib/db/src/schema/auditLogs.ts:32-33` |
| DQ-14 | P2 | Requires CA/GST-professional validation | tax_amount hardcoded zero; no line-level tax data | `routes/bills.ts:549-550`; `lib/db/src/schema/orders.ts:28-45` |
| DQ-15 | P2 | Missing control | Expenses carry no user identity; approval optional | `lib/db/src/schema/expenses.ts:5-19` |
| DQ-16 | P3 | Potential risk | Legacy duplicates from historically broken client-ref idempotency | `lib/db/src/schema/bills.ts:30-37`; `orders.ts:19-23` |
| DQ-17 | P3 | Potential risk | COUNT-based voucher numbering + hard delete recycles numbers | `lib/auto-voucher.ts:101-109`; `routes/accounting.ts:329-335` |

---

*Prepared by dimension auditor DQ, 2026-07-16. The companion SQL script `accounting-data-audit.sql` (61 checks) was schema-verified against `lib/db/src/schema/*.ts` in this run but has NOT been executed against any production or copy database from this environment; all data-level anomaly counts remain UNVERIFIED until it is run per section 2.*
