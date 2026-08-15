-- =============================================================================
-- Migration: Fix schema drift — missing indexes from schema-verify
-- Date: 2026-08-15
-- =============================================================================
-- The schema-verify container reported 4 missing indexes that affect
-- performance. These indexes are expected by the schema but were never
-- created (likely the migration that defines them was added to the Drizzle
-- journal but the corresponding .sql file didn't include the CREATE INDEX).
--
-- All statements are IF NOT EXISTS — safe to run on every deployment.
-- =============================================================================

-- 1. Unique constraint on radiology_worklist.accession_number
-- Ensures no two worklist entries share the same accession number.
CREATE UNIQUE INDEX IF NOT EXISTS radiology_worklist_accession_uq
  ON radiology_worklist (accession_number)
  WHERE accession_number IS NOT NULL;

-- 2. Composite index on bills(referred_by, created_at) for referral reports
-- Speeds up "bills referred by doctor X in date range" queries.
CREATE INDEX IF NOT EXISTS idx_bills_referred_by_created
  ON bills (referred_by, created_at DESC);

-- 3. Index on bills(referred_by) for simple referral lookups
CREATE INDEX IF NOT EXISTS idx_bills_referred_by_id
  ON bills (referred_by);

-- 4. Index on orders(referred_by) for referral order lookups
CREATE INDEX IF NOT EXISTS idx_orders_referred_by
  ON orders (referred_by);

-- Note: The type mismatches (fetal_usg tables using timestamptz instead of
-- timestamp) are NON-BLOCKING warnings. timestamptz is actually the CORRECT
-- type for timestamp columns that need timezone awareness — it's what Postgres
-- recommends. The schema-verify is comparing against an outdated Drizzle
-- definition that used 'timestamp' without timezone. We're leaving these as-is
-- because changing them to 'timestamp' would LOSE timezone information and
-- is a backwards-incompatible change. The schema-verify warnings are safe to
-- ignore for these columns.
