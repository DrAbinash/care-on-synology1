-- =============================================================================
-- Fix H2: Referral Doctor Ledger Missing Index
-- Bug #21 — query timeout as records grow past 50K
-- All CREATE INDEX IF NOT EXISTS — safe to re-run
-- =============================================================================

-- Doctor commission queries filter by referred_by_id and date range
CREATE INDEX IF NOT EXISTS idx_bills_referred_by_id
  ON bills (referred_by_id)
  WHERE referred_by_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_referred_by_created
  ON bills (referred_by_id, created_at)
  WHERE referred_by_id IS NOT NULL;

-- Doctor payout ledger (orders referred by doctor)
CREATE INDEX IF NOT EXISTS idx_orders_referred_by
  ON orders (referred_by_id)
  WHERE referred_by_id IS NOT NULL;

-- Order tests linked to referral commission calculations
CREATE INDEX IF NOT EXISTS idx_order_tests_order_id
  ON order_tests (order_id);

-- Patient search by name (slow on large datasets without this)
CREATE INDEX IF NOT EXISTS idx_patients_name_lower
  ON patients (LOWER(first_name || ' ' || last_name));
