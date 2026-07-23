-- ============================================================================
-- Recognition, allowances & notifications (Phase 4) — configurable, advisory.
-- Additive, non-financial, idempotent. Sorts after the performance migration.
--
-- Awards + allowance eligibility are advisory (human-approved); nothing grants
-- money or changes payroll. Notifications is the first in-app inbox. FK targets
-- staff/users are Drizzle-core; award_types is created before award_winners.
-- Verified by scripts/check-migration-order.cjs. Mirrors schema/recognition.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  staff_id   INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  ref_type   TEXT,
  ref_id     TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_staff_idx ON notifications (staff_id);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (is_read);

CREATE TABLE IF NOT EXISTS award_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  cadence     TEXT NOT NULL DEFAULT 'custom',
  description TEXT,
  criteria    JSONB,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS award_winners (
  id                  SERIAL PRIMARY KEY,
  award_type_id       INTEGER NOT NULL REFERENCES award_types(id) ON DELETE RESTRICT,
  staff_id            INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  period_label        TEXT NOT NULL,
  citation            TEXT,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS award_winners_type_period_idx ON award_winners (award_type_id, period_label);
CREATE INDEX IF NOT EXISTS award_winners_staff_idx ON award_winners (staff_id);

CREATE TABLE IF NOT EXISTS allowance_eligibility (
  id                  SERIAL PRIMARY KEY,
  staff_id            INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  allowance_kind      TEXT NOT NULL,
  period_label        TEXT NOT NULL,
  status              TEXT NOT NULL,
  reasons             JSONB,
  metrics_snapshot    JSONB,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name    TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS allowance_eligibility_staff_kind_period_idx ON allowance_eligibility (staff_id, allowance_kind, period_label);

-- Seed the standard award catalogue (editable). No auto-awarding — winners are
-- always management-approved rows.
INSERT INTO award_types (code, name, cadence) VALUES
  ('employee_of_week',  'Employee of the Week',  'weekly'),
  ('employee_of_month', 'Employee of the Month', 'monthly'),
  ('employee_of_year',  'Employee of the Year',  'yearly'),
  ('patient_champion',  'Patient Champion',      'custom'),
  ('perfect_attendance','Perfect Attendance',    'custom'),
  ('emergency_hero',    'Emergency Hero',        'custom'),
  ('best_team_player',  'Best Team Player',      'custom')
ON CONFLICT (code) DO NOTHING;
