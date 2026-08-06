-- Optional hard-block: cancel of a paid bill requires an auto-refund.
-- Default FALSE preserves cancel-without-refund behaviour.
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS cancel_requires_refund BOOLEAN NOT NULL DEFAULT FALSE;
