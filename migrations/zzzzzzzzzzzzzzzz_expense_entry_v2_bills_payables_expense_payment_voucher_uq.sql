-- Expense Entry V2 — DB-level idempotency for payment vouchers
-- ============================================================================
-- ONE expense_payment → AT MOST ONE original accounting voucher.
--
-- Semantics:
--   - Original expense payment PVs stamp vouchers.expense_payment_id.
--   - Reversal vouchers must NOT carry expense_payment_id (audit/trace stays on
--     reference + "Reversal | …" particular + swapped Dr/Cr).
--   - Partial UNIQUE index enforces the invariant even if app-level races fail.
--
-- Upgrade-safe:
--   1) Clear expense_payment_id on existing reversal rows (deterministic).
--   2) If multiple NON-reversal vouchers still share one expense_payment_id,
--      RAISE with an actionable diagnostic — never silently delete vouchers.
--   3) Replace the non-unique lookup index with the unique partial index.
--
-- Safe to re-run (IF NOT EXISTS / IF EXISTS / idempotent UPDATE).

DO $$
DECLARE
  cleared int;
  dup_count int;
  diag text;
BEGIN
  -- Reversals historically copied expense_payment_id from the original PV.
  -- That is incompatible with UNIQUE(expense_payment_id); clear it while
  -- retaining reference / particular / narration / account swap linkage.
  UPDATE vouchers
  SET expense_payment_id = NULL
  WHERE expense_payment_id IS NOT NULL
    AND particular ILIKE 'Reversal |%';
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RAISE NOTICE
    'expense_payment_voucher_uq: cleared expense_payment_id on % reversal voucher(s)',
    cleared;

  SELECT count(*)::int INTO dup_count
  FROM (
    SELECT expense_payment_id
    FROM vouchers
    WHERE expense_payment_id IS NOT NULL
    GROUP BY expense_payment_id
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    SELECT string_agg(
      format(
        'expense_payment_id=%s count=%s voucher_ids=%s particulars=%s',
        expense_payment_id,
        n,
        voucher_ids,
        particulars
      ),
      E'\n'
      ORDER BY expense_payment_id
    )
    INTO diag
    FROM (
      SELECT
        expense_payment_id,
        count(*)::int AS n,
        array_agg(id ORDER BY id)::text AS voucher_ids,
        array_agg(left(coalesce(particular, ''), 60) ORDER BY id)::text AS particulars
      FROM vouchers
      WHERE expense_payment_id IS NOT NULL
      GROUP BY expense_payment_id
      HAVING count(*) > 1
    ) d;

    RAISE EXCEPTION
      'Expense V2: cannot create UNIQUE(expense_payment_id) — % duplicate non-reversal voucher group(s) remain. Reconcile manually (do not delete financial vouchers). Diagnostics:%',
      dup_count,
      E'\n' || coalesce(diag, '(no detail)');
  END IF;
END $$;

-- Non-unique lookup index from the V2 bills/payables migration — replaced below.
DROP INDEX IF EXISTS vouchers_expense_payment_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_expense_payment_id_uq
  ON vouchers (expense_payment_id)
  WHERE expense_payment_id IS NOT NULL;
