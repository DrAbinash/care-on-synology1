-- Generic scanned-document metadata table, reused by Form F, Patient
-- Registration, Expenses, and Banking's shared document scan service.
-- Care Diagnostics scanner infrastructure overhaul — Phase 4.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS scanned_documents (
  id              SERIAL PRIMARY KEY,
  module          TEXT NOT NULL,        -- 'form-f' | 'patients' | 'expenses' | 'banking'
  entity_type     TEXT NOT NULL,        -- e.g. 'form_f_record', 'patient', 'expense', 'bank_transaction'
  entity_id       INTEGER,              -- nullable: unlinked temp scans have no entity yet
  doc_type        TEXT NOT NULL,        -- 'id-card' | 'bill' | 'bank-statement' | 'photo' | 'other'
  filename        TEXT NOT NULL,
  storage_path    TEXT NOT NULL,        -- relative path under data/uploads/
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER,
  scan_source     TEXT NOT NULL,        -- 'tvs' | 'bridge' | 'upload' | 'mobile' | 'webcam'
  device_label    TEXT,
  user_id         INTEGER,
  ocr_status      TEXT NOT NULL DEFAULT 'pending',   -- pending | success | failed | skipped
  ocr_confidence  INTEGER,
  is_linked       TEXT NOT NULL DEFAULT 'false',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS scanned_documents_module_idx ON scanned_documents (module, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS scanned_documents_unlinked_idx ON scanned_documents (is_linked, created_at);
