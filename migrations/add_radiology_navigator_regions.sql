-- =============================================================================
-- Migration: Anatomical Navigator regions (Phase 3)
-- Date: 2026-07-07
-- =============================================================================
-- The Quick Select study tabs double as the anatomical navigator: clicking
-- a region filters quick buttons, measurements, and suggestions. This adds
-- the remaining body regions from the Phase 3 spec that weren't already
-- seeded in Phase 1 (Brain, Spine variants, Knee, Abdomen exist).
--
-- Idempotent: ON CONFLICT DO NOTHING; admin-renamed/deleted tabs are never
-- resurrected against their will beyond this one-time seed name set.
-- =============================================================================

INSERT INTO radiology_study_tabs (name, sort_order) VALUES
  ('Head & Neck', 15),
  ('Shoulder', 65),
  ('Pelvis', 85)
ON CONFLICT (name) DO NOTHING;
