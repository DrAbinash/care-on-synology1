# CARE ERP — Business Time, Timezone & Anti-Backdating Forensic Audit

Date: 2026-09-30 · Mode: **READ-ONLY** (no code, schema, database, deployment or PR-merge change)
Repository: `DrAbinash/care-on-synology1` · Code read at `origin/main` **`e1cf96b1`** (first pass was taken against `1fabce4e`; every `file:line` below was re-opened against `e1cf96b1` during the finalising pass, and §17 records which items were re-verified).
Companion document: `docs/audits/business-time-integrity-remediation-plan-2026-09-30.md` (**proposals only — nothing in it is implemented**)
Decision status at the time of writing: **forward-only scope binding; D-1 / D-4 / D-5 / D-12 DECIDED, D-3 / D-13 DECIDED IN PRINCIPLE, D-2 PARTIAL with the exact window DEFERRED UNTIL STAGE 0, D-6 / D-7 / D-8 / D-9 / D-10 / D-11 DEFERRED** — see plan §8. **Recording a decision has not changed any finding's severity**: the register describes what the code was found to allow, which a remediation policy cannot retro-adjust.

---

## 1. Executive summary

### 1.1 Direct answer to the primary security question

**Yes — a CARE user can make financial records appear to belong to an earlier business day by changing their workstation date, and in several workflows the system records no trustworthy evidence of who did it.** The exposure is not uniform, and the shape of the answer matters more than a yes/no:

| Money path | Can staff move it to another day by changing the PC clock? | Is the real entry instant preserved? | Is the backdating **visible** to Admin? |
|---|---|---|---|
| Bill creation, payment, refund, discount, cancellation, advance, due settlement | **No** — these tables have *no* business-date column at all; the only date is `created_at` from Postgres `DEFAULT NOW()` (`lib/db/src/schema/bills.ts:47,89`; inserts never pass it: `routes/bills.ts:913,945`, `:2862`) | Yes (DB clock) | Not applicable — nothing to be inconsistent with. **Consequence: CARE cannot legitimately express "this payment belongs to 29-Sep" either.** |
| Expense entry / expense payment / vendor expense | **Yes** — `expenseDate` and `paymentDate` are `text` columns taken from the request body (`routes/expenses.ts:346,399` → `lib/expenseV2Service.ts:301,330,510`) and validated as `zod.string()` with **no format, no range, no closure check** (`lib/api-zod/src/generated/api.ts:3022,3041,3100,3113`) | Yes, silently (`created_at` still says 30-Sep) | **No** — no view compares `date` against `created_at`, and a **date-only edit writes no audit row at all** (`routes/expenses.ts:524-530` only audits amount/mode/category) |
| Accounting voucher (GL / journal / receipt / payment / contra) | **Yes** — `vouchers.date` is `text` (`lib/db/src/schema/accounting.ts:58`); POST validates format only (`routes/accounting.ts:45`), **PATCH accepts an arbitrary value from `req.body` with no schema whatsoever** (`routes/accounting.ts:295,311-312`) | Yes, but the audit "who" is self-asserted | **Partially** — `voucher_audits` records old/new date with a DB-default `created_at`, **but `editedBy` and `reason` come from the request body** (`routes/accounting.ts:295,313`), so authorship is forgeable |
| Doctor payout / commission / staff salary & advance | **Yes** — `paymentDate` is `text`/`date` and the route prefers the client value: `routes/staff.ts:234` `paymentDate: (body.paymentDate as string) \|\| todayIST()`, `:160` `advanceDate`, `lib/db/src/schema/doctorPayouts.ts:12` | Server `created_at` exists | No comparison view exists |
| Report finalisation / signature / amendment | **No** — server clock (`routes/patient-reports.ts:877,1488`, `routes/usgReports.ts:531,583`), amendment monotonicity enforced (`lib/radiologyD1AmendmentWriter.ts:187`) | Yes | n/a |
| Worklist / study date | **Clinical only** — `studyDate` is DICOM- or pusher-supplied text (`routes/internal-radiology.ts:469,796`, `routes/dicomStudyManager.ts:195,272`, `routes/pacsEnterprise.ts:1804`) | Separate server columns exist | It legitimately *is* acquisition time, but it is also printed as "Study Date" on reports (`routes/radiology-report-generator.ts:2263,2443`) and used as a worklist day filter (`routes/radiology.ts:546`) |

**Classification of the core defect: BUSINESS-TIME INTEGRITY.** It is not an exploit against the authoritative instant — that instant is well defended, which is a genuine strength of the current design. Precisely: **entering a transaction with an earlier effective date is legitimate CARE behaviour and is not, by itself, a vulnerability.** The vulnerability is that CARE cannot tell legitimate late entry apart from uncontrolled re-dating, that the general ledger's accounting date can be rewritten with **spoofable authorship**, that **one clinical write path lets a caller set the row's own creation instant**, that study turnaround/SLA history can be overwritten from client-supplied instants with no audit row at all (F-30), that clinical audit and critical-result acknowledgement **name whoever the caller typed** (F-31), and that several of these writes leave **no audit record**.

**Register size and severity:** **31 findings — 1 × P0, 8 × P1, 7 × P2, 8 × P3, 7 × P4** (§14A.5). Severity was re-derived under the policy in §14A.1 during the finalising pass: `F-07` moved P1→P2 (needs database credentials), `F-13` moved P2→P1 (statutory record), two items were added (`F-30`, `F-31`), and every numeric count in this document was re-derived from a stated command (§17) rather than carried from a sweep. **No client-controlled business date anywhere in this audit is described as manipulation of the database `created_at`; the two are separated in every entry, because conflating them would overstate the finding.**

### 1.2 The model question (§2 of the brief)

CARE distinguishes the four concepts **partially and inconsistently**:

| Concept | Present? | Where |
|---|---|---|
| A. Recorded-at / created-at | **Yes, and mostly well-defended** | `created_at` `timestamptz .notNull().defaultNow()` on the core tables; never in any money-route insert list; `lib/audit.ts:109-143` stamps server time *inside a hash chain* |
| B. Business / effective date | **Yes for expenses, vouchers, payouts, HR, inventory, clinical study dates — as untyped `text`, client-supplied, unvalidated** | `expenses.expense_date`, `expense_payments.payment_date`, `vouchers.date`, `doctor_payouts.payment_date`, `form_f.procedure_date/consent_date/mtp_date`, `dicom_studies.study_date`, `radiology_worklist.study_date`, … |
| C. Updated-at | Yes, but it is **`.$onUpdate(() => new Date())` — the Node process clock, and it is explicitly overwritten in ~298 places**; and it is consumed as if it were an audit value: `lib/radiologyD1DraftWriter.ts:247` writes `updatedAt` into a persisted FHIR/structured-report `audit.last_modified_at` |
| D. User-requested backdate (original date, requested date, actual server instant, user, reason, approval, approver, approval timestamp) | **Does not exist as a concept anywhere.** Nothing in the schema separates "the radiologist/accountant asked for 29-Sep" from "the clock said 30-Sep". `voucher_audits` (`lib/db/src/schema/accounting.ts:87-97`) is the closest structure and it is (a) voucher-only, (b) actor-from-body, (c) no approval/approver/approval-instant columns |

**Verdict: A and C are trusted-server-ish, B is client-owned, and D is absent. The audit never collapses them into one field — but it also never relates them to each other, which is exactly what an investigator needs.**

### 1.2a The five concepts this audit keeps separate (and never conflates)

These five definitions are used unchanged throughout both documents. Wherever a finding is stated, the field it concerns is one (and only one) of these.

| Concept | Definition | Authority in CARE today |
|---|---|---|
| **AUTHORITATIVE EVENT / RECORDED-AT** | the instant CARE actually received/committed the event | trusted: Postgres `DEFAULT NOW()` on money tables, else the pinned-IST Node process clock |
| **BUSINESS / EFFECTIVE DATE** | the calendar day the transaction clinically or financially belongs to | **client-supplied `text`**, no format/range/closure control — may legitimately differ from RECORDED-AT |
| **AUDIT TIMESTAMP** | immutable, tamper-evident trusted server/database instant | trusted for *value* (`lib/audit.ts` folds the server clock into a hash chain) but **not** protected by a DB append-only guard on the audit/financial tables (§16.7), and its **actor** is client-supplied on several paths (F-01, F-06, F-31) |
| **DISPLAY TIMEZONE** | `Asia/Kolkata` presentation and business-boundary concern | mixed: correct in `lib/istDate.ts`, wrong at the day-slice sites — **67 occurrences in 36 non-test server files, 73 in 44 non-test browser files** (§14A F-15/F-20, commands in §17) |
| **CLIENT CLOCK** | workstation/browser/device time | **untrusted and never authoritative** — yet today it seeds persisted business dates and chooses which day some screens query |

Nothing in this audit or in the companion plan is a proposal to "replace every `Date()` with `todayIST()`". A helper cannot create authority that does not exist; the plan is about *who is allowed to supply which of these five values*.

**Scope of anything that follows, and of the plan built on it: FORWARD-ONLY.** The remediation Dr. Abinash has scoped applies from a trusted cutover instant onward (plan §1.5) and governs new actions only. **No historical financial, billing, accounting, clinical, radiology, payroll or audit record is to be corrected, normalized, re-dated, rewritten, reclassified or migrated for tidiness; there is no cleanup stage; and no old row is flagged as backdated merely because its business date precedes its `created_at` clinic day** — such rows may be legitimate historical entry that predates the controls. A post-cutover edit of an old record *is* a new action, so the historical value is preserved and the mutation is audited under the new rules. This audit's findings therefore describe **what the code allows going forward**, and its census-style unknowns (§14B U-5/U-6) are needed only where a migration or runtime-compatibility decision depends on them — not to build a list of suspicious past records.

### 1.3 Highest-value positives found (keep these)

- `process.env.TZ = "Asia/Kolkata"` pinned at `artifacts/api-server/src/index.ts:8` (and `worker.ts:5`), with an explanatory comment — the server's local-time idioms are IST by construction.
- `artifacts/api-server/src/lib/istDate.ts` is a correct, explicit-zone helper (`todayIST`, `dateToISTString`, `istHourMinute`) used at ~28 server call sites.
- `payments`/`bills` deliberately have no client-settable date. Money cannot be re-dayed.
- `audit_logs` is hash-chained over `createdAt` with a `pg_advisory_xact_lock` serialiser (`lib/audit.ts:17,102-126`), has an insert schema that omits `createdAt` (`lib/db/src/schema/auditLogs.ts:46`) and a verifier (`lib/audit.ts:223 verifyAuditChain`).
- Report signature and amendment times are server-side and amendment is monotonic.
- Critical-result acknowledgement is first-write-wins and guarded (`isNull(acknowledgedAt)` — `lib/criticalFindingsAlert.ts:92-94`), so an ack cannot be moved backwards.
- DICOM modality time never becomes CARE's audit clock (it is confined to `identifiers.study_datetime`; `lib/radiologyD1FinalWriter.ts:430`).

---

## 2. Scope, method and limits

**Method.** Static read of `artifacts/api-server/src/**` (Node + Drizzle routes/services), `artifacts/diagnostic-erp/src/**` (React browser), `lib/db/src/schema/**` (Drizzle table definitions), `lib/api-zod/src/generated/api.ts` (request schemas), `migrations/*.sql`, and `docs/` policy files. Three parallel semantic sweeps plus direct line-by-line verification of every P0/P1 claim by the lead agent (`file:line` in this document was read, not guessed).

**Important correction to the brief:** there is **no Prisma in this repository**. The ORM is **Drizzle** (`artifacts/api-server/package.json:32`, `pnpm-workspace.yaml` catalog `drizzle-orm: ^0.45.2`), schema in `lib/db/src/schema/*.ts` (~140 `pgTable` files). Prisma vocabulary maps as: `@default(now())` → `.defaultNow()` (real Postgres `DEFAULT NOW()`), `@updatedAt` → `.$onUpdate(() => new Date())` (**evaluated in the Node process, not by Postgres**), `DateTime` → `timestamp(...)` / `date(...)` / **`text(...)`**. That last mapping is the crux of the audit: most business dates in CARE are `text`.

**Not done (read-only constraint).** No query was executed against any database; no runtime fake-clock or timezone test was performed; no login, no study opened, no draft autosave touched, no migration run, no file modified other than these two new `docs/audits/` documents. Consequently every "would this attack succeed" statement below is a **code-level determination**, and each is labelled `UNKNOWN — RUNTIME TEST REQUIRED` where static reading cannot close it.

**Single-source items.** Claims marked **⚠ sweep-only** come from the semantic sweeps and were not independently re-read line-by-line by the lead agent. They are all actionable leads, not load-bearing for the P0/P1 verdicts.

---

## 3. Current time architecture

### 3.1 The clock chain (what is authoritative for what)

```
Windows workstation / mobile device           ← UNTRUSTED. Supplies:
  browser new Date()                             • default business dates sent in POST bodies
                                                 • filter/date-picker values in query strings
                                                 • cosmetic "Generated/Printed" stamps on
                                                   financial exports and day-close slips
        │
        ▼
API request (body / query / headers)          ← zod parses; range/zone/format checks are rare
        │
        ▼
Node API process   TZ pinned Asia/Kolkata     ← TRUSTED-ISH for: new Date(), todayIST(),
  (index.ts:8 / worker.ts:5)                     cancelledAt, finalizedAt, signedAt,
                                                 closedAt, audit createdAt
        │
        ├──► Drizzle .defaultNow()  ──► Postgres clock   ← TRUSTED (server instant of insert)
        │                               ⚠ cluster/session TimeZone is NOT pinned anywhere
        │                                 found in lib/db, api-server or migrations/*.sql,
        │                                 so `created_at::date` (routes/bills.ts:554-555)
        │                                 buckets a day in the DB's zone, not IST
        │
        └──► app-side $onUpdate(() => new Date())  ← MUTABLE, Node clock, used as audit
                                                    value in report artifacts
External feeds (bank provider txnDate, DICOM StudyDate/Time, local Dicom Agent
capturedAt/retrievedAt)                       ← DEVICE/PROVIDER clocks; see §7 and §10
```

There is **one** authoritative *event* clock (the API process, corroborated by Postgres `DEFAULT NOW()`) and **zero** authoritative *business-date* clocks. Business dates are an untyped string that originates wherever the browser happened to be.

### 3.2 Types actually in use

| Shape | Meaning | Count / examples |
|---|---|---|
| `timestamp(withTimezone:true).notNull().defaultNow()` | true instant, DB-stamped | most `createdAt` columns |
| `timestamp(...)` **no default** | instant the *application must supply* — Node clock, or a feed | 331 of 1012 `timestamp()` declarations lack `.defaultNow()` and `$onUpdate()` (name-based grep over `lib/db/src/schema/*.ts`, command in §17); e.g. `banking.ts:50 transactionDate` (fed from bank provider), `expenses.ts:54 voidedAt`, `patientReports.ts:43 verifiedAt` |
| `date(...)` | calendar day, no time — Postgres-zone semantics | `dayClosures.closureDate`, `staff.advanceDate/paymentDate/attendanceDate`, `leave.fromDate/toDate`, `purchaseInvoices.invoiceDate`, `disciplinary.incidentDate` |
| **`text(...)` holding "YYYY-MM-DD"** | calendar day with **no type safety at all** | `expenses.expenseDate`, `expensePayments.paymentDate`, `vouchers.date`, `bills.dueDate`, `doctorPayouts.paymentDate`, `patients.dateOfBirth`, `appointments.appointmentDate`, `onlineBookings.selectedDate`, `formF.procedureDate/consentDate/mtpDate/date`, `recall.dueDate`, `machines.serviceDate`, `dicomStudies.studyDate`, `radiologyWorklist.studyDate` — **52 `text()` columns whose declaration names a date, 46 of them with no database default** (lead recount with the exact grep in §17; an earlier sweep figure of 67 used a looser name rule and is superseded) |
| `text` holding `YYYYMMDD`/`HHMMSS` | DICOM-style compact strings | `radiologyScheduledProcedures.scheduledDate/scheduledTime` |

**Consequence of `text`:** the database cannot reject `expenseDate = "2026-02-31"`, `"yesterday"`, `"30/09/2026"`, `""`, or a 40-character string. Every comparison against such a column silently depends on lexical ordering, and `(::date)` casts (`lib/expenseV2Service.ts:249`) will throw or coerce depending on input.

### 3.3 Naming inconsistency for the same idea

`todayIST()` (server, `lib/istDate.ts:12`), `todayISO()` (server alias returning IST, `routes/radiology.ts:105-107`), `todayISO()` (browser, explicit IST, `diagnostic-erp/src/lib/dateRangePresets.ts:12`), `todayISO()` (browser, **local-time parts, no zone**, `pages/Dashboard.tsx:164`), `todayIST()` (browser, `pages/DailySummary.tsx:175`), `istYyyymmdd()` (shared lib, both sides, `lib/emergency-billing/src/numbering.ts:4`), `clinicDayBoundsIst()` (shared lib, `lib/emergency-billing/src/syncSummary.ts:63`). Identical names, different authorities — a trap for anyone "just reusing the existing helper". There is **no** `clinicTodayIST`/`startOfDay`/`businessDay` helper as the brief assumed.

---

## 4. Trust-boundary classification of every significant time source

| Source | Classification | Representative evidence |
|---|---|---|
| Postgres `DEFAULT NOW()` on `bills/payments/patients/vouchers/expenses/audit_logs` | **DATABASE CLOCK — trusted** | `lib/db/src/schema/bills.ts:47,89`, `accounting.ts:79`, `auditLogs.ts:34` |
| `new Date()` in API routes/services for `cancelledAt`, `finalizedAt`, `signedAt`, `closedAt`, `coveredToTs`, `startedAt/acquiredAt/deliveredAt` | **SERVER CLOCK — trusted** | `routes/bills.ts:1724,1751,2376,2547`; `routes/usgReports.ts:531,583`; `routes/patient-reports.ts:877,1488`; `routes/day-close.ts:487-506`; `routes/radiology.ts:1301-1303,1401` |
| `lib/audit.ts:109` `createdAt` folded into `chainHash` | **SERVER CLOCK — trusted + tamper-evident** | `lib/audit.ts:102-126,143` |
| `todayIST()` / `dateToISTString()` / `istHourMinute()` | **SERVER CLOCK, explicit IST — trusted** | `lib/istDate.ts:12,21,27,35` |
| Drizzle `.$onUpdate(() => new Date())` | **SERVER CLOCK but MUTABLE — not audit-grade** | every `updatedAt` column; explicit overwrites at `routes/radiology.ts:948,1050`, `lib/ai/overnightDraftQueue.ts:241` |
| `new Date().toISOString().slice(0,10)` **in the server** | **SERVER CLOCK, WRONG ZONE (UTC)** — returns yesterday for 00:00–05:30 IST | `routes/fetalUsgLevel4.ts:707→712 reportDate`; `routes/usgReports.ts:612` (baked into amendment text); `routes/pacsEnterprise.ts:1877`; `lib/usgObDopplerService.ts:58` (**persisted** studyDate); `lib/pacs/stampAccessionFromBill.ts:333` |
| `new Date().toISOString().slice(0,10)` **in the browser** | **CLIENT CLOCK (UTC-derived)** — persisted as business date | `pages/Expenses.tsx:174→477/496`; `components/expenses/ExpenseDetailDrawer.tsx:100,133`; `pages/Staff.tsx:306,405`; `pages/Accounting.tsx:507`; `pages/Machines.tsx:140→231/477`; `pages/HRForms.tsx:345,355`; `components/accounting/Form3C.tsx:22`; `components/BillReceiptScannerPanel.tsx:203` |
| Browser local-time `getFullYear/getMonth/getDate` | **CLIENT CLOCK + CLIENT TIMEZONE** | `pages/Dashboard.tsx:164-172`, used at `:783` for `/api/daily-summary?date=` |
| Browser `toLocaleDateString()` with no zone | **CLIENT CLOCK + CLIENT LOCALE** (format varies) | `pages/EchoCardiology.tsx:286`, `pages/FetalEcho.tsx:216`, `pages/UsgDopplerReporting.tsx:176` (`studyDate:`) |
| `req.body` business dates reaching inserts | **EXPLICIT USER BUSINESS DATE — currently unsanctioned and unauthenticated** | `routes/expenses.ts:346,399`; `lib/expenseV2Service.ts:301,330,510`; `routes/accounting.ts:268,311`; `routes/staff.ts:160,234`; `routes/inventory.ts:205`; `routes/purchaseInvoices.ts:172`; `routes/machines.ts:447`; `routes/form-f.ts:279,392-397`; `routes/disciplinary.ts:41`; `routes/leave.ts:77` |
| `req.body` timestamps → derived clinical metrics | **CLIENT CLOCK — overrides server clock when present** | `routes/smartRadiology.ts:590-606` (`receivedAt`…`reportFinalizedAt` → `totalTat`, `slaBreached`) |
| DICOM `StudyDate (0008,0020)` / `StudyTime` / pusher `studyDate` | **EXTERNAL SYSTEM CLOCK — legitimate for clinical acquisition, must never be audit time** | `routes/pacsEnterprise.ts:1747`; `lib/pacs/orthancChangesPoller.ts:330`; `lib/dicomConnectors.ts:182-183`; `routes/internal-radiology.ts:469,796`; `routes/dicomStudyManager.ts:195,272` |
| Bank-provider `txnDate` / settlement date | **EXTERNAL SYSTEM CLOCK** → `banking.transactionDate` (no DB default) | `services/banking/GenericBankProvider.ts:117`, `{SBI,ICICI,HDFC,Kotak,Axis,BharatPe}BankProvider.ts:61`, `routes/cron.ts:1842` |
| Local Dicom bridge `capturedAt`/`retrievedAt` | **DEVICE CLOCK**, only a NaN check | `routes/dicomAgent.ts:530,537` |
| `process.env.TZ = "Asia/Kolkata"` | **CONFIGURATION of the server clock's interpretation** | `index.ts:8`, `worker.ts:5` |

---

## 5. Time Authority Matrix

Legend — **Client supply?** = can a caller make this field persist a value they chose. **Server override?** = does API code replace it with server time. **DB default?** = `DEFAULT NOW()`/`DEFAULT CURRENT_DATE`. **Mutable?** = is there any reachable write path after insert.

| Field | Table / model | Workflow | Source of time | Client supply? | Server override? | DB default? | Stored zone | Mutable? | RBAC on the write | Audited? | Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `created_at` | `bills` | bill creation | **DB** | No (not in zod `CreateBillBody`, `api.ts:998-1009`; not in insert list `bills.ts:913`) | n/a | **Yes** | timestamptz (UTC) | No reachable path | `/billing` | `bill_audits` (server `created_at`) | Low |
| `created_at` | `payments` | payment, partial, advance, refund (negative row `bills.ts:2034`) | **DB** | No (`api.ts:2129-2135`) | n/a | **Yes** | timestamptz | No | `/payments` | `bill_audits` | Low |
| `cancelledAt` | `bills`, `order_tests` | cancellation | **Server Node** | No | Yes (`bills.ts:1724,2547`) | No | timestamptz | Effectively no | `/billing` + `delete` sub-permission | `bill_audits` | Low |
| `dueDate` | `bills` | bill create/edit | **Client text** | **Yes, any string** (`api.ts:1001` `zod.string().nullish()`; `bills.ts:928,1398`) | No | No | text | **Yes** | `/billing` | not a tracked field | **P2** (not a money-movement date, but it is the collections/aging driver) |
| `expenseDate` | `expenses` | expense entry | **Client text** | **Yes** (`api.ts:3041` `zod.string()`; `expenses.ts:346→expenseV2Service.ts:301`) | No | No | text | **Yes, and a date-only edit is NOT audited** (`expenses.ts:524-530`) | `/accounting` tick (`routes/index.ts:530`) | none | **P1** |
| `paymentDate` | `expense_payments` | expense payment / cash | **Client text** | **Yes** (`expenses.ts:268` body trim → `expenseV2Service.ts:510`) | No | No | text | Yes | `/accounting` | none | **P1** |
| `date` | `vouchers` | GL journal/receipt/payment/contra | **Client text** | **Yes**: POST format-only (`accounting.ts:45`), **PATCH no schema at all** (`accounting.ts:295,311-312`) | No | No | text | Yes | `/accounting` (`index.ts:497`) | `voucher_audits` — but `editedBy`/`reason` are **from the body** (`accounting.ts:295,313`) | **P0** (GL accounting date + forgeable audit author) |
| `date` (bulk import) | `vouchers` | bank-statement import | **Client text** | **Yes** (`accounting.ts:1411` `z.string().min(1)`, `:1469 txn.date \|\| todayIST()`) | only as fallback | No | text | Yes | `/accounting` | none; `performedBy` left NULL ⚠ sweep | **P1** |
| `created_at` | `vouchers`, `expenses`, `expense_payments` | all of the above | **DB** | No | n/a | **Yes** | timestamptz | No | — | — | This is the *evidence* that would catch a backdate — currently unused (see §11) |
| `paymentDate` | `doctor_payouts` | commission/payout | **Client text** | ⚠ sweep-only | No | No | text | Yes | `/accounting` | none | **P1** |
| `paymentDate`, `advanceDate`, `monthYear` | `staff_salary_payments`, staff advances | payroll | **Client wins, server fallback** (`staff.ts:234,160,226`) | **Yes** | No | No | date/text | Yes | staff routes | none | **P2** |
| `closureDate`, `closedAt`, `coveredToTs` | `day_closures` | day close | **Server** (`day-close.ts:487-506`) | **No** (`CreateBody` `:460-466` carries only actuals + variance note) | Yes | Yes (defaultNow) | date + timestamptz | only via super-admin reopen (`:672`) | owner/admin | drawer audit rows | **Low — good design** |
| `reopenedAt`, `approvedAt` | `day_closures`, `user_day_closures` | reopen/approve | Server | No | Yes | No | timestamptz | No | super_admin (`:672`, `:2149`) | reason `min(3).max(2000)` (`:669`) | Low |
| `signedAt` | `patient_reports` (+ D1 `signature.signed_at`) | finalisation | **Server** (`patient-reports.ts:877→1081`) | **No** | Yes | No | timestamptz/ISO | No | `/reports` | own audit row in-txn (`:1053`) | Low |
| `amendedAt` / amendment `signed_at` | `patient_report_amendments` | amendment | Server (`:1488`), monotonicity enforced (`radiologyD1AmendmentWriter.ts:187`) | No | Yes | defaultNow | timestamptz | insert-only table | `/reports` | insert-only | Low |
| `criticalAcknowledgedAt` | `radiology_flagged_findings` | critical result ack | Server + `isNull()` guard (`criticalFindingsAlert.ts:92-94`) | **No** | Yes | No | timestamptz | first-wins | `/radiology` | — | Low |
| `criticalAcknowledgedBy` | `patient_reports` | critical ack | **Body text, session not used** (`patient-reports.ts:2452-2460`) | **Yes** | No | No | text | Yes (also **nullable** by `isCritical:false`, `:2185-2189`) | `/reports` | none | **P2 — attribution, not time** |
| `radiology_audit_log.actor` | `radiology_worklist` audit | worklist status | **Body** (`internal-radiology.ts:1256 b.actor ?? "system"`) | **Yes** | No | defaultNow | timestamptz | insert-only | internal API key (`:448`) | — | **P2** |
| `studyTatMetrics.receivedAt/reportFinalizedAt` | `smartRadiology` | TAT/SLA performance | **Client wins over server** (`smartRadiology.ts:598-599`), derives `slaBreached` (`:601-606`) | **Yes** | only when absent | No | timestamp | Yes (upsert `:610+`) | ⚠ sweep: route group `/radiology` | none | **P1 (operational/HR integrity)** |
| `radiology_studies.studyDate` | radiology study | ERP study record | **Server IST** (`radiology.ts:216,1198` → `todayIST`); column is `date` with `.defaultNow()` (`schema/radiology.ts:60`) | No (no `set()` with studyDate found) | Yes | Yes | date | No | `/radiology` | no hash-chain audit row | Low |
| `radiology_worklist.studyDate` | worklist mirror | MWL / PACS | **Pusher/DICOM text** (`internal-radiology.ts:469,796`) | **Yes** (internal key) | No | No | text | Yes | internal API key | worklist audit log (insert-only) | **P3** — disagrees by construction with `radiology_studies.studyDate` |
| `echo_valve_assessment.created_at` | echo | clinical detail | **`req.body` spread** (`echoCardiology.ts:175 .values({ studyId, ...b })`, `:169-171 .set({ ...b, updatedAt })`) | **Yes — arbitrary creation instant on a clinical row** | partially (wall path forces `createdAt`, `:196`) | defaultNow | timestamptz | Yes | ⚠ sweep: `/radiology` | local `audit()` helper | **P1** (arbitrary-timestamp injection class) |
| `audit_logs.created_at` | audit | every audited action | **Server, hash-bound** (`lib/audit.ts:109-126,143`) | **No** (`insertAuditLogSchema` omits it, `auditLogs.ts:46`) | Yes | Yes | timestamptz | **Deleted by cron after retention, archive-first** (`cron.ts:881-897`) | system | chain hash + verifier (`:223`) | Low, with a note (§12.3) |
| `reports/exports` "Generated:" stamps | day-close slip, summary exports, Form 3C | printed artefacts | **Browser clock** (`lib/staffDayCloseSlip.ts:445`, `components/SummaryExport.tsx:236,281,571,698,802,820,845`, `components/accounting/Form3C.tsx:22,166`) | Yes (client) | No | n/a | text | n/a | — | none | **P3 — document evidence quality** |

**"Do not infer safety from a field named `createdAt`" — applied.** Every row above was traced to its write path. Three findings that the name alone would have hidden: `vouchers.date` (an *accounting* date with no `updatedAt` and no schema on PATCH); `radiologyAuditReviewAudits.created_at` (`timestamp` **without** `withTimezone` — the only clinical audit column found lacking tz ⚠ sweep, `schema/radiologyAiReviewAudits.ts:19`); and `radiologyD1DraftWriter.ts:247`, where a mutable `updatedAt` becomes a permanent `audit.last_modified_at` inside a structured report artefact.

---

## 6. Financial workflow findings (grouped)

1. **Registration → bill → payment → refund → cancellation:** *instant-only architecture*. No business date exists, so nothing can be back-dated and nothing can be *legitimately* dated to a prior day either. Refunds are negative `payments` rows (`bills.ts:2034`) and therefore inherit "the instant we recorded the refund", which is the correct audit semantics but a poor accounting semantics.
2. **Discount:** applied on `bills.discount` at edit time, ceilings server-enforced (`bills.ts:776-782`, `:1414-1421`, `403` above `session.maxDiscount`). No effective date, so a discount cannot be attributed to a period. ⚠ `tests.price` is mutated in place with **no price-change history table** — a price change's *when* is unrecoverable (verified absence: no `price_history`/`priceChange` anywhere in `lib/db/src/schema`).
3. **Expense:** the single largest backdating surface — see §1.1. Additional: post-voucher lock only fires when a voucher is already linked (`expenses.ts:495-506`), so a DUE/unpaid expense can be re-dated indefinitely.
4. **Expense approval:** `approvedBy` is a body field, not the session actor ⚠ sweep (`expenses.ts:346` destructures `approvedBy`; `expenseV2Service.ts:303` `approvedBy: input.approvedBy ?? null`). Approval therefore has no trusted actor and no trusted instant.
5. **Cash collection / drawer:** derived from `payments.created_at` + `method` (`routes/day-close.ts:238-242`, `advanced-dashboard.ts:66-68`). Server-authoritative, but see §8 for the disagreement with expense/voucher dates.
6. **Commission / doctor payout / voucher-linked payouts:** text dates, client-supplied ⚠ sweep; `commission_status_events` exists with DB-default `created_at`.
7. **Voucher / GL:** P0 (see §14 F-01).
8. **Ledgers:** `ledgers.createdAt` defaultNow only; no effective date.
9. **Bank transactions:** external-clock `transactionDate` with **no DB default** (`banking.ts:50`) → the bank's day is stored as an instant and later drives reconciliation windows (`ReconciliationEngine.ts:64`).
10. **Emergency/offline billing:** `emergencyBilling.originalCreatedAt` is nullable with **no default** and comes from an external payload (`schema/emergencyBilling.ts:38`), with `importedAt` server-default — this is actually the *correct* two-column pattern (external claimed time + local receipt time). It is the one place CARE already models business-vs-received time properly.
11. **`sync-billing` backfill** is UTC-dated and double-vouchers — already an open item in the repo's own `docs/FINANCIAL_STABILIZATION_PLAN.md:12`, which independently corroborates the UTC-slice class.

---

## 7. Clinical / radiology findings

- **Draft autosave and report finalisation are clean.** `radiology_report_drafts` timestamps are DB-default + `$onUpdate`, and the save-draft body schema (`radiology-report-generator.ts:1580-1662`) carries **no** date key, so a workstation clock change cannot alter when CARE received a draft.
- **Signature/amendment:** server `signedAt`, insert-only `patient_report_amendments`, and amendment must be strictly later than its parent. Strong.
- **Critical results:** ack instant is first-write-wins and non-backdatable; the *person* is body-supplied in one route (`patient-reports.ts:2452`) and lost-to-`"staff"` in another (`pacsEnterprise.ts:1930`) ⚠ sweep. ERP-side `criticalSlaStartedAt` is `Date.now()` in the browser store (`lib/zai-workspace/store.ts:1010`) and **never persisted** — display chrome only, so it is not an audit surface (and not a control either).
- **AI:** accept/reject/override stamps are all server-side. Two exceptions: `PATCH /ai-jobs/:id/status` (`radiologyWorkflow.ts:266-294`) is not radiologist-gated and takes `resultJson` verbatim; `radiology_ai_review_audits.created_at` may lack `withTimezone` ⚠ sweep.
- **DICOM is correctly firewalled from the audit clock** (finding of real value): modality `StudyDate` reaches `identifiers.study_datetime` and worklist/study *display* fields, never `audit.created_at`/`signed_at`.
- **But DICOM time is not firewalled from *derived* clinical values**: `lib/usgObSection.ts:81,101` computes gestational age and EDD from `input.studyDate` (client/pusher supplied); `lib/ai/studyAgeWindow.ts` and `lib/recallEngine.ts:15 computeDueDate(deliveredAt,…)` build recall deadlines off it; `lib/pacs/stampAccessionFromBill.ts:196-199` derives an **IST day via `toISOString()` (UTC)** from a study date and then windows an Orthanc query by it. A wrong modality clock therefore shifts a patient's recall due date and the accession-stamp day, silently.
- **Clinical rows with attacker-controlled creation instant (lead-verified):** `echo_valve_assessment` (`echoCardiology.ts:164-178`) and `usg_doppler_measurements` (`usgDoppler.ts:143-152`), both because `req.body` is only a compile-time cast and is then spread into Drizzle. Reachable with `requireStaffPermission("/radiology")` (`routes/index.ts:821`). `dicom_studies` is **not** in this class — its inline zod (`routes/dicomStudyManager.ts:195`) strips `createdAt`, leaving only `studyDate`/`studyTime` client-controlled.
- **Report lifecycle log accepts a client-authored free-text `action`** (`radiology-report-generator.ts:3519-3541`) — a user can insert an "amend"/"reprint"-looking row (its `created_at` is still honest).
- **Audit coverage gap:** `routes/radiology.ts`, `radiology-report-generator.ts`, `usgReports.ts`, `echoCardiology.ts`, `smartRadiology.ts`, `dicomStudyManager.ts`, `pacsEnterprise.ts` write **no `audit_logs` (hash-chained) row**; several write domain-local logs instead, and `radiology.ts` report save/verify plus `usgReports.ts` finalize/amend have no audit row beyond the mutable timestamp columns.
- **Timezone in the clinical path:** `usgReports.ts:612` bakes `new Date().toISOString().slice(0,10)` into permanent amendment text; `fetalUsgLevel4.ts:707→712` prints a UTC "Report Date"; `radiology-report-generator.ts:1499` / `radiologyD1FinalWriter.ts:399` assert a bare DICOM date as **`T00:00:00Z`** (05:30 IST), so any comparison of `study_datetime` with a server instant is ~5.5 h skewed.

---

## 8. Daily Summary and day-boundary findings (§14 of the brief)

What defines "today" for the daily view — **three different answers in one feature**:

1. **Browser, workstation timezone:** `pages/Dashboard.tsx:164` builds the day string from local `getFullYear/getMonth/getDate` and sends `/api/daily-summary?date=` (`:783`). Change the PC timezone and the dashboard asks for a different clinic day. `pages/DailySummary.tsx:175` at least pins `Asia/Kolkata`, but still uses the **browser clock**, and `:181-183` does `d.setDate(d.getDate()+days)` in local time before formatting to IST.
2. **Server, explicit IST:** `routes/daily-summary.ts:47-48` builds the window as ``new Date(`${dateStr}T00:00:00+05:30`)`` → `:23:59:59.999+05:30`, and filters on **`payments.created_at` / `bills.created_at`** (`:58,:82`). Correct, given a truthful `dateStr`.
3. **Server, DB-zone cast:** `routes/bills.ts:554-555` `(${billsTable.createdAt})::date >= ${dateFrom}::date` — the comment at `:553` claims "the server's local timezone", but a `::date` cast on a `timestamptz` uses the **Postgres session TimeZone**, which nothing in `lib/db`, `artifacts/api-server` or `migrations/*.sql` pins (verified by grep: no `SET TIME ZONE`, no `ALTER DATABASE ... SET timezone`, no `options=-c timezone=`). If the container's Postgres is UTC (the usual default), a bill created at 23:30 IST on 30-Sep casts to 30-Sep under the API's IST arithmetic but **19:00 UTC → still 30-Sep**, while one created at 04:00 IST on 30-Sep casts to **29-Sep**. The same money is therefore in two different days depending on which report path asked.
4. **`routes/reports.ts` carries two conventions in one file:** `:60-61` builds `T00:00:00.000Z`/`T23:59:59.999Z` (UTC) boundaries while `:101-108` builds `+05:30` boundaries; `:49 const now = new Date()` is dead code. ⚠ sweep-read, but both literals were seen.

**Answer to the brief's specific question:** Daily Summary *can* silently shift business dates because of the viewing PC — not because the server buckets differently, but because **the browser chooses which day to ask for** (`Dashboard.tsx:164`), and because the expense/voucher half of the summary is keyed on a client text date while the cash half is keyed on the server instant. `routes/daily-summary.ts:222-227` already computes a `backdatedRefunds` figure, and its own comment says it is "exposed for display/explanation purposes only".

---

## 9. Workstation-manipulation attack determinations (§7 of the brief)

| Attack | Determination | Why (evidence) |
|---|---|---|
| **A** — PC date 30-Sep → 29-Sep, create **bill** | **BLOCKED** | `bills.created_at`/`payments.created_at` come from `DEFAULT NOW()`; zod bodies carry no date (`api.ts:998-1009,2129-2135`); inserts never name the column (`bills.ts:913,945`) |
| **A′** — same, create **expense / voucher / payout** | **ALLOWED AND INVISIBLE** (as a *user-visible* outcome) | browser default `Expenses.tsx:174` → body → `expenseV2Service.ts:301,330` → `text` column; `created_at` retains the truth but no view or audit surfaces it; date-only edit not audited (`expenses.ts:524-530`) |
| **B** — PC timezone changed, clock unchanged, create bill | **BLOCKED for the bill instant**; **DETECTED-ONLY-BY-ACCIDENT** for reports: `Dashboard.tsx:164` requests another day; a *default* business date shifts by a day for expenses (UTC slice + local parts) | as above |
| **C** — expense with manipulated browser date | **ALLOWED AND INVISIBLE** | no format/range/closure validation anywhere on `expenseDate` (grep for `\d{4}-\d{2}-\d{2}` in `routes/expenses.ts` + `lib/expenseV2Service.ts` → zero) |
| **D** — API call with `createdAt = <historical>` | **BLOCKED on the core money tables** (zod strips unknown keys; field-by-field inserts; the object-spread sweep found no `values(req.body)` into a money table, and `bills`/`payments`/`expenses`/`vouchers` inserts never name `createdAt`) — **ALLOWED on `echo_valve_assessment`** (`.values({ studyId, ...b })` where `b = req.body as …`, `echoCardiology.ts:175`) and on `usg_doppler_measurements` (`usgDoppler.ts:151`), both gated by `requireStaffPermission("/radiology")` (`routes/index.ts:821`); and separately on `template_learning` (`.set({ ...req.body, updatedAt: new Date() })`, `smartRadiology.ts:363`) which additionally requires **admin or radiologist** (`:361`) | lead-verified |
| **E** — arbitrary `billDate` / `paymentDate` / `expenseDate` / `transactionDate` / `finalizedAt` | `billDate`: **N/A — no such column**. `paymentDate` (payments): **N/A — no such column**. `paymentDate` (expense_payments): **ALLOWED, INVISIBLE**. `expenseDate`: **ALLOWED, INVISIBLE**. `transactionDate` (bank): **external-clock, not staff-supplied**. `finalizedAt`: **BLOCKED** on `patient_reports`/`usgReports`; **ALLOWED** on `studyTatMetrics.reportFinalizedAt` (`smartRadiology.ts:599`, F-30); `dueDate`: **ALLOWED, unvalidated text** (F-08, but audited on change — `bills.ts:1527,1560`) | §5 matrix |
| **F** — clock forward, create, restore | Same as A/A′ mirrored: money unaffected; expense/voucher business date lands in a **future** day, which is accepted because **no server-side upper bound exists on any date field** (verified: no zod `.min()`/`.max()` on any date column) | `api.ts` date fields |
| **G** — page open before midnight, submit after | **ALLOWED AND INVISIBLE** for expenses/vouchers: defaults are captured at form construction (`emptyExpenseForm()`, `Expenses.tsx:172-185`) and never refreshed against a server value | same as A′ |
| **H** — two PCs, different clocks, simultaneous | Money unaffected (one DB clock). Expense/voucher day assignment disagrees between the two entries; **no report reconciles the two date bases**, so the disagreement is invisible | §8 |
| **I** — stale/offline browser submits yesterday's date today | **ALLOWED BUT SEMI-VISIBLE**: `lib/offlineBillingQueue.ts:220` keeps `queuedAt` browser-side but the payload carries no date and the server stamps `created_at` — so *bills* are safe; an offline **expense** would persist its stale `expenseDate`. `emergencyBilling.originalCreatedAt` + `importedAt` is the pattern that should have been used for expenses | `offlineBillingQueue.ts:220`; `schema/emergencyBilling.ts:38-41` |
| **J** — timezone manipulated around the day boundary | **ALLOWED (clinical/display), and the server has its own version of the same bug**: `toISOString().slice(0,10)` on the *server* returns yesterday between 00:00–05:30 IST regardless of the TZ pin (`fetalUsgLevel4.ts:707`, `usgReports.ts:612`, `usgObDopplerService.ts:58`, `stampAccessionFromBill.ts:333`, `pacsEnterprise.ts:1877`) | §8 |
| **Post-close insertion** (attack implied by §16) | **ALLOWED AND INTENTIONAL** — `lib/closureBoundary.ts:11-16` states it is informational only; bills/payments land in the next open window by construction (safe), expenses/vouchers can be **filed into a closed window** with no check at all (neither `routes/expenses.ts` nor `routes/accounting.ts` consults the boundary) | §12 |

Nothing in this table is `UNKNOWN — RUNTIME TEST REQUIRED` for the *static* conclusion, but two things genuinely need runtime confirmation before any remediation claim can be certified: (i) the live Postgres `SHOW timezone;` value, which decides the severity of §8(3); (ii) whether zod's behaviour on the deployed version truly strips unknown keys for `PATCH /api/accounting/vouchers/:id` — it does not even *use* zod there (`accounting.ts:295`), so that one is not in doubt.

---

## 10. API timestamp-injection findings (§9 of the brief)

1. **Frontend restrictions are not, and do not substitute for, controls — and here they are also absent.** Lead-verified: **130 `type="date"` inputs in `artifacts/diagnostic-erp/src`, of which 0 carry a `max`/`maxDate`** (counted by grepping `type="date"` and then `max=|maxDate` within the following 8 lines). So there is not even a UX ceiling on backdating; but more importantly the server has no floor/ceiling either, which is the actual finding.
2. **The reachable injection surface is the business date, not the audit instant.** `expenseDate`/`paymentDate`/`vouchers.date`/`dueDate`/`selectedDate`/`serviceDate`/`invoiceDate`/`formF.*Date` are all accepted as opaque strings. `routes/form-f.ts:279` requires only `z.string().min(1)` for a **statutory PCPNDT procedure date**, and `:392-397` writes `procedureDate`, `consentDate`, `mtpDate`, `date` straight through. `routes/disciplinary.ts:41`, `routes/leave.ts:77`, `routes/mySelfService.ts:103` accept any string for dates.
3. **A caller can forge the *author* of an accounting edit** (`accounting.ts:295 editedBy`, `:313` — F-01), and of a worklist status change (`internal-radiology.ts:1256 actor ?? "system"` — F-31), and of an expense approval (`approvedBy` from body — F-12; the self-approval check at `expenses.ts:506-515` blocks only "creator approves own record", not a named third party). Where the session is used, it correctly wins (`bills.ts:1689,1980`, `radiology.ts:2312`, `patient-reports.ts:1064-1080` "client `createdBy` ignored", `studyAssignments.ts:119`) — so the codebase already knows the right pattern; it is applied unevenly.
4. **Arbitrary `created_at` on clinical rows** via unvalidated body spread — `echoCardiology.ts:164-178` (insert **and** update paths) and `usgDoppler.ts:143-152`, lead-verified. This is the only place, reachable by an ordinary `/radiology` staff session, where a client can write a *claimed instant* into a column that looks like an instant. Money tables are not in this class.
5. **Bulk endpoints inherit the weakness at scale**: bank-statement import (`accounting.ts:1411,1469,1492`) can post many GL vouchers with arbitrary dates and no actor. `POST /api/sync/push` accepts `createdAt` on its change envelope (`routes/sync.ts:29`) but every table branch returns "Not implemented" (`:147`) — a live-looking attack surface that is currently inert, and would be dangerous the day someone implements it.
6. **Direct-API bypass is real and is the correct threat model**: `routes/expenses.ts:412-417` and `:268` read `paymentDate`/`invoiceDate`/`referenceNumber` off `req.body` *directly, bypassing the parsed object*, so even a tightened zod schema would not stop them unless those reads change.

---

## 11. Admin detectability gaps (§8 and §15 of the brief)

The evidence the brief wants — `Business Date: 29-Sep · Actually Created: 30-Sep 08:42:17 IST · Created By: staff-17 · Backdated: YES · Reason: … · Approved By: … · Approved At: …` — **cannot be assembled today, even though two of its five ingredients already exist in the row**:

| Ingredient | Exists? | Where |
|---|---|---|
| Effective/business date | **Yes** (as untyped text) | `expenses.expense_date`, `vouchers.date`, `expense_payments.payment_date` |
| Actual server instant | **Yes, trusted** | `created_at … .defaultNow()` on the same rows |
| Actor | **Partly, and for the sensitive edits it is self-asserted** | `expenses.created_by` (session-derived, `expenses.ts:348`), `vouchers.performedBy`/`editedBy` (**body**), `voucher_audits.editedBy` (**body**) |
| Reason | **Vouchers only** | `voucher_audits.reason` |
| Delta / "backdated" flag | **No** — nothing computes `business_date ≠ ist_day(created_at)` anywhere |
| Approval / approver / approval instant for a backdate | **No columns exist** |
| History of business-date changes for expenses | **No** — no `expense_audits` table, and date-only edits are skipped by the audit call (`expenses.ts:524-530`) |

So: **Admin cannot distinguish "belongs to yesterday" from "entered today, backdated to yesterday" for expenses and payouts at all** (the two columns exist but are never compared and there is no flag, no view, no alert). For vouchers the distinction *is* recoverable via `voucher_audits` + `created_at`, but the audit's author field is whatever the caller typed, so the recovery is not trustworthy. And `docs/FINANCIAL_STABILIZATION_PLAN.md:12` shows the repo already considers UTC-dated backfill a known open problem — consistent with this finding.

**One scope qualifier on this whole section (§1.2a forward-only rule):** "cannot distinguish" is a statement about the *capability being absent*, not a licence to go and distinguish it retroactively. Where both columns already exist on an old row, that row is the historical record of what CARE believed at the time; the gap is closed for actions from cutover onward, and pre-cutover rows stay unflagged and uncounted as exceptions.

**And one status qualifier:** several of the questions this section says only management can answer have since been answered — the ruling and its engineering consequence are recorded in plan §8 (D-1 fixes the IST business day and forbids a browser-authoritative "today"; D-4 requires an authorized correction with mandatory evidence rather than a block or silence; D-12 puts policy ownership with management/superadmin and gives Admin visibility only), while D-2's numeric window and D-3's matrix remain **DEFERRED UNTIL STAGE 0**. The "cannot" statements above describe the code as audited, and are corrected by *controls to be built*, not by decisions already taken.

**Audit-trail caveats that reduce confidence in the trail itself (verified):**
- `audit_logs` rows older than the retention cutoff are **deleted** by cron after being written to a checksummed `.json.gz` archive (`cron.ts:881-897`). Deletion removes `previousHash` links, so `verifyAuditChain` (`audit.ts:223`) must be able to verify *within* retained segments only — that property was not tested here (read-only) and is flagged for the test plan.
- There is **no DB-level immutability on any audit, financial or clinical-record table** (corrected after direct re-check of `migrations/`): append-only guards exist for exactly **two** AI snapshot tables — `study_snapshots` (`migrations/add_ai_shadow_uniqueness_hardening.sql:82-85`, `BEFORE UPDATE OR DELETE … FOR EACH ROW`) and `ai_shadow_drafts` (same file `:88-97`, which additionally rejects `TRUNCATE`; also `migrations/add_ai_provisional_report_versioning.sql:40-43`) — and **no `REVOKE` privilege statement exists anywhere** (every `revok*` hit in `migrations/` is a `revoked_at`/`revoked_by` *column*). None of `audit_logs`, `voucher_audits`, `bill_audits`, `patient_report_amendments`, `radiology_audit_log`, `dicom_study_audit_log`, `bills`, `payments`, `expenses`, `expense_payments`, `vouchers` is protected. Immutability is therefore a *convention of the application code*, not a property of the database — anyone with database credentials (or a future generic patch endpoint) could rewrite `created_at`, `date`, `expense_date` or audit rows without a trace. **Useful consequence: the correct trigger pattern is already in this repository, so hardening is a copy-and-extend job rather than a new invention.**
- `routes/index.ts:232 → superAdminBooksHost.ts:74-79` runs **raw `UPDATE orders/bills/patients/appointments SET ledger_id …`** with no audit insert — a super-admin retagging of historical rows that leaves no trail ⚠ sweep.

---

## 12. Day-close integrity (§16 of the brief)

- Day close **exists** and is server-stamped correctly: `day_closures.closureDate` + `closedAt` + `coveredToTs` all derive from `const to = new Date()` and an explicit `en-CA`/`Asia/Kolkata` label (`routes/day-close.ts:487-506`), serialised by `pg_advisory_xact_lock(7390021)` (`:478`). `CreateBody` carries **no** date, so a staff member cannot close "as of" a chosen day, and cannot influence closure with their own clock. Per-drawer equivalent at `:1422-1446`.
- Day-close is **not an integrity boundary**. Its own helper says so: `lib/closureBoundary.ts:11-16` ("informational only … never blocked and never requires owner approval"), and the three consult sites (`bills.ts:1536-1550`, `:1875-1888`, `:2115-2126`) only append `"[post-close edit: period closed at …]"` to an audit `reason`; `bills.ts:1446` even returns `closedPeriodWarning: null` as a normal success.
- Reopen is properly privileged: `requireSuperAdminStaff` + reason `z.string().min(3).max(2000)` (`day-close.ts:669-672`), and `reopenedAt` server-stamped (`:685-689`).
- **Closed-day insertion:** for bills/payments, impossible by construction (no business date; the row is simply in the next window). **For expenses, expense payments and vouchers it is free** — neither `routes/expenses.ts`, `lib/expenseV2Service.ts`, nor `routes/accounting.ts` reads the closure boundary at all. A staff member can therefore file an expense or post a GL voucher into any closed business date, today, with no warning and no audit trail (expenses) or with a self-declared author (vouchers).
- **The asymmetry is the finding:** the *drawer/cash* reconciliation is keyed on `expense_payments.created_at` (`day-close.ts:238-242`) while the *expense list and accounting reports* are keyed on the text `expenseDate`/`vouchers.date` (`expenses.ts:82-83,134-135`; `expenseV2Service.ts:654-655`). The same rupee is in two different days in two different screens of the same product, permanently, and neither screen flags it.
- `drawer_audit_log` declares a `post_close_override` action (`lib/db/src/schema/drawerAuditLog.ts:5`) that **no code ever writes** — the intent existed and was never wired.
- Note the policy constraint: this is a **LOCKED BUSINESS RULE** (#10/#11 as cited in `closureBoundary.ts:11-16`) — refunds against a closed period must not be blocked and must not require owner approval. Any remediation must therefore add **visibility and evidence**, not blocking, or it will violate a locked rule. See the decision list in the companion document.

---

## 13. RBAC findings (§17 of the brief)

Verified mounts (`artifacts/api-server/src/routes/index.ts`) and middleware (`src/middleware/requireStaffAuth.ts:84,251,274,303,320`; `FULL_ACCESS_ROLES = {admin, super_admin}` at `:26`; `requireSuperAdmin.ts:15`):

| Capability | Server-side gate today | Gap |
|---|---|---|
| Create/backdate an expense | `requireStaffAuth + requireStaffPermission("/accounting")` (`index.ts:530`) | **An ordinary accounting-tick holder can file an expense on any date**, with no reason and no audit row |
| Create a voucher | `requireStaffPermission("/accounting")` (`index.ts:497`) | no range check; frontend has no role gate either (`pages/Accounting.tsx:1360,1410` gate only on `isPending`) |
| **Re-date / edit a posted voucher** | same `/accounting` tick (`accounting.ts:292`) | **no zod, no approval, `editedBy` self-asserted** → no effective control |
| Bulk-import GL vouchers | `/accounting` (`accounting.ts:1390+`) | arbitrary dates, `performedBy` NULL ⚠ sweep |
| Modify bill discount / amounts | `/billing` + `requireStaffPermission("/billing","edit"/"delete"/"refund")` sub-permissions (`bills.ts:1371,1675,1896,1966`) + server-enforced discount ceiling (`:776-782,:1414-1421`) | **Good.** Several sibling mutations lack any inline sub-permission (`bills.ts:592` create, `:2502` cancel-test, `:2938` swap-test, `:1594` reprint-log, `:2133` change-doctor) |
| Close a day / a drawer | `requireStaffAuth` at mount; owner/admin inline (`day-close.ts:47 requireOwnerOrAdmin`, `OWNER_ROLES` `:703`) | reasonable |
| **Reopen a closed day** | `requireSuperAdminStaff` + reason (`:670-672`) | **Good** |
| Retag historical rows' ledger | super-admin raw SQL (`superAdminBooksHost.ts:24,74-79`) | no audit insert ⚠ sweep |
| Worklist status / studyDate push | internal API key (`internal-radiology.ts:448`) or `requireStaffOrInternalAuth` (`:363`) | no staff session ⇒ `actor` is body text (`:1256`) |
| TAT/SLA metrics push | `/radiology`-ish ⚠ sweep | client can rewrite `receivedAt`/`reportFinalizedAt` and thus erase an SLA breach |
| Clinical echo detail save | ⚠ sweep | body spread can set `created_at` |
| Change `createdAt`/`updatedAt` on money rows | **not possible from any route** | correct |

**UI-hiding-is-not-authorisation check:** the frontend does have genuine parity for bill edit/cancel/refund sub-permissions (`pages/BillDetail.tsx:676` ↔ `bills.ts:1371`; `:1523` ↔ `:1711-1714`; `:1469` reason-length ↔ `:1898` zod `min(3)`) — so the codebase is capable of parity; the date-authority surface simply has no control on *either* side. Actor names seeded from `readStaffSession()` in the client (`BillDetail.tsx:516-527`) are backed by session-preferred server logic (`bills.ts:1689,1980`) — correct, except where a body fallback is used when the session name is empty.

---

## 14. Findings register with risk classification (§18 of the brief)

### P0 — active integrity vulnerability

**F-01 · The general ledger's accounting date is freely re-datable by ordinary accounting staff, and the audit entry that would expose it names whoever the caller types.**
`vouchers.date` is `text` (`lib/db/src/schema/accounting.ts:58`); `POST` format-checks only (`routes/accounting.ts:45`); **`PATCH /vouchers/:id` has no request schema at all** (`:295`) and applies `updates.date = date` (`:311-312`) with `auditRows.push({ … editedBy, reason … })` taken from the same body (`:313`); the write is `db.update(vouchersTable).set(updates)` (`:353`); the gate is `requireStaffPermission("/accounting")` (`routes/index.ts:497`). Bank-statement import can post many such rows with `performed_by` NULL (`accounting.ts:1411,1469,1492`).
*Non-destructive repro strategy (test-only, never against production):* in a disposable database, as a staff session holding only `/accounting`, (1) create a voucher dated today, (2) PATCH it to `2020-01-01` with `editedBy: "some-other-person"`, (3) assert `vouchers.date` changed, assert `voucher_audits.edited_by` equals the typed string, and assert `voucher_audits.created_at` ≠ the typed date — demonstrating that the tamper-evident column exists but is not what anyone reads. Then (4) PATCH with `date: "not-a-date"` and assert it is accepted, which is the data-corruption half.

### P1 — staff can invisibly manipulate financial/clinical history

IDs below are the **same** IDs as the structured register in §14A.4; the register is authoritative for severity and for the twelve-field detail, and nothing here restates it loosely.

**F-02 · Expense and expense-payment business dates are client-controlled text with zero validation and no audit on date change.** `api.ts:3022,3041,3100,3113` (`zod.string()`), `routes/expenses.ts:346,399,268,412-417`, `lib/expenseV2Service.ts:301,330,510`, audit skip `routes/expenses.ts:524-530`, no-`expense_audits` table (verified absence), post-voucher lock narrow (`:495-506`).
**F-03 · A date-only expense edit is not audited at all.** `routes/expenses.ts:524-530` fires the audit call only on amount/mode/category change, so `expenseDate` changes fall through unlogged and the previous effective date is unrecoverable.
**F-04 · No view or flag distinguishes "belongs to yesterday" from "backdated today"** (the brief's central question). Ingredients exist (`created_at` + text date) but nothing computes the delta; no reason/approval columns anywhere.
**F-05 · Client can write a claimed creation instant into clinical detail rows** via unvalidated body spread — `echoCardiology.ts:164-178` (insert and update) and `usgDoppler.ts:143-152`, both lead-verified and both behind `requireStaffPermission("/radiology")` (`routes/index.ts:821`). It does **not** extend to `dicom_studies`, whose inline zod strips `createdAt`. Detail in §14A.4.
**F-06 · Raw-body spread into a learning/template table** — `.set({ ...req.body, updatedAt })` at `smartRadiology.ts:363` (`:460`, `:517` ⚠ sweep), gated by admin-or-radiologist (`:361`), so AI-teaching authorship is caller-chosen.
**F-13 · P1 after re-check (was P2) · Statutory PCPNDT/MTP form dates are unvalidated strings** (`routes/form-f.ts:279,392-397`, `schema/formF.ts:37-42`) — a legally sensitive date with no format or range integrity at all.
**F-30 · Turn-around-time / SLA history is client-supplied and derived client values drive it** — `POST /api/smart-radiology/tat-metrics/:studyId` (`routes/smartRadiology.ts:587-620`, lead-verified this pass): zod types `receivedAt`/`reportFinalizedAt`/`reportStartedAt`/`reportVerifiedAt` as optional free strings (`:590-593`), `totalTatMinutes` is computed from them (`:602`), and `slaBreached`/`isDelayed` are set from that computation (`:604,617-618`). The update branch overwrites the stored row, so one request rewrites a study's reported turnaround **and** its breach flag. Added during the precision pass: the earlier §14 draft carried this item under a number the register uses for something else.
**F-31 · Clinical audit and acknowledgement authorship is client-declared** — `radiology_audit_log.actor` takes `b.actor ?? "system"` from the body (`routes/internal-radiology.ts:1256`) on `POST /api/internal/radiology/report-status` (`:1001`), which is guarded only by the router-wide `requireStaffOrInternalAuth` (`:280,363`) — any valid staff JWT or the internal key, with no `/radiology` sub-permission on that route; and `patient_reports.criticalAcknowledgedBy` is read from the body (`routes/patient-reports.ts:2453`) while `criticalAcknowledgedAt` is correctly server-set (`:2459`). Added during the precision pass; the GL half of this pattern is F-01.

### P2 — manipulation visible but insufficiently controlled

**F-07 · P2 after re-check (was P1) · No database-level immutability on audit or record tables** — the only append-only triggers in the repository are on `study_snapshots` and `ai_shadow_drafts` (`migrations/add_ai_shadow_uniqueness_hardening.sql:82-97`, `add_ai_provisional_report_versioning.sql:40-43`); there is no `REVOKE` statement at all, and a super-admin path performs raw multi-table `UPDATE` with no audit insert (`superAdminBooksHost.ts:74-79`, lead-verified). Exploitation needs database credentials, hence P2 — see §14A.2.
**F-08 · `bills.dueDate` and the rest of the untyped text date columns are free-form with no range check** (lead recount: **52** `text()` columns whose declaration names a date, **46** with no database default; §17 has the command) — aging/collections can be shifted; `api.ts:1001`, `bills.ts:928,1398`.
**F-09 · No server-side future-date ceiling or historical floor exists on any date field** — the "clock forward" variant (Attack F) is unbounded.
**F-10 · Expenses/vouchers can be filed into a closed day while the cash/drawer view uses the server instant**, so the two views permanently disagree (§12). Visible only to someone who already knows.
**F-11 · Post-close edits are annotated rather than gated** (`bills.ts:1536-1550`) — acceptable per the locked rule, but there is no admin-facing query over those annotations, and the declared `post_close_override` drawer action is never written (`schema/drawerAuditLog.ts:5`).
**F-12 · Expense approval actor is a body field** (`expenses.ts:346` → `expenseV2Service.ts:303`).
**F-14 · `tests.price` has no change history** (verified absence of any price-history table).

### P3 — timezone / display inconsistency (the clinic's own clock disagrees with itself)

**F-15 · Server-side `toISOString().slice(0,10)` returns yesterday during 00:00–05:30 IST** despite the TZ pin (because `toISOString()` is always UTC). **Scale, lead-verified: 67 non-test occurrences of the `toISOString().slice(0,10)` / `toISOString().split("T")[0]` idiom exist in `artifacts/api-server/src`.** The ones that persist or print a date are the findings: `routes/fetalUsgLevel4.ts:707→712` (printed Report Date), `routes/usgReports.ts:612` (baked into permanent amendment text), `lib/usgObDopplerService.ts:58` (**persisted** studyDate), `lib/pacs/stampAccessionFromBill.ts:196-199,333` (Orthanc day window), `routes/pacsEnterprise.ts:1877`. The remaining sites are mostly filenames, archive names and display, but every one is a latent day-shift.
**F-16 · `created_at::date` casts resolve in the Postgres session TimeZone, which is pinned nowhere** (`routes/bills.ts:554-555` + verified absence of any session/cluster TZ setting) — bills can fall in different days depending on the query path.
**F-17 · Two day-boundary conventions in `routes/reports.ts`** (`:60-61` UTC vs `:101-108` +05:30; `:49` dead `now`) ⚠ sweep-read.
**F-18 · A bare DICOM date is asserted as `T00:00:00Z`** (`radiology-report-generator.ts:1499`, `radiologyD1FinalWriter.ts:399`) → ~5.5 h skew against any server instant.
**F-19 · `radiology_studies.studyDate` (server `date`, IST) and `radiology_worklist.studyDate` (pusher `text`) disagree by construction** and both are displayed.
**F-20 · Dashboard/DailySummary choose the reporting day from the browser clock** (`Dashboard.tsx:164,783`; `DailySummary.tsx:175-183`), and three `todayISO`/`todayIST` helpers with different authorities share the same name (§3.3).
**F-21 · Printed financial artefacts carry browser-clock stamps** (`SummaryExport.tsx` ×7, `Form3C.tsx:22,166`, `staffDayCloseSlip.ts:445`, `DayClose.tsx:382`).
**F-22 · `locale`-dependent persisted study dates** (`EchoCardiology.tsx:286`, `FetalEcho.tsx:216`, `UsgDopplerReporting.tsx:176`) ⚠ sweep.

### P4 — hardening / observability

**F-23** `updatedAt` (Node clock, explicitly overwritten ~298 times) is used as `audit.last_modified_at` inside persisted report artefacts (`radiologyD1DraftWriter.ts:247`, `:110,151` loose ISO validation; `radiologyD1FinalWriter.ts:420`; `structuredReport/types.ts:402`).
**F-24** Audit retention deletes rows and their `previousHash` links after archiving (`cron.ts:881-897`); chain verification across a deletion boundary is untested.
**F-25** No clock-drift monitoring or alerting exists for NAS/container/Postgres (see §15).
**F-26** `radiology_ai_review_audits.created_at` appears to be the only clinical audit timestamp declared without `withTimezone` ⚠ sweep (`schema/radiologyAiReviewAudits.ts:19`).
**F-27** `POST /api/sync/push` accepts `createdAt` in its change envelope (`routes/sync.ts:29`) and is currently a not-implemented stub (`:147`) — a future footgun.
**F-28** The repo's own contract test `securityPerfHardening.sourceContract.test.ts:44-48` enforces `todayIST` usage by regex — but only inside `api-server` files listed in that array, and nothing protects the browser.
**F-29** There is no business-time test harness. Across the whole repo only **two** test files use fake timers at all (`artifacts/api-server/src/lib/ai/legacyHoldFailSafe.regression.test.ts`, `artifacts/diagnostic-erp/src/lib/dialogDismiss.test.ts`) and neither exercises business-date or timezone authority; no test sets `process.env.TZ`. Hence the deterministic fake-clock plan in the companion document (§7) — without it, none of F-15/F-16/F-20 can be pinned.

---

## 14A. Structured findings register, severity policy and runtime unknowns

*(This section is authoritative for severity. §14 above is the narrative form; where the two differ, §14A wins. Stage numbers refer to the seven stages in the companion remediation plan.)*

### 14A.1 Severity policy actually used

- **P0** — an authenticated user can mutate **posted financial or statutory history** (or defeat reconstruction of who did it) through a reachable API path, and the trustworthy `created_at` does **not** save the meaning because reports and reconciliation key on the mutated field.
- **P1** — staff can make financial or clinical history differ from reality in a way that is **not detectable** from the data as presented to Admin, or can write a **false actor / false creation instant** into a record.
- **P2** — the alteration is possible and weakly controlled but leaves *some* usable evidence, or it is a correctness/reconciliation defect rather than an attack surface.
- **P3** — timezone/day-boundary or display defect that needs no attacker.
- **P4** — hardening, convention and observability.

**Explicit exclusions from this register.** A business date in the past is **not** a finding. An expense filed yesterday-but-entered-today with a reason, visibly flagged, is the *correct target design*, not a vulnerability. Nothing here describes any client-controlled business date as manipulation of the database `created_at` — the two are separated in every entry below. And because the remediation is **forward-only from a trusted cutover** (§1.2a scope note), this register is a statement about what the code allows *from here*: no finding below implies, licenses or requires correcting a historical row, and none is quantified by mining past rows for suspicion.

### 14A.2 Re-check outcome (what changed and why)

| Change | Reason |
|---|---|
| **F-07 P1 → P2** | Reachable only with direct database credentials, not through any application path (`created_at` is not writable from any money route — §10). It is a real defence-in-depth gap that makes every other finding unrecoverable *if* the DB is compromised, so it stays in the register, but it is not "staff can manipulate history" (the P1 definition). Also corrected: two tables **do** have append-only triggers (§16.7). |
| **F-13 P2 → P1** | PCPNDT Form F / MTP dates are statutory records; `procedureDate` is accepted as any non-empty string (`routes/form-f.ts:279`) and written verbatim (`:392-397`), so a statutory date field is neither type-safe nor range-bounded. Elevated on the data-corruption half, with one honest caveat: **whether an amendment to an already-issued Form F is audited was not traced in this pass** and is listed as an open item in §14B. |
| **F-05** sweep-only → **lead-verified** | Re-read `routes/echoCardiology.ts:149-158,164-178` and `lib/db/src/schema/echo.ts` directly; `req.body` is a compile-time cast only, the table declares `createdAt … .defaultNow()`, and Drizzle applies the default solely when the key is absent. Confirmed same shape at `routes/usgDoppler.ts:143-152`. Mounted with `requireStaffPermission("/radiology")` (`routes/index.ts:821`). |
| **dicom_studies** claim narrowed | `routes/dicomStudyManager.ts:195` uses an inline zod object, so unknown keys (including `createdAt`) are stripped before `.values({ ...b })`. Only `studyDate`/`studyTime` are client-controlled there — **not** a creation-injectable table. Corrected in §10 and §5. |
| **Smart Radiology template PATCH** gate added | `routes/smartRadiology.ts:361` requires **admin or radiologist** before `.set({ ...req.body, updatedAt: new Date() })` at `:363`. It is an attribution/authorship surface, not an ordinary-staff one. |
| **Scope clarified after the PR opened: FORWARD-ONLY** | Dr. Abinash fixed the remediation scope after reviewing #779: controls apply from a trusted cutover instant onward, to new records and new actions only. Nothing here licenses correcting, re-dating, reclassifying or normalizing historical rows, and no old row is flagged merely because `business_date < created_at`'s clinic day. Consequence for this document: **U-5 and U-6 are de-scoped from "prerequisite" to "only what migration/runtime compatibility needs"**, and every "Admin cannot detect it" statement below is about what the controls will make detectable *from cutover*, not a promise to produce a historical exception list. No finding and no severity changed as a result — the code paths described are the same ones; only the remediation contract did. |
| **Management decisions recorded; no severity changed** | After #779 opened, management settled several of the questions this audit escalated (plan §8 is now a status register): **DECIDED** — D-1 (business timezone `Asia/Kolkata`, business day `00:00:00`–`23:59:59.999` IST, "today" derived from trusted server/database time, workstation/browser clock never authoritative), D-4 (a closed period must not make a legitimate correction impossible → authorized correction + mandatory audit evidence + reason + higher authorization where applicable, and a correction must never rewrite historical audit evidence), D-5 (no business/effective date added to bills/payments — out of scope for Stages 0–6), D-12 (Business Time Integrity is a management/superadmin policy; Admin gets visibility, not the authority to weaken controls). **DECIDED IN PRINCIPLE** — D-3 (three tiers: current-day normal / authorized recent historical with recorded reason / exceptional-closed-period-high-risk with reason **plus** higher authorization; explicitly *not* superadmin approval for every legitimate historical transaction) and D-13 (forward-only; cutover stamped by a trusted server/database source at deliberate activation, append-only, never silently moved backwards, visible to superadmin/audit tooling). **PARTIAL** — D-2 (current business day is the normal case and historical entry is legitimate, but the **exact window is DEFERRED UNTIL STAGE 0**). **DEFERRED** — D-6, D-7, D-8, D-9, D-10, D-11. **No finding severity moved as a consequence of any of these rulings**: a chosen remediation policy does not change what the code was found to allow, and engineering has not filled in any deferred value on management's behalf. |
| **Counts corrected and made reproducible** | The three sweep counts in this register's first draft were re-derived with a single stated grep each (commands in §17). Final values: `text()` columns naming a date **52**, of which **46** carry no database default (an earlier draft said 67, then 53, using looser name patterns that also caught `day`/`period` tokens); `timestamp()` declarations **1012**, **331** without `.defaultNow()` or `$onUpdate()`; `date()` declarations **37**; browser day-slice idiom **73 occurrences in 44 non-test files** (replaces "62"); server day-slice idiom **67 occurrences in 36 non-test files** (unchanged, re-confirmed). The load-bearing evidence in every finding is the enumerated file:line list, never a total. |
| **F-30, F-31 added; narrative and register IDs aligned** | The first draft's §14 narrative used `F-04` for TAT/SLA and `F-06` for the three client-declared authorship paths, while §14A.4 used those numbers for two different findings — i.e. one document carried two meanings for the same ID. Both sections now use one mapping: `F-04` = the backdate-invisibility gap, `F-05` = clinical creation-instant injection, `F-06` = the `template_learning` body spread, and the two items that had no register entry (TAT/SLA; clinical audit/acknowledgement authorship) are registered as **F-30** and **F-31** with the full twelve fields. Finding count moves 29 → **31**. |

### 14A.3 Category taxonomy

| | Meaning | Findings |
|---|---|---|
| **A** | **actual creation/audit-instant manipulation** — a caller writes a false value into a column that is supposed to be the trusted instant | F-05, F-06 (authorship/timestamps), F-07 (if DB reached), F-27 |
| **B** | **business/effective-date control** — legitimate-vs-illegitimate re-dating, bounds, invisibility | F-01, F-02, F-03, F-04, F-08, F-09, F-10, F-11, F-13, F-14, F-30 |
| **C** | **timezone / day-boundary defects** — no attacker required, the clinic's own arithmetic disagrees | F-15, F-16, F-17, F-18, F-19, F-20, F-21, F-22, F-26 |
| **D** | **attribution / audit-evidence defects** — who-did-it and what-changes history | F-06, F-07, F-12, F-23, F-24, F-25, F-28, F-29, F-30, F-31 |

**Reading the taxonomy against the brief's four cases:** A = "actual creation-time manipulation" (case A), B = "business-date backdating", legitimate or not (case B), C = "timezone/day-boundary bug" (case C), D = "attribution/audit defect" (case D). No finding is placed in A unless a *trusted instant column* is writable, which is why F-30 (client-supplied operational instants feeding a derived SLA verdict, `created_at` untouched) sits in B+D and not in A.

### 14A.4 Structured register — every P0, P1 and P2 finding in full

*Each entry below carries the same twelve fields: finding ID · affected workflow · exact endpoint/write path · database field/table · current time authority · does workstation-clock manipulation matter · does direct API manipulation matter · current RBAC · current audit evidence · Admin detectability · exact non-destructive reproduction/test strategy · recommended remediation stage — plus, where the severity moved, why. Category A/B/C/D is in the entry's title line; **no entry describes a client-controlled business date as manipulation of `created_at`.***

**F-01 · P0 · B+D · Posted GL voucher re-dating with caller-supplied audit author**
- Workflow: accounting — edit of an already-posted voucher (receipt/payment/journal/contra).
- Endpoint / write path: `PATCH /api/accounting/vouchers/:id` → `routes/accounting.ts:295` destructures `editedBy, reason, date, amount, …` **straight from `req.body` with no request schema** → `:311-312 updates.date = date` → `:313` audit row built with the same body's `editedBy` → `:353 db.update(vouchersTable).set(updates)`.
- Database field / table: `vouchers.date` (`lib/db/src/schema/accounting.ts:58` — `text NOT NULL`, **no default**); evidence lands in `voucher_audits.edited_by` / `.reason` (`:90-92`).
- Current time authority: accounting date = **client-supplied string**; recorded instant (`vouchers.created_at`, `accounting.ts:79`) = Postgres `DEFAULT NOW()`, never written by code and not affected by this path.
- Workstation-clock relevance: indirect only — the normal UI seeds the field from the browser (`pages/Accounting.tsx:507,1328`), but the clock is not needed because the value is body-controlled outright.
- Direct-API relevance: **decisive** — no schema, so `date` may be any string, including `"not-a-date"`, `"2020-01-01"` or `"2035-01-01"`.
- Current RBAC: `requireStaffPermission("/accounting")` (`routes/index.ts:497`). No inline admin/super-admin check, no approval, no second person.
- Current audit evidence: a `voucher_audits` row *is* written with `changeType:'date'`, old and new values, and a DB-default `created_at`. So "something changed, and when we recorded the change" is trustworthy; **"who changed it" is whatever the caller typed**, and `reason` likewise.
- Admin detectability: partial and unrendered — the trail exists but nothing joins it to `vouchers.created_at`, and the actor column cannot be relied on.
- Why P0 rather than P1: three independent properties — (i) the *only* actor evidence for a change to posted financial history is spoofable, which defeats forensic reconstruction; (ii) the untyped write corrupts a posted GL field with values that break every downstream `::date`/lexicographic comparison; (iii) it is an *unauthorised mutation of already-posted history*, which is categorically different from entering a past effective date at creation time (that case is F-02 and is rated P1). Trustworthy `created_at` does not mitigate it, because accounting reports key on `vouchers.date`.
- Non-destructive reproduction strategy (disposable database only — see §14B): as a session holding just `/accounting`, PATCH a self-created test voucher to `"2020-01-01"` with `editedBy:"someone-else"`, assert `vouchers.date` changed and `voucher_audits.edited_by` equals the typed string while `voucher_audits.created_at` is the server instant; then PATCH with a non-date string and observe acceptance. No production row, no production DB.
- Recommended stages: **Stage 2** (add the missing request schema, session-derived actor, format/range validation, immutable audit evidence, append-only trigger), using the primitives **Stage 1** supplies; then **Stage 3** (approval policy for posted-period changes) and **Stage 6** (surface it).

**F-02 · P1 · B · Expense and expense-payment business dates are client-controlled and unbounded**
- Workflow: expense entry; expense payment / cash out.
- Endpoint: `POST /api/expenses` (`routes/expenses.ts:346` parsed body → `:399 expenseDate` → `lib/expenseV2Service.ts:301`), plus `POST /api/expenses/:id/payments` (`routes/expenses.ts:268` reads `paymentDate` off `req.body` **outside** the parsed object → `:283` → `lib/expenseV2Service.ts:510`), and `:415 paymentDate: typeof raw.paymentDate === "string" ? raw.paymentDate : null` → `expenseV2Service.ts:330`.
- Fields: `expenses.expense_date`, `expenses.invoice_date` (`schema/expenses.ts:26,44`), `expense_payments.payment_date` (`schema/expensePayments.ts:21`) — all `text NOT NULL` with no default.
- Authority: business date = client string; `created_at` = DB default, unaffected.
- Workstation clock: **yes, in the ordinary flow** — `pages/Expenses.tsx:174` seeds both from `new Date().toISOString().slice(0,10)` (which is also UTC-derived), `components/expenses/ExpenseDetailDrawer.tsx:100,133`.
- Direct API: **yes** — schema is `zod.string()` with no regex, no range (`lib/api-zod/src/generated/api.ts:3022,3041,3078,3100,3113`); grep for a `YYYY-MM-DD` guard in `routes/expenses.ts`/`lib/expenseV2Service.ts` returns none.
- RBAC: `requireStaffPermission("/accounting")` (`routes/index.ts:530`) — an ordinary accounting-tick holder.
- Audit evidence: none for the date. A post-voucher lock does exist and does reject date edits once accounting is linked (`routes/expenses.ts:485-504`, lead-verified: `hasLedger` computed from `voucherId`/`accrualVoucherId`/`accountingStatus`, then 400 on `paidTo`/`expenseDate`), and amount/payment-mode edits are blocked after save entirely (`:479-484`). So the exposure is the **unposted** expense, which is where F-03 bites; posted ledger history is protected by rejection, not by audit.
- Admin detectability: **no** — see F-03/F-04.
- Reproduction (disposable DB): POST an expense with `expenseDate` = 29-Sep while server is 30-Sep 08:42 IST; assert the row's `expense_date=2026-09-29` and `created_at=2026-09-30…`, then assert no UI/report shows the pair.
- Recommended stages: **Stage 2** (typed `date` + format/range validation + audit of date change), **Stage 3** (reason/policy), **Stage 6** (backdated-entries view).

**F-03 · P1 · D+B · A date-only expense edit is not audited at all**
- Workflow: correction/re-dating of an already-saved expense.
- Endpoint / write path: `PATCH /api/expenses/:id` → `routes/expenses.ts:465-471` builds `updates` from the parsed body → `:517-521` `db.update(expensesTable).set(updates)` → the audit block at `:528-530` fires **only** when `amountChanged || modeChanged || categoryChanged`.
- Database field / table: `expenses.expense_date`, `expenses.paid_to` (`lib/db/src/schema/expenses.ts:26,44`), `text NOT NULL`, no default.
- Current time authority: business date = client string; `expenses.created_at` = DB default and unaffected.
- Workstation clock: yes in the normal flow (the form's date field is browser-seeded, F-20/F-22 class), but the value is body-controlled. Direct API: **decisive** — the edit needs no clock trick at all.
- Current RBAC: `requireStaffPermission("/accounting")` (`routes/index.ts:530`).
- Current audit evidence: **none for a date change.** This is the whole finding: an expense moved from 30-Sep to 29-Sep after the fact leaves no trace, and no `expense_audits` table exists to leave it in.
- Scope limit found while finalising (this *reduces* the blast radius and is stated so the finding is not overstated): once accounting vouchers are linked, the date edit is **rejected outright** — `routes/expenses.ts:497-504` returns 400 on `hasLedger && (paidTo !== undefined || expenseDate !== undefined)`, and `:479-484` blocks amount/payment-mode edits after save. So the unaudited path is the **unposted** expense (DUE/PENDING/FAILED), not posted ledger history.
- Admin detectability: **no** — the previous date is unrecoverable even in principle.
- Non-destructive reproduction (disposable DB): create an expense dated 30-Sep with no voucher link, PATCH `expenseDate:"2026-09-29"`, assert 200 + the column changed + `audit_logs` gains **no** row for that expense; then link a voucher (or seed `accountingStatus:'POSTED'`) and assert the same PATCH now returns 400 — pinning both halves of the behaviour.
- Recommended stages: **Stage 2** (audit the date change like any other field; `effective_date_source`), **Stage 3** (reason + window), **Stage 6** (the delta view).

**F-04 · P1 · B+D · Nothing distinguishes "belongs to 29-Sep" from "entered 30-Sep, backdated"**
- Workflow: every module that stores a business date — expenses, expense payments, vouchers, payouts, staff salary/advance, registration/appointment, clinical forms.
- Endpoint / write path: all creation routes listed in §5/§6; there is no single endpoint to name because the gap is in the **data model**, not in one handler.
- Database field / table: the pair (`<anything>_date` text, `created_at timestamptz`) exists side by side on `expenses`, `expense_payments`, `vouchers`; on most other tables only one of the two exists. **No** `effective_date_source`, `reason`, `requested_by`, `approved_by` or `approved_at` column exists anywhere in `lib/db/src/schema` (verified absence).
- Current time authority: both columns are individually trustworthy; the *relationship* between them is never recorded and never computed.
- Workstation clock: not the mechanism — this is why the audit cannot answer the brief's §8 question either way. Direct API: same.
- Current RBAC: not applicable (no such decision exists to authorize).
- Current audit evidence: `voucher_audits` records a date *change* (with a spoofable actor, F-01); creation-time backdating produces no evidence at all in any module.
- Admin detectability: **no** — this is the audit's headline answer to "can Admin detect it": Admin can see the date, and can see `created_at`, but nothing anywhere joins them, so a legitimate late entry and a backdated one are byte-identical.
- Non-destructive reproduction (disposable DB): insert two expenses with `expense_date = 2026-09-29`, one created at 29-Sep 18:00 IST and one created at 30-Sep 09:00 IST; then run every existing reporting query (`routes/expenses.ts:82-83,134-135`, `routes/day-close.ts`, `routes/daily-summary.ts`) and show that no output distinguishes them. **This is the acceptance test the remediation must flip.**
- Recommended stages: **Stage 2** (derived delta + `effective_date_source`), **Stage 3** (source/reason/approval columns + policy), **Stage 6** (Admin views).

**F-05 · P1 · A · Clinical detail rows accept a client-supplied creation instant** *(lead-verified)*
- Workflow: echocardiography valve/wall assessment save; USG Doppler measurement update.
- Endpoint: `POST /api/echo-cardiology/valves/:studyId` — `routes/echoCardiology.ts:149-158` `const b = req.body as {…}` (a **compile-time cast, not a runtime schema**), `:175 db.insert(echoValveAssessmentTable).values({ studyId, ...b })`, `:169-171 .set({ ...b, updatedAt: new Date() })`; same shape `routes/usgDoppler.ts:143-152`.
- Fields: `echo_*.created_at` `timestamp withTimezone NOT NULL DEFAULT now()` (`lib/db/src/schema/echo.ts:74,100,117,159,177,248,266`) — Drizzle applies the default **only if the key is absent**, so an explicit `createdAt` in the JSON body is persisted verbatim; the update path can also re-stamp it via `{...b}`.
- Authority: becomes **client clock** for that row. `updated_at` is forced server-side on the insert path (`:196`).
- Workstation clock: irrelevant (direct body control dominates). Direct API: **decisive**.
- RBAC: `requireStaffAuth + requireStaffPermission("/radiology")` (`routes/index.ts:821`).
- Audit evidence: a local `audit(sReq, {entityType:"echo", action:"valve_assessment_saved", …})` row at `:177` — records *that* it was saved, not that the stored instant was caller-supplied.
- Admin detectability: only by comparing `created_at` against the audit row's own timestamp — no view does this.
- This is the register's **only confirmed category-A surface reachable by ordinary authenticated staff** (F-06 needs admin-or-radiologist, F-07 needs database credentials, F-27 is an unimplemented stub); the money tables are not (F-05 deliberately does not extend to `dicom_studies`, whose inline zod strips `createdAt` — see §10). F-30's TAT instants are the same *code* shape but are classified B+D rather than A, because `received_at`/`report_finalized_at` describe an operational fact about the study rather than CARE's own audit instant — the distinction is deliberate and is recorded in §14A.3.
- Reproduction (disposable DB): POST a valve assessment containing `createdAt:"2020-01-01T00:00:00Z"`; assert the returned row carries it.
- Recommended stage: **Stage 5** (clinical time-authority hardening — field whitelist so a stored instant can never come from the body), standing on the **Stage 1** invariant that no client-supplied instant becomes a CARE instant.

**F-06 · P1 · A+D · Raw-body spread into a learning/template table**
- Workflow: Smart Radiology finding-template teaching/feedback (`template_learning`).
- Endpoint / write path: `PATCH /api/smart-radiology/template-learning/:id` → `routes/smartRadiology.ts:361` role gate, `:363` `db.update(templateLearningTable).set({ ...req.body, updatedAt: new Date() })` — no field whitelist, no parsed projection. Same shape at `:460` and `:517` ⚠ sweep-read, not lead-verified.
- Database field / table: `template_learning` authorship columns (`createdById`, `createdByName`) plus any stored instant on that table; `updated_at` is server-forced in this handler (`new Date()`), the author fields are not.
- Current time authority: author identity = **client string**; `updated_at` = server Node clock.
- Workstation clock: irrelevant. Direct API: **decisive** for the author fields.
- Current RBAC: `requireStaffAuth` + an inline **admin-or-radiologist** check at `:361`, on top of the `/radiology` mount (`routes/index.ts:829`) — an elevated role, which is why this is "forgeable provenance", not "anyone can rewrite it".
- Current audit evidence: none on this path (no `auditFromRequest` in the handler).
- Admin detectability: no — the stored name is the only record of who taught the model.
- Why it matters clinically: CARE's AI-acceptance model attributes a suggestion to a human; if that attribution is body-supplied, the guardrail that makes AI text auditable is decoration.
- Non-destructive reproduction (disposable DB): as an admin session, PATCH a self-created learning row with `createdByName:"some-other-radiologist"`, assert it persists verbatim and that no audit row exists; confirm `:460`/`:517` in the same run, since they are sweep-read.
- Recommended stages: **Stage 5** (whitelist the update projection), **Stage 2**'s audit-evidence pattern (this route needs an audit row), **Stage 6**.

**F-30 · P1 · B+D · Study turnaround/SLA history is computed from client-supplied instants** *(lead-verified)*
- Workflow: Smart Radiology operational metrics — study receipt, reporting start, verification, finalisation, SLA breach status.
- Endpoint / write path: `POST /api/smart-radiology/tat-metrics/:studyId` → `routes/smartRadiology.ts:587` → zod `:589-594` (`receivedAt`, `assignedToRadiologistAt`, `reportStartedAt`, `reportVerifiedAt`, `reportFinalizedAt` all `z.string().optional()`, no format, no bound, no relation to server time) → `:598-604` `received = b.receivedAt ? new Date(b.receivedAt) : new Date()` … `totalTat = finalized - received` … `slaBreached = totalTat > threshold` → upsert `:608-620` (update branch) or `:624-637` (insert branch).
- Database field / table: `study_tat_metrics.received_at`, `report_started_at`, `report_verified_at`, `report_finalized_at`, `total_tat_minutes`, `report_tat_minutes`, `sla_breached`, `is_delayed` (`lib/db/src/schema/smartRadiology.ts:248-266`). `created_at`/`updated_at` (`:267-268`) are DB-defaulted and are **not** written by this path — so the recorded instant remains trustworthy and this finding must not be described as `created_at` manipulation.
- Current time authority: the operational instants become **whatever the caller sent**; the derived SLA verdict is a pure function of those.
- Workstation-clock relevance: yes in the normal UI flow (a client that stamps its own "finalized" time silently shifts the metric), but the value is body-controlled outright, so the clock is not required.
- Direct-API relevance: **decisive** — one POST with `receivedAt` far in the past converts a same-day report into a recorded SLA breach, and the reverse erases a real one.
- Current RBAC: `requireStaffAuth + requireStaffPermission("/radiology")` (`routes/index.ts:829`) — an ordinary radiology staff token; no admin, no approval, no second person.
- Current audit evidence: **none.** Neither branch writes an audit row; `updated_at` (`:619`) shows only that the row was touched, not by whom or with what claimed instants, and Drizzle's `$onUpdate` value is the Node clock (audit §16.4).
- Admin detectability: no — the previous `total_tat_minutes`/`sla_breached` pair is unrecoverable, and the aggregate view (`:576-584`) averages over the rewritten values, so a manipulated study silently moves the department's reported mean.
- Why P1 and not P2: it is an *invisible overwrite of persisted clinical-operational history* that also changes a compliance signal (breach counts) used for reporting; the counter-argument — TAT is an operational metric, not a financial or clinical-fact record — is honest, and is why it is not P0. `created_at` trustworthiness does not mitigate it, because nothing in CARE reads `created_at` for turnaround.
- Non-destructive reproduction strategy (disposable database only): as a `/radiology` staff session, POST `tat-metrics/<testStudyId>` with `receivedAt` = T−5 days and `reportFinalizedAt` = T−4 days, assert `slaBreached=true` and `totalTatMinutes≈1440`; re-POST with `receivedAt` = T−10 minutes, assert the same row now reports no breach and the original values are nowhere recoverable. Assert `created_at` unchanged throughout.
- Recommended stages: **Stage 1** (the `external_claimed_at` vs server `received_at` primitive), **Stage 5** (clinical time-authority hardening: server-derived instants, or labelled external claims), **Stage 2's audit-evidence pattern** (this route needs an audit row), **Stage 6** (TAT-tampering view).

**F-31 · P1 · D · Clinical audit and critical-result acknowledgement authorship is client-declared** *(lead-verified)*
- Workflow: (a) radiology worklist report-status transitions audited into the clinical audit log; (b) acknowledgement of a critical finding on a patient report.
- Endpoint / write path: (a) `POST /api/internal/radiology/report-status` (`routes/internal-radiology.ts:1001`) → `:1252-1258` `await audit({ …, actor: b.actor ?? "system", details: {…} })` → `:376-380` insert; (b) `POST /api/patient-reports/:id/acknowledge-critical` (`routes/patient-reports.ts:2450`) → `:2453` `const acknowledgedBy = typeof b.acknowledgedBy === "string" ? b.acknowledgedBy.trim() : ""` → `:2458-2461`.
- Database field / table: (a) `radiology_audit_log.actor` (`lib/db/src/schema/radiology.ts`, table used at `internal-radiology.ts:23,376`); (b) `patient_reports.critical_acknowledged_by` (`:2460`) — whose companion `critical_acknowledged_at` is correctly `new Date()` server-set (`:2459`).
- Current time authority: the *instant* is server-side in both paths (good); the **author** is a client string.
- Workstation-clock relevance: none — this is an attribution defect, not a date defect.
- Direct-API relevance: **decisive** — `actor` is read straight from the body and falls back to the literal `"system"`, so a real person's action can be recorded as machine-originated, and one staff member can sign another's acknowledgement.
- Current RBAC: (a) only the router-wide `requireStaffOrInternalAuth` (`internal-radiology.ts:280`, applied `router.use` at `:363`) — **any valid staff JWT or the internal API key**, with no `/radiology` sub-permission on `:1001`; (b) `requireStaffAuth + requireStaffPermission("/reports")` (`routes/index.ts:992`).
- Current audit evidence: path (a) *is* the audit evidence, which is the problem — the log's own author column is unauthenticated input. Path (b) writes no audit row at all; the ack columns are the only record.
- Admin detectability: **no.** Nothing joins `radiology_audit_log.actor` to the session principal that made the request, and nothing joins `critical_acknowledged_by` to a staff id — both are free-text names, so a forged entry is indistinguishable from a genuine one after the fact.
- Why P1 and not P0: the GL equivalent (F-01) is P0 because it forges the *only* actor evidence for a mutation of posted financial history; here the same defect sits on clinical-action and critical-result evidence, which is patient-safety-relevant and legally relevant but not an accounting record. Elevating both to P0 would flatten a real distinction; keeping F-31 at P1 states the risk without overstating it.
- Non-destructive reproduction strategy (disposable database only): as a staff session, POST `report-status` with `actor: "some-other-person"` and assert `radiology_audit_log.actor` equals it while `created_at` is the server instant; POST `report-status` with **no** `actor` and assert the row records `"system"` for a human action. Then POST `acknowledge-critical` with `acknowledgedBy: "Dr. Someone Else"` and assert it persists with a server instant beside it. Also assert `:2454` rejects an empty string (it does) — proving the field is validated for presence only, never for identity.
- Recommended stages: **Stage 2**'s session-derived-actor rule (shared primitive from **Stage 1**), **Stage 5** (clinical paths: `internal-radiology.ts:1256`, `patient-reports.ts:2453`), **Stage 6** (a view that shows session principal next to declared actor).

**F-07 · P2 (was P1) · A+D · No database-level immutability on audit or record tables**
- Workflow: every money, audit and clinical-record table, defence in depth rather than a live path.
- Endpoint / write path: **none** — this is not reachable through the application. It requires the database role directly (`psql`/connection string), which is why it is P2 and not P1 (§14A.2).
- Database field / table: `audit_logs`, `voucher_audits`, `bill_audits`, `expenses`, `bills`, `payments`, `radiology_audit_log` — no append-only guard, no `REVOKE`, no row-level protection. Guards exist only on `study_snapshots` and `ai_shadow_drafts` (§16.7).
- Current time authority: whatever the database holder decides.
- Workstation clock: irrelevant. Direct API: irrelevant — **the application cannot reach this**; a compromised or mis-privileged DB role can.
- Current RBAC: database privileges, unmeasured today (that is U-2).
- Current audit evidence: structurally impossible — deleting or re-stamping an audit row is exactly what the finding says is unprotected. The super-admin books-host path (`routes/superAdminBooksHost.ts:74-79`, lead-verified) shows the *application* can already perform multi-table updates with no audit insert, which is the milder sibling of this gap.
- Admin detectability: no, by definition — which is why F-24 (chain verification) is the compensating control and why its retention gap matters.
- Non-destructive reproduction (disposable DB only, never production): as CARE's own application role, `UPDATE audit_logs SET created_at = created_at - interval '1 day' WHERE id = <test row>` and `DELETE FROM audit_logs WHERE id = <test row>`; assert both succeed. Then run the same two statements against `study_snapshots` and assert the guard raises — proving the pattern the rest of the schema should adopt already exists in this repo. Pair with the read-only grant query in §14B U-2 so the *privilege* question is answered separately from the *trigger* question.
- Recommended stages: **Stage 2** (extend the two existing trigger patterns to the audit tables, gated on D-8), **Stage 6** (chain verification across retention gaps).

**F-08 · P2 · B · Untyped, unbounded business dates everywhere else**
- Workflow: bill due-date/aging and collections, equipment service/calibration day, vendor invoice day, purchase invoice day, leave and disciplinary dates.
- Endpoint / write path: `bills` create `routes/bills.ts:928` and edit `:1381,1398` (`dueDate` from the parsed body); `routes/machines.ts:447-448` (format-regex only) with retro-edit at `:480-483`; `routes/inventory.ts:205`; `routes/purchaseInvoices.ts:172`; HR leave/disciplinary writes accept any string.
- Database field / table: `bills.due_date` (`lib/db/src/schema/bills.ts:25`), `machines.service_date`, `inventory.invoice_date`, `purchase_invoices.invoice_date`, `leave.*`, `disciplinary.*` — `text`, no `CHECK`. Register-wide rule: **52** `text()` columns name a date, **46** with no default (§17).
- Current time authority: client-supplied string; `created_at` untouched.
- Workstation clock: yes in the ordinary flow (browser-seeded defaults, F-20 class) — but the value is body-controlled, so a clock change adds nothing an API call cannot do. Direct API: **yes**, format-only or no validation at all.
- Current RBAC: `/billing` (`routes/index.ts` bills mount), `/inventory`, `/machines`, `/hr` — ordinary module staff.
- Current audit evidence: **mixed, and this is what keeps F-08 at P2 rather than P1** — a `dueDate` change *does* produce a `bill_audits` row (`routes/bills.ts:1527` computes `dueDateChanged`, `:1537` gates the audit block, `:1560` records it; lead-verified this pass). Whether `machines.service_date` and the invoice-date edits produce audit rows was **not** traced individually; recorded as U-12 in §14B.
- Admin detectability: partial — bill due-date history is queryable, the others are unknown pending U-12.
- Non-destructive reproduction (disposable DB): `PATCH` a self-created test bill with `dueDate:"1900-01-01"`, assert acceptance and that `bill_audits` shows the old/new pair; then `PATCH` a test machine's `serviceDate` with `"not-a-date"` and assert the response, and check whether any audit row appeared (this half is the U-12 measurement, so the test asserts whatever the truth is rather than a guess).
- Recommended stages: **Stage 2** (one zod date schema + typed column where the semantics are a calendar day), **Stage 3** (bounds/window), **Stage 6** (per-module date-integrity digest).

**F-09 · P2 · B · No server-side floor or ceiling on any date**
- Workflow: all of the above plus expenses, vouchers, payouts.
- Endpoint / write path: every route that accepts a business date — there is no `.min()`/`.max()` on a date field anywhere in `lib/api-zod` or the route schemas; `routes/accounting.ts:45` checks *format* only.
- Database field / table: all business-date columns (both `text` and `date`/`timestamptz` ones — typing alone does not bound).
- Current time authority: client string, with no policy expressed in code.
- Workstation clock: not needed. Direct API: **decisive** — this is the finding that makes the brief's "clock forward" variant (attack F) unbounded.
- Current RBAC: per-module staff; **no role is asked to authorize an out-of-range date, because no range exists.**
- Current audit evidence: the events are audited where the module audits at all (F-01/F-03/F-08); the *range* question never arises.
- Admin detectability: none — a 1900 or 2035 date is just another row until someone sorts by date.
- Non-destructive reproduction (disposable DB): `POST /api/expenses` with `expenseDate:"1900-01-01"` and again with `"2035-01-01"`; assert both are accepted and both appear in the Daily Summary and expense lists without any flag. Then re-run the same calls with a far-future `vouchers.date`.
- Recommended stages: **Stage 2** (validation: format, type, parsed-body integrity only), **Stage 3** (the policy window — D-2 is PARTIAL: current-day entry is the normal case and historical entry is legitimate, but **the numeric window is DEFERRED UNTIL STAGE 0**, so no bound may be invented in either stage).

**F-10 · P2 · B+C · The same rupee sits in two different days in two screens of one product**
- Workflow: day-close drawer/cash reconciliation vs expense list and GL reports.
- Endpoint / write path: read paths — `routes/day-close.ts:238-242` keys on `expense_payments.created_at`; `routes/expenses.ts:82-83,134-135` and `lib/expenseV2Service.ts:654-655` key on the `expense_date`/`payment_date` text.
- Database field / table: `expense_payments.created_at` (server instant) vs `expenses.expense_date` / `expense_payments.payment_date` (client text).
- Current time authority: **two different authorities for one fact**, which is a design defect rather than an attack.
- Workstation clock: matters only indirectly (the client picks the text date). Direct API: matters for the expense half only.
- Current RBAC: `/accounting` + day-close roles (read-only paths).
- Current audit evidence: none is required — nothing is being hidden; both values are stored, and that is the point: the disagreement is *permanent and silent*.
- Admin detectability: only for someone who already knows the two bases differ; nothing in the UI or in any report says so (§12).
- Non-destructive reproduction (disposable DB): close day N; record an expense payment with `paymentDate = N` while the server instant is N+1; then read the Day-Close drawer total for N and the expense report for N and show the two totals differ by exactly that payment. No mutation, no production data.
- Recommended stages: **Stage 4** (declare one reporting basis per report and label it), **Stage 6** (show both dates side by side). **D-1 has since been decided** — the CARE business day is the IST day `00:00:00`–`23:59:59.999` from trusted server time — so what remains open is not *what a day is* but *which basis each report declares it is using*, and how `::date` resolution is settled (D-6, DEFERRED).

**F-11 · P2 · B+D · Day-close is an annotation, not a boundary — and the override evidence is dead code**
- Workflow: any edit or refund touching a period whose day has been closed.
- Endpoint / write path: `lib/closureBoundary.ts:11-16` (which states in its own comment that it is informational); three consult sites `routes/bills.ts:1536-1550`, `:1875-1888`, `:2115-2126` append `"[post-close edit: period closed at …]"` to the audit *reason string*; `:1446` returns `closedPeriodWarning: null` as an ordinary success. `expenses` and `accounting` never consult the closure at all.
- Database field / table: `day_closures.closure_date/covered_to_ts` (`schema/dayClosures.ts`), `audit_logs.reason` (a free-text field carrying a machine-meaningful marker), `drawer_audit_log.action` — whose declared value `post_close_override` (`schema/drawerAuditLog.ts:5`) has **zero writers** (lead-verified grep).
- Current time authority: the closure boundary itself is server-stamped and trustworthy (§12); what is missing is any consequence attached to it.
- Workstation clock: not the mechanism. Direct API: not the mechanism — this is a control/visibility gap, not an injection gap.
- Current RBAC: `/billing` sub-permissions for the edits; `requireSuperAdminStaff` + reason for reopen (`routes/day-close.ts:669-672`), which is correct.
- Current audit evidence: exists but is a **substring inside a reason field** — queryable only by pattern-matching prose, which is not evidence anyone will actually produce.
- Admin detectability: **no admin-facing query exists** over post-close edits; the declared override action that would have provided it is never written.
- Why it is P2 and not higher: not blocking a post-close refund is a **locked business rule** the repo records deliberately, so the current behaviour is defensible — the finding is that the compensating evidence was never built. **D-4 has since been decided by management** (plan §8): a closed period must not make a legitimate correction impossible, and the answer is an authorized correction with mandatory audit evidence — not silence, and not a universal hard block.
- Non-destructive reproduction (disposable DB): close a test day, edit a bill inside that period, assert 200 + the audit row's reason contains `[post-close edit:` + **no** `drawer_audit_log` row with `action='post_close_override'` exists; then run the same edit on an expense and assert the closure is not consulted at all.
- Recommended stages: **Stage 4** (the D-4 authorized-correction flow with its mandatory evidence, the dead audit action, one declared basis, post-close digest), **Stage 6** (the view). **D-4 is now DECIDED**, so this stage is gated only on Stage 2's evidence pattern and on D-6/D-1's remaining implementation mechanism.

**F-12 · P2 · D · An expense approval names whoever the body says**
- Workflow: expense approval.
- Endpoint / write path: `routes/expenses.ts:346` destructures `approvedBy` from the parsed body → `lib/expenseV2Service.ts:303` `approvedBy: input.approvedBy ?? null`; on the edit path, `routes/expenses.ts:506-515` applies a **real self-approval guard**.
- Database field / table: `expenses.approved_by` (text), plus `expenses.approved_at` if present (no approval-instant column for business dates exists anywhere — §14A's verified absence list).
- Current time authority: approver identity = **client string**.
- Workstation clock: irrelevant. Direct API: **decisive** for the identity.
- Current RBAC: `requireStaffPermission("/accounting")` (`routes/index.ts:530`).
- Current audit evidence: the approval leaves no audit row of its own on the create path.
- Precision from the finalising pass (this *reduces* the finding, and is stated so it is not overstated): the self-approval check at `:506-515` blocks `approvedBy` equal to `before.createdBy` when self-approval is disabled, and `createdBy` **is** server-set — so "the creator approves their own expense" is caught. What is *not* caught is naming a plausible colleague instead: the guard compares a server value against a client string, so it constrains one specific lie out of infinitely many.
- Admin detectability: no — the name is the only record, and it is unverifiable.
- Non-destructive reproduction (disposable DB): create an expense, PATCH `approvedBy:"a-colleague-name"` from a session that is neither that colleague nor the creator; assert acceptance and no audit row; then repeat with `approvedBy` equal to the creator and assert the 400 at `:512`, which pins that the existing guard works exactly as far as it goes.
- Recommended stages: **Stage 2** (session-derived actor), **Stage 3** (the approval model itself, D-3).

**F-13 · P1 (was P2) · B · Statutory PCPNDT / MTP form dates are free text**
- Workflow: Form F finalisation and its amendments — a statutory register entry under PCPNDT/MTP.
- Endpoint / write path: `routes/form-f.ts:279` `procedureDate: _z.string().min(1, …)` (presence only, no format), `:290,298,299` `mtpDate`/`consentDate`/`date` optional strings, written verbatim at `:392-397`.
- Database field / table: `form_f.procedure_date, consent_date, mtp_date, date` — `schema/formF.ts:37-42`, `text NOT NULL DEFAULT ""`.
- Current time authority: client string, and `""` is a legal stored value.
- Workstation clock: **yes** — the browser default is `toISOString().slice(0,10)`, i.e. UTC-derived (`components/radiology/PcpndtFormFFinalizeStep.tsx:38`, `pages/FormF.tsx:159`), so between 00:00 and 05:30 IST the form opens pre-filled with *yesterday* before any user touches it (F-15's persisting variant).
- Direct API: **decisive** — any non-empty string is accepted.
- Current RBAC: `requireStaffAuth + requireStaffPermission("/form-f")` (`routes/index.ts:991`).
- Current audit evidence: **not established.** Whether an amendment to an already-issued Form F writes an audit row was not traced in this pass; it is the open item **U-9**, and it is the reason this finding is stated as "statutory date neither typed nor bounded" rather than "statutory record can be silently rewritten".
- Admin detectability: unknown pending U-9; today no view surfaces a Form F whose stored date disagrees with its stored instant, and the `""` default means some rows have no date at all to disagree *with*.
- Why P1: data-corruption on a legally sensitive register (`"yesterday"`, `"30/09/2026"`, `""` and a 40-character string are all storable), plus the browser-derived pre-fill that makes wrong-by-one-day the *default* in the early-morning window. Not P0, because the corrupted value is one field of a clinical/statutory form rather than a posted accounting record, and because the creation instant of the row remains trustworthy.
- Non-destructive reproduction (disposable DB): as a `/form-f` session, finalize a test form with `procedureDate:"yesterday"` and assert it is stored verbatim; then, with the server instant set inside the 00:00–05:30 IST window in a harness, assert the browser-computed default is the previous day. Separately, and as the U-9 measurement, attempt an amendment of an issued form and record whether any audit row appears — **asserting whichever way the truth is, not assuming it**.
- Recommended stages: **Stage 2** (typed + format-validated), **Stage 1** (server-supplied clinic day for the browser default), then the statutory-record decision (§14B U-9, **D-9**) before any restatement of already-issued forms.

**F-14 · P2 · D · Test catalogue prices have no change history**
- Workflow: price list maintenance — the number that every later bill is priced against.
- Endpoint / write path: `PUT /api/tests/:id` → `routes/tests.ts:250-288`: zod-parsed body, `:259-261` `updateData.price = String(updateData.price)`, `:278-281` `db.update(testsTable).set(updateData)`; bulk import path at `:235` does the same for many rows. **No `audit*` call exists anywhere in either handler** (lead-verified by reading `:235-289`).
- Database field / table: `tests.price` (`lib/db/src/schema/tests.ts`), mutated in place; no `price_history`/`price_change` table exists (verified absence).
- Current time authority: no time authority at all over the *value* — the row's `updated_at` is the Node clock and Drizzle `$onUpdate`, explicitly overwritable (§16.4), and nothing records when a price changed.
- Workstation clock: irrelevant. Direct API: **yes** — the change is simply not evidenced.
- Current RBAC: `requireStaffAuth + requireStaffPermission("/tests")` for non-GET methods (`routes/index.ts:394-401`); any authenticated staff may read (`:398`).
- Current audit evidence: **none.** This is the clearest instance in the register of "the fact is stored, its history is not".
- Admin detectability: **no** — when a patient was billed at a price that no longer exists, nothing in CARE can show what the price was on that day, which also weakens every date-based dispute about billing accuracy (related to F-13's audit-coverage question and D-7's retention reasoning).
- Non-destructive reproduction (disposable DB): `PUT /api/tests/:testId` with a changed `price`, assert 200 and the new value, assert no `audit_logs` row exists for the entity, then attempt to reconstruct the previous price from any persisted source and show there is none.
- Recommended stage: **Stage 2** (price-change history as an append-only table with a session-derived actor). Not a business-date finding — it belongs in this register because it is a time-history *absence*, category D.

### 14A.5 Severity counts after the re-check

| Severity | Count | IDs |
|---|---|---|
| **P0** | **1** | F-01 |
| **P1** | **8** | F-02, F-03, F-04, F-05, F-06, F-13, F-30, F-31 |
| **P2** | **7** | F-07, F-08, F-09, F-10, F-11, F-12, F-14 |
| **P3** | **8** | F-15, F-16, F-17, F-18, F-19, F-20, F-21, F-22 |
| **P4** | **7** | F-23, F-24, F-25, F-26, F-27, F-28, F-29 |
| **Total** | **31** | F-01 … F-31 (F-15…F-29 are contiguous; F-30/F-31 were appended in the precision pass rather than renumbered, so every ID cited in the companion plan still resolves) |

Three notes on the arithmetic, so nobody reads a category error into it:
1. **F-15 stays a P3 finding** (it is a timezone defect with no attacker) **except** its persisting sub-case `lib/usgObDopplerService.ts:58`, which writes a UTC-sliced study date; that sub-case is described inside F-15 rather than double-counted.
2. **One finding, one ID.** F-01 carries the `voucher_audits.editedBy` spoofing; F-31 carries the clinical/acknowledgement equivalents; F-06 carries the `template_learning` body spread. The first draft's narrative lumped all three authorship paths into one ID, which would have made the P-count either 2 higher or 1 lower depending on how you read it.
3. **Legitimate historical entry is not counted at all.** No finding in this register exists merely because a past business date can be entered. F-02/F-08/F-09 are about *unvalidated, unbounded, unattributed* dates; the corresponding controlled design (reason + source + flag, visible to Admin) is the remediation target, not a vulnerability.

Where §14's narrative and this register still differ in *wording*, §14A wins, as stated at the top of this section.

---

## 14B. Runtime unknowns — kept as UNKNOWN, with the exact read-only checks

The audit made **no** runtime assertion about the live system. Every item below is unknown, must stay unknown until checked, and gates a specific conclusion.

| # | Unknown | What it currently affects | Read-only check (no writes, no DDL, no config change) |
|---|---|---|---|
| U-1 | **Live PostgreSQL `TimeZone`** | severity of F-16; whether `created_at::date` day buckets (`routes/bills.ts:554-555`) are IST or UTC | `psql -c "SHOW timezone;"` and `psql -c "SELECT now(), now()::date, current_setting('server_timezone');"` |
| U-2 | Whether the cluster/DB **role** used by CARE can UPDATE audit/money tables | F-07 | `psql -c "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('audit_logs','bills','payments','vouchers','expenses','voucher_audits');"` |
| U-3 | **NAS / host clock synchronisation and NTP state** | §15's clock-chain assumption; any drift would shift *all* trusted stamps together | on the NAS: `date +'%F %T %Z'`, `timedatectl` (or Synology equivalent), `ntpstat` / `chronyc tracking` — read-only |
| U-4 | **Container clock vs host clock** for the api-server and Postgres containers | same | `docker exec <api> date +%s%N` and `docker exec <db> date +%s%N` compared to host — read-only (no restart, no tz change) |
| U-5 | **Format-parseability already present in the text date columns** — *not* a historical quality census | only what the additive `effective_date` migration needs so a `date` cast cannot fail (plan §0/§6.1); and, at most, whether the 00:00–05:30 IST defect is live at all | `SELECT count(*) FILTER (WHERE expense_date !~ '^\d{4}-\d{2}-\d{2}$') FROM expenses;` and the same shape for `vouchers.date`, `expense_payments.payment_date`, `form_f.procedure_date` — **run inside a read-only transaction / replica**. Unparseable rows are **left exactly as they are** and listed for review; the number exists to plan a copy-plus-quarantine migration, never to justify a correction |
| U-6 | How many historical rows are backdated-but-unflagged | **explicitly NOT a remediation prerequisite** (plan Stage 0.5): the forward-only scope means pre-cutover rows are not classified, flagged or counted as exceptions. Retained as an audit-scale figure only, so the register's P1 ratings are not read as a claim about how widespread past damage is | available if ever requested, via the same delta query grouped by month and creator — but **not run as part of this programme**, and not surfaced in any Admin view (plan §4, T-35) |
| U-7 | Whether `audit_logs` chain verification currently **passes** over retained data | F-24 | invoke the existing verifier `verifyAuditChain` (`lib/audit.ts:223`) in a read-only/reporting context — no writes |
| U-8 | Whether any **non-browser client** (mobile, kiosk, gateway, integration script) already posts date fields that Stage 2's validation or Stage 3's window would reject | compatibility window in the plan's §6.9 | analyse the last N days of access logs for POSTs to `/api/expenses`, `/api/accounting/vouchers` and their payload key sets — read-only |
| U-9 | **Form F amendment audit** coverage (open item under F-13) | whether F-13 is a pure data-corruption finding or also an evidence gap | trace `routes/form-f.ts` update branches for an `auditFromRequest`/`audit_logs` call, and whether an issued form can be re-dated in place |
| U-10 | Whether `echo`/`usgDoppler` bodies in production traffic actually carry `createdAt` today | whether F-05 is latent or already exercised | grep API logs for `"createdAt"` in POST bodies to those routes — read-only |
| U-11 | Real user-facing impact of the 00:00–05:30 IST window (F-15) | how many artefacts were printed/imported with a wrong day | query rows created between 18:30 and 23:59 **UTC** of the previous day (= 00:00–05:30 IST) for the affected fields — read-only |
| U-12 | Whether `machines.service_date`, `inventory.invoice_date` and `purchase_invoices.invoice_date` edits produce audit rows (F-08's evidence field) | whether F-08 is "untyped dates" only, or also an evidence-absence finding like F-14 | static trace of `routes/machines.ts:447-483`, `routes/inventory.ts:205`, `routes/purchaseInvoices.ts:172` for an `auditFromRequest`/`audit_logs` call — read-only, no runtime change |
| U-13 | Whether production traffic actually posts TAT instants today, and from which client (F-30) | whether F-30 is latent or already the normal data path, and whether `received_at` in `study_tat_metrics` currently *agrees* with `dicom_studies` receipt times | compare `study_tat_metrics.received_at` against `dicom_studies.created_at` for the same `study_id`, and grep access logs for `POST /api/smart-radiology/tat-metrics/` — read-only SQL + log analysis |

**Standing UNKNOWN from the attack matrix:** nothing in §9 needs runtime confirmation for its *code-level* verdict, but the *production* consequence of F-16 (U-1), the scale of F-02/F-08 (U-5/U-6) and now three more — F-13's amendment auditing (U-9), F-08's evidence coverage (U-12) and F-30's live usage (U-13) — are explicitly unresolved, and this audit does not claim otherwise. **Thirteen unknowns (U-1 … U-13) are carried forward, none of them answered by inference.**

---

## 15. Server-clock compromise, drift and the authoritative chain (§12 of the brief)

**The real chain is:** NAS host clock → Docker/container clock → (Node `process.env.TZ=Asia/Kolkata` reinterpreting that clock) → `new Date()` in the API, and *in parallel* → Postgres `DEFAULT NOW()`. Both endpoints of that fan-out read the **same container clock**; the TZ pin changes only the *interpretation*, never the instant.

Consequences:
- **If the NAS/container clock is wrong, everything trusted shifts together.** `created_at`, `signedAt`, `closedAt`, `cancelledAt`, and the hash-chained `audit_logs.created_at` all move as a block, so **the audit trail cannot self-detect clock error** — there is no independent second clock in the design to compare against. A backdating attack that is executed *by moving the server clock* is stronger than any workstation attack and currently invisible.
- **If only Postgres's zone differs from Node's TZ** (very likely, since nothing pins it — §8/§16), then `created_at::date` and any `date_trunc`/`::date` grouping silently disagree with every JS-side IST day computation. This does not need an attacker; a UTC-initialised container plus a 04:00 IST entry reproduces it.
- **If NTP fails / the clock steps**, monotonic assumptions break: `bills.ts:676` uses a 60 s window described as "tenSecondsAgo" for idempotency, `routes/radiology.ts:291` uses a 48 h cutoff, and `day-close.ts:478` relies on an advisory lock rather than a clock — the first two are clock-sensitive.
- **The `TZ` pin itself is fragile**: it lives in two source lines (`index.ts:8`, `worker.ts:5`); if a future runtime, job, migration script, or the D1 writer is executed in a process that does not import them first, local-time idioms silently revert to UTC. Anything that computes a date with `getFullYear()`/`getMonth()`/`getDate()`/`toLocaleDateString()` without an explicit `timeZone` depends on it (e.g. `lib/pacs/publishRadiologyStudyToMwl.ts:26-31`, `accounting.ts:149-150` voucher numbering period).
- **External clocks**: bank providers and the modality/Dicom Agent are separate, unverifiable clocks (F-05/§10); they must never be laundered into CARE authority. `dicomAgent.ts:530,537` currently accepts device `capturedAt`/`retrievedAt` with a NaN check only.

**Detection architecture to recommend (no changes made here):** (a) record `serverTime` + `clientTime` on every money-relevant POST into a *separate* comparison table, and alert on a persistent client-vs-server offset exceeding a threshold; (b) expose a `GET /api/health/clock` returning `Date.now()`, `new Date().toISOString()`, `Intl.DateTimeFormat(...timeZone:"Asia/Kolkata")`, `SHOW timezone`, and NTP sync status from the host; (c) emit `time_received` (Postgres `now()`, insert-side) plus `time_processed` (Node) for each financial write, so the two clocks cross-check each other continuously; (d) alert on any backward jump in `MAX(audit_logs.id → created_at)`; (e) never trust the workstation: it is already recorded in `userAgent`/`ipAddress` (`lib/audit.ts:100-104`) so a client-vs-server day disagreement is computable from existing columns.
All of these are **observability additions** — they do not change any write semantics.

---

## 16. Database-integrity observations (§13 of the brief)

1. **Strong:** money tables' `created_at` are `timestamptz NOT NULL DEFAULT now()` and no route supplies them → Postgres is the authority. `payments` has exactly one time column, which is the correct minimal design.
2. **Weak:** 331 of 1012 `timestamp()` declarations have neither `.defaultNow()` nor `$onUpdate()` — the application *must* supply an instant, and the application clock is Node, not Postgres (`voidedAt`, `reversedAt`, `verifiedAt`, `banking.transactionDate`, `emergencyBilling.originalCreatedAt`…). For security-relevant ones (void, reverse, verify) a DB default would be strictly stronger.
3. **Weak:** **52 `text()` columns name a business date, 46 of them with no database default and none with a check constraint** — the DB cannot enforce a calendar, a format, or a "not after today" policy. `date`/`timestamptz` + a `CHECK` would. (The 52/46 rule and the earlier 67/53 variants are reproduced in §17; the finding rests on the enumerated names in §3.2, not on the total.)
4. **Drizzle's `$onUpdate(() => new Date())` is not `@updatedAt` semantics from Postgres** — it is app-supplied and can be (and is) overwritten explicitly, so `updatedAt` must not be used as an audit value (F-23).
5. **Schema-vs-database drift:** `lib/db/src/schema/reportFindingInstances.test.ts:21` explicitly documents that column defaults exist "server-side SQL" (i.e. in `migrations/`), not in the Drizzle declaration. So "does this column have a default?" cannot be answered from `lib/db/src/schema` alone — the deployed DDL must be inspected. The 181 `migrations/*.sql` files are the real authority, and any remediation must verify defaults against the **live** DDL, not the TS.
6. **No `createdAt` update path exists for the money tables** (verified by the object-spread sweep and the field-by-field insert lists). `createdAt` can be updated only with direct database access (F-07).
7. **Immutability exists as a pattern, but only for the AI tables.** Across all 181 `migrations/*.sql` files, `CREATE TRIGGER` appears in exactly three: `add_ai_shadow_uniqueness_hardening.sql:82-97` (a `BEFORE UPDATE OR DELETE` guard on `study_snapshots` that rejects content changes while allowing `is_current`/`superseded_at`, and a statement-level `BEFORE TRUNCATE` guard on `ai_shadow_drafts`), `add_ai_provisional_report_versioning.sql:40-43` (`BEFORE UPDATE OR DELETE` → "append-only" for `ai_shadow_drafts`), and `seed_mri_protocols.sql:63-66` — which are ordinary `updated_at` maintenance triggers, **not** immutability. There is **no `REVOKE` statement anywhere**, and no guard of any kind on `audit_logs`, `voucher_audits`, `bill_audits`, `expenses`, `bills`, `payments` or the clinical audit tables (F-07). The correct reading is therefore not "CARE has no immutability" but "CARE has built immutability twice, for the AI store, and has not applied it to the places this audit is about" — which is what makes Stage 2's guard cheap: the pattern is already in the repo, including the TRUNCATE case that row-level triggers miss.

---

## 17. Evidence index and verification log

**Verified line-by-line by the lead agent (citable as-is):** `artifacts/api-server/src/index.ts:8` (TZ pin) · `src/lib/istDate.ts:12-45` · `src/routes/expenses.ts:264-270, 344-348, 396-401, 412-417, 495-506, 524-530` · `src/lib/expenseV2Service.ts:298-304, 327-332, 506-512` · `lib/api-zod/src/generated/api.ts:3022,3041,3078,3100,3113` (`expenseDate: zod.string()`) · `src/routes/accounting.ts:45, 253-268, 290-316, 353, 1411, 1469, 1492` · `lib/db/src/schema/accounting.ts:55-60, 76-80, 87-97` · `lib/db/src/schema/bills.ts:25, 47-48, 84-90` · `src/routes/smartRadiology.ts:588-612` · `src/lib/closureBoundary.ts:1-20` · `src/lib/audit.ts:100-130, 136-150` · `src/cron.ts:870-900` (archive-then-delete) · `src/routes/internal-radiology.ts:1252-1258` · `src/routes/dicomStudyManager.ts:268-275` · `src/routes/usgReports.ts:610-614` · `src/routes/bills.ts:554-555` · `src/routes/echoCardiology.ts:169-177, 193-199` · `artifacts/diagnostic-erp/src/pages/Expenses.tsx:172-186, 474-497` · `src/pages/Dashboard.tsx:162-172, 781-785`.

**From parallel semantic sweeps — high confidence but re-read before acting (⚠ sweep-only above):** `routes/staff.ts:160,226,234` · `routes/pacsEnterprise.ts:1054,1804,1877,1930` · `lib/usgObSection.ts:81,101` · `routes/radiology.ts:948,1050,1301-1303,1401,2312` · `routes/patient-reports.ts:877,1064-1080,2185-2189` · `lib/criticalFindingsAlert.ts:92-94` · `lib/radiologyD1DraftWriter.ts:110,151,247` · `lib/radiologyD1FinalWriter.ts:301,399,420,430` · `lib/radiologyD1AmendmentWriter.ts:187` · `routes/radiology-report-generator.ts:1499,1580-1662,1730-1755,2263,2443,3519-3541` · `routes/index.ts:232,375,420-441,497,530,542-544,745-756,821-838,992,1062` · `src/middleware/requireStaffAuth.ts:26,84,251,303,320` · `lib/db/src/schema/{radiology,radiologyWorklist,radiologyAiReviewAudits,emergencyBilling,banking,dayClosures,userDayClosures,drawerAuditLog,vouchers,doctorPayouts,formF,patients,orders,purchaseInvoices}.ts` · `docs/FINANCIAL_STABILIZATION_PLAN.md:12`.

**Added or upgraded to lead-verified during the precision pass (this is the second, finalising audit pass, so re-reading was done explicitly rather than relying on sweep output):** `routes/smartRadiology.ts:587-620` and `:829` mount → F-30 · `routes/internal-radiology.ts:280,363,1001,1252-1258,376-380` → F-31 · `routes/patient-reports.ts:2450-2461` and its `routes/index.ts:992` mount → F-31 · `routes/superAdminBooksHost.ts:74-79` → F-07 · `lib/db/src/schema/smartRadiology.ts:240-268` (TAT columns and their defaults) · `migrations/add_ai_shadow_uniqueness_hardening.sql:67-97` and `migrations/add_ai_provisional_report_versioning.sql:33-46` and `migrations/seed_mri_protocols.sql:63-66` → §16.7's trigger inventory.

**Every count in this document, with the command that reproduces it** (run from the repository root, `bash`):

| Count | Value | Command |
|---|---|---|
| server day-slice sites | **67** occurrences in **36** non-test files | `grep -rn --include=*.ts -E 'toISOString\(\)\s*\.(slice\(\s*0,\s*10\s*\)\|split\("T"\)\[0\])' artifacts/api-server/src \| grep -vE '\.test\.ts:'` |
| browser day-slice sites | **73** occurrences in **44** non-test files | same pattern over `artifacts/diagnostic-erp/src` with `--include=*.tsx`, excluding `*.test.ts(x)` |
| `text()` business-date columns | **52** declarations, **46** with no default | `grep -rnE '\btext\(' lib/db/src/schema/*.ts \| grep -iE 'date'` (add `\| grep -icE default` for the 6 that have one) |
| `timestamp()` declarations | **1012** total, **331** without `.defaultNow()`/`$onUpdate()` | `grep -rhoE '\btimestamp\(' lib/db/src/schema/*.ts \| wc -l`; `grep -rnE '\btimestamp\(' lib/db/src/schema/*.ts \| grep -vE 'defaultNow\|\$onUpdate' \| wc -l` |
| `date()` declarations | **37** | `grep -rhoE '\bdate\(' lib/db/src/schema/*.ts \| wc -l` |
| client date inputs | **130** `type="date"` in **53** files, **0** carrying `max`/`maxDate` | `grep -rn --include=*.tsx --include=*.ts 'type="date"' artifacts/diagnostic-erp/src \| grep -vE '\.test\.'` |
| migrations containing `CREATE TRIGGER` | **3** files, of which **2** are immutability guards | `grep -rln 'CREATE TRIGGER' migrations/` |
| fake-timer tests in the whole repo | **2** files, neither about business time | `grep -rl 'useFakeTimers' --include=*.ts --include=*.tsx artifacts lib` |

Earlier drafts of this audit quoted **62** browser day-slice sites, **67** then **53** text date columns, and **1011/330** timestamps; the table supersedes all of them, and §14A.2 records why they moved. **No count in this audit changes a severity** — every P0/P1/P2 conclusion rests on an enumerated `file:line` above, and the counts exist to size remediation effort, not to prove a vulnerability.

**Verified absences (these are findings, not gaps in the search):** no `expense_audits`/`bill_audits`-for-expense table · no price-change history · no approval/approver/approval-instant columns for business dates · no `backdated` flag or delta view · no server-side date range validation (`.min()`/`.max()`) on any date field · no Postgres session/cluster timezone pin in `lib/db`, `api-server`, or `migrations/*.sql` · **no `REVOKE` statement anywhere, and no append-only guard on any audit, financial or clinical-record table** (guards exist only on `study_snapshots` and `ai_shadow_drafts`, §16.7) · no deterministic fake-clock tests · no `clinicTodayIST`/`businessDay`/`startOfDay` helper · no blocking check anywhere against a closed day · `post_close_override` audit action declared but never written · ERP `criticalSlaStartedAt` never persisted.

**No file, schema, route, database, container, deployment or pull request was modified by this audit or by this finalising pass.** The only writes were these two new documents under `docs/audits/`.
