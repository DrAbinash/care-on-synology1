-- R1.1 — Enterprise report presentation foundation. Additive and idempotent.
--
-- radiology_image_references gains the DICOM identifier triple + frame +
-- display order so report key images persist as REFERENCES (resolved
-- server-side at render time), never as browser blob URLs. The existing
-- `description` column doubles as the caption.

ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS study_instance_uid TEXT;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS series_instance_uid TEXT;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS sop_instance_uid TEXT;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS frame_number INTEGER;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS rad_img_refs_draft_order_idx
  ON radiology_image_references(draft_id, display_order);
