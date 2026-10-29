-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r001.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- `structured_report_templates.macros_json` holds 22 MRI sentences written and approved by the
-- radiologist-owner. No reporting surface ever read that column: the only consumer of `macros_json` in
-- the repository is the admin template editor (`artifacts/diagnostic-erp/src/pages/ReportTemplates.tsx`),
-- so her approved wording was unreachable at the reporting desk while the desk offered tiles authored
-- elsewhere.
--
-- This file converts 10 of those macros into `radiology_quick_findings` boxes — the
-- catalogue the existing deterministic composer already reads. It is not a second engine and not new
-- clinical prose: each sentence is the owner's macro text verbatim, with only her own square-bracket
-- slot replaced by the parameter token the composer validates, so an unanswered level, side or
-- measurement is refused rather than reported (`missingRequired`, `unansweredStructuredMeasurements`).
--
-- Not every macro is shipped. Deliberately excluded, each with its reason:
--   * MRI Brain Plain / acute_infarct: already on the Brain wall as #48 "Acute Infarct", which carries {side} and {territory} — it was hidden by the anatomy chip, not absent, and #512 "Acute infarct (DWI)" is its MR-scoped twin
--   * MRI Brain Plain / no_midline_shift: it is the normal statement, not an abnormality — the composer already owns that sentence as baseline prose (mriBrainStandardNormal.ts), so a tile would let a radiologist click a negative and retire a positive
--   * MRI Stroke Protocol / acute_mca_infarct: the strip scopes by modality and region only, never by protocol, so shipping it active would offer MRA and ASPECTS wording on a plain brain study. It also carries [occlusion/stenosis] and [M1/M2/ICA] slots that need a stroke-specific vocabulary nothing in the catalogue defines
--   * MRI Stroke Protocol / tia_negative: a negative with a clinical caveat, not an abnormality
--   * MRI Cervical Spine / myelopathy: already on the Cervical wall as #68 "Myelomalacia" at {level} (and #468 "Cord signal change", concept cord_signal)
--   * MRI Cervical Spine with Whole Spine Screening / myelopathy: the same sentence as the plain cervical macro — one box serves both examinations
--   * MRI Cervical Spine with Whole Spine Screening / cervical_spondylosis: byte-identical to the plain cervical macro shipped above; the screening study bills as Cervical Spine, so that box already reaches its wall
--   * MRI LS Spine with Whole Spine Screening / disc_prolapse: byte-identical to the MRI LS Spine macro shipped above; the screening study bills as LS Spine, so the shipped box already reaches its wall
--   * MRI LS Spine with Whole Spine Screening / canal_stenosis: byte-identical to the MRI LS Spine macro shipped above
--   * MRI LS Spine with Whole Spine Screening / listhesis: byte-identical to the MRI LS Spine macro shipped above
--   * MRI LS Spine with Whole Spine Screening / screening_lesion: kept for review, not exposed: its own sentence places a [LEVEL] in the [cervical/dorsal] spine, but the examination's skeleton only carries lumbar disc levels, so every level this box could offer contradicts the region the sentence names. Converting it would need a second level vocabulary the catalogue does not have.
--   * MRI Cervical Spine with Whole Spine Screening / screening_lesion: the same sentence with the opposite gap — [LEVEL] offered from cervical headings (C2-C3…) while the owner's own bracket asks for the [dorsal/lumbosacral] spine
--
-- SAFETY CONTRACT (identical in both MRI files)
--   * `factory_key` is the identity, and it is namespaced by provenance: 'macro:<template>/<key>' for
--     a converted owner macro, 'authored:<region>/<concept>' for content this change wrote. The INSERT
--     skips any factory_key already present and any (study_type, label) clash, so re-running changes
--     nothing and no deploy ever doubles a box. The clash guard is also what protects the clinic: it
--     is the same key `radiology_quick_findings_legacy_study_label_uq` enforces, and every tab-scoped
--     row in this table spells study_type as its own tab name, so one guard covers both unique indexes.
--   * A clinic-customised box is never rewritten: these files only INSERT, never UPDATE, and
--     `customized_at` stays NULL on the rows they create.
--   * `study_tab_id` is stamped from the ledger's own tab by name, the way the shipped MR boxes are
--     stamped today, so the admin editor lists these boxes under the same region as its own.
--   * `anatomical_section` is empty on every box here. The Findings the composer writes is a flat
--     narrative of `<br/>`-separated sentences (measured on studies 264/265/268 on the acceptance rig:
--     no `White Matter:` or `Spinal Canal:` heading exists in an MRI report today), and
--     `sectionEndSlot` places a finding only at a heading whose label equals the box's section
--     case-folded — so a section naming a heading the report does not have is inert, and one naming a
--     heading it does have would seat the sentence in the wrong place. A level-parameterised sentence
--     is anchored to its own level line ("L4-L5: …") instead, which is how the shipped spine boxes
--     already work.
--   * `baseline_replaces` is only ever a sentence an app baseline module renders (checked against the
--     `baselines/*.ts` sources when this file was generated), so the box retires exactly the normal it
--     contradicts and leaves every other normal standing.
--   * Parameters: a box whose slots are all side/severity/level keeps `questions_json = '[]'` and is
--     filled by the strip's existing chip controls, which refuse an unfilled level with
--     "Nothing was applied — choose the level". Every other box declares its slots as required
--     questions, because a token the chips do not know and the box does not ask is a hole that refuses
--     forever. No question carries a default: no side, level, grade or measurement is ever assumed.
--     Measured before writing this: zero of the 496 shipped boxes carried a non-chip token without
--     declaring it, so this is the catalogue's existing rule, not a new one.
--   * Enhancement wording carries `{"requiresContrast":true}` in `properties`, which
--     `quickSelectContrastGate` honours: a study reported without contrast cannot offer it.
--   * Every level option comes from the segment's own skeleton headings, and disc levels are kept
--     distinct from vertebral bodies. No cervical sentence is offered lumbar levels.
--   * The DO block at the end is the count check: if any box was skipped by a guard — a label the
--     clinic already used, a factory_key already stamped — the deploy fails loudly instead of
--     shipping a silently short catalogue.
--
-- Generated by `scripts/generate-mri-macro-quick-select.mjs` from the migration-built database;
-- regenerate rather than hand-edit, so the counts below stay provable.
-- =============================================================================

BEGIN;

INSERT INTO radiology_quick_findings (
  study_type, label, field, scope_modality, category, concept, conflict_group,
  anatomical_section, baseline_replaces, properties, questions_json,
  finding_text, impression_text, technique_text, recommendation_text,
  sort_order, is_active, factory_key, study_tab_id
)
SELECT
  s.study_type, s.label, s.field, s.scope_modality, s.category, s.concept, s.conflict_group,
  s.anatomical_section, s.baseline_replaces, s.properties, s.questions_json,
  s.finding_text, s.impression_text, s.technique_text, s.recommendation_text,
  s.sort_order, s.is_active, s.factory_key,
  (select min(t.id) from radiology_study_tabs t where t.name = s.study_type)
FROM (VALUES
    ('Brain', 'Small-vessel ischaemic white matter change', 'findings', 'MR', 'abnormal', 'white_matter_lesions', 'white_matter_lesions', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI Brain Plain","macro":"white_matter_lesions"}', '[]', 'Multiple T2/FLAIR hyperintense white matter lesions noted in the periventricular and subcortical regions. Differential includes small vessel ischaemic change vs. demyelination.', 'White matter lesions, differential includes small vessel ischaemic change vs. demyelination.', '', '', 500, TRUE, 'macro:MRI Brain Plain/white_matter_lesions'),
    ('Brain', 'Midline shift with measurement', 'findings', 'MR', 'abnormal', 'midline', 'midline', '', 'No midline shift is seen.', '{"source":"structured_report_templates.macros_json","template":"MRI Brain Plain","macro":"midline_shift"}', '[{"key":"measurement","label":"Shift in millimetres","type":"text","options":[],"default":"","required":true,"sortOrder":0},{"key":"side","label":"Direction of shift","type":"select","options":["right","left"],"default":"","required":true,"sortOrder":1}]', 'Midline shift of approximately {measurement} mm to the {side} noted.', 'Midline shift of approximately {measurement} mm to the {side}.', '', '', 500, TRUE, 'macro:MRI Brain Plain/midline_shift'),
    ('Brain', 'Ring-enhancing lesion', 'findings', 'MR', 'abnormal', 'ring_enhancing_lesion', 'ring_enhancing_lesion', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI Brain With Contrast","macro":"ring_enhancing","requiresContrast":true}', '[{"key":"location","label":"Location","type":"text","options":[],"default":"","required":true,"sortOrder":0},{"key":"size","label":"Largest size in centimetres","type":"text","options":[],"default":"","required":true,"sortOrder":1}]', 'Ring-enhancing lesion with central necrosis noted in the {location}, measuring approximately {size} cm. Surrounding vasogenic oedema present. Differential includes glioblastoma multiforme, brain abscess or metastasis.', 'Ring-enhancing lesion with differential of glioblastoma multiforme, brain abscess or metastasis.', '', '', 500, TRUE, 'macro:MRI Brain With Contrast/ring_enhancing'),
    ('Brain', 'Meningeal enhancement', 'findings', 'MR', 'abnormal', 'meningeal_enhancement', 'meningeal_enhancement', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI Brain With Contrast","macro":"meningeal_enhancement","requiresContrast":true}', '[]', 'Diffuse pachymeningeal/leptomeningeal enhancement noted. Correlation with CSF analysis and clinical history advised.', 'Diffuse pachymeningeal/leptomeningeal enhancement.', '', '', 500, TRUE, 'macro:MRI Brain With Contrast/meningeal_enhancement'),
    ('Cervical Spine', 'Multilevel cervical spondylosis', 'findings', 'MR', 'abnormal', 'spondylotic_change', 'spondylotic_change', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI Cervical Spine","macro":"cervical_spondylosis"}', '[{"key":"levels","label":"Levels involved","type":"text","options":[],"default":"","required":true,"sortOrder":0},{"key":"severity","label":"Severity","type":"select","options":["mild","moderate","severe"],"default":"","required":true,"sortOrder":1}]', 'Multilevel cervical spondylosis with disc-osteophyte complexes at {levels}, causing {severity} canal stenosis.', 'Multilevel cervical spondylosis with {severity} canal stenosis at {levels}.', '', '', 500, TRUE, 'macro:MRI Cervical Spine/cervical_spondylosis'),
    ('LS Spine', 'Disc prolapse with nerve root compression', 'findings', 'MR', 'abnormal', 'disc_contour', 'disc_contour', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI LS Spine","macro":"disc_prolapse"}', '[{"key":"level","label":"Disc level","type":"select","options":["L1-L2","L2-L3","L3-L4","L4-L5","L5-S1"],"default":"","required":true,"sortOrder":0},{"key":"severity","label":"Severity","type":"select","options":["mild","moderate","severe"],"default":"","required":true,"sortOrder":1},{"key":"position","label":"Position of the prolapse","type":"select","options":["central","paracentral","foraminal"],"default":"","required":true,"sortOrder":2},{"key":"side","label":"Nerve root side","type":"select","options":["right","left","bilateral"],"default":"","required":true,"sortOrder":3}]', 'Posterior disc prolapse/herniation at {level} causing {severity} {position} canal stenosis with {side} nerve root compression.', 'Disc prolapse at {level} with {side} nerve root compression.', '', '', 500, TRUE, 'macro:MRI LS Spine/disc_prolapse'),
    ('LS Spine', 'Canal stenosis from three causes', 'findings', 'MR', 'abnormal', 'canal_stenosis', 'canal_stenosis', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI LS Spine","macro":"canal_stenosis","parameters":"chips"}', '[]', 'Moderate to severe spinal canal stenosis at {level} due to disc bulge, ligamentum flavum hypertrophy and facet joint arthropathy.', 'Moderate to severe spinal canal stenosis at {level}.', '', '', 500, TRUE, 'macro:MRI LS Spine/canal_stenosis'),
    ('LS Spine', 'Spondylolisthesis with its cause', 'findings', 'MR', 'abnormal', 'spondylolisthesis', 'spondylolisthesis', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI LS Spine","macro":"listhesis"}', '[{"key":"grade","label":"Grade","type":"select","options":["Grade I","Grade II","Grade III"],"default":"","required":true,"sortOrder":0},{"key":"level","label":"Vertebra that slipped","type":"select","options":["L1","L2","L3","L4","L5","S1"],"default":"","required":true,"sortOrder":1},{"key":"level_below","label":"Vertebra it slips over","type":"select","options":["L1","L2","L3","L4","L5","S1"],"default":"","required":true,"sortOrder":2},{"key":"association","label":"Associated change","type":"select","options":["bilateral pars defects","degenerative facet disease"],"default":"","required":true,"sortOrder":3}]', '{grade} spondylolisthesis of {level} over {level_below}, associated with {association}.', '{grade} spondylolisthesis of {level} over {level_below}.', '', '', 500, TRUE, 'macro:MRI LS Spine/listhesis'),
    ('Dorsal Spine', 'Vertebral compression fracture', 'findings', 'MR', 'abnormal', 'compression_fracture', 'compression_fracture', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI Dorsal Spine","macro":"compression_fracture"}', '[{"key":"level","label":"Vertebral level","type":"select","options":["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"],"default":"","required":true,"sortOrder":0},{"key":"height_loss","label":"Loss of height, per cent","type":"text","options":[],"default":"","required":true,"sortOrder":1},{"key":"age","label":"Age of the fracture","type":"select","options":["Acute","Subacute","Chronic"],"default":"","required":true,"sortOrder":2}]', 'Wedge compression fracture of {level} with {height_loss}% loss of height. {age} based on signal characteristics.', 'Wedge compression fracture of {level} with {height_loss}% loss of height.', '', '', 500, TRUE, 'macro:MRI Dorsal Spine/compression_fracture'),
    ('Dorsal Spine', 'Thoracic disc herniation', 'findings', 'MR', 'abnormal', 'disc_contour', 'disc_contour', '', '', '{"source":"structured_report_templates.macros_json","template":"MRI Dorsal Spine","macro":"disc_herniation"}', '[{"key":"level","label":"Disc level","type":"select","options":["T1-T2","T2-T3","T3-T4","T4-T5","T5-T6","T6-T7","T7-T8","T8-T9","T9-T10","T10-T11","T11-T12"],"default":"","required":true,"sortOrder":0},{"key":"severity","label":"Severity","type":"select","options":["mild","moderate","severe"],"default":"","required":true,"sortOrder":1},{"key":"cord_effect","label":"Effect on the cord","type":"select","options":["cord contact","cord compression"],"default":"","required":true,"sortOrder":2}]', 'Posterior disc herniation at {level} causing {severity} canal stenosis with {cord_effect}.', 'Disc herniation at {level} with {cord_effect}.', '', '', 500, TRUE, 'macro:MRI Dorsal Spine/disc_herniation')
) AS s(study_type, label, field, scope_modality, category, concept, conflict_group,
       anatomical_section, baseline_replaces, properties, questions_json,
       finding_text, impression_text, technique_text, recommendation_text,
       sort_order, is_active, factory_key)
WHERE NOT EXISTS (
        SELECT 1 FROM radiology_quick_findings q WHERE q.factory_key = s.factory_key
      )
  AND NOT EXISTS (
        SELECT 1 FROM radiology_quick_findings q
         WHERE lower(trim(q.study_type)) = lower(trim(s.study_type))
           AND lower(trim(q.label))      = lower(trim(s.label))
      );

-- EXACT COUNT, OR THE DEPLOY STOPS. 10 boxes, no fewer: one excluded by either guard above
-- means the clinic already owns that (study_type, label), and that has to be reconciled by hand rather
-- than resolved by an INSERT that quietly wrote fewer rows and reported success.
DO $do$
declare
  expected int := 10;
  actual int;
begin
  select count(*) into actual from radiology_quick_findings
   where factory_key in (
  'macro:MRI Brain Plain/white_matter_lesions',
  'macro:MRI Brain Plain/midline_shift',
  'macro:MRI Brain With Contrast/ring_enhancing',
  'macro:MRI Brain With Contrast/meningeal_enhancement',
  'macro:MRI Cervical Spine/cervical_spondylosis',
  'macro:MRI LS Spine/disc_prolapse',
  'macro:MRI LS Spine/canal_stenosis',
  'macro:MRI LS Spine/listhesis',
  'macro:MRI Dorsal Spine/compression_fracture',
  'macro:MRI Dorsal Spine/disc_herniation'
   );
  if actual <> expected then
    raise exception 'MRI Quick Select conversion incomplete (% of % boxes present). A (study_type, label) guard excluded at least one box, so reconcile it in the editor rather than deploying a short catalogue.',
      actual, expected;
  end if;
end
$do$;

COMMIT;
