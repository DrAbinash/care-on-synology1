-- Premium / letter-pad layout knobs for key images + demography alignment.
-- Additive; safe to re-run. Defaults match the fixed print layout.
-- Rollback:
--   ALTER TABLE radiology_institutional_styles DROP COLUMN IF EXISTS key_image_fit;
--   ALTER TABLE radiology_institutional_styles DROP COLUMN IF EXISTS key_image_aspect;
--   ALTER TABLE radiology_institutional_styles DROP COLUMN IF EXISTS demography_align;

ALTER TABLE radiology_institutional_styles
  ADD COLUMN IF NOT EXISTS key_image_fit text NOT NULL DEFAULT 'contain';
ALTER TABLE radiology_institutional_styles
  ADD COLUMN IF NOT EXISTS key_image_aspect text NOT NULL DEFAULT 'square';
ALTER TABLE radiology_institutional_styles
  ADD COLUMN IF NOT EXISTS demography_align text NOT NULL DEFAULT 'extreme_right';
