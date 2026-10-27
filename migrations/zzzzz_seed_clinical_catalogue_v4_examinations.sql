-- ─────────────────────────────────────────────────────────────────────────────
-- v4.0 Stage B — the 18 examination scopes named in §21 of the brief, as DATA.
--
-- Administrative identity only: no clinical sentence, no finding, no wording. This
-- gives Stage H a target list it can query instead of a paragraph in a document, and
-- it makes the catalogue non-empty so drift checks have something to look at.
--
-- Every row is written status='draft'. That is a safety property, not an oversight:
-- nothing is 'active', so when the read path lands in Stage G it will find no
-- published content and must fall back to what the workspace uses today. Enabling an
-- examination is a deliberate, reviewable act by a radiologist.
--
-- review_state records what is NOT known:
--   'unreviewed' — the scope is taken from words the product already uses, but nobody
--                  has confirmed it against what the clinic bills.
--   'uncertain'  — the scope itself is ambiguous and needs an owner decision (see the
--                  two notes below).
-- Body-part spellings are copied from the vocabulary already in the product
-- (quick-select-tiles.data.ts scopeBodyPart and radiology_quick_findings.study_type),
-- so the eventual bridge is a rename, not a remap.
--
-- Idempotent: ON CONFLICT against the partial unique index, DO NOTHING. An
-- administrator who edits or renames a row is never overwritten by a re-run.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO clinical_examinations
  (key, label, modality, body_part, protocol_scope, review_state, review_note, status, created_by)
VALUES
  ('mr.brain',              'MRI Brain',                'MR', 'Brain',           'Standard',  'unreviewed',
   'Scope wording taken from the shipped tile catalogue (scopeBodyPart "Brain").', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('mr.cervical_spine',     'MRI Cervical Spine',       'MR', 'Cervical Spine',  'Standard',  'unreviewed',
   'Scope wording taken from the shipped tile catalogue.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('mr.dorsal_spine',       'MRI Dorsal Spine',         'MR', 'Dorsal Spine',    'Standard',  'unreviewed',
   'Billed as Dorsal/Thoracic; the C3 audit measured no findings catalogue for this scope at all.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('mr.ls_spine',           'MRI Lumbar Spine',         'MR', 'LS Spine',        'Standard',  'unreviewed',
   'Body part kept as the product spells it ("LS Spine") so the bridge is a rename, not a remap.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('mr.whole_spine_screen', 'MRI Whole Spine Screening','MR', 'Whole Spine',     'Screening', 'unreviewed',
   'Screening protocol: level consolidation across cervical, dorsal and lumbar is the clinical point.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('ct.brain',              'CT Brain',                 'CT', 'Brain',           'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('ct.neck',               'CT Neck',                  'CT', 'Neck',            'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('ct.chest',              'CT Chest',                 'CT', 'Chest',           'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('ct.abdomen',            'CT Abdomen',               'CT', 'Abdomen',         'Standard',  'unreviewed',
   'The live study_type vocabulary also holds "CECT Abdomen" and "Whole Abdomen"; whether contrast is a scope or a separate examination is an owner decision.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('mr.mrcp',               'MRCP',                     'MR', 'MRCP',            'Standard',  'uncertain',
   'UNCERTAIN: MRCP is a protocol, not a body part, yet the shipped scopes treat it as one (C3 recorded MR/MRCP). Needs a radiologist to name the anatomical scope before content is authored against it.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('us.whole_abdomen',      'USG Whole Abdomen',        'US', 'Whole Abdomen',   'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('us.kub',                'USG KUB',                  'US', 'KUB',             'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('us.pelvis',             'USG Pelvis',               'US', 'Pelvis',          'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('us.ob',                 'USG Obstetric',            'US', 'OB',              'Standard',  'uncertain',
   'UNCERTAIN: the ERP declares both "US" and "USG_OB" as modality values, and the shipped tiles use US + "OB". Which is authoritative for billing is unresolved.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('us.arterial_doppler',   'Arterial Doppler',         'US', 'Arterial Doppler','Standard',  'unreviewed',
   'Coded US, not DOPPLER, to match the C3 readiness scopes; the ERP declares a separate DOPPLER modality value.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('us.venous_doppler',     'Venous Doppler',           'US', 'Venous Doppler',  'Standard',  'unreviewed',
   'Coded US, not DOPPLER, as above. §11 requires that DVT extent is never invented — the scope is administrative, the wording is not.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('mg.breast',             'Mammography',              'MG', 'Breast',          'Standard',  'unreviewed',
   NULL, 'draft', 'migration:zzzzz_seed_clinical_catalogue_v4_examinations'),
  ('xr.chest',              'X-Ray Chest',              'XR', 'Chest',           'Standard',  'uncertain',
   'UNCERTAIN: §21 lists "X-ray" as one of eighteen examinations, but in this product X-ray is a modality family with many billed scopes (the live study_type vocabulary holds fourteen X-Ray variants). This row is a placeholder for that decision, not an approved scope.', 'draft',
   'migration:zzzzz_seed_clinical_catalogue_v4_examinations')
ON CONFLICT (key) WHERE deleted_at IS NULL DO NOTHING;
