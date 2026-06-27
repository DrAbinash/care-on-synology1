-- =============================================================================
-- Fix C2: ICICI Webhook Concurrent Duplicate Protection
-- Adds a unique partial index on payments(bill_id, reference_number) so that
-- even if two simultaneous webhook callbacks both pass the application-level
-- idempotency check, the database rejects the second INSERT with a 23505 error.
--
-- Partial index: only applies when reference_number IS NOT NULL (cash/offline
-- payments often have no reference number and should not be constrained).
--
-- Safe to re-run: CREATE UNIQUE INDEX IF NOT EXISTS
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_bill_reference_uq
  ON payments (bill_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- Also index payment_logs for faster idempotency lookups
CREATE INDEX IF NOT EXISTS idx_payment_logs_booking_ref
  ON payment_logs (booking_ref);
