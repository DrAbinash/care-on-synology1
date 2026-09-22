-- =============================================================================
-- Migration: radiology_worklist.updated_at indexes for incremental studio pull
-- Date: 2026-09-22
-- =============================================================================
-- GET /api/internal/reporting-studio/worklist?since=&limit=&cursor= filters on
-- COALESCE(updated_at, created_at) and keysets on id. updated_at lacked an
-- index, so the 60s studio poll timed out on full-table scans + billing joins.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS (safe on every deploy via db-patch).
-- For large production tables preferring zero-lock builds, see the CONCURRENTLY
-- twin in migrations/manual-only/ (not auto-applied).
-- =============================================================================

CREATE INDEX IF NOT EXISTS radiology_worklist_updated_at_idx
  ON radiology_worklist (updated_at);

CREATE INDEX IF NOT EXISTS radiology_worklist_updated_at_id_idx
  ON radiology_worklist (updated_at, id);
