# CARE business time — Class A date enforcement: design, inventory and contract (PR 1)

Date recorded: 2026-10-01. Branch `fix/erp-care-business-date-enforcement`, base `955f19fe39c7e1484fb177446e594120799ae6d8` (= `origin/main`, Stage 1A merged as #786).
Builds on: `docs/audits/business-time-timezone-integrity-audit-2026-09-30.md`, `docs/audits/business-time-integrity-remediation-plan-2026-09-30.md`, `docs/audits/business-time-stage0-runtime-verification-2026-09-30.md`, `docs/audits/business-time-stage1a-implementation-2026-09-30.md`, `docs/audits/accounting-module-deep-audit-2026-09-30.md` (#785).

## 1. What this PR is, and what it deliberately is not

Management's final policy (2026-09-30) fixes the answer to the question the earlier stages were forbidden to answer: ordinary staff may not create a backdated entry, may not re-date an existing one, and may not falsify the actual creation/audit time. No window, no grace period, no workstation exception.

This is **PR 1 of five**: the reusable server-side enforcement primitive, the date-field classification it acts on, and the tests. **It changes no route behaviour.** Nothing in CARE responds differently to a request after this PR; the code is not yet consulted. That separation is deliberate — the security property and the fifteen audited write paths should be reviewable apart, and PR 1 landing or not landing must not be able to move a number in any existing screen.

Implemented here: `artifacts/api-server/src/lib/careBusinessDatePolicy.ts`, `artifacts/api-server/src/lib/careDateFieldRegistry.ts`, `artifacts/api-server/src/lib/careBusinessDatePolicy.final.test.ts` (35 tests).
Not implemented here, by scope: route wiring (PR 2), cutover + audit tables + rejection persistence (PR 3a), privileged correction workflow (PR 3b), `::date` read paths (PR 4), Admin forensic view (PR 5).

## 2. The rule as coded

| Operation | Input | Verdict |
|---|---|---|
| CREATE, Class A | absent / `null` / `""` | accepted, **server-derived** from the trusted CARE clinic date |
| CREATE, Class A | exactly today's CARE clinic date | accepted, `client-matches-trusted` |
| CREATE, Class A | any other date — yesterday, last week, last month, `1900-01-01`, tomorrow | **rejected**, `CARE_BUSINESS_DATE_NOT_CURRENT`, direction `past`/`future` |
| CREATE, Class A | not `YYYY-MM-DD` | **rejected**, `CARE_BUSINESS_DATE_MALFORMED` |
| UPDATE, Class A | field absent, or byte-identical to the stored value | accepted, no change, stored value returned |
| UPDATE, Class A | any different date, **including today's CARE date** | **rejected**, `CARE_BUSINESS_DATE_IMMUTABLE` |
| UPDATE, Class A | `""` (would erase the business date) | **rejected**, `CARE_BUSINESS_DATE_MALFORMED` |
| Either, Class B/C/D or unregistered | anything | **passed through untouched, exactly as received** |

Two properties are structural rather than behavioural:

* **No silent substitution.** A rejection verdict has no `businessDate` property at all, so a caller cannot write the result of a rejected decision by accident. The corrected value is never applied to an explicit conflicting date — the operator gets `Entry date must be the current CARE business date (2026-10-01).`
* **The authority is injected.** Every decision takes a `ClinicDateAuthority`; none of them calls `new Date()` internally. One request cannot mix two clocks, and the midnight behaviour is testable at a fixed instant.

## 3. Field classification (policy §9) — the full inventory

Class A = system business date. Class B = historical fact, legitimately earlier. Class C = planned, legitimately later. Class D = trusted system instant. `?` = cannot be determined from the code — listed in §9 rather than guessed at.

### 3.1 Financial

| Field | Type | Client-writable? | Class | Evidence |
|---|---|---|---|---|
| `vouchers.date` | `text` | yes | **A (enforced)** | `routes/accounting.ts:45,268` (POST), `:295,312,353` (PATCH, no schema, no guard), `:1411,1492` (bank import, no format check); server writers `lib/auto-voucher.ts:193,288,377,455,541,614,685`, `routes/accounting.ts:1279,1317` |
| `expenses.expense_date` | `text` | yes | **A (enforced)** | `lib/expenseV2Service.ts:301` ← `CreateExpenseBody` (`lib/api-zod/.../api.ts:3041`); `routes/expenses.ts:467-471,519` (PATCH); drives list filter `routes/expenses.ts:82` and duplicate window `lib/expenseV2Service.ts:249` |
| `day_closures.closure_date`, `user_day_closures.closure_date` | `date` | **no** — server-derived Node IST | A (already authoritative; nothing to police) | `routes/day-close.ts:493,501` and `:1436,1443`; the row also carries `closed_at`/`covered_to_ts` overwritten with Node `new Date()` at `:488,505-506` even though the columns are `.defaultNow()` (`lib/db/src/schema/dayClosures.ts:19,25`) → see §9 item 6 |
| `fetal_usg_studies.established_ga_date` | `varchar(20)` | no — server-written | A, **defective zone** | `routes/fetalUsgLevel4.ts:308` uses `asOfDate.toISOString().split("T")[0]`, a UTC slice, so it names the wrong clinic day 00:00–05:29 IST → PR 4, not a client-authority problem |
| `expense_payments.payment_date` | `text` | yes (`routes/expenses.ts:262`) | **?** | schema comment `lib/db/src/schema/expensePayments.ts:11-12` says reconciliation keys on `created_at` and `payment_date` is "business/reference only". Cannot enforce a field whose meaning is unconfirmed → §9 item 2 |
| `expenses.invoice_date` | `text` | yes (`routes/expenses.ts:409`, unvalidated `raw` at `:360`) | **?** | looks like the vendor's document date, i.e. Class B → §9 item 1 |
| `purchase_invoices.invoice_date` | real `date` | yes, regex-validated `routes/purchaseInvoices.ts:171,193` | **B** | a vendor invoice dated last month is the normal case; immutable after draft→posted (`:255,303`) |
| `bills.due_date` | `text` | yes | **C** | payment term, editable `routes/bills.ts:1398`; the bill's business date is its DB-generated `created_at` |
| `bills.created_at` | `timestamptz` `.defaultNow()` | no | **D** | `lib/db/src/schema/bills.ts:47` — already correct; this is why bill creation needs no business-date guard |
| `payments` | — | no date field at all (`CreatePaymentBody` has none) | **D** | `routes/bills.ts:2791`, `lib/db/src/schema/bills.ts:89` — the payment's date *is* its DB instant |
| `bank_transactions.transaction_date` | `timestamptz` | no — provider fetch | **B** (external) | `lib/db/src/schema/banking.ts:50` |
| `banking_refunds.requested_at/approved_at/rejected_at` | `timestamptz` | no — Node `new Date()` overrides `.defaultNow()` | **D** (deviation) | `routes/banking.ts:520-523,537,553`; columns default DB-side `lib/db/src/schema/banking.ts:295-296` |
| `discount_rules.expires_at` | `timestamp` | yes (`routes/discounts.ts:92,104`, no schema) | **C** | rule horizon, not a business date. Note `routes/discounts.ts:140` computes "today" with a server-side UTC slice → PR 4 |
| `vouchers.performed_by` | `text` | yes (body) | not a date — **actor** | `routes/accounting.ts:275,328` vs hard-coded `"System (Sync)"` `:1326` → §6 problem, handled with actor identity, not date comparison |

### 3.2 Radiology / clinical

| Field | Type | Class | Why it must stay historical, planned or server-owned |
|---|---|---|---|
| `patients.date_of_birth` | `text` | **B** | a fact about a person; `routes/patients.ts:193,245,310-343`. `pages/NewOnlineBookingDialog.tsx:284-296` currently *fabricates* one from `now` — a defect, but the fix is not a same-day rule |
| `fetal_usg_studies.lmp` | `varchar` | **B** | by definition earlier; the GA calculation consumes it (`routes/fetalUsgLevel4.ts:303`) |
| `fetal_usg_studies.edd`, `pregnancy_episodes.edd` | `varchar` | **C** | by definition later; EDD computed server-side from LMP (`:305`) |
| `form_f_records.procedure_date` | `text` | **B** | statutory scan date, printed in the register (`lib/formFRegister.ts:180`); `/save` is **insert-only** (`routes/form-f.ts:408`) so there is no edit path to guard |
| `form_f_records.consent_date`, `mtp_date` | `text` | **B** | prior-dated paper documents; `""` remains a legitimate stored value (`routes/form-f.ts:290,298`) — the guard returns `""` untouched rather than normalising it |
| `form_f_records.date` | `text` | **?** | no code distinguishes it from `procedure_date` (`routes/form-f.ts:397`, `lib/formFRegister.ts:180,183` fallback) → §9 item 7 |
| `form_f_records.created_at` | `timestamptz` `.defaultNow()` | **A/D** | system instant, and it — not `procedure_date` — buckets the statutory month (`routes/form-f.ts:693-699`) |
| `radiology_studies.study_date` | real `date` | **B** | acquisition day; matching cascade and worklist ranges filter on it (`routes/internal-radiology.ts:639,655-657,687`, `routes/radiology.ts:546-547`). No insert takes a client date; no UPDATE ever writes it |
| `radiology_worklist.study_date` | `text` | **B/D** | external modality date, deliberately IST-naive in `lib/ai/studyAgeWindow.ts:28-43`; re-sent C-STORE overwrites it, audit actor is `pacs` not a session (`routes/internal-radiology.ts:829,851`) |
| `dicom_studies.study_date`, `study_time` | `text` | **B/D** | DICOM tag from the connector (`lib/dicomConnectors.ts:182`); CARE's own ingest instant is the separate `created_at` (`lib/db/src/schema/dicomStudies.ts:74`) — exactly the "never silently convert an external event time into a CARE timestamp" rule |
| `dicom_pulled_studies.study_date` | `text` | **?** | device vs caller echo unresolved (`routes/pacsEnterprise.ts:1804,1849`) |
| `radiology_tumor_followups.study_date` | `timestamptz` | **B** | the examined study's date (`routes/radiologyTumorFollowup.ts:35`) |
| `patient_reports.signed_at/verified_at/delivered_at` | `timestamptz` | **D** | attestation instants. The ERP path is server-derived (`routes/patient-reports.ts:877,1081`); the **Reporting Studio path accepts `finalizedAt` from the body** (`routes/internal-reporting-studio.ts:725,813-816,859` and onward into `radiology_studies.final_reported_at:882`) with the actor also body-supplied (`:938`). That is a Class-D client-authority violation and is fixed as *instant* enforcement in PR 2 — a business-date comparison would not touch it |
| `study_tat_metrics.received_at/report_started_at/verified_at/finalized_at` | — | **D, client-authoritative** | all from body, breach verdict derived from them (`routes/smartRadiology.ts:587-604,613-628`) |
| `patient_reports.critical_acknowledged_by` | — | **D actor** | body-supplied (`routes/patient-reports.ts:2449-2460`); the sibling path `radiology_critical_findings` is already session-correct (`routes/radiologyWorkflow.ts:401-428`) |
| `usg_report_drafts.finalized_at/amended_at` | `timestamptz` | **D** | server clock + session actor (`routes/usgReports.ts:524,531,576,583,625`) — GOOD PATTERN |
| `patient_report_amendments.created_at` | `.defaultNow()` | **D** | immutable correction chain (`lib/db/src/schema/patientReportAmendments.ts:39-43`) |
| `radiology_scheduled_procedures.scheduled_date`, `mwl_entries.scheduled_start_date` | `text` | **C** | pushed to the modality as `ScheduledStudyDate`; note `lib/pacs/publishRadiologyStudyToMwl.ts:26-28` builds it from **Node local getters**, so it is machine-clock dependent |
| `appointments.appointment_date`, `online_bookings.selected_date`, `recall_queue.due_date` | `text` | **C** | planned days; `routes/appointments.ts:118,124` merely compares one against the clinic day |
| `technician_workflow.scan_started_at/completed_at`, `radiology_memory_usage.session_date`, `electronic_film_artifacts.study_date` | — | **?** | readers exist, no writer found in this repo |

## 4. Endpoints PR 2 will protect

Ordinary-staff Class-A write paths, in the order I intend to wire them:

1. `POST /api/accounting/vouchers` — `routes/accounting.ts:250` (has `VoucherBody`; date becomes guard-derived or guard-validated).
2. `PATCH /api/accounting/vouchers/:id` — `routes/accounting.ts:292`. Today: **no request schema**, `date` written whenever different (`:312,353`), `editedBy` **from the body** (`:295`). Both the immutability and the actor problem live here; policy §6 says the actor fix travels with the remediation, so PR 2 also stops trusting `editedBy`.
3. `POST /api/accounting/bank-statement/import` — `routes/accounting.ts:1421,1492`; `transactions[].date` reaches `vouchers.date` with no format check and **no audit row**.
4. `POST /api/expenses` — `routes/expenses.ts:341` → `lib/expenseV2Service.ts:301`; also carries `approvedBy` from the body (`:349,402`).
5. `PATCH /api/expenses/:id` — `routes/expenses.ts:458`; re-dating is blocked **only** when `hasLedger` (`:485-504`), so a PENDING/FAILED expense is freely re-datable, and a date-only edit writes **no audit row** (`:529`). No UI caller exists for this route.
6. `POST /api/expenses/:id/payments` — deferred to §9 item 2 (`payment_date` meaning unconfirmed).

Explicitly **not** protected, and why: bill/payment/day-close/expenses-attachment creation carries no client-supplied business date — their date is the DB-generated `created_at`, which is already the trusted CARE instant. Adding a business-date guard there would police nothing while creating a new way to break billing.

## 5. The contract PR 2 must use

```
clinicDateAuthority(now?)        -> { zone, clinicDate, instantIso, businessDayStartUtcIso, businessDayEndUtcIso, clockSource }
resolveCreateBusinessDate({table, column, submitted, authority}) -> decision
resolveUpdateBusinessDate({table, column, stored, submitted, authority}) -> decision
careBusinessDateErrorBody(rejection) -> { error, code, field, attemptedBusinessDate, careBusinessDate, zone, trustedInstant, direction }
describeBusinessDateRejection({rejection, actor, endpoint, method, entity?, now?}) -> evidence record (not yet persisted)
policedCareBusinessDateFields() -> ["expenses.expense_date", "vouchers.date"]
```

`careBusinessDateErrorBody` keeps the `error` key because that is what existing ERP clients already render (`routes/accounting.ts:298`, `routes/expenses.ts:217-273` and friends), so a rejected save shows the reason instead of a blank toast. HTTP status will be 400 in PR 2 — validation failure, not an authorization failure, because ordinary staff are not *permitted* this mutation at any status code that would suggest a missing grant.

`describeBusinessDateRejection` requires `subjectId` + `role` and records `identitySource: "authenticated-session"`; it deliberately **cannot** be constructed from a display name alone, and the display name is not persisted. PR 3a gives it a table to live in.

## 6. Why this cannot rewrite history

The guard has no database import and no `select`/`insert`/`update`/`delete` — asserted by test against comment-stripped source, so a future edit cannot quietly add one. It is called from write handlers only, and the UPDATE verdict compares against the value already on the row, never against "today". A 2024 voucher resent with its own 2024 date is therefore accepted unchanged; a *new* 2024 voucher is rejected. That asymmetry is the whole forward-only requirement expressed in one comparison.

## 7. Tests (35) and what each group proves

* §14 reuse — the authority agrees with the merged `/api/time/now` contract for the same instant, and the policy file computes no time arithmetic of its own (`Intl`, `toLocale`, `Date.parse`, `toISOString().slice` all forbidden in source).
* §23 boundaries — 23:59:59.999 / 00:00:00.000 / 00:00:00.001 / 05:29 / 05:30 IST, each asserted under `TZ` = `UTC`, `Asia/Kolkata`, `America/New_York`; the permitted date flips exactly once and the wrong UTC day is rejected at 05:29.
* §2 create — today accepted; absent/`null`/`""` server-derived; yesterday / last week / last month / `1900-01-01` / `1999-12-31` / tomorrow / `2035-01-01` rejected; ten malformed shapes rejected as unparseable; rejection carries no writable value; the message states the permitted date; an authority from 2024 proves the wall clock is never consulted.
* §3 update — the row's own date accepted even when months old; absent field accepted; re-date to past, to future, and **to today** all rejected; a 30-second-old row rejected; `""` rejected; the stored string is never mutated on the way to a verdict.
* §9 clinical safety — DOB, LMP, Form F procedure/consent/MTP (including `""`), study dates, purchase-invoice dates, attachment instants pass through **byte-identical**; appointment/recall/EDD/due-date pass through; `dateOfBirth` is refused even on UPDATE, so the guard cannot freeze clinical data; an unregistered field is `not-policed` rather than defaulting to enforcement; the enforcement set is exactly two fields and is disjoint from the blocklist.
* §6/§19/§24 — no request object reachable, no DB reachable, session-only actor, evidence free of token/payload keys.
* inertness — none of `accounting.ts`, `expenses.ts`, `bills.ts`, `day-close.ts`, `expenseV2Service.ts` imports the policy yet, and `CreateExpenseBody`/`UpdateExpenseBody` still declare `expenseDate` as an unconstrained string. PR 2 converts those two records into documented BEFORE → AFTER transitions; they exist now so the reviewer can see the starting line.

## 8. Interaction with day close

Nothing changes in PR 1. Relevant for PR 2/3a: day-close rows already derive `closure_date` server-side, so the closed-day rule in policy §21 is not a *default* problem but a *posting-target* problem — an ordinary staff posting whose Class-A date must equal today's clinic date cannot land in a closed historical day, because a closed day is by definition not today. The guard gets that for free; what still needs explicit work is blocking post-close *edits* of rows inside a closed day, and replacing the drawer's display-name identity (`routes/day-close.ts:1791`, keys `:1443,1896`) with an id before any per-actor policy is written.

## 9. Items I am not guessing about

Each of these is a §30 stop condition ("a field's business meaning is unclear"). None blocks PR 1; each blocks the specific PR named.

1. **`expenses.invoice_date` vs `expenses.expense_date`** — RESOLVED IN PR 2 by keeping both, with different classes: the scanned bill's printed date is stored as `invoice_date` (Class B, historical vendor fact) and `expense_date` is now only ever the trusted CARE clinic date (Class A). Live evidence in §10.4 shows a past Form F procedure date and a 1980 DOB still saving byte-exact, so the information is not lost. Still open: whether `invoice_date` should ever drive accounting (it currently does not — it is display-only, `routes/expenses.ts:409`).
2. **`expense_payments.payment_date`** — the schema comment calls it "business/reference only" while day-close keys on `created_at` (`lib/db/src/schema/expensePayments.ts:11-12`). If it is a business date it becomes Class A and is enforced; if decorative, it should arguably stop being accepted from clients. Blocks PR 2 item 6.
3. **`vouchers.performed_by`** — free text from the body vs hard-coded `"System (Sync)"`. Is it an attestation (then it is an actor-identity bug to fix) or a label? Blocks PR 2 item 1/2.
4. **Three day identities on one row** — `closure_date` (Node IST label), `covered_to_ts` (Node instant), `created_at` (DB clock), with the first two overwriting DB defaults (`routes/day-close.ts:488,501,505-506`). PR 3a's cutover must key on exactly one.
5. **Drawer identity is a display-name string** (`routes/day-close.ts:1791,1443,1896`) — needs id-based attribution before per-actor controls; Stage 0 S0-6.
6. **`PATCH /api/expenses/:id` has no UI caller.** Guard it, or treat an uncalled, unaudited, unguarded re-dating endpoint as surface to remove?
7. **`form_f_records.date`** — no code distinguishes it from `procedure_date`. Statutory field; PR 2 will not touch it, and PCPNDT amendment needs an explicit legal answer (policy §12: not invented here).
8. **Commission / payout / receipts / credit-note / adjustment write routes do not exist in this repo** (`routes/commission.ts` is a 1-line stub; no mount). Policy §10 lists commissions and credit notes — they appear to live outside this codebase, so no control here can claim to cover them.
9. **`reconciliation`** has no write handler (`routes/reconciliation.ts:123` is `.get`), so its five `::date` sites are read-only → PR 4.
10. **Payroll/`routes/staff.ts` remains out of scope** per management's silence on the D-11 question. It is still 9 write routes, **0** audit calls, **5** hard deletes, and 4 browser-defaulted dates in `pages/Staff.tsx:171,306,405,562`. Stated so nobody mistakes its absence for coverage.

## 10. PR 2 — what was wired, and the live evidence

### 10.1 Enforcement attached

| Endpoint | Change |
|---|---|
| `POST /api/accounting/vouchers` | date judged by `resolveCreateBusinessDate`; `VoucherBody.date` is now **optional** (absent → the trusted CARE date) and the insert writes the guard's answer, not the body's |
| `PATCH /api/accounting/vouchers/:id` | `updates.date` removed from the writable set; any different date → 400 `CARE_BUSINESS_DATE_IMMUTABLE`; the editor is read from `req.staffSession` and `editedBy` is **no longer taken from the body**; `reason` still mandatory |
| `POST /api/accounting/bank-statement/import` | every row's date judged before anything is inserted; one off-policy row refuses the whole batch atomically and the response says nothing was written (§10.3) |
| `POST /api/expenses` | `expenseDate` judged; the service receives `postedExpenseDate` |
| `PATCH /api/expenses/:id` | `expense_date` deleted from the writable set — the old rule blocked re-dating **only** when `hasLedger`, leaving PENDING/FAILED expenses freely re-datable |
| `pages/Expenses.tsx`, `pages/Accounting.tsx` | Class-A date inputs render read-only with the reason stated on screen (UX only — the server is the control) |
| `components/BillReceiptScannerPanel.tsx`, `pages/Expenses.tsx` OCR mapping | a scanned bill's printed date goes to `invoice_date` (Class B) instead of `expense_date`, so the vendor fact is preserved without letting it set CARE's posting date |

Not wired, deliberately: `POST /api/expenses/:id/payments` (open item 2), Form F (`/api/form-f`, Class B statutory), bills/payments (their business date is the DB-generated `created_at`), day-close (already server-derived), and every Class-B/C/D field in §3.

### 10.2 How the evidence was produced

A throwaway Postgres 16.15 container on `127.0.0.1:5411` (`care-timegate-db`), the authentic migration path via `DATABASE_URL=… node scripts/apply-all-migrations.mjs` (15 drizzle + **180/180** feature migrations, 452 tables), one seeded **ordinary staff** user (`role='staff'`, permissions `["/accounting","/form-f","/radiology","/patients"]`, no admin role) and a `portal_sessions` token, plus two seeded **pre-cutover rows**: a voucher dated `2024-03-15` and an expense dated `2024-06-01`. The api-server bundle was run against that database on port 8899 and driven over real HTTP. Nothing in this run touched the clinic NAS database. Session `TimeZone` on the fresh instance measured **UTC**, independently re-confirming Stage 0 U-1.

```
docker run -d --name care-timegate-db -e POSTGRES_PASSWORD=*** -e POSTGRES_DB=care_timegate -p 127.0.0.1:5411:5432 postgres:16-alpine
DATABASE_URL=postgresql://postgres:***@127.0.0.1:5411/care_timegate node scripts/apply-all-migrations.mjs
DATABASE_URL=… PORT=8899 NODE_ENV=development node artifacts/api-server/dist/index.mjs
DATABASE_URL=… node scripts/__timegate-harness.mjs        # 30 assertions — financial matrix
DATABASE_URL=… node scripts/__timegate-clinical.mjs       #  4 assertions — clinical pass-through
```

The two harness files are scratch and are **not** committed with PR 2; they are reproduced here so a reviewer can rebuild them verbatim. Recommended follow-up: promote them into `scripts/` as a gated security check in PR 3a, where the cutover needs the same fixture.

### 10.3 Financial matrix — 30/30 passed

Run at `serverNow = 2026-09-30T19:50:42Z`, i.e. **01:20 IST on 2026-10-01**: the live divergence case. `/api/time/now` said `clinicDateIst = 2026-10-01` while the UTC slice of the same instant said `2026-09-30` — the exact window Stage 0 measured.

| Case | Result |
|---|---|
| voucher POST date = CARE clinic date | **201** |
| voucher POST with **no** date | **201**, stored date = `2026-10-01` (server-derived) |
| voucher POST date = yesterday / tomorrow | **400** `CARE_BUSINESS_DATE_NOT_CURRENT`, direction `past` / `future` |
| voucher POST date = UTC-sliced now (`2026-09-30`) | **400** — the §7 PC-clock attack, refused at the wire |
| voucher PATCH `2024-03-15` → yesterday / today / tomorrow | **400** `CARE_BUSINESS_DATE_IMMUTABLE` (all three, including onto today) |
| voucher PATCH resending its **own** `2024-03-15` | **200**, row unchanged — the forward-only case |
| voucher PATCH with spoofed `userId`/`userName`/`role`/`editedBy` | **200**, and `voucher_audits.edited_by` = **`Gate Tester`** (the session), not the claimed `Someone Else Entirely` |
| expense POST today / yesterday | **201** / **400** |
| expense PATCH `2024-06-01` → yesterday / today | **400** / **400** |
| expense PATCH resending its own date | **200** |
| bank-statement import with a past-dated row | **400**, and **zero** vouchers written for that date (atomic refusal) |
| bank-statement import dated today | **200** — the workflow still works |
| no probe voucher exists for any rejected date | **0 rows** |
| seeded historical voucher/expense `date`, `expense_date`, `created_at` | **byte-identical** before and after the whole matrix |
| `voucher_audits` | **appended only** — 0 → 8 rows; the hash of every pre-existing audit row is unchanged |

### 10.4 Clinical pass-through — 4/4 passed, executed as real writes

* `POST /api/patients` with `dateOfBirth: 1980-05-05` → **201**, stored `date_of_birth = 1980-05-05`.
* `POST /api/form-f/save` with `procedureDate: 2026-07-02`, `consentDate: ""`, `mtpDate: ""` → **200**; stored exactly as entered, and `created_at = 2026-09-30T19:53:29Z` — the statutory clinical fact and CARE's own action instant kept in separate columns, which is the §1/§12 distinction demonstrated rather than asserted.
* A future-dated clinical task is not rejected as a business date.

### 10.5 One decision I made that management should re-examine

**Bank-statement import is now refused when any row is dated outside the current CARE clinic date.** Before PR 2 I recorded it in §4 as an *unguarded* path and intended to leave it for a decision; the live harness then proved an ordinary staff account (`/accounting` only) could post a GL voucher dated **yesterday** through it — status 200, one real row written. Leaving a proven bypass of the primary invariant while claiming the invariant was met would have made the acceptance statement false, so I closed it.

The consequence is deliberate and needs your confirmation: **importing a statement that covers past days is no longer possible for ordinary staff.** Accounting-wise that is exactly what policy §0 describes as backdated creation, and the guard refuses atomically so nothing half-writes. But if the clinic reconciles bank statements by importing a week at a time, this will surface as a blocked workflow, and the correct fix is the PR 3b correction/period-posting path rather than a window. Say so before PR 3a if bank feeds should instead be treated as an external-source accounting path with its own rule.

### 10.6 What PR 2 does not claim

No cutover gate yet (PR 3a), so this control is active from deploy — which is forward-only in effect because only write handlers changed, but it is not yet tied to a trusted activation instant or recorded as such. No rejection evidence is persisted: the 400s are real and the `describeBusinessDateRejection` shape exists, but nothing writes it to a table until PR 3a. `expense_payments.payment_date`, Form F statutory dates, payroll, the 14 `::date` reads, and the Class-D client-authoritative instants (`internal-reporting-studio.ts:725,813-816` `finalizedAt`, `smartRadiology.ts:587-604` TAT metrics, `patient-reports.ts:2449-2460` `acknowledgedBy`) are all still open.
