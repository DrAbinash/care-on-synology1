-- ============================================================================
-- Fix: Echo / Fetal Echo report sign-off fails with 22P02 in production.
--
-- echo_reports.reviewed_by / .finalized_by and fetal_echo_studies.reviewed_by /
-- .finalized_by are INTEGER in any database whose tables were created by the
-- api-server runtime bootstrap DDL (src/index.ts CREATE TABLE IF NOT EXISTS,
-- which declared them INTEGER), but:
--
--   * the Drizzle schema declares them text()  — lib/db/src/schema/echoCardiology.ts
--   * the routes WRITE a reviewer NAME string  — routes/echoCardiology.ts writes
--     `s.subjectName` for reviewedBy/finalizedBy
--
-- so every Review and Finalize on an echo report or fetal echo study aborted
-- with `invalid input syntax for type integer: "Dr. <name>"` before the UPDATE
-- committed: reports stayed status='draft', reviewed_at/finalized_at stayed
-- NULL, and studies could not be signed or delivered. Two competing
-- CREATE TABLE IF NOT EXISTS sources raced and the INTEGER one won.
--
-- This aligns the live columns to the declared/written type. Guarded on the
-- column ACTUALLY being integer, so it is a no-op on databases that were
-- created from the Drizzle migration (already text) and safe to re-run.
--
-- USING col::text preserves any existing integer values as their text form —
-- no data is dropped. (In practice these columns are empty precisely because
-- every write failed.)
--
-- The bootstrap DDL in artifacts/api-server/src/index.ts is corrected to TEXT
-- in the same change, so a fresh boot cannot recreate the mismatch.
--
-- NOTE ON SCOPE: fetal_usg_reports.reviewed_by/.finalized_by and
-- radiology_ai_enhancements.reviewed_by are DELIBERATELY left as integer —
-- their Drizzle schemas declare integer() and their routes write
-- `s.subjectId` (an id), so those are internally consistent and correct.
-- ============================================================================

DO $$
DECLARE
  r record;
  fixed int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('echo_reports',       'reviewed_by'),
      ('echo_reports',       'finalized_by'),
      ('fetal_echo_studies', 'reviewed_by'),
      ('fetal_echo_studies', 'finalized_by')
    ) AS v(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = r.tbl
        AND column_name  = r.col
        AND data_type    = 'integer'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE text USING %I::text',
        r.tbl, r.col, r.col
      );
      fixed := fixed + 1;
      RAISE NOTICE 'echo reviewer fix: %.% integer -> text', r.tbl, r.col;
    END IF;
  END LOOP;

  IF fixed = 0 THEN
    RAISE NOTICE 'echo reviewer fix: nothing to do (columns already text)';
  ELSE
    RAISE NOTICE 'echo reviewer fix: % column(s) converted to text', fixed;
  END IF;
END $$;
