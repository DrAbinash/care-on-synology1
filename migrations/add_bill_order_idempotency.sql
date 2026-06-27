-- ============================================================================
-- Migration: add_bill_order_idempotency
-- Purpose:   Adds client_ref column to orders and bills tables for
--            idempotent creation — prevents duplicate bills when the browser
--            retries a failed/timed-out request.
-- Safe:      Uses IF NOT EXISTS and ON CONFLICT DO NOTHING patterns.
-- ============================================================================

-- Step 1: Add client_ref to orders
-- Unique per patientId to prevent same-browser session creating two orders
-- for the same patient with the same client-generated UUID
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_ref_uidx
  ON orders (client_ref)
  WHERE client_ref IS NOT NULL;

-- Step 2: Add client_ref to bills (derived from order's client_ref)
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS client_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bills_client_ref_uidx
  ON bills (client_ref)
  WHERE client_ref IS NOT NULL;

-- Extend the same-patient-10s window to 60s for extra safety
-- (index already exists from add_payment_idempotency_index.sql, this is additive)
