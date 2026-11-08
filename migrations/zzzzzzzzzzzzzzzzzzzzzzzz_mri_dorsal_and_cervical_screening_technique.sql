-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzzz_mri_dorsal_and_cervical_screening_technique.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- Two MRI examinations still reach the reporting desk without an honest Technique
-- row behind them. Both states were measured in the clinic database (`care-db`)
-- on 2026-11-08, at 112 study tabs / 86 protocols / 15 of them MRI:
--
--   DORSAL SPINE — tab 4 owns ZERO protocols, and the generic "Spine" tab (id 2)
--   that a segment inherits from owns zero too. `pickQuickProtocolForBilledName`
--   and `pickQuickProtocol` therefore both return null for a booked
--   "MRI DORSAL SPINE", and `applyDefaultTechniqueForRegion`
--   (useReportingStudySetup.ts:462-475) takes its last branch: the Technique field
--   is filled from `radiology_study_tabs.technique_text` (145 chars, repaired to a
--   dorsal-specific sentence by zzzzzzzzzzzzzzzzzzzzzzz_mri_spine_tab_segment_text.sql)
--   while `setActiveProtocol(null)` leaves the Technique dropdown with NOTHING to
--   offer and no option highlighted. Clear the field and there is no way back.
--
--   CERVICAL SPINE — tab 3 owns two rows and the wrong one is authoritative:
--     id 83 "MRI CERVICAL SPINE SCREENING SCR"  is_default=t  is_gold=t  sort 0    technique_text = ''      (0 chars)
--     id 11 "MRI Cervical Spine"                is_default=f  is_gold=t  sort 110  technique_text = 103 chars
--   #83 was created in the clinic on 2026-08-30 with an empty technique and has
--   been the tab's default ever since, so the ★ option in the strip inserts
--   nothing, and any cervical booking whose billed name matches neither row
--   auto-loads an empty Technique.
--
-- What this file does
--   1. Files "MRI Dorsal Spine" under the existing Dorsal Spine tab. Its technique
--      and normal sentences are `mriDorsalStandardNormal.ts`'s own
--      (MRI_DORSAL_STANDARD_NORMAL_META.technique / _IMPRESSION) — the same
--      single-owner rule PR #1295 followed for Dorso-Lumbar, and the sentence the
--      linked-technique merge and the technique-section floor already recognise
--      ("MRI dorsal spine on 3T", linkedTechniqueMerge.test.ts:46,
--      techniqueSectionFloor.test.ts:16). Nothing here authors clinical prose.
--   2. Fills #83's BLANK technique with `mriCervicalScreeningNormal.ts`'s own
--      screening sentence, and moves the tab's authority onto the dedicated row.
--
-- Why the flags are part of change 2, not left alone
--   Technique precedence is `isDefault → isGoldStandard → lowest sortOrder`
--   (pickQuickProtocol.ts:64-70) and BOTH cervical rows are gold with #83 at
--   sort 0. So filling #83 and touching nothing else would put a LIMITED-STUDY
--   sentence on every full cervical MRI that the billed name does not match
--   exactly — strictly worse than the empty string it replaces. The two flags are
--   therefore corrected in the same statement that fills the blank, and only when
--   that fill actually matched: a row nobody ever wrote text into is not a
--   customisation worth preserving, while its content is.
--
-- What it deliberately does not do
--   * It never overwrites a technique a radiologist has written. The fill is
--     guarded by `btrim(coalesce(technique_text, '')) = ''`, and the flag pair
--     runs only in the CTE that the fill feeds — a customised row leaves `filled`
--     empty, so nothing downstream changes.
--   * It does not create a Dorsal Spine tab (one exists) and does not rewrite any
--     tab's own technique_text — the tab fallback stays what segment-text shipped.
--   * It leaves #83's name, sort_order, is_active and gold/default history of the
--     dedicated row alone apart from the one flag this file argues for.
--   * `checklist_json` is '[]' on the dorsal row on purpose: this examination's
--     content arrives as Quick Select factory boxes, and a checklist invented here
--     would be a second one.
--
-- SAFETY CONTRACT
--   * The identity used is (name, study_tab_id) — `radiology_protocols` has no
--     factory_key column. Both statements look the tab up BY NAME; no id is
--     assumed, because the clinic's tab ids are not this file's to know.
--   * Replaying changes nothing: the insert is `NOT EXISTS`-guarded and the fill's
--     blank-only predicate is false once the sentence is in place.
--   * The closing block only REPORTS. An earlier seed in this family raised
--     `exception` when its expected row was not found; that is the wrong trade
--     here, because a clinic that renamed or re-defaulted one of these rows would
--     fail `care-db-patch-v2`, and `care-api` never starts after a non-zero exit —
--     a renamed technique row must not be able to close the clinic.
-- =============================================================================

BEGIN;

-- ── 1. Dorsal Spine gets the protocol its tab has never had ──────────────────
INSERT INTO radiology_protocols (
  name, study_type, modality, checklist_json, technique_text, normal_text,
  sort_order, is_active, is_default, is_gold_standard, study_tab_id
)
SELECT
  'MRI Dorsal Spine',
  'Dorsal Spine',
  'MRI',
  '[]',
  'MRI dorsal spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 3 mm.',
  'Normal MRI of the dorsal (thoracic) spine. No disc herniation, canal stenosis, or neural foraminal narrowing.',
  115,
  TRUE,
  TRUE,
  TRUE,
  t.id
FROM radiology_study_tabs t
WHERE t.name = 'Dorsal Spine'
  AND NOT EXISTS (
    SELECT 1 FROM radiology_protocols p
     WHERE lower(trim(p.name)) = lower('MRI Dorsal Spine')
       AND p.study_tab_id = t.id
  );

-- ── 2. The cervical screening row gets its sentence, and the tab keeps its
--       dedicated row as the authority ────────────────────────────────────────
WITH filled AS (
  UPDATE radiology_protocols
     SET technique_text   = 'Limited planar and limited sequence MRI cervical spine screening was performed (sagittal T1W/T2W with selected axial images).',
         is_default       = FALSE,
         is_gold_standard = FALSE,
         updated_at       = now()
   WHERE study_tab_id = (SELECT id FROM radiology_study_tabs WHERE name = 'Cervical Spine')
     AND lower(trim(name)) LIKE 'mri cervical spine screening%'
     AND btrim(coalesce(technique_text, '')) = ''
     AND is_active = TRUE
  RETURNING study_tab_id
)
UPDATE radiology_protocols p
   SET is_default = TRUE,
       updated_at = now()
  FROM filled f
 WHERE p.study_tab_id = f.study_tab_id
   AND lower(trim(p.name)) = lower('MRI Cervical Spine')
   AND p.is_active = TRUE;

-- ── Report what the desk will now see. Never a hard failure: see SAFETY CONTRACT.
DO $do$
declare
  dorsal     int;
  winner     text;
  left_blank int;
begin
  select count(*) into dorsal
    from radiology_protocols
   where lower(trim(name)) = lower('MRI Dorsal Spine')
     and technique_text = 'MRI dorsal spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 3 mm.';
  if dorsal <> 1 then
    raise warning 'MRI Dorsal Spine protocol: expected 1 row carrying the owned baseline technique, found %', dorsal;
  end if;

  -- The same precedence the app uses: isDefault -> isGoldStandard -> sortOrder -> name.
  select w.name into winner
    from radiology_study_tabs t
   cross join lateral (
     select p.name
       from radiology_protocols p
      where p.study_tab_id = t.id and p.is_active
      order by p.is_default desc, p.is_gold_standard desc, p.sort_order asc, p.name asc
      limit 1
   ) w
   where t.name = 'Cervical Spine';
  if winner is not null and lower(trim(winner)) <> 'mri cervical spine' then
    raise warning 'Cervical Spine technique authority is %, not the dedicated row', winner;
  end if;

  select count(*) into left_blank
    from radiology_protocols p
    join radiology_study_tabs t on t.id = p.study_tab_id
   where t.name = 'Cervical Spine'
     and p.is_active
     and lower(trim(p.name)) like 'mri cervical spine screening%'
     and btrim(coalesce(p.technique_text, '')) = '';
  if left_blank > 0 then
    raise warning '% cervical screening row(s) still carry no technique', left_blank;
  end if;
end
$do$;

COMMIT;
