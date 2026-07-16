-- CARE Knowledge Pack Engine — the knowledge_packs registry table.
-- A pack is a named/versioned MANIFEST that references existing per-study-type
-- content (quick findings / protocols / history / measurements / impression
-- rules / templates / teaching / knowledge) by its live string keys. It does
-- NOT copy that content. Purely additive; no behaviour change.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS knowledge_packs (
  id                 SERIAL PRIMARY KEY,
  pack_id            TEXT NOT NULL UNIQUE,
  modality           TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT '',

  study_type         TEXT,
  builder_type       TEXT,
  body_part          TEXT,
  knowledge_category TEXT,

  version            TEXT NOT NULL DEFAULT '1.0.0',
  author             TEXT NOT NULL DEFAULT 'CARE Radiology',
  status             TEXT NOT NULL DEFAULT 'enabled',
  is_system          BOOLEAN NOT NULL DEFAULT FALSE,

  depends_on_json    TEXT NOT NULL DEFAULT '[]',
  manifest_json      TEXT NOT NULL DEFAULT '{}',

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_packs_modality_idx   ON knowledge_packs (modality);
CREATE INDEX IF NOT EXISTS knowledge_packs_status_idx     ON knowledge_packs (status);
CREATE INDEX IF NOT EXISTS knowledge_packs_study_type_idx ON knowledge_packs (study_type);
