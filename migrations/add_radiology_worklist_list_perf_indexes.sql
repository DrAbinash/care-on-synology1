-- =============================================================================
-- Migration: radiology_worklist list-path performance indexes
-- Date: 2026-09-04
-- =============================================================================
-- GET /api/radiology/pacs-worklist frequently filters/orders by modality,
-- study_date, created_at, and joins on study_id. Those columns lacked indexes.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS (safe on every deploy).
-- For large production tables preferring zero-lock builds, see the CONCURRENTLY
-- twin in migrations/manual-only/ (not auto-applied).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_radiology_worklist_modality
  ON radiology_worklist (modality);

CREATE INDEX IF NOT EXISTS idx_radiology_worklist_study_date
  ON radiology_worklist (study_date);

CREATE INDEX IF NOT EXISTS idx_radiology_worklist_created_at
  ON radiology_worklist (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_radiology_worklist_study_id
  ON radiology_worklist (study_id)
  WHERE study_id IS NOT NULL;

-- Common list filter: modality + study_date range / order
CREATE INDEX IF NOT EXISTS idx_radiology_worklist_modality_study_date
  ON radiology_worklist (modality, study_date DESC);

-- USG list aggregates: DISTINCT ON (worklist_id) … ORDER BY updated_at DESC
-- needs a composite supporting index (worklist_id alone is insufficient).
CREATE INDEX IF NOT EXISTS idx_usg_report_drafts_worklist_updated
  ON usg_report_drafts (worklist_id, updated_at DESC);
