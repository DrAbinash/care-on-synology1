-- =============================================================================
-- Migration: Smart Findings Engine (Phase 6)
-- Date: 2026-07-15
-- =============================================================================
-- Extends the EXISTING radiology_quick_findings buttons so that, in structured
-- reporting mode, selecting a finding flips the matching template section from
-- its baseline normal to the finding's text (intelligent replace + anatomical
-- order + conflict resolution), instead of only appending to free text.
--
-- Reuses: radiology_quick_findings (no new table), the structured template
-- section labels (structured_report_templates.sectionsJson.findingsItems), the
-- abnormality/render engine, and QuickFindingsPanel. NO new findings table and
-- NO duplicate engine.
--
-- New columns:
--   anatomical_section  – the template section label this finding maps to
--                         (must match a findingsItems[].label to flip it).
--   conflict_group      – findings sharing a non-empty group within a study are
--                         mutually exclusive (e.g. Fazekas 1 vs 2).
--   baseline_replaces   – optional exact normal sentence superseded in free
--                         text mode / fine-grained replacement.
--
-- The `z_` prefix orders this AFTER every add_*/z_add_abnormality migration, so
-- all prior columns (properties, technique_text, …) already exist.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, guarded UPDATEs (only set when the
-- target column is still empty, so admin edits are never overwritten), and
-- INSERT … ON CONFLICT (study_type, label) DO NOTHING.
-- =============================================================================

ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS anatomical_section TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS conflict_group TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS baseline_replaces TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS radiology_quick_findings_section_idx
  ON radiology_quick_findings (study_type, anatomical_section);

-- ── Map EXISTING Brain findings to MRI Brain template sections (guarded) ──────
UPDATE radiology_quick_findings SET anatomical_section = 'Diffusion (DWI/ADC)'
  WHERE study_type = 'Brain' AND label IN ('Infarct', 'DWI restriction', 'ADC restriction') AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'White Matter', conflict_group = 'fazekas'
  WHERE study_type = 'Brain' AND label IN ('Fazekas grade 1', 'Fazekas grade 2') AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'White Matter'
  WHERE study_type = 'Brain' AND label = 'Demyelination' AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'Brain Parenchyma'
  WHERE study_type = 'Brain' AND label IN ('Hemorrhage', 'Tumor', 'Gliosis', 'Mass effect') AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'Ventricles & CSF Spaces'
  WHERE study_type = 'Brain' AND label IN ('Atrophy', 'Midline shift') AND anatomical_section = '';

-- ── Map EXISTING LS Spine findings to MRI LS Spine template sections ─────────
UPDATE radiology_quick_findings SET anatomical_section = 'L4-L5'
  WHERE study_type = 'LS Spine' AND label = 'L4-L5 disc bulge' AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'L5-S1'
  WHERE study_type = 'LS Spine' AND label = 'L5-S1 disc bulge' AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'Alignment & Curvature'
  WHERE study_type = 'LS Spine' AND label = 'Loss of lumbar lordosis' AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'Vertebral Bodies'
  WHERE study_type = 'LS Spine' AND label = 'Modic changes' AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'Intervertebral Discs'
  WHERE study_type = 'LS Spine' AND label = 'Disc desiccation' AND anatomical_section = '';
UPDATE radiology_quick_findings SET anatomical_section = 'Spinal Canal'
  WHERE study_type = 'LS Spine' AND label = 'Canal narrowing' AND anatomical_section = '';

-- ── Seed NEW Brain findings (aligned to MRI Brain Plain sections) ────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Brain', 'Acute Infarct', 'Area of restricted diffusion (DWI hyperintense, ADC hypointense) noted in the {side} {level} vascular territory, consistent with an acute infarct.', 'Acute infarct in the {side} {level} territory.', 'Diffusion (DWI/ADC)', '', 'side, level', 60),
  ('Brain', 'Old Infarct', 'Encephalomalacic changes with surrounding gliosis noted in the {side} {level} region, consistent with an old infarct.', 'Old (chronic) infarct in the {side} {level} region.', 'Brain Parenchyma', '', 'side, level', 61),
  ('Brain', 'Cerebral Atrophy', 'Prominence of the ventricular system and cortical sulci, consistent with age-related cerebral atrophy.', 'Cerebral atrophy.', 'Ventricles & CSF Spaces', '', '', 62),
  ('Brain', 'Hydrocephalus', 'Dilatation of the ventricular system out of proportion to the sulci, suggestive of hydrocephalus.', 'Hydrocephalus.', 'Ventricles & CSF Spaces', '', '', 63),
  ('Brain', 'Neurocysticercosis', 'A cystic lesion with an eccentric scolex noted in the {side} {level} region, consistent with neurocysticercosis.', 'Neurocysticercosis.', 'Brain Parenchyma', '', 'side, level', 64),
  ('Brain', 'Pituitary Lesion', 'A focal lesion is noted within the pituitary gland/sella.', 'Pituitary/sellar lesion — dedicated contrast pituitary MRI advised.', 'Sellar Region', '', '', 65),
  ('Brain', 'Empty Sella', 'The sella turcica is partially filled with CSF with flattening of the pituitary gland, consistent with a partially empty sella.', 'Partially empty sella.', 'Sellar Region', '', '', 66)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Seed NEW LS Spine findings (aligned to MRI LS Spine sections) ────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('LS Spine', 'L3-L4 disc bulge', 'Diffuse posterior disc bulge at L3-L4 indenting the anterior thecal sac, with mild bilateral neural foraminal narrowing.', 'L3-L4 disc bulge.', 'L3-L4', '', '', 40),
  ('LS Spine', 'Canal Stenosis', 'Spinal canal narrowing at {level} secondary to disc bulge, ligamentum flavum hypertrophy and facet arthropathy, causing {severity} central canal stenosis.', '{severity} spinal canal stenosis at {level}.', 'Spinal Canal', '', 'severity, level', 50),
  ('LS Spine', 'Foraminal Narrowing', '{severity} neural foraminal narrowing at {level} {side}.', '{severity} {level} foraminal narrowing.', 'Spinal Canal', '', 'severity, level, side', 51),
  ('LS Spine', 'Nerve Root Compression', 'The traversing/exiting {side} nerve root at {level} appears compressed.', '{side} {level} nerve root compression.', 'Spinal Canal', '', 'side, level', 52),
  ('LS Spine', 'Spondylolisthesis', 'Anterolisthesis at {level} noted.', 'Spondylolisthesis at {level}.', 'Alignment & Curvature', '', 'level', 53),
  ('LS Spine', 'Compression Fracture', 'Wedge compression of the {level} vertebral body with loss of height. {chronicity} based on marrow signal.', '{chronicity} compression fracture of {level}.', 'Vertebral Bodies', '', 'level, chronicity', 54)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Seed NEW Cervical Spine findings (aligned to MRI Cervical Spine sections) ─
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Cervical Spine', 'Loss of Lordosis', 'Straightening/reversal of the normal cervical lordosis, likely positional or due to muscle spasm.', 'Loss of cervical lordosis.', 'Alignment & Curvature', '', '', 10),
  ('Cervical Spine', 'C4-C5 disc bulge', 'Posterior disc-osteophyte complex at C4-C5 indenting the thecal sac.', 'C4-C5 disc bulge.', 'C2-C3 to C6-C7', '', '', 20),
  ('Cervical Spine', 'C5-C6 disc bulge', 'Posterior disc-osteophyte complex at C5-C6 indenting the thecal sac with mild bilateral neural foraminal narrowing.', 'C5-C6 disc bulge.', 'C2-C3 to C6-C7', '', '', 21),
  ('Cervical Spine', 'C6-C7 disc bulge', 'Posterior disc-osteophyte complex at C6-C7 indenting the thecal sac.', 'C6-C7 disc bulge.', 'C2-C3 to C6-C7', '', '', 22),
  ('Cervical Spine', 'Canal Stenosis', '{severity} central canal stenosis at {level} secondary to disc-osteophyte complex.', '{severity} canal stenosis at {level}.', 'C2-C3 to C6-C7', '', 'severity, level', 23),
  ('Cervical Spine', 'Foraminal Narrowing', '{severity} neural foraminal narrowing at {level} {side}.', '{severity} {level} foraminal narrowing.', 'C2-C3 to C6-C7', '', 'severity, level, side', 24),
  ('Cervical Spine', 'Cord Compression', 'The spinal cord appears compressed at {level} with effacement of the surrounding CSF.', 'Cord compression at {level}.', 'Spinal Cord', '', 'level', 25),
  ('Cervical Spine', 'Myelomalacia', 'Focal T2 hyperintense signal within the cord at {level}, consistent with myelomalacia.', 'Myelomalacic cord signal change at {level}.', 'Spinal Cord', '', 'level', 26),
  ('Cervical Spine', 'Vertebral Hemangioma', 'A well-defined T1/T2 hyperintense lesion in the {level} vertebral body, consistent with a benign haemangioma.', 'Benign vertebral haemangioma at {level}.', 'Vertebral Bodies', '', 'level', 27),
  ('Cervical Spine', 'OPLL', 'Ossification of the posterior longitudinal ligament noted, contributing to canal narrowing.', 'Ossified posterior longitudinal ligament (OPLL).', 'C2-C3 to C6-C7', '', '', 28)
ON CONFLICT (study_type, label) DO NOTHING;
