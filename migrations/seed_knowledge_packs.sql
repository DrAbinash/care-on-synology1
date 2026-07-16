-- CARE Knowledge Pack Engine — seed the pack REGISTRY.
--
-- Each row is a MANIFEST that names/describes existing per-study-type content
-- (referenced by study_type / builder_type / body_part / knowledge_category).
-- It copies NO content — the loader assembles each pack live from the tables the
-- Reporting Workspace already reads, so MRI/USG behaviour is unchanged.
--
-- Idempotent: INSERT ... ON CONFLICT (pack_id) DO NOTHING — never overwrites an
-- admin-edited or system pack on re-run.
--
--   status: enabled (live content) | placeholder (awaiting Gold Standard) | planned (registry only)
--   is_system TRUE marks production packs (guarded from delete/overwrite).

INSERT INTO knowledge_packs
  (pack_id, modality, name, description, category, study_type, builder_type, body_part, knowledge_category, version, author, status, is_system, manifest_json)
VALUES
  -- ── MRI (existing content — enabled) ──────────────────────────────────────
  ('mri.brain',          'MRI', 'MRI Brain Pack',           'Brain MRI reporting content.',            'Neuro', 'Brain',          'mri_brain',          'BRAIN',          'Brain', '1.0.0', 'CARE Radiology', 'enabled', TRUE,
     '{"copilotModules":["copilotComparisonModule","copilotMeasurementModule"],"comparisonMeasurements":["lesion","mass"],"criticalFindings":["hemorrhage","herniation","midline shift","hydrocephalus"]}'),
  ('mri.cervical_spine', 'MRI', 'MRI Cervical Spine Pack',  'Cervical spine MRI reporting content.',    'Neuro', 'Cervical Spine', 'mri_cervical_spine', 'CERVICAL_SPINE', 'Spine', '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('mri.dorsal_spine',   'MRI', 'MRI Dorsal Spine Pack',    'Dorsal spine MRI reporting content.',      'Neuro', 'Dorsal Spine',   'mri_dorsal_spine',   'DORSAL_SPINE',   'Spine', '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('mri.ls_spine',       'MRI', 'MRI Lumbar Spine Pack',    'Lumbosacral spine MRI reporting content.', 'Neuro', 'LS Spine',       'mri_lumbar_spine',   'LS_SPINE',       'Spine', '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('mri.whole_spine',    'MRI', 'MRI Whole Spine Pack',     'Whole spine MRI screening content.',       'Neuro', 'Whole Spine',    'mri_whole_spine',    NULL,             'Spine', '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('mri.knee',           'MRI', 'MRI Knee Pack',            'Knee MRI reporting content.',              'MSK',   'Knee',           'mri_knee',           'KNEE',           'MSK',   '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  -- MRI aspirational sub-specialty studies (placeholders — content pending)
  ('mri.pituitary', 'MRI', 'MRI Pituitary Pack', 'Pituitary/sella MRI — awaiting Gold Standard.', 'Neuro', 'Pituitary', 'mri_pituitary', 'PITUITARY', 'Brain', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('mri.orbit',     'MRI', 'MRI Orbit Pack',     'Orbit MRI — awaiting Gold Standard.',           'Neuro', 'Orbit',     'mri_orbit',     'ORBIT',     'Brain', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('mri.iac',       'MRI', 'MRI IAC Pack',       'Internal auditory canal MRI — awaiting Gold Standard.', 'Neuro', 'IAC', 'mri_iac', 'IAC', 'Brain', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),

  -- ── USG (existing Gold Standard content — enabled) ────────────────────────
  ('usg.whole_abdomen', 'USG', 'USG Whole Abdomen Pack', 'Whole abdomen ultrasound reporting content.', 'Body',        'Whole Abdomen',  'usg_abdomen',  'WHOLE_ABDOMEN',   'Abdomen',     '1.0.0', 'CARE Radiology', 'enabled', TRUE,
     '{"copilotModules":["copilotUsgAbdomenModule","copilotUsgLiverModule","copilotUsgGallbladderModule","copilotUsgKidneyModule"],"comparisonMeasurements":["Right Kidney","Left Kidney","CBD","Liver"],"criticalFindings":["free fluid","mass","abscess"]}'),
  ('usg.kub',           'USG', 'USG KUB Pack',           'Kidneys-ureters-bladder ultrasound content.', 'Body',        'KUB',            'usg_kub',      'KUB',             'Abdomen',     '1.0.0', 'CARE Radiology', 'enabled', TRUE,
     '{"copilotModules":["copilotUsgKidneyModule"],"comparisonMeasurements":["Right Kidney","Left Kidney"]}'),
  ('usg.pelvis',        'USG', 'USG Pelvis Pack',        'Female pelvis (TA/TV) ultrasound content.',   'Body',        'Pelvis',         'usg_pelvis',   'PELVIS_FEMALE',   'Pelvis',      '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.tvs',           'USG', 'USG TVS Pack',           'Transvaginal ultrasound content.',            'Body',        'TVS',            'usg_tvs',      'PELVIS_FEMALE',   'Pelvis',      '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.thyroid',       'USG', 'USG Thyroid Pack',       'Thyroid ultrasound (TIRADS) content.',        'Small Parts', 'Thyroid',        'usg_thyroid',  'THYROID',         'Neck',        '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.breast',        'USG', 'USG Breast Pack',        'Breast ultrasound (BIRADS) content.',         'Small Parts', 'Breast',         'usg_breast',   'BREAST',          'Breast',      '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.scrotum',       'USG', 'USG Scrotum Pack',       'Scrotum ultrasound content.',                 'Small Parts', 'Scrotum',        'usg_scrotum',  'SCROTUM',         'Scrotum',     '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.growth',        'USG', 'USG Growth Scan Pack',   'Obstetric growth scan content.',              'Obstetric',   'Growth',         'usg_obstetric','OB_GROWTH',       'Obstetrics',  '1.0.0', 'CARE Radiology', 'enabled', TRUE,
     '{"copilotModules":["copilotUsgObstetricModule"],"comparisonMeasurements":["BPD","HC","AC","FL","EFW"]}'),
  ('usg.nt',            'USG', 'USG NT Scan Pack',       'First-trimester / NT scan content.',          'Obstetric',   'NT',             'usg_obstetric','OB_EARLY',        'Obstetrics',  '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.anomaly',       'USG', 'USG Anomaly Scan Pack',  'Second-trimester anomaly scan content.',      'Obstetric',   'Anomaly',        'usg_obstetric','OB_ANOMALY',      'Obstetrics',  '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.carotid_doppler','USG','USG Carotid Doppler Pack','Carotid Doppler content.',                   'Vascular',    'Carotid Doppler','usg_doppler',  'CAROTID_DOPPLER', 'Neck',        '1.0.0', 'CARE Radiology', 'enabled', TRUE,
     '{"copilotModules":["copilotUsgDopplerModule"]}'),
  ('usg.venous_doppler','USG', 'USG Venous Doppler Pack','Limb venous Doppler (DVT) content.',          'Vascular',    'Venous Doppler', 'usg_doppler',  'VENOUS_DOPPLER',  'Vascular',    '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),
  ('usg.renal_doppler', 'USG', 'USG Renal Doppler Pack', 'Renal Doppler content.',                      'Vascular',    'Renal Doppler',  'usg_doppler',  'ARTERIAL_DOPPLER','Abdomen',     '1.0.0', 'CARE Radiology', 'enabled', TRUE, '{}'),

  -- ── CT (placeholders — future Gold Standards) ────────────────────────────
  ('ct.brain',    'CT', 'CT Brain Pack',    'CT Brain — placeholder for future Gold Standard.',    'Placeholder', 'CT Brain',    'ct_brain',    NULL, 'Brain',   '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.chest',    'CT', 'CT Chest Pack',    'CT Chest — placeholder.',                             'Placeholder', 'CT Chest',    'ct_chest',    NULL, 'Chest',   '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.abdomen',  'CT', 'CT Abdomen Pack',  'CT Abdomen — placeholder.',                           'Placeholder', 'CT Abdomen',  'ct_abdomen',  NULL, 'Abdomen', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.kub',      'CT', 'CT KUB Pack',      'CT KUB — placeholder.',                               'Placeholder', 'CT KUB',      'ct_kub',      NULL, 'Abdomen', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.hrct',     'CT', 'HRCT Chest Pack',  'HRCT Chest — placeholder.',                           'Placeholder', 'HRCT',        'ct_hrct',     NULL, 'Chest',   '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.cta',      'CT', 'CT Angiography Pack','CTA — placeholder.',                                'Placeholder', 'CTA',         'ct_cta',      NULL, 'Vascular','0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.spine',    'CT', 'CT Spine Pack',    'CT Spine — placeholder.',                             'Placeholder', 'CT Spine',    'ct_spine',    NULL, 'Spine',   '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('ct.pns',      'CT', 'CT PNS Pack',      'CT PNS — placeholder.',                               'Placeholder', 'CT PNS',      'ct_pns',      NULL, 'Head & Neck','0.1.0','CARE Radiology','placeholder', FALSE, '{}'),

  -- ── X-Ray (placeholders) ─────────────────────────────────────────────────
  ('xr.chest',    'XR', 'Chest X-Ray Pack',   'Chest radiograph — placeholder.',   'Placeholder', 'X-Ray Chest',   'xr_chest',    NULL, 'Chest',   '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('xr.kub',      'XR', 'X-Ray KUB Pack',     'KUB radiograph — placeholder.',     'Placeholder', 'X-Ray KUB',     'xr_kub',      NULL, 'Abdomen', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('xr.spine',    'XR', 'X-Ray Spine Pack',   'Spine radiograph — placeholder.',   'Placeholder', 'X-Ray Spine',   'xr_spine',    NULL, 'Spine',   '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('xr.pelvis',   'XR', 'X-Ray Pelvis Pack',  'Pelvis radiograph — placeholder.',  'Placeholder', 'X-Ray Pelvis',  'xr_pelvis',   NULL, 'Pelvis',  '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('xr.shoulder', 'XR', 'X-Ray Shoulder Pack','Shoulder radiograph — placeholder.','Placeholder', 'X-Ray Shoulder','xr_shoulder', NULL, 'MSK',     '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('xr.hand',     'XR', 'X-Ray Hand Pack',    'Hand radiograph — placeholder.',    'Placeholder', 'X-Ray Hand',    'xr_hand',     NULL, 'MSK',     '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('xr.foot',     'XR', 'X-Ray Foot Pack',    'Foot radiograph — placeholder.',    'Placeholder', 'X-Ray Foot',    'xr_foot',     NULL, 'MSK',     '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),

  -- ── Mammography (placeholders) ───────────────────────────────────────────
  ('mg.screening',    'MG', 'Mammography Screening Pack',    'Screening mammography (BI-RADS) — placeholder.', 'Placeholder', 'Mammography Screening',    'mg_screening',    NULL, 'Breast', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('mg.diagnostic',   'MG', 'Mammography Diagnostic Pack',   'Diagnostic mammography — placeholder.',          'Placeholder', 'Mammography Diagnostic',   'mg_diagnostic',   NULL, 'Breast', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),
  ('mg.tomosynthesis','MG', 'Mammography Tomosynthesis Pack','Tomosynthesis (DBT) — placeholder.',             'Placeholder', 'Mammography Tomosynthesis','mg_tomosynthesis',NULL, 'Breast', '0.1.0', 'CARE Radiology', 'placeholder', FALSE, '{}'),

  -- ── Future modalities (registry only — planned) ──────────────────────────
  ('petct.oncology', 'PETCT', 'PET-CT Oncology Pack',   'PET-CT — planned.',            'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}'),
  ('dexa.bmd',       'DEXA',  'DEXA Bone Density Pack',  'DEXA / BMD — planned.',        'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}'),
  ('fl.general',     'FL',    'Fluoroscopy Pack',        'Fluoroscopy — planned.',       'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}'),
  ('nm.general',     'NM',    'Nuclear Medicine Pack',   'Nuclear medicine — planned.',  'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}'),
  ('eeg.general',    'EEG',   'EEG Pack',                'EEG — planned.',               'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}'),
  ('ecg.general',    'ECG',   'ECG Pack',                'ECG — planned.',               'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}'),
  ('tmt.general',    'TMT',   'TMT Pack',                'Treadmill test — planned.',    'Future', NULL, NULL, NULL, NULL, '0.0.1', 'CARE Radiology', 'planned', FALSE, '{}')
ON CONFLICT (pack_id) DO NOTHING;
