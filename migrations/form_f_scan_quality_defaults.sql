-- Form F / ID-card scan quality: sharper JPEG + larger working width so OCR
-- (Ollama / Gemini / Tesseract) gets more legible text from webcam captures.
-- Safe to re-run: SET DEFAULT is idempotent; UPDATE only touches rows still on
-- the old seed defaults (85 / 1200). Applied automatically by care-db-patch-v2
-- (see HOW_TO_ADD_DB_MIGRATIONS.md — no manual psql on Synology deploy).

ALTER TABLE IF EXISTS clinic_settings
  ALTER COLUMN jpeg_quality SET DEFAULT 92;

ALTER TABLE IF EXISTS clinic_settings
  ALTER COLUMN max_scan_width SET DEFAULT 2000;

-- Raise existing installs that still have the old weak seed defaults.
-- Do not overwrite clinics that intentionally set other values.
UPDATE clinic_settings
SET jpeg_quality = 92
WHERE jpeg_quality = 85;

UPDATE clinic_settings
SET max_scan_width = 2000
WHERE max_scan_width = 1200;
