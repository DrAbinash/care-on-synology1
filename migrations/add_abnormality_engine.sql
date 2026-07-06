-- =============================================================================
-- Migration: Abnormality-Driven Reporting Engine (Phase 4)
-- Date: 2026-07-07
-- =============================================================================
-- Turns Quick Select buttons into structured clinical objects:
--   - properties column: which chips (side/severity/chronicity/level/
--     measurement) appear when a button is selected. Admin-configurable.
--   - Per-study-tab technique_text (auto-fills empty Technique) and
--     normal_text (one-click baseline normals) so a routine report needs
--     almost no typing.
--
-- Fully idempotent. Property back-fills are guarded with
-- "(properties IS NULL OR properties = '')" so admin edits survive.
-- =============================================================================

ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS properties TEXT NOT NULL DEFAULT '';

ALTER TABLE radiology_study_tabs ADD COLUMN IF NOT EXISTS technique_text TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_study_tabs ADD COLUMN IF NOT EXISTS normal_text TEXT NOT NULL DEFAULT '';

-- ── Property chip defaults (guarded — never overwrite admin edits) ───────────
UPDATE radiology_quick_findings SET properties = 'side, chronicity'
  WHERE study_type = 'Brain' AND label = 'Infarct' AND (properties IS NULL OR properties = '');
UPDATE radiology_quick_findings SET properties = 'side'
  WHERE study_type = 'Brain' AND label IN ('Hemorrhage', 'Tumor', 'Gliosis') AND (properties IS NULL OR properties = '');
UPDATE radiology_quick_findings SET properties = 'severity, level'
  WHERE study_type = 'Spine' AND label IN ('Canal stenosis', 'Disc bulge', 'Nerve root compression', 'Modic changes') AND (properties IS NULL OR properties = '');
UPDATE radiology_quick_findings SET properties = 'chronicity, level'
  WHERE study_type = 'Spine' AND label = 'Compression fracture' AND (properties IS NULL OR properties = '');
UPDATE radiology_quick_findings SET properties = 'severity'
  WHERE study_type = 'LS Spine' AND label IN ('Canal narrowing', 'Thecal sac compression', 'Nerve root impingement', 'Facet arthropathy') AND (properties IS NULL OR properties = '');
UPDATE radiology_quick_findings SET properties = 'level'
  WHERE study_type = 'LS Spine' AND label IN ('Modic changes', 'Disc desiccation') AND (properties IS NULL OR properties = '');

-- ── Per-tab auto technique + baseline normals (guarded seeds) ────────────────
UPDATE radiology_study_tabs SET
  technique_text = 'Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, and GRE sequences.',
  normal_text = 'Rest of the brain parenchyma shows normal signal intensity. Ventricular system and sulcal spaces are normal. No midline shift. Posterior fossa structures are unremarkable.'
  WHERE name = 'Brain' AND (technique_text IS NULL OR technique_text = '');

UPDATE radiology_study_tabs SET
  technique_text = 'Multiplanar multisequence MRI of the lumbosacral spine was performed including T1, T2, and STIR sequences.',
  normal_text = 'Remaining visualized discs show normal signal and height. Vertebral bodies show normal alignment and marrow signal. Conus and visualized cord are normal. Paravertebral soft tissues are unremarkable.'
  WHERE name = 'LS Spine' AND (technique_text IS NULL OR technique_text = '');

UPDATE radiology_study_tabs SET
  technique_text = 'Multiplanar multisequence MRI of the spine was performed including T1, T2, and STIR sequences.',
  normal_text = 'Remaining vertebrae and discs are unremarkable. Cord shows normal signal intensity. Paravertebral soft tissues are normal.'
  WHERE name IN ('Spine', 'Cervical Spine', 'Dorsal Spine', 'Whole Spine') AND (technique_text IS NULL OR technique_text = '');
