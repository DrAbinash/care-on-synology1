-- =============================================================================
-- Fix H2: Referral Doctor Ledger — Performance Indexes
-- Bug #21 — query timeout as records grow past 50K
-- =============================================================================
--
-- IDEMPOTENCY NOTES:
--
-- bills.referred_by_id and orders.referred_by_id:
--   These columns do not exist in the base Drizzle migration (0000_dear_forge.sql).
--   They are wrapped in DO $$ blocks that check column existence before
--   creating the index. If the column is not present, the block exits
--   silently without error. This makes the migration safe on:
--     - fresh databases (column absent → skip)
--     - databases where the column was added later (column present → index created)
--
-- All other indexes reference columns that exist in the base schema.
-- They use CREATE INDEX IF NOT EXISTS and are always safe.
--
-- =============================================================================

-- ── idx_bills_referred_by_id ──────────────────────────────────────────────────
-- Doctor commission queries filter by referred_by_id and date range.
-- Conditional: only if the column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bills'
      AND column_name  = 'referred_by_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'bills'
        AND indexname  = 'idx_bills_referred_by_id'
    ) THEN
      CREATE INDEX idx_bills_referred_by_id
        ON bills (referred_by_id)
        WHERE referred_by_id IS NOT NULL;
      RAISE NOTICE 'Created idx_bills_referred_by_id';
    END IF;
  ELSE
    RAISE NOTICE 'bills.referred_by_id does not exist — skipping idx_bills_referred_by_id';
  END IF;
END $$;

-- ── idx_bills_referred_by_created ─────────────────────────────────────────────
-- Composite index for date-range commission queries.
-- Conditional: only if referred_by_id exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bills'
      AND column_name  = 'referred_by_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'bills'
        AND indexname  = 'idx_bills_referred_by_created'
    ) THEN
      CREATE INDEX idx_bills_referred_by_created
        ON bills (referred_by_id, created_at)
        WHERE referred_by_id IS NOT NULL;
      RAISE NOTICE 'Created idx_bills_referred_by_created';
    END IF;
  ELSE
    RAISE NOTICE 'bills.referred_by_id does not exist — skipping idx_bills_referred_by_created';
  END IF;
END $$;

-- ── idx_orders_referred_by ────────────────────────────────────────────────────
-- Doctor payout ledger (orders referred by doctor).
-- Conditional: only if referred_by_id exists on orders.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'orders'
      AND column_name  = 'referred_by_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'orders'
        AND indexname  = 'idx_orders_referred_by'
    ) THEN
      CREATE INDEX idx_orders_referred_by
        ON orders (referred_by_id)
        WHERE referred_by_id IS NOT NULL;
      RAISE NOTICE 'Created idx_orders_referred_by';
    END IF;
  ELSE
    RAISE NOTICE 'orders.referred_by_id does not exist — skipping idx_orders_referred_by';
  END IF;
END $$;

-- ── idx_order_tests_order_id ──────────────────────────────────────────────────
-- order_tests.order_id exists in 0000_dear_forge.sql — always safe.
CREATE INDEX IF NOT EXISTS idx_order_tests_order_id
  ON order_tests (order_id);

-- ── idx_patients_name_lower ───────────────────────────────────────────────────
-- Patient search by name — patients.first_name and last_name exist in base schema.
CREATE INDEX IF NOT EXISTS idx_patients_name_lower
  ON patients (LOWER(first_name || ' ' || last_name));
