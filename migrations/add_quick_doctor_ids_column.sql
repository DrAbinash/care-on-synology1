-- Fix: quick_doctor_ids column was added to the Drizzle schema (clinicSettings.ts)
-- in commit fd8274e8 but the corresponding database migration was never created,
-- so the live database never received this column. Every query against
-- clinic_settings has been failing in production since with:
--   ERROR: column "quick_doctor_ids" does not exist
--
-- This migration is purely additive (IF NOT EXISTS + safe default) and does
-- not touch any existing data or columns.

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "quick_doctor_ids" text NOT NULL
  DEFAULT '[null,null,null,null,null,null,null,null]';
