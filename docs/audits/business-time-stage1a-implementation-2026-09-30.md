# CARE business-time integrity — Stage 1A implementation: trusted CARE time primitives and server-authoritative default business date

**Date:** 2026-09-30 (IST)
**Branch:** `fix/erp-trusted-care-business-date`
**Base SHA:** `27dab0549df902e9da66b459309364288f76b8db` (`origin/main`, = Stage-0 PR #784 merge)
**Stage:** 1A of 6 — *time authority and defaults only.* Stage 1A is **not** the backdating policy.
**Predecessors:** audit [`business-time-timezone-integrity-audit-2026-09-30.md`](./business-time-timezone-integrity-audit-2026-09-30.md) · plan [`business-time-integrity-remediation-plan-2026-09-30.md`](./business-time-integrity-remediation-plan-2026-09-30.md) · Stage 0 [`business-time-stage0-runtime-verification-2026-09-30.md`](./business-time-stage0-runtime-verification-2026-09-30.md)

---

## 1. What Stage 1A answers, and what it refuses to answer

One sentence: **CARE now has one named authority for "what day is it for the clinic", blank new forms default to that authority instead of to the workstation clock, and nothing else changed.**

Refused, by the Stage-1A scope rule (§3 of the brief) and because the decisions are still management's:

| Not in Stage 1A | Where it belongs |
|---|---|
| Allowed-backdating window, day counts, same-month or period restrictions | Stage 3, gated on **D-2** (still deferred) |
| Reason-required and approval workflows, two-person approval, superadmin approval | Stage 3, gated on **D-2/D-3** |
| Rejection of historical dates | none — Stage 1A must not create it (§9) |
| `time_integrity_cutover_at`, cutover enforcement | Stage 1B/2, gated on **D-13** |
| Audit-table triggers, `REVOKE`, DB role separation | Stage 2, gated on **D-8** |
| Day-close redesign, post-close policy change | Stage 4 |
| Payroll/HR date controls | **D-11**, later |
| Schema migration of any kind | none needed; §20 stop-condition not triggered |
| PostgreSQL timezone change, `SET timezone`, Docker `TZ` edit | **D-6**, deliberately untouched (§11) |

## 2. Architecture — before and after

### BEFORE (measured at base `27dab054`)

- **Ten-plus implementations named a clinic day.** `artifacts/api-server/src/lib/istDate.ts` held `todayIST()` (correct, injectable, exported), `dateToISTString()`, `istHourMinute()` — and `nowIST()`, which round-tripped an `en-CA` locale string through `new Date(...)` and returned **`Invalid Date`**, with zero callers.
- Private duplicates existed alongside it: `auto-voucher.ts:193 istDateStr()`, `documentNumberCounters.ts:147 istYearMonth()`, `emergencyReconcileHelpers.ts:14 clinicDayBoundsIst()` **and a second, differently-signatured `clinicDayBoundsIst()`** in `lib/emergency-billing/src/syncSummary.ts:63`, `ai/studyAgeWindow.ts:60 endOfIstDay()`, six inline copies in `my-daily-summary.ts`, three inline `Intl` label builders in `day-close.ts` alongside its own `todayIST()` import.
- **No server→client "today" contract existed.** The only shared server→client mechanism was feature flags (`GET /api/feature-flags` hydrated once by `hooks/useServerFeatureFlags.ts` from `components/Layout.tsx:498`).
- **Blank new forms filled a CARE business date from the browser clock through a UTC lens**: `new Date().toISOString().slice(0, 10)` / `.split("T")[0]` — 72 non-test occurrences in the client. Between **00:00 and 05:29:59.999 IST** that string is the *previous* clinic day, so an untouched "New expense", "New voucher" or Form F entry defaulted to yesterday. No validation, no reason, no audit row distinguished it from deliberate backdating.
- The service worker cached GET responses in `erp-api-v2` for up to 24 h.

### AFTER

```
Postgres now()  ──► created_at / updated_at instants        (TRUSTED ACTION INSTANT — unchanged)
                        │
Node clock (API pod)  ──► lib/istDate.ts                    (THE ONLY place a CARE calendar day is named)
                            clinicDateOf(instant)   ─┐
                            todayIST(instant)  ──────┤ same function, one meaning
                            clinicDayBoundsIST(…)  ──┘ 00:00:00.000–23:59:59.999 IST as UTC instants
                        │
                        └─► GET /api/time/now  (requireStaffAuth, read-only, no DB, accepts no input)
                                { zone, clinicDateIst, serverNowIso,
                                  businessDayStartUtcIso, businessDayEndUtcIso, source }
                        │
                        └─► client lib/careTime.ts  (memory-only holder, never computes a day)
                                hooks/useCareTime.ts   → mounted once in Layout, re-fetch at rollover
                                useClinicDateIst()     → value | null
                        │
                        └─► blank NEW forms seed expenseDate / paymentDate / vouchers.date /
                            form_f.date+procedure_date / follow-up studyDate from that value.
                            null ⇒ field is blank. There is no browser-clock path to a CARE date.
```

The **display** layer and **query filters** still use the browser clock (that is legitimate and unchanged); the **external event** clock (DICOM `StudyDate`, modality, kiosk) still lands in its own columns and is still never converted into a CARE audit timestamp (§4.C/D below).

## 3. Canonical time definitions

`artifacts/api-server/src/lib/istDate.ts` is the single surface. Its header now states the four roles explicitly:

| Concept | Function | Contract |
|---|---|---|
| **A · Trusted action instant** — "when did CARE receive/perform this?" | Postgres `DEFAULT now()` for stored rows; Node `new Date()` at request time for derived values | UTC on the wire is **correct**; an instant has no timezone, only a calendar mapping does. Stage 1A changed nothing here (§13). |
| **B · CARE business date** — `YYYY-MM-DD` | `clinicDateOf(instant?)` (and its historical alias `todayIST`) | Derived in **`Asia/Kolkata`** via `toLocaleDateString("en-CA", { timeZone })`, so the answer is independent of `process.env.TZ`. |
| **C · CARE business day** — 00:00:00.000 → 23:59:59.999 IST | `clinicDayBoundsIST(instant?)` → `{ clinicDate, startUtc, endUtc }` | `endUtc` is **inclusive** (`+24h − 1ms`), which is the arithmetic a `lte` filter needs; IST has no DST, so the fixed `+05:30` anchor is exact. Returned as UTC instants so it can meet a `timestamptz` column without depending on the session timezone (Stage 0 U-1: it is UTC). |
| **D · Display time** | page-level formatters (`en-IN`, `en-GB`) | Formatting, never authority. Left alone. |
| **E · External event time** | DICOM `StudyDate`, modality/kiosk/agent instants | Must remain identifiable as external. Never silently converted into a CARE timestamp. Stage 1A neither reads nor rewrites these. |

`nowIST()` was **deleted rather than repaired**: it had zero callers, "the current instant in IST" is a category error, and leaving a plausible-looking wrong helper in `lib/` invites the wrong primitive back. The reason stays as a comment in the file, and the Stage-0 characterization test that pinned its brokenness was converted to record the transition (§10.3).

**No new competing helper was introduced.** `auto-voucher.ts`'s private `istDateStr()`, the duplicated `clinicDayBoundsIst()` pair across `api-server` and `lib/emergency-billing`, the six inline copies in `my-daily-summary.ts` and the inline `Intl` label builders in `day-close.ts` are **left as they are** — all four already produce the correct clinic day (they use an explicit `timeZone:`), so consolidating them is a cosmetic refactor that would put 12 money-path files in a "defaults" PR. They are listed as debt in §8.

## 4. Server API contract

**`GET /api/time/now`** — `artifacts/api-server/src/routes/careTime.ts` (transport) + `artifacts/api-server/src/lib/careTimeContract.ts` (the shape; in `lib/` so the midnight behaviour is unit-testable without importing a router and thereby opening a pool). Mounted in `routes/index.ts` as `router.use("/time", careTimeRouter)`; `requireStaffAuth` is applied inside the router, matching `featureFlags.ts`.

```json
{
  "zone": "Asia/Kolkata",
  "clinicDateIst": "2026-09-30",
  "serverNowIso": "2026-09-29T23:59:00.000Z",
  "businessDayStartUtcIso": "2026-09-29T18:30:00.000Z",
  "businessDayEndUtcIso": "2026-09-30T18:29:59.999Z",
  "source": "care-api-node-clock"
}
```

Design rules, each enforced by a test:

- **Accepts no input.** No `?date=`, no body, no header. `_req` is unused. A client cannot ask CARE to confirm a date it invented (§24). (Note: `requireStaffAuth` also honours a legacy `?staffToken=` fallback for authentication — that is a credential, not a date, and no query parameter can influence the answer.)
- **The handler performs no database work.** A clinic calendar day does not need one and this is called from the app shell on every login. Session validation in `requireStaffAuth` is TTL-cached exactly as it is for every other authenticated route — Stage 1A adds no DB round-trip of its own. `source` therefore names the Node clock honestly rather than implying Postgres answered. The two-clock cross-check (`time_received` Postgres vs `time_processed` Node) is **Stage 1B** and needs columns, so it is not here (§20 stop-condition respected).
- **No infrastructure disclosure.** Exactly six keys: no host name, no NTP source, no `SHOW timezone`, no DB settings. The clock-health requirement (§7) is satisfied by `serverNowIso` + `zone` + `clinicDateIst` + the day bounds; the fuller `/api/health/clock` probe stays in the plan's drift stage.
- **Read-only.** No `POST`/`PUT`/`PATCH`/`DELETE` on the router.

### 4.1 Endpoints considered and rejected (§6 "prefer extending an existing one")

| Candidate | Verdict |
|---|---|
| `GET /api/feature-flags` (`requireStaffAuth`, already hydrated once per app shell) | Rejected: it returns a **bare array** of flag rows, and `hooks/useServerFeatureFlags.ts:31` branch-tests `Array.isArray` — wrapping it to carry a date is a breaking shape change to the most-called endpoint in production (its own comment records 76 % of all requests and a Redis cache). |
| `GET /api/staff/me` | **Does not exist.** It is listed in `lib/fetchApi.ts`'s session-expiry allowlist but no server route defines it, so there is no staff "me" bootstrap to extend. (Worth fixing on its own merits; out of Stage 1A scope.) |
| `GET /api/health/version` | Rejected: deliberately unauthenticated, so a business date there would be readable without a staff session and would mix release identity with clinical time authority. |
| `GET /api/staff/dashboard/today` | Exists and already returns `todayIST()`, but it scans `staffTable` + `staffAttendanceTable` to answer — the wrong cost for a value every form needs, and semantically it is an attendance endpoint. |
| A per-form `fetch` | Rejected outright by §6: one authoritative value through one shared mechanism. |

The dedicated `GET /api/time/now` is also the path the merged remediation plan already names for this purpose, which keeps the plan and the code pointing at the same contract.

## 5. Client mechanism

`artifacts/diagnostic-erp/src/lib/careTime.ts` — a memory-only holder:

- `getClinicDateIst(): string | null` — **`null` means "the authority has not answered"**, and callers must leave the field blank. There is no browser fallback anywhere in the module.
- Never computes a day: no `toLocaleDateString`, no `toISOString().slice`, no `getDate()`. The only client-side date arithmetic is `Date.parse(businessDayEndUtcIso)` to *schedule a timer* — a timer, not an authority.
- Never persisted: no `localStorage`, `sessionStorage`, IndexedDB or Cache Storage. A stored clinic date would silently survive into the next day, which is the exact defect this removes.
- `refreshCareTime({ getImpl })` deduplicates concurrent calls, goes through `api.get` (this app has no cookie-session fallback, so a bare `fetch` would 401), and fails soft to `null`.
- `setCareTime` dispatches `careTimeChanged` **only when the clinic date itself changed** — a routine re-fetch causes no re-render. (The feature-flag hydrator shipped an unconditional dispatch and created a self-sustaining poll that starved Save & Print; this module does not repeat it.)

`hooks/useCareTime.ts` — mounted **once** in `components/Layout.tsx`, beside `useServerFeatureFlags()`:

- fetches on mount;
- re-fetches on browser `online` and on tab visibility returning;
- schedules **one** re-fetch just after `businessDayEndUtcIso` (+2 s grace), clamped to `[30 s, 24 h]` so a wrong workstation clock can neither spin the loop nor let a stale day outlive the day;
- never listens to its own change event.

Forms read the value synchronously (`getClinicDateIst()`) or subscribe (`useClinicDateIst()`); **no page or component fetches `/api/time/now` itself** (guarded by test). React Query's global `staleTime` is 5 minutes, which is why the explicit rollover timer exists rather than relying on a component happening to remount at midnight.

`public/sw.js` — `/api/time/now` added to `NETWORK_ONLY_PREFIXES`, immediately after the "status must never be stale" group. A cached authoritative date would be worse than no date.

## 6. Forms changed — before and after, per site

Criterion for inclusion (Stage-1A §8 + §12): the site seeds a **blank new record** whose date is **persisted as a CARE business date**. Sites that filter, format, name a file, or do calendar arithmetic on an already-known date are untouched and listed in §8.

| # | File:line | Field | BEFORE | AFTER | Behavioural difference |
|---|---|---|---|---|---|
| 1 | `pages/Expenses.tsx:175,184-185` | `expenseDate`, `paymentDate` | `new Date().toISOString().slice(0,10)` | `clinicDateIst ?? ""` from `useClinicDateIst()` | New expense defaults to the clinic day; blank if the authority is unavailable; an effect fills a still-blank pair if the value arrives after the dialog opened, and never touches a typed or OCR-derived date |
| 2 | `pages/Expenses.tsx` (2 reset sites) | same | `emptyExpenseForm()` | `emptyExpenseForm(clinicDateIst)` | signature carries the authority explicitly instead of reading a clock at call time |
| 3 | `pages/Accounting.tsx:507` | `vouchers.date` (new-voucher dialog) | `new Date().toISOString().split("T")[0]` | `getClinicDateIst() ?? ""` | New voucher's GL effective date is the clinic day |
| 4 | `pages/Accounting.tsx:1330` | `vouchers.date` (field default) | `defaultValue={new Date()…}` | `defaultValue={getClinicDateIst() ?? ""}` | same, at the second seed path |
| 5 | `pages/FormF.tsx:160` (`today()` → `:273,278`) | `form_f.date`, `procedure_date` | `new Date().toISOString().slice(0,10)` | `getClinicDateIst() ?? ""` | Blank Form F entry defaults to the clinic day; `consentDate`/`mtpDate` still default to `""` (transcribed from paper — §16) |
| 6-7 | `components/expenses/ExpenseDetailDrawer.tsx:100,133` | `paymentDate` of a **new** payment | browser slice | `getClinicDateIst() ?? ""` | New payout defaults to the clinic day; existing payments' stored dates are read from the API and untouched |
| 8 | `components/BillReceiptScannerPanel.tsx:203` | `expenseDate` of a scanned bill | `draft.date \|\| browser slice` | `draft.date \|\| getClinicDateIst()`, and **refuses to post** when neither exists | The bill's own printed date still wins. With no scanned date and no authority, no expense is created with an invented or empty date; the operator gets a message and uses the expense form (§15) |
| 9 | `components/radiology/PcpndtFormFFinalizeStep.tsx:37` | `procedureDate` at finalize | browser slice | `getClinicDateIst() ?? ""` | PCPNDT finalize default; `prefill.procedureDate` (a stored/derived value) still wins |
| 10 | `components/radiology/workspace/WorkspaceOverlays.tsx:783` | prefill `procedureDate` | browser slice | `getClinicDateIst() ?? ""` | feeds site 9 |
| 11 | `components/TumorFollowupPanel.tsx:81` | `studyDate` of a new follow-up row | browser slice | `getClinicDateIst() ?? ""` | same default class |

Ten code sites, eight files, all of them *default seeds*. No field became read-only, no `min`/`max` was added, no date was rejected, no validation was introduced, and no route's accept/reject behaviour changed.

**Unchanged on purpose:** `pages/Staff.tsx` (payroll — §3), `pages/HRForms.tsx` (employment records), every date-range filter, every `downloadCsv` filename, `pages/Dashboard.tsx`'s and `pages/DailySummary.tsx`'s local "today" helpers (view windows, §8), `lib/offlineBillingQueue.ts` (it sends **no** date at all, which Stage 0 called the good pattern — still asserted).

## 7. Offline and server-unavailable behaviour (§15)

Chosen least-disruptive-safe behaviour, all of it fail-visible rather than fail-invented:

| Situation | Behaviour |
|---|---|
| Authority loaded (the normal case) | blank form is pre-filled with `clinicDateIst` |
| **Not yet loaded** (first moments after login, request in flight) | the date field is **blank**; if the value arrives while the form is open and the field is still empty, it fills it (Expenses) — a typed value is never overwritten |
| **Server unreachable / offline / malformed answer** | `getClinicDateIst()` returns `null` → the date field is blank and required, so saving without a date is the operator's visible choice, not a silent one |
| **401 (expired or invalid staff session)** | also `null`, and safely so: `/api/time/now` is **not** in `lib/fetchApi.ts`'s `SESSION_AUTH_PATHS`, so a 401 there neither clears the session nor redirects to the portal — it just leaves the field blank |
| Scanned-bill quick-save with no authority **and** no date on the bill | the save is **refused** with a message; nothing is posted with an invented or empty `expenseDate` |
| Service worker | `/api/time/now` is network-only, so a cached yesterday can never be served as today |
| Existing records | unaffected — viewing and editing follow exactly today's permissions and show the stored value |
| Offline queue | unaffected — queued bills already send no date and take the server clock on replay |

What Stage 1A **did not** do: it did not add a retry subsystem, an offline banner, a cached last-known-date fallback, or a hard block on the whole page. A blank required field is the entire failure surface. This is deliberate (§15: do not invent a major offline subsystem).

## 8. Remaining debt, explicitly not fixed

### 8.1 Naked `::date` — all 14 sites classified (§12)

Measured at base: server session `TimeZone = UTC` (Stage 0 U-1), so every one of these resolves an operator's clinic-day string as a **UTC** day.

| Site | Class | Meaning today | Touched by Stage 1A? |
|---|---|---|---|
| `routes/bills.ts:554-555` | **A** CARE business-day semantics | bills "from/to a day" filters the UTC day | no |
| `routes/books-sanity.ts:36,177` | **A** | orders/payments day window | no |
| `routes/books-sanity.ts:155-156` | **A** | `bill_audits` day window | no |
| `routes/reconciliation.ts:302-303,317-318,355-356` | **A** | reconciliation day buckets | no |
| `routes/radiology.ts:1646` | **A**, and **D** in part | `DATE(created_at)` (UTC) compared to `todayISO()` which already returns the **IST** day → silently wrong counts 00:00–05:29 IST (Stage 0 S0-8) | no |
| `lib/expenseV2Service.ts:249` | **A** + dirty-data hazard | duplicate-detection casts stored **text** `expense_date` to `date`; `''::date` and `'30/09/2026'::date` **error** (measured) → the 500 path in Stage 0 S0-1 | no |

No site is **B** (a genuine UTC-calendar intent) and none is **C** (external/device date): every one of them *means* the clinic day and *resolves* in UTC. That uniformity is the useful result of the classification — it means the eventual fix is one idiom (`(col AT TIME ZONE 'Asia/Kolkata')::date`) applied 14 times, or a clinic-date column, which is the **D-6** decision.

Why none was touched: Stage 1A's contract is about **who supplies a default**, and none of these 14 read paths participates in that mechanism. Changing a 14-report read semantics in a defaults PR would move published numbers — exactly what D-6 is still open to decide. Left unchanged, the contract is not internally contradictory: the server names one clinic day, and these reads are a known, measured deviation from it.

### 8.2 Remaining browser-clock `toISOString()` day-slice sites

Client, non-test, comment-excluded: **72 → 62** occurrences (10 fixed, listed in §6). The 62 remaining, classified (§22):

| Class | Count | Where |
|---|---|---|
| **SAFE UI USE — download/report filename** | 10 | `Tests`, `Doctors`, `Inventory` ×2, `Packages`, `Patients`, `Settings`, `TeachingResearchMode`, `AiPromptManager`, `RadiologyOperationsDashboard`, `RadiologySettingsCenter` |
| **SAFE UI USE — query-window / date-range default** (view only; can name the wrong day 00:00–05:29 IST, which is Category C, not a record) | ~34 | `Reports` ×5, `Dues` ×5, `Billing` ×4, `Samples` ×3, `DayClose` ×2, `Discounts` ×2, `AiQualityScores` ×2, `AiPromptEffectiveness` ×2, `Roster` ×2, `Accounting:166`, `ReportGenerator:342`, `Machines:140`, `Portal:1108`, `RadiologyLegacy:239`, `OutsourcedCostReport:28`, `MyReportingAnalytics:148`, `FetalUsgLevel4:395`, `SelfRegistrationForm:605` (`min=`) |
| **SAFE — calendar arithmetic on an already-known date** (`d` came from a stored value, not from "now") | ~11 | `lib/dateRangePresets.ts` ×2, `Form3C:20`, `FinancialStatements:53`, `Reports:84/93`, `Billing:69`, `Roster:20`, `Ai*:50/56`, `MyReportingAnalytics:148` |
| **LEGITIMATE USER DATE — the operator picks it; the default is a convenience** | 2 | `Banking:287` (bank date-entry field), `Recall:159` (recall due date = now + 7 d, an intentionally future-dated clinical task) |
| **LATER STAGE — persisted business date on a record Stage 1A does not own** | 8 | `Staff.tsx:171,306,405,562` (payroll — **excluded by §3**, needs **D-11**), `HRForms.tsx:345,355` (employment records), `TumorFollowupPanel`/`PcpndtFormFFinalizeStep` were the clinical instances Stage 1A *did* own and fixed |
| **UNKNOWN — needs a look, deliberately not changed** | 2 | `NewOnlineBookingDialog:288` (a `dateOfBirth` derived from `now` — suspicious in itself: a DOB default should never be today), `RadiologyWorklist:687` (a hard-coded **sentinel test row**, harmless but it should not live in `pages/`) |

Server-side: **65** non-test day-slice occurrences remain unchanged (notably `cron.ts:927,1068,1157,1254,1284` "today" keys, and `routes/reports.ts:512,622`, where `/daily-summary` and its PDF **default "today" in UTC on the server**). The last two are the highest-value next correction and are named in §11 as the first Stage 1B item; they are read/report paths, so leaving them does not contradict the Stage 1A write-default contract, but they *do* mean a report opened at 03:00 IST is titled with yesterday's day.

### 8.3 Duplicate clinic-day helpers still standing

`auto-voucher.ts istDateStr()`, the two `clinicDayBoundsIst()` implementations (`api-server/src/lib/emergencyReconcileHelpers.ts:14` and `lib/emergency-billing/src/syncSummary.ts:63`), `ai/studyAgeWindow.ts endOfIstDay()`, `my-daily-summary.ts` (6 inline copies), `day-close.ts` (3 inline `Intl` label builders beside its own `todayIST()` import), `routes/radiology.ts:105 todayISO()` alias. All produce the correct clinic day; collapsing them is Stage 1B's housekeeping, and Stage 0 §25 recommended against bundling it into a defaults PR.

## 9. Midnight behaviour — the proof (§10)

Deterministic, injected instants; nothing depends on the clock of the machine running the suite.

| Instant (IST) | UTC | CARE business date served | Old browser default would have said |
|---|---|---|---|
| 29-Sep 23:59 | `2026-09-29T18:29:00Z` | `2026-09-29` | `2026-09-29` (agreed) |
| 30-Sep **00:00** | `2026-09-29T18:30:00Z` | **`2026-09-30`** | `2026-09-29` ✗ |
| 30-Sep 00:01 | `2026-09-29T18:31:00Z` | **`2026-09-30`** | `2026-09-29` ✗ |
| 30-Sep 05:29:59.999 | `2026-09-29T23:59:59.999Z` | **`2026-09-30`** (and equals `businessDayEndUtcIso` exactly) | `2026-09-29` ✗ |
| 30-Sep 05:30 | `2026-09-30T00:00:00Z` | `2026-09-30` | `2026-09-30` (re-converged) |

Plus: the same answers under `process.env.TZ` = `UTC`, `Asia/Kolkata` and `America/New_York`; `businessDayStartUtcIso`/`End` are exact to the millisecond and stable across the whole day; the client holder returns `null` — never a browser date — when the server has not answered. These are §18 assertions 1–4 and 12 in `careTime.stage1a.test.ts`.

## 10. Tests

### 10.1 New — 47 tests, all green

| File | Tests | Pins |
|---|---|---|
| `artifacts/api-server/src/lib/careTime.stage1a.test.ts` | 19 | boundary table; `clinicDateOf` ≡ `todayIST`; TZ-independence; business-day bounds exactness and inclusivity; the whole `/api/time/now` shape (six keys, named source, no input read, no DB, read-only mount); `nowIST()` deletion; **forward-only guards** (no new columns, no migrations); **no-policy guards** (historical and future `expenseDate` still parse, no route gained a cutover/window/reason check); `created_at` still DB-defaulted |
| `artifacts/diagnostic-erp/src/lib/careTime.stage1a.test.ts` | 28 | starts with no authority; accepts well-formed answers only (8 malformed shapes rejected); fails soft to `null`; one request, concurrent calls deduplicated; rollover timing exact + clamped both ways; memory-only (no storage); client never computes a day; endpoint is GET-only; service-worker network-only; app-shell mounts once and no page fetches; every changed form's default; scanned-bill refusal; loaded values still win; **no `min`/`max`/reject added** |

### 10.2 Converted, not deleted (§19)

Stage 1A deliberately invalidated exactly four Stage-0 characterizations. Each was rewritten **in place** as a `TRANSITION LOG` block carrying the BEFORE text and the AFTER contract, so the diff itself shows what changed and why:

| Stage-0 test | BEFORE asserted | AFTER asserts |
|---|---|---|
| client · "a new expense defaults … from the browser, via a UTC slice" | `const today = new Date().toISOString().slice(0, 10)` | `emptyExpenseForm(clinicDateIst …)` + the naive idiom must **stay** gone |
| client · "the GL voucher form defaults its date from the browser, twice over" | two `toISOString().split("T")[0]` defaults | both now `getClinicDateIst() ?? ""` |
| client · "Form F defaults its procedure date from the browser too" | `today()` = browser slice | `today()` = `getClinicDateIst() ?? ""`; `consentDate`/`mtpDate` still `""`, and the loaded-record overrides are re-asserted |
| server · "CHARACTERIZATION (dead code): `nowIST()` returns Invalid Date" | the broken helper exists and is unused | the helper is gone, the two new primitives exist, and the reason string stays in the file |

Two further Stage-0 assertions had to be revisited because their *premise* changed even though they were not among the four that went red:

- **`FORWARD-ONLY GUARD: there is still no shared client IST helper`** — Stage 1A adds exactly one, so it became `TRANSITION (Stage 1A): exactly one shared client holder exists, and it computes nothing`, asserting `careTime.ts` is the only holder and that it cannot name a day or persist one.
- **the naive-vs-timeZone-pinned page ratio** — replaced by a real regression guard: a named list of the eight files whose blank defaults write a persisted CARE business date must contain **no field seeded from `new Date().toISOString()`** and must reference the authority. This is the §23 guard, and it is narrow: filters, filenames, display formatting and calendar arithmetic are not prohibited, so valid non-authoritative `Date()` use is untouched.

All other Stage-0 assertions are unchanged and still green: the money-instant metadata, the immutability matrix, the actor matrices, day-close annotation behaviour, the non-browser caller inventory, `DailySummary`'s timeZone-pinned helper (still the "good pattern, not yet adopted" case), and the offline-queue-sends-no-date test.

### 10.3 Counts

| Suite | Tests | Result |
|---|---|---|
| `businessTime.stage0.characterization.test.ts` (api-server) | 53 | pass |
| `businessTimeClient.stage0.characterization.test.ts` (erp) | 14 (13 → 14: one guard became two tests) | pass |
| `careTime.stage1a.test.ts` (api-server) | 19 | pass |
| `careTime.stage1a.test.ts` (erp) | 28 | pass |
| **total business-time suites** | **114** | **pass** |

Also re-run green, because they read the code this PR touches: `routes/day-close.todayCloses.sourceContract.test.ts` (1) and `lib/securityPerfHardening.sourceContract.test.ts` (5, the existing `todayIST` source-contract precedent).

## 11. Gates

All run on this Windows workstation against the branch; the method and its one limitation are stated rather than glossed.

| Gate | Command | Result |
|---|---|---|
| Typecheck · api-server | `node --stack-size=16000 ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | **PASS** (exit 0) |
| Typecheck · diagnostic-erp | same | **PASS** (exit 0) |
| Typecheck · workspace libs | `node --stack-size=16000 node_modules/typescript/bin/tsc --build` | **PASS** (exit 0) |
| Build · api-server | `node ./build.mjs` | **PASS** — `Done in 1435ms` |
| Build · ERP | `./node_modules/.bin/vite build --config vite.config.ts` | **PASS** — `✓ built in 21.00s`, 0 errors (chunk-size warnings only, pre-existing) |
| Business-time suites (4 files) | `node node_modules/vitest/vitest.mjs run <4 paths>` | **114 passed / 0 failed** (§10.3) |
| Deterministic server suites that read the touched code | `routes/day-close.todayCloses.sourceContract.test.ts`, `lib/securityPerfHardening.sourceContract.test.ts` | **6 passed** |
| Full ERP suite | `node ../../node_modules/vitest/vitest.mjs run` in `artifacts/diagnostic-erp` | 334 files: **2 failed, 332 passed** · 4199 tests: **1 failed, 4198 passed** |
| ERP failure identity | — | `lib/aiQueryContract.test.ts` (asserts POSIX-relative paths; fails on Windows separators) and `lib/reportComposer/composeStudyContext.test.ts` (imports `@workspace/db` → needs `DATABASE_URL`). **Neither file, nor anything it reads (`lib/aiReportingClient.ts`, `reportComposer/**`), appears in this branch's diff** — the failures are input-invariant under Stage 1A. Both were measured failing on this box earlier today at the previous base as well. |
| Full api-server suite, run 1 | `node node_modules/vitest/vitest.mjs run artifacts/api-server` | 418 files: **84 failed / 321 passed / 13 skipped** · 3168 tests: **37 failed / 3091 passed / 40 skipped** |
| Full api-server suite, run 2 | same | 418 files: **89 failed / 316 passed** · **47 failed / 3081 passed** |
| api-server interpretation | — | The suite is **not green on this workstation**: the ERP Postgres (`care-db`) runs on the Synology NAS and is unreachable here, and 225 `DATABASE_URL`/`ECONNREFUSED`/`getaddrinfo` error lines appear in **both** runs. Run 1's failing-file set is a **strict subset** of run 2's (the 5 extra are `routes/patient-reports.d5/d6/d7/d9/pcpndt`), and `Test timed out in 5000ms` counts track it (2 vs 7) — the variance is load-driven timeouts, not assertions. 84 failing files matches the floor measured twice on this box at the base `716fd413` earlier the same day. **No failing file is one Stage 1A modified**; the only failing file that even references the touched area (`lib/secretStrength.test.ts`) dies at `lib/db/src/index.ts:8` on import, before any Stage-1A code runs. All 114 business-time tests pass inside these same runs. |
| Migration-order preflight | `node scripts/check-migration-order.cjs` | **PASS** — no ordering violations (Stage 1A adds no migration) |
| Grounding / architecture claims | `node scripts/grounding-check.cjs` | **PASS** — "All 105 architecture claims hold against the code" |
| API route-coverage tool | `node scripts/api-route-coverage.mjs` | **COULD NOT RUN** — pre-existing Windows bug at `scripts/api-route-coverage.mjs:6` builds `root` from `new URL(import.meta.url).pathname` → `C:\C:\…` `ENOENT`. Recorded, not fixed (§24: no code repair outside Stage 1A's scope). It would otherwise be the tool to confirm the new mount. |

**Limitation stated plainly:** a same-base re-measurement at `27dab054` was not possible from this working tree because the branch modifies files in place and this repository is a shared pnpm workspace (no isolated `node_modules` for a scratch worktree, and `git stash` is disallowed here). The claim rests instead on (a) input invariance — no failing file is touched by this diff, (b) identical failure identities to the base measurements taken earlier today, and (c) two runs whose difference is entirely timeouts. Reviewer action that would close it: run `vitest run artifacts/api-server` at `27dab054` on a host with the NAS database reachable, where the suite is expected to be green.

## 12. Known limitations

1. **A default is not a control.** An operator (or any API caller) can still post `expenseDate: "1900-01-01"` and it is stored verbatim with no reason and no audit row. That is Stage 2/3 work gated on **D-2/D-3**, and Stage 1A explicitly does not pre-empt it.
2. **`null` is only as good as the UX that renders it.** A blank required date field is honest but it is not a designed offline state; if the clinic works offline against forms with date defaults, Stage 1B should give that state an explicit affordance.
3. **The workstation clock is still trusted for the *instant*** in two places that matter: (a) the client's rollover timer, which is clamped and only schedules a re-fetch, and (b) every display/filter helper in §8.2. Neither can write a CARE business date now.
4. **No client-clock telemetry exists.** The one detector for workstation manipulation that does not assume the attacker used the API — persistent operator-vs-server clinic-day disagreement — is still not implemented (Stage 0 §23 item I). Stage 1A creates the reference value it needs, which is a prerequisite, not the detector.
5. **`clinicDateIst` is Node-clock-derived.** Postgres is not consulted, so a *lost* `TZ` pin cannot move it (the helpers are timezone-explicit), but a broken **server** clock still moves it. The boot/periodic probe and the `time_received`/`time_processed` pair (Stage 1B) are the mitigation, and both need a schema decision.
6. **Read paths still bucket by UTC** (§8.1, §8.2). Between 00:00 and 05:29 IST a report can now be *titled* with the clinic day while its *numbers* are UTC-day — Stage 1A made the write side consistent and left the read side for D-6.
7. **Untested here:** the browser-facing behaviour in a real DOM (the suites are node-env, module + source-contract style, consistent with the repo's existing `sourceContract` tests). No screenshot evidence is available from this workstation.

## 13. What this changes for the open management decisions

| Decision | Stage-1A effect |
|---|---|
| **D-1** (IST business day, server time authoritative, browser never authoritative) | **implemented for defaults.** The mechanism question Stage 0 left open ("until Stage 0 verifies") is now answered: explicit `Intl` conversion of the Node clock, published over one authenticated read-only endpoint. |
| **D-2** (window) | **unchanged, still deferred.** Stage 1A produced no window and no rejection. New evidence for it: after this PR a *blank* form can no longer be the cause of a wrong business date, so any future `date ≠ clinic day` signal is either a deliberate user choice or a non-default entry path — which sharpens what a window would actually police. |
| **D-3** (tiers) | **unchanged.** No role/tier matrix was introduced. |
| **D-6** (Postgres timezone) | **unchanged by design** and now better framed: 14 read sites all mean the clinic day and resolve in UTC; Stage 1A avoided the alternative (redefining `::date`) precisely because it would move historical reports. |
| **D-10** (external clock authority) | partially advanced: the CARE answer no longer depends on any client clock; the server clock itself is still assumed, with `source` naming it. |
| **D-11** (payroll parity) | **not touched**, by §3. `Staff.tsx` remains the largest cluster of browser-defaulted persisted business dates (4 sites) and still has no audit writer at all (Stage 0 S0-5). |
| **D-13** (cutover) | **not implemented.** No cutover column, no enforcement. Stage 1A is deployable over an untouched history: it changes what a blank form shows, not what any stored row says. |

## 14. Forward-only attestation

No row was read for its content, counted by date, classified, flagged, rewritten, normalized or migrated. No migration exists in this PR (asserted by test, by filename). No schema column was added (asserted by test against Drizzle metadata). No historical value was reinterpreted: every changed line is a *default for a record that does not exist yet*, and in all eight files a loaded record's stored date continues to win over the default (asserted by test). Deploying and then reverting this PR changes no data, because no data was written by it.
