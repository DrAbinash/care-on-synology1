-- =============================================================================
-- Migration: Fix schema drift — missing indexes from schema-verify
-- Date: 2026-08-15
-- =============================================================================
-- The schema-verify container reported 4 missing indexes that affect
-- performance. These indexes are expected by the schema but were never
-- created (likely the migration that defines them was added to the Drizzle
-- journal but the corresponding .sql file didn't include the CREATE INDEX).
--
-- IMPORTANT: bills/orders referral indexes must target referred_by_id (not
-- referred_by — that column does not exist on those tables). Match the
-- existence-guarded pattern in add_referral_indexes.sql so clean CI Postgres
-- boots do not hard-stop when the column is absent.
--
-- IMPORTANT (accession): Do NOT recreate radiology_worklist_accession_uq.
-- Startup migrations (artifacts/api-server/src/index.ts) intentionally DROP
-- that unique index because real DICOM AccessionNumber values can repeat
-- (e.g. a referring doctor's name "DR.A.K.SINGH MCH" pushed by a misconfigured
-- modality). study_instance_uid is the unique key; accession is a non-unique
-- lookup index (radiology_worklist_accession_idx). Re-adding UNIQUE hard-stops
-- care-db-patch-v2 on production data that already has duplicates.
-- =============================================================================

-- 1. Non-unique lookup index on radiology_worklist.accession_number
-- (matches Drizzle radiologyWorklist.ts + startup migration).
DROP INDEX IF EXISTS radiology_worklist_accession_uq;
CREATE INDEX IF NOT EXISTS radiology_worklist_accession_idx
  ON radiology_worklist (accession_number);

-- 2. Composite index on bills(referred_by_id, created_at) for referral reports
-- Speeds up "bills referred by doctor X in date range" queries.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bills'
      AND column_name  = 'referred_by_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_bills_referred_by_created
      ON bills (referred_by_id, created_at DESC)
      WHERE referred_by_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'bills.referred_by_id does not exist — skipping idx_bills_referred_by_created';
  END IF;
END $$;

-- 3. Index on bills(referred_by_id) for simple referral lookups
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bills'
      AND column_name  = 'referred_by_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_bills_referred_by_id
      ON bills (referred_by_id)
      WHERE referred_by_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'bills.referred_by_id does not exist — skipping idx_bills_referred_by_id';
  END IF;
END $$;

-- 4. Index on orders(referred_by_id) for referral order lookups
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'orders'
      AND column_name  = 'referred_by_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_orders_referred_by
      ON orders (referred_by_id)
      WHERE referred_by_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'orders.referred_by_id does not exist — skipping idx_orders_referred_by';
  END IF;
END $$;

-- Note: The type mismatches (fetal_usg tables using timestamptz instead of
-- timestamp) are NON-BLOCKING warnings. timestamptz is actually the CORRECT
-- type for timestamp columns that need timezone awareness — it's what Postgres
-- recommends. The schema-verify is comparing against an outdated Drizzle
-- definition that used 'timestamp' without timezone. We're leaving these as-is
-- because changing them to 'timestamp' would LOSE timezone information and
-- is a backwards-incompatible change. The schema-verify warnings are safe to
-- ignore.
