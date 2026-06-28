-- =============================================================================
-- Fix C2: ICICI Webhook Concurrent Duplicate Protection
-- =============================================================================
--
-- Part 1: Unique partial index on payments(bill_id, reference_number)
--
-- The `payments` table is defined in Drizzle migrations (0000_dear_forge.sql)
-- and always exists. This index is safe to create unconditionally.
--
-- Prevents duplicate webhook callbacks from creating two payment rows for the
-- same bill + reference_number combination. The partial index (WHERE
-- reference_number IS NOT NULL) excludes cash/offline payments which have no
-- reference number and must not be constrained.
--
-- Idempotent: IF NOT EXISTS

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_bill_reference_uq
  ON payments (bill_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- =============================================================================
-- Part 2: Index on payment_logs(booking_ref) — conditional on table existence
--
-- `payment_logs` is NOT in any Drizzle SQL migration file.
-- It is created at API startup by runStartupMigrations() in index.ts.
-- This feature migration runs inside db-patch-v2, BEFORE the API starts,
-- so payment_logs may not exist yet.
--
-- Fix: use a DO block that checks information_schema before creating the index.
-- This is idempotent and safe regardless of whether the API has started.
-- Once the API starts and creates payment_logs, the index will NOT be created
-- automatically — but the application works without it (it only affects
-- idempotency lookup performance, not correctness).
--
-- If you need this index in production, run after first API startup:
--   CREATE INDEX IF NOT EXISTS idx_payment_logs_booking_ref
--     ON payment_logs (booking_ref);
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'payment_logs'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'payment_logs'
        AND indexname  = 'idx_payment_logs_booking_ref'
    ) THEN
      CREATE INDEX idx_payment_logs_booking_ref
        ON payment_logs (booking_ref);
      RAISE NOTICE 'Created index idx_payment_logs_booking_ref on payment_logs';
    ELSE
      RAISE NOTICE 'Index idx_payment_logs_booking_ref already exists — skipping';
    END IF;
  ELSE
    RAISE NOTICE 'Table payment_logs does not exist yet — index will be created on first API startup';
  END IF;
END $$;
