-- =============================================================
-- BACKFILL: Restore total_amount = original_total on all bills
-- that were refunded (where total_amount was incorrectly mutated).
--
-- SAFE: This is idempotent. Bills with no refund are unaffected.
-- Run ONCE after deploying the bills.ts refund fix.
-- =============================================================

BEGIN;

-- Restore total_amount for all refunded bills where it was mutated:
UPDATE bills
SET
  total_amount    = original_total,
  balance_amount  = GREATEST(0, original_total::numeric - paid_amount::numeric)
WHERE
  refund_amount::numeric > 0
  AND ABS(total_amount::numeric - original_total::numeric) > 0.01;

-- Verify: should return 0 rows after update
SELECT COUNT(*) AS remaining_drift
FROM bills
WHERE refund_amount::numeric > 0
  AND ABS(total_amount::numeric - original_total::numeric) > 0.01;

COMMIT;
