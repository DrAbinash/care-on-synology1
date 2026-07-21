-- ============================================================================
-- Phase P5 — Production hardening: AI provisional-store data integrity.
-- ============================================================================
-- Additive + idempotent + deploy-safe. Closes three concurrency / immutability
-- gaps found during P5 validation:
--
--  1. (study_instance_uid, version) on ai_shadow_drafts was a PLAIN index, so two
--     concurrent pipeline jobs (auto arrival racing a reprocess/night-batch, or a
--     stale-lock requeue) could both insert the same version → duplicate "v2".
--     Upgrade to UNIQUE (the store is documented as monotonic, never-overwritten).
--  2. input_hash on ai_processing_manifests was a PLAIN index, so the
--     check-then-insert idempotency guard was racy → duplicate manifests + work.
--     Upgrade to UNIQUE (input_hash is the reprocessing idempotency key).
--  3. study_snapshots was documented "immutable" but had NO DB enforcement
--     (unlike ai_shadow_drafts). Add a column-guarded trigger that allows only
--     the legitimate supersede (is_current / superseded_at) and rejects any
--     content change or delete. Also add a TRUNCATE guard to ai_shadow_drafts
--     (its row-level append-only trigger does not fire on TRUNCATE).
--
-- Sorts alphabetically after add_ai_execution_shadow.sql (creates the tables)
-- and add_ai_provisional_report_versioning.sql (adds the version column), so the
-- unique index and triggers always run after their columns exist.
--
-- The unique-index conversions are guarded: if a deployed DB already holds
-- duplicate rows, the index is NOT created and a NOTICE is raised (reconcile
-- first) — the deploy never fails hard on legacy data.
--
-- Rollback (manual — NOT auto-applied):
--   DROP TRIGGER IF EXISTS study_snapshots_immutable_guard ON study_snapshots;
--   DROP FUNCTION IF EXISTS study_snapshots_reject_content_mutation();
--   DROP TRIGGER IF EXISTS ai_shadow_drafts_truncate_guard ON ai_shadow_drafts;
--   DROP FUNCTION IF EXISTS ai_shadow_drafts_reject_truncate();
--   -- (unique indexes can be reverted to plain with DROP INDEX + CREATE INDEX)
-- ============================================================================

-- 1. UNIQUE (study_instance_uid, version) on ai_shadow_drafts ─────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_shadow_drafts
    GROUP BY study_instance_uid, version HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'ai_shadow_drafts has duplicate (study_instance_uid, version) rows — UNIQUE index NOT created; reconcile duplicates then re-run.';
  ELSE
    DROP INDEX IF EXISTS ai_shadow_draft_uid_version_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS ai_shadow_draft_uid_version_idx
      ON ai_shadow_drafts (study_instance_uid, version);
  END IF;
END $$;

-- 2. UNIQUE (input_hash) on ai_processing_manifests ──────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_processing_manifests
    GROUP BY input_hash HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'ai_processing_manifests has duplicate input_hash rows — UNIQUE index NOT created; reconcile duplicates then re-run.';
  ELSE
    DROP INDEX IF EXISTS ai_manifest_input_hash_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS ai_manifest_input_hash_idx
      ON ai_processing_manifests (input_hash);
  END IF;
END $$;

-- 3a. study_snapshots content immutability (allow only the supersede) ─────────
CREATE OR REPLACE FUNCTION study_snapshots_reject_content_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'study_snapshots is immutable: snapshots are superseded (is_current=false), never deleted';
  END IF;
  IF NEW.content_hash        IS DISTINCT FROM OLD.content_hash
     OR NEW.instances_json   IS DISTINCT FROM OLD.instances_json
     OR NEW.revision         IS DISTINCT FROM OLD.revision
     OR NEW.study_instance_uid IS DISTINCT FROM OLD.study_instance_uid THEN
    RAISE EXCEPTION 'study_snapshots content is immutable: only is_current / superseded_at may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS study_snapshots_immutable_guard ON study_snapshots;
CREATE TRIGGER study_snapshots_immutable_guard
  BEFORE UPDATE OR DELETE ON study_snapshots
  FOR EACH ROW EXECUTE FUNCTION study_snapshots_reject_content_mutation();

-- 3b. ai_shadow_drafts TRUNCATE guard (row-level append-only trigger misses TRUNCATE)
CREATE OR REPLACE FUNCTION ai_shadow_drafts_reject_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_shadow_drafts is append-only: TRUNCATE is not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_shadow_drafts_truncate_guard ON ai_shadow_drafts;
CREATE TRIGGER ai_shadow_drafts_truncate_guard
  BEFORE TRUNCATE ON ai_shadow_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION ai_shadow_drafts_reject_truncate();
