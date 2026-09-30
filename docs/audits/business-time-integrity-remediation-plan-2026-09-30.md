# CARE ERP — Business-Time Integrity: Staged Remediation Plan

Date: 2026-09-30 · Status: **PROPOSAL ONLY — nothing in this document is implemented, scheduled or merged.**
Evidence base: `docs/audits/business-time-timezone-integrity-audit-2026-09-30.md` (finding IDs `F-01 … F-31` are referenced throughout; read that document first — §14A there is authoritative for severity and for the twelve-field detail of each finding).
Authority vocabulary (identical to audit §1.2a — five concepts, never collapsed into one another): **AUTHORITATIVE EVENT / RECORDED-AT** (the trusted server/database instant of when CARE received it) · **BUSINESS / EFFECTIVE DATE** (the calendar day the transaction belongs to) · **AUDIT TIMESTAMP** (trusted, immutable server/database instant) · **DISPLAY TIMEZONE** (`Asia/Kolkata` presentation and business-boundary concern) · **CLIENT CLOCK** (untrusted; never authoritative, at most a default or a label).

---

## 0. Two anti-goals (please read before §1)

1. **Do not "fix" this by replacing every `new Date()` with `clinicTodayIST()`.** That would convert a trust problem into a naming problem: the browser would still be the one deciding which day money belongs to, and the resulting code would look correct while the vulnerability stayed open. The audit's core finding is a *missing authority*, not a *missing helper*. (`lib/istDate.ts:12` already exists and is correct — and `routes/expenses.ts` still accepts `"2020-01-01"` from a body, which is exactly why the helper alone never was the fix. F-01/F-02.)
2. **Do not introduce blocking controls that collide with a LOCKED BUSINESS RULE.** `lib/closureBoundary.ts:11-16` records that a refund against a closed period must never be blocked and must never require owner approval. Every control proposed below is therefore **evidence + visibility + separate accounting**, not a gate — except where the decision is explicitly escalated to management in §8.

---

## 1. Recommended canonical time model

### 1.1 Four columns, four jobs, never collapsed

For every record that carries a business date, the target shape is:

| Column | Type | Authority | Written by | Mutability | Purpose |
|---|---|---|---|---|---|
| `recorded_at` (or existing `created_at`) | `timestamptz NOT NULL DEFAULT now()` | **Postgres** | database | **never updated** | EVENT INSTANT — the answer to "when did CARE actually receive this" |
| `effective_date` | `date NOT NULL` (+ `CHECK`, §1.3) | **server-validated client request** | API, after policy check | update only through the backdate workflow (§2) | EFFECTIVE/ACCOUNTING DATE |
| `effective_date_source` | `enum(text) NOT NULL DEFAULT 'default_today'` | server | API | append-only | one of `default_today \| staff_selected \| backdated_within_policy \| backdated_approved \| imported_from_feed \| corrected_by_admin` |
| `effective_date_reason` / `…_requested_by` / `…_approved_by` / `…_approved_at` | `text` / actor id / actor id / `timestamptz` | server + session | API | append-only | the D-concept the audit found missing entirely (F-03) |

`updated_at` stays as-is (an operational "row last touched" marker) but **must be demoted from audit duty**: the report artefact `audit.last_modified_at` should be fed from a dedicated, append-only event column instead (F-23).

### 1.2 Two clocks, kept deliberately distinct

CARE currently fans one Node clock out into every use. The model should be:

- **`time_received`** — Postgres-side, set by `DEFAULT now()`/`statement_timestamp()`, immune to Node/PM2/worker runtime differences.
- **`time_processed`** — Node-side, recorded next to it on financial writes.

They should agree within a tolerance, and *the disagreement is itself the monitoring signal* (§5 Stage 0 and §7). Neither is derived from a client value, and neither is ever the business date.

### 1.3 Where the database can carry more of the load

| Now | Target | Why |
|---|---|---|
| `vouchers.date text` (`lib/db/src/schema/accounting.ts:58`) | `date NOT NULL` + `CHECK (effective_date <= current_date + interval '1 day')`-style policy bound | F-01: the GL's accounting date is currently any string (`accounting.ts:295,311`) |
| `expenses.expense_date text`, `expense_payments.payment_date text`, `doctor_payouts.payment_date text` | `date NOT NULL` | F-02/F-14 |
| `bills.due_date text`, `recall.due_date text`, `appointments.appointment_date text`, `online_bookings.selected_date text`, `machines.service_date text`, `form_f.*_date text` | `date` (compact DICOM forms keep their own `text` and are *parsed*, never trusted) | F-08/F-13 |
| no `CHECK` on any date | policy bounds (§3) | F-09 |
| append-only guards exist on exactly **two** tables in 181 migrations (`study_snapshots`, `ai_shadow_drafts` — `migrations/add_ai_shadow_uniqueness_hardening.sql:82-97`, incl. a `TRUNCATE` guard); no `REVOKE` anywhere (F-07) | the same trigger pattern extended to `audit_logs`, `voucher_audits`, `*_report_amendments`, `radiology_audit_log`, `dicom_study_audit_log` | makes immutability a database property, not an application convention — and the repo already contains the pattern to copy |
| Postgres session/cluster timezone pinned nowhere (F-16) | explicit, documented cluster `timezone` **or** ban `::date` casts (§6.3) | removes the two-authoritative-clocks ambiguity |

### 1.4 A single clinic-day function

One exported helper per side, both explicit-zone, both tested:
- server: keep `lib/istDate.ts:todayIST()` as the *only* way to name a clinic calendar day from an instant (delete the `todayISO()` alias at `routes/radiology.ts:105` so one name = one meaning).
- client: **the browser computes no clinic day at all for any persisted value.** It receives today's clinic date from the server (`GET /api/time/now` → `{ serverNow, clinicDate, zone }`) and seeds its pickers from that (this deletes the `Expenses.tsx:174` / `ExpenseDetailDrawer.tsx:100,133` / `Staff.tsx:306,405` / `Accounting.tsx:507` class). Display-only helpers (`Dashboard.tsx:164`, `DailySummary.tsx:175`) may keep local formatting but must not select which day to query from an unsynchronised clock.
- rule: **no `toISOString().slice(0,10)` anywhere in `api-server/src`** for a persisted or printed value (F-15 list), enforced by the contract test extended to the browser (F-28).

---

## 2. Backdating policy model (the shape, not the numbers)

Ordinary staff:
- see **today (server-supplied) as the default and the ceiling** — no future effective date, no unexplained past date;
- may select a past effective date inside a *policy window* (e.g. "same accounting month", "≤ N days") **and must supply a reason**;
- are told on screen, before saving, that the record will show "effective <date> · entered <server instant>".

Authorised roles:
- may set an effective date beyond the ordinary window, still with a mandatory reason;
- cannot make the record *look* like it was entered on that date — the two columns are independent by construction (§1.1).

Sensitive historical entries (money already closed/reconciled, statutory PCPNDT/MTP dates, posted GL vouchers):
- require reason **and** a second-person approval recorded as `approved_by` + `approved_at` (server-stamped) — or, where the locked rule forbids blocking, an approval recorded **after** the fact with the entry visibly flagged until then (§8 decision D-4).

Every backdated entry, always:
- keeps the immutable `recorded_at`;
- stores `effective_date_source` and reason;
- is *labelled in the UI* and *queryable* (§4);
- writes an append-only audit row whose **actor comes from the session, never the body** — the fix for `accounting.ts:295,313` (F-01), `internal-radiology.ts:1256` and `patient-reports.ts:2452` (F-31).

**Business windows that CARE legitimately needs historical entry for, and which must not be broken:** late expense invoices (vendor bill arrives a week later), prior-month salary/advance corrections, referral commissions settled retrospectively, bank statement import with the bank's own transaction date (`banking.transactionDate`, external clock — keep, but label `imported_from_feed`), and offline/emergency billing capture whose device instant must be preserved *alongside* CARE's receipt instant (`emergencyBilling.originalCreatedAt` + `importedAt` is already the right pattern — generalise it, F-20/§1.1).

Where the repository does not tell us what the policy should be, it is escalated rather than invented (§8).

---

## 3. Staged plan — seven stages, seven separate PRs

**Rule for whoever executes this: one stage per pull request, in this order, each independently revertible.** A combined "time integrity" PR is unreviewable, cannot be rolled back without taking the P0 fix with it, and would put a schema migration and a behaviour change in the same blast radius. Stages 0 and 1 change no product behaviour at all; that is deliberate — they are what makes the later stages provable.

### Stage 0 — Runtime verification and characterization tests (no schema change, no behaviour change)

The audit is a static reading of the repository. Thirteen things it could not determine from code are listed as `U-1 … U-13` in audit §14B, each with its exact read-only command. Until they have values, several severities below are provisional and two decisions (D-6, D-8) cannot be scoped.

1. Run the thirteen read-only checks in audit §14B — live `SHOW timezone`, `SELECT now(), now()::date`, role-vs-table privilege grants on `audit_logs`/`bills`/`payments`/`vouchers`/`expenses`, NAS/container clock source, NTP offset, the deployed DDL defaults for the columns named in §1.3, the dirty-value scans on the text date columns, and the two static traces (U-9 Form F amendment auditing, U-12 machine/invoice date auditing). Paste outputs into a verification note in the repo. **Nothing below is scheduled until U-1, U-2 and U-3 return real values.**
2. Land the §7 harness with the **current** behaviour asserted (characterization tests): T-01…T-05, T-09, T-10 and T-25 run against today's code and are expected to *document the bug*, e.g. T-09 asserts that a malformed voucher date is accepted right now. When Stage 2 flips the behaviour the assertions are updated in that PR, deliberately, so a reviewer sees the change of contract rather than a silently-green suite.
3. Add `GET /api/time/now` returning `{ serverNowIso, clinicDateIst, zone: "Asia/Kolkata", dbNowIso, dbShowTimezone }` — read-only, no auth beyond the existing staff session. It is simultaneously the first real cross-clock check (fills the audit §15 monitoring gap), the measurement instrument for Stage 6's drift alerting, and the server-supplied clinic day that Stage 1 hands to the browser.
4. Instrument but **do not enforce**: log `body date`, `server clinicDate`, `actor`, `route` into a new append-only `date_source_log` for every route that accepts a body date. One full accounting cycle of this is what tells us who would be broken by Stage 2's validation and Stage 3's window (also the input to §6.9's compatibility window).
5. Produce the two numbers the plan depends on: how many existing rows have a text date that disagrees with their `created_at` (and by how many days), and how many rows were written inside the 00:00–05:30 IST window with a UTC-derived date (U-11).

**Exit criterion:** every `U-*` has a recorded value; the characterization suite is green against current `main`; a count exists for already-inconsistent rows and for client-vs-server clock disagreement. Without those two numbers Stage 2 is guesswork.

### Stage 1 — Canonical trusted-time primitives and invariants

This is the stage that answers the brief's "do not replace every `Date()` with `clinicTodayIST()`" concern by *not* doing it: Stage 1 establishes **who is allowed to supply which of the five concepts**, ships the vocabulary, and changes no accept/reject behaviour.

1. Server: make `lib/istDate.ts` the only surface that names a clinic calendar day from an instant — `todayIST()`, `clinicDateOf(instant)`, `clinicDayBoundsIST()` — and collapse the three same-named helpers with different authorities (audit §3.3, F-20) so one name means one thing. Deleting `todayISO()` at `routes/radiology.ts:105` belongs here.
2. Invariants, not mass substitution: for every **persisted or printed** date, assert in code review and in the contract test that the value comes from (a) a Postgres default instant, (b) an explicitly IST-derived clinic day, or (c) a validated client-supplied business date routed through Stage 2's schema. Extend `securityPerfHardening.sourceContract.test.ts:44-48` from a fixed file list to a rule that fails on **new** violations, and add the browser to its scope (F-28) — the current test protects `api-server` files it happens to list and nothing on the client.
3. Two clocks side by side on financial writes: `time_received` (Postgres `DEFAULT now()`) and `time_processed` (Node) recorded together, with a test asserting a small tolerance. This is the instrument that catches a lost `process.env.TZ` pin, which today fails silently (§5.2).
4. Browser defaults stop being derived from the workstation clock (F-20/F-21/F-22): `Dashboard.tsx:164,783`, `DailySummary.tsx:175-183`, `Expenses.tsx:172-186`, `ExpenseDetailDrawer.tsx:100,133`, `Staff.tsx:306,405`, `Accounting.tsx:507` and the **73 browser-side day-slice occurrences in 44 non-test files** take their *initial value* from Stage 0's `clinicDateIst` and remain user-editable. **Display/default only — no validation, no rejection, no new required field.** A date the operator can still change is not yet a control; the control arrives in Stage 2.
5. Parse, don't assume: the bare DICOM date currently asserted as `T00:00:00Z` (`radiology-report-generator.ts:1499`, `radiologyD1FinalWriter.ts:399`) becomes an explicit `+05:30` interpretation with the assumption recorded in the value (F-18); the five server-side UTC-slice sites that *persist or print* (F-15's named list) move to `todayIST()`/`dateToISTString()`.
6. Choose the low-blast-radius half of D-6 in code: keep the existing explicit `+05:30` bounds (`routes/daily-summary.ts:47-48`) as the house rule and stop adding `::date` casts (F-16) — this is reversible and does not depend on an NAS config change that ops has not signed off.

**Exit criterion:** one additive PR; no route's accept/reject behaviour changes; Stage 2 has a single vocabulary and a single set of invariants to build on; the contract test would fail if someone added a new browser-derived persisted date.

### Stage 2 — Financial business-date validation and immutable audit evidence

The money-path fixes proper, including the audit's only P0.

1. `PATCH /api/accounting/vouchers/:id`: introduce the request schema that does not exist today (`routes/accounting.ts:290-316`), reject non-`YYYY-MM-DD`, reject `null`/unknown keys, and take `editedBy` from the session only. **F-01 (P0)** — and the same session-actor rule is what F-06 and F-31 need on the clinical side (delivered there by Stage 5).
2. One zod date schema used everywhere a business date is accepted — `z.iso.date()` plus the range bounds from D-2 — applied to `expenseDate`, `paymentDate`, `vouchers.date`, `dueDate`, `serviceDate`, `invoiceDate`, `selectedDate`, `appointmentDate` and the Form F dates. Today `lib/api-zod/src/generated/api.ts:3022,3041,3100,3113` type them as bare `zod.string()`. Stop reading `paymentDate`/`invoiceDate` off `req.body` *outside* the parsed object (`routes/expenses.ts:268,412-417`). **F-02, F-08, F-09, F-13.**
3. Audit evidence for the change itself: an audit row for expense **date** changes, which are silently skipped today (`routes/expenses.ts:524-530`); session-derived actor for `approvedBy` (`expenseV2Service.ts:303`) while **keeping** the existing self-approval guard (`:506-515`), which is real and works against the one lie it checks; price-change history for `tests.price`. **F-03, F-12, F-14.** Leave the two rejection paths that already protect history alone — the post-voucher date block (`:497-504`) and the after-save amount freeze (`:479-484`) are correct design, and Stage 2 must not "simplify" them away.
4. Immutability as a database property, modelled on what already exists: append-only `BEFORE UPDATE OR DELETE` guards on `audit_logs`, `voucher_audits`, `*_report_amendments`, `radiology_audit_log`, `dicom_study_audit_log`, using `study_snapshots`/`ai_shadow_drafts` (`migrations/add_ai_shadow_uniqueness_hardening.sql:82-97`, including its `TRUNCATE` guard) as the pattern, plus the privilege review U-2 returned. Conditional on D-8, because it would break legitimate in-place corrections such as `routes/superAdminBooksHost.ts:74-79`. **F-07.**
5. Typing, additive-only: `effective_date date` **alongside** each text date column, backfilled where it parses and quarantined where it does not (a `date` cast on `text` is where dirty history surfaces — that is information, so report it, never crash on it); plus `effective_date_source`. `recorded_at`/`created_at` are left exactly as they are: **tightening a business date is not a change to the recorded instant, and this stage must not be described as fixing `created_at`.**
6. **Out of scope by decision, not by oversight:** `bills` and `payments` gain no business/effective date here. They are instant-only today (`lib/db/src/schema/bills.ts:25,47,89` — `payments` has exactly one time column), which the audit found to be CARE's *correct* minimal design. Giving them an effective date changes reconciliation, aging, day-close and printed artefact semantics, and it is management decision **D-5**, not a Stage 2 task. If D-5 comes back "yes", it is its own stage-sized project with its own §6.4 restatement plan.

**Exit criterion:** no financial write path accepts an unvalidated or unbounded business date; every business-date *change* leaves server-authored evidence; the Stage 0 characterization assertions were flipped inside this PR and are visible in the diff.

### Stage 3 — Backdate authorization, reason and approval policy

Ship the §2 model: ordinary staff window with mandatory reason, authorised roles beyond the window, second-person approval for sensitive/superseding entries, all enforced **server-side** — the brief's own principle, and the reason `type="date"` inputs with no `max` (130 of them) are UX, not controls. Needs D-2 (windows), D-3 (reason/approval/who approves), D-11 (payroll parity) and the locked-rule carve-outs decided first. Post-voucher and post-close carve-outs are decided here, not discovered later.

### Stage 4 — Day-close and post-close forensic controls

Day-close today annotates and never bounds (`lib/closureBoundary.ts:11-16` says so explicitly), which the audit judged *correct under the locked rule* but unobservable in practice.

1. Implement the declared-but-dead `post_close_override` drawer audit action (`schema/drawerAuditLog.ts:5` has zero writers) so post-close money movements produce a queryable row. **F-11.**
2. Decide, per D-4, whether a post-close **business-date** write is blocked, allowed-and-flagged, or allowed-with-after-the-fact approval — the locked rule forbids blocking refunds, so the default in this plan is allowed-and-flagged with the flag carried by Stage 6's views.
3. One declared reporting basis per report and label it: drawer/cash keyed on the server instant, GL/expense keyed on the effective date, with the same rupee visibly dated both ways. **F-10**, and it inherits D-1.
4. Post-close write digest plus reopen history (`day_closures.reopenedAt`, already server-stamped at `routes/day-close.ts:685-689`) surfaced to owner/admin.

### Stage 5 — Clinical and radiology time-authority hardening

The clinical half, kept separate from the money half because it touches different owners, different tables and the DICOM boundary.

1. Server-set `created_at` on the two body-spread writes: `routes/echoCardiology.ts:164-178` (insert and update) and `routes/usgDoppler.ts:143-152`, both lead-verified, both behind `requireStaffPermission("/radiology")` (`routes/index.ts:821`). **F-05.**
2. Field whitelist for `template_learning`: `.set({ ...req.body, updatedAt })` at `routes/smartRadiology.ts:363` (`:460`, `:517` sweep-confirmed) must not accept `createdById`/`createdByName` or any stored instant from the body. **F-06 (clinical half).**
3. TAT/SLA: make `studyTatMetrics` instants server-derived; where an external system legitimately supplies them, store `external_claimed_at` next to a server `received_at` and stop deriving `slaBreached`/`isDelayed` from a client timestamp (`routes/smartRadiology.ts:587-620`), and give the route the audit row it currently lacks. **F-30.**
4. Actor from session on the remaining clinical audit surfaces: `radiology_audit_log.actor` (`routes/internal-radiology.ts:1252-1258`, on a route guarded only by `requireStaffOrInternalAuth` at `:280,363`), `patient_reports.criticalAcknowledgedBy` (`routes/patient-reports.ts:2452-2460`). **F-31.**
5. **Keep the DICOM firewall that already exists, and make it explicit.** Modality `StudyDate`/`AcquisitionDateTime` and Dicom Agent `capturedAt`/`retrievedAt` (`lib/dicomAgent.ts:530,537`, NaN-check only) are *clinical/device* metadata and must never be laundered into CARE's audit instant — label them `device_reported`, keep `dicom_studies`' inline zod stripping of `createdAt` (`routes/dicomStudyManager.ts:195`, already correct) and extend that pattern to the other device-facing routes. This is the audit's §6 requirement stated as a code rule, not a comment.
6. Consistency items with no attacker required: the `radiology_studies` vs `radiology_worklist` study-date split (F-19), locale-parsed persisted study dates (F-22), `updatedAt` used as `audit.last_modified_at` inside persisted report artefacts (F-23), `radiology_ai_review_audits.created_at` without `withTimezone` (F-26), and `POST /api/sync/push`'s dormant `createdAt` envelope field (F-27) — which must be **deleted or explicitly renamed `external_claimed_at` before anybody implements the table branch**, because today it is a stub (`routes/sync.ts:147`) and a future footgun.

**Exit criterion:** no clinical path lets a client-supplied instant become CARE's record of when CARE acted, and no device clock becomes an audit clock.

### Stage 6 — Admin forensic views and clock-drift observability

Everything the audit found "invisible by construction" becomes a query and an alert.

1. The seven views of §4, built on Stage 2/3 columns — including the acceptance test for the brief's headline question (T-20: a genuinely-yesterday entry and a backdated-today entry with identical effective dates must be distinguishable on screen).
2. Drift monitoring per §5: boot + periodic clock probe (`/api/health/clock`), the Stage 1 two-clock cross-check as an alert, per-operator client/server clinic-day disagreement (the only signature of Attack A′ that does not assume the attacker used the API directly), and Postgres zone mismatch now that U-1 has a baseline.
3. Audit-chain continuity: `verifyAuditChain` (`lib/audit.ts:223`) over retained segments plus a monotonic `MAX(created_at) OVER (ORDER BY id)` check, explicitly covering the retention-deletion boundary (`src/cron.ts:870-900` archive-then-delete; F-24, and D-7 for the retention period itself).
4. Reopen/post-close anomalies on an admin digest (with Stage 4).
5. Nothing in this stage authorizes anything: it detects and evidences. **A forensic view is not a control**, and no finding may be closed by "Admin can see it" unless the policy decision explicitly chose visibility over gating (D-4).

---

## 4. Admin forensic views (feasibility, not implementation)

| View | Computable **today** (Stage 0) | Needs Stage 2/3 columns | Evidence each row must show |
|---|---|---|---|
| **Backdated entries** | Yes — text date vs `created_at` delta on expenses, expense payments, vouchers | source/reason | effective date · `recorded_at` (server, with time) · delta in days · actor (session-derived) · reason (or `NO REASON ON FILE`) |
| **Late entries** (same business day, entered after hours/close) | Partially — `created_at` vs the closure `coveredToTs` (`day-close.ts:501-506`) | — | the closure boundary it crossed |
| **Date overrides** (edit moved the date) | Vouchers only (`voucher_audits` old/new), and only with trustworthy `editedBy` | actor-from-session | old → new, who, when, why |
| **Post-day-close entries** | Yes — `created_at > coveredToTs` while `effective_date <= closureDate` | — | closure row + reopen history |
| **Historical modifications / reversals** | Mostly yes (`bill_audits`, `payments.supersededBy`, `reversedAt`, `voidedAt`) | — | before/after values (already supported by `audit.ts` `oldValue/newValue`) |
| **Client-time / server-time disagreement** | **Yes** from `audit_logs` `ipAddress`/`userAgent` + `created_at` once Stage 0 `date_source_log` exists | — | the two clocks side by side |
| **Reconciliation-basis disagreement** | Yes — cash/drawer basis (`created_at`) vs expense/GL basis (`date`) for the same rupee | — | both dates + which report the user is looking at (kills the F-10 silent asymmetry) |
| **Operational-metric rewrites** (turnaround / SLA) | **No** — `study_tat_metrics` is overwritten in place with no history row, so only the *current* claimed values exist (F-30) | a TAT history/audit row (Stage 5) | every prior `total_tat_minutes`/`sla_breached` pair with the actor and the server instant — today that reconstruction is impossible, which is itself the finding |
| **Declared actor vs session principal** | Partially — both values can be captured today, but only `audit_logs` has the session half; `radiology_audit_log.actor` and `critical_acknowledged_by` store only what the caller typed (F-31, F-01) | session-principal column on those tables (Stages 2/5) | the two names side by side, flagged whenever they differ |

Two honesty notes for whoever builds these: `reason` and `approver` do not exist anywhere today (F-03), so a "backdated" view is **incomplete by design until Stage 2's `effective_date_source` and Stage 3's reason/approval columns land** — the Stage 0 version can only show the date *delta*, never its justification; and every "who" in these views is only as trustworthy as the session-vs-body actor fix (F-06, F-31, Stages 2 and 5). The last two rows are also the two views that **cannot be built at all** from today's data, which is why they are listed as findings rather than as reporting gaps.

---

## 5. Clock-drift monitoring and detection (read-only observability)

1. **Boot + periodic probe:** log `Date.now()`, `new Date().toISOString()`, `todayIST()`, `SHOW timezone`, `SELECT now()`, and container/NAS time source status; expose via `GET /api/health/clock`.
2. **Two-clock cross-check:** persist `time_received` (Postgres) and `time_processed` (Node) for financial writes — introduced as a Stage 1 primitive, alerted on here; alert when |difference| exceeds a small tolerance for a sustained period (catches a Node TZ pin being lost, audit §15).
3. **Client-clock disagreement:** alert when one operator's submissions persistently disagree with the server clinic day (the workstation-manipulation signature — the *only* thing that detects Attack A′ without assuming the attacker used the API).
4. **Chain continuity:** `verifyAuditChain` (`audit.ts:223`) over retained segments plus a monotonic `MAX(created_at) OVER (ORDER BY id)` check, and specifically cover the retention-deletion boundary (F-24).
5. **Reopen/closure anomalies:** any `reopenedAt` or any write whose `effective_date` predates the newest `closureDate` should surface on an admin digest.
6. No external network calls, no NTP configuration changes are proposed here — the NAS/container time source is an infrastructure concern; this document only asks that CARE *measure and report* it rather than silently trust it.

---

## 6. Migration and backward-compatibility concerns

1. **Additive first, subtractive never in the same release.** `text` date → `date` will meet real dirty data (empty strings, `""` defaults in `formF.ts:37-42`, `MM/DD/YYYY` from `toLocaleDateString()` sites F-22, compact `YYYYMMDD` from `radiologyScheduledProcedures`). Plan: add column → parse with an explicit per-format policy → quarantine unparseable rows into a review list → only then switch reads.
2. **Historical rows must not be reinterpreted.** A row whose text date was `"2026-09-29"` and whose `created_at` was `"2026-09-30 08:42 IST"` must continue to read as effective 29-Sep after migration. The migration may not "correct" old rows to `created_at` — that would rewrite accounting history by administrative fiat.
3. **`::date` casts** (`bills.ts:554-555`) change meaning the moment the Postgres session zone is pinned. Choose one: (a) pin the zone and re-baseline every date-filtered report, or (b) ban `::date` and use the existing explicit `+05:30` bounds (`routes/daily-summary.ts:47-48`) everywhere. Recommend (b) — smaller blast radius, no server config dependency — with (a) as the eventual infrastructure decision (§8 D-6).
4. **Reports will move.** Any past period whose boundary was computed by a UTC slice (F-15, F-17) will show different totals once corrected — including the 00:00-05:30 IST entries currently filed a day early. Finance must be told before, not after.
5. **Statutory artefacts are already issued.** Amendments to PCPNDT Form F / MTP dates and previously printed reports cannot be silently re-dated; the correct model is an append-only correction with reason, never an in-place edit of a date that has appeared on paper (relates to F-13, and to `usgReports.ts:612` where a UTC date is baked permanently into amendment text).
6. **Printed stamps** (`SummaryExport.tsx` ×7, `staffDayCloseSlip.ts:445`, `Form3C.tsx:166`) become server-derived — expect visible differences in "Generated:" lines; low risk but not zero surprise.
7. **Offline/emergency flows must keep their device instant** (`offlineBillingQueue.ts:220`, `emergencyBilling.originalCreatedAt`) while gaining CARE's receipt instant. Do not overwrite one with the other.
8. **Schema-vs-migration drift (audit §16.5):** `lib/db/src/schema/*.ts` does not necessarily reflect deployed column defaults (the repo's own `reportFindingInstances.test.ts:21` says so). Every default asserted in this plan must be verified against live DDL in `migrations/` before Stage 2.
9. **API compatibility:** tightening `PATCH /vouchers/:id` and rejecting unknown keys will break any caller (mobile, kiosk, gateway, integration scripts) that currently sends extra or malformed date fields. Stage 0's log tells us who; keep a short, dated compatibility window and then fail closed.
10. **Do not touch the good parts.** Bills/payments' instant-only design, day-close's server-stamped window, hash-chained audit, signature/amendment monotonicity and the DICOM/audit firewall are all correct as-is; a refactor that "unifies" them with the expense world would be a regression.
11. **`bills`/`payments` have no separate business/effective date, and this plan does not change that.** Adding one would redefinition what a payment's date *means* everywhere it is read — drawer and cash reconciliation (which keys `created_at`, `routes/day-close.ts:238-242`), aging and collections (`bills.dueDate`), day-close totals, printed receipts and Form 3C, and the `created_at::date` day buckets in `routes/bills.ts:554-555`. That is an **architectural and management decision (D-5), not a remediation task**, and it is explicitly excluded from Stage 2. If D-5 comes back "yes", it needs its own written design, its own restatement plan under §6.4, and its own stage — it must not be smuggled into a time-integrity PR as a column addition.

---

## 7. Test plan (deterministic fake clocks; nothing implemented here)

Harness requirements: `vi.useFakeTimers()` + `vi.setSystemTime()` for Node-side determinism; a **per-test** `process.env.TZ` (`Asia/Kolkata`, `UTC`, `America/New_York`, `Asia/Tokyo`, `Pacific/Kiritimati`) applied *before* module import so the `index.ts:8` pin is genuinely under test rather than assumed; a `now`-injectable seam on the helpers; and one integration database per run. Explicitly required: the harness must exercise the **browser-side** default-generation code, since that is where the vulnerability lives (F-29).

**How the table is used:** Stage 0 lands every row as a *characterization* test against current `main`, so the suite records today's real contract (several rows therefore assert a bug, as noted). The PR that changes behaviour — Stage 2 for money paths, Stage 5 for clinical paths, Stage 3 for the policy rows — flips the corresponding assertions inside that same diff, so a reviewer sees the change of contract instead of a silently-green suite.

| # | Test | Deterministic setup | Assertion |
|---|---|---|---|
| T-01 | Workstation clock −1 day, create **bill** | fake *client* clock only; server real | persisted `created_at` = server instant; no business-date column touched |
| T-02 | Workstation clock −1 day, create **expense** | fake client date 29-Sep, server 30-Sep 08:42 IST | post-Stage-2/3: `effective_date=29-Sep` **requires** reason + `source='backdated_within_policy'`, and `recorded_at` unchanged; at Stage 0 (today) the same test asserts the *bug* is present |
| T-03 | Workstation timezone change, clock unchanged | `TZ=UTC` vs `TZ=Asia/Kolkata`, same instant | identical persisted business date; identical Daily Summary day (kills F-20's `Dashboard.tsx:164` dependence) |
| T-04 | Browser in another international timezone | `TZ=America/New_York` | the day queried is still the clinic's IST day (server-supplied) |
| T-05 | Midnight IST boundary | `setSystemTime(2026-09-30T00:00:30+05:30)` and `…T23:59:30+05:30` | clinic date resolves to 30-Sep, not 29-Sep — the direct regression test for F-15 |
| T-06 | `toISOString().slice(0,10)` at 04:00 IST | fake server instant | fetal report header, USG amendment text, Doppler `studyDate` all say the IST day (currently they fail — pin the fix) |
| T-07 | Arbitrary `createdAt` injection | POST/PATCH with `createdAt: "2020-01-01"` | value ignored on bills/payments/expenses/vouchers **and** on echo/`template_learning` (F-05) |
| T-08 | Arbitrary `updatedAt` injection | same | ignored; `updated_at` remains server-derived |
| T-09 | Voucher PATCH with malformed/future/past date | `date: "not-a-date"`, `date: "2035-01-01"`, `date: "2020-01-01"` | 400 for all three (today the first is accepted — F-01) |
| T-10 | Voucher PATCH audit authorship | body `editedBy: "someone-else"`, session = staff-17 | audit row's actor = staff-17 (session wins) |
| T-11 | Legitimate historical effective date | reason + within-window | accepted; `recorded_at` ≠ `effective_date`; view flags it |
| T-12 | Unauthorised backdate | staff role, out-of-window date | rejected by the **server**, not by a hidden button |
| T-13 | Authorised backdate | admin role, reason | accepted, approval columns written, `approved_at` server-stamped |
| T-14 | Reason/approval preservation | backdate, then edit amount | `effective_date_source`, reason, approval survive the subsequent edit |
| T-15 | Closed-day insertion | close day N, then submit `effective_date=N` | money not blocked (locked rule), post-close evidence recorded and visible; GL/expense path flagged |
| T-16 | Historical bill/payment edit | PATCH a prior-day bill | `bill_audits` row with before/after; date basis unchanged |
| T-17 | Reopen flow | super-admin reopen with reason | `reopenedAt` server-set; reason enforced |
| T-18 | Two clients, different clocks, same instant | client A date = 29-Sep, client B = 30-Sep | both records share one server instant; the *effective* dates differ only via the audited policy path |
| T-19 | Server timestamp immutability | attempts from every money route | `recorded_at` never writable |
| T-20 | Admin detectability | seed one genuine-yesterday and one backdated-today record with identical effective dates | the two are distinguishable in the Stage-6 view — **this is the acceptance test for the audit's headline question** |
| T-21 | Daily Summary basis | one expense `created_at` 30-Sep, `effective_date` 29-Sep | drawer view and GL view both report the *same* rupee with both dates labelled (F-10) |
| T-22 | Session vs `::date` | rows at 04:00 IST boundary; DB zone UTC vs IST | day buckets agree under the chosen convention (decides D-6) |
| T-23 | Report finalisation | client supplies `finalizedAt` | ignored; `signedAt` server-set; amendment still monotonic |
| T-24 | Critical ack | second ack attempt after the first | `acknowledgedAt` unchanged; `acknowledgedBy` session-derived (F-06) |
| T-25 | TAT/SLA metrics | client-supplied `reportFinalizedAt` | cannot flip `slaBreached` (F-04) |
| T-26 | DICOM boundary | modality `StudyDate` 29-Sep, CARE receives 30-Sep 04:00 IST | acquisition date preserved as clinical; audit instant = 30-Sep; report header/EDD/recall use a documented, explicit zone (F-18/F-19) |
| T-27 | Bank feed | provider `txnDate` yesterday, import today | stored as `external_claimed_at` + `imported_from_feed`; `recorded_at` = today |
| T-28 | Audit chain across retention | delete archived segment, then verify | verifier succeeds on retained segments and reports the gap explicitly (F-24) |
| T-29 | Clock step | fake backward jump of 2 h between writes | drift monitor raises; no business date silently moves |
| T-30 | Contract/lint guard | static test | zero `toISOString().slice(0,10)` for persisted/printed values in api-server; zero body-date reads outside a parsed schema; no `max`-less persisted-date input left relying on the browser |
| T-31 | Study TAT / SLA overwrite | POST `tat-metrics/:studyId` with `receivedAt` = T−5 d and `reportFinalizedAt` = T−4 d, then re-POST with `receivedAt` = T−10 min | **F-30.** Post-Stage-5: instants are server-derived (or stored as `external_claimed_at` beside a server `received_at`), `slaBreached` cannot be flipped by a client body, and the write leaves an audit row. Stage 0 asserts today's behaviour: the second POST silently replaces the first and `created_at` is the only unchanged column |
| T-32 | Declared actor vs session principal | POST `report-status` with `actor:"some-other-person"`, then with no `actor`; POST `acknowledge-critical` with `acknowledgedBy:"Dr. Someone Else"` | **F-31.** Post-Stage-2/5: `radiology_audit_log.actor` and `critical_acknowledged_by` equal the session principal in all three cases, `"system"` appears only for genuine internal-key callers, and the ack write produces an audit row. Stage 0 asserts the current behaviour: the typed name persists verbatim beside a correct server instant |

---

## 8. Management decisions required (not for engineering to invent)

| # | Decision | Why engineering cannot decide it |
|---|---|---|
| **D-1** | What is CARE's official **clinic day** for *financial* purposes — the IST calendar day of `recorded_at`, or the day the transaction clinically/financially belongs to? | Today CARE answers this differently per report: the drawer uses the server instant, the GL uses a typed string (F-10). Only management can pick the accounting basis; everything else follows from it |
| **D-2** | Allowed **backdating window** per role and per module (expense / voucher / payout / registration / clinical form), and whether a window exists at all for statutory records | Policy + legal exposure; the code today has no window and no floor/ceiling (F-09) |
| **D-3** | Does a backdate require a **reason**, an **approval**, or both — and who approves? | Determines the columns in §1.1 and the Stage-3 workflow |
| **D-4** | For sensitive entries **after** a closed period: block, or allow-and-flag? | Directly touches the LOCKED BUSINESS RULE cited in `closureBoundary.ts:11-16`; the current rule forbids blocking, so any change needs explicit management sign-off |
| **D-5** | Should bills/payments gain a **business/effective date** at all (so a payment can legitimately belong to a prior day), or stay instant-only? | **Architectural decision, and it is not scheduled in any stage of this plan.** Their current design is secure *and* unable to express legitimate history; but adding the column redefines what a payment date means in reconciliation, aging, day-close and printed artefacts (§6.11). The trade-off is a business one, so it is escalated with a written design requirement, not implemented casually |
| **D-6** | Server-infrastructure: **pin Postgres timezone** (and accept the day-bucket shift), or **ban `::date`** and standardise on explicit IST bounds in code | One is an ops change on the NAS, the other a code convention; both change report totals (§6.4). Stage 1 implements the code-convention half only (reversible), leaving the ops half to this decision |
| **D-7** | **Audit retention** (30 days today for some jobs) versus financial/statutory retention and tamper-evidence needs | Deleting chain rows breaks verification across the gap (F-24); the trade-off is legal/operational |
| **D-8** | Whether DB-level immutability (triggers/`REVOKE`) is acceptable for the app's current access pattern | Would break any legitimate in-place correction flow, e.g. `superAdminBooksHost.ts:74-79` ⚠ sweep-verified |
| **D-9** | Re-statement policy for **already-issued** reports whose headers/bases were UTC-derived | Some historical totals will change (F-15/F-17); finance must choose between restatement and a documented reconciliation note |
| **D-10** | Which **external clocks** (bank feeds, gateway settlements, modality DICOM, Dicom Agent device time) are allowed to define an accounting date, and how each is labelled | Currently mixed: `banking.transactionDate` has no default and comes from a provider (F-§10) |
| **D-11** | Whether staff **salary/advance/commission** dates carry the same controls as the GL | They are the same pattern (`staff.ts:160,234`) but a different risk profile |
| **D-12** | Who owns "business time" as a **product concept** going forward | Today no single module owns it, which is precisely how three different `todayISO()` helpers came to coexist (§3.3 of the audit) |

---

## 9. Suggested sequencing (for planning only)

**Stage 0** runtime verification + characterization tests → **Stage 1** canonical trusted-time primitives and invariants (additive, no behaviour change) → run one accounting cycle with the Stage 0 instrumentation live → **Stage 2** financial business-date validation + immutable audit evidence (contains the P0) → **Stage 3** backdate authorization / reason / approval policy → **Stage 4** day-close and post-close forensic controls → **Stage 5** clinical / radiology time-authority hardening → **Stage 6** Admin forensic views + clock-drift observability.

Stages 2, 3 and 4 are gated on management decisions: D-1 (what CARE's financial clinic day *is*), D-2 (windows), D-3 (reason/approval), D-4 (post-close block vs flag), D-5 (bills/payments effective date — **deliberately not in any stage below**), D-6 (Postgres timezone vs banning `::date`), D-8 (DB-level immutability vs legitimate in-place correction). Stage 5 is gated only on U-10/U-11 and the DICOM labelling convention (D-10); it can run in parallel with Stage 3/4 if a second reviewer is available, but not as a combined PR.

Nothing in this document has been implemented, and none of it should be read as approved. Stages 0 and 1 are the only parts that carry no policy dependency — which is precisely why they come first: they turn the audit's `UNKNOWN` rows into measurements without changing a single user-visible behaviour.
