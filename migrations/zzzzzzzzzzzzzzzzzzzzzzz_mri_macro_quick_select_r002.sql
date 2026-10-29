-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r002.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- The MRI catalogues the owner asked for are not complete without content her macros do not cover: a
-- Dorsal Spine examination with NO MR-scoped findings box of its own at all (the wall was served only
-- by cross-modality "Spine" rows an X-ray request could equally be offered), and Brain checklist items
-- — meningioma, cerebellopontine angle, sellar/parasellar, mastoid — that neither the catalogue nor
-- `macros_json` carries.
--
-- 14 boxes are therefore NEWLY AUTHORED by this change, and every one of them says
-- so twice: `"newlyAuthored": true` and the reason it was needed in its own `properties` column, which
-- the Quick Select editor shows, and `authored:` in its `factory_key`, which no macro conversion writes
-- into. Nothing here is presented as the owner's approved language, and deleting any of these boxes
-- touches no converted macro box, because they share no identity.
--
-- The wording follows shapes her own catalogue already uses — a level or side is always a parameter the
-- radiologist answers, never a value baked into a sentence; no box states a measurement; "suggestive
-- of" is kept where a diagnosis is not certain. What each adds, and the gap it closes:
--   * [Dorsal Spine] Thoracic canal stenosis: 
--   * [Dorsal Spine] Thoracic cord compression: 
--   * [Dorsal Spine] Thoracic cord signal change: 
--   * [Dorsal Spine] Vertebral marrow oedema: 
--   * [Dorsal Spine] Focal vertebral body lesion: 
--   * [Dorsal Spine] Vertebral hemangioma: 
--   * [Dorsal Spine] Infective discitis: 
--   * [Dorsal Spine] Multilevel thoracic spondylotic change: 
--   * [Brain] Meningioma: 
--   * [Brain] Cerebellopontine angle lesion: 
--   * [Brain] Sellar and parasellar mass: 
--   * [Brain] Mastoid and middle ear change: 
--   * [Brain] Subacute infarct: 
--   * [Brain] Cerebellar atrophy: 
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
    ('Dorsal Spine', 'Thoracic canal stenosis', 'findings', 'MR', 'abnormal', 'canal_stenosis', 'canal_stenosis', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"The named dorsal requirement ''dorsal canal stenosis'' — no dorsal-scoped box existed at all, and the generic #20 ''Cord changes'' row is not MRI-scoped or level-specific.","parameters":"chips"}', '[]', 'Central canal stenosis at {level} due to disc-osteophyte change and ligamentum flavum hypertrophy, causing {severity} compression of the thoracic cord.', '{severity} thoracic canal stenosis at {level}.', '', '', 500, TRUE, 'authored:Dorsal Spine/canal_stenosis'),
    ('Dorsal Spine', 'Thoracic cord compression', 'findings', 'MR', 'abnormal', 'cord_compression', 'cord_compression', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''cord compression'' on the dorsal list; mirrors the owner''s own cervical #476 sentence, retargeted to the thoracic cord.","parameters":"chips"}', '[]', 'Thoracic cord compression at {level} with effacement of the posterior subarachnoid space.', 'Cord compression at {level}.', '', '', 500, TRUE, 'authored:Dorsal Spine/cord_compression'),
    ('Dorsal Spine', 'Thoracic cord signal change', 'findings', 'MR', 'abnormal', 'cord_signal', 'cord_signal', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''cord signal changes'' on the dorsal list; the owner''s cervical #68 sentence, with the cord named where it is.","parameters":"chips"}', '[]', 'Focal T2 hyperintense signal within the thoracic cord at {level}, consistent with myelopathic change.', 'Myelopathic signal change at {level}.', '', '', 500, TRUE, 'authored:Dorsal Spine/cord_signal'),
    ('Dorsal Spine', 'Vertebral marrow oedema', 'findings', 'MR', 'abnormal', 'marrow_oedema', 'marrow_oedema', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''marrow edema'' on the dorsal list; states oedema WITHOUT height loss, which is the finding that is not yet a fracture box."}', '[{"key":"vertebra","label":"Vertebra","type":"select","options":["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"],"default":"","required":true,"sortOrder":0}]', 'Marrow oedema signal is noted in {vertebra} with preserved vertebral body height.', 'Marrow oedema in {vertebra}.', '', '', 500, TRUE, 'authored:Dorsal Spine/marrow_oedema'),
    ('Dorsal Spine', 'Focal vertebral body lesion', 'findings', 'MR', 'abnormal', 'focal_lytic_lesion', 'focal_lytic_lesion', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''vertebral lesions'' on the dorsal list; deliberately says only that a lesion is present — no behaviour, no size, no assumption of what it is."}', '[{"key":"vertebra","label":"Vertebra","type":"select","options":["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"],"default":"","required":true,"sortOrder":0}]', 'A focal marrow-replacing lesion is noted in {vertebra}.', 'Focal vertebral body lesion at {vertebra}.', '', '', 500, TRUE, 'authored:Dorsal Spine/focal_lytic_lesion'),
    ('Dorsal Spine', 'Vertebral hemangioma', 'findings', 'MR', 'abnormal', 'hemangioma', 'hemangioma', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''hemangioma'' on the dorsal list; the owner''s own LS #427 sentence, level-tokenised and carried to the dorsal vocabulary."}', '[{"key":"vertebra","label":"Vertebra","type":"select","options":["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"],"default":"","required":true,"sortOrder":0}]', 'A vertebral hemangioma is noted at {vertebra}, with high T1 and T2 signal and no extra-osseous extension.', 'Vertebral hemangioma at {vertebra}.', '', '', 500, TRUE, 'authored:Dorsal Spine/hemangioma'),
    ('Dorsal Spine', 'Infective discitis', 'findings', 'MR', 'abnormal', 'discitis', 'discitis', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''infective / inflammatory'' on the dorsal list; ''suggestive of'' keeps it an impression to be confirmed, not a diagnosis the click asserts.","parameters":"chips"}', '[]', 'Endplate irregularity with adjacent marrow oedema and loss of disc signal at {level}, suggestive of infective discitis.', 'Changes suggestive of infective discitis at {level}.', '', '', 500, TRUE, 'authored:Dorsal Spine/discitis'),
    ('Dorsal Spine', 'Multilevel thoracic spondylotic change', 'findings', 'MR', 'abnormal', 'spondylotic_change', 'spondylotic_change', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''spondylotic changes'' on the dorsal list; the same sentence shape as the owner''s cervical spondylosis macro, so the two examinations stay distinguishable."}', '[{"key":"levels","label":"Levels involved","type":"text","options":[],"default":"","required":true,"sortOrder":0},{"key":"severity","label":"Severity","type":"select","options":["mild","moderate","severe"],"default":"","required":true,"sortOrder":1}]', 'Multilevel thoracic spondylotic change with disc-osteophyte complexes at {levels}, causing {severity} canal stenosis.', 'Multilevel thoracic spondylosis with {severity} canal stenosis at {levels}.', '', '', 500, TRUE, 'authored:Dorsal Spine/spondylotic_change'),
    ('Brain', 'Meningioma', 'findings', 'MR', 'abnormal', 'meningioma', 'meningioma', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"The 26-item Brain list names meningioma and nothing on the wall states it; #467 offers only an unqualified ''extra-axial fluid collection''. Enhancement is in the sentence, so the plain/contrast gate withholds it from a study without gadolinium.","requiresContrast":true}', '[{"key":"location","label":"Location","type":"text","options":[],"default":"","required":true,"sortOrder":0}]', 'An extra-axial, dural-based lesion is noted in the {location}, showing homogeneous enhancement with a dural tail, consistent with meningioma.', 'Extra-axial dural-based lesion consistent with meningioma.', '', '', 500, TRUE, 'authored:Brain/meningioma'),
    ('Brain', 'Cerebellopontine angle lesion', 'findings', 'MR', 'abnormal', 'cpa_lesion', 'cpa_lesion', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"CPA is on the list and absent from the catalogue. The side is asked for, never assumed.","parameters":"chips"}', '[]', 'A well-defined extra-axial lesion is noted in the {side} cerebellopontine angle, with widening of the internal auditory canal.', '{side} cerebellopontine angle lesion.', '', '', 500, TRUE, 'authored:Brain/cpa_lesion'),
    ('Brain', 'Sellar and parasellar mass', 'findings', 'MR', 'abnormal', 'sellar_lesion', 'sellar_lesion', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''sellar / parasellar'' is on the list and on no box. States mass effect only where the sentence says extension is present — the radiologist edits or does not click it."}', '[]', 'A sellar mass is noted with superior extension into the suprasellar cistern, indenting the optic chiasm.', 'Sellar mass with suprasellar extension.', '', '', 500, TRUE, 'authored:Brain/sellar_lesion'),
    ('Brain', 'Mastoid and middle ear change', 'findings', 'MR', 'abnormal', 'mastoid_change', 'mastoid_change', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''sinus / mastoid'' is on the list; #5 covers the paranasal sinuses only, and says nothing about the temporal bone.","parameters":"chips"}', '[]', 'T2 hyperintense mucosal change is noted in the {side} mastoid air cells and middle ear cleft.', '{side} mastoid and middle ear mucosal change.', '', '', 500, TRUE, 'authored:Brain/mastoid_change'),
    ('Brain', 'Subacute infarct', 'findings', 'MR', 'abnormal', 'subacute_infart', 'subacute_infart', '', '', '{"source":"newly-authored","newlyAuthored":true,"reason":"''subacute infarction'' is on the 26-item list; the wall offers acute (#48/#512), chronic (#489/#49) and lacunar (#504) but no subacute stage, and the owner''s macros stop at acute_infarct."}', '[{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"","required":true,"sortOrder":0},{"key":"territory","label":"Vascular territory","type":"select","options":["MCA","ACA","PCA","PICA","watershed"],"default":"","required":true,"sortOrder":1}]', 'T2/FLAIR hyperintense signal is noted in the {side} {territory} vascular territory, consistent with a subacute infarct.', 'Subacute infarct in the {side} {territory} vascular territory.', '', '', 500, TRUE, 'authored:Brain/subacute_infart'),
    ('Brain', 'Cerebellar atrophy', 'findings', 'MR', 'abnormal', 'cerebellar_atrophy', 'cerebellar_atrophy', '', 'Cerebellar hemispheres show normal morphology and signal intensity.', '{"source":"newly-authored","newlyAuthored":true,"reason":"''cerebral / cerebellar atrophy'' is on the list as two findings; #6 and #50 both describe the cerebrum, so the posterior fossa had no box of its own."}', '[]', 'Cerebellar atrophy is noted with prominent folia and enlargement of the vermian and paravermal cisterns.', 'Cerebellar atrophy.', '', '', 500, TRUE, 'authored:Brain/cerebellar_atrophy')
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

-- EXACT COUNT, OR THE DEPLOY STOPS. 14 boxes, no fewer: one excluded by either guard above
-- means the clinic already owns that (study_type, label), and that has to be reconciled by hand rather
-- than resolved by an INSERT that quietly wrote fewer rows and reported success.
DO $do$
declare
  expected int := 14;
  actual int;
begin
  select count(*) into actual from radiology_quick_findings
   where factory_key in (
  'authored:Dorsal Spine/canal_stenosis',
  'authored:Dorsal Spine/cord_compression',
  'authored:Dorsal Spine/cord_signal',
  'authored:Dorsal Spine/marrow_oedema',
  'authored:Dorsal Spine/focal_lytic_lesion',
  'authored:Dorsal Spine/hemangioma',
  'authored:Dorsal Spine/discitis',
  'authored:Dorsal Spine/spondylotic_change',
  'authored:Brain/meningioma',
  'authored:Brain/cpa_lesion',
  'authored:Brain/sellar_lesion',
  'authored:Brain/mastoid_change',
  'authored:Brain/subacute_infart',
  'authored:Brain/cerebellar_atrophy'
   );
  if actual <> expected then
    raise exception 'MRI Quick Select conversion incomplete (% of % boxes present). A (study_type, label) guard excluded at least one box, so reconcile it in the editor rather than deploying a short catalogue.',
      actual, expected;
  end if;
end
$do$;

COMMIT;
