-- =============================================================================
-- Migration: Add performance indexes on bills and payments tables
-- Audit Issue: HIGH-08 | Date: 2026-06-26
-- =============================================================================
-- These indexes prevent full-table scans on the most frequently-queried columns.
-- =============================================================================

-- Composite index for the outstanding-dues SUM query:
--   WHERE status IN ('pending','partial') AND balance_amount::numeric > 0
CREATE INDEX IF NOT EXISTS idx_bills_status_balance
  ON bills (status, balance_amount);

-- Index for per-bill payment lookups and daily summary payment rollups
CREATE INDEX IF NOT EXISTS idx_payments_bill_id_created
  ON payments (bill_id, created_at);

-- Index for MAX(bill_number) used by generateBillNumber() on every new bill
CREATE INDEX IF NOT EXISTS idx_bills_bill_number
  ON bills (bill_number);

-- Index for date-range queries on bills (daily summary, reports)
CREATE INDEX IF NOT EXISTS idx_bills_created_at
  ON bills (created_at);

-- Index for voucher sequence query (nextVoucherNumber COUNT LIKE 'RV-202606-%')
CREATE INDEX IF NOT EXISTS idx_vouchers_number_prefix
  ON vouchers (voucher_number);
