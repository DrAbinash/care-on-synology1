-- ============================================================================
-- P3 completion patch — make ai_shadow_drafts the IMMUTABLE, VERSIONED
-- structured provisional report store (Gates G5/G11 storage requirement).
-- ============================================================================
-- Additive + idempotent. Adds the explicit version + link columns and a
-- DB-enforced immutability trigger (append-only: UPDATE/DELETE are rejected, so
-- regeneration can only ever INSERT a new version — an old AI draft is never
-- overwritten). ai_shadow_drafts is insert-only in code today, so the trigger
-- breaks nothing. This is NOT the human report store; accepted content lives in
-- radiology_report_drafts and finalizes into patient_reports via the existing
-- radiologist workflow.
--
-- Rollback (manual — NOT auto-applied):
--   DROP TRIGGER IF EXISTS ai_shadow_drafts_immutable_guard ON ai_shadow_drafts;
--   DROP FUNCTION IF EXISTS ai_shadow_drafts_reject_mutation();
--   ALTER TABLE ai_shadow_drafts
--     DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS canonical_study_id,
--     DROP COLUMN IF EXISTS snapshot_revision, DROP COLUMN IF EXISTS ai_job_id,
--     DROP COLUMN IF EXISTS model_digest, DROP COLUMN IF EXISTS prompt_version,
--     DROP COLUMN IF EXISTS validated;
-- ============================================================================

ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS version           INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS canonical_study_id INTEGER;
ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS snapshot_revision  INTEGER;
ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS ai_job_id          INTEGER;
ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS model_digest       TEXT;
ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS prompt_version     TEXT;
ALTER TABLE ai_shadow_drafts ADD COLUMN IF NOT EXISTS validated          BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS ai_shadow_draft_uid_version_idx ON ai_shadow_drafts (study_instance_uid, version);

-- Immutability: reject any UPDATE or DELETE on the provisional report store.
CREATE OR REPLACE FUNCTION ai_shadow_drafts_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_shadow_drafts is append-only: the AI provisional report is immutable and versioned (regeneration inserts a new version)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_shadow_drafts_immutable_guard ON ai_shadow_drafts;
CREATE TRIGGER ai_shadow_drafts_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_shadow_drafts
  FOR EACH ROW EXECUTE FUNCTION ai_shadow_drafts_reject_mutation();
