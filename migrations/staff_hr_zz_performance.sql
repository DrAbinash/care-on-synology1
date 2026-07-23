-- ============================================================================
-- Performance module (Phase 3) — configurable, advisory, shadow-mode.
-- Additive, non-financial, idempotent. Sorts after the other staff_hr_* files.
--
-- Seeds ONLY the category framework (the editable 100-point structure). It does
-- NOT seed any penalty rules — per policy, no penalty matrix is activated
-- without management configuration/review. Gated by ff_hr_performance_scoring.
-- FK targets staff/users are Drizzle-core; cycles/rules/events are created
-- earlier in this file. Verified by scripts/check-migration-order.cjs.
-- Mirrors lib/db/src/schema/performance.ts — keep in sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS performance_cycles (
  id                   SERIAL PRIMARY KEY,
  label                TEXT NOT NULL UNIQUE,
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open',
  rule_snapshot        JSONB,
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finalized_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finalized_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_categories (
  id              SERIAL PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,
  max_marks       INTEGER NOT NULL,
  strategy        TEXT NOT NULL DEFAULT 'deduction',
  baseline        INTEGER,
  sort_order      INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from  DATE,
  effective_until DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_rules (
  id                         SERIAL PRIMARY KEY,
  code                       TEXT NOT NULL UNIQUE,
  name                       TEXT NOT NULL,
  category_key               TEXT NOT NULL,
  points                     INTEGER NOT NULL,
  min_point                  INTEGER,
  max_point                  INTEGER,
  frequency_cap              INTEGER,
  evidence_required          BOOLEAN NOT NULL DEFAULT FALSE,
  response_required          BOOLEAN NOT NULL DEFAULT FALSE,
  approval_level             TEXT,
  auto_applied               BOOLEAN NOT NULL DEFAULT FALSE,
  disqualifying              BOOLEAN NOT NULL DEFAULT FALSE,
  major_misconduct           BOOLEAN NOT NULL DEFAULT FALSE,
  award_disqualification     BOOLEAN NOT NULL DEFAULT FALSE,
  allowance_disqualification BOOLEAN NOT NULL DEFAULT FALSE,
  department_applicability   TEXT,
  designation_applicability  TEXT,
  effective_from             DATE,
  effective_until            DATE,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_events (
  id                   SERIAL PRIMARY KEY,
  cycle_id             INTEGER NOT NULL REFERENCES performance_cycles(id) ON DELETE RESTRICT,
  staff_id             INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  rule_id              INTEGER REFERENCES performance_rules(id) ON DELETE SET NULL,
  category_key         TEXT NOT NULL,
  points               INTEGER NOT NULL,
  disqualifying        BOOLEAN NOT NULL DEFAULT FALSE,
  event_date           DATE NOT NULL,
  description          TEXT,
  notes                TEXT,
  evidence_storage_key TEXT,
  status               TEXT NOT NULL DEFAULT 'submitted',
  submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name    TEXT,
  verified_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at          TIMESTAMPTZ,
  employee_response    TEXT,
  appeal_status        TEXT,
  final_decision       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS performance_events_cycle_staff_idx ON performance_events (cycle_id, staff_id);
CREATE INDEX IF NOT EXISTS performance_events_staff_idx ON performance_events (staff_id);
CREATE INDEX IF NOT EXISTS performance_events_status_idx ON performance_events (status);

CREATE TABLE IF NOT EXISTS performance_scores (
  id                   SERIAL PRIMARY KEY,
  cycle_id             INTEGER NOT NULL REFERENCES performance_cycles(id) ON DELETE RESTRICT,
  staff_id             INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  total                NUMERIC(6,2) NOT NULL,
  max_total            NUMERIC(6,2) NOT NULL,
  breakdown            JSONB NOT NULL,
  disqualified         BOOLEAN NOT NULL DEFAULT FALSE,
  rule_snapshot        JSONB,
  finalized_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finalized_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS performance_scores_cycle_staff_uq ON performance_scores (cycle_id, staff_id);
CREATE INDEX IF NOT EXISTS performance_scores_staff_idx ON performance_scores (staff_id);

CREATE TABLE IF NOT EXISTS performance_appeals (
  id                SERIAL PRIMARY KEY,
  event_id          INTEGER REFERENCES performance_events(id) ON DELETE RESTRICT,
  cycle_id          INTEGER REFERENCES performance_cycles(id) ON DELETE RESTRICT,
  staff_id          INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'submitted',
  decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision          TEXT,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS performance_appeals_staff_idx ON performance_appeals (staff_id);
CREATE INDEX IF NOT EXISTS performance_appeals_status_idx ON performance_appeals (status);

-- Seed the editable 100-point category framework (management can edit/extend).
-- Rules are NOT seeded — no penalty matrix is activated without review.
INSERT INTO performance_categories (key, label, max_marks, strategy, sort_order) VALUES
  ('attendance',      'Attendance and Punctuality',            20, 'deduction', 10),
  ('discipline',      'Professional Behaviour and Discipline', 20, 'deduction', 20),
  ('quality',         'Quality and Accuracy of Work',          20, 'deduction', 30),
  ('patient_service', 'Patient Service and Feedback',          15, 'earned',    40),
  ('teamwork',        'Teamwork and Communication',            15, 'deduction', 50),
  ('initiative',      'Initiative and Responsibility',         10, 'earned',    60)
ON CONFLICT (key) DO NOTHING;
