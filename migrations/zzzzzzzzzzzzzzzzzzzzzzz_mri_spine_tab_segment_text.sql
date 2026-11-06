-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_mri_spine_tab_segment_text.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- `radiology_study_tabs` holds the per-examination Technique line and the editable
-- anatomy-specific normal text the reporting desk starts from. Four tabs are in
-- service for MRI spine, and three of them are byte-identical to the generic one:
--
--   id 2  Spine           technique "Multiplanar multisequence MRI of the spine was
--                          performed including T1, T2, and STIR sequences."
--   id 3  Cervical Spine  <the same string>
--   id 4  Dorsal Spine    <the same string>
--   id 6  Whole Spine     <the same string>
--   id 5  LS Spine        "…MRI of the lumbosacral spine…"  (segment-specific already)
--
-- The same three rows share one normal text: "Remaining vertebrae and discs are
-- unremarkable. Cord shows normal signal intensity. Paravertebral soft tissues are
-- normal."
--
-- So an MRI Cervical Spine report and an MRI Dorsal Spine report open with a
-- Technique line that names neither segment — the examination a referring neurosur-
-- geon reads says only "of the spine" — and the lumbar row proves the intent was
-- segment wording, not a generic one. The report skeleton in
-- `structured_report_templates` is already segment-specific for these exams ("MRI
-- Cervical Spine: T1W and T2W sagittal, T2W axial at disc levels.", "MRI Dorsal
-- (Thoracic) Spine: …", and for the screening formats the acquisition is described
-- together with the segments screened), and the tab is what loads when the billed
-- row names no protocol (`useReportingStudySetup.ts` `applyDefaultTechniqueForRegion`:
-- protocol first, `tab.techniqueText` otherwise). This file brings the tab into
-- agreement with the skeleton rather than authoring anything new.
--
-- WHAT THIS MIGRATION TOUCHES
--   * Three rows, by tab name, each UPDATE guarded by the exact current string. A
--     tab the clinic has reworded is left alone; nothing else in the table is in
--     range. The generic "Spine" tab keeps its generic sentence, which is correct
--     for it, and LS Spine is already right.
--   * Sequence wording and segment naming are taken from the shipped skeleton for
--     the same examination; the normal text changes only where the segment is named.
--     No clinical assertion is added, removed or weakened: the cervical row still
--     says the remaining vertebrae and discs are unremarkable, the cord shows normal
--     signal intensity, and the paravertebral soft tissues are normal.
--   * Whole Spine screening's limitation statement is NOT added here. It is owned by
--     `SCREENING_LIMITATION_TEXT` ("SCREENING STUDIES ARE LIMITED PLANAR & LIMITED
--     SEQUENCE."), emitted once into Findings and preserved through technique merge
--     by `formatSlotMerge.ts`. Two copies of the same statement in one report is a
--     prose defect, so the screening journeys are measured in the browser before
--     anything here touches it.
--   * No claim in `radiology_quick_findings.baseline_replaces` quotes the sentences
--     this file rewrites — measured: 0 of the 20 boxes that carry a claim mention
--     "Remaining vertebrae", "Cord shows normal" or "Paravertebral" — so supersession
--     and exact restore are unaffected.
-- =============================================================================

BEGIN;

UPDATE radiology_study_tabs
   SET technique_text = 'Multiplanar multisequence MRI of the cervical spine was performed including T1W and T2W sagittal and T2W axial sequences at the disc levels.',
       normal_text    = 'Remaining cervical vertebrae and discs are unremarkable. The cervical cord shows normal signal intensity. Paravertebral soft tissues are normal.',
       updated_at     = now()
 WHERE name = 'Cervical Spine'
   AND technique_text = 'Multiplanar multisequence MRI of the spine was performed including T1, T2, and STIR sequences.'
   AND normal_text    = 'Remaining vertebrae and discs are unremarkable. Cord shows normal signal intensity. Paravertebral soft tissues are normal.';

UPDATE radiology_study_tabs
   SET technique_text = 'Multiplanar multisequence MRI of the dorsal (thoracic) spine was performed including T1W and T2W sagittal and axial sequences at selected levels.',
       normal_text    = 'Remaining dorsal vertebrae and discs are unremarkable. The dorsal cord shows normal signal intensity. Paravertebral soft tissues are normal.',
       updated_at     = now()
 WHERE name = 'Dorsal Spine'
   AND technique_text = 'Multiplanar multisequence MRI of the spine was performed including T1, T2, and STIR sequences.'
   AND normal_text    = 'Remaining vertebrae and discs are unremarkable. Cord shows normal signal intensity. Paravertebral soft tissues are normal.';

UPDATE radiology_study_tabs
   SET technique_text = 'Multiplanar multisequence MRI of the whole spine was performed including sagittal T1W and T2W sequences of the cervical, dorsal and lumbosacral spine.',
       normal_text    = 'Remaining vertebrae and discs of the cervical, dorsal and lumbosacral spine are unremarkable. The cord shows normal signal intensity. Paravertebral soft tissues are normal.',
       updated_at     = now()
 WHERE name = 'Whole Spine'
   AND technique_text = 'Multiplanar multisequence MRI of the spine was performed including T1, T2, and STIR sequences.'
   AND normal_text    = 'Remaining vertebrae and discs are unremarkable. Cord shows normal signal intensity. Paravertebral soft tissues are normal.';

COMMIT;
