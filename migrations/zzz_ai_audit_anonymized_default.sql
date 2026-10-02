-- AI reporting audit log: an insert that never made a privacy claim must not be
-- filed as though it did.
--
-- The column means "identifiers were actually removed from what left the clinic".
-- lib/db/src/schema/aiReporting.ts was changed to default it to false (#804) but
-- shipped without a migration file, so care-db-patch-v2 had nothing to apply and
-- live databases still carry DEFAULT true from lib/db/drizzle/0000_dear_forge.sql.
-- Every current insert site passes the flag explicitly, so this is not a live bug —
-- it is the guard behind it: a code path that forgets the column, a hand-written
-- row, or a backfill would each silently file a positive privacy record that nobody
-- verified, and CARE has no de-identification code to earn one.
--
-- Existing rows are deliberately NOT rewritten. They record what was filed at the
-- time, and editing audit history to make it look honest replaces one false claim
-- with another. A measured egress manifest is the fix for history.
--
-- Naming: zzz_ sorts after every zz_schema_reconcile_*.sql. A database restored
-- from a pre-AI backup is exactly where that reconcile file CREATEs this table, so
-- the default must be set after it, not before it.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is a no-op once the column exists and
-- never rewrites an existing column's default; SET DEFAULT is idempotent.

ALTER TABLE IF EXISTS "ai_reporting_audit_logs"
  ADD COLUMN IF NOT EXISTS "anonymized" boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS "ai_reporting_audit_logs"
  ALTER COLUMN "anonymized" SET DEFAULT false;
