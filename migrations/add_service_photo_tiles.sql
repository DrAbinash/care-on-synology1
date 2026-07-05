-- Feature Migration: Add service photo tiles fields to site_settings table
-- Purpose: Enable service category background images on public booking page
-- Idempotent: Safe to run on every deployment via care-db-patch-v2
-- Auto-discovered and applied from migrations/ directory
--
-- What changed:
--   - Added serviceImagesEnabled (boolean) to control feature toggle
--   - Added serviceImages (JSON) to store { "opd": "url", "usg": "url", ... }
--   - ERP Settings syncs these to website settings when saved
--   - Booking page displays service photo tiles with background images

-- Only run if columns don't exist (CREATE TABLE IF NOT EXISTS pattern)
-- This migration is automatically detected and applied by db-patch-v2
-- in alphabetical order from the /migrations directory.

ALTER TABLE IF EXISTS site_settings
ADD COLUMN IF NOT EXISTS service_images_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS site_settings
ADD COLUMN IF NOT EXISTS service_images TEXT NOT NULL DEFAULT '{}';
