-- Voucher query-path indexes for ledger / trial-balance / P&L / date filters.
-- Bills and payments already have created_at / status / patient_id / bill_id
-- indexes (add_performance_indexes, add_high_traffic_table_indexes, etc.).
-- Vouchers only had voucher_number / payment_id helpers — date and account
-- lookups were sequential scans. Idempotent; safe to re-run.

CREATE INDEX IF NOT EXISTS idx_vouchers_date
  ON vouchers (date);

CREATE INDEX IF NOT EXISTS idx_vouchers_type_date
  ON vouchers (type, date);

CREATE INDEX IF NOT EXISTS idx_vouchers_bill_id
  ON vouchers (bill_id)
  WHERE bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vouchers_debit_account_date
  ON vouchers (debit_account_id, date);

CREATE INDEX IF NOT EXISTS idx_vouchers_credit_account_date
  ON vouchers (credit_account_id, date);

-- Bare created_at for payment date-range reports that do not filter by method.
CREATE INDEX IF NOT EXISTS idx_payments_created_at
  ON payments (created_at);
