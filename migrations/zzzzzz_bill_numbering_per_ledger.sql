-- Per-book (per-ledger) bill numbering.
--
-- Bill numbers are printed as YYYYMM + a 4-digit suffix. Until now that suffix
-- came from ONE global sequence shared by every book, so the number belonged to
-- the installation rather than to the register that printed it: a book could
-- never be restarted at 0001, because 0001 was long since consumed by whichever
-- book happened to bill first.
--
-- Here every book gets its own sequence and uniqueness moves from bill_number
-- alone to (ledger_id, bill_number). The printed format is unchanged; numbers
-- are unique and monotonic within a book. The same printed number can therefore
-- exist in two different books, which is what physical registers imply — so any
-- lookup keyed on bill_number alone must be ledger-scoped or fail loudly
-- (barcode-resolver.ts, billPaymentLinks.ts, studioWorklistBillJoin.ts).
--
-- ledger_id NULL is the default book: matchLedger() in routes/ledgers.ts has
-- always treated "id=1 also matches NULL (legacy rows)", so backfilling NULL ->
-- 1 makes the column honest without moving a single bill to a different book.

-- ── 1. bills.ledger_id is the numbering bucket, so it must always be present ──
UPDATE "bills" SET "ledger_id" = 1 WHERE "ledger_id" IS NULL;

ALTER TABLE "bills" ALTER COLUMN "ledger_id" SET DEFAULT 1;
ALTER TABLE "bills" ALTER COLUMN "ledger_id" SET NOT NULL;

-- ── 2. per-book allocator ────────────────────────────────────────────────────
-- Created on demand (CREATE SEQUENCE IF NOT EXISTS) exactly like
-- next_order_number_seq() creates monthly order sequences, so a book added
-- after this migration needs no further DDL.
--
-- A never-yet-used sequence is seeded from the highest number THAT BOOK already
-- printed. Without the seed, cutover from the global sequence would hand book 1
-- suffix 1 again and collide with the bills it printed under the old regime.
CREATE OR REPLACE FUNCTION next_bill_number_seq(p_ledger integer)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'bill_number_seq_l' || p_ledger::text;
  max_existing bigint := 0;
  is_fresh boolean := false;
  n bigint;
BEGIN
  IF p_ledger IS NULL OR p_ledger < 1 THEN
    RAISE EXCEPTION 'next_bill_number_seq: ledger id must be a positive integer, got %', p_ledger;
  END IF;

  BEGIN
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
  EXCEPTION WHEN duplicate_table THEN
    NULL;  -- two backends allocating in the same instant for a brand-new book
  END;

  EXECUTE format('SELECT is_called FROM %I', seq_name) INTO is_fresh;
  IF NOT is_fresh THEN
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
      FROM bills
      WHERE ledger_id = p_ledger;

    IF max_existing > 0 THEN
      EXECUTE format('SELECT setval(%L, %s, true)', seq_name, max_existing);
    END IF;
  END IF;

  EXECUTE format('SELECT nextval(%L)', seq_name) INTO n;
  RETURN n;
END;
$$;

-- ── 3. healer: bump ONE book's sequence past its own printed maximum ─────────
-- Called after a (ledger_id, bill_number) unique violation, which means some
-- other path issued a number this sequence has never offered — a restored
-- backup, or the seed race above. Forward-only: never rewinds a book.
CREATE OR REPLACE FUNCTION sync_bill_number_seq(p_ledger integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'bill_number_seq_l' || p_ledger::text;
  max_existing bigint := 0;
  seq_at bigint := 0;
  target bigint := 0;
BEGIN
  IF p_ledger IS NULL OR p_ledger < 1 THEN
    RAISE EXCEPTION 'sync_bill_number_seq: ledger id must be a positive integer, got %', p_ledger;
  END IF;

  BEGIN
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
  EXCEPTION WHEN duplicate_table THEN
    NULL;
  END;

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
    FROM bills
    WHERE ledger_id = p_ledger;

  EXECUTE format(
    'SELECT CASE WHEN is_called THEN last_value ELSE GREATEST(last_value - 1, 0) END FROM %I',
    seq_name
  ) INTO seq_at;

  target := GREATEST(max_existing, seq_at);
  IF target > 0 THEN
    EXECUTE format('SELECT setval(%L, %s, true)', seq_name, target);
  END IF;
END;
$$;

-- ── 4. restart ONE book at 0001 ──────────────────────────────────────────────
-- setval(..., 1, false) means the NEXT nextval is exactly 1, so a book reissues
-- 0001 rather than 0002 — the difference between "a fresh register" and "one
-- blank page at the front".
--
-- The book must be empty first: this rewinds, and rewinding past live rows
-- would reissue numbers already printed. Callers delete the book's bills before
-- invoking this (see the Super Admin Portal's book reset).
CREATE OR REPLACE FUNCTION reset_bill_number_seq(p_ledger integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'bill_number_seq_l' || p_ledger::text;
  still_open integer := 0;
BEGIN
  IF p_ledger IS NULL OR p_ledger < 1 THEN
    RAISE EXCEPTION 'reset_bill_number_seq: ledger id must be a positive integer, got %', p_ledger;
  END IF;

  SELECT COUNT(*) INTO still_open FROM bills WHERE ledger_id = p_ledger;
  IF still_open > 0 THEN
    RAISE EXCEPTION 'reset_bill_number_seq: ledger % still has % bill(s); a book can only be restarted once it is empty',
      p_ledger, still_open;
  END IF;

  BEGIN
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
  EXCEPTION WHEN duplicate_table THEN
    NULL;
  END;

  EXECUTE format('SELECT setval(%L, 1, false)', seq_name);
END;
$$;

-- Seed the sequence for every book that already has bills, so the first save
-- after this migration continues that book's own numbering instead of starting
-- it at 1 and colliding with what it printed under the global sequence.
DO $$
DECLARE
  b record;
BEGIN
  FOR b IN SELECT DISTINCT ledger_id FROM bills LOOP
    PERFORM sync_bill_number_seq(b.ledger_id);
  END LOOP;
END $$;

-- ── 5. uniqueness moves to (ledger_id, bill_number) ──────────────────────────
-- Drop the legacy unique index/constraint over bill_number alone. Its name is
-- whatever the live database happens to use (drizzle's
-- bills_bill_number_unique, or an index added by a feature migration), so it is
-- discovered rather than assumed.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'bills'
       AND indexdef LIKE 'CREATE UNIQUE%'
       AND indexdef ~ '\(bill_number\)$'
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = r.indexname AND conrelid = 'public.bills'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.bills DROP CONSTRAINT %I', r.indexname);
    ELSE
      EXECUTE format('DROP INDEX public.%I', r.indexname);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "bills_ledger_bill_number_uidx"
  ON "bills" ("ledger_id", "bill_number");
