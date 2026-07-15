-- =============================================================================
-- Migration: Smart Findings — section-mapping corrections (Phase 6.1)
-- Date: 2026-07-15
-- =============================================================================
-- Corrects two things seeded by z_add_radiology_smart_findings_engine.sql (which
-- is already merged, so per the feature-migration rules it cannot be re-applied
-- in place — this new file carries the fix for both fresh and existing DBs):
--
--   1. Findings whose anatomical_section named a section that does NOT exist in
--      the MRI templates ("Spinal Canal", "Intervertebral Discs", "Sellar
--      Region") created a literally-named section instead of flipping a real
--      template section. Route them to the empty value so the workspace files
--      them under the clearly-labelled "Additional Observations" catch-all
--      rather than a section that looks like — but isn't — a template section.
--
--   2. The "Compression Fracture" finding text left a dangling fragment when
--      chronicity was unset ("…loss of height. based on marrow signal.") because
--      the render engine only strips the {level}/{value}/{side} chunks. Reword
--      to a form that renders cleanly with or without the chips.
--
-- Guarded so an admin's later edits are never overwritten (each UPDATE only
-- fires when the column still holds the exact original seeded value). Idempotent.
-- =============================================================================

-- ── 1. Route non-template sections to the catch-all ("" → Additional Observations)
UPDATE radiology_quick_findings SET anatomical_section = ''
  WHERE anatomical_section IN ('Spinal Canal', 'Intervertebral Discs', 'Sellar Region')
    AND label IN (
      'Disc desiccation', 'Canal narrowing', 'Canal Stenosis',
      'Foraminal Narrowing', 'Nerve Root Compression', 'Pituitary Lesion', 'Empty Sella'
    );

-- ── 2. Fix the Compression Fracture dangling-fragment text ────────────────────
UPDATE radiology_quick_findings
  SET finding_text = 'Wedge compression of the {level} vertebral body with loss of height.',
      impression_text = 'Compression fracture at {level}.',
      properties = 'level'
  WHERE study_type = 'LS Spine' AND label = 'Compression Fracture'
    AND finding_text = 'Wedge compression of the {level} vertebral body with loss of height. {chronicity} based on marrow signal.';
