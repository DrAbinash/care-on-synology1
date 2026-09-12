-- ============================================================================
-- Expense Entry V2 — Bills & Payables foundation
--
-- Turns expenses into a bill header and introduces expense_payments for
-- actual money movements. BILL VALUE ≠ MONEY PAID.
--
-- Backward compatible:
--   * existing columns kept
--   * legacy rows backfilled as fully PAID with one synthetic payment
--   * NO new accounting vouchers are created during backfill
-- ============================================================================

-- ── expense_categories master ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  default_account_id INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expense_categories_parent_id_idx ON expense_categories(parent_id);
CREATE INDEX IF NOT EXISTS expense_categories_legacy_key_idx ON expense_categories(legacy_key);

-- ── expenses V2 columns ──────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS bill_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS vendor_id INTEGER,
  ADD COLUMN IF NOT EXISTS vendor_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_date TEXT,
  ADD COLUMN IF NOT EXISTS department_id INTEGER,
  ADD COLUMN IF NOT EXISTS category_id INTEGER,
  ADD COLUMN IF NOT EXISTS subcategory_id INTEGER,
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS accounting_error TEXT,
  ADD COLUMN IF NOT EXISTS accrual_voucher_id INTEGER,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS receipt_image_hash TEXT,
  ADD COLUMN IF NOT EXISTS ocr_meta_json TEXT;

-- Widen amount to match bill_amount precision (safe no-op if already wider)
ALTER TABLE expenses
  ALTER COLUMN amount TYPE NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS expenses_payment_status_idx ON expenses(payment_status);
CREATE INDEX IF NOT EXISTS expenses_vendor_id_idx ON expenses(vendor_id);
CREATE INDEX IF NOT EXISTS expenses_invoice_number_idx ON expenses(invoice_number);
CREATE INDEX IF NOT EXISTS expenses_department_id_idx ON expenses(department_id);
CREATE INDEX IF NOT EXISTS expenses_receipt_hash_idx ON expenses(receipt_image_hash);
CREATE INDEX IF NOT EXISTS expenses_expense_date_idx ON expenses(expense_date);

-- Soft FK indexes (avoid hard FK to vendors/departments/accounts so a missing
-- master row can't brick expense history). Application enforces integrity.

-- ── expense_payments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_payments (
  id SERIAL PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  payment_public_id TEXT NOT NULL UNIQUE,
  payment_date TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  paid_from_account_id INTEGER,
  reference_number TEXT,
  notes TEXT,
  created_by TEXT,
  voucher_id INTEGER,
  accounting_status TEXT NOT NULL DEFAULT 'PENDING',
  accounting_error TEXT,
  reversed_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversal_reason TEXT,
  is_legacy_backfill TEXT NOT NULL DEFAULT 'false',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expense_payments_expense_id_idx ON expense_payments(expense_id);
CREATE INDEX IF NOT EXISTS expense_payments_payment_date_idx ON expense_payments(payment_date);
CREATE INDEX IF NOT EXISTS expense_payments_voucher_id_idx ON expense_payments(voucher_id);

CREATE TABLE IF NOT EXISTS expense_payment_counter (
  id SERIAL PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 0
);

-- ── vouchers.expense_payment_id durable link ─────────────────────────────────
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS expense_payment_id INTEGER;

CREATE INDEX IF NOT EXISTS vouchers_expense_payment_id_idx ON vouchers(expense_payment_id);

-- ── Seed category master (idempotent by legacy_key / name) ───────────────────
INSERT INTO expense_categories (name, parent_id, legacy_key, sort_order)
SELECT v.name, NULL, v.legacy_key, v.sort_order
FROM (VALUES
  ('Consumables', 'supplies', 10),
  ('Pathology', NULL, 20),
  ('Staff', 'salaries', 30),
  ('Utilities', 'utilities', 40),
  ('Equipment', 'equipment', 50),
  ('IT', NULL, 60),
  ('Operations', 'maintenance', 70),
  ('Marketing', 'marketing', 80),
  ('Travel', 'travel', 90),
  ('Professional Fees', NULL, 100),
  ('Rent', 'rent', 110),
  ('Referral Commission', NULL, 120),
  ('Miscellaneous', 'miscellaneous', 999)
) AS v(name, legacy_key, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories c WHERE c.name = v.name AND c.parent_id IS NULL
);

-- Subcategories (attach under parents by name)
INSERT INTO expense_categories (name, parent_id, sort_order)
SELECT s.name, p.id, s.sort_order
FROM (VALUES
  ('Consumables', 'MRI Contrast', 1),
  ('Consumables', 'CT Contrast', 2),
  ('Consumables', 'USG Consumables', 3),
  ('Consumables', 'X-ray Consumables', 4),
  ('Consumables', 'Stationery', 5),
  ('Pathology', 'Reagents', 1),
  ('Pathology', 'Controls', 2),
  ('Pathology', 'Collection Consumables', 3),
  ('Staff', 'Salaries', 1),
  ('Staff', 'Incentives', 2),
  ('Staff', 'Overtime', 3),
  ('Staff', 'Staff Welfare', 4),
  ('Utilities', 'Electricity', 1),
  ('Utilities', 'Generator/Diesel', 2),
  ('Utilities', 'Internet', 3),
  ('Utilities', 'Telephone', 4),
  ('Equipment', 'AMC', 1),
  ('Equipment', 'Repair', 2),
  ('Equipment', 'Spare Parts', 3),
  ('Equipment', 'Calibration', 4),
  ('IT', 'Software', 1),
  ('IT', 'Cloud', 2),
  ('IT', 'Hardware', 3),
  ('IT', 'Networking', 4),
  ('Operations', 'Housekeeping', 1),
  ('Operations', 'Biomedical Waste', 2),
  ('Operations', 'Laundry', 3),
  ('Operations', 'Security', 4)
) AS s(parent_name, name, sort_order)
JOIN expense_categories p ON p.name = s.parent_name AND p.parent_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories c WHERE c.name = s.name AND c.parent_id = p.id
);

-- ── Backfill legacy expenses as fully PAID ───────────────────────────────────
-- Historical rows treated amount as money already paid (= bill).
UPDATE expenses
SET
  bill_amount = COALESCE(bill_amount, amount),
  payment_status = CASE
    WHEN payment_status IS NULL OR payment_status = '' THEN 'PAID'
    ELSE payment_status
  END,
  vendor_name_snapshot = COALESCE(vendor_name_snapshot, NULLIF(TRIM(paid_to), '')),
  accounting_status = CASE
    WHEN voucher_id IS NOT NULL THEN 'POSTED'
    ELSE COALESCE(NULLIF(accounting_status, ''), 'PENDING')
  END
WHERE bill_amount IS NULL;

-- One synthetic payment per legacy expense that has no payment rows yet.
-- Does NOT create new vouchers — preserves historical cash/day-close totals.
INSERT INTO expense_payment_counter (counter)
SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM expense_payment_counter);

WITH legacy AS (
  SELECT e.id, e.amount, e.expense_date, e.payment_mode, e.created_by, e.voucher_id,
         e.created_at,
         row_number() OVER (ORDER BY e.id) AS rn
  FROM expenses e
  WHERE NOT EXISTS (
    SELECT 1 FROM expense_payments p WHERE p.expense_id = e.id
  )
  AND COALESCE(e.payment_status, 'PAID') <> 'VOID'
  AND COALESCE(e.bill_amount, e.amount)::numeric > 0
),
bump AS (
  UPDATE expense_payment_counter
  SET counter = counter + (SELECT COUNT(*) FROM legacy)
  RETURNING counter
)
INSERT INTO expense_payments (
  expense_id, payment_public_id, payment_date, amount, payment_mode,
  created_by, voucher_id, accounting_status, is_legacy_backfill,
  created_at, updated_at
)
SELECT
  l.id,
  'EXPAY-LEGACY-' || l.id::text,
  l.expense_date,
  l.amount,
  COALESCE(NULLIF(TRIM(l.payment_mode), ''), 'cash'),
  l.created_by,
  l.voucher_id,
  CASE WHEN l.voucher_id IS NOT NULL THEN 'POSTED' ELSE 'PENDING' END,
  'true',
  -- Preserve original posting clock so day-close / daily-summary windows
  -- (keyed on payment created_at) do not shift historical cash totals.
  l.created_at,
  l.created_at
FROM legacy l;

-- Map legacy free-text category → category_id where possible
UPDATE expenses e
SET category_id = c.id
FROM expense_categories c
WHERE e.category_id IS NULL
  AND c.parent_id IS NULL
  AND (
    lower(c.legacy_key) = lower(e.category)
    OR lower(c.name) = lower(e.category)
  );
