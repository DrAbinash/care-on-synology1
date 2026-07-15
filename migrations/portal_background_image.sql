-- Lets the clinic admin upload a background image for the public patient
-- portal / staff login landing page, instead of the plain default gradient.
-- See clinicSettings.ts's portalBackgroundImageDataUrl and Portal.tsx's
-- PortalRoot for where this is consumed.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS portal_background_image_data_url TEXT;
