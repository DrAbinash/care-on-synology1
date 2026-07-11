-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Duplicate Payment Prevention
-- File:      migrations/prepare_payment_uniqueness_index.sql
-- Purpose:   Add a unique partial index on payments(bill_id, reference_number)
--            to prevent the same gateway transaction from being recorded twice
--            (once by the gateway webhook, once manually by staff).
--
-- ⚠️  DO NOT EXECUTE AUTOMATICALLY.
-- ⚠️  Run ONLY after:
--     1. Checking Step 1 (impact assessment) below
--     2. Obtaining owner/admin approval
--     3. Scheduling a maintenance window
--     4. Backing up the database
--
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: IMPACT ASSESSMENT — RUN FIRST, BEFORE ANYTHING ELSE
-- Check whether any existing duplicate payment rows would block the index.
-- If this query returns any rows, those duplicates MUST be resolved before
-- the index can be created.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1a: Count duplicate (bill_id, reference_number) pairs
SELECT
  bill_id,
  reference_number,
  COUNT(*) AS duplicate_count,
  SUM(amount::numeric) AS total_amount,
  STRING_AGG(id::text, ', ' ORDER BY id) AS payment_ids,
  MIN(created_at) AS first_recorded,
  MAX(created_at) AS last_recorded
FROM payments
WHERE reference_number IS NOT NULL
GROUP BY bill_id, reference_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, total_amount DESC;

-- Step 1b: Total financial impact of duplicates
SELECT
  COUNT(*) AS duplicate_pair_count,
  SUM(pair_total) AS total_duplicate_amount
FROM (
  SELECT
    bill_id,
    reference_number,
    COUNT(*) AS count,
    SUM(amount::numeric) AS pair_total
  FROM payments
  WHERE reference_number IS NOT NULL
  GROUP BY bill_id, reference_number
  HAVING COUNT(*) > 1
) sub;

-- Step 1c: Sample of affected bills (for review)
SELECT
  p.bill_id,
  b.bill_number,
  p.reference_number,
  p.amount,
  p.method,
  p.recorded_by_name,
  p.created_at,
  p.notes
FROM payments p
JOIN bills b ON b.id = p.bill_id
WHERE p.reference_number IN (
  SELECT reference_number
  FROM payments
  WHERE reference_number IS NOT NULL
  GROUP BY bill_id, reference_number
  HAVING COUNT(*) > 1
)
ORDER BY p.bill_id, p.reference_number, p.created_at;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: RESOLVE DUPLICATES (if Step 1 found any)
-- For each duplicate group, keep the FIRST record (lowest id) and delete later ones.
-- Review the sample output from Step 1c before running this.
-- ─────────────────────────────────────────────────────────────────────────────

-- ⚠️  REVIEW CAREFULLY before running.
-- This deletes the LATER payment row in each duplicate pair.
-- If the later row was the "correct" one (e.g., the manual confirmation
-- was more accurate than the gateway row), swap the logic.

-- DELETE FROM payments
-- WHERE id IN (
--   SELECT id FROM (
--     SELECT
--       id,
--       ROW_NUMBER() OVER (
--         PARTITION BY bill_id, reference_number
--         ORDER BY id ASC  -- keep earliest row
--       ) AS rn
--     FROM payments
--     WHERE reference_number IS NOT NULL
--   ) ranked
--   WHERE rn > 1
-- );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: CREATE THE INDEX — run only after Step 1 returns zero rows
-- ─────────────────────────────────────────────────────────────────────────────

-- This is a UNIQUE PARTIAL INDEX. The WHERE clause means:
--   - Only rows where reference_number IS NOT NULL are covered.
--   - Cash payments (no reference_number) are NOT affected.
--   - If a gateway and a staff member both record the same txnRef on the same bill,
--     the second INSERT will raise a unique constraint violation — preventing the double-count.
--
-- The CONCURRENTLY option allows the index to build without locking the table.
-- ⚠️  CONCURRENTLY cannot run inside a transaction block — run it standalone.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  idx_payments_bill_ref_unique
ON payments (bill_id, reference_number)
WHERE reference_number IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: VERIFY
-- ─────────────────────────────────────────────────────────────────────────────

-- Confirm the index was created
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'payments'
  AND indexname = 'idx_payments_bill_ref_unique';


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK PLAN
-- If the index causes unexpected issues (e.g., legitimate multi-payment edge case
-- that uses the same referenceNumber for different purposes), drop it:
-- ─────────────────────────────────────────────────────────────────────────────

-- DROP INDEX CONCURRENTLY IF EXISTS idx_payments_bill_ref_unique;
