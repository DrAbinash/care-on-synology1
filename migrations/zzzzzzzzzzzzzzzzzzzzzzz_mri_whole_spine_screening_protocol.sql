-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_mri_whole_spine_screening_protocol.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- The owner's requirement is that a Whole Spine SCREENING examination carries a technique that says
-- what was actually limited: "Limited planar and limited sequence study."
--
-- That sentence — in her own words — already exists in two places, and neither one reaches the
-- reporting desk. `report-formats-library.ts:347,353` authors it into the two
-- "MRI LS Spine + Whole Spine Screening" report formats (`techniqueFragments`, `preserve: true`), and
-- the four screening baselines (`mriLsScreeningNormal.ts:95`, `mriCervicalScreeningNormal.ts:96`,
-- `mriDorsalScreeningNormal.ts:96`, `mriBrainScreeningNormal.ts:93`) each render their own variant.
-- But the Technique a radiologist sees when a study opens is loaded from `radiology_protocols` first:
-- `applyDefaultTechniqueForRegion` (useReportingStudySetup.ts) takes the protocol row that names this
-- tab or this billed region and only falls back to `radiology_study_tabs.technique_text` when no
-- protocol speaks. For Whole Spine, protocol #12 "MRI Whole Spine" IS the default and it describes a
-- full multisequence examination — so a screening study opened with the words "MRI of the whole spine
-- was performed including T1 and T2 sequences", describing sequences that were not obtained.
--
-- What this file does
--   Adds ONE protocol row, "MRI Whole Spine Screening", on the same tab (#6), NOT the default, so a
--   full whole-spine examination keeps #12 untouched and the screening examination has a protocol of
--   its own that the desk can select — and that `pickQuickProtocolForBilledName` loads automatically
--   when the billed row names it.
--
-- What it deliberately does not do
--   * It does not change `radiology_study_tabs.technique_text` for Whole Spine. A whole-spine MRI that
--     is not a screening study is a full study, and rewriting the tab would make every one of them
--     claim to be limited.
--   * It does not re-word the owner's existing screening sentences. `report-formats-library.ts` and
--     the screening baselines are untouched; their prose is not this file's business, and the
--     `preserve: true` fragment rules already keep their sentence in the printed report.
--   * It sets `is_default` false, `is_gold_standard` false, and leaves `checklist_json` /
--     `required_measurements` at their column defaults — nothing here pretends to know a sequence
--     checklist the clinic has not authored.
--
-- SAFETY CONTRACT
--   * `radiology_protocols` has no `factory_key` column (its columns are
--     name,study_type,modality,checklist_json,technique_text,normal_text,recommendation_text,
--     required_measurements,is_gold_standard,sort_order,is_active,created_at,updated_at,is_default,
--     study_tab_id), so the identity this file uses is the pair (name, study_tab_id) — which is also
--     what a clinic would recognise as the same protocol. The insert is guarded by `NOT EXISTS` on
--     that pair, so replaying changes nothing and a row the clinic already authored is never doubled
--     or overwritten.
--   * Never UPDATEs, never DELETEs, touches no existing row. `study_tab_id` is resolved by tab NAME,
--     not hardcoded to 6, because the tab id on the clinic's database is not this file's to assume.
--   * The DO block asserts the row exists and that its technique carries the owner's phrase, so a
--     deploy that silently skipped the insert fails loudly.
--
-- Verified on the acceptance rig: applied twice (row count 1 -> 1, identical row contents), zero other
-- protocol rows changed.
-- =============================================================================

BEGIN;

INSERT INTO radiology_protocols (
  name, study_type, modality, technique_text, normal_text, recommendation_text,
  sort_order, is_active, is_default, study_tab_id
)
SELECT
  'MRI Whole Spine Screening',
  'Whole Spine',
  'MRI',
  'Limited planar and limited sequence study of the whole spine was performed. Sagittal T1W and T2W screening images cover the cervical, dorsal and lumbosacral spine; dedicated axial sequences and intravenous contrast were not obtained.',
  '',
  'Where a screening abnormality is identified, dedicated MRI of that region with a complete sequence protocol is advised.',
  (select coalesce(max(p.sort_order), 0) + 10 from radiology_protocols p where p.study_tab_id = t.id),
  TRUE,
  FALSE,
  t.id
FROM radiology_study_tabs t
WHERE t.name = 'Whole Spine'
  AND NOT EXISTS (
    SELECT 1 FROM radiology_protocols p
     WHERE lower(trim(p.name)) = lower('MRI Whole Spine Screening')
       AND p.study_tab_id = t.id
  );

-- THE SENTENCE IS THERE, OR THE DEPLOY STOPS. The count alone is not enough: a row whose technique
-- lost the limiting statement would describe sequences that were never acquired, which is the defect
-- this file exists to close.
DO $do$
declare
  n int;
begin
  select count(*) into n from radiology_protocols
   where lower(trim(name)) = lower('MRI Whole Spine Screening')
     and technique_text like '%Limited planar and limited sequence study%';
  if n <> 1 then
    raise exception 'MRI Whole Spine Screening protocol is missing or does not carry the limited-study technique (% of 1 match)', n;
  end if;
end
$do$;

COMMIT;
