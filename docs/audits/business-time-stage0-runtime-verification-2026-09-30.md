# CARE business-time integrity — Stage 0 runtime verification & characterization

**Date:** 2026-09-30 (IST)
**Branch:** `test/business-time-stage0-runtime`
**Base SHA:** `716fd41395e7742125c4a67a7bf047111b1a540d` (`origin/main` at Stage-0 start, = PR #781 merge)
**Audit base commit:** `3aabfd1c` (`docs(audits): business-time & timezone integrity audit + staged plan (#779)`, 2026-09-30 20:33 IST)
**Companion documents:** [`business-time-timezone-integrity-audit-2026-09-30.md`](./business-time-timezone-integrity-audit-2026-09-30.md) · [`business-time-integrity-remediation-plan-2026-09-30.md`](./business-time-integrity-remediation-plan-2026-09-30.md)
**Stage:** 0 of 6 — **verification and characterization only. Nothing here remediates.**

---

## 1. Executive summary

Stage 0 asked one question: *what clocks, timezone assumptions, privileges, date sources and audit mechanisms does CARE actually use today?* The answer, in one paragraph:

CARE runs on **two trusted clocks that are not the same clock** — Postgres `now()` (session `TimeZone = UTC`) for `created_at`, and the Node clock (container `TZ=Asia/Kolkata`) for `updated_at` and for every server-derived date. Both are server-side and both are correct as instants; the *calendar* they map onto differs for 5h30m every day, and 14 SQL call sites resolve a business-date string typed by an operator against the **UTC** day while the operator means the **clinic** day. Business dates themselves (`expense_date`, `vouchers.date`, `form_f.date/procedure_date`, `invoice_date`) are **client-supplied text by design** and are stored verbatim; the server never re-derives or validates them beyond a bare `z.string()`. The client's own defaults are generated with `new Date().toISOString().slice(0,10)` — a **browser** clock read through a **UTC** lens — so between 00:00 and 05:29 IST the ERP pre-fills yesterday's date on an untouched form. That single fact is the most important Stage-0 output: it means a *accidental* backdated record is the normal behaviour of the system, not evidence of misconduct, and it retroactively justifies the forward-only rule.

On the evidence side, the picture is harsher than the audit's prose and softer than a security report would suggest. `created_at` is genuinely DB-defaulted on every financial and audit table we checked (**CONFIRMED** from Drizzle metadata without touching a DB). But **no** audit, money or clinical-record table has any database-level immutability: append-only guards exist on exactly two AI snapshot tables, and **zero** `GRANT`/`REVOKE`/`CREATE ROLE` statements exist across all 181 migrations — the application connects as the bootstrap superuser, which on the same-image container measured today was literally `rolsuper = t`. So the audit trail's immutability is entirely an application convention, and an application compromise *can* rewrite or delete audit evidence without a trace (**CONFIRMED** as a capability; **UNKNOWN** as an event — no retrospective investigation was performed or authorized). Actor attribution is worse than the audit recorded: `voucher` edits take `editedBy` from the body, `bill_audits` writers prefer `req.body.editedBy` over the session, the clinical worklist audit writes `b.actor ?? "system"`, and `accounting.ts` stamps four or more audit rows with hard-coded `userId: null, userName: "staff"`. Staff/payroll writes — including five hard `DELETE` routes — contain **no** audit call at all.

Six findings gained new factual basis and seven new Stage-0 findings were discovered and **documented, not repaired** (§19–§20). Two findings' factual basis was *revised*: one hardened (audit `userName: "staff"` is systemic, not a single site) and one softened (the radiology "today" helper is already IST-correct; the defect is narrower and purer than recorded). No severity was changed: severities are a management instrument and Stage 0 has no authority to move them (§21).

Everything production-specific that could not be measured from this workstation is listed as **UNKNOWN** with the exact read-only command that closes it (§22).

---

## 2. Base SHA and scope discipline

| Item | Value |
|---|---|
| Base SHA (branched from) | `716fd41395e7742125c4a67a7bf047111b1a540d` |
| Prior audit merge | `3aabfd1c` (#779) → decision register `716fd413` (#781) |
| Files added by Stage 0 | 3 (2 characterization suites, 1 this document) |
| Application code changed | **none** |
| Schema/migrations changed | **none** |
| Configuration changed | **none** |
| Production accessed | **read-only, and in practice not reached at all** (§3) |

The Stage-0 absolute scope boundary was respected: no backdating window invented, no reason/approval workflow added, no `time_integrity_cutover_at` implemented, no timezone/NTP change, no `clinicTodayIST()` behaviour change, no global `Date()` replacement, no new financial effective dates, no day-close change, no RBAC change, no trigger/`REVOKE` added, no historical normalization, no retrospective backdating report, nothing deployed.

---

## 3. Runtime / environment inspected

| System | What it is | Reached? | Status |
|---|---|---|---|
| Windows workstation (this host) | Development machine, `TZ` observed `+0530` | yes | **CONFIRMED** (measurements below) |
| `care-emergency-db` | `postgres:16-alpine`, **same image as the ERP `db` service**, emergency stack, local | yes (SELECT/SHOW only) | **CONFIRMED** as an *image-level* measurement |
| `care-emergency-api` | Local emergency API container, `TZ=Asia/Kolkata` in env | yes | **CONFIRMED** as an analogue for container TZ |
| `care-db` / `care-api` (ERP production, Synology NAS) | The real clinic database and API | **no — not reachable from this box** | all live values **UNKNOWN** (§22) |
| Repo configuration & schema | `docker-compose.yml`, 181 `migrations/*.sql`, `lib/db/src/schema/*`, routes | yes | **CONFIRMED** |

**Why the emergency container is admissible evidence and where it stops.** Postgres' default `TimeZone` comes from the image's `postgresql.conf` and the container environment, neither of which the ERP overrides (no `TZ`/`PGTZ` in the `db` service — asserted by a test). So a same-image container answers U-1's *engine-default* question authoritatively. It does **not** answer whether a NAS operator ran `ALTER DATABASE … SET timezone`, nor what the NAS host clock and NTP source are, nor the live role graph. Those remain **UNKNOWN**, and the closing commands are given verbatim in §22. All measurements in this document were `SELECT`/`SHOW`/`pg_settings` reads; no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, migration, restart, config edit, timezone change, NTP change or privilege change was performed anywhere.

---

## 4. Code has not moved under the audit (§4 requirement)

```
git log --oneline 3aabfd1c..origin/main                     → 2 commits
git log --since="2026-09-28 00:00" --oneline -- <in-scope>  → 0 commits
```

Commits since the audit merge: `09a61208` (MRI Dorsal Spine sub-master V4, 24 files, all `artifacts/diagnostic-erp/src/**` radiology-reporting code) and `716fd413` (the decision register, docs only).

Paths checked for movement and found **unchanged**: `routes/accounting.ts`, `routes/bills.ts`, `routes/expenses.ts`, `routes/day-close.ts`, `routes/staff.ts`, `routes/smartRadiology.ts`, `lib/audit.ts`, `lib/istDate.ts`, `lib/expenseV2Service.ts`, `lib/closureBoundary.ts`, `lib/db/src/schema/**`, `migrations/**`, `docker-compose.yml`, `pages/FormF.tsx`, `pages/Expenses.tsx`, `pages/Accounting.tsx`.

**Result: no finding needed re-verification because of a code change.** Every finding in the audit still describes current `origin/main`. (Two needed re-verification for a different reason — they were *understated*; see §20.)

---

## 5. Clock-chain diagram

```
┌─ Synology NAS host ────────────────────────────────────────────────┐
│ time source: DSM/NTP                        ← UNKNOWN (§22-A)      │
│  └─ Docker: care-db (postgres:16-alpine)                            │
│       TZ / PGTZ env: none present in docker-compose.yml  CONFIRMED  │
│       SHOW TimeZone = UTC (image default, measured on same image)   │
│         ↑ analogue-measured, NOT the production container           │
│       now() / current_date / timestamptz → UTC                      │
│       created_at DEFAULT now()            ← AUTHORITY 1 (DB)        │
│  └─ Docker: care-api (TZ=Asia/Kolkata, compose:246)                 │
│       process.env.TZ pinned again in code, index.ts:8               │
│       new Date() → instant correct, local calendar = IST            │
│       updated_at $onUpdate(() => new Date())  ← AUTHORITY 2 (Node)  │
│       todayIST() = toLocaleDateString("en-CA",{Asia/Kolkata})       │
│  └─ care-worker (worker.ts:5 same TZ pin)                           │
└─────────────────────────────────────────────────────────────────────┘
          ▲                          ▲
          │ HTTPS JSON               │ INTERNAL_API_KEY (Bearer)
   ┌──────┴───────────┐     ┌────────┴──────────────────┐
   │ Clinic browsers  │     │ Machines / daemons        │
   │ workstation clock│     │ desktop pull-agent,       │
   │ ← NEVER trusted  │     │ local-dicom-bridge,       │
   │ but IS the source│     │ bridge-service, cron,     │
   │ of every default │     │ scripts/*.mjs, HL7, kiosk │
   │ business date    │     │ DICOM StudyDate           │
   └──────────────────┘     └───────────────────────────┘
```

**Measured chain (local, 2026-09-30):**

| Link | Measurement | Skew |
|---|---|---|
| Workstation | `date -u` = `2026-09-30T15:41:16Z`; local `21:11:16 +0530` | reference |
| Container (`care-emergency-db`) | `date -u` = `2026-09-30T15:41:16Z` | **0 s** at 1-second resolution |
| Postgres | `now()` = `2026-09-30 15:40:49.076+00`, `clock_timestamp()` = `15:40:49.077` | sub-ms internally |
| Postgres | `pg_postmaster_start_time()` = `2026-09-29 03:14:56.59+00` (36 h uptime) | — |
| Node in container | `TZ=Asia/Kolkata`, `new Date().toISOString()` = `2026-09-30T15:41:16.786Z`, `getTimezoneOffset()` = `-330` | agrees with DB instant |
| NAS host clock / NTP | not reachable | **UNKNOWN**, **NOT TESTED** |
| Browser clocks | not observable from the server today; no client-clock telemetry exists | **UNKNOWN** by design |

Two consequences. (1) Within the server there is **no measurable instant skew** — the money-instant risk the audit flagged as low stays low, and Stage 0 found no evidence to raise it. (2) The two server clocks agree on *instants* and disagree on *calendars*: `created_at` is bucketed by UTC, `todayIST()`/`updated_at` by IST. The divergence window is **00:00:00–05:29:59.999 IST (= 18:30–23:59:59.999 UTC)** and it is a day-boundary, not a drift.

---

## 6. Time-authority matrix

| Clock | Source | Used for | Authoritative? | Status |
|---|---|---|---|---|
| C1 Postgres `now()` | DB engine, session TZ=UTC | `created_at` on bills/payments/expenses/expense_payments/vouchers/voucher_audits/bill_audits/audit_logs (`.defaultNow()`) | **Yes** for instants | CONFIRMED (metadata) |
| C2 Node `new Date()` | container `TZ=Asia/Kolkata` | `updated_at` (`$onUpdate`), day-close window bounds `from`/`to`, `closedAt`, TAT fallback, `criticalAcknowledgedAt` | **Yes** for instants | CONFIRMED |
| C3 `todayIST()` | C2 + `Intl` Asia/Kolkata | expense defaults, GL posting date, auto-voucher `date`, closure *label*, daily-summary window, cron | Yes for the **clinic day** | CONFIRMED |
| C4 `toISOString().slice(0,10)` | C2 through a UTC lens | `cron.ts:1157/1254/1284` `dateKey`, archive key `:882/927` | **No** — wrong clinic day 00:00–05:29 IST | CONFIRMED defect |
| C5 Browser `new Date()` | workstation | default `expenseDate`, `paymentDate`, voucher `date`, Form F `date`/`procedureDate`, OCR `confirmedAt` | **Never** | CONFIRMED — currently the *de-facto* source of most business dates |
| C6 Browser local calendar (`getFullYear/getMonth/getDate`) | workstation | `Dashboard.todayISO()` | **Never** | CONFIRMED |
| C7 Browser UI locale (`toLocaleDateString()`) | workstation | Echo/Fetal **printed PDF** `studyDate` | **Never** | CONFIRMED (render-only, not persisted) |
| C8 DICOM `StudyDate` / agent body | imaging modality / pull agent | `radiology_studies.study_date` | machine clock, trusted by convention | CONFIRMED accepted, validity NOT TESTED |
| C9 Studio client `finalizedAt` | reporting client | `signedAt` on finalized reports | **Never** | CONFIRMED (new finding S0-2) |
| C10 Agent/body instants into timestamp columns | any caller | `study_tat_metrics.receivedAt/reportStartedAt/reportVerifiedAt/reportFinalizedAt`, `machines.reportedAt` | **Never** | CONFIRMED |

---

## 7. U-1 … U-13 results

### U-1 — Postgres time authority → **FINDING (as predicted), D-6 stays open**

Measured on the same image (`postgres:16-alpine`, server 16.15), read-only:

```
TimeZone       = UTC        (pg_settings.source = "configuration file")
log_timezone   = UTC
server_version = 16.15
now() / current_date  agree with the host instant

SELECT ts, ts::date, (ts AT TIME ZONE 'Asia/Kolkata')::date
FROM (VALUES (timestamptz '2026-09-29 21:00:00+00')) v(ts);
→ 2026-09-29 21:00:00+00 | 2026-09-29 | 2026-09-30
```

**`timestamptz::date` resolves in the session `TimeZone`, which is UTC.** An instant that is 30-Sep 02:30 in the clinic casts to 29-Sep. Symmetrically:

```
SELECT '2026-09-30'::date::timestamptz  → 2026-09-30 00:00:00+00
```

so a business-date *string* typed by an operator becomes a **UTC-midnight** window: `[D 05:30 IST, D+1 05:30 IST)`.

`TimeZone` has `context = user` → **any connection may `SET TIME ZONE`**. Because the pool's session timezone is not pinned anywhere, a future per-connection setting would silently reinterpret all 14 `::date` sites at once. Recorded for Stage 1; not changed.

The 14 SQL date-cast sites (CONFIRMED by grep, `head_limit` unrestricted):

| Site | Shape | Effect under TimeZone=UTC |
|---|---|---|
| `routes/bills.ts:554-555` | `(bills.created_at)::date >= ${dateFrom}::date` | bills list "by day" is a UTC day |
| `routes/books-sanity.ts:36,177` | `created_at >= ${from}::date AND < (${to}::date + 1 day)` | ±5h30m window shift |
| `routes/books-sanity.ts:155-156` | same over `bill_audits` | audit "day" ≠ clinic day |
| `routes/reconciliation.ts:302-303,317-318,355-356` | same pattern over orders/payments | reconciliation buckets shift |
| `routes/radiology.ts:1646` | `DATE(created_at) = ${today}::date`, `today = todayISO() = todayIST()` | **CONFIRMED mismatch**: IST label vs UTC cast |
| `lib/expenseV2Service.ts:249` | `ABS(expense_date::date - ${input}::date) <= 3` | text→date cast, see S0-1 |

Production values of `SHOW TimeZone` on `care-db`: **UNKNOWN** (§22-B).

### U-2 — DB role and privilege reality → **FINDING confirmed (capability), production values UNKNOWN**

Measured on the analogue container:

```
 current_user | session_user | is_superuser
 emergency    | emergency    | t
```

Repository facts (**CONFIRMED**): `docker-compose.yml:82` `POSTGRES_USER: ${DB_USER:-erp}` — the API's own URL (`:172/:242/:593`) connects as that same user; across all 181 `migrations/*.sql` there are **0** occurrences of `CREATE ROLE`, `CREATE USER`, `GRANT` or `REVOKE` (a `grep -icE` over the directory returns 0; every `revok*` hit is a `revoked_at`/`revoked_by` column).

So the application role is the bootstrap superuser, owns every table, and holds `INSERT/UPDATE/DELETE/TRUNCATE` on all of them. **Answer to the brief's question — "could an application compromise modify audit evidence?" — yes, trivially, and with no database-level trace.** `SELECT current_user, session_user, …` on the production DB (§22-C) closes the last inference gap; the capability conclusion does not depend on it.

One historical note that bears on trust, recorded without investigating it (forward-only): the compose file documents that this very port was previously published on `0.0.0.0` with the default password `changeme` (`docker-compose.yml:53-68` comment), i.e. direct `psql -U erp -d diagnostic_erp` access to patients, bills and reports existed outside every application control. Whether any such write occurred is explicitly **not** in Stage-0 scope.

### U-3 — clock chain → see §5. **Local skew 0 s; NAS/NTP UNKNOWN; browser clocks unobservable (no telemetry).**

### U-4 — client clock trust → **FINDING: the client is the de-facto business-date authority.** Full A–F matrix in §11 (one of the two central Stage-0 outputs).

### U-5 — Legacy Compatibility Census → **re-framed and delivered as §12.** Per the forward-only ruling this is a census of *date-format producers in code* (migration/runtime compatibility risk), **not** a census of historical rows. No historical row was read, counted, classified or ranked anywhere in Stage 0.

### U-6 — midnight / UTC-vs-IST → **FINDING; 5-row boundary characterization in the suite (§18).** See §13.

### U-7 — audit immutability → **FINDING confirmed; matrix in §10.** Guards exist on 2 of 12 evidence-bearing tables; no `REVOKE`; retention deletes archived `audit_logs` rows (`cron.ts:860-900`, `RETENTION_DAYS = 730`, archive `.json.gz` + SHA-256 written before `db.delete(auditLogsTable)`), which is why `verifyAuditChain` must be scoped to retained segments.

### U-8 — actor authority → **FINDING, worse than the audit recorded.** Matrix in §14.

### U-9 — non-browser clients → **FINDING; §15.** Includes the kiosk export shape that would break first under strict date parsing.

### U-10 — Form F lifecycle → **FINDING; §16.**

### U-11 — day close → **FINDING (annotation-only) plus a new identity finding; §17.**

### U-12 — radiology / TAT clinical time → **FINDING; §18.** External-device time and CARE action time are *not* separated in the data model.

### U-13 — machine / invoice / service dates → **FINDING; §19.**

---

## 8. PostgreSQL timezone findings (consolidated)

| # | Finding | Evidence | Label |
|---|---|---|---|
| T-1 | Server default `TimeZone` is UTC, from `postgresql.conf` in the image | measured `SHOW TimeZone`, `pg_settings.source` | **CONFIRMED (same image)**, production **UNKNOWN** |
| T-2 | `docker-compose.yml` `db` service carries no `TZ`/`PGTZ` | read of the service block, asserted by a test | **CONFIRMED** |
| T-3 | `timestamptz::date` therefore buckets by UTC day | measured cast pair | **CONFIRMED** |
| T-4 | `date::timestamptz` anchors at UTC midnight, so operator "day" filters are `[05:30 IST, next 05:30 IST)` | measured | **CONFIRMED** |
| T-5 | 14 call sites depend on T-3/T-4 | grep list | **CONFIRMED** |
| T-6 | `TimeZone` is a `user`-settable GUC; the pool does not pin it | `pg_settings.context` | **CONFIRMED** |
| T-7 | `''::date` and `'30/09/2026'::date` both **error** in Postgres 16 | measured (`invalid input syntax for type date: ""`; `date/time field value out of range: "30/09/2026"`) | **CONFIRMED** |
| T-8 | Whether `ALTER DATABASE/ROLE SET timezone` was applied on the NAS | not reachable | **UNKNOWN** — command in §22-B |

**D-6 (PostgreSQL timezone strategy) remains OPEN**, and Stage 0 changes the framing of it: the choice is not "UTC vs IST" in the abstract. Because 14 read paths already compare an operator's IST date to a UTC-resolved cast, *either* pinning the session to `Asia/Kolkata` *or* leaving it UTC silently changes what those queries mean. Whichever way D-6 goes, the prerequisite is the same: make the comparison explicit (`(created_at AT TIME ZONE 'Asia/Kolkata')::date`) rather than session-dependent. That is a Stage-1+ engineering statement, not a Stage-0 change; nothing was changed.

---

## 9. DB privilege findings — summary of U-2

Covered in §7/U-2. Additions worth pinning for Stage 1 planning:

- The two AI snapshot tables that *are* protected are protected by triggers copied into `migrations/add_ai_shadow_uniqueness_hardening.sql:82-97` (row-level `BEFORE UPDATE OR DELETE`, plus a statement-level `BEFORE TRUNCATE`). The correct pattern already exists in this repository — hardening is copy-and-extend, not invention. **CONFIRMED.**
- Because the app role is superuser, adding triggers alone still leaves `DROP TRIGGER` available to the same role. Privilege separation and immutability are therefore **one decision (D-8), not two**. **CONFIRMED** as a dependency.
- Whether the NAS database is actually reached only over the compose network, and whether the published port is still loopback-bound in the running config, is **UNKNOWN** (§22-D).

---

## 10. Audit immutability matrix (U-7)

| Table | DB guard (trigger) | App-level append-only | Actor trusted | Deletable by app? | Label |
|---|---|---|---|---|---|
| `study_snapshots` | **YES** — `BEFORE UPDATE OR DELETE` (content-immutable) | yes | n/a | no (by DB) | CONFIRMED |
| `ai_shadow_drafts` | **YES** — row-level + `BEFORE TRUNCATE` | yes | n/a | no (by DB) | CONFIRMED |
| `audit_logs` | **NO** | convention only | **NO** (see §14) | **YES** — `cron.ts:896` deletes after archive; also `db.delete` available | CONFIRMED |
| `voucher_audits` | **NO** | convention | **NO** — `editedBy` from body | YES | CONFIRMED |
| `bill_audits` | **NO** | convention | **MIXED** — body-first | YES | CONFIRMED |
| `patient_report_amendments` | **NO** | convention | MIXED | YES | CONFIRMED (absence of guard) |
| `radiology_audit_log` | **NO** | convention | MIXED (`b.actor ?? "system"`) | YES | CONFIRMED |
| `expenses` / `expense_payments` | **NO** | convention | session for actor; date client-supplied | YES | CONFIRMED |
| `bills` / `payments` | **NO** | convention | MIXED | YES | CONFIRMED |
| `vouchers` | **NO** | convention | **NO** | YES | CONFIRMED |
| `day_closures` | **NO** | convention | session | reopen = UPDATE, no delete | CONFIRMED |
| staff/payroll tables | **NO** | **no audit writer at all** | none persisted | **YES — hard DELETE ×5** | CONFIRMED (S0-5) |

Chain continuity itself (`verifyAuditChain`, `lib/audit.ts:223`) was **NOT TESTED** — running it requires a DB read on the production `audit_logs` table, which is reachable only on the NAS; §22-E gives the read-only command, and the plan's Stage-1 test T-list already covers within-segment verification.

---

## 11. Client-clock / business-date matrix (U-4) — central Stage-0 output

Class legend (from the audit): **A** DB-generated instant · **B** server-generated instant · **C** server-derived CARE business date · **D** client-supplied business date *by design* · **E** client-supplied instant written into an instant column · **F** unclear.

| # | Field / value | Producer (file:line) | Class | Today's default comes from | Server validates? | Trust verdict |
|---|---|---|---|---|---|---|
| 1 | `bills.created_at`, `payments.created_at`, `expenses.created_at`, `expense_payments.created_at`, `vouchers.created_at`, `*_audits.created_at`, `audit_logs.created_at` | `.defaultNow()` (metadata) | **A** | Postgres | n/a | **TRUSTED** |
| 2 | `bills.updated_at` | `$onUpdate(() => new Date())` | **B** | Node | n/a | **TRUSTED (different clock from #1)** |
| 3 | `expenses.expense_date` | `pages/Expenses.tsx:174→:477` → `routes/expenses.ts:346` → `expenseV2Service.ts:301` | **D** | browser UTC slice | `z.string()` only | **CLIENT-CONTROLLED** |
| 4 | `expense_payments.payment_date` | `Expenses.tsx:496` / `expenseV2Service.ts:330` (`paymentDate \|\| expenseDate`) | **D** | browser UTC slice | none | **CLIENT-CONTROLLED** |
| 5 | `expenses.invoice_date` | `Expenses.tsx:485` | **D** | free text input | none | **CLIENT-CONTROLLED** |
| 6 | `expenses.approved_by` | `Expenses.tsx:173+207` (`readStaffSession()` name) → payload `:488` | **D/E** | client's *cached copy* of the session | free text | **SPOOFABLE** |
| 7 | `vouchers.date` (create) | `pages/Accounting.tsx:390`, `:1328` | **D** | browser UTC slice | none | **CLIENT-CONTROLLED** |
| 8 | `vouchers.date` (edit) + `voucher_audits.editedBy/reason` | `routes/accounting.ts:295-313` | **D** + self-asserted actor | operator/AJAX body | no schema at all | **CLIENT-CONTROLLED, UNATTRIBUTED** |
| 9 | `vouchers.performedBy`, `editedBy` | body (`accounting.ts`) | **D** | typed value | none | **SPOOFABLE** |
| 10 | `form_f.date`, `procedure_date` | `pages/FormF.tsx:158,273,278` | **D** | browser UTC slice | none | **CLIENT-CONTROLLED** |
| 11 | `form_f.consent_date`, `mtp_date` | `FormF.tsx:274-277` default `""` | **D** | empty string | none | **`""` reaches a text date column** (S0-9) |
| 12 | `radiology_studies.study_date` | `routes/internal-radiology.ts:469,515-517` | **D** (machine) | agent body or DICOM `StudyDate`, `YYYYMMDD` coerced | format only | **DEVICE-CONTROLLED** |
| 13 | `study_tat_metrics.receivedAt/reportStartedAt/reportVerifiedAt/reportFinalizedAt` | `routes/smartRadiology.ts:587-620` | **E** | caller body, fallback `new Date()` | parseable-string | **CLIENT-CONTROLLED INSTANT** → feeds `slaBreached` |
| 14 | reports `signedAt`, `signedByName` | `routes/internal-reporting-studio.ts:814-816,859` behind `requireStudioKey` (`:90`) | **E** | studio client body | parseable-string | **CLIENT-CONTROLLED SIGNATURE** (S0-2) |
| 15 | `machines.reportedAt` (breakdown) | `routes/machines.ts:292` | **E** | body | parseable | **CLIENT-CONTROLLED** |
| 16 | `expenses.metaJson.confirmedAt` | `Expenses.tsx:491` | **E** (inside JSON) | browser instant | none | **CLIENT-CONTROLLED** |
| 17 | Day-close *window* `coveredFromTs/coveredToTs/closedAt` | `routes/day-close.ts:436,487,500-506` | **B/C** | Node `new Date()` | n/a | **SERVER-DERIVED** |
| 18 | Day-close `closureDate` label | `day-close.ts:500` via `Intl("en-CA",{Asia/Kolkata})` | **C** | Node clock | n/a | **SERVER-DERIVED (correct clinic day)** |
| 19 | Auto-voucher `vouchers.date` | `lib/auto-voucher.ts:193,288,377,455,541,614,685` (`istDateStr()`) | **C** | Node + IST | n/a | **SERVER-DERIVED — the target shape** |
| 20 | `cron.ts` `dateKey` | `cron.ts:1157,1254,1284`, archive keys `:882,927` | **F** | Node through UTC | n/a | **MISLABELED DAY (UTC)** |
| 21 | `vouchers`/`expenses` read filters `from`/`to` | `bills.ts:554`, `reconciliation.ts:302`, `books-sanity.ts:36`, `radiology.ts:1646` | **D→SQL cast** | operator string, UTC-resolved | none | **SEMANTIC MISMATCH (T-3/T-4)** |
| 22 | Printed echo/fetal PDF `studyDate` | `EchoCardiology.tsx:286`, `FetalEcho.tsx:216` | **D** | browser + UI locale | none | **RENDER-ONLY defect** (not persisted) |
| 23 | Offline queued bill | `lib/offlineBillingQueue.ts:115-147` | **A** | *no date in payload* | n/a | **GOOD PATTERN** |

**Counts:** of 23 rows, **7 are class A/B/C (server or DB authority)**, **11 are class D (client-supplied business date)**, **4 are class E (client-supplied instant into an instant-like column)**, **1 is class F**. Every persisted money *instant* is trusted; almost every persisted money *business date* is not.

**Attack A′ (workstation clock manipulation) therefore has a mundane twin that needs no malice:** at 03:00 IST a correctly-set browser pre-fills the previous calendar day (§13). This is why §21 classifies "business date earlier than the server day" as non-probative and why the only defensible detector is client-vs-server clinic-day **disagreement telemetry**, which does not exist today (**NOT TESTED / NOT PRESENT**).

---

## 12. Legacy Compatibility Census (U-5, re-framed)

**What this is not:** a list of suspicious historical records, a backdating census, or a data-quality score. Forward-only §3 forbids generating those, and none was generated.

**What this is:** an inventory of the date *formats and semantics* that CARE's own code writes today, because those are what a migration or a stricter parser will collide with. All entries are **CONFIRMED** from source. **No** column in the production database was sampled; row-level format prevalence is **UNKNOWN by design** and closing it would require an explicit, separately authorized read.

| Producer | Format written | Column type | Collision risk if read as a date | Notes |
|---|---|---|---|---|
| `expenses.expense_date` via browser default | `YYYY-MM-DD` (from a UTC slice) | `text` | low format risk; high semantic (UTC) risk | |
| `form_f.consent_date`, `mtp_date` | `""` | `text` | **breaks** — `''::date` errors (T-7) | `routes/formF.ts:37-42` defaults |
| `toLocaleDateString()` sites | `M/D/YYYY` or `D/M/YYYY` (UI-locale) | `text` | **breaks** — out-of-range error (T-7) | printed-PDF sites confirmed; historical write sites **UNKNOWN** |
| `radiology_studies.study_date` via agent/DICOM | `YYYYMMDD` compact → coerced to `YYYY-MM-DD` | `text` | partial: coercion exists, validity un-checked | `internal-radiology.ts:515-517` |
| `radiologyScheduledProcedures` | `YYYYMMDD` compact | `text` | needs the same coercion | cited in plan §6.1 |
| Emergency-kiosk JSON import | ISO `createdAt`, `voidedAt`, `tariffSyncedAt`, `startedAt`, `endedAt`, `exportedAt`, `patient.dateOfBirth` | mixed | **first thing to break under any strict date parse** | `deploy/windows-emergency/overlay/.../server.ts:1028`, `lib/emergency-billing/src/csv.ts:25,218` |
| `audit_logs` pre-retention rows | absent (deleted after archive) | n/a | chain discontinuity at the boundary | `cron.ts:860-900` |

Migration-relevant conclusion (**INFERRED** from the above, no data read): the plan's §6.1 "add column → copy verbatim where it parses → leave the rest untouched and on a review list" is the only shape that survives this census, because at least three producers write strings that a `::date` cast *rejects* rather than mis-parses. Any "parse and fix" migration would fail loudly at the `""` and locale-formatted values, not quietly.

---

## 13. Midnight IST findings (U-6)

Characterized at five boundaries (frozen in the suite as data-driven rows):

| Instant (IST) | Same instant (UTC) | `todayIST()` | `toISOString().slice(0,10)` | `timestamptz::date` (TZ=UTC) | Agreement |
|---|---|---|---|---|---|
| 2026-09-29 23:59 | 2026-09-29T18:29Z | 2026-09-29 | 2026-09-29 | 2026-09-29 | ✅ all agree |
| 2026-09-30 00:00 | 2026-09-29T18:30Z | **2026-09-30** | 2026-09-29 | 2026-09-29 | ❌ UTC idioms one day behind |
| 2026-09-30 00:01 | 2026-09-29T18:31Z | **2026-09-30** | 2026-09-29 | 2026-09-29 | ❌ |
| 2026-09-30 05:29 | 2026-09-29T23:59Z | **2026-09-30** | 2026-09-29 | 2026-09-29 | ❌ |
| 2026-09-30 05:30 | 2026-09-30T00:00Z | 2026-09-30 | 2026-09-30 | 2026-09-30 | ✅ re-converges |

Consequences, in descending order of everyday impact:

1. **Forms opened between 00:00 and 05:29 IST pre-fill the previous clinic day** (`Expenses.tsx:174`, `Accounting.tsx:507/1328`, `FormF.tsx:158`). An untouched "save" therefore records a business date one day before the server day, with no reason field and no audit row. **CONFIRMED.** This is the single most frequently-triggered path in the whole audit and it requires no intent.
2. **`radiology.ts:1646` "today" worklist counts** drop everything created between 00:00 and 05:29 IST into the previous bucket. **CONFIRMED** by construction (`todayISO()` at `:105` delegates to `todayIST()`, so label and cast disagree).
3. **`cron.ts` mixes both idioms in one file** — `todayIST()` for the daily-summary window (`:1124,1628`) and `toISOString().split("T")[0]` for `dateKey`/dedupe keys (`:1157,1254,1284`) and archive names (`:882,927`). Two different "today"s exist inside one process. **CONFIRMED.**
4. **Day-close is immune to #1**: `closureDate` derives from the Node clock through `Intl` with an explicit zone (`day-close.ts:500`), and the window itself is an instant pair. **CONFIRMED** — the boundary machinery is the best-written date code in the money path.
5. **A clinic that opens before 05:30 IST is the exposure condition.** Whether the clinic does — i.e. the earliest real transaction time of day — is a **management fact, not a code fact**, and was not measured (§22-F). Stage 1's D-2 discussion should treat it as the only input that matters.

`nowIST()` (`lib/istDate.ts`) was characterized as **broken and dead**: it round-trips an `en-CA` locale string through `new Date(...)`, which yields `Invalid Date`, and it has **zero** production callers (only the definition mentions it). Documented, not repaired (S0-7).

---

## 14. Actor-authority matrix (U-8)

| Write path | Actor source | Line | Classification |
|---|---|---|---|
| `POST /api/expenses` create | `session.subjectId/subjectName` | `routes/expenses.ts:348` | **TRUSTED SESSION** |
| `PUT /api/expenses/:id` audit actor | `session?.subjectId ?? null`, `session?.subjectName ?? "staff"` | `expenses.ts:530-531` (and again `:578-579`) | **TRUSTED SESSION** (but `reason` from body → MIXED; and the same anonymous `"staff"` fallback recurs when no session is present) |
| `PATCH /api/vouchers/:id` | `const { editedBy, reason, date, … } = req.body` — no schema, `400` if `editedBy` missing | `accounting.ts:295-298` | **CLIENT-SPOOFABLE** |
| `voucher_audits.editedBy` | body value, written verbatim | `accounting.ts:309-325` | **CLIENT-SPOOFABLE** |
| `bill_audits` discount-override actor | `(req.body?.editedBy) \|\| session?.subjectName \|\| …` | `bills.ts:1500,1523` | **MIXED — body wins** |
| `audit_logs` rows from `accounting.ts` | `userId: null, userName: "staff"` **hard-coded** | `accounting.ts:759,858,939,1024` (≥4 sites) | **ANONYMOUS BY CODE** |
| Clinical worklist audit actor | `b.actor ?? "system"` / `"mwl-agent"` | `routes/internal-radiology.ts` | **CLIENT-SPOOFABLE** |
| Critical-result acknowledgement | `b.acknowledgedBy` (body); instant is `new Date()` | `routes/patient-reports.ts` | **MIXED — instant trusted, actor not** |
| Reporting Studio finalize | body `radiologistName` → `signedByName`; body `finalizedAt` → `signedAt`; auth = shared `requireStudioKey`, no per-user session | `internal-reporting-studio.ts:90,814-816,859` | **CLIENT-SPOOFABLE + SHARED SECRET** |
| Structured report finalize (ERP) | `session.subjectName`; a client `createdBy` is explicitly ignored | `routes/patient-reports.ts` | **TRUSTED SESSION — GOOD PATTERN** |
| Staff / payroll / advances / salary / attendance / biometric | **no actor persisted, no audit call anywhere in the router** (grep count 0) | `routes/staff.ts` (9 write + 5 delete routes) | **NONE** |
| Super-admin book retagging | `db.execute(UPDATE orders/bills/patients/appointments SET ledger_id …)`, no audit insert | `routes/superAdminBooksHost.ts:74-81`, mounted `routes/index.ts:230` | **UNAUDITED (RBAC-gated)** |

**Answer to the brief's re-verification request:** voucher `editedBy` is **CONFIRMED body-supplied** — the audit's claim stands and is slightly *understated*, because the same route also takes `date` (the GL effective date) and `reason` from the same unvalidated body, and because the anonymous `"staff"` writer is systemic (≥4 sites) rather than a single occurrence.

---

## 15. Non-browser clients (U-9)

| Client | Transport | Auth | Date fields sent | Risk |
|---|---|---|---|---|
| `desktop/pull-agent/src/index.js:61-119` | Bearer → `/api/internal/dicom-agent/heartbeat\|log\|study-pulled\|check-duplicate` | `INTERNAL_API_KEY` (shared) | none | low |
| `artifacts/local-dicom-bridge/src/index.js:102,109` | same | same | none | low |
| `bridge-service/src/index.js:66-199` | `/api/bridge/*` | same | none | low |
| `scripts/verify-pacs-sync.mjs:48-53,166` | `/api/internal/radiology/studies` | same | `StudyDate: YYYYMMDD` | **device calendar into `study_date`** |
| `routes/internal-radiology.ts:469,515-517` | server side of the above | same | accepts `studyDate` **or** raw DICOM `StudyDate` | machine clock trusted by convention |
| Emergency kiosk `deploy/windows-emergency/overlay/.../server.ts:1028` | `/api/emergency-bridge/import-json` | bridge | 7+ ISO instants incl. `voidedAt`, `exportedAt` | **breaks first under strict parsing** |
| `src/cron.ts` | direct DB, no HTTP | n/a | `todayIST()` *and* UTC `dateKey` | internal inconsistency |
| `src/lib/auto-voucher.ts` | direct DB | n/a | `istDateStr()` | **GOOD — server-derived** |
| `src/worker.ts` | no `/api/` calls | n/a | none | none |
| External schedulers | `POST /api/internal/cron/*`, n8n → whatsapp dispatch outbox (`cron.ts:435,528,1203`) | internal key | none | low |
| Mobile/public | `diagno-booking-mobile/hooks/useApi.ts:25`, `clinic-site/src/pages/book.tsx:261-317` | public | booking dates only; explicitly *not* `/api/bills` | low |

**Implication for Stage 1+:** any server-side date-validation change lands on **machine** callers as well as browsers, and the kiosk import is the most brittle. `requireStudioKey` is also a *shared secret with no per-person identity*, so class-E writes at row 14 of §11 cannot be attributed even in principle today.

---

## 16. Form F findings (U-10)

- `pages/FormF.tsx:158` `today()` = browser `toISOString().slice(0,10)`; `:273,278` seed `procedureDate` and `date` from it → **class D, and the midnight defect §13-1 applies to a clinical register, not only money.**
- `:274-277` seed `consentDate: ""`, `mtpDate: ""` → **empty strings are written into date-typed-by-text columns** (audit F-23 confirmed; new Stage-0 label S0-9). Under T-7 these values would *error* if any future code path casts them.
- `:894-895,1345-1346` re-seed `procedureDate`/`date` from `data.billDate` when copying a prior entry → a copy-forward path that silently carries an old business date into a new record; **no reason field, no audit**. Legitimate workflow (§21), but it is exactly the shape Stage 2's "new action on an old record" rule must describe without condemning.
- `:1397-1402` re-hydrate with `?? ""` — the empty-string default is *both* a write default and a read default, so `""` is sticky.
- `:162` `formatDate` renders `en-IN` `DD/MM/YYYY` for printing, i.e. the *display* format differs from the *stored* format; a round-trip through the printed form would not parse. **CONFIRMED** (documented, not repaired).

---

## 17. Day-close findings (U-11)

- **The day is a half-open timestamp window, not a date.** `day-close.ts:229-242` filters `payments.created_at`, `bills.created_at`, `expense_payments.created_at` with `gt(from) AND lte(to)`. **CONFIRMED.**
- **Window bounds are Node, row instants are Postgres** (`:436,487,1146,1422,1862,2113` vs `.defaultNow()`): two clocks meet inside every close, agreeing on instants per §5. **CONFIRMED.**
- **`closureDate` is an IST label derived from Node's `to`** (`:500`, `:1433-1436`), while the read path re-derives "today" with a *different* helper (`:1652-1657` → `todayIST()`). Two derivations of the same concept. **CONFIRMED.**
- **Nothing is blocked.** `lib/closureBoundary.ts:11-16` states it is informational; the effect of a post-close edit is a `closedPeriodWarning` response field (`bills.ts:1536,1875,2115`) and an appended audit string `` `${editReason} [post-close edit: period closed at …]` `` (`bills.ts:1548-1549`). Immutability is achieved by *window arithmetic* (`maxBoundary()`, `:741-750`), not rejection. **CONFIRMED.**
- **Reopen is the well-built half**: super-admin-only (`:670`, `:2149`), reason required (`min(3)`), `reopenedAt` recorded, and `:2166` explicitly "do NOT delete the row". **CONFIRMED — good pattern, forward-only compatible.**
- **Two declared drawer actions have no writer anywhere**: `close_started` and **`post_close_override`** (`lib/db/src/schema/drawerAuditLog.ts:4-5`). The override action is *reserved vocabulary* — no code produces it, so no override is recorded today. **CONFIRMED.**
- Overall `day_closures` reopen writes **no audit row**, only `req.log.warn` (`:701`). **CONFIRMED.**
- **NEW (S0-6): drawer attribution is a name string, not an id.** `:733,826-827,894` key on `eq(paymentsTable.recordedByName, userName)` / `eq(billsTable.createdByName, userName)` / `eq(userDayClosuresTable.userName, userName)`. A renamed or duplicated staff display name silently splits or merges a drawer's totals and its post-closure activity. `routes/index.ts:228` already comments on "brittle exact display-name match". **CONFIRMED** — cash-accounting relevance, flagged for Stage 1.

---

## 18. Radiology / TAT clinical-time findings (U-12)

- **External-device time and CARE action time are not separated in the schema.** `radiology_studies.study_date` is the modality's calendar; `created_at` is CARE's. Both are text/timestamp respectively, but reports and dashboards mix them freely. **CONFIRMED (structural).**
- **TAT/SLA depends on client timestamps.** `routes/smartRadiology.ts:587-620`: `receivedAt: z.string().optional()`, then `b.receivedAt ? new Date(b.receivedAt) : new Date()`; `totalTat` and `const slaBreached = totalTat !== null && totalTat > threshold` are derived from those values, and the POST writes **no audit row**. A caller can therefore set `receivedAt` to any instant and change a breach verdict. **CONFIRMED.** Drizzle metadata additionally shows these columns are `PgTimestamp`, `hasDefault = false`, `notNull = false` — i.e. no DB-side default and no DB-side requirement.
- **Report signature block is client-authored** in the Reporting Studio path (§14, S0-2). **CONFIRMED.**
- **`machines.reportedAt`** (equipment breakdown) may come from the body (`routes/machines.ts:292`). **CONFIRMED.**
- **Body-spread routes**: `routes/echoCardiology.ts:171,175,196,200` (`.values({ studyId, ...b })`, `.set({ ...b, updatedAt: new Date() })`), plus `usgDoppler.ts` and a `smartRadiology` `.set({ ...req.body, … })`. Any client key, including a date key, reaches the row. **CONFIRMED.** Contrast: `dicomStudyManager.ts` parses its body, so unknown keys such as `createdAt` are stripped — **GOOD PATTERN, asserted in the suite so it cannot regress.**
- Whether the modality's DICOM clock is itself correct (no device NTP audit exists in CARE) is **UNKNOWN** and is an infrastructure question, consistent with the audit's rule that CARE may *measure and report* time but must not configure the NAS.

---

## 19. Machine / invoice / service dates (U-13)

| Field | Source | Class | Note |
|---|---|---|---|
| `expenses.invoice_date` | `Expenses.tsx:485` free text | D | vendor's printed invoice date; **legitimate historical entry** by nature |
| `expenses.bill_amount` + `expense_date` pair | duplicate check `expenseV2Service.ts:249`, hard-coded `<= 3` days | D | the ±3-day window is existing code, not a proposed policy; **cast risk S0-1** |
| `machines.reportedAt` | body | E | breakdown time is clinical-operations data |
| `tests.ts:186` bulk import | ≤5000 rows, **no date field** | — | server clock only; safe |
| `banking.ts:156`, `accounting.ts:1354,1421` | `fromDate`/`toDate` → `new Date(String(…))` | D | bank-statement dates are inherently historical |
| `inventory.ts:490`, `vendors.ts:230`, `packages.ts:229`, `patients.ts:217`, `doctors.ts:195` | CSV imports | D | no date validation recorded |
| `vouchers.date` from `auto-voucher` | `istDateStr()` | C | the model for Stage 2 |

---

## 20. Findings confirmed, revised, and newly discovered

### 20.1 Audit findings whose factual basis **changed** under Stage-0 evidence

| Audit finding | Change | New evidence | Severity |
|---|---|---|---|
| **F-01 / voucher re-date + self-asserted actor** (P1) | **Revised UPWARD in scope** — the route also takes `date` and `reason` from the same unvalidated body, and the anonymous `userName: "staff"` writer is systemic (**≥4 sites**: `accounting.ts:759,858,939,1024`), not the single site cited | CONFIRMED by direct re-read | **unchanged** (management's instrument) |
| **F-22 / `toLocaleDateString()` sites** (P2) | **Revised** — the two sites measurable today are **printed-PDF** paths (`EchoCardiology.tsx:286`, `FetalEcho.tsx:216`), not persisted writes. The persisted-write risk is real but its population is **UNKNOWN**; the finding's *format* claim stands, its *persistence* claim narrows | CONFIRMED (write sites) / UNKNOWN (historical prevalence) | **unchanged**; §12 census carries the migration consequence |
| **F-24 / retention vs chain** | **Refined, not changed** — archive-before-purge is now *paginated and checksummed* with "NO unarchived deletes" (`cron.ts:864-898`, "Gate G2"), which is materially better than the audit's wording implied. The chain-discontinuity consequence at the boundary still holds | CONFIRMED | **unchanged** |
| **Radiology "today" (`radiology.ts:1646`)** | **Revised NARROWER and CLEANER** — `todayISO()` at `:105` already delegates to `todayIST()`, so this is not a "wrong helper" case; it is purely a **label-vs-cast** mismatch (IST label compared to a UTC `DATE()`). The repo already enforces `todayIST` by source-contract test for *queue* routes (`lib/securityPerfHardening.sourceContract.test.ts:38-50`); radiology is outside that list | CONFIRMED | **unchanged** |
| **§15 "two-clock" hypothesis** | **CONFIRMED with a bound** — measured skew between Node and Postgres instants is 0 s locally; the divergence is calendar-only | §5 | n/a |
| **§11 "admin cannot assemble the five-ingredient evidence row"** | **CONFIRMED unchanged**; additionally no `expense_audits` table exists *anywhere* (schema directory scanned), and a date-only expense edit writes no audit row at all | CONFIRMED | n/a |

### 20.2 New Stage-0 findings (documented, **not** repaired)

| ID | Finding | Evidence | Preliminary category | Severity |
|---|---|---|---|---|
| **S0-1** | `expenseV2Service.ts:249` casts stored `expense_date::date`; since `CreateExpenseBody` accepts `""`, `"not-a-date"` and `"30/09/2026"` (§7 T-7), **any** such row makes the duplicate-detection query throw → `POST /api/expenses` 500s. A validation gap becomes an availability gap | CONFIRMED (mechanism measured in Postgres 16); row prevalence UNKNOWN | B + migration risk | **proposed** P2 — *proposal only; severity assignment is management's* |
| **S0-2** | Reporting Studio `/finalize` writes client-supplied `signedAt` and `signedByName` behind a **shared** `requireStudioKey` with no per-user session → a report's signature block is neither attributable nor time-trustworthy | CONFIRMED `internal-reporting-studio.ts:90,814-816,859` | D/E clinical | **proposed** P1 |
| **S0-3** | `bill_audits` discount-override actor prefers `req.body.editedBy` over the session | CONFIRMED `bills.ts:1500,1523` | D | **proposed** P2 (overlaps F-13) |
| **S0-4** | ≥4 `audit_logs` writers stamp `userId: null, userName: "staff"`, so those rows are unattributable by construction | CONFIRMED `accounting.ts:759,858,939,1024` | D | **proposed** P2 |
| **S0-5** | `routes/staff.ts`: 9 write routes, **0** audit calls (grep count over the file = 0), **5** hard `DELETE`s (`:137,169,267,363,466`, including advances and salary payments) → pay records can be erased with no trace | CONFIRMED | D + financial | **proposed** P1 |
| **S0-6** | Drawer/day-close attribution keys on the staff **display-name string**, not `subjectId` | CONFIRMED `day-close.ts:733,826-827,894` | C/D | **proposed** P2 |
| **S0-7** | `nowIST()` returns `Invalid Date`; zero callers (dead code) | CONFIRMED `lib/istDate.ts` | P4 hygiene | **proposed** P4 |
| **S0-8** | `radiology.ts:1646` IST-label-vs-UTC-cast mismatch (silently wrong counts, no error) | CONFIRMED | C | **proposed** P3 |
| **S0-9** | `""` is both the write default and the read default for Form F `consentDate`/`mtpDate`, so empty strings persist in date-semantics columns and are sticky | CONFIRMED `FormF.tsx:274-277,1397-1402` | C + migration | **proposed** P3 |

No application defect was fixed in Stage 0. Where Stage 0 found something serious (S0-1, S0-2, S0-5), the response is this table and the tests, per the brief's instruction: *document it, do not silently repair it*.

### 20.3 Severity policy

**No severity was changed by Stage 0.** The seven new items above are recorded as **proposals** for management to rate, exactly as §14A.1 of the audit requires ("do not change finding severities merely because management has selected a remediation policy" — and a fortiori not because a verification stage discovered them).

---

## 21. Historical-entry classification per workflow (§21 — input for D-2/D-3, no window invented)

**No backdating limit is proposed here.** This table says only where historical business-date entry is a normal part of the work, so that management can set the eventual window/approval tiers with evidence rather than guesswork.

| Workflow / module | Business date | Classification | Why |
|---|---|---|---|
| Cash drawer day-close, same day | n/a (instant window) | **CURRENT-DAY EXPECTED** | the boundary is defined as the day |
| Billing / payment entry at the desk | none (server clock) | **CURRENT-DAY EXPECTED** | no client business date exists |
| Expense entry for a bill paid this week | `expense_date`, `invoice_date` | **LEGITIMATE HISTORICAL ENTRY COMMON** | vendor invoices arrive days–weeks later; `invoice_date` is inherently the vendor's date |
| Expense payment / payout (`payment_date`) | text date | **LEGITIMATE HISTORICAL ENTRY COMMON** | cheque/NEFT settlement dates lag |
| GL vouchers (accrual, reversal, correction) | `vouchers.date` | **LEGITIMATE HISTORICAL ENTRY COMMON** | month-end accruals are posted after the period |
| Bank-statement reconciliation | `fromDate`/`toDate`, statement dates | **LEGITIMATE HISTORICAL ENTRY COMMON** | the data *is* history |
| Form F register (procedure/consent/MTP dates) | `procedure_date`, `consent_date`, `mtp_date` | **LEGITIMATE HISTORICAL ENTRY OCCASIONAL** | retrospective registration happens; consent dates are prior-dated by nature |
| Radiology study date (`study_date`) | device-supplied | **LEGITIMATE HISTORICAL ENTRY OCCASIONAL** | a pulled study may pre-date its arrival (referred images, late registration) |
| Report **signature** / finalization time | client `signedAt` | **HISTORICAL ENTRY SHOULD BE EXCEPTIONAL** | a signed report's timestamp is a professional attestation; back-dating it is a different act from late *entry* |
| TAT/SLA received & verified timestamps | client `receivedAt`… | **HISTORICAL ENTRY SHOULD BE EXCEPTIONAL** | these feed performance measures; backfill changes the measure, not the record |
| Critical-result acknowledgement time/actor | body `acknowledgedBy` | **HISTORICAL ENTRY SHOULD BE EXCEPTIONAL** | clinical safety attestation |
| Payroll advance / salary payment | `advanceDate`, body-supplied | **HISTORICAL ENTRY OCCASIONAL → SHOULD BE EXCEPTIONAL** | legitimate corrections exist (retro-pay), but there is currently *no* audit writer at all (S0-5), so the exception is invisible |
| Vendor invoice date | `invoice_date` | **LEGITIMATE HISTORICAL ENTRY COMMON** | controlled by a third party |
| Report amendment | n/a today (no `effective_date`) | **HISTORICAL ENTRY SHOULD BE EXCEPTIONAL** | `patient_report_amendments` is the one place the audit found this handled with a reason + version |
| Any *edit* of a closed day | none (annotation only) | **HISTORICAL ENTRY SHOULD BE EXCEPTIONAL** | `closureBoundary` warns, `post_close_override` is declared but never written (§17) |

**Engineering read for management, without proposing the policy:** the "common" rows are all cases where the *business date legitimately precedes the entry instant* and the record is still true. The "exceptional" rows are all cases where the date is an **attestation** rather than a **property of the document**. That distinction — attribute vs attestation — is the axis D-2/D-3 should be built on, and it is better than a uniform day-count. Also material: **the §13-1 midnight default means a CURRENT-DAY EXPECTED workflow can produce a D-1-viable backdated-looking row with zero human intent**, so any tier that keys only on "date < today" will fire mostly on false positives between 00:00 and 05:29.

---

## 22. Decision-support: D-2 … D-13 (§20 requirement)

Each entry: **MEASURED FACTS → OPTIONS → TRADE-OFFS → RECOMMENDED ENGINEERING DEFAULT → MANAGEMENT DECISION REQUIRED.** No policy is selected here silently; the "recommended" line is engineering's opinion about implementability, not a decision.

### D-2 — exact backdating window (status: PARTIAL, DEFERRED UNTIL STAGE 0)

- **MEASURED FACTS.** Client defaults supply the business date in 11 of 23 matrix rows; the midnight window (§13) makes "yesterday" the *automatic* value for 5h30m daily; legitimate historical entry is COMMON in 6 workflows and OCCASIONAL in 3 (§21); there is no reason field on expense updates (`UpdateExpenseBody` shape has no `reason`); a date-only expense edit writes **no** audit row; `voucher_audits` records a reason but the actor is self-asserted.
- **OPTIONS.** (a) uniform hard window (e.g. ≤N days) on all modules; (b) per-module tiers (money = attribute, attestation = exception) with a window per tier; (c) no window, reason-plus-approval required for any date ≠ server clinic day; (d) no window and no reason, only a *disagreement telemetry* signal; (e) window only *post-cutover* (forward-only) with the cutover as the gate.
- **TRADE-OFFS.** (a) is one rule that staff can memorize but will break legitimately every month-end accrual and every late vendor bill, so it produces operational work without forensic value. (b) matches the evidence but multiplies configuration and needs a per-route map. (c) removes the "just click save" accident but adds friction to the highest-volume path (expenses). (d) is cheapest and safest to deploy but changes nothing about what can be written. (e) is the only option consistent with the forward-only ruling but requires D-13 first.
- **RECOMMENDED ENGINEERING DEFAULT.** Implementability favors **(e) + (d) as the first increment**: record `effective_date_source` and a server-vs-client clinic-day comparison from cutover forward, alert on persistent per-operator disagreement, and *defer any numeric window* until that telemetry has run for a month. A window chosen before telemetry is a guess wearing a number.
- **MANAGEMENT DECISION REQUIRED.** Yes — the numeric window, the per-module tiers, and whether staff are asked for a reason at all. Engineering cannot choose these.

### D-3 — role / module / tier matrix (DECIDED IN PRINCIPLE)

- **MEASURED FACTS.** RBAC is uneven: `requireStaffSubPermission("/settings","users")` gates `routes/staff.ts` (mounted `routes/index.ts:548`); day-close uses `requireOwnerOrAdmin` and `requireSuperAdminStaff`; the Reporting Studio path uses a **shared API key with no personal identity**; payroll has no actor persisted at all.
- **OPTIONS.** (a) extend existing day-close-style roles to money writes; (b) a per-module tier table (owner/super-admin/staff × attribute/attestation); (c) keep RBAC, add a *second* person for attestation-type dates; (d) defer RBAC until S0-5 (unaudited payroll deletes) is fixed.
- **TRADE-OFFS.** (a) is least new code but bakes today's accidental role map into policy. (b) is explicit but needs a place to live (config vs code vs DB). (c) is the only control that survives collusion-by-one-person, at the cost of throughput at a small clinic. (d) is tempting but leaves the worst hole (no payroll audit) open while the debate happens.
- **RECOMMENDED ENGINEERING DEFAULT.** (b) as data, enforced centrally, with (c) reserved for the attestation rows of §21 — and treat fixing S0-5 as a **prerequisite** rather than part of the matrix, since a tier system over routes that write no audit row is unenforceable.
- **MANAGEMENT DECISION REQUIRED.** Yes — which roles may enter which historical dates, and whether two-person approval applies to attestations.

### D-6 — PostgreSQL timezone strategy (DEFERRED → stays OPEN, now with data)

- **MEASURED FACTS.** Server default `TimeZone = UTC` (image, `source = configuration file`); no `TZ`/`PGTZ` in the `db` service; `TimeZone` is `user`-settable; 14 `::date` sites depend on the session value; `''::date` and `MM/DD/YYYY::date` **error**; production value UNKNOWN (§22-B).
- **OPTIONS.** (a) leave UTC and make every comparison explicit (`AT TIME ZONE 'Asia/Kolkata'`); (b) set `ALTER DATABASE … SET timezone = 'Asia/Kolkata'`; (c) pin `PGTZ`/`TZ` in the container env; (d) store a parallel `clinic_date` generated column.
- **TRADE-OFFS.** (a) is correct and auditable but touches 14 read sites and any future one — the discipline must be enforced by tests (the repo already proves this pattern works: `securityPerfHardening.sourceContract.test.ts`). (b) changes the meaning of 14 existing queries *atomically at deploy time*, including every historical report anyone re-runs — the sharpest backward-behaviour change available, and the one most likely to make an old report disagree with itself. (c) same semantics as (b) but per-container, silently divergent if a container loses env. (d) adds a column rather than redefining one, which is forward-only-friendly, but costs storage and needs backfill policy.
- **RECOMMENDED ENGINEERING DEFAULT.** **(a) + (d)**: keep the engine at UTC, make business-day reads explicit, and add an explicit clinic-date column *forward* rather than redefining `::date` semantics under existing reports. Reject (b)/(c) unless management explicitly accepts that every historical day-boundary report changes.
- **MANAGEMENT DECISION REQUIRED.** Yes — specifically whether any already-published report's numbers may move.

### D-7 — retention (DEFERRED)

- **MEASURED FACTS.** `audit_logs`: `RETENTION_DAYS = 730`, paginated archive to `data/archives/audit-logs/audit_archive_*.json.gz` + `.sha256`, then `db.delete` (`cron.ts:860-900`); archive name uses a **UTC** key (`:882`); no DB-level immutability on `audit_logs`; no retention job found for `voucher_audits`/`bill_audits` (search found deletes only for `audit_logs`).
- **OPTIONS.** (a) keep 730 hot + cold files; (b) never delete, only move; (c) longer hot period for financial evidence; (d) make the archive chain-verifiable (checksum-of-checksums) and treat files as part of the evidence set.
- **TRADE-OFFS.** (a) is cheap and already works, but the chain breaks at the deletion boundary and the files are only as trustworthy as the NAS filesystem. (b) grows unbounded on a Synology volume. (c) is a partial fix. (d) is what makes deletion defensible for a clinical record and is roughly one file-per-archive manifest.
- **RECOMMENDED ENGINEERING DEFAULT.** (d), plus fix the archive key to use the clinic day so an archive spanning the 05:30 IST boundary is not mislabeled — and note that "fix the key" is a *naming* change, not a data change, so it does not conflict with forward-only.
- **MANAGEMENT DECISION REQUIRED.** Yes — retention period, cold-storage location, and who may hold the checksums.

### D-8 — DB immutability / privilege architecture (DEFERRED)

- **MEASURED FACTS.** The app role is the bootstrap superuser (config CONFIRMED, analogue `rolsuper = t` measured); 0 `GRANT`/`REVOKE`/`CREATE ROLE` in 181 migrations; append-only triggers exist for 2 tables and the pattern is copy-and-extend; `audit_logs` is deleted by cron; `staff.ts` hard-deletes pay rows.
- **OPTIONS.** (a) append-only triggers only; (b) triggers + a dedicated non-superuser app role (`CREATE ROLE`/`GRANT`) with separate migration/audit roles; (c) role separation + a write-only audit role that cannot `UPDATE`/`DELETE` (true WORM); (d) off-database evidence (hash anchor to a second system).
- **TRADE-OFFS.** (a) is one migration and immediately closes the "generic patch endpoint" case, but a superuser can `DROP TRIGGER`, so (a) alone is theatre for the app-compromise scenario. (b)/(c) are the only options that answer U-2's actual question; they require a controlled rollout because the repo's 11 maintenance scripts reach the DB via `docker exec` and today's `DATABASE_URL` is a single string — a wrong role migration breaks backups, not just writes. (d) is strongest forensically and weakest operationally.
- **RECOMMENDED ENGINEERING DEFAULT.** **(a) then (b)** in two separate, independently revertible steps, with (c)'s write-only audit role scoped before any claim of tamper-evidence is made in a policy document. The `superAdminBooksHost.ts:74-81` unaudited raw `UPDATE`s must be added to the same sweep or the trail has a known gap by design.
- **MANAGEMENT DECISION REQUIRED.** Yes — role architecture is an infrastructure decision with deploy risk, and the brief forbids Stage 0 from touching it.

### D-9 — reporting / restatement implications (DEFERRED)

- **MEASURED FACTS.** 14 read sites bucket by UTC (§7); day-close immutability is window arithmetic (`maxBoundary`) so a closed period's totals *can* still change if an operator re-dates an underlying row's… `created_at`-independent business date — the *business*-date reads (`expenses.ts` list via `expense_date` string comparison `:654-655`) are pure text comparisons, so a restatement is already possible with no signal at all; `books-sanity.ts` and `reconciliation.ts` exist as sanity tooling but key on UTC windows.
- **OPTIONS.** (a) treat any business-date edit of an already-reported period as a restatement requiring a note; (b) recompute and version reports; (c) publish "as-of" pairs (business date + entry instant) on every money report; (d) do nothing until D-2's telemetry exists.
- **TRADE-OFFS.** (a) matches the D-4 correction model but needs a period notion that day-close already has. (b) is the accounting-correct answer and the most work. (c) is cheap and highly informative — it is essentially the §11 five-ingredient admin view from the audit — and it can be done additively. (d) avoids guessing but leaves owners reading two different numbers for the same month.
- **RECOMMENDED ENGINEERING DEFAULT.** **(c) first, then (a)**: an "as of" column pair on money reports is additive, forward-only, and is the concrete artifact that makes the audit's evidence row assembleable.
- **MANAGEMENT DECISION REQUIRED.** Yes — whether restatement must be visible to non-owners, and which reports are "official".

### D-10 — external clock authority (DEFERRED)

- **MEASURED FACTS.** Local chain skew measured at 0 s (§5); NAS host time source and NTP status **UNKNOWN**; DICOM device clocks unverified; kiosk/studio/agent instants accepted without a sanity range; no clock telemetry endpoint exists.
- **OPTIONS.** (a) treat server (NAS) as the sole authority and reject client instants outside a sanity range; (b) accept client instants but record `time_received` (Postgres) next to `time_processed` (Node) and alert on divergence; (c) add a health probe that reports each container's clock and the DB's; (d) reach for external time (NTP/stratum) — an infrastructure act, not an application one.
- **TRADE-OFFS.** (a) is the strongest and would break legitimate offline capture (the queue is exactly why it works today, §11 row 23). (b) is the plan's existing Stage-1 primitive and detects a lost TZ pin without changing any behaviour. (c) costs nothing and closes the "silently trust the NAS" gap the audit complained about. (d) is explicitly out of scope per the audit's own rule that CARE may *measure and report* the time source, not configure it.
- **RECOMMENDED ENGINEERING DEFAULT.** **(b) + (c)** — measure and report; do not attempt to control the NAS or any device. Defer (a) until offline capture has an explicit reconciliation design.
- **MANAGEMENT DECISION REQUIRED.** Yes — whether the clinic accepts that its authority chain ends at the NAS's own clock, and who owns NAS time.

### D-11 — payroll parity (DEFERRED)

- **MEASURED FACTS.** `routes/staff.ts`: 9 write routes, 0 audit calls, 5 hard `DELETE`s; `advanceDate: (body.advanceDate as string) || todayIST()` — a *server* fallback exists here while expenses/vouchers have none, so payroll is half-adopted: better date defaults than GL, worse audit than everything.
- **OPTIONS.** (a) bring payroll into the same effective-date model as expenses; (b) treat payroll as out-of-scope (D-5 already excludes *payout* effective-date work) and fix only the deletes; (c) make payroll append-only (`is_active`/`voidedAt`) like expense attachments already do; (d) add an `expense_audits`-equivalent payroll audit table.
- **TRADE-OFFS.** (a) risks contradicting the D-5 ruling that payout effective dates are out of scope. (b) is smallest but leaves the erase-without-trace capability (S0-5). (c) matches an existing repo convention — `softDeleteExpenseAttachment` proves the team already prefers soft deletes elsewhere — and is a pure code change. (d) is the only way a payroll correction ever becomes reviewable.
- **RECOMMENDED ENGINEERING DEFAULT.** **(c) + (d)**, and *not* (a): payroll needs an audit trail and non-destructive deletes before it needs an effective-date model. Also note the interaction with S0-6: payroll identity is name-based too.
- **MANAGEMENT DECISION REQUIRED.** Yes — whether payroll records may ever be deleted, and who may correct a salary payment.

### D-13 — exact cutover mechanism (DECIDED IN PRINCIPLE, mechanism open)

- **MEASURED FACTS.** There is **no** `time_integrity_cutover_at` anywhere (asserted by test), no `effective_date`, no `effective_date_source`, no `backdated` column on any money table (FORWARD-ONLY GUARD test passes). The plan's §1.5 properties (single row, read by every write, immutable after set, deploy-scoped) are satisfiable by: a one-row table, a `GET /api/health/clock`-adjacent read, or a config value. Also relevant: `superAdminBooksHost` raw `UPDATE`s and the retention delete job are the two mechanisms that could move a row's meaning *after* cutover without leaving evidence.
- **OPTIONS.** (a) one-row DB table written once by a migration; (b) an env/config value pinned at deploy; (c) a release-time constant in code (no DB read); (d) derive from the first `audit_logs` row of the new regime.
- **TRADE-OFFS.** (a) is queryable and joinable, but the app role is superuser so "immutable after set" needs a trigger or role work → depends on D-8. (b) is easy but changes meaning if the container env changes, and the audit already flags a lost TZ pin as a real risk. (c) is tamper-evident via git/deploy history and needs no new privilege, but is invisible to SQL reporting views. (d) is self-selecting and fragile — a retention delete or a clock change moves the epoch.
- **RECOMMENDED ENGINEERING DEFAULT.** **(a) with a guard trigger, plus (c) as the cross-check**: the table is what the nine cutover-scoped views need to read, and the code/deploy constant is what proves nobody edited the table. Both are additive and reversible, satisfying "every stage deployable without historical cleanup".
- **MANAGEMENT DECISION REQUIRED.** Yes — the cutover *moment* (a deploy window, not a code merge) and who is authorized to set it. Engineering must not choose the instant.

---

## 23. UNKNOWN items, with the command that closes each

All ERP production values are **UNKNOWN** because the `care-db`/`care-api` containers live on the Synology NAS and are not reachable from this workstation. Each command below is read-only and safe to run in a maintenance window via `docker exec` (the repo's own convention: 11 maintenance scripts already reach the DB that way).

| ID | Unknown | Command (READ ONLY) |
|---|---|---|
| A | NAS host clock, timezone and NTP sync status | DSM: `date`; `synotime --show` (or `ntpdate -q <pool>` observation only) |
| B | `care-db` effective timezone | `docker exec care-db psql -U erp -d diagnostic_erp -c "SHOW TimeZone;"` and `… -c "SELECT name,setting,source FROM pg_settings WHERE name='TimeZone';"` |
| C | live role graph / ownership / privileges | `docker exec care-db psql -U erp -d diagnostic_erp -At -c "SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);"` plus the `has_table_privilege` matrix over `audit_logs, voucher_audits, bill_audits, expenses, expense_payments, bills, payments, vouchers` |
| D | whether the published DB port is still loopback-bound, and whether the default password is still `changeme` | `docker port care-db`; `docker inspect care-db --format '{{json .Config.Env}}'` (values only — do not print secrets into any log) |
| E | `verifyAuditChain` over retained segments; boundary behaviour | a read-only admin invocation of `lib/audit.ts:223` against `care-db`, then again restricted to `created_at >= retention_cutoff` |
| F | the clinic's earliest real transaction time of day (does business start before 05:30 IST?) | aggregate over `payments.created_at` **min/max by clinic day** — requires an explicit, separately authorized read; deliberately **NOT** done in Stage 0 |
| G | prevalence of `""` / non-ISO strings in `expenses.expense_date`, `vouchers.date`, `form_f.*_date` | `SELECT count(*) … WHERE <col> !~ '^\d{4}-\d{2}-\d{2}$'` — a *format* census, **NOT** a backdating census; requires authorization, not run |
| H | whether any `ALTER DATABASE/ROLE SET timezone` exists | `\drds` / `SELECT oid::regrole, setconfig FROM pg_db_role_setting` |
| I | client-clock disagreement rate (Attack A′ detection) | **not obtainable** — no client-vs-server clinic-day telemetry exists in the code today |
| J | whether S0-1 has ever fired in production | API logs for `invalid input syntax for type date` on `POST /api/expenses` |

Additionally **NOT TESTED** (would require mutation, and is therefore out of Stage-0 scope per §23 of the brief): the effect of a TZ-pin loss on a running container (requires restart), the behaviour of a future `date`-typed column against dirty rows (requires a migration), and day-close windowing under a deliberately skewed Node clock (requires staging). The safe staging method for each is a disposable `postgres:16-alpine` + `care-api` compose project with a seeded fixture DB — which is how this document's U-1/U-2 measurements were taken against the emergency stack.

---

## 24. Characterization tests (§18 coverage map)

Two suites, both pure/static — **no database connection, no writes, no fixtures, no network**:

- `artifacts/api-server/src/lib/businessTime.stage0.characterization.test.ts` — **53 tests**
- `artifacts/diagnostic-erp/src/lib/businessTimeClient.stage0.characterization.test.ts` — **13 tests**

| §18 required area | Where | Count |
|---|---|---|
| 1. trusted `createdAt` behaviour | U-1/U-7 metadata block (`hasDefault === true` on 7 tables), §18(8) update test | 3 |
| 2. client-supplied business dates | U-4/U-5 zod block; whole ERP suite | 12 |
| 3. voucher edit / re-date behaviour | U-8 source-contract tests (no schema; body `date`+`editedBy`) | 2 |
| 4. actor attribution | U-8 describe (7 tests) + ERP U-8 (2) | 9 |
| 5. current day-close behaviour | U-11 describe (5 tests) + §18(9) my-close | 6 |
| 6. midnight UTC/IST behaviour | U-10 describe (5 boundary rows, 4 tests) + ERP measured consequences | 6 |
| 7. current audit-immutability assumptions | U-7 describe (5 tests) | 5 |
| 8. old record + current mutation | §18(8) describe | 4 |
| 9. existing normal current-day workflow | §18(9) describe | 3 |
| 10. legacy records valid without new fields | §18(10) describe + FORWARD-ONLY guards in U-1/U-7 blocks | 6 |

**Characterization vs future contract (§19).** Every test asserts *current* behaviour, including the undesirable ones: a non-date `expenseDate` parses, a voucher's actor comes from the body, a UTC slice returns yesterday's clinic day, `nowIST()` is broken and unused, no audit table is DB-guarded. The only forward-looking tests are **guards against Stage 0 itself** — they assert that the remediation's future columns (`effectiveDate`, `effectiveDateSource`, `backdated`) and any new required `reason` do **not** exist yet, and that no migration rewrites historical dates. Nothing in the suite fails merely because Stage 1–6 is unimplemented, and both suites are green on `origin/main`.

Both files carry a header instruction: *do not "fix" a red test by changing application code — if a Stage-0 test turns red, the application changed its behaviour and that change must be reviewed on its own merits.* This suite is therefore the mechanical form of the forward-only rule: a future "cleanup" migration or a silent date-normalization would break it.

Style precedent: the repository already uses source-contract tests of exactly this shape (`lib/securityPerfHardening.sourceContract.test.ts:38-50`), so these suites add no new testing paradigm.

---

## 25. Recommended Stage-1 prerequisites

These are the conditions under which Stage 1 can succeed, in order. Nothing here is a remediation itself.

1. **Privilege/immutability ground truth first (D-8 input, closes U-2).** Run §23 rows C and D on the NAS. If the app role is superuser as expected, then every future "tamper-evident" claim must be phrased as *application* discipline, not database guarantee, until role separation ships. Stage 1's `time_received`/`time_processed` primitive is safe either way; a trigger-based guard is not.
2. **Clock telemetry before any policy (`GET /api/health/clock`, §23-A/B/E).** Report container date, `SHOW timezone`, `now()`, `todayIST()` and the DB-vs-Node instant delta at boot and periodically. Zero behavioural change; it is what makes D-10 decidable and is the only way a lost TZ pin is noticed.
3. **Fix the *defaults*, not the data.** The §13-1 finding is the highest-value, lowest-risk change available to CARE: replace the browser's `toISOString().slice(0,10)` pre-fill with the clinic day supplied by the server (a read-only `GET` of `todayIST()` already exists in spirit). This removes the accidental-backdating generator **without** touching a single historical row and without any policy decision — it changes what a blank form says, not what a record means. Recommend this as Stage 1's first deployable increment.
4. **Add the two-column primitive (`time_received`, `time_processed`) on post-cutover financial writes only**, additively and nullable across history, per plan §1.1. No read path changes.
5. **Client-vs-server clinic-day disagreement telemetry** (the only detector for Attack A′ that does not assume the attacker used the API). Log-only; alert thresholds after a month of data, per D-2.
6. **Close the unaudited writers before any tier/approval policy** (S0-5 payroll, S0-4 anonymous `"staff"` actors, S0-3 body-first bill actor, `superAdminBooksHost.ts:74-81` raw `UPDATE`s). A policy layered on routes that record no actor is unenforceable, and Stage 3's audit-evidence design is the natural home for these.
7. **Explicit timezone comparisons at the 14 `::date` sites** (or a clinic-date column forward, D-6 options (a)+(d)), enforced by a source-contract test in the style of the one this suite copies, so drift cannot re-open silently.
8. **Do not schedule the cutover until 2 and 4 are deployed** (D-13): the cutover instant is only meaningful once the clock is being reported and the two-column primitive exists to record both sides of it.
9. **Deferred pending management decisions: D-2 numeric window, D-3 tier matrix, D-6 timezone strategy, D-7 retention period, D-8 role architecture, D-9 restatement visibility, D-10 clock authority, D-11 payroll, D-13 cutover moment.** None of these may be answered by engineering by default; §22 is written so each can be decided from a single page.

---

## 26. Gates run (§25 of the brief)

Every gate was run on this branch and, where the result was not clean, **against current `origin/main` with the Stage-0 files physically removed from the tree** — the "pre-existing" claim is proved, not asserted.

| Gate | Command | Result |
|---|---|---|
| Typecheck, api-server | `node --stack-size=16000 ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | **PASS** (exit 0) |
| Typecheck, diagnostic-erp | same, in `artifacts/diagnostic-erp` | **PASS** (exit 0) |
| Typecheck, libs graph | `node --stack-size=16000 node_modules/typescript/bin/tsc --build` (root `typecheck:libs`) | **PASS** (exit 0) |
| Targeted: Stage-0 suites | `node node_modules/vitest/vitest.mjs run <both files>` | **66 passed / 0 failed** (53 + 13) |
| Full ERP suite (HEAD) | `node ../../node_modules/vitest/vitest.mjs run` in `artifacts/diagnostic-erp` | 323 files: 2 failed, 321 passed · 4008 tests: 1 failed, 4007 passed |
| Full ERP suite (**baseline**, Stage-0 files moved out of the tree) | same | 322 files: 2 failed, 320 passed · 3995 tests: 1 failed, 3994 passed |
| ERP failure identity | — | **identical in both runs**: `lib/aiQueryContract.test.ts` (Windows path-separator assertion) and `lib/reportComposer/composeStudyContext.test.ts` (needs `DATABASE_URL`). **Pre-existing, proved against main.** |
| api-server suite (**baseline**, files removed) ×2 | `node node_modules/vitest/vitest.mjs run artifacts/api-server` | 84 failed / 319 passed files; **36** failed / 3020 passed tests — stable across two runs |
| api-server suite (HEAD) ×4 | same | run A 84/37 · run B 90/49 · run C 88/44 · **run D 84 failed / 320 passed, 36 failed / 3073 passed** |
| api-server interpretation | — | The baseline is **not** green on this workstation: 84 files fail because the ERP Postgres/`DATABASE_URL` is on the NAS and unreachable here (225 DB-related error lines in every run, including baseline). Run D's failure list is **identical to the baseline list** except a random temp-directory name inside a log line, and HEAD adds exactly **+53 passing tests, 0 new failures**. The upward excursions in runs A–C are `Error: Test timed out in 5000ms` on disk/spawn-heavy tests (1 timeout in baseline, 6–7 in the worst HEAD run) under concurrent load on this box, **not** new assertion failures. No `businessTime*` test appears in any failure list. |
| ERP production build | `./node_modules/.bin/vite build --config vite.config.ts` | **PASS** — `✓ built in 13.38s`, 0 errors (chunk-size warnings only, pre-existing) |
| Migration-order preflight | `node scripts/check-migration-order.cjs` | **PASS** — "No ordering violations" |
| Migration-order spec | `node node_modules/vitest/vitest.mjs run scripts/check-migration-order.test.cjs` | **PASS** — 4 tests |
| Grounding / architecture claims | `node scripts/grounding-check.cjs` | **PASS** — "All 105 architecture claims hold against the code" |
| API route-coverage tool | `node scripts/api-route-coverage.mjs` | **COULD NOT RUN** — `ENOENT: C:\\C:\\Users\\…` from `scripts/api-route-coverage.mjs:6`, which builds `root` from `new URL(import.meta.url).pathname` (a `/C:/…` string on Windows). Pre-existing Windows bug in repo tooling; **documented, not repaired** (Stage 0 changes no code). |

No gate was run against, or changed, production.

---

## 27. What Stage 0 did **not** do

No backdating blocked; no window invented; no reason/approval workflow added; `time_integrity_cutover_at` not implemented; PostgreSQL timezone not changed; NAS/container timezone not changed; NTP not touched; `clinicTodayIST()`/`todayIST()` behaviour untouched; `Date()` not replaced anywhere; no financial effective dates added; day-close behaviour untouched; RBAC untouched; audit immutability untouched; no triggers or `REVOKE`s added; no historical date normalized; no historical record rewritten; no entry classified as suspicious; no retrospective backdating report built; nothing deployed; nothing merged by this PR.

*Document ends. Stage 0 verdict: the audit's factual basis is confirmed, six of its claims are refined by measurement, seven new findings are recorded for management rating, and the remediation stages can proceed on evidence rather than inference — with D-2, D-3, D-6…D-11 and D-13 still requiring management decisions.*
