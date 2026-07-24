-- zzzzz_enable_staff_hr_flags.sql
-- ============================================================================
-- Graduate the Staff/HR module OUT of shadow mode.
--
-- The Staff/HR platform (People 360°, Performance scoring, Attendance /
-- fingerprint, Employee Self-Service, Leave, Roster, Disciplinary, Annual
-- Appraisals, Allowances and Awards) shipped with every ff_hr_* server flag
-- seeded FALSE (staff_hr_foundation.sql / staff_hr_zzzzz_roster_leave_
-- disciplinary.sql). While disabled, every HR route returns HTTP 503 and the
-- UI pages render a "Shadow Mode — enable the ff_hr_* flag" banner.
--
-- This migration turns them all ON so the surfaces are live and the banners
-- disappear. It is:
--   * Idempotent   — re-running only re-asserts enabled = TRUE.
--   * Non-financial — none of these modules touch billing/payroll; every
--                     route/schema header states this explicitly (leave,
--                     roster, disciplinary, allowances and appraisal all
--                     compute advisory data only, never salary).
--   * Correctly ordered — the "zzzzz_" prefix sorts AFTER the staff_hr_*
--                     files that seed these rows, so the UPDATE always matches.
--
-- ff_hr_shadow_mode is intentionally left FALSE: it is a never-enforced
-- "compute-only" master guard, and enabling it would read as "stay in shadow
-- mode", the opposite of the intent here.
-- ============================================================================

UPDATE feature_flags
SET enabled = TRUE,
    updated_by = 'migration:zzzzz_enable_staff_hr_flags',
    updated_at = NOW()
WHERE key IN (
  'ff_hr_staff_enhanced',
  'ff_hr_attendance_management',
  'ff_hr_biometric_attendance',
  'ff_hr_performance_scoring',
  'ff_hr_employee_self_service',
  'ff_hr_performance_appeals',
  'ff_hr_staff_awards',
  'ff_hr_performance_allowances',
  'ff_hr_annual_appraisals',
  'ff_hr_roster',
  'ff_hr_leave',
  'ff_hr_disciplinary'
);
