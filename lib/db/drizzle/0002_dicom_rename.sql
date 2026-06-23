-- DICOM node schema migration: rename pull columns + add USG fields
-- Applied manually via psql before drizzle-kit push

-- Rename old pull interval column (minutes -> seconds)
ALTER TABLE dicom_nodes
  RENAME COLUMN pull_interval_minutes TO pull_interval_seconds;

-- Convert existing values from minutes to seconds
UPDATE dicom_nodes
  SET pull_interval_seconds = COALESCE(pull_interval_seconds * 60, 300)
  WHERE pull_interval_seconds IS NOT NULL;

-- Rename old query lookback column (days -> hours)
ALTER TABLE dicom_nodes
  RENAME COLUMN pull_query_days TO query_lookback_hours;

-- Convert existing values from days to hours
UPDATE dicom_nodes
  SET query_lookback_hours = COALESCE(query_lookback_hours * 24, 24)
  WHERE query_lookback_hours IS NOT NULL;

-- Add new columns for USG / Voluson file-system import
ALTER TABLE dicom_nodes
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS watch_folder_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS processed_folder_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS failed_folder_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allow_non_dicom_images BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_upload_size_mb INTEGER NOT NULL DEFAULT 512,
  ADD COLUMN IF NOT EXISTS thumbnail_preview BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS multi_frame_support BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS acquisition_modes_json TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS matching_rules_json TEXT NOT NULL DEFAULT '{}';

-- Set the name column to ae_title for existing rows
UPDATE dicom_nodes SET name = ae_title WHERE name = '';
