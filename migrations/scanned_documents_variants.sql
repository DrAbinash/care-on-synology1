-- Adds the OCR-processed and thumbnail image variants to scanned_documents,
-- per the "Original / OCR-processed / Thumbnail" storage requirement:
--   Original  = legal evidence (never re-encoded)
--   Processed = better OCR recognition + always browser-viewable
--   Thumbnail = fast ERP list/grid loading
-- Care Diagnostics scanner infrastructure — production readiness pass.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.

ALTER TABLE scanned_documents ADD COLUMN IF NOT EXISTS processed_storage_path TEXT;
ALTER TABLE scanned_documents ADD COLUMN IF NOT EXISTS processed_size_bytes INTEGER;
ALTER TABLE scanned_documents ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT;
ALTER TABLE scanned_documents ADD COLUMN IF NOT EXISTS thumbnail_size_bytes INTEGER;
