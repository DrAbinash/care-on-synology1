-- =============================================================================
-- Migration: MRI Dorso-Lumbar Spine gets its own Study Tab and Technique row
--
-- Why: the clinic books this examination as `MRI020 / "MRI DL SPINE"` and its
-- worklist rows carry study_description `DL SPINE`, but `radiology_study_tabs`
-- has no tab for it — production carries Spine, Cervical Spine, Dorsal Spine,
-- LS Spine and Whole Spine and nothing between dorsal and lumbar. The resolver
-- PR #1293 taught now therefore has no answer to reach, and the two readings it
-- produces are both wrong for the technique: "MRI DL SPINE" lands on the generic
-- "Spine" tab, which has no protocol row at all, so the Technique dropdown lists
-- nothing; the spelled-out "MRI DORSO LUMBAR SPINE" lands on "LS Spine", whose
-- one and only option is "MRI LS Spine". Either way a Dorso-Lumbar report has no
-- Dorso-Lumbar acquisition statement to insert — and in the second reading it
-- inserts a lumbar-only one, the wrong-protocol-to-a-patient class
-- `studyRegion.ts` already refuses for X-rays.
--
-- What it adds: the tab, and one protocol row under it whose technique text is
-- the sentence the owned Dorso-Lumbar standard-normal baseline already ships
-- (`mriDorsoLumbarStandardNormal.ts`), so this seed introduces no new clinical
-- wording. `radiologyReportingDefaults.PROTOCOL_DEFAULTS` carries the same row for
-- the "Restore defaults" action, and `mriDorsoLumbarTechnique.test.ts` holds the
-- two in step.
--
-- Safe by construction: forward-only, idempotent (the tab conflicts on the
-- `radiology_study_tabs_name_uq` unique index and is skipped; the protocol
-- conflicts on `radiology_protocols_study_tab_name_uq`, so the no-target
-- DO NOTHING covers it), the tab id is read by subselect rather than assumed, and
-- no existing row is modified — an admin who already renamed or edited a protocol
-- keeps his edit.
-- =============================================================================

DO $$
DECLARE
  dl_tab_id   INTEGER;
  technique   TEXT := 'MRI dorso-lumbar spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W images were obtained.';
  normal_para TEXT := 'Normal MRI of the dorso-lumbar spine. Alignment, vertebral bodies, thoracic cord and conus are normal within the imaged coverage.';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'radiology_study_tabs'
  ) THEN
    RAISE WARNING 'radiology_study_tabs does not exist; skipping Dorso-Lumbar technique seed';
    RETURN;
  END IF;

  -- 45 sits between Dorsal Spine (40) and LS Spine (50): the examination spans the
  -- junction, so its position in the region list is the junction's.
  INSERT INTO radiology_study_tabs (name, sort_order)
  VALUES ('Dorso-Lumbar Spine', 45)
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO dl_tab_id
    FROM radiology_study_tabs
   WHERE name = 'Dorso-Lumbar Spine';

  IF dl_tab_id IS NULL THEN
    RAISE WARNING 'Dorso-Lumbar Spine study tab was not created; technique row skipped';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'radiology_protocols'
      AND column_name = 'study_tab_id'
  ) THEN
    RAISE WARNING 'radiology_protocols.study_tab_id is absent; skipping Dorso-Lumbar technique seed';
    RETURN;
  END IF;

  INSERT INTO radiology_protocols (
    name, study_type, modality, checklist_json, technique_text, normal_text,
    is_gold_standard, is_default, sort_order, is_active, study_tab_id
  )
  VALUES (
    'MRI Dorso-Lumbar Spine', 'Dorso-Lumbar Spine', 'MRI', '[]', technique, normal_para,
    true, true, 105, true, dl_tab_id
  )
  ON CONFLICT DO NOTHING;
END $$;
