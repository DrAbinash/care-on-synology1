-- =============================================================================
-- Referral / commission query indexes (real columns) + clear phantom verify noise
-- Date: 2026-08-17
-- =============================================================================
-- care-schema-verify reported these as missing:
--   idx_bills_referred_by_created, idx_bills_referred_by_id, idx_orders_referred_by
--
-- Those names were introduced by add_referral_indexes.sql /
-- zz_schema_reconcile_20260709.sql / zzzz_schema_drift_fix_indexes.sql against
-- bills.referred_by_id / orders.referred_by_id — columns that were NEVER added
-- to the Drizzle schema. Referring doctor lives on orders.doctor_id; bills reach
-- it via order_id (see docs/CARE_ERP_STABILIZATION_HANDOFF.md).
--
-- The DO $$ existence guards silently skip creating the phantom indexes, but
-- schema-verify still parses the CREATE INDEX lines and flags them missing.
--
-- This migration:
--   1. DROP INDEX IF EXISTS the three phantom names so verify stops expecting them
--   2. Creates the indexes that actually speed up referral/commission queries
-- =============================================================================

-- 1) Retire verifier expectations for indexes that can never exist without the
--    phantom referred_by_id columns. Safe no-ops if the indexes were never built.
DROP INDEX IF EXISTS idx_bills_referred_by_id;
DROP INDEX IF EXISTS idx_bills_referred_by_created;
DROP INDEX IF EXISTS idx_orders_referred_by;

-- 2) Real referral FK: orders.doctor_id
CREATE INDEX IF NOT EXISTS idx_orders_doctor_id
  ON orders (doctor_id)
  WHERE doctor_id IS NOT NULL;

-- Date-range commission / referral ledgers: doctor + created_at
CREATE INDEX IF NOT EXISTS idx_orders_doctor_created
  ON orders (doctor_id, created_at DESC)
  WHERE doctor_id IS NOT NULL;

-- 3) Bills → order join (referral reports transitively via order_id)
CREATE INDEX IF NOT EXISTS idx_bills_order_id
  ON bills (order_id);

-- Bill date-range scans joined to a referring doctor
CREATE INDEX IF NOT EXISTS idx_bills_order_created
  ON bills (order_id, created_at DESC);

-- 4) order_tests.order_id — also declared in add_referral_indexes.sql; ensure present
CREATE INDEX IF NOT EXISTS idx_order_tests_order_id
  ON order_tests (order_id);
