-- ============================================================================
-- CARE People Management platform foundation — additive, non-financial, idempotent.
-- ============================================================================
--
-- Extends the Staff/HR foundation (migrations/staff_hr_foundation.sql) toward a
-- 360° employee profile / single source of truth:
--   * staff_user_links       — STRICT 1:1 staff ↔ users identity mapping
--   * skills                 — configurable skills master
--   * staff_skills           — per-employee skill matrix
--   * staff_timeline_events  — append-only lifecycle timeline (all modules feed it)
--
-- SAFETY (same guarantees as staff_hr_foundation.sql):
--   * Additive only: CREATE TABLE/INDEX IF NOT EXISTS. Safe to run repeatedly.
--   * Touches NO financial/protected table and alters NO existing table.
--   * FK targets staff/users are Drizzle-core; skills is created above
--     staff_skills within this file. Verified by scripts/check-migration-order.cjs.
--   * Owning-staff FKs ON DELETE RESTRICT; actor FKs ON DELETE SET NULL.
--   * No feature activation: these tables are inert until a flagged route/UI reads
--     them (all ff_hr_* flags remain disabled — shadow mode).
--
-- Mirrors lib/db/src/schema/staffHr.ts — keep in sync.
-- ============================================================================

-- ── Identity link: staff ↔ users (strict one-to-one) ────────────────────────
CREATE TABLE IF NOT EXISTS staff_user_links (
  id                SERIAL PRIMARY KEY,
  staff_id          INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_primary        BOOLEAN NOT NULL DEFAULT TRUE,
  linked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  linked_by_name    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_user_links_staff_uq ON staff_user_links (staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_user_links_user_uq  ON staff_user_links (user_id);

-- ── Skills master ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  category     TEXT,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS skills_category_idx ON skills (category);

-- ── Staff skill matrix ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_skills (
  id                 SERIAL PRIMARY KEY,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  skill_id           INTEGER NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  level              TEXT NOT NULL DEFAULT 'beginner',
  certified          BOOLEAN NOT NULL DEFAULT FALSE,
  assessed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assessed_at        TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_skills_staff_idx ON staff_skills (staff_id);
CREATE INDEX IF NOT EXISTS staff_skills_skill_idx ON staff_skills (skill_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_skills_staff_skill_uq ON staff_skills (staff_id, skill_id);

-- ── Activity timeline ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_timeline_events (
  id                 SERIAL PRIMARY KEY,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  event_type         TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_module      TEXT NOT NULL DEFAULT 'staff',
  ref_type           TEXT,
  ref_id             TEXT,
  visibility         TEXT NOT NULL DEFAULT 'internal',
  metadata           JSONB,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_timeline_events_staff_idx ON staff_timeline_events (staff_id);
CREATE INDEX IF NOT EXISTS staff_timeline_events_staff_occurred_idx ON staff_timeline_events (staff_id, occurred_at);
CREATE INDEX IF NOT EXISTS staff_timeline_events_type_idx ON staff_timeline_events (event_type);

-- ── Seed the skills catalogue (reference config; management can edit/extend) ─
-- Idempotent: name is UNIQUE, so re-runs and manual edits are preserved.
INSERT INTO skills (name, category, sort_order) VALUES
  ('Reception',        'administrative', 10),
  ('Billing',          'administrative', 20),
  ('Accounts',         'administrative', 30),
  ('HR',               'administrative', 40),
  ('Administration',   'administrative', 50),
  ('Marketing',        'administrative', 60),
  ('MRI',              'clinical',       110),
  ('CT',               'clinical',       120),
  ('USG',              'clinical',       130),
  ('Sample Collection','clinical',       140),
  ('Phlebotomy',       'clinical',       150),
  ('Emergency',        'clinical',       160),
  ('ICU',              'clinical',       170),
  ('Nursing',          'clinical',       180),
  ('IT',               'technical',      210),
  ('Cleaning',         'support',        310),
  ('Housekeeping',     'support',        320),
  ('Driver',           'support',        330)
ON CONFLICT (name) DO NOTHING;
