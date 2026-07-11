-- =============================================================================
-- Migration: Radiology Quick Select — study tabs + quick finding buttons
-- Date: 2026-07-07
-- =============================================================================
-- Powers the Quick Select side panel in the Radiology Reporting Workspace
-- (billing-desk-style one-click buttons that insert finding/impression text).
-- Mirrors lib/db/src/schema/radiologyQuickFindings.ts.
--
-- Fully idempotent: CREATE TABLE/INDEX IF NOT EXISTS + seed rows via
-- ON CONFLICT DO NOTHING. Safe to run on every deployment. Admin edits to
-- seeded rows are never overwritten (conflict target = the unique key, and
-- we DO NOTHING on conflict).
-- =============================================================================

CREATE TABLE IF NOT EXISTS radiology_study_tabs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_study_tabs_name_uq ON radiology_study_tabs (name);

CREATE TABLE IF NOT EXISTS radiology_quick_findings (
  id SERIAL PRIMARY KEY,
  study_type TEXT NOT NULL,
  label TEXT NOT NULL,
  finding_text TEXT NOT NULL DEFAULT '',
  impression_text TEXT NOT NULL DEFAULT '',
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_findings_study_label_uq ON radiology_quick_findings (study_type, label);
CREATE INDEX IF NOT EXISTS radiology_quick_findings_study_idx ON radiology_quick_findings (study_type, is_active, sort_order);

-- ── Seed study tabs ──────────────────────────────────────────────────────────
INSERT INTO radiology_study_tabs (name, sort_order) VALUES
  ('Brain', 10),
  ('Spine', 20),
  ('Cervical Spine', 30),
  ('Dorsal Spine', 40),
  ('LS Spine', 50),
  ('Whole Spine', 60),
  ('Knee', 70),
  ('Abdomen', 80)
ON CONFLICT (name) DO NOTHING;

-- ── Seed quick findings: Brain ───────────────────────────────────────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Brain', 'Fazekas grade 1', 'Few scattered punctate T2/FLAIR hyperintense foci are noted in the periventricular and deep white matter of bilateral cerebral hemispheres (Fazekas grade 1).', 'Mild chronic small vessel ischemic changes (Fazekas grade 1).', 10),
  ('Brain', 'Infarct', 'An area of altered signal intensity showing diffusion restriction is noted, suggestive of an acute infarct.', 'Acute infarct as described.', 20),
  ('Brain', 'Hemorrhage', 'An area of altered signal intensity with blooming on GRE/SWI is noted, suggestive of hemorrhage.', 'Intracranial hemorrhage as described.', 30),
  ('Brain', 'Tumor', 'A well/ill-defined space-occupying lesion is noted with surrounding edema and mass effect.', 'Intracranial space-occupying lesion — suggest contrast-enhanced study / histopathological correlation.', 40),
  ('Brain', 'Sinus changes', 'Mucosal thickening is noted in the paranasal sinuses.', 'Paranasal sinusitis.', 50),
  ('Brain', 'Atrophy', 'Prominence of cerebral sulci and ventricular system is noted, suggestive of age-related cerebral atrophy.', 'Diffuse cerebral atrophy.', 60),
  ('Brain', 'Gliosis', 'An area of gliosis with surrounding T2/FLAIR hyperintensity is noted.', 'Gliotic changes as described.', 70),
  ('Brain', 'Demyelination', 'Multiple T2/FLAIR hyperintense lesions are noted in the periventricular white matter, suggestive of demyelination.', 'Demyelinating lesions — clinical correlation and follow-up advised.', 80),
  ('Brain', 'Normal study', 'No focal parenchymal lesion, mass effect, or midline shift. Ventricular system and sulcal spaces are normal. No diffusion restriction or abnormal blooming.', 'No significant abnormality detected in the brain.', 90),
  ('Brain', 'MRA advised', '', 'MR angiography of the brain is advised for further evaluation.', 100)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Seed quick findings: Spine (generic MRI spine) ──────────────────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Spine', 'Degenerative changes', 'Degenerative changes are noted in the form of marginal osteophytes and disc desiccation.', 'Degenerative spondylotic changes.', 10),
  ('Spine', 'Disc bulge', 'Diffuse disc bulge is noted indenting the anterior thecal sac.', 'Disc bulge as described.', 20),
  ('Spine', 'Nerve root compression', 'The disc is compressing the traversing/exiting nerve root.', 'Nerve root compression as described.', 30),
  ('Spine', 'Facet joint arthropathy', 'Facet joint hypertrophy with arthropathy is noted.', 'Facet joint arthropathy.', 40),
  ('Spine', 'Canal stenosis', 'Secondary spinal canal stenosis is noted.', 'Spinal canal stenosis as described.', 50),
  ('Spine', 'Tuberculosis', 'Altered marrow signal with endplate destruction and pre/paravertebral collection is noted, suggestive of infective (Kochs) etiology.', 'Findings suggestive of spinal tuberculosis — clinical and laboratory correlation advised.', 60),
  ('Spine', 'Compression fracture', 'Loss of vertebral body height with marrow edema is noted, suggestive of compression fracture.', 'Vertebral compression fracture as described.', 70),
  ('Spine', 'Hemangioma', 'A well-defined T1/T2 hyperintense lesion is noted in the vertebral body, suggestive of hemangioma.', 'Vertebral hemangioma — benign.', 80),
  ('Spine', 'Modic changes', 'Endplate marrow signal changes are noted (Modic changes).', 'Modic endplate changes as described.', 90),
  ('Spine', 'Cord changes', 'Altered cord signal intensity is noted, suggestive of myelomalacia/edema.', 'Cord signal changes as described — clinical correlation advised.', 100)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Seed quick findings: LS Spine ────────────────────────────────────────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('LS Spine', 'Loss of lumbar lordosis', 'Straightening / loss of normal lumbar lordosis is noted, likely due to muscular spasm.', 'Loss of lumbar lordosis.', 10),
  ('LS Spine', 'Disc desiccation', 'Disc desiccation is noted with reduced T2 signal intensity.', 'Degenerative disc desiccation.', 20),
  ('LS Spine', 'L4-L5 disc bulge', 'Diffuse disc bulge is noted at L4-L5 level indenting the anterior thecal sac.', 'L4-L5 disc bulge.', 30),
  ('LS Spine', 'L5-S1 disc bulge', 'Diffuse disc bulge is noted at L5-S1 level indenting the anterior thecal sac.', 'L5-S1 disc bulge.', 40),
  ('LS Spine', 'Thecal sac compression', 'The disc is indenting and compressing the anterior thecal sac.', 'Thecal sac compression as described.', 50),
  ('LS Spine', 'Nerve root impingement', 'Impingement of the traversing/exiting nerve roots is noted.', 'Nerve root impingement as described.', 60),
  ('LS Spine', 'Facet arthropathy', 'Facet joint hypertrophy with arthropathy is noted at multiple levels.', 'Lumbar facet arthropathy.', 70),
  ('LS Spine', 'Canal narrowing', 'Secondary narrowing of the spinal canal is noted.', 'Lumbar canal narrowing as described.', 80),
  ('LS Spine', 'Sacralization', 'Sacralization of the L5 vertebra is noted (transitional vertebra).', 'Lumbosacral transitional vertebra (sacralization of L5).', 90),
  ('LS Spine', 'Modic changes', 'Endplate marrow signal changes are noted (Modic changes).', 'Modic endplate changes as described.', 100)
ON CONFLICT (study_type, label) DO NOTHING;
