# CARE Staff, Attendance, Performance & Recognition — Architecture

**Status:** Proposed · **Date:** 2026-07-23 · Companion to `CARE_STAFF_HR_AUDIT.md`.

This describes how the enhanced module fits the **existing** CARE ERP (Synology/Docker,
PostgreSQL + Drizzle, Express API, React 19 + wouter, shadcn/ui). Guiding rule from
`DEVELOPMENT_PRINCIPLES.md`: *integrate with existing architecture; do not create parallel
implementations.*

---

## 1. Principles (non-negotiable)

1. **Extend, don't duplicate.** `staff` stays the single HR master. Net-new concepts become
   **new additive tables/files**. Protected files (`staff.ts`, `hr-forms.ts`, `bridge.ts`,
   `role-permissions.ts`, `departments.ts`) are 🟢 "treat like billing" — edits are minimal and
   change-controlled.
2. **Never cross the Financial Freeze automatically.** Salary, advances, `staff_salary_payments`,
   commission, ledgers are 🔴 frozen (`FINANCIAL_FREEZE_RULEBOOK.md`). Performance/recognition/
   allowance/increment outputs are **advisory** and require human approval; software never mutates
   payroll on its own.
3. **Server is the source of truth.** Scores and eligibility are computed server-side, deterministically;
   the client never supplies an official total.
4. **Everything sensitive is audited** via the existing hash-chained `audit_logs`.
5. **Shadow mode first.** All `ff_hr_*` flags start disabled; compute-only until reviewed.

---

## 2. Identity model (decision required — see Open Issues #1)

`users` (login) and `staff` (HR master) are separate with no FK (`CARE_STAFF_HR_AUDIT.md` §4).
Recommended approach (**additive, reversible**): add a nullable `users.staff_id → staff.id`
(or a link table `staff_user_links`) so a logged-in user can be resolved to a staff record for
**self-service** ("my attendance / my score"). Until this decision is ratified, self-service stays
behind `ff_hr_employee_self_service` (disabled) and no self-scoped endpoint ships. Actor attribution
for HR mutations uses `req.staffSession.subjectId` (a `users.id`) exactly as `hr-forms.ts` already does.

---

## 3. Permissions

Reuse `middleware/requireStaffAuth.ts` primitives verbatim — no parallel framework.

- **New permission modules** (registered via change control in `role-permissions.ts` `PERMISSION_MODULES`,
  since the real grants live off-repo): `staff` (directory/profile), `hr` (documents, status, sensitive),
  `attendance`, `performance`, `recognition`, `allowances`, `appraisals`.
- **Segregation of duties** uses the existing granular bits (`canView/Create/Edit/Approve/Finalize`):
  the submitter of a performance event/appraisal can never also `canApprove`/`canFinalize` it (enforced
  server-side by comparing `req.staffSession.subjectId`).
- **Mount pattern** (mirrors `routes/index.ts:431`):
  `router.use("/performance", requireStaffAuth, requireStaffPermission("/performance"), performanceRouter)`.
- **Self-scoped reads** (`/api/my/...`) use `requireStaffAuth` only and are scoped to the caller's own id
  (never a client-supplied id), exactly like `staffQuickDoctors.ts`. **Every** such GET must be added to
  `NETWORK_ONLY_PREFIXES` in `artifacts/diagnostic-erp/public/sw.js` (CI-enforced; prior PHI-cache leak).

---

## 4. Data model

### 4.1 Reuse (unchanged)
`staff`, `departments`, `staff_attendance` (+ its `source` column), `staff_biometric_credentials`,
`bridge_fingerprint_templates`, `hr_rejoining_forms`, `users`, `audit_logs`, `feature_flags`.

### 4.2 Landed now (Phase 1, additive, inert — `schema/staffHr.ts` + `migrations/staff_hr_foundation.sql`)
`designations`, `staff_status_history`, `staff_reporting_lines`, `staff_documents`.
FKs: owning-staff = `ON DELETE RESTRICT`; actor(users)/department = `ON DELETE SET NULL` (per DB-audit
recommendation; never `CASCADE` for HR/legal records).

### 4.3 Proposed for later phases (change-controlled; not in this PR)
- **Attendance:** `attendance_raw_punches` (immutable device/manual punches), `attendance_daily_summaries`
  (computed; late/early/OT/half-day/absent), `attendance_corrections` (workflow + audit),
  `attendance_import_runs` (idempotent import ledger), `attendance_devices`, `employee_biometric_mappings`
  (or reuse `bridge_fingerprint_templates`).
- **Performance:** `performance_cycles`, `performance_categories`, `performance_rules` (effective-dated,
  snapshotted per cycle), `performance_events` (+ `_evidence`, `_reviews`), `performance_scores`
  (+ `_components`), `performance_adjustments`, `performance_appeals`, `disciplinary_actions`.
- **Recognition/allowances:** `award_cycles`, `award_nominations`, `award_winners`, `allowance_rules`,
  `allowance_eligibility`, `allowance_approvals`.
- **Appraisal/PIP:** `appraisal_cycles`, `employee_appraisals`, `performance_improvement_plans`.
- **Notifications:** `notifications` (+ unread endpoint) — none exists today.

All future migrations: additive, idempotent, filename-ordered, verified by `check-migration-order.cjs`
(see `CARE_STAFF_HR_ROLLOUT.md`).

---

## 5. Attendance ingestion abstraction

A device-independent provider model over the existing `staff_attendance.source` column. Sources:
`manual | fingerprint | usb-bridge | csv_import | api_import | admin_correction | system_generated`.

```
AttendanceProvider (interface)
  ├─ ManualProvider          → existing POST /api/staff/:id/attendance/punch  (source "manual")
  ├─ WebAuthnProvider        → existing /biometric/punch/*                     (source "fingerprint")
  ├─ UsbBridgeProvider       → existing POST /api/bridge/staff-punch           (source "usb-bridge")
  ├─ CsvImportProvider       → new: parse + idempotent upsert                  (source "csv_import")
  └─ ApiImportProvider       → new: future device/API pull                     (source "api_import")

AttendanceImportService
  - writes attendance_raw_punches (immutable), then recomputes attendance_daily_summaries
  - idempotent via (device_id, biometric_user_id, punch_ts) uniqueness; re-import = no-op
  - records an attendance_import_runs row (counts, partial failures) + audit_logs entry
```

**Offline-first:** imports are pull/file-based and idempotent; no permanently-open browser session is
required. The USB bridge is already push/on-demand (browser triggers) with challenge tokens; a future
polling importer follows the `services/integration/scheduler.ts` node-cron shape, gated by
`ff_hr_attendance_management` and `ENABLE_SCHEDULERS`.

---

## 6. Score engine (shipped now, pure)

`artifacts/api-server/src/lib/performance/scoreEngine.ts` — no DB, no clock, no randomness.
`computeScore(policy, events)` → fully itemised, reproducible breakdown. Properties:

- Configurable categories, each `deduction` (start at max, subtract) or `earned` (start at 0, add).
- Every category clamped to `[0, max]` → positive entries can't exceed a max; deductions can't go negative.
- Only `approved !== false` events apply (unverified complaints never reduce a score).
- `disqualifying` events flag the result (for awards/allowances) without zeroing the number.
- Unknown-category events are surfaced as `unapplied` warnings, never silently dropped.
- Deterministic ordering (date → id → index). `validatePolicy` asserts categories sum to the expected total.

Production wiring (later): rules resolve to signed events; the **rule-set version is snapshotted** per
finalized cycle so historical scores never change when rules change. The engine stays pure and unit-tested;
routes/persistence are added in Phase 3 behind `ff_hr_performance_scoring`.

---

## 7. Reused cross-cutting infrastructure

| Concern | Reuse | Entry point |
|---|---|---|
| Auth/permissions | ✅ | `requireStaffAuth`, `requireStaffPermission`, `requireStaffSubPermission` |
| Audit | ✅ | `auditFromRequest(req, {action, module, entityType, entityId, oldValue, newValue, reason})` |
| Feature flags | ✅ | server `isFeatureEnabledServer("ff_hr_*")` + client `FEATURE_FLAG_DEFAULTS` |
| Documents | ✅ | presigned `POST /api/storage/uploads/request-url` → store `storage_key` |
| PDF scorecards | ✅ | client `jsPDF` + `jspdf-autotable` (`reportPdfGenerator.ts` pattern) |
| CSV/Excel | ✅ | `lib/csv.ts` (`buildCsv`/`downloadCsv`/`parseCsv`), `xlsx` |
| Cron/import | ✅ | `cron.ts` + `services/integration/scheduler.ts` shape |
| Notifications | ❌ build | new `notifications` table + emit helper + unread endpoint |

---

## 8. Frontend

Enhance the existing `/staff` surface (do not add a disconnected app). Sub-navigation grows under Staff:
Overview · Directory · Attendance · Roster · Leave · Performance · Recognition · Allowances · Appraisals ·
Improvement Plans · Attendance Devices · HR Settings — each gated by role and by its `ff_hr_*` flag. Reuse
shadcn primitives (standardise data tables on `ui/table.tsx`), `PageHeader`, TanStack Query over `fetchApi`.
Employee/supervisor/management dashboards avoid public leaderboards and named-colleague comparisons; scores
are always shown with their itemised breakdown.

---

## 9. Boundaries this module will not cross without Change Control

`staff_salary_payments`, `staff_advances`, salary computation, commission/ledgers/doctor payouts, the
`hr-forms.ts` salary write-back, and any "derive payroll from attendance" logic. These require the
`FINANCIAL_CHANGE_CONTROL.md` process + owner sign-off, regardless of how convenient the wiring looks.
