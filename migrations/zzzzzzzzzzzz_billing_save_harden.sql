-- Save & Print harden: prevent double active bills per order, and allow
-- client_ref reuse after cancel (offline queue / cancel-and-rebill).
-- Never rewinds sequences. Safe to re-run.

-- 1) Collapse accidental duplicate ACTIVE bills for the same order
--    (check-then-insert race before this unique index existed). Keep the
--    oldest row; cancel the rest so Due reports and desk guards stay sane.
UPDATE bills b
SET
  status = 'cancelled',
  cancelled_at = COALESCE(b.cancelled_at, NOW()),
  cancelled_by_name = COALESCE(b.cancelled_by_name, 'system'),
  cancellation_reason = COALESCE(
    NULLIF(b.cancellation_reason, ''),
    'auto: duplicate active bill for same order (zzzzzzzzzzzz_billing_save_harden)'
  ),
  balance_amount = '0.00',
  -- Free client_ref so cancel+rebill / queue replay can reuse the UUID.
  client_ref = NULL
WHERE b.status IS DISTINCT FROM 'cancelled'
  AND b.id IN (
    SELECT b2.id
    FROM bills b2
    WHERE b2.status IS DISTINCT FROM 'cancelled'
      AND EXISTS (
        SELECT 1
        FROM bills b3
        WHERE b3.order_id = b2.order_id
          AND b3.status IS DISTINCT FROM 'cancelled'
          AND b3.id < b2.id
      )
  );

-- 2) One active bill per order (cancelled + cancelled allowed).
CREATE UNIQUE INDEX IF NOT EXISTS bills_order_id_active_uidx
  ON bills (order_id)
  WHERE status IS DISTINCT FROM 'cancelled';

-- 3) client_ref unique only among non-cancelled bills.
--    Cancelled rows previously kept the UUID and blocked replay.
DROP INDEX IF EXISTS bills_client_ref_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS bills_client_ref_uidx
  ON bills (client_ref)
  WHERE client_ref IS NOT NULL AND status IS DISTINCT FROM 'cancelled';

-- 4) Also null out client_ref on already-cancelled bills that still hold one
--    (belt-and-suspenders with the partial index above).
UPDATE bills
SET client_ref = NULL
WHERE status = 'cancelled'
  AND client_ref IS NOT NULL;
