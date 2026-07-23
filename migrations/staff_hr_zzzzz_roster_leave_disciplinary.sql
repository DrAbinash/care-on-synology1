-- ============================================================================
-- Roster, leave & disciplinary (attendance Phase 2 + HR) — additive, idempotent.
-- Non-financial: nothing here changes salary/payroll. Sorts after the appraisal
-- migration. FK targets staff/users are Drizzle-core; shift_templates and
-- leave_types are created before the tables that reference them. Seeds default
-- shift templates + leave types + three new ff_hr_* flags (all DISABLED).
-- Verified by scripts/check-migration-order.cjs. Mirrors schema/{roster,leave,
-- disciplinary}.ts.
-- ============================================================================

-- ── Roster ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_templates (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  code           TEXT,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  cross_midnight BOOLEAN NOT NULL DEFAULT FALSE,
  grace_minutes  INTEGER NOT NULL DEFAULT 10,
  break_minutes  INTEGER NOT NULL DEFAULT 0,
  color          TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duty_rosters (
  id                SERIAL PRIMARY KEY,
  staff_id          INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  duty_date         DATE NOT NULL,
  shift_template_id INTEGER REFERENCES shift_templates(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'scheduled',
  notes             TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS duty_rosters_staff_date_uq ON duty_rosters (staff_id, duty_date);
CREATE INDEX IF NOT EXISTS duty_rosters_date_idx ON duty_rosters (duty_date);

CREATE TABLE IF NOT EXISTS holiday_calendar (
  id           SERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'public',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Leave ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_types (
  id                 SERIAL PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  paid               BOOLEAN NOT NULL DEFAULT TRUE,
  max_days_per_year  NUMERIC(6,2),
  requires_approval  BOOLEAN NOT NULL DEFAULT TRUE,
  counts_as_attendance BOOLEAN NOT NULL DEFAULT TRUE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id            SERIAL PRIMARY KEY,
  staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  year          INTEGER NOT NULL,
  entitled      NUMERIC(6,2) NOT NULL DEFAULT 0,
  used          NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_staff_type_year_uq ON leave_balances (staff_id, leave_type_id, year);

CREATE TABLE IF NOT EXISTS leave_requests (
  id                 SERIAL PRIMARY KEY,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  leave_type_id      INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date          DATE NOT NULL,
  to_date            DATE NOT NULL,
  days               NUMERIC(6,2) NOT NULL,
  half_day           BOOLEAN NOT NULL DEFAULT FALSE,
  reason             TEXT,
  status             TEXT NOT NULL DEFAULT 'submitted',
  approver_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approver_name      TEXT,
  decided_at         TIMESTAMPTZ,
  decision_note      TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS leave_requests_staff_idx ON leave_requests (staff_id);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests (status);

-- ── Disciplinary ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disciplinary_actions (
  id                 SERIAL PRIMARY KEY,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  type               TEXT NOT NULL,
  severity           TEXT NOT NULL DEFAULT 'minor',
  reason             TEXT NOT NULL,
  description        TEXT,
  incident_date      DATE,
  status             TEXT NOT NULL DEFAULT 'draft',
  issued_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_by_name     TEXT,
  issued_at          TIMESTAMPTZ,
  employee_response  TEXT,
  responded_at       TIMESTAMPTZ,
  evidence_storage_key TEXT,
  outcome            TEXT,
  closed_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at          TIMESTAMPTZ,
  related_event_id   INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS disciplinary_actions_staff_idx ON disciplinary_actions (staff_id);
CREATE INDEX IF NOT EXISTS disciplinary_actions_status_idx ON disciplinary_actions (status);

-- ── Seeds (reference config; management can edit) ───────────────────────────
INSERT INTO shift_templates (name, code, start_time, end_time, cross_midnight, grace_minutes) VALUES
  ('General',   'GEN', '09:00', '17:00', FALSE, 10),
  ('Morning',   'MOR', '07:00', '15:00', FALSE, 10),
  ('Evening',   'EVE', '15:00', '23:00', FALSE, 10),
  ('Night',     'NGT', '23:00', '07:00', TRUE,  15),
  ('12h Day',   'D12', '08:00', '20:00', FALSE, 15),
  ('12h Night', 'N12', '20:00', '08:00', TRUE,  15)
ON CONFLICT (name) DO NOTHING;

INSERT INTO leave_types (code, name, paid, max_days_per_year, counts_as_attendance) VALUES
  ('CL',  'Casual Leave',        TRUE,  12, TRUE),
  ('SL',  'Sick Leave',          TRUE,  12, TRUE),
  ('EL',  'Earned Leave',        TRUE,  15, TRUE),
  ('CO',  'Compensatory Off',    TRUE,  NULL, TRUE),
  ('ML',  'Maternity Leave',     TRUE,  182, TRUE),
  ('PL',  'Paternity Leave',     TRUE,  15, TRUE),
  ('LWP', 'Leave Without Pay',   FALSE, NULL, FALSE),
  ('HD',  'Half Day',            TRUE,  NULL, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ff_hr_roster',       FALSE, 'Duty roster & shift scheduling'),
  ('ff_hr_leave',        FALSE, 'Leave management (types, balances, requests)'),
  ('ff_hr_disciplinary', FALSE, 'Disciplinary case management')
ON CONFLICT (key) DO NOTHING;
