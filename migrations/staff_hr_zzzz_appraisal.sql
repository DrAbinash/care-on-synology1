-- ============================================================================
-- Appraisal, increment recommendations & PIP (Phase 5) — advisory.
-- Additive, non-financial, idempotent. Sorts after the recognition migration.
--
-- Increment recommendations are advisory ONLY — nothing alters payroll/salary.
-- FK targets staff/users are Drizzle-core; appraisal_cycles is created before
-- employee_appraisals. Verified by scripts/check-migration-order.cjs.
-- Mirrors lib/db/src/schema/appraisal.ts — keep in sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS appraisal_cycles (
  id                 SERIAL PRIMARY KEY,
  label              TEXT NOT NULL UNIQUE,
  year_start         DATE NOT NULL,
  year_end           DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open',
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_appraisals (
  id                  SERIAL PRIMARY KEY,
  cycle_id            INTEGER NOT NULL REFERENCES appraisal_cycles(id) ON DELETE RESTRICT,
  staff_id            INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  annual_score_avg    NUMERIC(6,2),
  recommendation_band TEXT,
  recommendation      TEXT,
  strengths           TEXT,
  improvement_areas   TEXT,
  manager_comments    TEXT,
  employee_comments   TEXT,
  management_decision TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_appraisals_cycle_staff_uq ON employee_appraisals (cycle_id, staff_id);
CREATE INDEX IF NOT EXISTS employee_appraisals_staff_idx ON employee_appraisals (staff_id);

CREATE TABLE IF NOT EXISTS performance_improvement_plans (
  id                  SERIAL PRIMARY KEY,
  staff_id            INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  reason              TEXT NOT NULL,
  target_categories   JSONB,
  required_actions    TEXT,
  training_assigned   TEXT,
  supervisor_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  start_date          DATE,
  review_dates        JSONB,
  completion_date     DATE,
  outcome             TEXT,
  employee_comments   TEXT,
  management_decision TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS performance_improvement_plans_staff_idx ON performance_improvement_plans (staff_id);
CREATE INDEX IF NOT EXISTS performance_improvement_plans_status_idx ON performance_improvement_plans (status);
