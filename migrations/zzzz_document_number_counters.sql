-- Atomic document number allocation via PostgreSQL SEQUENCE (nextval).
-- Replaces MAX(...)+1 under a global advisory lock. nextval does not hold a
-- transaction-scoped lock, so concurrent desk saves no longer serialize on
-- bill/order number allocation for the duration of the insert transaction.

CREATE SEQUENCE IF NOT EXISTS bill_number_seq;

-- Seed from the highest numeric suffix already issued (global sequence).
DO $$
DECLARE
  seed bigint;
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
  INTO seed
  FROM bills;

  IF seed > 0 THEN
    PERFORM setval('bill_number_seq', seed, true);  -- next nextval = seed+1
  ELSE
    PERFORM setval('bill_number_seq', 1, false);     -- next nextval = 1
  END IF;
END $$;

-- Per-month order sequences are created on demand by next_order_number_seq().
-- Seed this month's sequence from existing ORD-YYYYMM-#### rows.
CREATE OR REPLACE FUNCTION next_order_number_seq(p_yyyymm text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'order_number_seq_' || p_yyyymm;
  n bigint;
BEGIN
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO n;
  RETURN n;
END;
$$;

DO $$
DECLARE
  yyyymm text := to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM');
  seq_name text := 'order_number_seq_' || yyyymm;
  seed bigint;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE
        WHEN split_part(order_number, '-', 3) ~ '^[0-9]+$'
          THEN split_part(order_number, '-', 3)::bigint
        ELSE NULL
      END
    ),
    0
  )
  INTO seed
  FROM orders
  WHERE order_number LIKE 'ORD-' || yyyymm || '-%';

  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
  IF seed > 0 THEN
    EXECUTE format('SELECT setval(%L, %s, true)', seq_name, seed);
  ELSE
    EXECUTE format('SELECT setval(%L, 1, false)', seq_name);
  END IF;
END $$;
