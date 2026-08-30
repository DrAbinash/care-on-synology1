-- Phase 1 — Frozen viewport key images for Reporting Canvas R2.
-- Additive / idempotent. Extends radiology_report_key_images with provenance,
-- observation linkage, and caption-manual protection. Does not alter
-- radiology_image_references (legacy DICOM-ref path remains for old reports).

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS observation_id TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS caption_manual BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS study_instance_uid TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS series_instance_uid TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS sop_instance_uid TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS frame_number INTEGER;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS instance_number INTEGER;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS series_description TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS modality TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS viewer TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS viewport_snapshot_json TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS annotation_metadata_json TEXT;

ALTER TABLE IF EXISTS radiology_report_key_images
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS rad_key_images_observation_idx
  ON radiology_report_key_images (observation_id)
  WHERE observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rad_key_images_draft_sort_idx
  ON radiology_report_key_images (draft_id, sort_order);
