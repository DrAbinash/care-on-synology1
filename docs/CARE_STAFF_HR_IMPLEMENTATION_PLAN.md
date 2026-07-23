# CARE Staff/HR Module — Phased Implementation Plan

**Status:** Phase 0 complete; Phase 1 foundation in this PR · **Date:** 2026-07-23

Small, reviewable PRs — never one uncontrolled rewrite. Every phase is additive, feature-flagged, and
avoids the Financial Freeze unless routed through `FINANCIAL_CHANGE_CONTROL.md` with owner sign-off.

---

## Phase 0 — Audit & design ✅ (this PR)
- Repository audit, fingerprint audit, architecture, policy config, rollout, open issues, ADR-003.
- No feature activation.

## Phase 1 — Enhanced Staff foundation (in progress)
**Landed in this PR (safe, inert):**
- New schema `lib/db/src/schema/staffHr.ts` + `migrations/staff_hr_foundation.sql`: `designations`,
  `staff_status_history`, `staff_reporting_lines`, `staff_documents` (RESTRICT/SET NULL).
- `ff_hr_*` flags seeded disabled (shadow mode).
- Pure, unit-tested score engine `artifacts/api-server/src/lib/performance/scoreEngine.ts`.

**Follow-up PRs (reviewed):**
- Decide + implement the `users↔staff` link (Open Issues #1); register `staff`/`hr` permission modules via
  change control.
- Read/write routes for designations, status history, reporting lines, documents (reuse `auditFromRequest`,
  presigned uploads, zod). *Files:* new `routes/staffHr.ts`; mount in `routes/index.ts`.
- Frontend: enhance `/staff` directory + profile tabs (Overview/Employment/Documents/Reporting/Audit),
  standardise on `ui/table.tsx`; gate with `ff_hr_staff_enhanced`.

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
