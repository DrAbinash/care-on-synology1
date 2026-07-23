# CARE Staff/HR Module — Phased Implementation Plan

**Status:** Phase 0 merged (PR #205); Phase 1 People-platform foundation in progress · **Date:** 2026-07-23

Small, reviewable PRs — never one uncontrolled rewrite. Every phase is additive, feature-flagged, and
avoids the Financial Freeze unless routed through `FINANCIAL_CHANGE_CONTROL.md` with owner sign-off.
Owner review reframed this as the **People Management platform** (`CARE_PEOPLE_MANAGEMENT_PLATFORM.md`).

---

## Phase 0 — Audit & design ✅ (merged, PR #205)
- Repository audit, fingerprint audit, architecture, policy config, rollout, open issues, ADR-003.
- Foundation tables (`designations`, `staff_status_history`, `staff_reporting_lines`, `staff_documents`),
  `ff_hr_*` flags (disabled), pure score engine. No feature activation.

## Phase 1 — People-platform foundation (in progress)
**Landed in the follow-up (safe, inert, additive):**
- `staff_user_links` — strict **1:1** `staff↔users` identity (owner decision), single source of truth.
- `skills` + `staff_skills` — skill matrix. `staff_timeline_events` — auto-generated 360° activity timeline.
- `attendanceSource.ts` — inert attendance-source **abstraction** (one interface, one event; no hardware).
- Design docs updated to the People Management platform + 360° profile; five owner decisions recorded.
- **Foundation API** `routes/people.ts` (mounted `/api/people`, gated by the existing HR permission +
  `ff_hr_staff_enhanced`, audited, zod-validated): the **360° profile** assembler, designations, skills
  master + staff skill matrix, reporting lines, **derived org chart**, status history, timeline,
  document vault (metadata), and the 1:1 identity link. Non-financial; no salary/payroll field touched.
- **USB fingerprint stabilized** (server): raw-punch preservation + idempotency + audit + flag gate
  (`recordStaffPunch`, `attendance_raw_punches`); adapter contract validation + mock test.

**Follow-up PRs (reviewed):**
- Register `staff`/`hr`/`people` permission modules by **extending** the existing matrix (owner decision).
- Read/write routes for designations, skills, reporting lines, documents, timeline (reuse
  `auditFromRequest`, presigned uploads, zod). *Files:* new `routes/staffHr.ts`; mount in `routes/index.ts`.
- Frontend: premium **CRM-style 360° profile** (Overview/Employment/Attendance/Performance/Recognition/
  Documents/Payroll/Training/Warnings/Timeline/Audit tabs) + directory; standardise on `ui/table.tsx`;
  gate with `ff_hr_staff_enhanced`. Derived **org chart** from `staff_reporting_lines`.

## Phase 2 — Attendance foundation
- Manual attendance (exists) + shift/roster model + `attendance_raw_punches` + `attendance_daily_summaries`
  + `attendance_corrections` (workflow + audit) + `attendance_import_runs` + CSV/test import.
- `AttendanceProvider` abstraction over `source`; complete the USB bridge adapter interface
  (`FINGERPRINT_ATTENDANCE_INTEGRATION.md`); node-cron poller shape from `services/integration/scheduler.ts`.
- Flags: `ff_hr_attendance_management`, `ff_hr_biometric_attendance`.

## Phase 3 — Performance MVP (shadow)
- `performance_cycles/categories/rules/events/scores/adjustments`; wire the (already-shipped) engine to
  persistence with **rule-set snapshots** per finalized cycle; approval workflow; employee + manager dashboards;
  jsPDF scorecard. Flag: `ff_hr_performance_scoring` (+ `ff_hr_shadow_mode`).

## Phase 4 — Recognition & allowances
- Employee of Week/Month/Year; Travel/Food allowance eligibility engines (advisory, management-approved);
  build the `notifications` table + emit helper + unread endpoint (none exists today).
- Flags: `ff_hr_staff_awards`, `ff_hr_performance_allowances`, `ff_hr_performance_appeals`.

## Phase 5 — Appraisal & improvement
- Annual appraisal + increment **recommendations** (never auto-payroll), PIPs, trend & department analytics.
- Flag: `ff_hr_annual_appraisals`. Any payroll linkage → Change Control + owner sign-off.

---

## Files this PR creates / modifies

**Created**
- `docs/CARE_STAFF_HR_AUDIT.md`, `docs/CARE_STAFF_HR_ARCHITECTURE.md`, `docs/CARE_STAFF_HR_IMPLEMENTATION_PLAN.md`,
  `docs/FINGERPRINT_ATTENDANCE_INTEGRATION.md`, `docs/CARE_PERFORMANCE_POLICY_CONFIGURATION.md`,
  `docs/CARE_STAFF_HR_ROLLOUT.md`, `docs/CARE_STAFF_HR_OPEN_ISSUES.md`, `docs/ADR/ADR-003-staff-hr-performance-module.md`
- `lib/db/src/schema/staffHr.ts`
- `migrations/staff_hr_foundation.sql`
- `artifacts/api-server/src/lib/performance/scoreEngine.ts`, `artifacts/api-server/src/lib/performance/scoreEngine.test.ts`

**Modified (additive only)**
- `lib/db/src/schema/index.ts` — one line: `export * from "./staffHr";`

**Deliberately NOT touched:** any financial/protected file — `staff.ts` route/schema salary paths,
`hr-forms.ts`, `bridge.ts`, `role-permissions.ts`, `commission.ts`, `ledgers.ts`, `doctorPayouts.ts`,
`staff_salary_payments`, `staff_advances`, `sw.js`.
