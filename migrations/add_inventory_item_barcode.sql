-- Item barcode/SKU for scanner workflows (INV- prefix or custom).
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_barcode_uq
  ON inventory_items (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';
