-- =============================================================================
-- Migration: Structured Finding Assistant — configurable questions (Phase 6.2)
-- Date: 2026-07-15
-- =============================================================================
-- Adds a questions_json column to radiology_quick_findings and seeds three
-- example structured findings (LS Disc Bulge, Brain Acute Infarct, Cervical
-- Disc Bulge). When a finding has questions, clicking it opens a compact dialog
-- to collect the values; the finding/impression text is then generated from the
-- {key} / [optional clause] templates and flows through the EXISTING Smart
-- Findings Engine. Empty questions_json → the finding inserts immediately.
--
-- The `{level}` anatomical_section lets one generic "Disc Bulge" map to the
-- selected level's structured section. Optional clauses [ … {key} … ] are
-- dropped when the value is null-like ("Normal"/"None").
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, INSERT … ON CONFLICT DO NOTHING, guarded
-- UPDATE (only when questions_json is still the '[]' default).
-- =============================================================================

ALTER TABLE radiology_quick_findings ADD COLUMN IF NOT EXISTS questions_json TEXT NOT NULL DEFAULT '[]';

-- ── LS Spine — generic level-driven Disc Bulge ───────────────────────────────
INSERT INTO radiology_quick_findings
  (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, questions_json, sort_order)
VALUES (
  'LS Spine', 'Disc Bulge',
  '{type} posterior disc bulge is seen at {level}[ {thecal_sac}][ with {foramina} bilateral neural foraminal narrowing][ causing {canal} central canal stenosis][ and impingement upon the traversing {nerve_root} nerve root].',
  '{type} posterior disc bulge at {level}[ with {foramina} bilateral neural foraminal narrowing][ and {nerve_root} nerve root impingement].',
  '{level}', '', '', '[
    {"key":"level","label":"Level","type":"select","options":["L1-L2","L2-L3","L3-L4","L4-L5","L5-S1"],"default":"L4-L5","required":true,"sortOrder":1},
    {"key":"type","label":"Type","type":"select","options":["Diffuse","Focal","Broad-based","Central","Paracentral"],"default":"Diffuse","sortOrder":2},
    {"key":"thecal_sac","label":"Thecal Sac","type":"select","options":["causing indentation over the anterior thecal sac","effacing the anterior thecal sac","Normal"],"default":"causing indentation over the anterior thecal sac","sortOrder":3},
    {"key":"foramina","label":"Neural Foramina","type":"select","options":["Normal","mild","moderate","severe"],"default":"Normal","sortOrder":4},
    {"key":"canal","label":"Canal Stenosis","type":"select","options":["Normal","mild","moderate","severe"],"default":"Normal","sortOrder":5},
    {"key":"nerve_root","label":"Nerve Root","type":"select","options":["None","L4","L5","S1","bilateral L5","bilateral S1"],"default":"None","sortOrder":6}
  ]', 15
) ON CONFLICT (study_type, label) DO NOTHING;

-- ── Cervical Spine — generic level-driven Disc Bulge ─────────────────────────
INSERT INTO radiology_quick_findings
  (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, questions_json, sort_order)
VALUES (
  'Cervical Spine', 'Disc Bulge',
  'Posterior disc-osteophyte complex at {level} indenting the thecal sac[ causing {cord_compression} cord compression][ with {myelomalacia} myelomalacic cord signal change][ with {foramina} neural foraminal narrowing][ causing {canal} central canal stenosis].',
  '{level} disc-osteophyte complex[ with {cord_compression} cord compression][ with myelomalacia].',
  'C2-C3 to C6-C7', '', '', '[
    {"key":"level","label":"Level","type":"select","options":["C2-C3","C3-C4","C4-C5","C5-C6","C6-C7","C7-T1"],"default":"C5-C6","required":true,"sortOrder":1},
    {"key":"cord_compression","label":"Cord Compression","type":"select","options":["None","mild","moderate","severe"],"default":"None","sortOrder":2},
    {"key":"myelomalacia","label":"Myelomalacia","type":"select","options":["None","focal"],"default":"None","sortOrder":3},
    {"key":"foramina","label":"Foraminal Narrowing","type":"select","options":["Normal","mild","moderate","severe"],"default":"Normal","sortOrder":4},
    {"key":"canal","label":"Canal Stenosis","type":"select","options":["Normal","mild","moderate","severe"],"default":"Normal","sortOrder":5}
  ]', 15
) ON CONFLICT (study_type, label) DO NOTHING;

-- ── Brain — upgrade Acute Infarct to a structured finding (guarded) ──────────
UPDATE radiology_quick_findings SET
  finding_text = 'Area of restricted diffusion (DWI hyperintense, ADC hypointense) is noted in the {side} {territory} vascular territory[, measuring approximately {size}], consistent with an acute infarct[ with {hemorrhagic} haemorrhagic transformation].',
  impression_text = 'Acute infarct in the {side} {territory} vascular territory[ with {hemorrhagic} haemorrhagic transformation].',
  properties = '',
  questions_json = '[
    {"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right","required":true,"sortOrder":1},
    {"key":"territory","label":"Vascular Territory","type":"select","options":["MCA","ACA","PCA","PICA","watershed","lacunar"],"default":"MCA","required":true,"sortOrder":2},
    {"key":"size","label":"Size","type":"text","options":[],"default":"","sortOrder":3},
    {"key":"hemorrhagic","label":"Hemorrhagic Transformation","type":"select","options":["None","petechial","frank"],"default":"None","sortOrder":4}
  ]'
  WHERE study_type = 'Brain' AND label = 'Acute Infarct' AND (questions_json IS NULL OR questions_json = '[]');
