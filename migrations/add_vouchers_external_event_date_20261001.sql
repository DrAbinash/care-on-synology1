-- Bank-feed rows need somewhere to keep the bank's own date.
--
-- CARE's accounting posting date (`vouchers.date`) is a Class-A business date:
-- after the business-time cutover it comes from the trusted CARE clinic date and
-- never from a submitted body field. A bank statement, though, is a document
-- about the past — its rows carry the bank's calendar. Before this change the
-- import wrote that external date straight into `vouchers.date`, which made a
-- multi-day statement a batch of backdated GL entries. PR 2 refused the batch
-- outright; management chose instead to give bank feeds their own rule
-- (docs/audits/business-time-class-a-date-enforcement-2026-10-01.md §12):
--
--   vouchers.date           = the CARE clinic date, derived server-side
--   vouchers.external_event_date = the date the bank printed, preserved exactly
--
-- so the external fact stops being the accounting date without being thrown
-- away, and reconciliation against the statement stays possible.
--
-- Both columns are nullable with no default and no constraint: an existing
-- voucher keeps exactly what it has (NULL means "not a bank feed", which is true
-- of every row that exists today). Nothing here backfills, re-dates or
-- reclassifies a historical row, and no existing column gained a CHECK or NOT
-- NULL that could retroactively invalidate one.
--
-- `external_event_source` is written by the import path only. Keeping it as
-- data rather than inferring provenance from `narration LIKE 'Bank import%'`
-- means the duplicate guard and any later report can state where the row came
-- from without pattern-matching prose.

ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "external_event_date" text;
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "external_event_source" text;

-- The duplicate guard looks up previously imported rows by the bank's date
-- within one bank account; that lookup is the only reason these columns are
-- indexed, and it never touches rows with no external source.
CREATE INDEX IF NOT EXISTS "vouchers_external_event_date_idx"
  ON "vouchers" ("external_event_date")
  WHERE "external_event_source" IS NOT NULL;
