-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_mri_quickselect_section_vocabulary.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- `anatomical_section` is not a label. `pathologyPatch.ts` places a Quick Select
-- sentence by finding the Findings heading whose label equals the declared section
-- (`sectionEndSlot`, and its own comment: "The heading label must equal the
-- declared section, case-folded"). Where no heading matches, the section is not
-- used and the sentence falls back to the seat of whatever normal it retired — so
-- a wrong spelling is a finding printed under the wrong heading, which is exactly
-- the failure class #1226 was opened for.
--
-- Measured on the acceptance rig at f96d92f1, comparing every MRI box's declared
-- section against the headings of the MRI report skeleton it is clicked into
-- (`structured_report_templates.sections_json.findingsItems[].label`, seeded from
-- `artifacts/api-server/src/routes/structuredReportTemplates.ts`):
--
--   MRI Brain Plain    headings: Brain Parenchyma, White Matter,
--                                Ventricles & CSF Spaces, Basal Ganglia & Thalami,
--                                Brainstem, Cerebellum, Extra-Axial Spaces,
--                                Diffusion (DWI/ADC), Vascular Structures,
--                                Skull & Calvarium
--     #481 "Acute hemorrhage"          declares "basal ganglia"    -> no heading
--     #498 "Basal ganglia hemorrhage"  declares "basal ganglia"    -> no heading
--     #512 "Acute infarct (DWI)"       declares "mca"              -> no heading
--   MRI Cervical Spine headings: Alignment & Curvature, Craniovertebral Junction,
--                                C2-C3 … C7-T1, Vertebral Bodies,
--                                Facet Joints / Uncovertebral, Spinal Canal,
--                                Spinal Cord, Paraspinal Soft Tissues
--     #65 "Canal Stenosis", #66 "Foraminal Narrowing", #72 "Disc Bulge"
--                                       declare "{level}"           -> no heading
--     #70 "OPLL"                        declares "C2-C3 to C6-C7"   -> no heading
--   MRI LS Spine       headings: Alignment & Curvature, L1-L2 … L5-S1,
--                                Vertebral Bodies, Facet Joints, Ligamentum Flavum,
--                                Spinal Canal, Cord / Cauda Equina,
--                                Paraspinal Soft Tissues
--     #71 "Disc Bulge"                  declares "{level}"          -> no heading
--
-- Two defects, not one:
--
--   1. Placement. Those eight boxes could never be routed by their section, so
--      their sentence landed wherever a retired normal happened to sit.
--   2. The chip bar. The anatomy chips ARE `groupByAnatomy(anatomical_section)`
--      keys, so the wall on a cervical and a lumbar study rendered a chip whose
--      visible label was the literal text "{level}", and "mca" / "basal ganglia"
--      sat beside "White Matter" / "Brain Parenchyma" in the same row of controls.
--      An unresolved placeholder presented as a control is what the reporting rules
--      refuse, and a lower-case slug matching no heading is what this file fixes.
--
-- WHAT THIS MIGRATION TOUCHES
--   * Five rows, each matched by study type, label AND the exact section string it
--     currently holds. A box the clinic has re-curated is left alone, and no row of
--     any other study type (CT, USG, X-ray, Doppler) is in range of these predicates.
--   * `{level}` boxes are cleared rather than renamed (`anatomical_section` is
--     NOT NULL with default '' on this table, so "cleared" is written as ''). Their
--     level is chosen in the questions dialog at click time, so no fixed heading is
--     theirs; the engine already anchors a level-parameterised sentence to the
--     matching level line (`LINE_LEVEL_PREFIX` in `pathologyPatch.ts`), which is where
--     a bulge belongs.
--     Clearing the column also removes the `{level}` chip, and the box stays on the
--     wall either way, because a tile that declares no anatomy is offered under every
--     chip and under none.
--   * "C2-C3 to C6-C7" becomes "Spinal Canal", which is what ossification of the
--     posterior longitudinal ligament narrows.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- An earlier revision of this file also renamed #481/#498's "basal ganglia" and
-- #512's "mca" to the skeleton's heading labels. That was wrong on the merits and
-- it broke the build. `pathologyPatch.ts` places a sentence by TWO routes: only
-- `sectionEndSlot` compares a heading to the declared section case-folded and
-- equal, while `ANATOMY_ALIASES` resolves "basal ganglia" and "mca" against the
-- heading TEXT (/basal ganglia|putamen|caudate|globus pallidus|internal capsule/i
-- and /mca|middle cerebral/i, both of which match "Basal Ganglia & Thalami:"
-- and "Diffusion (DWI/ADC):"), so those two slugs already land in their own
-- section. Meanwhile #481/#498/#512 are factory rows: the shipped seed rewrites
-- their `anatomical_section` from `quick-select-tiles.data.ts`, so overriding them
-- here meant every re-apply of the seed churned `updated_at` — precisely the
-- idempotency §5 of the migration smoke asserts — and the committed C3 metadata
-- baseline, which knows the slugs, read the rename as scopes losing their
-- declared section.
--   * No DROP, no new column, no prose change. Every column used exists since
--     `zzzzzzzzzzzzzzzzzzzz_quick_select_authoring.sql`.
--
-- DURABLE AGAINST RE-SEEDING
-- Every row this file still corrects is one the shipped seed does NOT own — a
-- clinic row or an older-seed row whose `factory_key` no current tile data
-- regenerates — so re-applying a factory revision leaves it alone. That is the
-- rule for whether a section spelling may live in a migration at all: if the seed
-- writes the column, the seed has to carry the value. `care-db-patch-v2` applies
-- each filename once at the clinic and `apply-all-migrations.mjs` replays them in
-- filename order on a fresh database; the ERP-side contract test asserts the
-- renamed spellings do not reappear and that no factory row is rewritten here.
-- =============================================================================

BEGIN;

-- Cervical: the three boxes whose level the radiologist chooses when clicking, and
-- OPLL, which narrows the canal.
UPDATE radiology_quick_findings
   SET anatomical_section = '',
       updated_at = now()
 WHERE is_active
   AND study_type = 'Cervical Spine'
   AND label = 'Canal Stenosis'
   AND anatomical_section = '{level}';

UPDATE radiology_quick_findings
   SET anatomical_section = '',
       updated_at = now()
 WHERE is_active
   AND study_type = 'Cervical Spine'
   AND label = 'Foraminal Narrowing'
   AND anatomical_section = '{level}';

UPDATE radiology_quick_findings
   SET anatomical_section = '',
       updated_at = now()
 WHERE is_active
   AND study_type = 'Cervical Spine'
   AND label = 'Disc Bulge'
   AND anatomical_section = '{level}';

UPDATE radiology_quick_findings
   SET anatomical_section = 'Spinal Canal',
       updated_at = now()
 WHERE is_active
   AND study_type = 'Cervical Spine'
   AND label = 'OPLL'
   AND anatomical_section = 'C2-C3 to C6-C7';

-- Lumbar: the same level-parameterised bulge box on the LS strip.
UPDATE radiology_quick_findings
   SET anatomical_section = '',
       updated_at = now()
 WHERE is_active
   AND study_type = 'LS Spine'
   AND label = 'Disc Bulge'
   AND anatomical_section = '{level}';

COMMIT;
