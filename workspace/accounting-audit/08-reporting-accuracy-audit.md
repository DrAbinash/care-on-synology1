# 08 — Reporting Accuracy Audit (Dimension "RPT")

- **Audit date:** 2026-07-16
- **Auditor dimension:** RPT — financial report/dashboard accuracy, date bases, timezone handling, cancellation/refund treatment, cross-report consistency
- **Repository:** `/home/user/care-on-synology1` (CARE ERP monorepo)
- **Standard applied:** every number shown on a financial report must be (a) computed from a defined source of truth, (b) attributed to a defined date basis and timezone, (c) stable once its period is closed, and (d) equal across every other report claiming to show the same thing. Every claim below cites file + line numbers of code read in this run.

---

## 1. Scope & method

All server-side financial reporting endpoints were read in full and traced to their source tables, filters, date columns and timezone conversions:

| Surface | File (all under `artifacts/api-server/src/`) | Mounted at (routes/index.ts) |
|---|---|---|
| Legacy reports (dashboard, revenue, popular tests, income/expense, payment methods, daily summary + PDF, outsourced) | `routes/reports.ts` (775 lines, read fully) | `/reports` — line 305, staff auth + `/reports` permission |
| Clinic daily reconciliation summary | `routes/daily-summary.ts` (487 lines, read fully) | `/daily-summary` — line 735 |
| Per-staff daily summary + drilldowns | `routes/my-daily-summary.ts` (1053 lines, read fully) | `/dashboard/my-daily-summary` — line 737 |
| Owner "advanced" dashboard | `routes/advanced-dashboard.ts` (353 lines, read fully) | `/dashboard/advanced-summary` — line 736 |
| Day close / cash closing / drawer | `routes/day-close.ts` (1265 lines, read fully) | `/day-close` — line 360 |
| Ledger, trial balance, P&L, balance sheet, Tally export, sync-billing | `routes/accounting.ts` (lines 367–1130 read) | `/accounting` — line 315 |
| Expense list/summary | `routes/expenses.ts` (219 lines, read fully) | `/expenses` — line 348 |
| Books sanity / CA review | `routes/books-sanity.ts` (348 lines, read fully) | `/books-sanity` — lines 361–362 |
| Discount rules/apply | `routes/discounts.ts` (226 lines, read fully) | — |
| Supporting libraries | `lib/istDate.ts`, `lib/paymentMethodClassifier.ts`, `lib/auto-voucher.ts` (all read fully) | — |
| Gateway settlement writes (timestamp basis) | `routes/gateway-webhooks.ts` lines 60–190 | — |
| Bill cancel/refund writes (reporting inputs) | `routes/bills.ts` lines 948–1230 | — |
| Doctor referral/commission reports | `__super_admin_quarantine/backup_usb_isolation_restore_point/api-routes/commission.ts` + `doctor-ledger.ts` (relevant sections) | plugin-loaded (off-repo at runtime) |
| Deployment timezone | `docker-compose.yml` (read fully), `lib/db/src/schema/bills.ts` (read fully) | — |

Nothing was modified. Findings use IDs `RPT-01`…`RPT-20`.

---

## 2. Timezone architecture — the verified facts

1. **Containers run UTC.** `docker-compose.yml` (read in full, lines 1–381) sets **no `TZ` environment variable** on any service (`db`, `db-patch-v2`, `schema-verify`, `api`, `web`). PostgreSQL 16-alpine and the Node API both therefore run with UTC clocks and a UTC session timezone.
2. **Financial timestamps are `timestamptz`.** `lib/db/src/schema/bills.ts:44` (`createdAt: timestamp("created_at", { withTimezone: true })`) and `bills.ts:56` (payments). Instants are stored unambiguously; the reporting risk is purely in how each endpoint converts instants to calendar days.
3. **An IST helper exists and documents the trap.** `artifacts/api-server/src/lib/istDate.ts:4-9`: *"the server container runs UTC. Between 00:00 UTC and 05:30 IST, `new Date().toISOString().slice(0, 10)` returns the previous day's date… every route that needs 'today' in the clinic's timezone must use these helpers."* `todayIST()` (lines 12–19) converts via `toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`.
4. **The helper is not used consistently.** Section 3 and findings RPT-06/RPT-07/RPT-16 document endpoints that still bucket by UTC day, in the same codebase and sometimes in the same file that contains a correct IST implementation.

The daily window between **18:30 UTC and 24:00 UTC (= 00:00–05:30 IST)** is the danger zone: any payment, bill, refund, expense or webhook processed in that window lands on *different calendar days* depending on which endpoint is asked.

---

## 3. Report-by-report trace (source tables, date basis, filters)

### 3.1 `/api/reports/dashboard` (reports.ts:89–195)
- **Date basis:** IST day bounds built correctly from `toLocaleDateString(..., Asia/Kolkata)` (lines 93–99). The comment (90–92) records that this was previously broken.
- **todayRevenue** = `SUM(payments.amount)` in the IST day (line 122) — includes negative refund rows, so it is a *net* figure; other reports (advanced-dashboard `total_received`, daily-summary `totalReceived`) are *gross of refunds*. Same word "revenue/received", different semantics.
- **pendingPayments / todayPendingPayments** = `SUM(bills.balance_amount)` for status pending/partial (lines 125–126) — stored denormalized column, not recomputed from payments.
- **referralPayouts** = `SUM(o.total_amount)` for **all orders ever** with `doctor_id IS NOT NULL` (lines 131–133, surfaced as `referralPayouts` at line 176) — not a payout, not commission, not date-filtered. See RPT-11.

### 3.2 `/api/reports/revenue` (reports.ts:197–244)
- **Date basis: UTC.** `groupBy = "DATE(created_at AT TIME ZONE 'UTC')"` (line 210; weekly/monthly variants lines 214, 218). For `timestamptz`, `AT TIME ZONE 'UTC'` yields UTC wall-time — daily revenue buckets are **UTC days**, not IST days.
- No cancellation/refund awareness: `COUNT(*) as orders` counts refund rows as "orders" (line 227); `SUM(amount)` nets refunds invisibly.

### 3.3 `/api/reports/popular-tests` (reports.ts:246–272)
- No date filter at all; joins `order_tests → tests`; `revenue = sum(order_tests.price)` (line 254) with **no exclusion of cancelled bills, cancelled orders, or cancelled test lines**. See RPT-13.

### 3.4 `/api/reports/income-expense` (reports.ts:329–432)
- **Range bounds are UTC** — `resolveDateRange` builds `fromDate = new Date(fromIso + "T00:00:00.000Z")` (lines 53–54).
- **Day bucket key is UTC** — `const day = p.createdAt.toISOString().split("T")[0]` (line 353).
- Expense side comes from **vouchers** (`type in payment/purchase`, account classified by `tallyGroup`/`type`, lines 369–379) — a third expense definition distinct from both the `expenses` table and `daily-summary`'s account-type-only filter.
- **User attribution fallback bug:** the per-user income key is `recordedByName || referenceNumber || "Unknown User"` (line 412) — a UPI/gateway reference number can appear as a "user" with money attributed to it. See RPT-19.

### 3.5 `/api/reports/payment-methods` (reports.ts:435–481)
- UTC range bounds (same `resolveDateRange`). Method totals and counts include negative refund rows (lines 453–457), skewing totals, counts and the percentage split (line 468). Row date/time rendered as UTC: `toISOString().split("T")[0]` and `toTimeString()` on a UTC-clock server (lines 471–472).

### 3.6 Legacy `/api/reports/daily-summary` (+ `/pdf`) (reports.ts:496–636)
- Day bounds are IST (`istDayBounds`, lines 488–493) **but the default date is UTC-today**: `q.data.date || new Date().toISOString().split("T")[0]` (lines 499, 607) — between midnight and 05:30 IST the report silently defaults to *yesterday*, the precise defect `istDate.ts` was written to prevent.
- Cancelled bills excluded from `totalBilled` but payments on cancelled bills still inside `totalReceived` (lines 518–521); `outstanding = max(0, totalBilled − totalReceived)` clamps and mixes bill-basis with payment-basis.
- Expense = vouchers joined via `${vouchersTable.debitAccountId}::integer = ${accountsTable.id}` (line 514) — `debit_account_id` is free text (never FK-validated at `accounting.ts:236-237` per voucher-create path); a single non-numeric id makes this endpoint 500. Expense filter is `a?.type === "expense"` only (lines 578–580) — narrower than income-expense's tallyGroup test and different from the `expenses` table entirely.
- This entire endpoint co-exists with the newer `/api/daily-summary` and produces different numbers for the same day. See RPT-06.

### 3.7 `/api/daily-summary` (daily-summary.ts:22–384) — the "modern" clinic day report
- IST day bounds (lines 15–20), IST default date via `todayIST()` (line 23). Refunds split from payments by sign (lines 47–48). Suspense bucket for unknown methods (lines 110–134) via the shared classifier. Expenses **by `created_at`** with an explicit posting-date rule comment (lines 78–90). Old-dues vs new-billing reconciliation split (lines 141–165).
- **Defective headline formula** (lines 136–137):
  ```ts
  const netCollection = totalBilling - outstanding - totalRefunded
      - cancelledBills.reduce((s, r) => s + Number(r.totalAmount), 0) - expenses;
  const physicalCashInHand = netCollection - digitalCollection;
  ```
  `totalBilling` already excludes cancelled bills (line 102–105), yet the cancelled total is subtracted again; refunds are subtracted from a bill-basis figure they never entered; `oldDuesCollected` (line 146–148) is computed but **not** part of `netCollection`, so dues cash physically in the drawer is missing from `physicalCashInHand`; and `grandTotal` (line 313) republishes this wrong number. See RPT-03.
- Cancelled bills are those **created in the window** whose *current* status is cancelled (lines 50, 102–103) — a cancellation performed days later rewrites this day's history and never appears on the cancellation day. See RPT-08.

### 3.8 `/api/dashboard/my-daily-summary` (my-daily-summary.ts) — per-staff report
- IST bounds (lines 12–17), IST default date (line 63). Correct drawer math: `cashCollection = cashIn − cashRefunded` (line 428), `physicalCashInHand = cashCollection − cashExpenses` (line 430) — the *only* headline report whose cash formula is internally consistent.
- Cancellation accountability by **`cancelledAt` + `cancelledByName`** (lines 126–130) — a different (and better) basis than `/api/daily-summary`'s creation-date basis; the two reports disagree whenever a bill is cancelled on a later day.
- Dues collected = payments in window on bills created before window (lines 179–186). Expenses by `created_at` with SQL cash split (lines 298–308).

### 3.9 `/api/dashboard/advanced-summary` (advanced-dashboard.ts) — owner dashboard
- IST bounds (lines 21–26) for bills/payments/audits — **but expenses are filtered on the free-text, backdatable `expense_date` column** (lines 104, 222), explicitly the opposite of the posting-date rule documented in daily-summary.ts:78–84 and my-daily-summary.ts:280–287. See RPT-05.
- **Cash/digital split bypasses the shared classifier**: raw SQL `LOWER(method) IN ('upi','card','online','bank','cheque','neft','rtgs')` (lines 72, 212) and `LOWER(method) = 'cash'` (lines 71, 213). Gateway-qualified methods (`"Online (ICICI Orange Pay)"` etc. — the exact strings the classifier at `lib/paymentMethodClassifier.ts:11-18` was created to handle) and `insurance` match **neither** filter: they are inside `total_received` but in neither `cash_collection` nor `digital_collection`. See RPT-04.
- `netCollection = grossBilling − outstanding − (refunds + cancelledAmount) − totalExpenses` (line 243) repeats the double-subtraction defect (grossBilling already excludes cancelled at line 194), and `physicalCashInHand = netCollection − digitalCollection` (line 244) mixes bases — even though a correct `cash_collection` figure was computed one query earlier.
- Modality summary (lines 263–287) is **order-creation-date** based (`o.created_at`, line 284) while the money summary above is **bill-creation-date** based (line 199) — the same response body mixes two date bases.

### 3.10 `/api/day-close` (day-close.ts) — cash closing
- Windows are **rolling `(lastClose, now]`** (lines 198–209: `gt(createdAt, from), lte(createdAt, to)`), not calendar days; `closureDate` is merely the IST label of the moment of closing (line 410). See RPT-09.
- Overall close: classifier + suspense bucket (lines 101–130), cash expenses subtracted once via `applyCashExpenses` (lines 182–195, applied at 288–289) — correct.
- **Per-user close subtracts cash expenses twice** (lines 671–675):
  ```ts
  const { cashExpenses } = splitCashExpenses(expRows);
  totals.cash -= cashExpenses;
  totals.total -= cashExpenses;
  totals.cash -= cashExpenses;
  totals.total -= cashExpenses;
  ```
  This corrupts `/my-preview`, `/my-close`, `/my-drawer-status` and `/staff-status`. See RPT-01 (the single worst defect found in this dimension).
- Day close is explicitly non-blocking: post-closure billing is allowed and only surfaced as a callout (lines 1170–1248, comment: *"Billing is never blocked"*).

### 3.11 Ledger / trial balance / P&L / balance sheet (accounting.ts:367–656)
- Date basis: `vouchers.date`, a **text `YYYY-MM-DD`** column written as IST-today by `auto-voucher.ts:111-113,164` — i.e. **posting date**, a third basis besides payment-instant and bill-instant.
- Ranged trial balance (`from` given) sums only vouchers with `date >= from` (line 453) and adds the **static** `account.openingBalance` (lines 474–480) — movements before `from` vanish rather than rolling into opening balances; a ranged trial balance is therefore not a trial balance. Same pattern in `/ledger` (lines 396–400: pre-`from` vouchers skipped, opening entry from static field at 385–394). See RPT-14.
- `balanced` flags: trial balance compares `Σ balanceDr` vs `Σ balanceCr` of the same numbers (lines 500–503); balance sheet force-plugs net profit (lines 644–649) then declares `balanced` (line 654) — near-tautological.
- P&L is **cash/posting-basis** (vouchers exist only when payments/expenses post) and classified by `tallyGroup.includes("Income"/"Expense")` (lines 548–549).

### 3.12 `/api/accounting/sync-billing` (accounting.ts:1077–1130)
- Backfills receipt vouchers for **every** payment whose `reference` `PAY-${p.id}` is absent (lines 1091–1099). But the live auto-voucher writes `reference: billNumber` (`auto-voucher.ts:172`) — so every payment already posted by the auto-voucher is **not recognized** and gets a second voucher. Voucher date = `p.createdAt.toISOString().split("T")[0]` — **UTC** (line 1105) vs the auto-voucher's IST date; debit account = single generic bank/cash account (lines 1079–1103) vs the auto-voucher's per-method accounts (`auto-voucher.ts:11-23`); credit = first `Direct Income` account, i.e. `"Lab Revenue"` from setup-defaults (line 1057) vs the auto-voucher's `"Diagnostic Services Revenue"` (`auto-voucher.ts:73-77`); refund rows (negative amounts) are inserted as *negative receipts* (`amount: p.amount`, line 1119). See RPT-02.

### 3.13 `/api/books-sanity` (books-sanity.ts)
- Excellent anomaly battery (commission leak, arithmetic drift, `paid_amount ≠ Σ payments`, cancelled-but-not-refunded, >50% discounts, override audit trail — lines 42–169).
- Date filter is `b.created_at >= ${fromRaw}::date` (lines 35–37) — a `::date` cast compared against `timestamptz` resolves at the **DB session timezone (UTC)**, so the CA's review window is shifted 5.5 h from every IST-bounds report. See RPT-16.
- It never queries `vouchers`: no payments↔ledger reconciliation exists anywhere. See RPT-15.

### 3.14 Doctor referral / commission reports (quarantine copies; runtime code is plugin-loaded)
- `commission.ts`: window `gte(orders.createdAt, new Date(from))` / `lte(..., new Date(to + "T23:59:59Z"))` — **UTC day bounds** (lines 220–221, 322–323); excludes cancelled order_tests (lines 225, 327); row dates via `toISOString()` (UTC, line 272).
- `doctor-ledger.ts`: same UTC bounds (lines 94–95) but fetches order_tests **without any cancelled filter** (line 99: `inArray(orderTestsTable.orderId, orderIds)` only) and dates rows in UTC (line 130). The two referral reports disagree with each other on both scope and calendar. See RPT-12. Note these files are the quarantined restore-point copies; the running code is dynamically imported from an uploaded plugin and may differ — flagged accordingly.

### 3.15 Gateway settlement timestamps (gateway-webhooks.ts:87–150)
- `settleBill` inserts the payment row without `createdAt` (lines 122–129), so the payment is dated at **webhook processing time** (`defaultNow()`, schema `bills.ts:56`). The gateway's own transaction timestamp is not persisted on the payment (only inside the raw JSON payload log, lines 161–168). See RPT-10.

---

## 4. Cross-report divergence matrix (same day, different answers — by construction)

| # | Report A | Report B | Why they disagree |
|---|---|---|---|
| D1 | `/api/reports/revenue?period=daily` — UTC day buckets (reports.ts:210) | `/api/daily-summary?date=D` — IST bounds (daily-summary.ts:15-20) | Every payment recorded 00:00–05:30 IST is in different days. |
| D2 | `/api/daily-summary` — expenses by `created_at` (daily-summary.ts:85-90) | `/api/dashboard/advanced-summary` — expenses by backdatable `expense_date` (advanced-dashboard.ts:104,222) | Any backdated/postdated expense; totals differ and A is stable while B rewrites history. |
| D3 | `/api/reports/daily-summary` (legacy) — voucher-based expense, UTC default date, refunds netted (reports.ts:499,512-515,520) | `/api/daily-summary` — expenses-table expense, IST default, refunds split (daily-summary.ts:23,47-48,85-90) | Two endpoints both named "daily summary" with three independent differences. |
| D4 | `/api/daily-summary` — cancellations by bill *creation* date (daily-summary.ts:102-103) | `/api/dashboard/my-daily-summary` — cancellations by `cancelledAt` (my-daily-summary.ts:126-130) | Bill created 10 Jul, cancelled 15 Jul: A shows it on 10 Jul (retroactively), B on 15 Jul. |
| D5 | `/api/dashboard/advanced-summary` `digital_collection` — SQL IN-list (advanced-dashboard.ts:72) | `/api/daily-summary` `digitalCollection` — shared classifier (daily-summary.ts:126-129) | Every `"Online (…)"`/`insurance` payment counted by B, dropped by A. |
| D6 | `/api/day-close` — rolling `(lastClose, now]` window (day-close.ts:198-209) | any calendar-day report | Close at 20:00 today + close at 21:00 tomorrow ⇒ the "day" is a 25-hour window with an IST label. |
| D7 | `/api/accounting/profit-loss` — voucher posting date (accounting.ts:529-530) | `/api/daily-summary` — payment instant | Vouchers date at IST-today of processing; failed auto-vouchers are missing entirely (auto-voucher.ts:181-183). |
| D8 | `/api/books-sanity` — UTC `::date` window (books-sanity.ts:35-37) | `/api/daily-summary` — IST window | 5.5-hour shift on both edges of the CA's review range. |

---

## 5. Boundary test cases (constructed against the code above)

1. **Payment at 23:59 IST vs 00:01 IST (₹5,000 cash each).** `timestamptz` instants: 18:29 UTC and 18:31 UTC same UTC day. `/api/daily-summary` splits them across two IST days (correct). `/api/reports/revenue?period=daily` puts **both** in the same UTC-day bucket (reports.ts:210). `/api/reports/income-expense` keys both to the same UTC day (reports.ts:353). Result: day totals differ by ₹5,000 between endpoints.
2. **User opens legacy daily report at 00:30 IST.** `/api/reports/daily-summary` with no `date` param defaults to `new Date().toISOString().split("T")[0]` = *yesterday's* UTC date (reports.ts:499) — staff sees yesterday's report believing it is today's.
3. **Gateway payment initiated 23:58 IST, webhook lands 00:04 IST.** `settleBill` inserts the payment with `defaultNow()` (gateway-webhooks.ts:122-129) ⇒ all payment-basis reports count it on the next day; the gateway MIS/settlement file shows the previous day; no stored gateway timestamp exists to reconcile the two (RPT-10).
4. **March 31 / April 1 (FY boundary).** No code anywhere implements a financial year: no FY voucher series, no year-end close, no Apr-1 opening roll (grep across `routes/accounting.ts` and `lib/` found no fiscal handling; Tally exports accept arbitrary `from`/`to`, accounting.ts:660–666). A ranged Apr-1→Mar-31 trial balance additionally omits pre-April movements from opening balances (RPT-14/RPT-18).
5. **Refund on a later date.** Bill 10 Jul ₹4,000 paid; refund ₹1,000 on 15 Jul. The refund is a negative payment dated 15 Jul (bills.ts:1208–1215) — correct on payment-basis reports — but `/api/daily-summary?date=2026-07-10` recomputes 10 Jul's `outstanding` from the *current* `balance_amount` and `paidAmount` (daily-summary.ts:106, 322-333), so 10 Jul's stored history changes after the fact (RPT-08).
6. **Expense backdated by a week.** `expenses.expense_date` set to last Tuesday: `/api/daily-summary` (created_at) shows it today; `/api/dashboard/advanced-summary` and `/api/expenses/summary` re-insert it into last Tuesday (RPT-05); if the auto-voucher posted, the P&L shows it on posting day (auto-voucher.ts:227) — three different days for one expense.

---

## 6. Strengths (what is done well)

These are genuine controls that the executive summary should credit:

1. **A single shared payment-method classifier** (`lib/paymentMethodClassifier.ts:75-126`) with the locked rule *"only literal 'cash' is physical cash"* and an explicit unknown→suspense path; consistently used by daily-summary, my-daily-summary and day-close (day-close.ts:63-72, 101-130; daily-summary.ts:115-134; my-daily-summary.ts:388-410).
2. **Suspense/exception bucket discipline**: unknown methods are never silently folded into cash or digital; they are surfaced with row-level detail for admin correction in all three modern reports (daily-summary.ts:300-321; day-close.ts:341-346; my-daily-summary.ts:600-648) and even in voucher posting (`Unclassified Collections (Needs Review)`, auto-voucher.ts:33-37).
3. **Posting-date rule for expenses** is documented and enforced in the reconciliation path — `created_at`, not the backdatable `expense_date` (daily-summary.ts:78-90; day-close.ts:207-209; my-daily-summary.ts:279-297) — exactly the right control (its non-adoption in advanced-dashboard is the finding, not the rule).
4. **Day-close concurrency control**: `pg_advisory_xact_lock` around overall close (day-close.ts:393-394) and per-user close (910-915); carry-forward `MAX(lastOverall, lastUser)` window rule is pure and unit-testable (590-615); drawer audit log rows on close/approve/reopen (969-979, 1105-1115, 1154-1164); reopen requires super-admin + reason and preserves the original row (1121-1147).
5. **Refunds as negative payment rows** with mandatory reason, row-level bill locking (`.for("update")`, bills.ts:1171), over-refund guard (1178-1183), immutable `totalAmount` (comment 1187-1195), and `balance = total − paid − refund` invariant — so refunds are visible in payment history and payment-basis reports pick them up naturally.
6. **Closed-period visibility on refunds/cancellations**: refunds against a bill from an already-closed window return a `closedPeriodWarning` (bills.ts:1117-1131).
7. **Careful test-count report**: `/api/daily-summary/category-test-summary` excludes cancelled bills by *two* signals (status + `cancelledAt`), excludes cancelled test lines, uses stable master test names instead of editable display names, and derives category totals only by summation (daily-summary.ts:406-478) — a model the other reports should follow.
8. **books-sanity** is a real CA-oriented anomaly report — commission leak, arithmetic drift, `paid_amount ≠ Σ payments`, cancelled-but-unrefunded money, >50% discounts, super-admin edit trail (books-sanity.ts:42-169) — with a dry-run/confirm backfill pattern (233-346).
9. **Strict date validation** on legacy report inputs — calendar-aware `IsoDate` refinement that rejects `2026-02-31` (reports.ts:16-27).
10. **IST is handled correctly in the modern paths**: `todayIST()` defaults and explicit `+05:30` bounds in daily-summary, my-daily-summary, advanced-dashboard, day-close labels (daily-summary.ts:15-23; my-daily-summary.ts:12-17,63; advanced-dashboard.ts:21-31; day-close.ts:410).

---

## 7. Findings

### [RPT-01] P0 — Per-user drawer close subtracts cash expenses twice, corrupting expected-cash for every cashier close
- Severity: P0
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/day-close.ts`, `summarizeUserWindow()`, lines 671–675; consumed by `GET /day-close/my-preview` (740–766), `POST /day-close/my-close` (899–997), `GET /day-close/my-drawer-status` (769–853), `GET /day-close/staff-status` (1002–1059)
- Current behavior: after computing the user's cash bucket, the code runs the subtraction twice:
  ```ts
  const { cashExpenses } = splitCashExpenses(expRows);
  totals.cash -= cashExpenses;
  totals.total -= cashExpenses;
  totals.cash -= cashExpenses;
  totals.total -= cashExpenses;
  ```
  The overall (clinic-wide) close path applies the same rule exactly once via `applyCashExpenses` (lines 182–195, called at 288–289), so the per-user and overall closes disagree by construction.
- Why unsafe: `expectedCash`/`totalExpected` persisted into `user_day_closures` (lines 943–948) are understated by exactly the user's cash expenses. The drawer variance — the primary anti-theft control — is computed against a wrong baseline, and `drawerStatus = variance === 0 ? "balanced" : "mismatch"` (line 928) certifies wrong drawers as balanced.
- Failure scenario: Cashier collects ₹10,000 cash and pays a ₹2,000 cash expense she approved. True drawer = ₹8,000. Expected cash computed = 10,000 − 2,000 − 2,000 = ₹6,000. She removes ₹2,000, counts ₹6,000, submits — system records `drawerStatus: "balanced"`, admin approves nothing, audit log shows a clean close. Every honest cashier instead shows a phantom ₹2,000 overage, training staff to ignore variances.
- Recommended correction: delete the duplicated pair of lines (keep one subtraction), or better, reuse `applyCashExpenses()` for the user path; add a unit test asserting expected cash = cashIn − cashRefunds − cashExpenses (the file already exports pure functions for exactly this purpose, lines 76–99).
- Backward compatible: yes — arithmetic fix only; historical `user_day_closures` rows keep their stored (wrong) values.
- Data migration required: recommended — recompute/flag stored `expected_cash`/`variance` on past user closures where the user had cash expenses in-window, so past "balanced" certificates can be re-reviewed.

### [RPT-02] P1 — `/accounting/sync-billing` double-posts every auto-vouchered payment into the ledger (and dates the copies in UTC)
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/accounting.ts`, `POST /accounting/sync-billing`, lines 1077–1130; interacting with `lib/auto-voucher.ts` lines 111–113, 164, 172
- Current behavior: sync-billing deduplicates on `reference = "PAY-" + p.id` (lines 1091–1099), but the live auto-voucher writes `reference: billNumber` (auto-voucher.ts:172). No auto-posted voucher can ever match, so one click re-posts a receipt voucher for **every payment in history**. The copies differ from the originals in four ways: date is UTC (`p.createdAt.toISOString().split("T")[0]`, line 1105) vs the original's IST (`istDateStr()`, auto-voucher.ts:111–113, 164); credit account is the first `Direct Income` account — `"Lab Revenue"` from setup-defaults (line 1057) — vs `"Diagnostic Services Revenue"` (auto-voucher.ts:73–77); debit account is one generic bank/cash account (lines 1079–1103) vs per-method accounts (auto-voucher.ts:11–23); refund rows are re-posted as *negative receipts* (`amount: p.amount`, line 1119).
- Why unsafe: trial balance, P&L, balance sheet and all four Tally exports read `vouchers` — one invocation of this endpoint (any staffer with `/accounting` permission, routes/index.ts:315) roughly **doubles reported revenue**, splits it across two differently-named income accounts, and shifts night-window postings to the wrong day.
- Failure scenario: Books show ₹40,00,000 revenue for Q1. An admin runs "Sync Billing" from the accounting screen to catch payments whose fire-and-forget voucher failed. Every already-posted payment is re-vouchered: the P&L for Q1 now shows ~₹80,00,000 across "Diagnostic Services Revenue" + "Lab Revenue"; the CA imports the Tally XML and files from inflated books. Payments made 00:00–05:30 IST are additionally dated one day early in the copies.
- Recommended correction: dedupe on `billId + payment id` or standardize `reference = "PAY-" + p.id` in `autoVoucherForPayment` too; use `dateToISTString(p.createdAt)`; reuse `resolveMethodAccount()` and the same revenue account; skip or properly reverse negative rows; require super-admin.
- Backward compatible: yes for the fix itself; any environment where sync-billing already ran needs cleanup.
- Data migration required: yes — detect and remove duplicate vouchers (`reference LIKE 'PAY-%'` where a same-bill, same-amount auto voucher exists).

### [RPT-03] P1 — Headline `netCollection` / `physicalCashInHand` formulas double-subtract cancellations, mix date bases, and drop old-dues cash
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/daily-summary.ts` lines 102–105, 136–137, 313; `artifacts/api-server/src/routes/advanced-dashboard.ts` lines 194–199, 242–244
- Current behavior: in both endpoints the "billed" aggregate already excludes cancelled bills (`activeBills`, daily-summary.ts:102–105; `FILTER (WHERE status <> 'cancelled')`, advanced-dashboard.ts:194) yet the cancelled total is subtracted again (`netCollection = totalBilling − outstanding − totalRefunded − cancelledTotal − expenses`, daily-summary.ts:136; `− refundsAndCancellations`, advanced-dashboard.ts:242–243). `physicalCashInHand = netCollection − digitalCollection` (daily-summary.ts:137; advanced-dashboard.ts:244) subtracts a payment-basis number from a bill-basis number. Payments received today against *earlier* bills (`oldDuesCollected`, correctly computed at daily-summary.ts:146–148) never enter `netCollection`. Contrast with the correct formula in my-daily-summary.ts:428–430 (`physicalCashInHand = cashIn − cashRefunded − cashExpenses`).
- Why unsafe: the number labelled "physical cash in hand" on the clinic-wide daily summary and owner dashboard is wrong on any day with a cancellation, an old-dues collection, or a digital-heavy mix — it can even go negative. Staff reconciling a drawer against it will either chase phantom shortages or, worse, real shortages are masked.
- Failure scenario: Day with ₹20,000 billed & fully collected in cash on today's bills, plus ₹5,000 cash dues collected on last week's bill, plus one ₹3,000 bill (unpaid) cancelled today after creation today. daily-summary: totalBilling=20,000 (cancelled excluded), outstanding=0, refunds=0, cancelled=3,000, expenses=0 ⇒ netCollection=17,000, physicalCashInHand=₹17,000. Real drawer = ₹25,000. An ₹8,000 theft would look like an ₹8,000 "excess" narrative — nobody investigates money *above* expectation.
- Recommended correction: define netCollection purely on payment basis (`Σ positive payments − Σ refunds − expenses`) and cash-in-hand as `cashIn − cashRefunds − cashExpenses` (formula already proven in my-daily-summary.ts:428–430 and day-close.ts); remove the cancelled-total subtraction or add cancelled bills into the gross figure first.
- Backward compatible: yes — response fields keep names; values change (they were wrong).
- Data migration required: no (nothing persisted).

### [RPT-04] P1 — Owner dashboard classifies payment methods with a hard-coded SQL list, dropping gateway and insurance money from both cash and digital
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/advanced-dashboard.ts` lines 71–72 (per-staff) and 212–213 (overall)
- Current behavior: `digital_collection` = `LOWER(method) IN ('upi','card','online','bank','cheque','neft','rtgs')`; `cash_collection` = `LOWER(method) = 'cash'`. Production gateway methods are provider-qualified strings — `"Online (ICICI Orange Pay)"`, `"Online (Razorpay)"` etc. (documented at `lib/paymentMethodClassifier.ts:11-18`, which exists precisely because an earlier exact-match version of this bug misrouted gateway money) — and `insurance` is also absent from the list. Such payments are inside `total_received` but in neither split; `netCashHandled = cashCollection − cashExpenses` (line 179) and `physicalCashInHand` (line 244) inherit the gap.
- Why unsafe: the anti-fraud dashboard the owner uses to compare cashiers silently under-reports digital collections per staff; cash-vs-digital cross-checks against the drawer and the day close (which use the classifier) cannot tie out; the codebase has three classification regimes (classifier, this IN-list, sync-billing's own list at accounting.ts:1102).
- Failure scenario: Reception takes ₹15,000 via ICICI gateway QR (`method = "Online (ICICI Orange Pay)"`). daily-summary shows digitalCollection ₹15,000. Owner dashboard for the same day shows digital ₹0, totalReceived ₹15,000 — the owner concludes ₹15,000 was neither cash nor digital, suspects data tampering, or (worse) stops trusting the report that is actually right.
- Recommended correction: fetch rows and classify in JS with `classifyPaymentMethod` (as the sibling reports do), or generate the SQL predicate from the classifier's table; add an "unknown" column so suspense is visible here too.
- Backward compatible: yes.
- Data migration required: no.

### [RPT-05] P1 — Expense reporting has two contradictory date bases: backdatable `expense_date` vs immutable `created_at`
- Severity: P1
- Classification: Confirmed defect (documented rule violated by two surfaces)
- Location: `artifacts/api-server/src/routes/advanced-dashboard.ts` lines 104, 222 (`WHERE expense_date >= ${from}`); `artifacts/api-server/src/routes/expenses.ts` lines 41–42, 61–62 (list + category summary by `expenseDate`); versus `routes/daily-summary.ts` lines 85–90, `routes/day-close.ts` lines 207–209, `routes/my-daily-summary.ts` lines 298–308 (all `created_at`)
- Current behavior: the reconciliation spec quoted in code (*"expense_date is a free-text, backdatable display/accounting field… Reconciliation must key off created_at"*, daily-summary.ts:78–84) is enforced in three reports and ignored in two others. `expense_date` is free text compared lexically.
- Why unsafe: the owner dashboard's `totalExpenses` and the expense register can be silently rewritten for any past day by editing `expense_date` (PATCH `/expenses/:id` allows it — expenses.ts:128–149 — and DELETE hard-removes rows, lines 211–217, with no audit and no closed-day guard), while daily-summary/day-close keep the posting-date figure. Same day, two "official" expense totals; a backdated entry changes an already-reviewed dashboard.
- Failure scenario: 1 Jul closes with ₹0 expenses on all reports. On 16 Jul a staffer posts a ₹9,000 cash expense with `expense_date = 2026-07-01`. Owner dashboard and `/expenses/summary` for 1 Jul now show ₹9,000 (history rewritten); daily-summary/day-close for 16 Jul show ₹9,000 (drawer basis). Any tie-out between the two reports for either day fails, and the discrepancy points at the wrong day.
- Recommended correction: pick `created_at` as the reconciliation basis everywhere and expose `expense_date` only as a display column (or a separate "accounting view"); convert `expense_date` to a real `date` column; audit-log expense edits/deletes and block them for closed windows.
- Backward compatible: mostly — dashboard totals shift to posting basis; document the change.
- Data migration required: no for the filter change; column type migration optional.

### [RPT-06] P1 — Two parallel "daily summary" endpoints with different rules; the legacy one defaults to the UTC day and can crash on text account ids
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/reports.ts` lines 496–636 (`GET /reports/daily-summary`, `/reports/daily-summary/pdf`) vs `artifacts/api-server/src/routes/daily-summary.ts` (`GET /daily-summary`); both mounted (routes/index.ts:305, 735)
- Current behavior: the legacy endpoint (a) defaults `date` to `new Date().toISOString().split("T")[0]` — the UTC day (lines 499, 607) — despite `lib/istDate.ts:4-9` existing to prevent exactly this; (b) computes expenses from vouchers joined via `${vouchersTable.debitAccountId}::integer = ${accountsTable.id}` (line 514), a cast that throws for any non-numeric text id (voucher account ids are unvalidated free text at creation, accounting.ts:236–237), and filters only `a?.type === "expense"` (578–580); (c) nets refunds inside `totalReceived` (520) instead of splitting; (d) clamps `outstanding = max(0, totalBilled − totalReceived)` (521), mixing bases. The modern endpoint does all four differently.
- Why unsafe: two authoritative-looking "daily summary" screens/exports produce different totals for the same date; between 00:00–05:30 IST the legacy one silently shows *yesterday*; a single manually-created voucher with a non-numeric account id turns the legacy endpoint into a 500 for every day that voucher's date matches.
- Failure scenario: At 00:45 IST the admin prints the legacy daily-summary PDF (reports.ts:604–636) for handover — it renders yesterday's date and yesterday's bills. The morning shift compares it with `/daily-summary` for "today" and reports a full-day discrepancy to the owner.
- Recommended correction: delete or 301 the legacy endpoint to the modern one (keep the PDF as a renderer over the modern payload); at minimum change both default dates to `todayIST()` and guard the `::integer` cast with a `WHERE debit_account_id ~ '^[0-9]+$'`.
- Backward compatible: redirect preserves clients; totals change to correct values.
- Data migration required: no.

### [RPT-07] P1 — Revenue chart, income/expense and payment-methods reports aggregate on UTC days, disagreeing with every IST report for the 00:00–05:30 window
- Severity: P1
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/reports.ts` — `/revenue` lines 209–232 (`DATE(created_at AT TIME ZONE 'UTC')`), `resolveDateRange` lines 41–56 (UTC bounds `T00:00:00.000Z`), `/income-expense` line 353 (`p.createdAt.toISOString().split("T")[0]` day key), `/payment-methods` lines 448, 471–472 (UTC bounds; UTC date/time rendering)
- Current behavior: these endpoints define a "day" as the UTC day. Payments made 00:00–05:30 IST belong to the previous calendar day here, and to the correct IST day in `/daily-summary`, `/dashboard/advanced-summary`, `/day-close` labels and `/reports/dashboard` (which all use IST bounds — daily-summary.ts:15–20, advanced-dashboard.ts:21–26, reports.ts:93–99).
- Why unsafe: this is the required "concrete pair of endpoints that disagree for the same day": `/api/reports/revenue?period=daily` vs `/api/daily-summary?date=D` differ by exactly the 00:00–05:30 IST takings on both edges of every day. Hospitals with night emergency billing will see daily revenue charts that never reconcile with the daily cash summary; month buckets likewise shift for month-boundary nights (`DATE_TRUNC('month', … AT TIME ZONE 'UTC')`, line 218).
- Failure scenario: 16 Jul, 01:10 IST (15 Jul 19:40 UTC): ₹12,000 MRI paid via UPI. `/daily-summary?date=2026-07-16` shows ₹12,000. The revenue trend chart shows it on 15 Jul. Owner asks why "yesterday" spiked and "today" is short; finance spends a morning chasing a non-existent error. On 1 Apr 00:30 IST the same shift moves money across the *financial year* boundary in the chart.
- Recommended correction: replace `AT TIME ZONE 'UTC'` with `AT TIME ZONE 'Asia/Kolkata'` in the three group-bys; build `resolveDateRange` bounds with `+05:30` offsets (helper already exists in the same file — `istDayBounds`, lines 488–493); render row dates with `dateToISTString`.
- Backward compatible: yes — same shapes; buckets shift to correct days.
- Data migration required: no.

### [RPT-08] P2 — Historical daily reports are recomputed from mutable current state; cancellations are booked to the bill-creation day, silently rewriting closed history
- Severity: P2
- Classification: Architectural weakness
- Location: `artifacts/api-server/src/routes/daily-summary.ts` lines 50–71 (window on `bills.createdAt`), 102–103 (`status !== "cancelled"` evaluated on *current* status), 106 (`outstanding` from current `balanceAmount`), 322–333 (bill list with current paid/balance); contrast `routes/my-daily-summary.ts` lines 117–130 (cancellations windowed on `cancelledAt`)
- Current behavior: `/daily-summary?date=D` selects bills *created* on D and classifies them by their status/balance *now*. A bill cancelled, refunded, or paid weeks later changes D's `totalBilling`, `outstanding`, `cancelledBillsAmount`, `netCollection` retroactively; the cancellation never appears on the day it happened (my-daily-summary does the opposite and is right). Nothing snapshots the day (day_closures persists its own rolling-window numbers, but the daily-summary endpoints recompute live every call).
- Why unsafe: printed/e-mailed daily summaries stop matching the endpoint later; auditors diffing "the same report, same date, pulled twice" see different numbers with no tombstone explaining why; a cancellation performed after day close escapes that day's cancellation report entirely on the clinic-wide summary.
- Failure scenario: 10 Jul summary reviewed and filed: 42 bills, ₹1,80,000 billed, 0 cancelled. On 15 Jul a 10-Jul ₹15,000 bill is cancelled with cash refund. Re-pulling 10 Jul now shows ₹1,65,000 billed / 1 cancelled (history changed); 15 Jul's `/daily-summary` shows the refund but zero cancellations (creation-date basis); only my-daily-summary shows the canceller. Three reports, three stories.
- Recommended correction: window cancellation metrics on `cancelledAt` (pattern already in my-daily-summary.ts:126–130); report as-of-day-end movement (payments/refunds by their own timestamps) rather than current stored balances; optionally persist an immutable end-of-day snapshot row keyed by IST date.
- Backward compatible: yes for the basis switch (additive fields recommended first).
- Data migration required: no; snapshot table optional.

### [RPT-09] P2 — "Day close" is a rolling window, not a calendar day; its IST date label misattributes late/early closes
- Severity: P2
- Classification: Architectural weakness
- Location: `artifacts/api-server/src/routes/day-close.ts` lines 197–209 (`(from, to]` window from last closure to `now`), 393–421 (close uses `to = new Date()`; `closureDate` = IST label of `to`, line 410), 930–932 (same for user closes)
- Current behavior: the closure covers everything since the previous close (or all history if none, lines 199–201, comment 40–47). `closureDate` is just the IST date of the *moment of closing*. Nothing aligns windows to IST midnight; day-close is explicitly non-blocking (lines 1170–1248 "Billing is never blocked").
- Why unsafe: `day_closures` totals are structurally incomparable to any calendar-day report (daily-summary, dashboards, P&L): a close at 21:00 followed by one at 23:00 next day yields a 26-hour "day"; forgetting to close for a weekend produces one closure labelled Monday containing three days of money. A close performed at 00:20 IST labels the entire previous evening's cash with the next day's date.
- Failure scenario: Fri close skipped. Sat 20:00 close labelled `closureDate = Saturday` contains Fri+Sat takings ₹3,10,000. Owner compares with Saturday's daily-summary ₹1,60,000 → ₹1,50,000 "unexplained excess" panic; conversely a real Friday shortage is invisible inside the merged window.
- Recommended correction: keep the gapless rolling window (it is the safer reconciliation primitive) but store `coveredFromTs`/`coveredToTs` prominently in the UI (already persisted, lines 421–422), rename/derive the label from the *window*, and warn when a window spans more than one IST day; consider an auto-close reminder at IST midnight.
- Backward compatible: yes (labels/UI only).
- Data migration required: no.

### [RPT-10] P2 — Gateway payments are timestamped at webhook processing time; the gateway's transaction time is not stored, so settlement-date reconciliation is impossible
- Severity: P2
- Classification: Missing control
- Location: `artifacts/api-server/src/routes/gateway-webhooks.ts` `settleBill()` lines 122–129 (insert without `createdAt`); `lib/db/src/schema/bills.ts:56` (`createdAt … defaultNow()`); raw payload only in `payment_logs` JSON (gateway-webhooks.ts:161–168)
- Current behavior: a confirmed gateway payment becomes a `payments` row dated when the webhook was processed. ICICI is ACKed immediately (line 187) and processing is async; retries/late webhooks can land minutes-to-hours after the customer paid. No `payments` column carries the gateway transaction timestamp or settlement date.
- Why unsafe: all payment-basis reports place the money on the processing day, while the bank's MIS places it on the transaction/settlement day. Around midnight IST the two *always* differ. With no stored gateway timestamp, month-end bank reconciliation must parse raw JSON logs by hand.
- Failure scenario: Patient pays ₹8,000 at 23:57 IST; ICICI's webhook is delivered at 00:03 IST after a retry. ERP reports it on the 17th; the bank statement credits the 16th batch. The accountant marks the 16th short ₹8,000 and the 17th over ₹8,000 and writes both off as "gateway timing" — precisely the noise real fraud hides in (`reconciliation_logs` supports `autoClosed` write-offs per the schema audit).
- Recommended correction: persist gateway `txnDate`/RRN on the payment (new nullable column or structured `notes`), and give settlement-oriented reports a "gateway transaction date" basis; never overwrite `createdAt` (posting time is also needed).
- Backward compatible: yes (additive column).
- Data migration required: optional backfill from `payment_logs.request_payload` JSON.

### [RPT-11] P2 — Dashboard "referralPayouts" is actually the all-time gross order value of doctor-referred orders
- Severity: P2
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/reports.ts` lines 131–133 (query) and 176 (`referralPayouts` response field)
- Current behavior: `SELECT coalesce(sum(o.total_amount),0) FROM orders o WHERE o.doctor_id IS NOT NULL` — no date filter, no cancellation filter, no commission rule applied — returned under the name `referralPayouts` on the main dashboard.
- Why unsafe: management sees a "payouts" figure that is really lifetime referred revenue — typically 10–20× actual commission liability, growing monotonically forever. Decisions about referral programme cost, or cross-checks against the commission report, are meaningless; it also leaks gross revenue to any role with dashboard access.
- Failure scenario: After a year the dashboard shows "Referral payouts ₹2.3 Cr". The commission report (which applies rules and excludes cancelled tests) shows ₹9.4 L for the same period. The owner concludes one of the two systems has lost ₹2+ Cr and orders an investigation into the wrong number.
- Recommended correction: either compute it from the commission engine for a bounded period, or rename the field (`referredOrdersGrossAllTime`) and label the UI honestly; add date bounds.
- Backward compatible: renaming is a breaking change for the frontend consumer — coordinate; keeping the field with a corrected value is compatible.
- Data migration required: no.

### [RPT-12] P2 — The two doctor-referral engines disagree on cancelled tests and both use UTC day windows; the live code is loaded from an off-repo plugin
- Severity: P2
- Classification: Potential risk (quarantine copies verified; runtime plugin unverifiable from the repo)
- Location: `__super_admin_quarantine/backup_usb_isolation_restore_point/api-routes/commission.ts` lines 220–221 (`gte(orders.createdAt, new Date(from))`, `lte(…, new Date(to + "T23:59:59Z"))` — UTC bounds), 225 and 327 (`ne(orderTestsTable.status, "cancelled")`); `…/doctor-ledger.ts` lines 94–95 (same UTC bounds), 99 (order_tests fetched **with no cancelled filter**), 130 (`order.createdAt.toISOString().split("T")[0]` — UTC row dates)
- Current behavior: the commission payout report excludes cancelled test lines; the doctor-ledger report includes them, so it keeps accruing commission on cancelled work (the books-sanity "commission leak" check, books-sanity.ts:42–59, guards bills↔order_tests consistency but cannot fix doctor-ledger's missing filter). Both reports window on UTC days and print UTC dates, so referral cutoffs shift by 5.5 h versus every IST report.
- Why unsafe: doctors are paid from these reports. The two screens disagree for any doctor with cancellations; UTC windows move late-night referrals across payout months; and because the production code is dynamically imported from an uploaded plugin (repo copies are restore points), none of this is auditable from source control.
- Failure scenario: Dr. X refers a ₹20,000 CT on 30 Apr 23:40 IST (18:10 UTC — inside April in both bases) which is cancelled 2 May. May payout run: commission report pays ₹0 (cancelled excluded); doctor-ledger shows ₹2,000 owed. Whichever screen accounts uses, the other becomes "proof" of underpayment or overpayment.
- Recommended correction: single shared computation (one module, both endpoints); exclude cancelled tests everywhere (align with books-sanity's expectation); IST window bounds; bring the plugin source into the repo under change control.
- Backward compatible: yes (report outputs change to consistent values).
- Data migration required: no; historical payout re-verification advised.

### [RPT-13] P2 — "Popular tests" revenue includes cancelled bills/tests and has no date bounds
- Severity: P2
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/reports.ts` lines 246–272
- Current behavior: `revenue = coalesce(sum(order_tests.price),0)` grouped by test over **all rows ever** (lines 253–260) — no join to bills, no `status != 'cancelled'` on order_tests, no date filter. The sibling endpoint `category-test-summary` (daily-summary.ts:429–453) demonstrates the correct exclusions in the same codebase.
- Why unsafe: test-mix and pricing decisions (which tests earn, which machines to buy) are made on figures inflated by cancelled work and unbounded history; a test cancelled 100 times still ranks "popular".
- Failure scenario: A ₹25,000 MRI package is ordered and cancelled 40 times during a promo misconfiguration. Popular-tests reports ₹10,00,000 "revenue" for it forever after; management renews the promo.
- Recommended correction: copy the join/filters from `category-test-summary` (exclude cancelled bills by status+`cancelledAt`, exclude cancelled order_tests) and accept `from`/`to`.
- Backward compatible: yes.
- Data migration required: no.

### [RPT-14] P2 — Ranged trial balance and ledger ignore pre-range movement; opening balances are the static account field only; "balanced" flags are near-tautological
- Severity: P2
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/accounting.ts` — trial balance lines 452–456 (voucher filter `date >= from`), 472–481 (opening = `account.openingBalance` only), 500–503 (`balanced` compares sums of the same rows); ledger lines 385–400 (opening entry from static field; pre-`from` vouchers skipped); balance sheet lines 594, 615–654 (asOf ≤ filter is correct, but `balanced` at 654 after force-plugging netProfit at 645–649)
- Current behavior: with `from` set, all vouchers before `from` simply vanish — they are not rolled into an opening balance. A ledger for July shows "Opening Balance" = the account's *original* opening, not the 30-June closing.
- Why unsafe: any month/quarter trial balance or ledger statement handed to the CA misstates every account that had prior activity; because both sides lose symmetrically, the `balanced: true` flag still prints, lending false assurance. FY reporting (Apr–Mar) is impossible to cut correctly.
- Failure scenario: Cash account: opening ₹0, June receipts ₹5,00,000. July ledger printed with `from=2026-07-01` shows opening ₹0 and July receipts only; the physical cash box audit against the ledger "closing balance" is off by ₹5,00,000 and the report still says balanced.
- Recommended correction: compute opening per account as `static opening ± Σ vouchers with date < from` (one extra aggregate query); surface `balanced` only when opening handling is exact; consider persisting period-close balances.
- Backward compatible: yes.
- Data migration required: no.

### [RPT-15] P2 — No report reconciles payments against posted vouchers; fire-and-forget posting means the P&L can silently understate revenue
- Severity: P2
- Classification: Missing control
- Location: `artifacts/api-server/src/lib/auto-voucher.ts` lines 181–183 and 244–246 (`catch → logger.warn`, never surfaced); `artifacts/api-server/src/routes/books-sanity.ts` lines 33–197 (entire anomaly battery — queries bills/payments/order_tests/bill_audits, **never** `vouchers`)
- Current behavior: every voucher posting from billing/expenses is `.catch(() => {})` fire-and-forget (e.g. expenses.ts:115–122; bills.ts:1080–1088). If posting fails (DB hiccup, unique-number collision after 3 retries — auto-voucher.ts:158–180), the payment stands and the ledger permanently lacks the entry. No endpoint, including the CA-oriented books-sanity report, compares `Σ payments` to `Σ receipt vouchers`.
- Why unsafe: the accounting reports (trial balance/P&L/Tally export) drift below the operational reports by the sum of all failed postings, invisibly and cumulatively; the drift is only discoverable by manual SQL. Combined with RPT-02, the ledger can be both under- and over-stated with no detector for either.
- Failure scenario: A 90-second DB failover during a busy Saturday drops 14 payment vouchers (₹78,000). Every collection report is right; the month's P&L is ₹78,000 short; GST/income-tax workings prepared from Tally understate turnover. Nothing ever flags it.
- Recommended correction: add a books-sanity check "payments without matching voucher (by billId+amount±sign) and vouchers without payments"; expose a retry/backfill that uses correct dedupe (fixing RPT-02 first).
- Backward compatible: yes (additive check).
- Data migration required: no; a one-time reconciliation run is advised.

### [RPT-16] P3 — books-sanity date window is UTC (`::date` casts) unlike the IST-bounds reports it is meant to cross-check
- Severity: P3
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/books-sanity.ts` lines 35–37 (`b.created_at >= ${fromRaw}::date AND b.created_at < (${toRaw}::date + INTERVAL '1 day')`), 155–156 (same for bill_audits)
- Current behavior: `'2026-07-01'::date` compared to `timestamptz` is evaluated at the DB session timezone (UTC, since compose sets no TZ — docker-compose.yml, whole file) — the window runs 05:30 IST to 05:30 IST.
- Why unsafe: the CA's anomaly counts and `periodTotals` (lines 172–186) cover a different population than the daily/monthly IST reports for the same nominal range; night-window bills are attributed to the neighbouring day.
- Failure scenario: CA pulls books-sanity for June and compares `total_sum` with the June sum of daily-summaries; they differ by the 00:00–05:30 IST bills on 1 Jun and 1 Jul; hours are spent explaining a pure timezone artefact.
- Recommended correction: build bounds as `(${fromRaw} || 'T00:00:00+05:30')::timestamptz` (pattern used everywhere else) or `AT TIME ZONE 'Asia/Kolkata'`.
- Backward compatible: yes.
- Data migration required: no.

### [RPT-17] P3 — Voucher/expense number-series month buckets use the UTC clock while the documents themselves are dated in IST
- Severity: P3
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/lib/auto-voucher.ts` lines 93–99 (`voucherBucketPrefix` uses `new Date().getFullYear()/getMonth()` — server-local = UTC) versus lines 111–113, 164, 227 (voucher `date` = IST); `artifacts/api-server/src/routes/expenses.ts` lines 30–32 (`EXP-<yymm>` from UTC clock)
- Current behavior: between 00:00 and 05:30 IST on the 1st of a month, vouchers are dated the new month (IST) but numbered in the old month's series (UTC), e.g. `date = 2026-07-01` with number `RV-202606-0187`; expense ids likewise.
- Why unsafe: monthly voucher series stop being contiguous per calendar month; count-based numbering (lines 101–109) then counts the wrong bucket; auditors matching number series to months see gaps/overlaps; Tally imports keyed by series look inconsistent.
- Failure scenario: 1 Aug 00:20 IST cash payment → voucher `RV-202607-0412` dated 2026-08-01. July's series now contains an August-dated voucher; a numbering audit flags it as backdating.
- Recommended correction: derive the bucket from the same IST date string used for `date` (`istDateStr().slice(0,7)`), and same for `EXP-` ids.
- Backward compatible: yes.
- Data migration required: no.

### [RPT-18] P3 — No financial-year concept anywhere: no FY voucher series, no year-end close, no Apr-1 boundary handling
- Severity: P3
- Classification: Missing control | Requires CA/GST-professional validation
- Location: absence verified across `artifacts/api-server/src/routes/accounting.ts` (read 367–1130; exports accept arbitrary `from`/`to` at 660–666 with no FY defaults) and `lib/auto-voucher.ts` (monthly buckets only, 93–99); repo-wide grep for fiscal/financial-year handling found none in the API server
- Current behavior: vouchers number monthly forever; P&L/trial balance are arbitrary-range; there is no year-end profit transfer, no locked prior-FY, no Apr-1 opening roll (compounding RPT-14).
- Why unsafe: Indian statutory books run Apr–Mar. Without an FY close, "net profit for the period" is whatever range the operator typed; prior-FY vouchers remain editable/deletable (voucher PATCH/DELETE exist per the engine audit) after filing; the Tally export can silently mix FYs.
- Failure scenario: In May 2027, a staffer edits a March 2027 voucher (permitted); the already-filed FY26-27 P&L no longer matches a re-export; there is no closed-period control to even detect it.
- Recommended correction: introduce an FY entity (Apr-1 start), FY-scoped voucher series, a period-lock table enforced in voucher create/update/delete, and FY-default ranges on statements. Requires CA sign-off on the closing methodology.
- Backward compatible: additive.
- Data migration required: yes — assign existing vouchers to FYs (derivable from `date`).

### [RPT-19] P2 — Cashier-wise money attribution rests on free-text names; the legacy report even uses payment reference numbers as "users"
- Severity: P2
- Classification: Architectural weakness
- Location: `lib/db/src/schema/bills.ts` lines 23 (`createdByName: text`), 55 (`recordedByName: text`) — no user FK; `artifacts/api-server/src/routes/reports.ts` line 412 (`(p.recordedByName…) || (p.referenceNumber && p.referenceNumber.trim()) || "Unknown User"`); name-string matching throughout day-close (`eq(paymentsTable.recordedByName, userName)`, day-close.ts:646) and my-daily-summary (staff filter by name, lines 108, 149)
- Current behavior: every cashier-wise, staff-comparison and drawer report keys on the free-text name captured at write time. The legacy income-expense report falls back to the payment's *reference number* as the user bucket, so a UPI RRN can appear as a staff member holding money.
- Why unsafe: renaming a user (users.name) splits their history into two rows and detaches their closures/windows (`userWindowBoundary` matches by name, day-close.ts:597–614); two staff with the same display name are merged; a typo'd name silently creates an unaccountable bucket. Accountability reports that feed variance approvals should not be joinable-by-string.
- Failure scenario: "Priya S" is renamed "Priya Sharma". Her next `my-close` window boundary lookup finds no prior close under the new name and re-covers all history her old name already closed — or, with RPT-01, none of it; the staff-status board shows two Priyas, one permanently "open".
- Recommended correction: store `recorded_by_user_id`/`created_by_user_id` FKs alongside the display names (names kept for print); key all aggregations and closure boundaries on the id; remove the referenceNumber fallback at reports.ts:412 outright.
- Backward compatible: additive columns; reports switch key once backfilled.
- Data migration required: yes — backfill user ids by matching current names, flag ambiguous rows.

### [RPT-20] P3 — Refund rows are counted as payment transactions in the payment-methods report; "revenue" is net in some reports and gross in others
- Severity: P3
- Classification: Confirmed defect
- Location: `artifacts/api-server/src/routes/reports.ts` lines 451–461 (`byMethod[method].count++` and `total += Number(amount)` for every row including negatives; `percentage` from those totals), 122 (`/dashboard` todayRevenue = net `SUM(amount)`); contrast `routes/daily-summary.ts` lines 47–48 (positive/negative split) and `routes/advanced-dashboard.ts` line 70 (`FILTER (WHERE amount > 0)` gross)
- Current behavior: `/reports/payment-methods` mixes refunds into method totals, counts and percentages, and its transaction list shows negative rows as payments dated/timed in UTC (lines 471–472). Meanwhile the same quantity ("received today") is net on `/reports/dashboard`, gross on advanced-dashboard and daily-summary.
- Why unsafe: a method with heavy refunds shows a deflated share; counts overstate transaction volume; and three dashboards give three different "today's collection" figures on any day with refunds, eroding trust in all of them.
- Failure scenario: Day: ₹50,000 UPI in, ₹10,000 UPI refunded, ₹40,000 cash in. payment-methods: UPI ₹40,000/cash ₹40,000 (50/50, refund invisible); dashboard todayRevenue ₹80,000; daily-summary totalReceived ₹90,000 with refunds ₹10,000 listed. Owner asks which is right; all are, under three unstated definitions.
- Recommended correction: split refunds into their own bucket in payment-methods (pattern at daily-summary.ts:198–202); standardize and label gross vs net across dashboards.
- Backward compatible: additive fields preferred.
- Data migration required: no.

---

## 8. Explicitly not verified in this run

- The **live plugin code** for commission/doctor-ledger (only the quarantine restore-point copies were readable; RPT-12 is scoped accordingly).
- The **frontend rendering** of these endpoints (labels, rounding) — API payloads only.
- Actual production data effects (no DB access): all findings are code-level; RPT-02's blast radius depends on whether sync-billing has ever been invoked in production.
- `lib/closureBoundary.ts` internals (delegated helper; the call sites' semantics were verified in day-close.ts/bills.ts).

## 9. Findings register

| ID | Severity | Classification | Title | Location |
|---|---|---|---|---|
| RPT-01 | P0 | Confirmed defect | Per-user drawer close subtracts cash expenses twice | api-server/src/routes/day-close.ts:671-675 |
| RPT-02 | P1 | Confirmed defect | sync-billing double-posts already-vouchered payments; UTC-dated copies, divergent accounts | api-server/src/routes/accounting.ts:1077-1130 |
| RPT-03 | P1 | Confirmed defect | netCollection/physicalCashInHand double-subtract cancellations, mix bases, drop old-dues cash | routes/daily-summary.ts:136-137; routes/advanced-dashboard.ts:242-244 |
| RPT-04 | P1 | Confirmed defect | Owner dashboard hard-coded method IN-list drops gateway/insurance money from cash+digital splits | routes/advanced-dashboard.ts:71-72,212-213 |
| RPT-05 | P1 | Confirmed defect | Expense reports keyed on backdatable expense_date vs created_at reconciliation basis | routes/advanced-dashboard.ts:104,222; routes/expenses.ts:41-42,61-62 |
| RPT-06 | P1 | Confirmed defect | Duplicate daily-summary endpoints; legacy defaults to UTC day and can 500 on text account ids | routes/reports.ts:496-636 (499,514,607) |
| RPT-07 | P1 | Confirmed defect | /revenue, /income-expense, /payment-methods aggregate on UTC days vs IST reports | routes/reports.ts:41-56,210-218,353,448,471-472 |
| RPT-08 | P2 | Architectural weakness | Historical daily reports recomputed from mutable state; cancellations booked to creation day | routes/daily-summary.ts:50,102-106; routes/my-daily-summary.ts:126-130 |
| RPT-09 | P2 | Architectural weakness | Day close is a rolling window with a point-in-time IST label, incomparable to calendar-day reports | routes/day-close.ts:197-209,410 |
| RPT-10 | P2 | Missing control | Gateway payments dated at webhook processing time; gateway txn timestamp not stored | routes/gateway-webhooks.ts:122-129; lib/db/src/schema/bills.ts:56 |
| RPT-11 | P2 | Confirmed defect | Dashboard "referralPayouts" = all-time gross referred order value | routes/reports.ts:131-133,176 |
| RPT-12 | P2 | Potential risk | Two commission engines disagree on cancelled tests; UTC windows; live code off-repo | quarantine commission.ts:220-225,327; doctor-ledger.ts:94-99,130 |
| RPT-13 | P2 | Confirmed defect | Popular-tests revenue includes cancelled bills/tests, no date bounds | routes/reports.ts:246-272 |
| RPT-14 | P2 | Confirmed defect | Ranged trial balance/ledger ignore pre-range movement; tautological balanced flags | routes/accounting.ts:452-456,472-481,500-503,385-400 |
| RPT-15 | P2 | Missing control | No payments↔vouchers reconciliation; fire-and-forget posting silently understates P&L | lib/auto-voucher.ts:181-183,244-246; routes/books-sanity.ts:33-197 |
| RPT-16 | P3 | Confirmed defect | books-sanity window is UTC ::date casts, shifted 5.5h from IST reports | routes/books-sanity.ts:35-37,155-156 |
| RPT-17 | P3 | Confirmed defect | Voucher/expense number series bucketed by UTC clock while documents dated IST | lib/auto-voucher.ts:93-99 vs 111-113; routes/expenses.ts:30-32 |
| RPT-18 | P3 | Missing control / Requires CA validation | No financial-year concept: no FY series, year-end close, or Apr-1 boundary | routes/accounting.ts:660-666; lib/auto-voucher.ts:93-109 (absence) |
| RPT-19 | P2 | Architectural weakness | Cashier attribution by free-text names; reference numbers can become "users" | lib/db/src/schema/bills.ts:23,55; routes/reports.ts:412; routes/day-close.ts:597-614 |
| RPT-20 | P3 | Confirmed defect | Refund rows counted as payments in payment-methods; gross-vs-net "revenue" inconsistent across dashboards | routes/reports.ts:122,451-461 |
