-- Financial stabilization F2 — link each payment voucher to its payment.
--
-- payment_id gives real-time auto-vouchers and the sync-billing backfill ONE
-- shared dedup key (a voucher exists for payment p ⇔ a row with
-- payment_id = p.id), so sync stops re-vouchering payments that were already
-- vouchered at capture time (the desk-payment doubling), and prepaid
-- booking/kiosk payments can be vouchered at capture without being doubled by
-- a later sync. voucher.reference stays the bill number — Tally exports and
-- accountant reconciliation are unchanged.
--
-- Filename starts with the stem of zz_schema_reconcile_20260709.sql (which
-- creates the vouchers table) so it sorts after it by construction.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "payment_id" integer;

CREATE INDEX IF NOT EXISTS idx_vouchers_payment_id
  ON vouchers (payment_id)
  WHERE payment_id IS NOT NULL;
