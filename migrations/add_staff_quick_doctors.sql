-- Per-staff Billing Desk Quick Doctor slot layout.
--
-- Fixes a bug where non-admin staff got "Failed to save quick doctor" (403):
-- Quick Doctor slots were previously stored as a single row on the shared
-- clinic_settings table, gated by the /settings.clinic admin permission.
-- This table gives each authenticated staff member their OWN 8-slot layout
-- (one row per staff_id, enforced by a unique index), writable by that staff
-- member alone via /api/my/quick-doctors (requireStaffAuth only — no special
-- permission needed, since it is the caller's own data, never another
-- user's).

CREATE TABLE IF NOT EXISTS staff_quick_doctors (
  id                SERIAL PRIMARY KEY,
  staff_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quick_doctor_ids  TEXT NOT NULL DEFAULT '[null,null,null,null,null,null,null,null]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_quick_doctors_staff_uq ON staff_quick_doctors (staff_id);
