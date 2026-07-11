-- =============================================================================
-- Migration: Protocol-Driven Intelligent Reporting (Phase 5)
-- Date: 2026-07-07
-- =============================================================================
-- Adds a Protocol layer ON TOP OF the existing study tabs / quick findings
-- (Brain, LS Spine, …). A "Protocol" is an indication-specific preset within
-- a body region — e.g. "MRI Brain Trauma" vs "MRI Brain Stroke" are both
-- under the Brain region but carry different checklists, normals,
-- technique, and recommendations. Nothing about the existing tab/finding
-- system is changed; protocols reference a tab by name (not FK, same
-- pattern as radiology_quick_findings.study_type) so renames never cascade.
--
-- Also adds a per-radiologist Learning Engine table: tracks how often a
-- given radiologist follows one finding with a particular free-text
-- addition, so the system can (eventually) suggest it — suggestion only,
-- never automatic insertion.
--
-- Fully idempotent: CREATE TABLE/INDEX IF NOT EXISTS, seeds via
-- ON CONFLICT DO NOTHING. Purely additive — no existing table altered
-- destructively, no existing column removed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS radiology_protocols (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                    -- e.g. "MRI Brain Trauma"
  study_type TEXT NOT NULL,              -- links to radiology_study_tabs.name (region)
  modality TEXT NOT NULL DEFAULT '',     -- MRI / CT / USG / XR / Mammo / Doppler (universal architecture)
  checklist_json TEXT NOT NULL DEFAULT '[]',   -- ["Skull","Extra-axial hemorrhage",...]
  technique_text TEXT NOT NULL DEFAULT '',
  normal_text TEXT NOT NULL DEFAULT '',
  recommendation_text TEXT NOT NULL DEFAULT '',
  required_measurements TEXT NOT NULL DEFAULT '',  -- comma list of measurement labels
  is_gold_standard BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_protocols_name_uq ON radiology_protocols (name);
CREATE INDEX IF NOT EXISTS radiology_protocols_study_idx ON radiology_protocols (study_type, is_active, sort_order);

-- ── Per-radiologist Learning Engine ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS radiology_learned_patterns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  trigger_label TEXT NOT NULL,           -- the quick-finding button label that preceded this text
  suggested_text TEXT NOT NULL,          -- the free text the radiologist typed/added afterwards
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radiology_learned_patterns_uq ON radiology_learned_patterns (user_id, trigger_label, suggested_text);
CREATE INDEX IF NOT EXISTS radiology_learned_patterns_user_idx ON radiology_learned_patterns (user_id, trigger_label);

-- ── Seed protocols (Brain + LS Spine — Dr. Abinash's exact checklist spec) ───
INSERT INTO radiology_protocols (name, study_type, modality, checklist_json, technique_text, normal_text, is_gold_standard, sort_order) VALUES
  ('MRI Brain Routine', 'Brain', 'MRI',
   '["Parenchyma","Ventricles","Basal ganglia","Posterior fossa","Sinuses","Skull base"]',
   'Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, and GRE sequences.',
   'Brain parenchyma shows normal signal intensity. Ventricular system and sulcal spaces are normal. No midline shift. Posterior fossa structures are unremarkable. Paranasal sinuses and skull base are normal.',
   TRUE, 10),
  ('MRI Brain Trauma', 'Brain', 'MRI',
   '["Skull","Extra-axial hemorrhage","Subdural","Epidural","SAH","DAI","SWI blooming","Diffusion restriction","Midline shift","Ventricles","Sinuses","Skull base"]',
   'Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, GRE/SWI sequences for trauma protocol.',
   'No extra-axial hemorrhage, subdural, or epidural collection. No SWI blooming to suggest diffuse axonal injury. No diffusion restriction. No midline shift. Skull and skull base are intact.',
   TRUE, 20),
  ('MRI Brain Stroke', 'Brain', 'MRI',
   '["Diffusion restriction","ADC correlation","Vessel territory","Hemorrhagic transformation","Midline shift","MRA vessels"]',
   'Multiplanar multisequence MRI of the brain was performed including DWI, ADC, FLAIR, GRE, and MRA sequences for stroke protocol.',
   'No acute diffusion restriction. No hemorrhagic transformation. No midline shift. Intracranial vasculature shows normal flow-related signal.',
   TRUE, 30),
  ('MRI Brain Epilepsy', 'Brain', 'MRI',
   '["Hippocampus","Mesial temporal sclerosis","Cortical dysplasia","Gray-white differentiation","Ventricles"]',
   'Multiplanar multisequence MRI of the brain was performed including thin-section coronal T2/FLAIR through the hippocampi for epilepsy protocol.',
   'Bilateral hippocampi show normal size, signal, and internal architecture. No mesial temporal sclerosis. Gray-white matter differentiation is preserved. No cortical dysplasia identified.',
   TRUE, 40),
  ('MRI Brain Dementia', 'Brain', 'MRI',
   '["Global atrophy","Hippocampal volume","White matter changes","Ventricles","Microhemorrhages"]',
   'Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, and SWI sequences for dementia/volumetric assessment.',
   'No disproportionate global or hippocampal atrophy for age. No significant white matter ischemic changes. No microhemorrhages on SWI.',
   TRUE, 50),
  ('MRI Brain Contrast', 'Brain', 'MRI',
   '["Pre-contrast findings","Enhancement pattern","Ring enhancement","Leptomeningeal enhancement"]',
   'Multiplanar multisequence MRI of the brain was performed pre- and post-intravenous contrast administration.',
   'No abnormal parenchymal or leptomeningeal enhancement identified.',
   TRUE, 60),
  ('MRI Pituitary', 'Brain', 'MRI',
   '["Gland size","Gland signal","Stalk","Optic chiasm","Cavernous sinus"]',
   'Dedicated thin-section MRI of the sella and pituitary was performed including dynamic contrast sequences.',
   'Pituitary gland is normal in size and signal. Infundibulum is midline. Optic chiasm is not compressed. Cavernous sinuses are normal bilaterally.',
   TRUE, 70),
  ('MRI IAC', 'Brain', 'MRI',
   '["7th/8th nerve complex", "Vestibule and cochlea", "Cerebellopontine angle"]',
   'High-resolution T2 (FIESTA/CISS) MRI of the internal auditory canals was performed.',
   'Bilateral 7th and 8th cranial nerve complexes are normal. No cerebellopontine angle mass. Cochlea and vestibule are normal.',
   TRUE, 80),
  ('MRI Orbit', 'Brain', 'MRI',
   '["Globe","Optic nerve","Extraocular muscles","Retro-orbital fat"]',
   'Dedicated MRI of the orbits was performed including fat-suppressed T2 and post-contrast sequences.',
   'Both globes are normal in size and signal. Optic nerves are normal in caliber and signal. Extraocular muscles are normal. No retro-orbital mass.',
   TRUE, 90),
  ('MRI LS Spine', 'LS Spine', 'MRI',
   '["Alignment","Lordosis","Vertebral marrow","End plates","Disc hydration","Disc bulges","Facet joints","Canal","Foramina","Cord","Cauda","SI joints"]',
   'Multiplanar multisequence MRI of the lumbosacral spine was performed including T1, T2, and STIR sequences.',
   'Normal lumbar alignment and lordosis. Vertebral marrow and endplates are normal. Discs show normal hydration and height. No significant disc bulge. Facet joints are unremarkable. Spinal canal and neural foramina are patent. Conus and cauda equina are normal. SI joints are unremarkable.',
   TRUE, 100),
  ('MRI Cervical Spine', 'Cervical Spine', 'MRI',
   '["Alignment","Lordosis","Vertebral marrow","Disc hydration","Disc bulges","Canal","Foramina","Cord signal"]',
   'Multiplanar multisequence MRI of the cervical spine was performed including T1, T2, and STIR sequences.',
   'Normal cervical alignment and lordosis. Vertebral marrow is normal. Discs show normal hydration and height. Spinal canal and neural foramina are patent. Cord shows normal signal intensity throughout.',
   TRUE, 110),
  ('MRI Whole Spine', 'Whole Spine', 'MRI',
   '["Alignment","Vertebral marrow","Disc levels","Canal","Cord signal","Conus level"]',
   'Multiplanar multisequence MRI of the whole spine was performed including T1 and T2 sequences.',
   'Normal spinal alignment throughout. Vertebral marrow is normal at all levels. Spinal canal is patent throughout. Cord shows normal signal and caliber. Conus terminates at a normal level.',
   TRUE, 120)
ON CONFLICT (name) DO NOTHING;
