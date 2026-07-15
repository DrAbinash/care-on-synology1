-- =============================================================================
-- Migration: Clinical History Quick Select chips + Protocol "default" flag
-- Date: 2026-07-15
-- =============================================================================
-- Two additive changes for the Reporting Workspace configuration:
--
--   1. radiology_clinical_history_chips — study-specific quick-select chips
--      shown beside the Clinical History heading. Clicking a chip inserts its
--      insertedText into the Clinical History field. Mirrors the existing
--      radiology_quick_findings pattern (keyed by study_type name, not FK).
--
--   2. radiology_protocols.is_default — marks the single default protocol per
--      study region. At most one per study_type; enforced by the write API.
--      Distinct from is_gold_standard (a quality marker that can apply to
--      several protocols in a region).
--
-- The `z_` filename prefix guarantees this runs AFTER add_radiology_protocols.sql
-- (alphabetical auto-discovery), so the ALTER below always finds the table.
--
-- Fully idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- INSERT ... ON CONFLICT DO NOTHING, guarded UPDATE. Purely additive — no
-- existing table altered destructively, no existing column removed. Safe to
-- run repeatedly.
-- =============================================================================

-- ── 1. Clinical History Quick Select chips ───────────────────────────────────
CREATE TABLE IF NOT EXISTS radiology_clinical_history_chips (
  id             SERIAL PRIMARY KEY,
  study_type     TEXT NOT NULL,                 -- region, e.g. "Brain"
  display_label  TEXT NOT NULL,                 -- short chip text, e.g. "Headache"
  inserted_text  TEXT NOT NULL DEFAULT '',      -- full phrase inserted into Clinical History
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_system      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_clinical_history_chips_study_label_uq
  ON radiology_clinical_history_chips (study_type, display_label);
CREATE INDEX IF NOT EXISTS radiology_clinical_history_chips_study_idx
  ON radiology_clinical_history_chips (study_type, is_active, sort_order);

-- ── Seed defaults (Brain / Cervical Spine / LS Spine) ────────────────────────
-- Short label on the chip, full clinical phrase inserted into the field.
INSERT INTO radiology_clinical_history_chips (study_type, display_label, inserted_text, sort_order, is_system, is_active) VALUES
  -- MRI Brain
  ('Brain', 'Headache',           'Headache.', 10, TRUE, TRUE),
  ('Brain', 'Vomiting',           'Vomiting.', 20, TRUE, TRUE),
  ('Brain', 'Seizure',            'History of seizures.', 30, TRUE, TRUE),
  ('Brain', 'Vertigo',            'Vertigo.', 40, TRUE, TRUE),
  ('Brain', 'Stroke symptoms',    'Sudden onset weakness with suspected cerebrovascular event.', 50, TRUE, TRUE),
  ('Brain', 'Memory loss',        'Progressive memory loss.', 60, TRUE, TRUE),
  ('Brain', 'Altered sensorium',  'Altered sensorium.', 70, TRUE, TRUE),
  ('Brain', 'Trauma',             'History of head injury.', 80, TRUE, TRUE),
  ('Brain', 'Visual disturbance', 'Visual disturbance.', 90, TRUE, TRUE),
  ('Brain', 'Limb weakness',      'Limb weakness.', 100, TRUE, TRUE),
  -- MRI Cervical Spine
  ('Cervical Spine', 'Neck pain',              'Neck pain.', 10, TRUE, TRUE),
  ('Cervical Spine', 'Cervical radiculopathy', 'Cervical radiculopathy.', 20, TRUE, TRUE),
  ('Cervical Spine', 'Upper-limb weakness',    'Upper limb weakness.', 30, TRUE, TRUE),
  ('Cervical Spine', 'Numbness',               'Numbness.', 40, TRUE, TRUE),
  ('Cervical Spine', 'Myelopathy',             'Clinical features of myelopathy.', 50, TRUE, TRUE),
  ('Cervical Spine', 'Trauma',                 'History of trauma.', 60, TRUE, TRUE),
  ('Cervical Spine', 'Stiffness',              'Neck stiffness.', 70, TRUE, TRUE),
  ('Cervical Spine', 'Tingling',               'Tingling sensation.', 80, TRUE, TRUE),
  ('Cervical Spine', 'Post-operative',         'Post-operative status.', 90, TRUE, TRUE),
  ('Cervical Spine', 'Gait difficulty',        'Difficulty in gait.', 100, TRUE, TRUE),
  -- MRI Lumbar Spine (LS Spine)
  ('LS Spine', 'Low backache',            'Low backache.', 10, TRUE, TRUE),
  ('LS Spine', 'Radiculopathy',           'Radiculopathy.', 20, TRUE, TRUE),
  ('LS Spine', 'Sciatica',                'Sciatica.', 30, TRUE, TRUE),
  ('LS Spine', 'Leg weakness',            'Lower limb weakness.', 40, TRUE, TRUE),
  ('LS Spine', 'Numbness',                'Numbness.', 50, TRUE, TRUE),
  ('LS Spine', 'Neurogenic claudication', 'Neurogenic claudication.', 60, TRUE, TRUE),
  ('LS Spine', 'Foot drop',               'Foot drop.', 70, TRUE, TRUE),
  ('LS Spine', 'Trauma',                  'History of trauma.', 80, TRUE, TRUE),
  ('LS Spine', 'Post-operative',          'Post-operative status.', 90, TRUE, TRUE),
  ('LS Spine', 'Spondylolisthesis',       'Suspected spondylolisthesis.', 100, TRUE, TRUE)
ON CONFLICT (study_type, display_label) DO NOTHING;

-- ── 2. Protocol default flag ─────────────────────────────────────────────────
ALTER TABLE radiology_protocols ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed one sensible default per study region — only when that region has no
-- default yet, so an admin's later choice is never clobbered on re-run.
UPDATE radiology_protocols SET is_default = TRUE
  WHERE name = 'MRI Brain Routine'
    AND NOT EXISTS (SELECT 1 FROM radiology_protocols p2
                    WHERE p2.study_type = radiology_protocols.study_type AND p2.is_default = TRUE);
UPDATE radiology_protocols SET is_default = TRUE
  WHERE name = 'MRI LS Spine'
    AND NOT EXISTS (SELECT 1 FROM radiology_protocols p2
                    WHERE p2.study_type = radiology_protocols.study_type AND p2.is_default = TRUE);
UPDATE radiology_protocols SET is_default = TRUE
  WHERE name = 'MRI Cervical Spine'
    AND NOT EXISTS (SELECT 1 FROM radiology_protocols p2
                    WHERE p2.study_type = radiology_protocols.study_type AND p2.is_default = TRUE);
UPDATE radiology_protocols SET is_default = TRUE
  WHERE name = 'MRI Whole Spine'
    AND NOT EXISTS (SELECT 1 FROM radiology_protocols p2
                    WHERE p2.study_type = radiology_protocols.study_type AND p2.is_default = TRUE);
