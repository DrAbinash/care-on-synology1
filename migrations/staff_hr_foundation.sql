-- ============================================================================
-- CARE Staff / HR foundation (Phase 1) — additive, non-financial, idempotent.
-- ============================================================================
--
-- Adds four NEW foundation tables for the Staff, Attendance, Performance &
-- Recognition module, plus seeds the module's server feature flags in the
-- DISABLED (shadow-mode) state.
--
-- SAFETY
--   * Purely additive: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--     / INSERT ... ON CONFLICT DO NOTHING only. Safe to run any number of
--     times (see HOW_TO_ADD_DB_MIGRATIONS.md).
--   * Touches NO financial table (bills, payments, vouchers, ledgers,
--     staff_salary_payments, staff_advances, commission, doctor_payouts) and
--     alters NO existing table. Nothing here changes salary/payroll behaviour.
--   * FK targets staff / users / departments are all Drizzle-core tables
--     (lib/db/drizzle/0000_dear_forge.sql), created before feature migrations
--     run. feature_flags is created by aaaa_bootstrap_feature_flags.sql, which
--     sorts alphabetically before this file. `node scripts/check-migration-order.cjs`
--     verifies this ordering.
--   * HR records are legal records: owning-staff FKs use ON DELETE RESTRICT
--     (never silently drop history); actor FKs use ON DELETE SET NULL.
--
-- Mirrors the Drizzle schema in lib/db/src/schema/staffHr.ts — keep in sync.
-- ============================================================================

-- ── Designations master ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS designations (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  code           TEXT,
  department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  description    TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS designations_department_idx ON designations (department_id);

-- ── Employment status history ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_status_history (
  id                 SERIAL PRIMARY KEY,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL,
  previous_status    TEXT,
  effective_from     DATE NOT NULL,
  effective_to       DATE,
  reason             TEXT,
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name    TEXT,
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'manual',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_status_history_staff_idx ON staff_status_history (staff_id);
CREATE INDEX IF NOT EXISTS staff_status_history_staff_eff_idx ON staff_status_history (staff_id, effective_from);

-- ── Reporting hierarchy ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_reporting_lines (
  id                  SERIAL PRIMARY KEY,
  staff_id            INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  supervisor_staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  relationship        TEXT NOT NULL DEFAULT 'primary',
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_reporting_lines_staff_idx ON staff_reporting_lines (staff_id);
CREATE INDEX IF NOT EXISTS staff_reporting_lines_supervisor_idx ON staff_reporting_lines (supervisor_staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_reporting_lines_uniq
  ON staff_reporting_lines (staff_id, supervisor_staff_id, relationship, effective_from);

-- ── HR documents (metadata; bytes live in object storage) ───────────────────
CREATE TABLE IF NOT EXISTS staff_documents (
  id                 SERIAL PRIMARY KEY,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  doc_type           TEXT NOT NULL,
  title              TEXT,
  storage_key        TEXT NOT NULL,
  file_name          TEXT,
  mime_type          TEXT,
  size_bytes         BIGINT,
  confidential       BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name   TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_documents_staff_idx ON staff_documents (staff_id);
CREATE INDEX IF NOT EXISTS staff_documents_staff_type_idx ON staff_documents (staff_id, doc_type);

-- ── Module feature flags (server-side), seeded DISABLED = shadow mode ────────
-- Reuses the existing feature_flags table + isFeatureEnabledServer(). All keys
-- default to enabled = FALSE: nothing in this module is active until an admin
-- explicitly turns a flag on via PATCH /api/feature-flags/:key. See
-- docs/CARE_STAFF_HR_ROLLOUT.md.
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_hr_staff_enhanced',        FALSE, 'Enhanced Staff directory/profile UI (shadow-mode foundation)'),
  ('ff_hr_attendance_management', FALSE, 'Attendance management surfaces (manual + import)'),
  ('ff_hr_biometric_attendance',  FALSE, 'USB fingerprint-bridge attendance ingestion'),
  ('ff_hr_performance_scoring',   FALSE, 'Monthly performance scoring engine'),
  ('ff_hr_employee_self_service', FALSE, 'Employee self-service dashboard (own score/attendance)'),
  ('ff_hr_performance_appeals',   FALSE, 'Employee explanations and appeals workflow'),
  ('ff_hr_staff_awards',          FALSE, 'Employee of the Week/Month/Year recognition'),
  ('ff_hr_performance_allowances',FALSE, 'Travel/Food allowance eligibility engine'),
  ('ff_hr_annual_appraisals',     FALSE, 'Annual appraisal and increment recommendations'),
  ('ff_hr_shadow_mode',           FALSE, 'Master shadow-mode guard: compute only, never affect awards/allowances/payroll')
ON CONFLICT (key) DO NOTHING;
