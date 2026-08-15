-- Forward-sync bill_number_seq to MAX existing bill numeric suffix.
-- Same failure class as patient_id_seq lag: after SEQUENCE cutover, a stale
-- counter or pool-timeout mid-allocate can leave nextval colliding or the
-- desk failing on GET /api/bills/preview-number and Save & Print.
-- Never rewinds. Safe to re-run.

CREATE SEQUENCE IF NOT EXISTS bill_number_seq;

DO $$
DECLARE
  max_existing bigint := 0;
  seq_at bigint := 0;
  target bigint := 0;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE
        WHEN bill_number ~ '^[0-9]{6}[0-9]+$'
          THEN substring(bill_number from 7)::bigint
        WHEN bill_number ~ '^BILL-[0-9]{6}-[0-9]+$'
          THEN split_part(bill_number, '-', 3)::bigint
        ELSE NULL
      END
    ),
    0
  )
  INTO max_existing
  FROM bills;

  SELECT CASE
           WHEN is_called THEN last_value
           ELSE GREATEST(last_value - 1, 0)
         END
    INTO seq_at
    FROM bill_number_seq;

  target := GREATEST(max_existing, seq_at);

  IF target > 0 THEN
    PERFORM setval('bill_number_seq', target, true);
  ELSE
    PERFORM setval('bill_number_seq', 1, false);
  END IF;
END $$;
