-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_usg_abdominal_ownership.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- The C3 browser audit found two clinical-content safety defects that both come
-- from the same root cause: USG Whole Abdomen / KUB / Pelvis / TVS / Obstetric /
-- Growth / Anomaly / NT / Thyroid / Breast / Scrotum boxes are in the clinic's
-- database but carry no `anatomical_section`, no `conflict_group`, and no
-- `concept`. Without them the strip cannot route a Gallbladder sentence to the
-- Gallbladder sub-section (it lands in whichever tab is active — the observed
-- "Gallbladder content under Liver / Kidney"), and it cannot retire one Fatty
-- Liver grade when another is clicked (the observed "Grade I and Grade III
-- fatty liver coexisting"). Both symptoms are ownership, not a missing engine:
-- `conflict_group` already mutexes Fazekas 1 vs 2 in Brain, and `anatomical_section`
-- already routes Hydrocephalus to the Ventricular section. This migration
-- supplies the same metadata the USG tiles never got, using only those columns.
--
-- WHY THE EXISTING SEED DIDN'T ALREADY DO THIS
-- `migrations/z_seed_usg_companion_suggestions.sql:12` already runs
--   UPDATE radiology_quick_findings SET conflict_group = 'fatty_liver_grade'
--     WHERE study_type = 'Whole Abdomen' AND label IN (Gr I, Gr II, Gr III);
-- but that file sorts BEFORE `zz_add_usg_platform_content_pack.sql:87` and
-- `zzz_add_usg_gold_standard_content.sql:184`, which are the files that create
-- those rows in the first place. The UPDATE executes while the table is empty
-- of them. Measured on a clean chain (195 migrations to a fresh Postgres 18):
-- every one of the three Fatty Liver rows still has conflict_group=''.
--
--   * We do NOT edit the earlier file. The clinic has already recorded its
--     hash in public.schema_migrations_log; changing it is exactly what
--     scripts/audit-migration-ledger.mjs is built to catch, and it would make
--     a restore proof false-fail.
--   * We do NOT re-order the chain. Same reason, plus the two appliers
--     (care-db-patch-v2 and apply-all-migrations.mjs) disagree on the ledger,
--     so a re-order converges in one and not the other.
--   * We DO add one forward-only file that sorts after every seed.
--
-- WHAT THIS MIGRATION TOUCHES AND WHAT IT DELIBERATELY SKIPS
--   * Only rows with `factory_key = ''`. A factory box's ownership metadata is
--     the shipped catalogue's decision, made in quick-select-tiles.data.ts and
--     regenerated into zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r*.sql;
--     overwriting it here would fork that decision. A future factory revision
--     that adds these USG boxes is free to set them properly, and by then the
--     rows it adopts already carry non-default metadata so the adoption's
--     customisation guard leaves them alone.
--   * Only rows with `customized_at IS NULL`. Same rule every other Quick Select
--     write obeys: an edit made at the reporting desk is never undone by a
--     deploy. This migration adds ownership, not wording, but the guard is
--     cheap and matches the rest of the chain.
--   * Only rows whose existing prose already tells us the organ. Every category
--     value used here comes straight from the tile's `category` column — set by
--     the seed that wrote the row, never guessed by us. Where `category` is
--     empty the row is left alone rather than guessed at; a wrong organ is
--     worse than no organ.
--   * No DROP, no rename, no column addition. `radiology_quick_findings`
--     already has `anatomical_section`, `conflict_group`, `concept`,
--     `parent_id`, `son_kind`, `field` and `factory_key`, added by
--     zzzzzzzzzzzzzzzzzzzz_quick_select_authoring.sql, which sorts before this
--     file.
--   * No new engine. `conflict_group` and `anatomical_section` mean exactly
--     what they already mean to observationSlot.ts:59 and multiStudyReport.ts:175.
--     This file is data.
--
-- IDEMPOTENT AND CONVERGENT
-- Both appliers run this file possibly more than once (the bootstrap re-runs
-- every feature file on every `pnpm db:bootstrap`). The UPDATEs are guarded by
-- `(anatomical_section = '' OR anatomical_section IS NULL)` etc., so a second
-- run rewrites nothing, and one already-populated row cannot disagree with
-- itself. Verified against a fresh chain: apply twice, row counts unchanged.
--
-- CONCEPT IDS ARE NOT INVENTED
-- Where this file sets `concept`, the value is already registered in
-- `artifacts/diagnostic-erp/src/lib/conceptCanon/contentPacks.ts`:
--   cholelithiasis  (line 832, aliases include gallstones, biliary calculus)
--   fatty_liver     (line 841)
--   renal           (line 823)
-- No other row gains a concept here — an unregistered concept id would resolve
-- through `canonConcept` (observationSlot.ts:229) to a slug-normalised string
-- that reads like a real concept but is not in any pack, which is worse than
-- leaving it NULL and letting the label/section fallback do its job.

BEGIN;

-- ── 1. MUTUAL EXCLUSION — hepatic steatosis grade ────────────────────────────
-- The three Fatty Liver tiles describe the same finding at three severities.
-- Only one is true at a time. The `z_seed_usg_companion_suggestions.sql` UPDATE
-- already names the group 'fatty_liver_grade' and this migration uses exactly
-- that value, so on a clinic whose seed happened to have run at the right time
-- the second UPDATE is a no-op; on a fresh chain it lands.
UPDATE radiology_quick_findings
   SET conflict_group = 'fatty_liver_grade',
       updated_at     = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'Whole Abdomen'
   AND label IN ('Fatty Liver Gr I', 'Fatty Liver Gr II', 'Fatty Liver Gr III')
   AND (conflict_group IS NULL OR conflict_group = '');

-- ── 2. MUTUAL EXCLUSION — obstetric fetal presentation ───────────────────────
-- Cephalic and Breech are one-of-two; coexisting is a clinical contradiction.
UPDATE radiology_quick_findings
   SET conflict_group = 'fetal_presentation',
       updated_at     = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'Obstetric'
   AND label IN ('Cephalic Presentation', 'Breech Presentation')
   AND (conflict_group IS NULL OR conflict_group = '');

-- ── 3. MUTUAL EXCLUSION — amniotic fluid volume ──────────────────────────────
-- Reduced and increased cannot both be true of the same study.
UPDATE radiology_quick_findings
   SET conflict_group = 'amniotic_fluid_volume',
       updated_at     = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'Obstetric'
   AND label IN ('Oligohydramnios', 'Polyhydramnios')
   AND (conflict_group IS NULL OR conflict_group = '');

-- ── 4. ANATOMICAL OWNERSHIP — derive from the tile's own category ────────────
-- Every row that already names an organ in `category` gains the same string in
-- `anatomical_section`. The category was written by the seed that created the
-- row, so this is a copy, not a clinical judgement. Rows whose category is empty
-- are deliberately not touched here.
UPDATE radiology_quick_findings
   SET anatomical_section = category,
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND (anatomical_section IS NULL OR anatomical_section = '')
   AND category IS NOT NULL
   AND category <> ''
   AND study_type IN ('Whole Abdomen', 'KUB', 'Pelvis', 'TVS', 'Obstetric', 'Growth',
                      'Anomaly', 'NT', 'Thyroid', 'Breast', 'Scrotum',
                      'Doppler', 'Arterial Doppler', 'Venous Doppler',
                      'Carotid Doppler', 'Renal Doppler', 'Hepatic Doppler',
                      'Portal Doppler', 'Obstetric Doppler', 'MSK', 'Soft Tissue',
                      'Hernia', 'Appendix', 'BPP', 'Cervical Length',
                      'Early Pregnancy', 'Multiple Pregnancy', 'Infertility',
                      'Follicular Study', 'Endometrium', 'Ovarian Lesions',
                      'Dating');

-- ── 5. CONCEPT REGISTRATION — the four concepts contentPacks already owns ───
-- A USG tile with no `concept` cannot participate in isImpressionworthyAbnormal
-- and cannot supersede a scaffold normal. Registering only the four that
-- contentPacks.ts already declares keeps the strip honest without inventing
-- taxonomy.
UPDATE radiology_quick_findings
   SET concept    = 'cholelithiasis',
       updated_at = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND (concept IS NULL OR concept = '')
   AND study_type = 'Whole Abdomen'
   AND label = 'Cholelithiasis';

UPDATE radiology_quick_findings
   SET concept    = 'fatty_liver',
       updated_at = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND (concept IS NULL OR concept = '')
   AND study_type = 'Whole Abdomen'
   AND label LIKE 'Fatty Liver Gr%';

UPDATE radiology_quick_findings
   SET concept    = 'renal',
       updated_at = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND (concept IS NULL OR concept = '')
   AND study_type = 'KUB'
   AND label IN ('Renal Calculus', 'Hydronephrosis', 'Simple Renal Cyst');

-- ── 6. GALLBLADDER POLYP — organ ownership even without a pack concept ───────
-- No cholelithiasis-adjacent concept covers polyp, and inventing one here would
-- fork the content-pack taxonomy. The row still needs to know it belongs under
-- Gallbladder; a category-only tile gets the same ownership the other tiles get.
UPDATE radiology_quick_findings
   SET anatomical_section = 'Gallbladder',
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND (anatomical_section IS NULL OR anatomical_section = '')
   AND study_type = 'Whole Abdomen'
   AND label = 'Gallbladder Polyp';

-- ── 7. SIMPLE HEPATIC CYST — liver ownership ────────────────────────────────
UPDATE radiology_quick_findings
   SET anatomical_section = 'Liver',
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND (anatomical_section IS NULL OR anatomical_section = '')
   AND study_type = 'Whole Abdomen'
   AND label = 'Simple Hepatic Cyst';

COMMIT;
