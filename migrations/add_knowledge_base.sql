-- ── AI Receptionist Knowledge Base — Epic 1 (Knowledge Engine) ──
-- See lib/db/src/schema/knowledgeBase.ts for the Drizzle schema this
-- mirrors. Written by hand against db-patch-entrypoint.sh's idempotent
-- feature-migration path (no live DATABASE_URL was available to run
-- `drizzle-kit generate` in this environment) — every statement below
-- uses IF NOT EXISTS, per the lesson from 0006_jazzy_mojo.sql earlier
-- today, so this is safe to run on a fresh database or one that already
-- has these tables from a prior partial run.

CREATE TABLE IF NOT EXISTS knowledge_base_entries (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  suggested_from_question TEXT,
  suggested_reason TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_entries_category_idx ON knowledge_base_entries (category);
CREATE INDEX IF NOT EXISTS kb_entries_status_idx ON knowledge_base_entries (status);
CREATE INDEX IF NOT EXISTS kb_entries_category_status_idx ON knowledge_base_entries (category, status);

CREATE TABLE IF NOT EXISTS knowledge_base_history (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL DEFAULT 'edit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FK added separately and guarded, matching this codebase's established
-- pattern for adding constraints onto tables that might already exist
-- without them (see migrations/add_referral_indexes.sql for precedent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'knowledge_base_history_entry_id_fkey'
  ) THEN
    ALTER TABLE knowledge_base_history
      ADD CONSTRAINT knowledge_base_history_entry_id_fkey
      FOREIGN KEY (entry_id) REFERENCES knowledge_base_entries(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS kb_history_entry_idx ON knowledge_base_history (entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS kb_history_entry_version_uq ON knowledge_base_history (entry_id, version);

CREATE TABLE IF NOT EXISTS knowledge_base_search_log (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  matched_entry_id INTEGER,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  channel TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'knowledge_base_search_log_matched_entry_id_fkey'
  ) THEN
    ALTER TABLE knowledge_base_search_log
      ADD CONSTRAINT knowledge_base_search_log_matched_entry_id_fkey
      FOREIGN KEY (matched_entry_id) REFERENCES knowledge_base_entries(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS kb_search_log_matched_idx ON knowledge_base_search_log (matched);
CREATE INDEX IF NOT EXISTS kb_search_log_created_at_idx ON knowledge_base_search_log (created_at);
