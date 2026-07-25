-- ============================================================================
-- Referential integrity for bill/payment dependents.
--
-- WHY: the Super Admin ledger reset deletes a book's bills and payments, but its
-- cascade covers fewer tables than the full-wipe path does. The reset removes
--   payments, bill_audits, bills, order_tests, orders, appointments, patients
-- while the full wipe additionally removes
--   form_f_records, online_bookings, tokens, test_tokens, vouchers,
--   patient_reports, report_shares
-- so after a ledger reset those seven still point at bills that no longer exist.
-- Two distinct defects follow:
--
--   1. form_f_records.bill_id ALREADY has a foreign key with NO on-delete
--      action, i.e. NO ACTION. So deleting a bill that has a Form F record
--      RAISES a foreign-key violation and the whole reset fails. Form F applies
--      to USG, so in practice most bills in a book have one.
--
--   2. vouchers / tokens / test_tokens / patient_reports / online_bookings have
--      NO foreign key at all, so they are silently left dangling.
--
-- HOW: fix it in the database rather than in the deleting code, because the
-- Super Admin plugin that performs the reset ships on a USB key and is not part
-- of this repository — a DB-level guarantee holds no matter which code deletes.
--
-- ON DELETE SET NULL, deliberately, NOT CASCADE. These rows must SURVIVE their
-- bill:
--   * vouchers        — the accounting entry recording that money moved. The
--                       repo convention is that financial records are never
--                       deleted (they are superseded); deleting the voucher
--                       would also unbalance the ledger it belongs to.
--   * form_f_records  — PCPNDT statutory record with a mandatory retention
--                       period. Must not be destroyed with a bill.
--   * patient_reports — clinical record; a signed report outlives its invoice.
--   * tokens / test_tokens / online_bookings — operational rows kept for
--                       traceability; nulling the pointer is enough.
-- Severing the pointer restores integrity while preserving the record, which is
-- the correct treatment for a dependent that has independent value.
--
-- Every column involved is already nullable, so SET NULL is valid for all of
-- them (a SET NULL action on a NOT NULL column would fail at delete time).
--
-- Idempotent and safe to re-run: existing orphans are repaired first (otherwise
-- ADD CONSTRAINT would be rejected by the very rows it is meant to prevent),
-- then each constraint is added only if absent.
-- ============================================================================

-- ── Step 1: repair existing orphans by severing the dangling pointer ─────────
-- Never DELETE here: an orphan is a record whose bill is gone, not a record that
-- should not exist. Counts are reported so a reset that already happened is
-- visible in the deploy log rather than silently cleaned up.
DO $$
DECLARE
  r record;
  n bigint;
  total bigint := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('vouchers',         'bill_id',    'bills'),
      ('vouchers',         'payment_id', 'payments'),
      ('form_f_records',   'bill_id',    'bills'),
      ('patient_reports',  'bill_id',    'bills'),
      ('tokens',           'bill_id',    'bills'),
      ('test_tokens',      'bill_id',    'bills'),
      ('online_bookings',  'bill_id',    'bills')
    ) AS v(child, col, parent)
  LOOP
    -- Skip anything not present on this database.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.child AND column_name = r.col
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE public.%I c SET %I = NULL
        WHERE c.%I IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I)',
      r.child, r.col, r.col, r.parent, r.col
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      total := total + n;
      RAISE NOTICE 'referential repair: %.% had % orphan(s) -> set NULL (record kept)', r.child, r.col, n;
    END IF;
  END LOOP;

  IF total = 0 THEN
    RAISE NOTICE 'referential repair: no orphans found';
  ELSE
    RAISE NOTICE 'referential repair: % orphaned reference(s) severed; all records preserved', total;
  END IF;
END $$;

-- ── Step 2: let the database enforce it from now on ──────────────────────────
-- form_f_records.bill_id is handled specially: it already HAS a foreign key,
-- with NO ACTION, which is what makes the ledger reset fail. Its existing
-- constraint is dropped and re-created as SET NULL so the statutory record
-- survives the bill instead of blocking its deletion.
DO $$
DECLARE
  r record;
  conname_existing text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('vouchers',        'bill_id',    'bills',    'vouchers_bill_id_fk'),
      ('vouchers',        'payment_id', 'payments', 'vouchers_payment_id_fk'),
      ('form_f_records',  'bill_id',    'bills',    'form_f_records_bill_id_fk'),
      ('patient_reports', 'bill_id',    'bills',    'patient_reports_bill_id_fk'),
      ('tokens',          'bill_id',    'bills',    'tokens_bill_id_fk'),
      ('test_tokens',     'bill_id',    'bills',    'test_tokens_bill_id_fk'),
      ('online_bookings', 'bill_id',    'bills',    'online_bookings_bill_id_fk')
    ) AS v(child, col, parent, fk)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.child AND column_name = r.col
    ) THEN
      CONTINUE;
    END IF;

    -- Drop any pre-existing FK on this exact column whose delete action is not
    -- SET NULL ('n'). This is what converts form_f_records' NO ACTION key.
    FOR conname_existing IN
      SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel  ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE con.contype = 'f'
         AND ns.nspname = 'public'
         AND rel.relname = r.child
         AND con.confdeltype <> 'n'
         AND con.conkey = ARRAY[(
               SELECT attnum FROM pg_attribute
                WHERE attrelid = rel.oid AND attname = r.col AND NOT attisdropped
             )]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.child, conname_existing);
      RAISE NOTICE 'referential integrity: dropped %.% key % (delete action was not SET NULL)', r.child, r.col, conname_existing;
    END LOOP;

    -- Add ours if the column now has no FK at all.
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint con
        JOIN pg_class rel  ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE con.contype = 'f'
         AND ns.nspname = 'public'
         AND rel.relname = r.child
         AND con.conkey = ARRAY[(
               SELECT attnum FROM pg_attribute
                WHERE attrelid = rel.oid AND attname = r.col AND NOT attisdropped
             )]::smallint[]
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES public.%I(id) ON DELETE SET NULL',
        r.child, r.fk, r.col, r.parent
      );
      RAISE NOTICE 'referential integrity: %.% -> %(id) ON DELETE SET NULL', r.child, r.col, r.parent;
    END IF;
  END LOOP;
END $$;
