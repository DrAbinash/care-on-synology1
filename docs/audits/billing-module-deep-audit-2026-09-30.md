# CARE ERP — Billing Module Deep Forensic Audit

**Date:** 2026-09-30
**Repository:** `DrAbinash/care-on-synology1` (audited from local clone, `main` @ `e1cf96b13d32d6ab31d3d4498dc3ab679d735177`)
**Mode:** READ-ONLY deep audit. No application code, database, migration, deployment, or merge was modified. This document is the only artifact produced.
**Scope:** Billing end-to-end — order/bill creation, pricing, discounts, payments (cash/UPI/card/gateway), refunds, cancellations, dues, day-close/reconciliation, accounting vouchers, RBAC, concurrency, audit trail, tests.

**Method.** Every conclusion below was derived by reading the execution path end-to-end (route mount → middleware → handler → transaction → SQL), not from file names or comments. Citations use `file:line` against the audited commit. Where a behavior could not be proven statically it is listed in §15 (probable defects requiring runtime verification), not in §14. Money formulas in §5 are derived from the implementation, not assumed.

> Line numbers refer to the audited commit; they will drift as the code evolves. Search-able anchors (function/route names) are given alongside.

---

## 1. Executive Summary

The billing core is substantially more disciplined than a typical clinic ERP: money arithmetic is integer-paise throughout the desk path (`lib/money.ts`), bill-row `SELECT … FOR UPDATE` locks serialize concurrent mutations of the same bill, gateway payment posting is idempotent at the database level via two partial unique indexes, webhook signature verification is mandatory and fail-closed, cancelled bills are terminal, and a two-tier audit system (plain `bill_audits` + hash-chained `audit_logs`) records most billing mutations.

However, the audit found **material defects in the money-out paths, in authorization granularity, and in historical-record integrity**:

1. **Refunds and overpayment returns have no idempotency key.** Manual refunds insert a negative `payments` row with `reference_number = NULL` (`routes/bills.ts` refund handler, ~line 2060; auto-refunds in `cancel-refund-tests` and `swap-test` similarly). The database-level duplicate guards (`idx_payments_bill_reference_uq`, `idx_payments_bill_gateway_txn_uq`) are partial indexes that only fire when the reference column is non-NULL — so a retried/double-clicked refund **records the refund twice**, silently corrupting `paid_amount`, `balance_amount`, refunds reports, and the day-close cash position. (§14-D1, P1)
2. **Cash/UPI collection via `POST /api/payments` is idempotent only when a `referenceNumber` is supplied** (`routes/bills.ts:2791-2933`). Desk cash collections typically carry none, so a lost HTTP response + retry double-records money-in. (§14-D2, P1)
3. **Several money-mutating and commission-redirecting endpoints have no permission granularity** beyond the module mount: `change-doctor` (redirects referral commission), `cancel-test`, `cancel-refund-tests` (auto-refunds), `swap-test` (auto-refunds), `initiate-gateway-payment` — all callable by any user holding `/billing`. Three of them also take the acting user's name from the request body (`performedBy`), so the recorded actor is client-controlled. (§14-D3/D4, P1)
4. **Super-admin bill delete hard-deletes `payments` rows and renumbers every later bill in the month** (`routes/bills.ts:2324-2413`) — irreversible destruction of financial evidence plus mutation of historical document numbers. Super-edit performs bill/order/line updates **without a wrapping transaction** (`routes/bills.ts:2204-2321`), so a mid-flight failure leaves a bill whose lines and totals disagree. (§14-D5/D6, P1)
5. **Tax is structurally zero:** `taxAmount` is hardcoded `0` at bill creation (`routes/bills.ts:~785`) while the schema, the money helpers, and the reports all support it — a latent correctness trap if GST is ever switched on. (§14-D7, P1)
6. **Gateway settlement math uses floating-point addition** (`routes/gateway-webhooks.ts:190`, `routes/bills.ts:~3384`) in exactly the two code paths that the rest of the system protects with integer-paise helpers. (§14-D8, P1)
7. **Security defaults are weak:** bootstrap super-admin PIN `1234` with an unconditional re-promotion UPDATE on every startup, `INTERNAL_API_KEY` default `1234`, and staff session tokens accepted via `?staffToken=` query strings (token leakage into logs/proxies). (§18)
8. **The hash-chained audit log does not cover billing money movements.** Those live only in the plain `bill_audits` table; a privileged DB-level actor can tamper with them undetectably. (§14-D11, P2)

No single P0 "money vanishes today" defect was proven, but D1–D3 combined mean that ordinary desk operations (retry on flaky network, a disgruntled biller) can misstate cash and dues without leaving any alarm. The remediation plan (§20) sequences idempotency keys and sub-permission gates first.

**Overall grade: B−.** The invariant engine, locking discipline, and gateway hardening are genuinely good; the refund/out-money paths, RBAC granularity, and destructive super-admin operations are below the bar for a production financial system.

---

## 2. Architecture Map

pnpm monorepo, four runtimes plus shared libs:

| Path | Role | Billing-relevant contents |
|---|---|---|
| `artifacts/api-server` | Express 5 API (Node) | All billing routes; this audit's focus |
| `artifacts/diagnostic-erp` | Vite React SPA (staff ERP) | Billing Desk, Register, Bills, Day Close UIs |
| `artifacts/clinic-site` | Public site | Online booking + payment |
| `artifacts/diagno-booking-mobile` | Patient mobile app | Booking/payment views |
| `lib/db` | Drizzle ORM + schema + migrations | `schema/bills.ts`, `orders.ts`, `dayClosures.ts`, …; `drizzle/` migrations 0000-0014 |
| `artifacts/api-server/migrations/*.sql` | Feature SQL migrations (~180 files, alphabetical apply) | Payment idempotency indexes, sequences, backfills |

### 2.1 Key server files (billing)

| File | Lines | Responsibility |
|---|---|---|
| `src/routes/bills.ts` | 3446 | Bill CRUD, cancel, refund, waive-due, swap/cancel tests, change-doctor, super-edit, super-delete, payments router (`POST /`), gateway initiate/status, tokens, form-F patch |
| `src/routes/orders.ts` | 534 | Order create (line pricing, packages, VIP, numbering), status updates |
| `src/routes/billingDeskSave.ts` | 133 | One-shot order+bill for the desk (`POST /api/billing/save`) |
| `src/routes/gateway-webhooks.ts` | 727 | ICICI/HDFC S2S webhooks, `settleBill`, `/reconcile`, `/pending-online-bills` |
| `src/routes/online-bookings.ts` | — | Public booking → `confirmBookingInternal` (bill creation) |
| `src/routes/day-close.ts` | 2235 | Overall + per-user day closures, denominations, reopen |
| `src/routes/my-daily-summary.ts` | 1452 | Per-staff shift summary; admin KPI endpoints |
| `src/routes/daily-summary.ts`, `reports.ts`, `reconciliation.ts` | 546/794/— | Summary/report/reconciliation read models |
| `src/lib/money.ts` | — | Integer-paise arithmetic, `MONEY_EPS_PAISE = 1` |
| `src/lib/financialIntegrity.ts` | — | Invariant assertions, line-price resolution, VIP multiplier |
| `src/lib/dueWaiver.ts` | 139 | Pure due-waiver planner |
| `src/lib/documentNumberCounters.ts` | 246 | SEQUENCE-backed bill/order/patient numbering |
| `src/lib/auto-voucher.ts` | 779 | Double-entry voucher generation for payments/refunds/expenses |
| `src/middleware/requireStaffAuth.ts` | 331 | Session auth (Bearer or `?staffToken=`), permission checks, `FULL_ACCESS_ROLES` |
| `src/routes/index.ts` | 1148 | All mounts + mount-level permissions |

### 2.2 Runtime topology

Single Node process (`src/index.ts`) mounting `routes/index` at `/api` on the Express app; PostgreSQL via `@workspace/db` (node-postgres pool). Startup runs `runStartupMigrations` under `pg_advisory_lock`, which applies `artifacts/api-server/migrations/*.sql` in alphabetical order — this is the third DDL source besides the Drizzle migrations in `lib/db/drizzle` and hand-run SQL (see §4.4 drift).

### 2.3 Money representation

All monetary DB columns are `numeric` (strings on the JS side). Canonical arithmetic is **integer paise**: `lib/money.ts` converts to paise (`rupeesToPaise`), adds/subtracts integers, and converts back, with `MONEY_EPS_PAISE = 1` tolerance. Two gateway settle paths violate this (§14-D8).

---

## 3. End-to-End Workflow Map

### 3.1 Bill creation paths (five entry points, one core handler)

1. **Billing Desk one-shot** (primary): SPA `BillingDesk.tsx` → `POST /api/billing/save` (`billingDeskSave.ts`) → calls `createOrderHandler` then `createBillHandler` in-process with a captured response object; requires both `/orders` and `/billing` permissions (`routes/index.ts:427-433`). Bill leg forces `fast=1` (async token fan-out). On bill failure after order success, returns HTTP 500 **with `orderId`** so the desk can recover the orphan order (documented behavior, `billingDeskSave.ts` catch block).
2. **Two-step**: `POST /api/orders` (`routes/index.ts:420`) then `POST /api/bills` (`routes/index.ts:423`).
3. **Online booking payment**: public `POST /public/booking/*` → `online_bookings` row → gateway webhook/callback → `confirmBookingInternal(bookingId, actor)` creates the bill + accounting through the same core path.
4. **Kiosk self-registration** (`/kiosk`, public + rate-limited): patient registers and pays by UPI unattended.
5. **Emergency bridge** (DS225+ offline Windows box): pushes JSON bills to Main CARE when it returns (`/emergency-bridge`, fetch-token auth); `emergencyBilling` admin router imports through the canonical order/bill/payment tables (no second billing engine).

**Order leg** (`orders.ts:137-466`):
- Validates patient, doctor, tests (existence **and** `isActive`) — inactive tests are rejected so discontinued items cannot be mis-charged.
- Line prices via `resolveOrderLinePrices` (`lib/financialIntegrity.ts`): package components allocate from package config; unpackaged tests honor desk floor/ceiling — **non-admins may undercharge but a markup above catalogue is a 403 `PRICE_CEILING`**; admins may set any price. VIP flag applies `vipPercentage` from clinic settings (default 50 if unset/invalid, `orders.ts:315-323`) as a **surcharge multiplier (adds percent)**.
- `totalAmount = moneyAdd(line prices)` (integer paise), `ledgerId = doctor.ledgerId ?? 1` (silent fallback to ledger 1, `orders.ts:378`).
- Order + order_tests inserted in **one transaction**; order number from monthly SEQUENCE `next_order_number_seq(YYYYMM)` (IST bucket) — no advisory lock; up to 5 retries on unique violation with `syncOrderNumberSeqForward` reseed; a concurrent same-`clientRef` race returns the winner's order (HTTP 200, `orders.ts:432-438`).
- Idempotency: `orders.client_ref` unique — a retry with the same `clientRef` replays the existing order even before body validation (`orders.ts:152-173`).

**Bill leg** (`bills.ts:594-…` `createBillHandler`):
- Idempotency pre-check on `clientRef` (partial unique index `bills_client_ref_uidx`), replay returns the existing bill.
- 60-second same-patient duplicate-bill guard — **skipped when `clientRef` is present** (retry-safety beats the heuristic).
- Discount authorization at `bills.ts:~776`: non-admin discount capped at the session user's `maxDiscount` percent; `assertDiscountNotBelowCollected` rejects discounts that would take the bill below already-collected money (server-side, not just UI).
- **`taxAmount` is hardcoded to 0** at creation (`bills.ts:~785`) — see §14-D7.
- Inline `payments[]` recorded inside the same transaction; `assertNonNegativePayment` blocks negative amounts here (refunds have their own path).
- Bill number: `YYYYMM` + global SEQUENCE `bill_number_seq` suffix (`bills.ts:217`, `documentNumberCounters.ts`) — a **global** counter across months, not a per-month counter; `syncBillNumberSeqForward` bumps it to `MAX(existing suffix)` on deploy so pre-sequence bills are not re-issued.
- Post-commit: `autoVoucherForPayment` (double-entry), token fan-out (fast mode), audit row.

### 3.2 Payment intake paths (five, converging on `payments` + `bills`)

| Path | Trigger | Auth | Idempotency |
|---|---|---|---|
| Inline at bill create | `payments[]` in `POST /api/bills` | `/billing` mount | `clientRef` bill-level; payment rows checked against existing refs |
| Standalone collection | `POST /api/payments` (`bills.ts:2791`) | `/payments` mount (`index.ts:436`) | **Only when `referenceNumber` supplied** (§14-D2) |
| Gateway poll (browser return) | `GET /api/bills/:id/gateway-payment-status?txnRef=…` (`bills.ts:3255`) | `/billing` mount | `referenceNumber`/`gatewayTxnId` = `BILLPAY-<id>-<hex>` match |
| Gateway S2S webhook | `POST /api/gateway/icici-webhook` \| `/hdfc-webhook` (`gateway-webhooks.ts:244/401`) | Public; **mandatory HMAC/SHA256 signature** | `settleBill` matches both ref columns + DB unique indexes |
| Manual reconciliation | `POST /api/gateway/reconcile` (`gateway-webhooks.ts:539`) | `requireStaffAuth` | Same `settleBill` guard |

- `initiate-gateway-payment` (`bills.ts:3149`): rejects already-paid bills; amount ≤ `balanceAmount`; mints `BILLPAY-<billId>-<6hex>`; persists redirect URL/initiator/expiry into `payment_logs.requestPayload`.
- Webhooks acknowledge 200 **before** processing (gateways require sub-5s ACK); signature verification is mandatory and fail-closed on missing hash/secret/mismatch (both gateways — see `verifyIciciWebhookSignature` / `verifyHdfcWebhookSignature`, `gateway-webhooks.ts:64-107`; the HDFC signed string now binds `amount`).
- `settleBill` (`gateway-webhooks.ts:113-209`): `FOR UPDATE` on the bill; **cancelled bills are terminal** (settlement refused, no payment row, warn log); duplicate detection matches `reference_number` OR `gateway_txn_id` against both key columns (covers pre/post-refactor rows); inserts payment with `settlementStatus = 'captured'`; updates bill under the same transaction.
- Booking-path webhooks mark `online_bookings.status = 'paid'` then call `confirmBookingInternal`, which creates the bill through the canonical path.

### 3.3 Outstanding dues

- Balance formula is uniform (§5.1). Unpaid bills stay `pending`/`partial`; the Dues page lists bills with `balanceAmount > 0` and collects via the standalone `POST /api/payments` path (old-dues collection is a normal payment on an old bill — there is no separate old-dues ledger).
- Due waiver (`POST /api/bills/:id/waive-due`, `bills.ts:1896`): converts the outstanding balance into an additional `discount` under a pure planner (`lib/dueWaiver.ts`): blocked on cancelled bills, blocked when any refund exists, blocked when balance ≤ 0.01, non-admin cap → 403, and `assertDiscountNotBelowCollected` gate; `paidAmount`/`refundAmount` are never touched (this is not a refund); audit `changeType: "balance_waived"`.

### 3.4 Cancellation & refunds — see §7 for the full lifecycle matrix.

### 3.5 Day-close / reconciliation — see §9.

---

## 4. Database Model

### 4.1 Core billing tables (`lib/db/src/schema/`)

**`bills`** — one bill per order (enforced by partial unique index `bills_order_id_active_uidx`: one **non-cancelled** bill per order; re-billing after cancel is possible by design).

| Column | Type | Notes |
|---|---|---|
| `bill_number` | text, unique | `YYYYMM######` (year-month prefix + **global** sequence suffix) |
| `patient_id`, `order_id` | FK | order_id nullable for booking-less bills |
| `subtotal`, `discount`, `tax_amount`, `total_amount`, `paid_amount`, `refund_amount`, `balance_amount` | numeric | money; `tax_amount` always written as 0 today (§14-D7) |
| `discount_reason`, `discount_reason_note` | text | audit of why |
| `status` | **text, not an enum** | `pending`/`partial`/`paid`/`cancelled`; DB accepts any string — enforcement is application-only |
| `ledger_id` | int | **no FK** to ledgers table; silent fallback `1` on order create (`orders.ts:378`) |
| `client_ref` | text | partial unique index `bills_client_ref_uidx` → idempotent creates |
| `created_by_name`, timestamps | | |

**`payments`** — the single money-in/money-out ledger (refunds are **negative rows**):

| Column | Type | Notes |
|---|---|---|
| `bill_id` | FK | |
| `amount` | numeric | positive = collection; **negative = refund** (manual refunds) |
| `method` | text | free string: `Cash`, `UPI`, `Card`, `Online (ICICI Orange Pay)`, `Online (HDFC SmartGateway)`, … |
| `reference_number` | numeric-id string, **nullable** | merchant ref (`BILLPAY-…`); **NULL for manual refunds → bypasses the unique index (§14-D1)** |
| `gateway_txn_id` | text, nullable | provider txn id |
| `settlement_status` | text | `captured`, `superseded`, `void`, … |
| `recorded_by_name` | text | actor attribution (client-supplied on some endpoints, §14-D4) |

**Idempotency constraints exist ONLY as SQL-migration partial indexes**, not in the Drizzle schema:
- `idx_payments_bill_reference_uq ON payments (bill_id, reference_number) WHERE reference_number IS NOT NULL` (`migrations/add_payment_idempotency_index.sql:17`)
- `idx_payments_bill_gateway_txn_uq ON payments (bill_id, gateway_txn_id)` (`migrations/add_payment_idempotency_index.sql_settlement_identifiers.sql:23`)
- both re-asserted in `migrations/zz_schema_reconcile_20260709.sql:27207`

Consequence: any database built via Drizzle `db:push` (fresh dev/test DBs) **lacks the duplicate-payment guards entirely**; production is protected only because the SQL migrations ran. Schema-as-code drift (§17-R3).

**`orders` / `order_tests`** — order: `order_number` unique (`ORD-YYYYMM-####`), `client_ref` unique, `status` (pending/collected/completed), `ledger_id`; order_tests: `price` (line price actually charged), `outsource_cost`, `display_name`, per-line status (active/cancelled) driving partial cancel math.

**Supporting tables:** `online_bookings` (public bookings; `icici_transaction_id`, `booking_ref`, `status`), `payment_logs` (raw gateway payloads + initiate records — the audit trail for gateway interactions), `bill_payment_links` (online payment-link scaffolding, flag-off), `vouchers`/`accounts` (double-entry), `expenses` + `expense_payments` (V2: `expenses.bill_amount` is the booked amount; **`expense_payments` rows are the canonical money-out**), `day_closures` + `user_day_closures` (denominations JSON, drawer status), `bill_audits` (plain audit), `audit_logs` (hash-chained), `portal_sessions`, `users` (`role`, `permissions` JSON, `max_discount` numeric(5,2)).

### 4.2 Status model weaknesses

- All status columns are plain `text` — no CHECK/enum constraints. A bug writing `status = "Paid"` would create a phantom state invisible to reports that filter `= 'paid'`.
- `payments.settlement_status` participates in report inclusion via `INVALID_COLLECTION_STATUSES = {superseded, void, failed, reversed, cancelled, refund_failed}` (`lib/financialIntegrity.ts`) — again string-matched.

### 4.3 Deletion behavior

There is **no soft delete** for financial rows. Cancellation is status-flipping (rows retained); the only hard deletes are the super-admin bill delete (§14-D5 — deletes vouchers, payments, bill) and test-fixture cleanup. Orphan risk: `bills.ledger_id` has no FK (a deleted ledger would dangle), and order↔bill can diverge after super-edit's non-transactional updates (§14-D6).

### 4.4 Three DDL sources = drift risk

1. Drizzle migrations (`lib/db/drizzle/`, 0000-0014) — the "declared" schema.
2. Feature SQL (`artifacts/api-server/migrations/*.sql`, ~180 files) applied **alphabetically** by `runStartupMigrations` under `pg_advisory_lock` — carries the payment unique indexes, the numbering sequences, and countless backfills.
3. `zz_schema_reconcile_*.sql` reconciliation files that re-assert drifted objects.

The Drizzle schema does not describe production (missing indexes, sequences). `db:push` against a fresh database produces a *different, weaker* database than production. (§17-R3)

---

## 5. Financial Invariants (derived from implementation)

### 5.1 Core formulas (`lib/money.ts`, integer paise)

```
total    = billTotalFromParts(subtotal, discount, tax) = subtotal − discount + tax
balance  = billBalanceFromParts(total, paid, refund)   = max(0, total − paid − refund)
status   = balance ≤ 0.01 → "paid"; paid > 0 → "partial"; else "pending"
```

These are applied consistently by: bill create, edit (PUT), payment insert, cancel (auto-refund), waive-due, cancel-test, cancel-refund-tests, swap-test — all under a bill-row `SELECT … FOR UPDATE`.

### 5.2 Payment (money-in) invariants

- `assertNonNegativePayment`: amount must be > 0 (refunds cannot sneak in as negative collections).
- `assertPaymentWithinOutstanding`: `amount ≤ balance + 1 paise` — overcollection beyond due is rejected on the payment path.
- Applied payment: `paid' = moneyAdd(paid, amount)`, `balance' = billBalanceFromParts(total, paid', refund)` — paise-exact.
- Cancelled bills: 409 before any write (terminal-state guard, race-safe under the row lock).

### 5.3 Refund (money-out) invariants (`bills.ts` refund handler)

```
amount     ≤ paid (cannot refund more than ever collected)
newPaid    = moneyMax0(moneySub(paid, amount))
newRefund  = moneyAdd(refund, amount)
newBalance = billBalanceFromParts(total, newPaid, newRefund)
status     ← derived from netOwed = max(0, total − refund) vs paid
total      unchanged (refund never mutates the contracted amount)
```
A **negative payment row** is inserted (amount = −refund) with `referenceNumber: NULL`. Note the status derivation differs subtly from the plain balance rule (uses `netOwed`), so a fully-refunded fully-paid bill and a partially-refunded bill can disagree with §5.1's status line in edge ranges — verified as intentional (net-owed view) but undocumented in code beyond the formula itself.

### 5.4 Due-waiver invariants (`lib/dueWaiver.ts`)

```
newDiscount = oldDiscount + oldBalance          (must fit within subtotal)
newTotal    = subtotal − newDiscount + tax
paid, refund unchanged                          (a waiver is NOT a refund)
guards: cancelled → 409; any refund > 0.01 → 409; balance ≤ 0.01 → 409;
        non-admin: newDiscount ≤ maxDiscountPct of subtotal → else 403;
        assertDiscountNotBelowCollected
```

### 5.5 Partial-cancel invariants (`cancel-test`, `cancel-refund-tests`, `swap-test`)

```
newSubtotal = Σ remaining active order_tests prices
newDiscount = min(oldDiscount, newSubtotal)     (discount cannot exceed new subtotal)
newTotal    = newSubtotal − newDiscount (+ tax)
if paid > newTotal: auto-refund excess as ONE negative payment row (cancel-refund-tests, swap-test)
```
**`cancel-test` does NOT refund the excess** (§14-D9) — the bill keeps `paid_amount` above the new total and relies on the balance floor `max(0, …)`; the overpayment silently becomes implicit credit.

### 5.6 Gateway settlement invariants (`gateway-webhooks.ts:113-209`, `bills.ts:3255-3415`)

Same intent as §5.2 but computed with **floating-point** `Number(bill.paidAmount) + amount` (§14-D8), then stringified back to `toFixed(2)`. Idempotency: match on `reference_number` OR `gateway_txn_id` before insert, plus the DB partial unique indexes as backstop. Cancelled bills refuse settlement (terminal).

### 5.7 Collection/reporting inclusion rules

- `INVALID_COLLECTION_STATUSES = {superseded, void, failed, reversed, cancelled, refund_failed}` — collection reports and day-close exclude payment rows in these states; superseded duplicates are voided by reversal voucher `REV-PAY-<id>` (never deleted — good).
- Method split (cash vs digital) is by **string matching on `payments.method`** — the webhook paths call `autoVoucherForPayment` with `method: "online"` (lowercase) while the poll path uses `"Online (ICICI Orange Pay)"` (`gateway-webhooks.ts:378/480/622` vs `bills.ts` poll handler) — voucher/account mapping must tolerate both (§14-D10).

### 5.8 Double-count / double-deduction scan results

- **No double-count of money-in found**: inline, standalone, poll, and webhook paths all converge on the same dedupe keys; the DB unique indexes close the race window.
- **Double-deduction risk found (refunds)**: no dedupe key at all on manual refunds (§14-D1); double-submission double-decrements.
- **Mixed-path risk**: a bill settled by webhook while a desk user concurrently posts a manual payment on the same bill — both take `FOR UPDATE` on the bill row, so the arithmetic stays serial; the second write sees the first. Verified safe at the row level.
- Day-close double counting: addressed in §9 (agent-verified formulas).

---

## 6. Payment Lifecycle

```
                 ┌─ inline payments[] ─┐
Billing Desk ────┤                     ├──► payments row ──► autoVoucher (post-commit)
                 └─ POST /api/payments ┘         ▲
                                                │ FOR UPDATE on bill
Public patient ─► gateway initiate ─► txnRef    │
                 (BILLPAY-<id>-<hex>)            │
                    │                            │
      browser ──────┴─► poll gateway-payment-status ──► settle (verify via PaymentEngine)
      gateway S2S ──────────► webhook ──► settleBill ──► settle (HMAC-verified)
      admin ─────────────────► /gateway/reconcile ────► settle (provider checkStatus)
```

**States of a payment row:** inserted → `captured`; duplicate gateway posting → first row kept, duplicate detected → **superseded via reversal voucher `REV-PAY-<id>`** (row retained, never deleted); failed initiations never create rows (only `payment_logs` entries with `status = 'initiated'`/`signature_mismatch`/`webhook_failed`).

**Concurrency:** every mutation path takes `SELECT … FOR UPDATE` on the bill row (`settleBill`, payments POST, refund, cancel, waive-due, edits) — same-bill races serialize correctly. Cross-bill races (two different bills, same gateway txn — not possible since txnRef embeds billId).

**Idempotency summary:**

| Operation | Key | DB backstop | Gap |
|---|---|---|---|
| Order create | `clientRef` | unique index | — |
| Bill create | `clientRef` | `bills_client_ref_uidx` | — |
| Payment (ref provided) | `(bill_id, reference_number)` | partial unique index | — |
| Payment (no ref — **cash**) | **none** | none | §14-D2 |
| Gateway settle | ref + gateway_txn_id | two partial unique indexes | — |
| Manual refund | **none** (`reference_number` NULL) | **none** | §14-D1 |
| Auto-refund (cancel/swap) | **none** | none | §14-D1 |

**Voucher fan-out** is post-commit and best-effort (`.catch(() => {})` on webhook paths) — a crashed voucher write leaves the `payments`/`bills` truth intact but the double-entry books out of sync until the accounting sync/rebuild job repairs it (§16-W4).

## 7. Cancellation / Refund Lifecycle

### 7.1 Endpoint inventory

| Endpoint | bills.ts | Auth gate | Row lock | Refund side-effect | Idempotency |
|---|---|---|---|---|---|
| `POST /:id/cancel` | 1675 | `/billing:delete` | `FOR UPDATE` (1698) | optional `autoRefund` negative row (1777-1807) | 409 if already cancelled (1700) |
| `POST /:id/refund` | 1966 | `/billing:refund` | `FOR UPDATE` (1997) | negative payment row (2034-2041) | **none** (§14-D1) |
| `POST /:id/cancel-test` | 2502 | `/billing` (mount) only | `FOR UPDATE` (2524) | **none — excess kept as balance credit** | 409 if test cancelled |
| `POST /:id/cancel-refund-tests` | 2601 | `/billing` (mount) only | `FOR UPDATE` (2620) | auto-refund of overpaid excess (2670-2689) | 409 per-test |
| `POST /:id/swap-test` | 2938 | `/billing` (mount) only | `FOR UPDATE` (2959) | refund of `paid − newTotal` excess only (3035-3048) | none |
| `POST /:id/waive-due` | 1896 | `/billing:edit` | `FOR UPDATE` (1906-1911) | none (no payment row — by design) | none |
| `PATCH /:id/super-edit` | 2204 | super-admin session + USB | **none** (§14-D6) | arbitrary | none |
| `DELETE /:id` | 2324 | super-admin + USB | none | **hard delete + renumber** (§14-D5) | n/a |
| supersede (accounting) | accounting.ts:1110-1189 | admin + sub-perm | `FOR UPDATE` | negative voucher, no payment row | none (§14-D1 family) |

### 7.2 Full-bill cancellation semantics (`bills.ts:1675-1894`)

Status → `cancelled`, `cancelledAt/ByName/cancellationReason` recorded, `balanceAmount` forced to `"0.00"` so the bill leaves the dues report (dueOnly filter is `balance > 0 AND status ≠ 'cancelled'`, bills.ts:537-543 — the status check is explicitly a "safety net for legacy rows", bills.ts:538-540). `clientRef` is nulled, freeing the idempotency key for a cancel-and-rebill flow (1730-1732).

Two cascade effects are done correctly:

- **order_tests cascade** (1744-1755): all tests of the bill's order flip to `cancelled` with actor/reason, because commission and doctor-ledger reports read `order_tests.status`, not `bills.status`. Without it "a cancelled bill keeps paying commission to the referring doctor forever" (comment, 1744-1747). The cascade cancels **all** tests on the order — if two bills share one order, cancelling one bill kills the other bill's tests too (see §15).
- **Optional auto-refund** (1768-1807): `{ autoRefund: { method } }` inserts one negative payment row of the full `paidAmount`, sets `paidAmount = 0`, `refundAmount += paid`, `balance = 0`. `totalAmount` is never mutated.

Clinic policy `cancelRequiresRefund` (clinicSettings, checked 1709-1720) can *require* the autoRefund flag — but only when `paidAmount > 0.0001`; when off, a paid bill can be cancelled with money kept and no refund row (books-sanity.ts:107-124 later flags this as `cancelled-but-not-refunded`).

`totalBilled` in day-close still includes cancelled bills created in the window (day-close.ts:301, `billsTable.createdAt` window with no status filter), while daily-summary's `totalBilling` excludes them (daily-summary.ts:140, active bills only) — the two reports disagree by construction on cancellation days.

### 7.3 Partial cancellation — three endpoints, two refund policies

`cancel-test` (2502) and `cancel-refund-tests` (2601) recompute the bill with the same locked formula:

```
newSubtotal = Σ price of remaining active tests          (paise-exact, moneyAdd)
newDiscount = min(oldDiscount, newSubtotal)              (cap at new subtotal, floor 0)
newTotal    = newSubtotal − newDiscount + taxAmount       (billTotalFromParts)
```

They differ **only** in what happens when the patient had overpaid:

- `cancel-refund-tests`: `if paid > newTotal` → auto-refund the excess (negative payment row, notes `REFUND (test cancel): …`, 2682-2689). The `REFUND (test cancel)` notes prefix is load-bearing — day-close's staff-slip machinery restores it to the bill creator's billed figure and de-duplicates it (`dailySummaryCollectible.ts:24, 104-138`).
- `cancel-test`: **no refund of any kind** — the excess stays as `paidAmount > totalAmount`, i.e. a negative balance is clamped (`billBalanceFromParts` floors at 0, 2560), and the money is neither refunded nor tracked anywhere as credit (§14-D9).
- `swap-test`: refunds only `paid − newTotal` excess — deliberately *not* the raw price difference, so an unpaid USG₹1500→X-ray₹1000 swap cannot invent a ₹500 refund (comment 3026-3029; pinned by `bills.swapTest.request.test.ts`). Swap also rewrites `orders.totalAmount` (2998-3001) — the only endpoint that keeps the order header in sync with line changes; `cancel-test`/`cancel-refund-tests` do **not** update `orders.totalAmount`, leaving order-axis and bill-axis totals divergent (§15).

Swap refunds use notes `Refund for test swap: …` (3043), which does **not** match the `REFUND (test cancel)` prefix — so swap refunds are treated as ordinary refunds by the staff-slip formula and are *not* covered by the gross-restore/de-dup machinery that test-cancel refunds get (`dailySummaryCollectible.ts:24`). Same economic event (money returned because a line was removed), two different reconciliation treatments.

### 7.4 Gateway-payment supersession (`accounting.ts:1110-1189`)

Duplicate gateway postings are never deleted: the loser row gets `settlementStatus: "superseded", supersededBy: <survivorId>` (1137-1139), the bill is recomputed with `newPaid = max(0, paid − amount)` (**float** arithmetic, 1142, unlike the paise-exact bills.ts paths) and a reversal voucher is posted by calling `autoVoucherForPayment` with a negative amount and **no paymentId** (1167-1173) — which bypasses the voucher idempotency guard (auto-voucher.ts:245-252 keys on `paymentId`), so a repeated supersede of the same row posts a second reversal voucher. The reversal is numbered as an ordinary `PV-YYYYMM-NNNN` with "Refund … | Bill" particulars; the `REV-PAY-<id>` numbering promised in the schema comments (`lib/db/src/schema/bills.ts:83-86`, `migrations/add_payment_idempotency_index_settlement_identifiers.sql:12-13`) **does not exist in code**.

Once a payment is superseded, `isCollectiblePayment` excludes it from day-close and daily-summary — but *not* from My Daily Summary (§9.3) and *not* from the books-sanity payment-ledger-drift detector (books-sanity.ts:84-104 joins all payments; superseded rows therefore produce permanent false drift alerts, while detector F2 at 179-205 does exclude them).

### 7.5 Bill status model after money events

```
pending ──payment──► partial ──payment──► paid
   ▲ │                                   │
   │ └──refund(all)── paid ──► pending (paidAmount 0)
   │
   ├──waive-due(total)──► paid (balance 0, no payment row)
   ├──refund(partial)──► partial (balance = max(0,total−paid−refund))
   └──cancel──► cancelled  (terminal: payments POST 409 bills.ts:2829-2831,
                            PUT discount 409, swap 409, cancel-refund-tests 409;
                            refund on cancelled stays "cancelled" bills.ts:2024-2025)
```

Terminal-state enforcement is enforced server-side inside the `FOR UPDATE` transaction (cancel-vs-payment race cannot resurrect a bill) and is covered by `bills.cancelledTerminal.request.test.ts`. One asymmetry: `cancel-test`/`cancel-refund-tests` allow cancelling tests on a **paid** bill without any permission beyond the mount-level `/billing` — a receptionist can restructure a completed, closed-period bill's line items (see §10.3).

### 7.6 Closed-period behaviour

`closureBoundary.ts:42-45` (`isBeforeClosureBoundary` uses `<=`) feeds only an informational `closedPeriodWarning` on refund (bills.ts:2115-2124) and cancel-with-refund responses. Refunds against bills in already-closed, signed-off periods are **never blocked and require no approval** — an explicit product decision (comment 2107-2114, "Locked Rule #10/#11 carry-forward"). The accounting consequence: the old closure's persisted expected-cash totals keep the original collection, while the negative payment row lands in the *current* window, so day-over-day expected cash for the refunding user is understated by the refund amount with no restatement marker on the old closure. `books-sanity.ts:289-402` goes further and **mutates** historical bills (`total_amount = original_total`, recomputed balance) with no closure-boundary check at all.

## 8. Dues Lifecycle

**Dues creation.** Any bill whose `balanceAmount = max(0, total − paid − refund) > 0` is a due. Status pending/partial. Sources: short payment at desk, refund raising the balance back (a partial refund on a paid bill re-creates a due: newBalance = total − paid − refund, bills.ts:2021), test-cancel clamping, and edits.

**Dues visibility (three different definitions):**

1. Dues report page — `GET /api/bills?dueOnly=true` (bills.ts:513): `balanceAmount::numeric > 0 AND status ≠ 'cancelled'` (537-543); totals `SUM` across the full filtered set (569-574).
2. Dashboard — `SUM(balance_amount) WHERE status IN ('pending','partial')` (reports.ts:135); **no `balance > 0` filter**, so a paid-status bill with a stray positive balance would be included here but invisible in (1); overdueAlerts adds `balance > 0` (reports.ts:152).
3. Daily-summary `allDues` — all-time `SUM(balance_amount) WHERE status IN ('pending','partial') AND balance_amount > 0`, not date-scoped (daily-summary.ts:127-135), presented on a day report.

**Dues collection.** `POST /api/payments` (bills.ts:2791): `FOR UPDATE` lock, cancelled-bill 409, idempotent replay only when `referenceNumber` supplied (2834-2850), amount validated against outstanding via `assertPaymentWithinOutstanding` (2857). There is **no minimum** and `assertNonNegativePayment` allows 0? — no: negative rejected (2800); zero allowed (a ₹0 payment row is inserted, harmless but noisy). Old-dues collection is attributed in day-close via `computeDueReceivedForWindow` — positive collectible payments on bills *not created in this window* (day-close.ts:975-978, `staffSlipFormula.ts:83-102`) and in My Daily Summary as payments on bills with `bills.createdAt < dayStart` (my-daily-summary.ts:211-241). Both are payment-axis (correct); neither is blocked by the bill being in a closed period (carry-forward rule).

**Due waiver.** `POST /:id/waive-due` (bills.ts:1896): `planDueWaiver` (lib/dueWaiver.ts) computes the maximum waivable amount = balance, capped by the staff member's `maxDiscount` role percentage (admins unlimited via `FULL_ACCESS_ROLES`), then increases `discount` and decreases `totalAmount`/`balanceAmount` — **no payment row, no voucher** (pinned by `bills.waiveDue.sourceContract.test.ts` and request test). The waiver is revenue destruction recorded only as a discount increase: it is indistinguishable in the books from an original discount given at billing time (day-close sees nothing; books-sanity's discount>50% detector, 127-146, is the only flag).

**Dues destruction.** Cancel zeroes `balanceAmount`; waiver zeroes it; refund *increases* it. A refunded-then-waived bill can therefore ping-pong between due and not-due, each step audited but each step also changing historical `totalAmount`, so the original billed amount survives only in `bill_audits.oldValue` text.

## 9. Daily Reconciliation Wiring

### 9.1 Overall day-close (`day-close.ts`)

Window: `coveredFromTs` = **exclusive** `coveredToTs` of latest `status='closed'` closure; `coveredToTs` = `now()` (day-close.ts:480-486). The whole close runs under `pg_advisory_xact_lock(7390021)` (478), **but `summarizeWindow(from, to)` at line 488 runs on the global `db`, not the transaction handle** — the aggregation reads are outside the lock's snapshot, so a payment committing between the boundary read and the aggregation is silently missed (it will appear in the next window only if committed after `to`, or lost between windows if `to` was captured before it committed).

Expected-cash derivation (all figures via `n(v) = Number(v ?? 0) || 0` float coercion, day-close.ts:60-62):

```
payment rows:      created_at ∈ (from, to]  AND isCollectiblePayment
                   (settlement_status NOT IN superseded/void/failed/reversed/
                    cancelled/refund_failed; NULL passes — legacy + refund rows)
buckets:           cash | upi | card | cheque | other | suspense(unknown method)
                   negative refund rows net against their method bucket
expected cash   =  Σ cash-bucket − cash refunds − cash expenses (splitCashExpenses,
                   166-199, applied exactly once — 874-879 documents it previously
                   applied twice)
expected other  =  Σ upi + card + cheque + other buckets
variance        =  actuals(cash+upi+card+cheque+other) − expected total   (490-492)
totalBilled     =  Σ bills.totalAmount of bills CREATED in window — cancelled included (301)
totalRefunds    =  Σ bills.refund_amount of bills CREATED in window — BILL AXIS (302);
                   a refund against an older bill appears in NO closure's totalRefunds
totalExpenses   =  Σ expense_payments rows (created_at window, not reversed,
                   expense not VOID) — correct money-out axis (236-242, 315)
refundDetails   =  built ONLY from cancelled bills (530-536); ordinary refunds
                   produce no detail record
```

Method classification is TypeScript-side (`paymentMethodClassifier.ts:55-100`: exact tokens + `startsWith("online")`); unrecognized strings go to **suspense** and are excluded from every bucket *and* from `total` — expected total is understated until someone reclassifies. Refunds pay back through whatever method string the operator chose (`refundMethod ?? "cash"`, 2672) — a UPI payment refunded "cash" shifts expected cash down and expected UPI stays high, manufacturing a cash variance.

Two display-integrity issues: legacy closures with all-zero persisted reports are **recomputed live on GET** (597, 643-645), so post-close mutations silently change what is displayed for a signed-off closure while the persisted columns stay frozen; and the supersede path (§7.4) leaves old closures' persisted totals containing money that now exists nowhere.

### 9.2 User day-close / drawer (`day-close.ts` 715-2235)

Window start = `MAX(last overall closed boundary, user's latest closure coveredToTs)` — the user's latest closure is taken **with no drawerStatus filter** (722-740), so a *reopened* drawer permanently advances that user's window: its period can never be re-closed by that user, and its money is attributed to no drawer closure at all. Overall-closure reopen (670-699, super-admin only) similarly removes the boundary while the reopened row's persisted totals stay in the ledger — the next closure re-covers the period, a structural double-count in the closure *history* (not in expected cash, which is recomputed per window).

Expected per user = payments with `recordedByName = user` in window (`recordedByName` is a trimmed free-text name — renames and name variants split a user's books across identities), same collectible filter, cash expenses of bills the user approved/created subtracted once. `drawerStatus = "balanced"` is decided by **exact float equality** `variance === 0` (1432) after float accumulation; admin "close-on-behalf" and `/staff-close-all` accept `autoBalance: true` which **sets actuals = expected** (1865-1879, 1998-2098), manufacturing "balanced" with no physical count and writing audit rows that look identical to a real count. Denominations (`{d500…d10, coins}` JSONB) have **no ₹2000 field**, are summed in float (1337-1339), and the `denominationTotal` is **never compared to `actualCash`** anywhere — a miscounted note bundle cannot be detected by the system.

Staff-slip / collectible formula (staffSlipFormula.ts:43-66, dailySummaryCollectible.ts:140-162):

```
refundsForSlip = max(0, refundsRecorded − refundsOnBillsICancelled)
collectible    = billed(+grossRestore for test-cancel refunds) + duesCollected
                 − cancelledBills − refundsForSlip − outstanding − expense
```

`duesCollected` counts payments on bills not created in this window, deliberately not gated on prior closure ("Suraj #170", staffSlipFormula.ts:68-82). This is the most sophisticated reconciliation formula in the codebase and the only one that attempts to attribute old-dues collection to the collecting user — but it inherits every upstream defect (D1 double-refunds, supersede float math, recordedByName identity).

### 9.3 My Daily Summary (`my-daily-summary.ts`) — the inconsistent one

Window: IST calendar day (29-34). Payments query **INNER JOINs bills** (157-183) — payments with NULL `billId` (any future non-bill payment) would silently vanish. **There is no `settlementStatus`/`isCollectiblePayment` filter at all**: superseded, void, failed and reversed gateway payments are counted as real collections here while day-close and daily-summary exclude them — a staff member's personal cash total can permanently disagree with the center's books by exactly the amount of any superseded posting attributed to them. Sign split happens later (`amount > 0` paymentItems, `amount < 0` refundItems, 413-414), which is not equivalent (a superseded *pair* nets to zero here, but a single voided-but-not-superseded posting counts fully).

Expenses use **two different axes inside the same route**: the aggregate query reads `expense_payments` with blank-or-cash = cash (354-367, consistent with day-close), but the per-staff breakdown (599-608) and the drilldown total (1132-1141) read `FROM expenses` (supplier-bill header table) with `LOWER(payment_mode) = 'cash'` (blank ≠ cash) — the staff member's own header KPI, the per-staff table on the same screen, and day-close can show three different expense figures for the same day. This directly violates the schema's locked rule (`lib/db/src/schema/expensePayments.ts`: "Cash / day-close MUST use these rows … never expenses.bill_amount / expenses.amount").

### 9.4 Center daily-summary (`daily-summary.ts`)

Cash math is centralized and correct in shape (`computeDailySummaryCashMath`, 39-43: `netCollection = totalReceived − totalRefunded − expenses`; `physicalCashInHand = cashCollection − cashRefunded − cashExpenses`), refund axis is payment-based (142 — unlike day-close's bill axis, §9.1), and unknown methods go to suspense, never cash (161-169). Two defects: the payments query has **`.limit(500)`** (76) — on a day with more than 500 payment rows the report silently understates `totalReceived`, cash math, and `grandTotal` with no warning field; and `refundsAndCancellations = totalRefunded + Σ cancelledBills.totalAmount` (205) double-counts a cancelled-and-refunded bill (display-only, but it is the line managers read). `outstanding` is computed as `max(0, totalBilled − totalReceived)` from same-day rows only (534-536) — payments today against older bills, or later payments against today's bills, both corrupt the day's receivable figure.

### 9.5 Books sanity & reconciliation

`books-sanity.ts` is the self-check layer: payment-ledger drift (`ABS(bills.paid_amount − Σ payments.amount) > 0.01`, 84-104) **does not exclude superseded rows** → every superseded posting is a permanent false alert while real drift can hide among them (detector F2 at 179-205 *does* exclude superseded — the two detectors disagree with each other); cancelled-but-not-refunded (>0.01 paid, 107-124); discount>50% (127-146); and a **repair route that mutates historical bills** (`total_amount = original_total`, 289-402) with no closure-boundary check — closed-period books are rewritable through this endpoint (permission: `/day-close`, i.e. any staff granted that permission). `reconciliation.ts` (the `/dashboard/reconciliation` API) has **no permission gate beyond requireStaffAuth** (mount, routes/index.ts) and mixes the same axes.

### 9.6 The revenue-definition problem (cross-report)

Four mutually inconsistent definitions of "revenue" are served concurrently:

| Surface | Definition | File:line |
|---|---|---|
| `/reports/revenue` | `SUM(payments.amount)` (cash basis), 6-status exclusion, negative refunds net in, field `orders` actually counts **payment rows** | reports.ts:233-251 |
| `/reports/popular-tests` | `SUM(order_tests.price)` — **no status filter at all** (cancelled tests included), all-time | reports.ts:265 |
| Advanced dashboard modality table | `SUM(order_tests.price)` of active tests, no bill/payment linkage — cancelled bills still count | advanced-dashboard.ts:321-345 |
| Advanced dashboard summary | `SUM(bills.total_amount) WHERE status ≠ 'cancelled'` (accrual) in the same response as the above | advanced-dashboard.ts:247-261 |
| Dashboard "referralPayouts" | `SUM(orders.total_amount) WHERE doctor_id IS NOT NULL` — gross order value, all-time, no rate — **labelled as payouts** | reports.ts:141-143, 186 |

Day boundaries are equally mixed: UTC midnight (`T00:00:00.000Z`, reports.ts:61-62 → `/income-expense`, `/payment-methods` mis-bucket 00:00-05:30 IST activity onto the prior day), IST (`+05:30`, reports.ts:501-506, dashboard 105-107, advanced-dashboard 24-28), UTC grouping buckets (`AT TIME ZONE 'UTC'`, reports.ts:220-228), and server-local `::date` casts (bills.ts:554-555). Vouchers use text `YYYY-MM-DD` string comparison (reports.ts:352-355, 528).

### 9.7 Commission interplay

The live commission engine is quarantined to the USB plugin (`routes/commission.ts` is a 2-line stub; real code at `__super_admin_quarantine/backup_usb_isolation_restore_point/api-routes/commission.ts`). Its math lives in `lib/commissionCalc.ts` (shared): VIP surcharge stripped (`price / (1 + vipPct/100)`, 257), outsourced margin basis (`max(0, price − outsourceCost)`, 264-266), percentage/fixed rules (291-297), margin cap (313), and bill eligibility `bills.find(b => b.status !== 'cancelled')` (378-383) — an order whose *every* bill is cancelled is excluded from commission **even when its order_tests are still active** (possible via §7.2's shared-order cascade in reverse: cancel bill A, tests cancelled, order unreferenced). All commission arithmetic is float (257, 264-266, 291-313). Reports show order-value, not commission, as "referralPayouts" (§9.6).

## 10. RBAC / Security

### 10.1 Authentication model

Bearer token or **`?staffToken=` query parameter** → `portal_sessions` (scope `staff`), 20-second in-memory cache (`middleware/requireStaffAuth.ts`). Query-param tokens leak into access logs, proxy logs, and browser history — every staff URL in the wild carries a live session credential. Authorization = `users.permissions` JSON array (`/orders`, `/billing`, `/payments`, …) with optional `":action"` sub-entries (`requireStaffSubPermission`), plus role shortcut: `FULL_ACCESS_ROLES = {admin, super_admin}` bypass every permission check (requireStaffAuth.ts:259-261). Per-user `maxDiscount` percentage caps discounts. The `role_permissions` matrix table exists in the schema but is **never read at runtime** (dead code) — the effective policy is the JSON column only, so any UI that edits `role_permissions` (if one exists) edits a decoy.

### 10.2 Verified mount-level map (routes/index.ts)

Public (no staff session): `/verify` (bill QR check), `/kiosk`, `/public/booking` (Razorpay), `/gateway` (webhooks — HMAC-verified, settle/reconcile endpoints self-apply requireStaffAuth), `/p/r`, `/share`, `/f`, `/teleradiology`, `/boundary` (API key), `/fhir` (API key), `/abdm/callback`, `/internal/*` (bearer secrets), `/emergency-bridge`, `/website` (GET), `/display`, `/payment-display`, `/portal`, `/patient`, `/integration/v1`, WhatsApp mount in app.ts.

Staff-authenticated with **no permission check beyond login**: `/day-close` (per-user endpoints; admin routes inline), `/books-sanity` is `/day-close` permission; **`/dashboard/reconciliation`, `/dashboard/my-daily-summary`, `/dashboard/advanced-summary`** (my-daily-summary gates only its admin KPIs inline), **`/online-bookings`, `/packages`, `/gateway/reconcile`, `/gateway/pending-online-bills`**. Every authenticated staff member — including the most junior — can trigger a gateway status-check + **settlement** (`/gateway/reconcile`, gateway-webhooks.ts:539-687 posts money onto bills) and read the full reconciliation cockpit.

Permission-gated: `/orders` → `/orders`; `/bills`, `/billing`, `/bill-payment-links` → `/billing` (billing desk save additionally requires both `/orders` and `/billing`); `/payments` → `/payments`; `/reports`, `/daily-summary` → `/reports`; `/discounts` → `/discounts`; `/expenses`, `/accounting`, `/ledgers` → `/accounting`; clinic-settings PUT restricted to `BILLING_OWNED_SETTINGS_KEYS = {quickTestIds, billPrintCopies}` else `/settings:clinic`; `/emergency-billing` → admin role; discount-reasons/reprint-reasons GET open, mutations gated.

### 10.3 Sub-permission coverage on money mutations

Present: `PUT /bills/:id` (`edit`), `POST /:id/cancel` (`delete`), `POST /:id/refund` (`refund`), `POST /:id/waive-due` (`edit`). **Absent** (mount-level `/billing` only — any billing-permission holder): `change-doctor` (redirects a referrer's commission!), `cancel-test`, `cancel-refund-tests` (auto-refunds money), `swap-test` (auto-refunds money), `initiate-gateway-payment`, and the entire `paymentsRouter` (`POST /api/payments` needs only `/payments` — collection is the desk job, fine — but there is no change-payment-mode / reverse-collection sub-permission anywhere; the only "reverse" paths are refund and supersede with their own gates). This is §14-D3.

### 10.4 Actor integrity

`PUT /bills/:id` and `change-doctor` correctly derive the audit actor from the session (pinned by `bills.editAudit.test.ts:35-42`). Three endpoints trust the **body over the session**: `cancel-test` (bills.ts:2514 — actor entirely from body, session never consulted), `swap-test` (3019, 3044 — body `performedBy` required, session ignored), and `cancel-refund-tests` (2613 — `performedBy.trim() || session`, body wins). On those endpoints the bill_audits trail, `order_tests.cancelledByName`, and `payments.recordedByName` can carry any name an authenticated caller types — refund rows attributed to a colleague. §14-D4.

### 10.5 Super-admin layer

Two-factor USB key (`X-SA-USB-Key`, enforced via `requireSuperAdminUsb`) + short-lived `super_admin_sessions` token gate `super-edit` and `DELETE`. The design is strong; the implementations have the defects of §14-D5/D6 (hard delete + bill renumbering; non-transactional multi-table edit). The host-side `/super-admin/usb/verify` and `/super-admin` auth routers are mounted **before** the plugin gate specifically to fix earlier lockouts (routes/index.ts:168-197) — login rate-limited, key compared via `isValidUsbKey`.

### 10.6 Secrets & bootstrap

`bootstrapAdmin` provisions the initial admin with **PIN `1234`** and an unconditional re-promotion UPDATE (any DB with the bootstrap row can be re-promoted to super_admin); `INTERNAL_API_KEY` defaults to **`1234`** in at least one environment template (server-to-server internal radiology/PACS endpoints authenticate with it). Both are documented as "change in production" but nothing enforces or checks it. Combined with `staffToken` query auth (§10.1), the credential perimeter is only as strong as operator discipline.

## 11. Concurrency & Idempotency

### 11.1 Serialization

Every money mutation on a bill takes `SELECT … FOR UPDATE` on the bill row inside its transaction: bill create (advisory-lock txn), payments POST (2817-2822), settleBill, refund (1997), cancel (1698), waive-due (1906-1911), cancel-test (2524), cancel-refund-tests (2620), swap-test (2959), supersede. Same-bill double-click races are correctly serialized, and the cancelled-check *inside* the lock prevents cancel-vs-payment interleavings. This is genuinely good engineering and closes the classic double-collection race.

### 11.2 Numbering under concurrency

- Order numbers: monthly Postgres `SEQUENCE` (`next_order_number_seq`) — concurrent-safe; on 23505 the code reseeds the sequence forward and retries ×5, and a concurrent same-`clientRef` loser **returns the winner's order** (orders.ts:430-446) — correct idempotent behaviour.
- Bill numbers: global `bill_number_seq` inside the create transaction.
- Voucher numbers: `MAX(substring(voucher_number …))+1` under `pg_advisory_xact_lock(hashtext('care_erp_voucher_' + type))` per voucher type with ×5 retry (auto-voucher.ts:164-191, 283) — safe within a type; the MAX substring scan grows with the table (§19).

### 11.3 Idempotency gaps (extending §6's table)

- **Manual/auto refunds: no key at all** (`referenceNumber: null`, bills.ts:2038, 2686, 3040) — D1. Double-click on Refund = two negative rows = double money out, each individually "valid" because each re-locks and re-checks against the *updated* paid amount.
- **Cash payments: no key** (bills.ts:2834-2850 guards only `referenceNumber` paths) — D2. The DB partial unique index `idx_payments_bill_reference_uq` is `WHERE reference_number IS NOT NULL`, so cash is structurally outside every backstop.
- **App-level probe vs DB index race**: even the ref-based path probes inside the transaction (2834-2850) then inserts — a concurrent duplicate would surface as a 23505 from the SQL-migration index → HTTP 500 rather than a replay; acceptable, but only if the DB was built from migrations, not `db:push` (§17-R3 — the index does not exist in the Drizzle schema, so `db:push`-built databases lose this backstop silently).
- **Voucher idempotency is a check-then-insert outside the advisory-lock transaction** (auto-voucher.ts:245-252) with **no unique constraint on `(payment_id, bill_id)`** — webhook + status-poll + desk calling `autoVoucherForPayment` for the same payment concurrently can both pass the pre-check and both insert sequentially-numbered vouchers. The supersede path calls with no `paymentId` at all (accounting.ts:1167), voiding the guard.
- **Day-close aggregation outside the lock snapshot** (day-close.ts:488, §9.1) — payments committing at the close instant can be lost between windows.
- **`variance === 0` float equality** gates drawer "balanced" (day-close.ts:1432) — a paise-level float residue flips a balanced drawer to mismatch (or masks one after `autoBalance`).

## 12. Auditability

**bill_audits** (plain rows, one per money event): changeType taxonomy includes `bill_cancelled`, `tests_cancelled_cascade`, `tests-cancelled`, `test_swapped`, `refund_processed`, `balance_waived`, edits. Coverage is good on the bills.ts mutation routes (every path writes inside its transaction — audit rows commit atomically with the money). Weaknesses: `editedBy` is spoofable on three endpoints (§10.4); `refundDetails` on closures is built only from cancelled bills (day-close.ts:530-536) so ordinary refunds carry no structured detail; and the super-admin **DELETE** destroys the bill and its number (§14-D5) — the audit trail then references a row that no longer exists.

**audit_logs** — SHA-256 hash-chained, append-only, tamper-evident (`billAuditHash.test.ts` pins the chain math) — but it records **only a subset of events and no billing money movements** (§14-D11): the strongest audit mechanism in the system is not pointed at the thing that matters most. Payments, refunds, waivers, supersessions, cancels live only in the unchained bill_audits table.

**drawer_audit_log** records close/mismatch_detected/mismatch_approved/drawer_reopened per user closure — but "balanced" produced by `autoBalance` is indistinguishable from a counted balance (§9.2).

**Missing audits:** discount-rule CRUD (discounts.ts mutations write **no** audit rows at all — contrast commission rules which are fully audited; a hard-deleted rule erases the basis for discounts already on bills, discounts.ts:78-120); `/gateway/reconcile` triggers (settlements are logged only in payment_logs); `books-sanity` repair mutations of historical bills.

**Notifications:** refund/edit/cancel emails are fire-and-forget (`.catch(...)` console.error, bills.ts:2102) — loss of email is invisible. Reprints are logged via `POST /:id/reprint-log` with a reason from the curated `reprint_reasons` list — good practice; the log is only as strong as the client calling it (it is a separate POST, not enforced server-side in the print path).

## 13. Test Coverage

### 13.1 Harness quality — the standout strength

`testSupport/apiTestApp.ts` mounts the **production** `routes/index.ts` router on a bare Express app (no `app.listen`) so request-level tests exercise the real middleware chain (requireStaffAuth → requireStaffPermission → handler) against a real PostgreSQL database; `billingFixtures.ts` seeds namespaced throwaway rows (staff user with explicit non-admin permissions, patient, catalog test) with children-first cleanup. The file header documents why: source-text tests passed while `POST /api/billing/save` 500'd in production (Express 5 `req.query` getter). This is the right architecture for a financial system. DB-gated tests use `describe.skipIf(!hasDatabaseUrl())` so CI without a database still runs the rest.

### 13.2 Inventory (verified by reading files, not just globbing)

| Area | Tests | Style |
|---|---|---|
| Billing desk save | billingDeskSave.request.test.ts, billingDeskSave.test.ts, billingSchemaCompat.test.ts, bills.saveHarden.test.ts | request + source |
| Cancel terminal state | bills.cancelledTerminal.request.test.ts (payments POST 409, PUT discount 409) | request |
| Swap test | bills.swapTest.request.test.ts (no invented refund on unpaid swap), swapTest.sourceContract, swapTestTotals | request + source |
| Waive-due | waiveDue.request.test.ts, waiveDue.sourceContract.test.ts (no payment/refund rows) | request + source |
| Edit audit actor | bills.editAudit.test.ts (session-derived actor pinned) | source |
| Status guard | bills.updateStatusGuard.request.test.ts | request |
| Gateway settle | gateway-webhooks.settle.test.ts (real ICICI handler, valid HMAC, mocked db — unified keying + dedupe), gateway-webhooks.test.ts | mocked-db |
| Day-close | day-close.test.ts + 4 contract tests, closureBoundary.test.ts | mixed |
| My daily summary | my-daily-summary.adminKpis.test.ts, partialCancel.request.test.ts | mixed |
| Reconciliation | reconciliation.test.ts, dailySummaryCollectible.test.ts | unit |
| Cash math | daily-summary.cashMath.test.ts, advanced-dashboard.cashMath.test.ts | unit |
| Supersede/accounting sync | accounting.supersede.test.ts, accounting.syncBilling.test.ts | unit |
| Expenses V2 | expenses.approvalSeparation.test.ts, expenses.audit.test.ts, expenseV2Service.*, expenseCashAttribution, expenseLifecycle | unit |
| Auto-voucher | auto-voucher.test.ts, auto-voucher.paymentIdempotency.test.ts, peakDefer | unit |
| Orders | orders.orderNumber.test.ts, documentNumberCounters.orderSync.test.ts | unit |
| Money/commission | money tests, commissionCalc ×3, staffActivityAttribution, staffSlipFormula (via day-close tests) | unit |
| Performance | bills.billingSpeed.test.ts, billingPerformanceSnapshot, billingFanoutGate | mixed |
| Misc | tokenHandoff, deriveBillToken, dailySummaryPdf, online-bookings.request, mobileBillDesk.itemsReconcile, bootstrapAdmin | mixed |

### 13.3 High-risk paths with NO dedicated test

1. **`POST /bills/:id/refund` — zero tests.** The single most dangerous money-out handler (over-refund guard, status transitions on netOwed, negative-row semantics, refund-method bucket effects) has no request, source, or unit test anywhere in the repo. D1's double-submit exposure is therefore also untested exposure.
2. **`cancel-test`** — no test for the no-auto-refund asymmetry (D9).
3. **`cancel-refund-tests`** — only indirectly via my-daily-summary.partialCancel; the refund-excess branch and the shared-order cascade have no direct tests.
4. **`super-edit` / `DELETE /bills/:id`** — no tests at all for the two most destructive endpoints in the system (D5/D6).
5. **`POST /api/payments` concurrency** — the FOR UPDATE design is untested (no double-click/two-connection test); the cancelledTerminal test covers the 409 only.
6. **Auto-voucher concurrent double-post** (§11.3) — paymentIdempotency.test.ts covers the sequential pre-check, not the race.
7. **Day-close window race** (summarizeWindow outside lock) — untested.
8. **Discount-rule CRUD** — untested (and unaudited, §12).
9. **my-daily-summary settlementStatus filter** — its absence is untested (a test asserting superseded exclusion would fail today).
10. **`/gateway/reconcile`** authorization and settlement effects — untested.

Source-contract tests (readFileSync + toContain) are a useful tripwire but, as the apiTestApp header itself admits, they cannot catch runtime faults — the repo knows this and still leans on them for several money paths.

## 14. Confirmed Defects

Severity: **P1** serious correctness/security risk · **P2** important weakness · **P3** improvement. Each defect is proven statically by the cited execution path.

### P1 — money-out integrity

**D1 — Refunds have no idempotency key; retries double-refund.**
Manual refund inserts the negative `payments` row with `referenceNumber: null` (bills.ts:2034-2041); auto-refunds in cancel-with-refund (1784-1791), cancel-refund-tests (2682-2689) and swap-test (3039-3045) likewise. Both DB duplicate guards are partial indexes that fire only on non-NULL reference (`idx_payments_bill_reference_uq … WHERE reference_number IS NOT NULL`, `idx_payments_bill_gateway_txn_uq`) — refunds are structurally outside every backstop, app-level and DB-level. A double-click or a network-retried POST executes twice: each call re-locks the bill and re-validates against the *already-reduced* `paidAmount`, so both succeed (the second only fails if it exceeds the remaining paid). Result: `paidAmount`/`refundAmount`/`balanceAmount` corrupt, double negative rows in payment history, day-close expected cash understated by the phantom refund. Zero tests cover this handler (§13.3).

**D2 — Cash/UPI collection idempotent only when a reference number is supplied.**
`POST /api/payments` replays only through the `referenceNumber` probe (bills.ts:2834-2850). Desk cash collections carry none; the response also returns the inserted row, so a client timeout + retry (the exact failure mode the `clientRef` machinery was built for on orders/bills) records the money twice. Same exposure for kiosk/emergency-bridge collection calls that go through this route.

**D3 — Money-mutating and commission-redirecting endpoints lack permission granularity.**
All of `change-doctor` (bills.ts:2133 — redirects a referrer's commission, protected only by a comment), `cancel-test` (2502), `cancel-refund-tests` (2601 — auto-refunds money), `swap-test` (2938 — auto-refunds money), `initiate-gateway-payment` (3149) sit behind the mount-level `/billing` check only, while the tamer `PUT /:id`, `cancel`, `refund`, `waive-due` all carry `requireStaffSubPermission`. A user with "billing" can restructure a closed, paid bill's line items or move commission to any doctor; a user without `:refund` sub-permission can still trigger refunds through swap/cancel-refund-tests. Additionally `/gateway/reconcile` — which posts settlement money onto bills — requires only `requireStaffAuth` (gateway-webhooks.ts:539-687), so **any** authenticated staff member (any module permission) can trigger it (this is **D26** below).

**D4 — Audit actor is client-controlled on three endpoints.**
`cancel-test` takes the actor entirely from the body (`const actor = String(performedBy).trim()`, bills.ts:2508-2514 — session never consulted); `swap-test` requires body `performedBy` and uses it for `bill_audits.editedBy` and `payments.recordedByName` (2952-2955, 3019, 3044); `cancel-refund-tests` prefers the body over the session (`performedBy.trim() || req.staffSession?...`, 2613). An authenticated biller can attribute refunds and cancellations to a colleague. `PUT /:id` and `change-doctor` do this correctly (session-derived, pinned by `bills.editAudit.test.ts`) — the hardening simply never reached these three.

**D5 — Super-admin delete hard-deletes financial evidence and renumbers historical bills.**
`DELETE /bills/:id` (bills.ts:2324-2413) removes `payments` rows and the bill, then **renumbers every later bill of the month to close the gap** — mutating historical document numbers that may already be printed on patient receipts and verified via the public `/verify` QR endpoint (which will then report the renumbered bills as genuine while the patient holds a receipt for a number that now belongs to a different bill). There is no soft-delete/void pattern here (unlike the supersession pattern used for gateway duplicates, which is exemplary). No test covers it.

**D6 — Super-edit is not transactional.**
`PATCH /:id/super-edit` (bills.ts:2204-2321) performs bill, order, and order_tests updates as separate awaited statements with no wrapping transaction; a failure between them leaves a bill whose line items and totals disagree — precisely the invariant `billingSchemaCompat`/`financialIntegrity` exist to protect. (Contrast: every desk-side mutation route is transactional.)

**D7 — Tax is structurally zero.**
`const taxAmount = 0` at creation (bills.ts:785-786), persisted `taxAmount: "0.00"` (921); only super-edit can change it; no report recomputes it. Every downstream consumer (`billTotalFromParts`, invoice PDF, reports) faithfully carries a zero that was never calculated. If GST becomes applicable, enabling it requires touching every historical bill, and until then any invoice printed from this system asserts "tax = ₹0" as a computed fact.

**D8 — Gateway settlement uses float arithmetic.**
`bills.ts:3384-3387`: `const newPaid = Number(lockedBill.paidAmount) + collectAmount; … newBalance <= 0.01` — float addition and a 1-paise-ish tolerance, in the same file whose other six mutation paths use `rupeesToPaise`/`moneyAdd`. The supersede path repeats it (`accounting.ts:1141-1148`, `Math.max(0, Number(paid) - amount)`). The two paths that integrate *external money* are the two paths exempt from the money discipline.

**D12 — My Daily Summary counts superseded/void/failed payments as real collections.**
The payments query (my-daily-summary.ts:157-183) has **no `settlementStatus`/`isCollectiblePayment` filter**, unlike day-close (day-close.ts:297) and daily-summary (78). A superseded gateway posting attributed to a staff member remains in their personal collections total forever, so the staff member's shift total and the center's books disagree by exactly that amount — and the drawer "balanced" check compares the staff member's *own* expected (which uses the collectible filter, day-close.ts:844) against actuals they counted, so the discrepancy surfaces as an unexplainable variance for the user while the reconciliation cockpit shows different numbers.

**D16 — books-sanity repair rewrites historical bills with no closure-boundary check.**
`books-sanity.ts:289-402` sets `total_amount = original_total` and recomputes `balance_amount` on existing bills. Closed, signed-off periods are rewritable through an endpoint gated only by the `/day-close` permission. Combined with D5's renumbering and the live-recompute of legacy closures (day-close.ts:597, 643-645), the immutability of closed books is advisory, not enforced.

**D17 — "Balanced" drawer status can be manufactured; float equality decides it.**
`drawerStatus = variance === 0 ? "balanced" : "mismatch"` (day-close.ts:1432) after float accumulation (`n()` coercion, 60-62; bucket `+=`, 135-155) — a half-paise residue flips a physically balanced drawer to mismatch. Worse, admin close-on-behalf and `/staff-close-all` accept `autoBalance: true`, which **sets actuals = expected** (1865-1879, 1998-2098) and records "balanced" + audit rows indistinguishable from a real count. The denomination total is never compared to `actualCash`, and ₹2000 notes cannot be entered at all (`userDayClosures` JSONB has no `d2000` field) — the physical-count control layer has no teeth.

**D23 — Voucher idempotency is a racy pre-check; supersede bypasses it entirely.**
`autoVoucherForPayment` guards duplicates by a `SELECT … WHERE payment_id = … AND bill_id = …` **outside** the advisory-lock transaction (auto-voucher.ts:245-252), and there is **no unique constraint on `(payment_id, bill_id)`** in any schema. Webhook + browser-return poll + `/gateway/reconcile` can all fire for one payment; each passes the pre-check and inserts a sequentially-numbered voucher — double-entry books now double-count the collection. The supersede reversal calls with **no `paymentId`** (accounting.ts:1167-1173), so repeated supersedes post repeated reversal vouchers. The promised `REV-PAY-<id>` numbering (schema comments, `lib/db/src/schema/bills.ts:83-86`; migration comments) does not exist in code.

### P2 — correctness and control weaknesses

| ID | Defect | Evidence |
|---|---|---|
| **D9** | `cancel-test` never refunds the overpaid excess — money stays as invisible credit (`paidAmount > totalAmount`, balance clamped at 0); sibling endpoints auto-refund it | bills.ts:2551-2571 vs 2670-2689 and 3035-3048 |
| **D11** | Hash-chained `audit_logs` covers no billing money movements; the tamper-evident log is not pointed at the money; only plain `bill_audits` records them | audit middleware coverage; §12 |
| **D13** | Day-close aggregation runs on the global `db` inside the advisory-lock transaction — payments committing at the close instant can be lost between windows, silently | day-close.ts:478-488 |
| **D14** | `daily-summary` payments query `.limit(500)` — busy days silently understate `totalReceived`, cash math, `grandTotal`; no warning field | daily-summary.ts:76 |
| **D15** | books-sanity payment-ledger-drift detector does not exclude superseded rows → permanent false drift alerts for every superseded posting (its own F2 detector *does* exclude them — the two detectors disagree) | books-sanity.ts:84-104 vs 179-205 |
| **D18** | A reopened user closure permanently advances that user's window (no `drawerStatus` filter on the boundary query); overall reopen leaves the old row's persisted totals in ledger history while the next closure re-covers the period | day-close.ts:722-740, 670-699 |
| **D19** | My-daily-summary per-staff table and drilldown read expenses from `expenses` (header table) with `LOWER(payment_mode)='cash'` while the same screen's aggregate uses `expense_payments` with blank=cash — three expense figures for one day; violates the schema's locked rule | my-daily-summary.ts:354-367 vs 599-608, 1132-1141 |
| **D20** | Day-close `totalBilled` includes cancelled bills; `totalRefunds` is bill-axis (refunds against older bills appear in **no** closure's refund total); `refundDetails` built only from cancelled bills | day-close.ts:301-303, 530-536 |
| **D21** | Four inconsistent "revenue" definitions served concurrently; dashboard `referralPayouts` is actually all-time gross order value; `/revenue`'s `orders` field counts payment rows; `/popular-tests` sums cancelled tests; modality revenue counts cancelled bills' tests | reports.ts:141-143, 186, 233-251, 265; advanced-dashboard.ts:247-261, 321-345 |
| **D22** | Voucher generation silently skipped 08:00–16:00 IST and all failures swallowed; payments carry no `accountingStatus` flag (expenses do) — books can miss entries all day with nothing observable | auto-voucher.ts:234, 238-240, 308-310 |
| **D24** | Off-peak voucher backfill excludes only `superseded` — void/failed/reversed/cancelled payments (excluded by every report) get vouchers posted | auto-voucher.ts:732-748 |
| **D25** | Discount-rule create/edit/**hard-delete** write no audit rows at all (contrast: commission rules are fully audited); deleting a rule erases the basis for discounts already on historical bills | discounts.ts:78-120 |
| **D26** | `/gateway/reconcile` (triggers settlement money onto bills) and `/gateway/pending-online-bills` require only `requireStaffAuth` — any staff, any permission set | gateway-webhooks.ts:539-687, 692-727 |
| **D27** | Day-boundary semantics mixed within single files: UTC midnight (`/income-expense`, `/payment-methods` mis-bucket 00:00–05:30 IST), IST (daily-summary, dashboards), UTC grouping (`/revenue`), server-local `::date` (dues) | reports.ts:61-62 vs 501-506, 220-228; bills.ts:554-555 |

### P3 — improvements

- **D10** — refund/settlement voucher method strings are `"online"` while bill payment method is `"Online (ICICI Orange Pay)"` etc.; the voucher debit-account mapping depends on exact lowercase tokens (`auto-voucher.ts:34-46`), so mismatches land in "Unclassified Collections (Needs Review)".
- **D28** — refund method is freely chosen (`refundMethod ?? "cash"`) with no cross-check against the original payment's method; expected-cash shifts between method buckets accordingly (arguably realistic, but untracked).
- **D29** — swap-test refunds use notes `Refund for test swap:` and therefore fall outside the `REFUND (test cancel)` gross-restore machinery of the staff-slip formula — same economic event, different reconciliation treatment (`dailySummaryCollectible.ts:24`).
- **D30** — `cancel-test`/`cancel-refund-tests` do not update `orders.totalAmount` (only swap-test does), leaving order-axis and bill-axis totals divergent.
- **D31** — `/gateway/pending-online-bills` filter conditions are dead code: the final `|| balanceAmount > 0` broadens the result to every pending bill with any balance, making the `BILLPAY-` ref checks no-ops (gateway-webhooks.ts:692-727).

## 15. Probable Defects (require runtime verification)

1. **Shared-order cancellation blast radius.** The cancel cascade updates **all** `order_tests` of the bill's order with no bill scoping (bills.ts:1748-1755). If two bills can reference one order (nothing in the schema prevents it: `bills.orderId` is not unique; the emergency-bridge and online-booking paths both create bills from pre-existing orders), cancelling bill A cancels bill B's tests and rewrites B's economics via no path — B keeps its old totals while its tests are cancelled. Verification: query for duplicate `order_id` in production `bills`, and exercise a two-bill order in staging.
2. **`clientRef` freed on cancel → same key bills twice.** Cancel nulls `clientRef` "so cancel+rebill can reuse the UUID" (bills.ts:1730-1732). A *retried original request* after a cancel (offline-queue replay) would then create a second bill instead of replaying — correct for the intended workflow, but the offline queue's replay window is unbounded.
3. **Refunds against closed periods understate the refunding user's drawer with no marker** (carry-forward rule, §7.6). The negative row lands in today's window while the original collection stays in the closed one; whether staff perceive this as "missing cash" depends on training. Verify with a refund of a last-month bill and observe the user's expected-vs-actual.
4. **`n(v) = Number(v ?? 0) || 0` masks non-numeric garbage as ₹0** in every day-close figure (day-close.ts:60-62) — a corrupt row silently zeroes rather than alerting. Verify by inserting a non-numeric `amount` in staging (should be impossible via `numeric`, but the coercion also eats `NaN` from `Number("…")` edge inputs).
5. **Bill-number global suffix behaviour.** `bill_number_seq` is global across months (§3.1): September's last bill `202609-0187` makes October's first `202610-0188`, not `202610-0001`. Confirm operator expectations; the sequence-forward sync on deploy also means restoring a DB backup from mid-month re-issues numbers already printed unless the sync runs.
6. **Voucher `MAX(substring)+1` scan cost** grows with the vouchers table (per-type monthly buckets bound it); the advisory lock serializes inserts per type. Under sustained peak-hour deferral disabled (force path), settlement bursts may queue. Verify with `EXPLAIN ANALYZE` at production volume.
7. **Express 5 runtime hazards.** The apiTestApp header documents a production 500 from an Express 5 `req.query` getter issue that all static tests missed. Residual risk: other routes mutating `req.*` read-only properties. Runtime smoke of every billing mutation endpoint on the Express 5 version in production is the only coverage.
8. **`db:push`-built databases** lack the SQL-migration partial unique indexes (§17-R3) — if any environment (kiosk offline box, emergency bridge, dev/staging copy, or a Synology restore) was built with `db:push`, its gateway idempotency backstop is absent and D1/D2 protections are weaker still. Verify per-environment with `\d payments` index listing.

## 16. Design Weaknesses

- **W1 — Two money disciplines.** The desk path is integer-paise; the entire summary/close/report layer is float `Number()` accumulation (day-close `n()`, daily-summary reduces, my-daily-summary, staffSlipFormula, commissionCalc, accounting ledger balances, roundMoney in expensePayables). D8/D17 are instances; the pattern guarantees more. Root fix is one shared paise-sum helper used by every aggregation.
- **W2 — Identity by free-text name.** `payments.recordedByName`, `bill_audits.editedBy`, `order_tests.cancelledByName`, day-close per-user attribution — all keyed on trimmed display names. A rename (or "Dr " prefix variant) splits one human's financial history across two identities with no reconciliation. Combined with D4, attribution is both spoofable and fragile.
- **W3 — No payment state machine.** `settlement_status` is set only by gateway paths (captured implied by NULL, `superseded`/`void`/`failed` by exception handling). NULL passes every collectible filter — correct for legacy rows, but it also means "state was never modelled", and each new report must remember the 6-status exclusion (My Daily Summary forgot: D12; books-sanity forgot: D15; voucher backfill remembered only 1 of 6: D24).
- **W4 — Voucher fan-out is post-commit and best-effort** (§6): payments/bills are the truth, vouchers trail behind via `.catch(() => {})` paths with no `accountingStatus` on payments, peak-hour skipping, and a repair job that disagrees with the reports' status set (D22/D24). The double-entry books are a downstream projection with no completeness guarantee — acceptable only if someone watches the "Unclassified"/missing-voucher diff, which nothing surfaces.
- **W5 — Five reconciliation implementations, zero shared kernel.** day-close, daily-summary, my-daily-summary, advanced-dashboard, reports each re-derive billed/refunded/outstanding/expense with different axes (bill-created vs payment-posted, active vs all, header vs payments), different status filters, and different day boundaries (D19/D20/D21/D27). Every defect in §9 traces to this duplication; a single `lib/reconciliation.ts` with explicit axis parameters would eliminate the class.
- **W6 — Closed periods are advisory.** The carry-forward rule means nothing is ever blocked by a closure (refund, §7.6), closures can be reopened with persisted totals left behind (D18), legacy closures recompute live (day-close.ts:597, 643-645), repair endpoints rewrite historical bills (D16), and super-admin can delete+renumber (D5). "Day close" is a snapshot report, not a control.
- **W7 — Discount authorization is a single scalar.** Per-user `maxDiscount` % governs both point-of-sale discounts and due waivers (planDueWaiver); discount *rules* are advisory client-side suggestions (§5, discounts.ts `POST /apply`) with the real enforcement only at bill-create; rule CRUD is unaudited (D25) and hard-deletes. There is no four-eyes approval anywhere in the discount chain.
- **W8 — Client/server price computation duplicated.** The SPA computes totals/discounts for display (Register/BillingDesk) and the server recomputes authoritatively; a divergence shows the operator one number and books another (desk floors/ceilings already differ by role). The `mobileBillDesk.itemsReconcile` test exists because this class of bug already happened once.
- **W9 — Status as free text** (bills.status, orders.status, order_tests.status — `text` columns, no DB enum/CHECK): every consumer filters by string lists repeated across the codebase; a typo'd status value would silently fall out of every report (§4.2).

## 17. Data-Integrity Risks

- **R1 — No soft delete anywhere in billing.** `DELETE /bills/:id` is the only removal path and it destroys rows (D5). Void/cancel patterns exist for bills but not for payments (supersession covers only gateway duplicates) or vouchers (reversal rows only via supersede/books-sanity).
- **R2 — Aggregation drift.** Float accumulation in the summary layer (W1) makes persisted closure totals (`day_closures.expected_*`, variance) and on-screen totals numerically unstable at the paise level; `variance === 0` then misclassifies drawers (D17). Persisted-as-string values freeze whatever float error existed at close time.
- **R3 — Three DDL sources drift; `db:push` loses the idempotency backstops.** Production shape comes from Drizzle migrations 0000-0014 **plus** ~180 alphabetically-applied feature SQL files **plus** `zz_schema_reconcile` re-assertions. The payment idempotency partial unique indexes exist **only** in the feature SQL (`add_payment_idempotency_index_settlement_identifiers.sql`) and are **absent from the Drizzle schema** — so any database built via `db:push` (fresh installs, restore tests, the offline/emergency boxes) silently lacks `idx_payments_bill_reference_uq`/`idx_payments_bill_gateway_txn_uq`, and the only DB-level duplicate-payment protection stops existing with no error anywhere. This is the highest-leverage integrity risk found: the same repo can produce databases with and without the financial guards.
- **R4 — Order/bill/line totals can diverge.** `orders.totalAmount` is updated by swap-test but not cancel-test/cancel-refund-tests (D30); commission reads `order_tests.price` (active only), modality revenue reads `order_tests` (no bill link), dashboard reads `orders.total_amount` — three axes that mutation paths update inconsistently.
- **R5 — Attribution keys are mutable strings** (W2): renames orphan financial history; `day-close` per-staff figures and `user_day_closures` attach to whatever name string was current.
- **R6 — Denominations JSONB is write-only data** — never reconciled to `actualCash`, cannot represent ₹2000 notes (D17).
- **R7 — Closure history is not append-only in effect** — reopened rows keep persisted totals while boundaries advance (D18); legacy closures display live-recomputed numbers (day-close.ts:597); repair routes rewrite history (D16); deletion renumbers it (D5).
- **R8 — Voucher references can outlive their sources** — vouchers keyed to `payment_id`/`bill_id` that DELETE removes; the accounting sync job then either orphans them or "repairs" totals against deleted rows (D5/D23 interplay).

## 18. Security Risks

1. **Session tokens in URLs** — `?staffToken=` accepted on every API route (requireStaffAuth.ts): live credentials in access logs, proxy logs, browser history, Referer headers. P1-grade exposure on a LAN ERP.
2. **Bootstrap credentials** — super-admin PIN `1234` with an unconditional re-promotion UPDATE on startup, and `INTERNAL_API_KEY` defaulting to `1234` for server-to-server internal endpoints (radiology/PACS automations). Any restart on an unhardened environment (re)creates the weak credentials; nothing verifies they were changed.
3. **Authorization breadth** — D3/D26: sub-permissions missing on the dangerous mutations; `requireStaffAuth`-only mounts for `/dashboard/reconciliation`, `/dashboard/my-daily-summary`, `/dashboard/advanced-summary`, `/day-close` (per-user leg), `/online-bookings`, `/packages`; `/gateway/reconcile` settle power for any staff. In a clinic ERP where "receptionist" and "owner" are the realistic role extremes, several of these are privilege escalations in practice.
4. **`role_permissions` matrix is dead code** — the UI/policy surface that appears to govern roles is never read at runtime (§10.1); administrators editing it believe they changed policy when they changed a decoy.
5. **Actor spoofing** (D4) — financial audit trail integrity depends on trusting `performedBy` strings from three endpoints.
6. **Historical rewrites** (D5/D16) — a compromised super-admin (or the bootstrap path above, pre-hardening) can erase or rewrite financial history, and the public `/verify` endpoint will still bless the renumbered bills.
7. **PHI breadth** — every staff member with any billing-adjacent permission can read all patients' bills, balances, and payment history through list endpoints (no row-level scoping, no field-level sanitization beyond `sanitizePatient` on responses). Appropriate for a small clinic, worth documenting as an accepted risk.
8. **Public surface** — `/kiosk`, `/public/booking`, `/verify`, `/share`, `/p/r`, `/f`, `/teleradiology`, `/display` are intentionally unauthenticated (rate-limited; tokenized where data is exposed). The gateway webhook mount is public by necessity and correctly HMAC-verified fail-closed (both ICICI and HDFC paths verified); its 200-ack-then-process pattern is standard. The only finding on this surface is D26's reconcile sibling.
9. **Rate limiting** exists globally (`generalLimiter`) plus dedicated limiters for login/exports/admin mutations/uploads/n8n — reasonable posture; the limiter is in-process, so multi-instance deployments would multiply the budget (single-process deployment today, §2.2).

## 19. Performance Risks

1. **N+1 query patterns on list endpoints.** `GET /api/orders` maps `buildOrder` over every order (each doing 3 queries; orders.ts:118-155) — 20 orders/page = 60+ queries. The bills list similarly enriches per-bill. The hot single-order path was optimized (preloaded rows, batched wave — orders.ts:139-152), but lists were not; paginated at 20, tolerable today, poor under reporting-scale limits.
2. **Voucher numbering `MAX(substring(voucher_number))+1`** scans each type's monthly bucket under a per-type advisory lock (auto-voucher.ts:164-191) — serialized inserts per type and a scan that grows with history; mitigated by peak-hour deferral and monthly buckets.
3. **Day-close whole-window scans** — every closure aggregates all payments/bills/expense_payments in the window with no materialized rollup; windows grow with reopen gaps (D18 can make a window span months).
4. **`buildOrder`'s patient/doctor joins without indexes on hot filters** — unverified at the SQL plan level (read-only audit; no `EXPLAIN` run against production): `payments.created_at`, `bills.status + balance_amount`, `order_tests.status` deserve index review at production volume.
5. **In-process caches and locks** — 20-second session cache, in-memory rate limiters, advisory locks in Postgres: all correct for the current single-process deployment; all become wrong (stale auth, multiplied limits, lock contention) if the API is ever horizontally scaled. Document the single-instance assumption or move to shared stores first.
6. **Vigilant positives** — `bills.billingSpeed.test.ts`, `billingPerformanceSnapshot`, the fast-mode token fan-out, and the batched order-create wave show the hot path is actively engineered for latency; the risks above are the read/reporting paths, not the desk save.

## 20. Prioritized Remediation Plan

Read-only audit — no changes made. Sequenced by risk-per-effort.

### Immediate (before the next reconciliation cycle)

| # | Action | Fixes | Effort |
|---|---|---|---|
| 1 | Add an idempotency key to every money-out write: server-generated `referenceNumber` for refunds (`REF-<uuid>` supplied by the client or minted server-side and returned), and a `clientRef`-style key for `POST /api/payments` cash collections; back the app-level probes with the existing partial unique indexes (make them non-partial-safe by always writing a reference) | D1, D2 | Small |
| 2 | Add `requireStaffSubPermission` gates to `change-doctor`, `cancel-test`, `cancel-refund-tests`, `swap-test`, `initiate-gateway-payment`; require an admin permission for `/gateway/reconcile` | D3, D26 | Small |
| 3 | Derive the audit actor from `req.staffSession` on the three body-trusting endpoints (mirror the `editActor` pattern already pinned by `bills.editAudit.test.ts`) | D4 | Trivial |
| 4 | Replace super-admin DELETE with a cancel-and-mark pattern (keep rows, keep numbers); wrap super-edit in a transaction | D5, D6 | Small–medium |
| 5 | Port the two gateway settle paths and the supersede path to the paise helpers already used three functions away | D8, part of W1 | Trivial |
| 6 | Add `isCollectiblePayment` to the My Daily Summary payments query (it is imported in sibling routes already) | D12 | Trivial |

### Near term (one release cycle)

| # | Action | Fixes |
|---|---|---|
| 7 | Add a unique constraint on `vouchers(payment_id, bill_id)` (or do the duplicate check inside the advisory-lock transaction) and pass `paymentId` on the supersede reversal | D23 |
| 8 | Gate books-sanity repair behind super-admin + closure-boundary check; exclude superseded in the drift detector; surface a "missing voucher" diff for payments | D15, D16, D22 |
| 9 | Kill `autoBalance` or mark the closure row `auto_balanced` with a distinct status; compare denomination total to actualCash; add `d2000`; decide `balanced` with paise comparison | D17 |
| 10 | Unify the day boundary to IST in `resolveDateRange`; remove `.limit(500)` or paginate-and-continue | D27, D14 |
| 11 | Route all five summary/close computations through one shared kernel with explicit axes; fix the my-daily-summary expense axis to `expense_payments` | W5, D19, D20 |
| 12 | Audit-log discount-rule CRUD; soft-delete rules instead of hard delete | D25 |
| 13 | Make `cancel-test` auto-refund the overpaid excess (or explicitly record it as advance credit) and update `orders.totalAmount` in all three partial-cancel endpoints | D9, D30 |
| 14 | Write the payment-idempotency indexes into the Drizzle schema so `db:push` cannot build an unprotected database; add a startup assertion that both partial indexes exist | R3 |

### Structural (quarter)

| # | Action | Fixes |
|---|---|---|
| 15 | Migrate the whole summary/report layer to paise arithmetic (`sumRupeesToPaise` exists) | W1, R2 |
| 16 | Extend the hash-chained `audit_logs` to every billing money movement (payment, refund, waiver, cancel, supersede, super-edit, delete) | D11 |
| 17 | Replace name-based attribution with `staff_session.subjectId` FKs (keep the name as a display snapshot) | W2, R5 |
| 18 | Model a real payment state machine (`captured|superseded|void|…` non-null with default) so filters stop being per-call conventions | W3, D12/D15/D24 class |
| 19 | Single revenue definition (or explicitly named variants: cash-collected vs accrued-billed) used by every report; correct `referralPayouts`/`orders` mislabels | D21 |
| 20 | Request-level tests for the refund handler, cancel-test, super-edit/DELETE, payments-POST concurrency, and the auto-voucher race (the harness and fixtures already exist — §13.1) | Closes the untested-P1 gap |

### Verification checklist for any fix

- Refund double-submit (two concurrent POSTs) must produce one negative row.
- Cash payment retry (same key) must replay, not re-post.
- Superseded payment must vanish from My Daily Summary, day-close, daily-summary, and the drift detector *simultaneously*.
- `db:push`-built database must reject a duplicate `(bill_id, reference_number)` insert.
- Drawer "balanced" must require a non-autoBalance closure with denomination total = actualCash.

---

*End of audit. Produced 2026-09-30 from a read-only review of commit `e1cf96b13d32d6ab31d3d4498dc3ab679d735177`. No application code, database content, migrations, deployments, or remote branches were modified in producing this document.*

