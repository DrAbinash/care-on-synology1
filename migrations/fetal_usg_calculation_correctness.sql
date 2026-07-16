-- Fetal USG calculation-correctness repair (PR A — see
-- docs/usg-reporting/fetal-usg-calculation-correction.md).
--
-- 1. Established-GA columns: gestational age is now established ONCE from
--    the most reliable dating source available (CRL/MSD/LMP/manual) and
--    held fixed, projected forward by elapsed calendar days at later
--    visits, instead of being re-derived from second/third-trimester
--    biometry formulas that were confirmed unreliable in any unit.
-- 2. calc_version on both tables: marks which calculation-engine version
--    produced the stored derived fields (gaWeeks/gaDays/edd/efw/
--    afiInterpretation/cervicalLengthInterpretation), so historical rows
--    computed by the pre-fix formulas can be distinguished from rows
--    computed by lib/obstetricCalculations.ts without silently rewriting
--    finalized historical data.
-- 3. AFI 4-quadrant inputs: a proper AFI can now be computed as the sum of
--    four explicit quadrant measurements rather than only accepting a
--    single, ungrounded typed-in total.
--
-- Safe to re-run: every clause uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE fetal_usg_studies ADD COLUMN IF NOT EXISTS established_ga_days INTEGER;
ALTER TABLE fetal_usg_studies ADD COLUMN IF NOT EXISTS established_ga_method VARCHAR(10);
ALTER TABLE fetal_usg_studies ADD COLUMN IF NOT EXISTS established_ga_date VARCHAR(20);
ALTER TABLE fetal_usg_studies ADD COLUMN IF NOT EXISTS established_edd VARCHAR(20);
ALTER TABLE fetal_usg_studies ADD COLUMN IF NOT EXISTS calc_version VARCHAR(10);

ALTER TABLE fetal_usg_measurements ADD COLUMN IF NOT EXISTS afi_q1 NUMERIC(4,1);
ALTER TABLE fetal_usg_measurements ADD COLUMN IF NOT EXISTS afi_q2 NUMERIC(4,1);
ALTER TABLE fetal_usg_measurements ADD COLUMN IF NOT EXISTS afi_q3 NUMERIC(4,1);
ALTER TABLE fetal_usg_measurements ADD COLUMN IF NOT EXISTS afi_q4 NUMERIC(4,1);
ALTER TABLE fetal_usg_measurements ADD COLUMN IF NOT EXISTS calc_version VARCHAR(10);

-- Historical policy: existing rows keep calc_version = NULL, meaning "computed
-- by the pre-fix formulas — do not trust gaWeeks/gaDays/edd/efw on this row
-- without review." Never backfilled/recalculated automatically — see the
-- historical-data policy in fetal-usg-calculation-correction.md. Finalized
-- reports referencing these rows are never altered by this migration; only
-- new saves going forward are computed (and versioned) by the corrected engine.
