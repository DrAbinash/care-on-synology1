-- =============================================================================
-- Report numbers are allocated from a per-day SEQUENCE, like bills and orders
-- =============================================================================
-- WHY THIS EXISTS
-- `nextReportNumber()` in `routes/patient-reports.ts` derived the next
-- `RPT-YYYYMMDD-NNN` from `COUNT(*)` of today's rows. A count is not an
-- allocator: deleting any report for the day opens a hole, and the hole gets
-- refilled. Two outcomes, both wrong, both measured:
--
--   • the number was free (the row is gone) → a NEW document is issued with a
--     number an earlier document already carried. Reproduced in
--     `routes/reportNumberSequence.request.test.ts`: after one delete, the next
--     finalize answered `RPT-20261030-005` a second time.
--   • the number was still taken (a hole BELOW the highest row) → the UNIQUE
--     index rejects the insert, and because the three-attempt retry recomputes
--     the same count every time it cannot escape. Finalize answers a bare
--     `500 {"error":"Failed to create report"}`, and every later sign that day
--     answers the same until somebody renumbers by hand. Hit on the acceptance
--     rig on 2026-10-29, where the harness deletes a report row to re-arm a
--     study for the next signing journey.
--
-- The clinic already has the right mechanism: `zzzz_document_number_counters.sql`
-- moved bill and order numbers onto per-period sequences created on demand and
-- seeded forward from the highest number already printed. This file adds the
-- same shape for reports, bucketed by day because that is what the number
-- carries (`YYYYMMDD`).
--
-- WHAT CHANGES VISIBLY: a rolled-back finalize now leaves a GAP instead of
-- reusing a number. That is already true of the clinic's bill and order numbers,
-- and it is the correct trade — a document identifier must never be issued
-- twice, and a missing number on a day's list is not a lost report.
--
-- No column, no index, no backfill. Existing rows are not renumbered: the
-- sequence seeds itself from the highest suffix already stored for that day, so
-- the next number after `...-007` is `...-008` even where the day's rows are not
-- contiguous.

CREATE OR REPLACE FUNCTION next_report_number_seq(p_yyyymmdd text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'report_number_seq_' || p_yyyymmdd;
  prefix   text := 'RPT-' || p_yyyymmdd || '-';
  seed     bigint;
  n        bigint;
BEGIN
  -- Created on demand, and seeded inside the same call. Seeding at migration
  -- time would only cover the day the file ran: the first finalize of a new day
  -- would otherwise start a fresh sequence at 1 and try to reissue
  -- RPT-<that day>-001, which that day's earlier rows may already hold.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = seq_name) THEN
    SELECT COALESCE(MAX(
             CASE WHEN substring(report_number FROM (char_length(prefix) + 1)) ~ '^[0-9]+$'
                  THEN substring(report_number FROM (char_length(prefix) + 1))::bigint
             END), 0)
      INTO seed
      FROM patient_reports
     WHERE report_number LIKE prefix || '%';

    EXECUTE format('CREATE SEQUENCE %I', seq_name);
    IF seed > 0 THEN
      EXECUTE format('SELECT setval(%L, %s, true)', seq_name, seed);
    END IF;
  END IF;

  EXECUTE format('SELECT nextval(%L)', seq_name) INTO n;
  RETURN n;
END;
$$;

-- The function is the whole contract of this file, so its absence is a failure
-- rather than a silent fall back to the count.
DO $do$
begin
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname = 'next_report_number_seq' AND n.nspname = 'public') = 0 THEN
    RAISE EXCEPTION 'next_report_number_seq(text) was not created — report numbers would keep being allocated by COUNT(*), which reissues a deleted report''s number.';
  END IF;
end
$do$;

-- Prove it on the bucket that already exists: allocating for today must return a
-- number strictly greater than the highest suffix stored for today, and must not
-- return a number any live row carries. Runs against real data and commits
-- nothing — the value it consumes is one the application will never print,
-- because the same sequence feeds the next real finalize.
DO $do$
declare
  bucket text := to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  prefix text := 'RPT-' || to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-';
  highest bigint;
  issued bigint;
  clash bigint;
begin
  EXECUTE format(
    'SELECT COALESCE(MAX(substring(report_number FROM %s)::bigint), 0) FROM patient_reports WHERE report_number LIKE %L',
    char_length(prefix) + 1, prefix || '%'
  ) INTO highest;

  issued := next_report_number_seq(bucket);

  IF issued <= highest THEN
    RAISE EXCEPTION 'next_report_number_seq(% ) returned %, which is not above the day''s highest suffix %', bucket, issued, highest;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM patient_reports WHERE report_number = %L || lpad($1::text, 3, ''0'')',
    prefix
  ) INTO clash USING issued;

  IF clash > 0 THEN
    RAISE EXCEPTION 'next_report_number_seq(% ) returned %, which a stored report already carries', bucket, issued;
  END IF;
END
$do$;
