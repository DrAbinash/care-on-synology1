# ADR-003: Staff, Attendance, Performance & Recognition Module

## Status
Accepted. Phase 0 merged (PR #205). Owner review (2026-07-23) reframed the module as the CARE
**People Management platform** and resolved all five pending decisions (see below); Phase 1 foundation
proceeding additively.

## Date
2026-07-23

## Context

The Staff module was described as "basic", but the audit
(`docs/CARE_STAFF_HR_AUDIT.md`) found a partially-built HR system: real staff/
advances/salary/attendance/HR-form tables and routes, **plus a near-complete but
dormant USB fingerprint-attendance implementation** (`routes/bridge.ts` +
`bridge-service/` + `bridge_fingerprint_templates`) that is disabled only by an
unset `FINGERPRINT_BRIDGE_SECRET`. Several hard constraints shape any enhancement:

- **Financial Freeze** — `staff_salary_payments`, `staff_advances`, commission,
  ledgers and the `hr-forms` salary write-back are protected
  (`FINANCIAL_FREEZE_RULEBOOK.md`); changes need Change Control + owner sign-off.
- **Protected files** — the existing HR files (`staff.ts`, `hr-forms.ts`,
  `bridge.ts`, `role-permissions.ts`, `departments.ts`) are 🟢 "treat like billing".
- **Split identity** — `users` (login) and `staff` (HR master) have no FK link.
- **Off-repo permission matrix** — real role→permission grants live in a USB plugin.
- **Mature reusable infra** — hash-chained `audit_logs` + `auditFromRequest`,
  `feature_flags` + `isFeatureEnabledServer`, presigned object storage, jsPDF,
  `lib/csv.ts`, node-cron, and a strict additive/idempotent migration process.

## Decision

1. **Enhance, do not duplicate.** Keep `staff` as the single HR master; add net-new
   concepts as **new additive tables/files**; keep protected-file edits minimal and
   change-controlled.
2. **Never cross the Financial Freeze automatically.** Performance, recognition,
   allowance and increment outputs are **advisory** and human-approved; software
   never mutates payroll on its own.
3. **Server-authoritative, pure score engine.** The official score is computed by a
   pure, deterministic, unit-tested module (`scoreEngine.ts`) from admin-configurable,
   effective-dated rules — never in React, never trusting a client total. Finalized
   cycles snapshot their rule-set version so history is immutable.
4. **Device-independent attendance ingestion** over the existing `staff_attendance.source`
   column, preserving raw punches separately from summaries, with corrections and an
   idempotent import ledger; the dormant USB bridge becomes one provider (completed later).
5. **Reuse infrastructure** (audit, feature flags, object storage, PDF, CSV, cron);
   **build** only what is missing (in-app notifications).
6. **Shadow mode first.** All `ff_hr_*` flags ship **disabled**; compute-only until reviewed.
7. **Phase 0/1 lands docs + inert additive foundation only** (`designations`,
   `staff_status_history`, `staff_reporting_lines`, `staff_documents`, all RESTRICT/SET NULL)
   + the pure engine — touching zero financial/protected files.

## Trade-offs

- **Additive-only + advisory outputs** means the wished-for attendance→payroll automation
  is deferred behind Change Control — slower, but keeps the freeze intact and the change safe.
- **New tables mirrored by hand-written idempotent SQL** (the `staff_quick_doctors` precedent)
  risks Drizzle/SQL dual-tracking drift; mitigated by keeping the two in sync and preferring
  generated Drizzle migrations for larger future table sets.
- **Inert foundation tables** (no routes yet) add schema surface before use, but give a
  reviewable, safe increment and unblock later phases.
- **Deferring the identity link** keeps this PR safe but postpones employee self-service.

## Future Review

Revisit when: (a) the `users↔staff` link is decided; (b) the off-repo permission matrix is
updated with the new modules/roles; (c) fingerprint hardware is selected; (d) any payroll linkage
is proposed (must enter Change Control). Re-evaluate the dual-tracking migration approach if the
performance/attendance table sets grow large.

## Owner decisions (2026-07-23) — now binding

1. **Identity:** strict **1:1** `staff` ↔ `users` (via additive `staff_user_links`); one employee =
   one ERP identity; no parallel employee concept.
2. **Permissions:** **extend** the existing RBAC only; no second framework.
3. **Payroll:** performance is **advisory** — no automatic payroll/deduction/increment; all
   management-approved.
4. **Fingerprint hardware:** keep the source **abstraction**; add a **provider** when hardware is
   finalized; do **not** rewrite the dormant bridge or add vendor code now.
5. **Scoring:** fully **configurable**; no hard-coded policy.

Additional owner direction: treat this as the **People Management platform** (single source of truth,
360° profile, pluggable future modules — see `CARE_PEOPLE_MANAGEMENT_PLATFORM.md`), including an
auto-generated activity timeline, skill matrix, and derived organizational chart. Attendance is
abstracted behind one source interface; enterprise attendance (shifts/grace/holiday/OT/comp-off) and
leave are designed but not activated; payroll remains inactive.

## Notes

- Companion docs: `CARE_PEOPLE_MANAGEMENT_PLATFORM.md`, `CARE_STAFF_HR_AUDIT.md`, `CARE_STAFF_HR_ARCHITECTURE.md`,
  `CARE_STAFF_HR_IMPLEMENTATION_PLAN.md`, `FINGERPRINT_ATTENDANCE_INTEGRATION.md`,
  `CARE_PERFORMANCE_POLICY_CONFIGURATION.md`, `CARE_STAFF_HR_ROLLOUT.md`,
  `CARE_STAFF_HR_OPEN_ISSUES.md`.
- Shipped code: `lib/db/src/schema/staffHr.ts`, `migrations/staff_hr_foundation.sql`,
  `artifacts/api-server/src/lib/performance/scoreEngine.ts` (+ tests).
