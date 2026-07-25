-- Settled-commission snapshot + two commission guard rails.
--
-- commission_payout_lines freezes the orders a payout settled, so adjusting a
-- slab later cannot rewrite a statement already handed to a doctor. Existing
-- payouts have no lines and keep behaving exactly as before (recomputed live)
-- until they are re-recorded.
CREATE TABLE IF NOT EXISTS commission_payout_lines (
  id                SERIAL PRIMARY KEY,
  payout_id         INTEGER NOT NULL,
  doctor_id         INTEGER NOT NULL,
  order_id          INTEGER NOT NULL,
  order_number      TEXT NOT NULL DEFAULT '',
  order_date        TEXT NOT NULL DEFAULT '',
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_commission  NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue           NUMERIC(12,2) NOT NULL DEFAULT 0,
  test_count        INTEGER NOT NULL DEFAULT 0,
  rule_summary      TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commission_payout_lines_payout_idx ON commission_payout_lines (payout_id);
CREATE INDEX IF NOT EXISTS commission_payout_lines_doctor_idx ON commission_payout_lines (doctor_id);
CREATE INDEX IF NOT EXISTS commission_payout_lines_order_idx  ON commission_payout_lines (order_id);

-- Maximum percentage any commission slab (or doctor profile default) may be set
-- to. 60% is a deliberately loose starting point that still blocks a typo;
-- 0 disables the check.
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS commission_max_percent NUMERIC(5,2) NOT NULL DEFAULT 60.00;

-- How far (in percentage points) a doctor's realised rate may fall below their
-- configured slab before the portal flags it. 0 disables the check.
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS commission_drift_alert_points NUMERIC(5,2) NOT NULL DEFAULT 10.00;
