-- =============================================================================
-- Migration: referral commission payment-aware eligibility.
--
-- Adds the clinic-level eligibility policy config to clinic_settings, and a
-- self-contained, append-only audit trail of commission hold/release
-- transitions (commission_status_events).
--
-- Idempotent DDL-add only — no DROP / DELETE / UPDATE. Soft references only
-- (order_id / doctor_id / bill_id are plain integers, no FK), so alphabetical
-- ordering is irrelevant (named zzzz_* to sort last). clinic_settings already
-- exists (created by an earlier Drizzle/consolidated migration), so the ADD
-- COLUMNs are safe.
-- =============================================================================

-- ── Config: which condition makes a calculated commission payable ────────────
-- 'bill_created' | 'report_finalized' | 'report_delivered' |
-- 'min_amount_collected' | 'full_payment_collected' | 'collected_ge_commission'
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS commission_eligibility_policy TEXT NOT NULL DEFAULT 'full_payment_collected';
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS commission_eligibility_min_amount NUMERIC(10,2) NOT NULL DEFAULT '0';

-- ── Append-only hold/release audit trail ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_status_events (
  id                serial PRIMARY KEY,
  order_id          integer      NOT NULL,
  doctor_id         integer      NOT NULL,
  bill_id           integer,
  commission_amount numeric(10,2) NOT NULL DEFAULT '0',
  old_status        text,                       -- null on first observation
  new_status        text         NOT NULL,      -- 'on_hold' | 'eligible'
  policy            text         NOT NULL,       -- policy in force at the transition
  reason            text,                        -- e.g. "Outstanding dues Rs.700"
  created_at        timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_status_events_order_idx  ON commission_status_events (order_id);
CREATE INDEX IF NOT EXISTS commission_status_events_doctor_idx ON commission_status_events (doctor_id);
CREATE INDEX IF NOT EXISTS commission_status_events_bill_idx   ON commission_status_events (bill_id);
CREATE INDEX IF NOT EXISTS commission_status_events_created_idx ON commission_status_events (created_at);
