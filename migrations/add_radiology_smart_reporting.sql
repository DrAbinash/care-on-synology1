-- =============================================================================
-- Migration: Radiology Smart Reporting (Phase 2)
-- Date: 2026-07-07
-- =============================================================================
-- Extends Quick Select buttons into full smart-report objects and adds the
-- measurement library and per-radiologist favorites.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT
-- EXISTS, seeds via ON CONFLICT DO NOTHING, and suggestion back-fills are
-- guarded with "AND (suggests IS NULL OR suggests = '')" so an admin's
-- later edits are never overwritten by a redeploy.
-- =============================================================================

-- ── 1. Smart fields on quick findings ────────────────────────────────────────
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS technique_text TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS recommendation_text TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS icd_code TEXT;
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '';
-- Comma-separated labels of related findings to suggest when this one is
-- selected (label-based so links survive re-seeding and study renames).
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS suggests TEXT NOT NULL DEFAULT '';

-- ── 2. Measurement library ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS radiology_quick_measurements (
  id SERIAL PRIMARY KEY,
  study_type TEXT NOT NULL,
  label TEXT NOT NULL,
  -- {value} is replaced with the number the radiologist types at insert time
  template_text TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'mm',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_measurements_study_label_uq ON radiology_quick_measurements (study_type, label);
CREATE INDEX IF NOT EXISTS radiology_quick_measurements_study_idx ON radiology_quick_measurements (study_type, is_active, sort_order);

-- ── 3. Per-radiologist favorites ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS radiology_quick_favorites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  finding_id INTEGER NOT NULL REFERENCES radiology_quick_findings(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_favorites_user_finding_uq ON radiology_quick_favorites (user_id, finding_id);
CREATE INDEX IF NOT EXISTS radiology_quick_favorites_user_idx ON radiology_quick_favorites (user_id);

-- ── 4. Seed new suggested findings (Brain) ───────────────────────────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Brain', 'DWI restriction', 'The lesion shows restricted diffusion on DWI.', '', 21),
  ('Brain', 'ADC restriction', 'Corresponding low signal is noted on ADC maps, confirming true diffusion restriction.', '', 22),
  ('Brain', 'SWI blooming', 'Blooming is noted on SWI/GRE sequences.', '', 31),
  ('Brain', 'Mass effect', 'Mass effect is noted on the adjacent structures.', 'Mass effect as described.', 32),
  ('Brain', 'Midline shift', 'Midline shift is noted.', 'Midline shift as described.', 33),
  ('Brain', 'Fazekas grade 2', 'Multiple confluent T2/FLAIR hyperintense foci are noted in the periventricular and deep white matter (Fazekas grade 2).', 'Chronic microangiopathic ischemic changes (Fazekas grade 2).', 11),
  ('Brain', 'Contrast MRI suggested', '', 'Contrast-enhanced MRI is suggested for further characterization.', 41),
  ('Brain', 'MR Spectroscopy', '', 'MR spectroscopy may be considered for further characterization.', 42),
  ('Brain', 'Perfusion imaging', '', 'Perfusion imaging may be considered for further characterization.', 43)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── 5. Seed new suggested findings (Spine) ───────────────────────────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Spine', 'Acute compression fracture', 'Marrow edema is noted in the collapsed vertebra, suggestive of an acute compression fracture.', 'Acute vertebral compression fracture.', 71),
  ('Spine', 'Chronic compression fracture', 'No marrow edema is noted in the collapsed vertebra, suggestive of a chronic compression fracture.', 'Chronic vertebral compression fracture.', 72),
  ('Spine', 'Osteoporotic fracture', 'Findings are suggestive of an osteoporotic compression fracture.', 'Osteoporotic compression fracture — DEXA correlation advised.', 73),
  ('Spine', 'Traumatic fracture', 'Findings are suggestive of a traumatic compression fracture.', 'Traumatic vertebral fracture — clinical correlation advised.', 74),
  ('Spine', 'Prevertebral collection', 'A prevertebral collection is noted.', 'Prevertebral collection as described.', 61),
  ('Spine', 'Epidural collection', 'An epidural collection is noted causing thecal sac compression.', 'Epidural collection as described.', 62),
  ('Spine', 'Cord edema', 'Cord edema is noted at the involved level.', 'Cord edema as described.', 63),
  ('Spine', 'Gibbus deformity', 'A gibbus deformity is noted at the involved level.', 'Gibbus deformity as described.', 64)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── 6. Back-fill suggestion links (only where admin has not set any) ─────────
UPDATE radiology_quick_findings SET suggests = 'DWI restriction, ADC restriction, MRA advised'
  WHERE study_type = 'Brain' AND label = 'Infarct' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Chronic microangiopathic changes'
  WHERE study_type = 'Brain' AND label = 'Fazekas grade 2' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'SWI blooming, Mass effect, Midline shift'
  WHERE study_type = 'Brain' AND label = 'Hemorrhage' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Contrast MRI suggested, MR Spectroscopy, Perfusion imaging'
  WHERE study_type = 'Brain' AND label = 'Tumor' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Thecal sac compression, Nerve root compression'
  WHERE study_type = 'Spine' AND label = 'Disc bulge' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Acute compression fracture, Chronic compression fracture, Osteoporotic fracture, Traumatic fracture'
  WHERE study_type = 'Spine' AND label = 'Compression fracture' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Prevertebral collection, Epidural collection, Cord edema, Gibbus deformity'
  WHERE study_type = 'Spine' AND label = 'Tuberculosis' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Thecal sac compression, Nerve root impingement'
  WHERE study_type = 'LS Spine' AND label = 'L4-L5 disc bulge' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Thecal sac compression, Nerve root impingement'
  WHERE study_type = 'LS Spine' AND label = 'L5-S1 disc bulge' AND (suggests IS NULL OR suggests = '');

-- ── 7. Seed measurement library ──────────────────────────────────────────────
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('LS Spine', 'Spinal canal diameter', 'Spinal canal diameter measures {value} mm at the narrowest level.', 'mm', 10),
  ('Abdomen', 'CBD', 'Common bile duct measures {value} mm.', 'mm', 10),
  ('Abdomen', 'Portal vein', 'Portal vein measures {value} mm.', 'mm', 20),
  ('Abdomen', 'Prostate volume', 'Prostate volume is approximately {value} cc.', 'cc', 30),
  ('Abdomen', 'Endometrium', 'Endometrial thickness measures {value} mm.', 'mm', 40),
  ('Abdomen', 'Placenta distance from os', 'Lower edge of the placenta is {value} mm from the internal os.', 'mm', 50),
  ('Abdomen', 'Appendix diameter', 'Appendix measures {value} mm in diameter.', 'mm', 60),
  ('Abdomen', 'AAA diameter', 'Abdominal aorta measures {value} mm in maximal diameter.', 'mm', 70),
  ('Abdomen', 'Stone size', 'Calculus measures {value} mm.', 'mm', 80)
ON CONFLICT (study_type, label) DO NOTHING;
