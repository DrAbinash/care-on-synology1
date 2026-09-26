-- Expense Entry: optional work metadata + Operations → Repairs & Maintenance subcategory.
-- Additive only. Does not alter vouchers, payment status, or day-close.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meta_json TEXT;

-- Subcategory under Operations (legacy_key = maintenance) when that parent exists.
INSERT INTO expense_categories (name, parent_id, sort_order)
SELECT 'Repairs & Maintenance', p.id, 0
FROM expense_categories p
WHERE p.name = 'Operations' AND p.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM expense_categories c
    WHERE c.name = 'Repairs & Maintenance' AND c.parent_id = p.id
  );

-- Helpful for payee search / list filters (expression indexes; ignore if unsupported).
CREATE INDEX IF NOT EXISTS expenses_paid_to_lower_idx
  ON expenses (lower(paid_to));
CREATE INDEX IF NOT EXISTS expenses_vendor_snapshot_lower_idx
  ON expenses (lower(vendor_name_snapshot));
