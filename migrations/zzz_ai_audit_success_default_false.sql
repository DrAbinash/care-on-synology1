-- AI reporting audit log: an insert that never made a clinical-outcome claim must
-- not be filed as though it did.
--
-- The column means "the clinician was given usable text" (see
-- artifacts/api-server/src/lib/ai/aiAuditOutcome.ts, which is where every live
-- writer now derives it from). lib/db/src/schema/aiReporting.ts defaulted it to
-- TRUE, so a row that omitted the column — a hand-written row, a backfill, or a
-- code path added later that forgets it — silently filed a successful generation
-- nobody verified. That is the same failure this file's predecessor fixed for
-- `anonymized`, and the same reasoning applies: the safe value is the one that
-- makes no claim.
--
-- Every current writer passes `success` explicitly, so this is not a live bug
-- today. It is the guard behind them, and it is the half that #1099 could not do
-- without a migration: a default of true is fail-OPEN, and an audit trail whose
-- missing answer reads "success" is the one place a false positive costs the most.
--
-- Existing rows are deliberately NOT rewritten. They record what was filed at the
-- time, and editing audit history to make it look honest replaces one false claim
-- with another. The count of historical rows written with the old default is
-- answerable from `job_reference IS NULL` and belongs in a measured manifest, not
-- in an UPDATE here.
--
-- Naming: zzz_ sorts after every zz_schema_reconcile_*.sql, which is the file that
-- CREATEs this table on a database restored from a pre-AI backup. The default has
-- to be set after the table exists.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is a no-op once the column exists and
-- never rewrites an existing column's default; SET DEFAULT is idempotent.
--
-- Rollback (the reverse of this file, and the only statement needed):
--     ALTER TABLE IF EXISTS "ai_reporting_audit_logs"
--       ALTER COLUMN "success" SET DEFAULT true;
-- A rollback changes what a future insert that omits the column will claim; it
-- cannot restore any row, because this file never touched a row.

ALTER TABLE IF EXISTS "ai_reporting_audit_logs"
  ADD COLUMN IF NOT EXISTS "success" boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS "ai_reporting_audit_logs"
  ALTER COLUMN "success" SET DEFAULT false;
