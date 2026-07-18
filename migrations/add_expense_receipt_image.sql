-- ============================================================================
-- Expense receipt image — audit parity for scanned bills/receipts.
-- ============================================================================
-- Additive + idempotent. Stores the scanned/enhanced bill image (data URL)
-- against the expense so the source document behind the OCR'd fields is kept
-- for audit — mirroring how Form F retains the ID-card image.
--
-- The API deliberately NEVER selects this column in the expense LIST endpoint
-- (only on the single-expense detail fetch), so it cannot bloat list responses.
--
-- Rollback (manual): ALTER TABLE expenses DROP COLUMN IF EXISTS receipt_image_url;
-- ============================================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_image_url TEXT;
