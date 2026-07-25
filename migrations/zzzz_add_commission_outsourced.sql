-- Outsourced-test commission: a separate basis (price vs margin) and the
-- ability to scope a commission slab to in-house or outsourced work only.
-- Idempotent — the db-patch container re-runs every migration on each start.

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS commission_outsourced_basis TEXT NOT NULL DEFAULT 'price';

ALTER TABLE commission_rules
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'all';

-- Existing rules keep applying to everything, so behaviour is unchanged until
-- an operator deliberately narrows a slab.
CREATE INDEX IF NOT EXISTS commission_rules_applies_to_idx ON commission_rules (applies_to);
