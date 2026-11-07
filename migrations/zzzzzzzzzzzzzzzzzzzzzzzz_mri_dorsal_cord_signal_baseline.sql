-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzzz_mri_dorsal_cord_signal_baseline.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- The Dorsal Spine cord-signal box the clinic already owns is
-- `authored:Dorsal Spine/cord_signal` — "Thoracic cord signal change", written by
-- `zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r002.sql` when the dorsal examination had no
-- MR-scoped findings box of its own. It states the lesion and retires nothing: its
-- `baseline_replaces` column is the empty string, because that migration predates the owned
-- MRI Dorsal Spine standard normal (`baselines/mriDorsalStandardNormal.ts`), which is the report
-- that now prints
-- "Thoracic spinal cord and conus medullaris display normal caliber and uniform intrinsic
-- signal intensity." at the top of the same Findings section. Measured consequence: click that
-- box on a dorsal normal and the report says the cord is normal and abnormal in one section —
-- the P0 shape this product has been closing region by region.
--
-- WHY THIS FILE, AND NOT A NEW BOX IN THE SHIPPED CATALOGUE
-- The first attempt at the dorsal Quick Select catalogue added a shipped tile with the same
-- (study_type, label) as this authored box. `radiology_quick_findings` enforces that pair as a
-- unique index, and the factory seed (`zzzzz…_quick_select_factory_boxes_rNNN`, 21 `z`s) runs
-- BEFORE this authored box's migration (23 `z`s). Measured on a database bootstrapped from
-- scratch with that branch: the shipped twin took the label first, the authored box was skipped
-- by the (study_type, label) guard, and the macro migration's own exact-count guard then aborted
-- the whole bootstrap — "MRI Quick Select conversion incomplete (13 of 14 boxes present)" — so
-- every migration after it, including the Dorso-Lumbar baseline, never applied. At the clinic the
-- same collision resolves the other way round: the guard skips the *shipped* twin, so the box the
-- radiologist actually sees keeps the empty `baseline_replaces` and the fix never arrives. The
-- shipped tile has therefore been withdrawn, and the row the clinic already owns is corrected
-- here, which is what that guard's message asks for ("reconcile it … rather than deploying a
-- short catalogue").
--
-- SAFETY CONTRACT
--   * One column, one row, one identity: the UPDATE keys on `factory_key`, and touches
--     `baseline_replaces` and nothing else — not the sentence, not the level chip, not
--     `properties`, not `sort_order`, not `is_active`. The box keeps saying exactly what it says now.
--   * `coalesce(baseline_replaces, '') = ''` makes it a fill-in, never an overwrite: a value the
--     desk or a later authored change put there is left standing.
--   * `customized_at IS NULL` keeps a clinic-customised box the radiologist's, not this file's.
--   * The sentence is the shipped contract's own answer for `cord_signal`
--     (`mriDorsalBaselines.ts:53` → `DX_CANAL.cordNormal`, `mriDorsalLibrary.ts:153-154`), which is
--     the string the owned baseline renders for that anatomy. It is not new clinical prose, and
--     the "the wall's own dorsal cord-signal box retires the normal it falsifies" describe block in
--     `artifacts/diagnostic-erp/src/lib/zai-workspace/dorsalJointQuickSelectCatalogue.test.ts`
--     reads this file's literal straight out of these lines and pins it against that import, so
--     the two cannot drift apart silently.
--   * Forward-only and idempotent: re-running matches zero rows and changes nothing.
--   * A database where this box exists and is not customised must end with it stamped, so the
--     guard below fails loudly instead of reporting success on a short catalogue. A box the clinic
--     deleted, or customised by hand, is not required here and is not touched.

BEGIN;

UPDATE radiology_quick_findings
   SET baseline_replaces = 'Thoracic spinal cord and conus medullaris display normal caliber and uniform intrinsic signal intensity.'
 WHERE factory_key = 'authored:Dorsal Spine/cord_signal'
   AND coalesce(baseline_replaces, '') = ''
   AND customized_at IS NULL;

DO $do$
declare
  unstamped int;
begin
  select count(*) into unstamped
    from radiology_quick_findings
   where factory_key = 'authored:Dorsal Spine/cord_signal'
     and coalesce(baseline_replaces, '') = ''
     and customized_at IS NULL;
  if unstamped > 0 then
    raise exception 'The dorsal cord-signal box is still on the wall claiming no normal sentence (% row(s) unstamped) — a click there prints a contradiction in one Findings section.', unstamped;
  end if;
end
$do$;

COMMIT;
