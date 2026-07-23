-- Financial stabilization F1 — canonical settlement identifiers.
--
-- reference_number keeps ONE meaning (our merchant reference, e.g.
-- BILLPAY-<billId>-XXXXXX / booking ref) across all three settle paths;
-- gateway_txn_id stores the provider's transaction id (previously the S2S
-- webhook wrote it into reference_number, giving the webhook and the
-- callback/poll paths different idempotency keys for the SAME payment —
-- the double-posting vector).
--
-- settlement_status: captured | settled | superseded | refund_pending |
-- refunded | refund_failed (NULL for legacy/cash rows).
-- superseded_by: duplicate postings are voided by supersession (reversal
-- voucher REV-PAY-<id>), never deleted.
--
-- Filename starts with the stem of add_payment_idempotency_index.sql (the
-- existing (bill_id, reference_number) unique index) so it sorts after it.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "gateway_txn_id" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settlement_status" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "superseded_by" integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_bill_gateway_txn_uq
  ON payments (bill_id, gateway_txn_id)
  WHERE gateway_txn_id IS NOT NULL;
