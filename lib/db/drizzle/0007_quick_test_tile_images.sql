-- Quick Select Tests tile background images (/book page, step 2) + Health
-- Packages / hero photo resolveAssetUrl fixes shipped alongside this in the
-- same PR. quick_test_category_images is a JSON string map of test category
-- (biochemistry, cardiology, radiology, pathology, hematology,
-- endocrinology, serology, default) to an uploaded image URL. Categories
-- left unset keep the existing solid-gradient tile look.
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS quick_test_category_images TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quick_test_overlay_opacity INTEGER NOT NULL DEFAULT 35;
