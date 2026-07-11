-- Fixes a DB/code mismatch on dicom_nodes: the Drizzle schema, cron job,
-- API routes, and DicomNodes.tsx frontend all already read/write
-- pull_interval_seconds (see lib/db/src/schema/dicom.ts), but a production
-- database created before this rename may still physically have the old
-- column name pull_interval_minutes — causing DICOM auto-pull queries to
-- fail at runtime with a "column does not exist" error.
--
-- Renaming (not dropping + recreating) preserves every node's existing
-- configured value with zero data loss.
--
-- Idempotent: only runs if the old column exists AND the new one doesn't,
-- so it's safe to run on a database that's already correct.
--
-- Radiology/PACS zone only — dicom_nodes has no relationship to billing,
-- payments, ledgers, or accounting. See PROTECTED_FILES.md.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dicom_nodes'
    AND column_name = 'pull_interval_minutes'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dicom_nodes'
    AND column_name = 'pull_interval_seconds'
  )
  THEN
    ALTER TABLE dicom_nodes RENAME COLUMN pull_interval_minutes TO pull_interval_seconds;
  END IF;
END $$;
