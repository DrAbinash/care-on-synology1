-- Form F / ID-card scan quality: sharper JPEG + larger working width so OCR
-- (Ollama / Gemini / Tesseract) gets more legible text from webcam captures.
ALTER TABLE clinic_settings
  ALTER COLUMN jpeg_quality SET DEFAULT 92;

ALTER TABLE clinic_settings
  ALTER COLUMN max_scan_width SET DEFAULT 2000;

-- Raise existing installs that still have the old weak seed defaults.
-- Do not overwrite clinics that intentionally set other values.
UPDATE clinic_settings
SET jpeg_quality = 92
WHERE jpeg_quality = 85;

UPDATE clinic_settings
SET max_scan_width = 2000
WHERE max_scan_width = 1200;
