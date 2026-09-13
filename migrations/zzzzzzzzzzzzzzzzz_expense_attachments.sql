-- Expense Entry V2 — optional bill / receipt / supporting-document attachments
-- ============================================================================
-- Documentary only: does NOT touch bill amounts, payments, vouchers, or day-close.
-- Bytes live on the persistent uploads volume (data/uploads/); this table is
-- metadata + SHA-256 content hash for duplicate detection.
--
-- Safe to re-run (IF NOT EXISTS). Soft-delete columns retain audit evidence.

CREATE TABLE IF NOT EXISTS expense_attachments (
  id SERIAL PRIMARY KEY,
  expense_id INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'supporting_document',
  storage_path TEXT NOT NULL,
  thumbnail_storage_path TEXT,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL_UPLOAD',
  uploaded_by TEXT,
  uploaded_by_id INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS expense_attachments_expense_id_idx
  ON expense_attachments (expense_id);

CREATE INDEX IF NOT EXISTS expense_attachments_content_hash_idx
  ON expense_attachments (content_hash);

CREATE INDEX IF NOT EXISTS expense_attachments_active_expense_idx
  ON expense_attachments (expense_id)
  WHERE deleted_at IS NULL;
