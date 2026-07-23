-- =============================================================================
-- add_inventory_reagent_expiry_reorder.sql
-- Reagent/consumable batch tracking (lot + expiry, FEFO), reorder points and
-- auto-reorder suggestions. Purely additive on top of the existing
-- inventory_items / inventory_transactions / inventory_consumption_rules tables.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS.
-- =============================================================================

-- ── Reagent + reorder fields on the item master ──────────────────────────────
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS track_expiry         boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS reorder_point        numeric(10,2);
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS reorder_quantity     numeric(10,2);
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS auto_reorder_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS storage_temp         text;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS open_stability_days  integer;

-- ── Batches / lots (one row per received lot; drives expiry + FEFO) ──────────
CREATE TABLE IF NOT EXISTS inventory_batches (
  id             serial PRIMARY KEY,
  item_id        integer NOT NULL REFERENCES inventory_items(id),
  lot_number     text NOT NULL DEFAULT '',
  expiry_date    date,
  qty_received   numeric(10,2) NOT NULL DEFAULT 0,
  qty_remaining  numeric(10,2) NOT NULL DEFAULT 0,
  unit_cost      numeric(12,2),
  vendor_id      integer REFERENCES vendors(id) ON DELETE SET NULL,
  invoice_number text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  opened_at      timestamptz,
  status         text NOT NULL DEFAULT 'active',   -- active | depleted | expired | quarantined
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_batches_item_idx   ON inventory_batches(item_id);
CREATE INDEX IF NOT EXISTS inventory_batches_expiry_idx ON inventory_batches(expiry_date);
CREATE INDEX IF NOT EXISTS inventory_batches_status_idx ON inventory_batches(status);

-- ── Reorder requests (auto-generated suggestions or manual draft POs) ────────
CREATE TABLE IF NOT EXISTS inventory_reorder_requests (
  id                  serial PRIMARY KEY,
  item_id             integer NOT NULL REFERENCES inventory_items(id),
  current_stock       numeric(10,2) NOT NULL DEFAULT 0,
  reorder_point       numeric(10,2),
  suggested_qty       numeric(10,2) NOT NULL DEFAULT 0,
  preferred_vendor_id integer REFERENCES vendors(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'suggested', -- suggested | ordered | received | cancelled
  source              text NOT NULL DEFAULT 'auto',      -- auto | manual
  notes               text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  ordered_at          timestamptz,
  received_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_reorder_status_idx ON inventory_reorder_requests(status);
-- At most one OPEN (suggested/ordered) reorder request per item, so an
-- auto-reorder scan never piles up duplicate suggestions for the same item.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reorder_open_item_uq
  ON inventory_reorder_requests(item_id)
  WHERE status IN ('suggested', 'ordered');
