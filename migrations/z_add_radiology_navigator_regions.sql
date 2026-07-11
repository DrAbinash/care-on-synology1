-- =============================================================================
-- Migration: Anatomical Navigator regions (Phase 3)
-- Date: 2026-07-07
-- Safe/idempotent version
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'radiology_study_tabs'
  ) THEN

    INSERT INTO radiology_study_tabs (name, sort_order) VALUES
      ('Head & Neck', 15),
      ('Shoulder', 65),
      ('Pelvis', 85)
    ON CONFLICT (name) DO NOTHING;

  ELSE
    RAISE WARNING 'Table radiology_study_tabs does not exist; skipping anatomical navigator region seed';
  END IF;
END $$;
