-- ============================================================================
-- Phase P1 (SHADOW MODE) — AI execution layer tables (Gates G4/G5/G6)
-- ============================================================================
-- Four shadow-only tables. Nothing here is exposed to radiologists or merged
-- into reports in P1. Idempotent, forward/backward compatible, additive only.
-- Tables are created in FK dependency order within this file. References only
-- the pre-existing core table radiology_studies plus tables created above.
--
-- Rollback (manual — NOT auto-applied):
--   DROP TABLE IF EXISTS ai_evidence;
--   DROP TABLE IF EXISTS ai_shadow_drafts;
--   DROP TABLE IF EXISTS ai_processing_manifests;
--   DROP TABLE IF EXISTS study_snapshots;
-- ============================================================================

-- 1. Immutable Study Snapshot (one row per study revision).
CREATE TABLE IF NOT EXISTS study_snapshots (
  id                  SERIAL PRIMARY KEY,
  study_instance_uid  TEXT NOT NULL,
  radiology_study_id  INTEGER REFERENCES radiology_studies(id),
  revision            INTEGER NOT NULL DEFAULT 1,
  content_hash        TEXT NOT NULL,
  series_count        INTEGER NOT NULL DEFAULT 0,
  instance_count      INTEGER NOT NULL DEFAULT 0,
  instances_json      JSONB NOT NULL,
  is_current          BOOLEAN NOT NULL DEFAULT true,
  superseded_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS study_snapshot_uid_rev_key  ON study_snapshots (study_instance_uid, revision);
CREATE UNIQUE INDEX IF NOT EXISTS study_snapshot_uid_hash_key ON study_snapshots (study_instance_uid, content_hash);
CREATE INDEX        IF NOT EXISTS study_snapshot_uid_idx      ON study_snapshots (study_instance_uid);

-- 2. Processing Manifest (immutable reproducibility record).
CREATE TABLE IF NOT EXISTS ai_processing_manifests (
  id                          SERIAL PRIMARY KEY,
  study_snapshot_id           INTEGER NOT NULL REFERENCES study_snapshots(id),
  study_instance_uid          TEXT NOT NULL,
  snapshot_content_hash       TEXT NOT NULL,
  model_version               TEXT NOT NULL,
  prompt_version              TEXT NOT NULL,
  knowledge_pack_version      TEXT NOT NULL,
  rules_version               TEXT NOT NULL,
  measurement_engine_version  TEXT NOT NULL,
  image_selection_json        JSONB NOT NULL,
  input_hash                  TEXT NOT NULL,
  degraded                    BOOLEAN NOT NULL DEFAULT false,
  started_at                  TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_manifest_snapshot_idx   ON ai_processing_manifests (study_snapshot_id);
CREATE INDEX IF NOT EXISTS ai_manifest_input_hash_idx ON ai_processing_manifests (input_hash);
CREATE INDEX IF NOT EXISTS ai_manifest_uid_idx        ON ai_processing_manifests (study_instance_uid);

-- 3. Shadow Structured Draft (never exposed to radiologists in P1).
CREATE TABLE IF NOT EXISTS ai_shadow_drafts (
  id                  SERIAL PRIMARY KEY,
  manifest_id         INTEGER NOT NULL REFERENCES ai_processing_manifests(id),
  study_snapshot_id   INTEGER NOT NULL REFERENCES study_snapshots(id),
  study_instance_uid  TEXT NOT NULL,
  radiology_study_id  INTEGER REFERENCES radiology_studies(id),
  source              TEXT NOT NULL DEFAULT 'ai_shadow',
  draft_json          JSONB NOT NULL,
  finding_count       INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_shadow_draft_manifest_idx ON ai_shadow_drafts (manifest_id);
CREATE INDEX IF NOT EXISTS ai_shadow_draft_uid_idx      ON ai_shadow_drafts (study_instance_uid);

-- 4. Evidence Store (per-finding anchors; evidence_type 'heatmap' + overlay_ref reserved).
CREATE TABLE IF NOT EXISTS ai_evidence (
  id                   SERIAL PRIMARY KEY,
  draft_id             INTEGER NOT NULL REFERENCES ai_shadow_drafts(id),
  manifest_id          INTEGER NOT NULL REFERENCES ai_processing_manifests(id),
  finding_key          TEXT NOT NULL,
  evidence_type        TEXT NOT NULL,
  series_instance_uid  TEXT,
  sop_instance_uid     TEXT,
  frame_number         INTEGER,
  measurement_ref      TEXT,
  confidence           INTEGER,
  overlay_ref          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_evidence_draft_idx   ON ai_evidence (draft_id);
CREATE INDEX IF NOT EXISTS ai_evidence_finding_idx ON ai_evidence (finding_key);
