-- =============================================================================
-- M1.6B1: Assignment management on the radiology worklist.
-- Additive, idempotent. Assignment (organizational ownership) is DISTINCT
-- from the M1.6A lock columns (active reporting ownership). Stable staff ids
-- are canonical; the legacy assigned_radiologist NAME column stays mirrored
-- for pre-existing readers.
-- =============================================================================
ALTER TABLE IF EXISTS radiology_worklist
  ADD COLUMN IF NOT EXISTS assigned_radiologist_id integer,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by_id integer,
  ADD COLUMN IF NOT EXISTS assigned_by_name text;

CREATE INDEX IF NOT EXISTS radiology_worklist_assigned_rad_idx
  ON radiology_worklist (assigned_radiologist_id)
  WHERE assigned_radiologist_id IS NOT NULL;
