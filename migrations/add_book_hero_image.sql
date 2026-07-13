-- Feature Migration: Add booking page hero background image field to site_settings table
-- Purpose: Allow admin-uploaded background photo on the public /book page hero section
-- Idempotent: Safe to run on every deployment via care-db-patch-v2
-- Auto-discovered and applied from migrations/ directory
--
-- What changed:
--   - Added bookHeroImageUrl (text) to store the /book page hero background photo URL
--   - ERP Website Builder sets this via the existing photo upload endpoint
--   - Booking page falls back to the default grid pattern when unset

ALTER TABLE IF EXISTS site_settings
ADD COLUMN IF NOT EXISTS book_hero_image_url TEXT NOT NULL DEFAULT '';
