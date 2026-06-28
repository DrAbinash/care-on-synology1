-- =============================================================================
-- Fix C2: ICICI Webhook Concurrent Duplicate Protection
-- =============================================================================
--
-- Adds a unique partial index on payments(bill_id, reference_number) so that
-- even if two simultaneous webhook callbacks both pass the application-level
-- idempotency check, the database rejects the second INSERT with a 23505 error.
--
-- Partial index: only applies when reference_number IS NOT NULL (cash/offline
-- payments have no reference number and must not be constrained).
--
-- The `payments` table is defined in 0000_dear_forge.sql and always exists.
--
-- Idempotent: IF NOT EXISTS — safe to run on every deployment.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_bill_reference_uq
  ON payments (bill_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- NOTE: idx_payment_logs_booking_ref is intentionally NOT created here.
-- `payment_logs` is created by the API at startup (runStartupMigrations in
-- index.ts), which runs AFTER this migration. Creating that index here would
-- fail on any fresh deployment because payment_logs does not exist yet.
-- The index is created by the API startup code directly.
