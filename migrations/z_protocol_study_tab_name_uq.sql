-- Section 3 Technique: scope protocol name uniqueness per Study Tab (not global).
-- Safe migration — backfill study_tab_id, drop global name unique, add scoped uniques.
-- Unresolved legacy rows (study_tab_id NULL) keep (study_type, normalized name) uniqueness.

ALTER TABLE radiology_protocols
  ADD COLUMN IF NOT EXISTS study_tab_id integer;

UPDATE radiology_protocols AS p
SET study_tab_id = t.id
FROM radiology_study_tabs AS t
WHERE p.study_tab_id IS NULL
  AND lower(trim(p.study_type)) = lower(trim(t.name));

DROP INDEX IF EXISTS radiology_protocols_name_uq;

CREATE UNIQUE INDEX IF NOT EXISTS radiology_protocols_study_tab_name_uq
  ON radiology_protocols (study_tab_id, lower(trim(name)))
  WHERE study_tab_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS radiology_protocols_legacy_study_name_uq
  ON radiology_protocols (lower(trim(study_type)), lower(trim(name)))
  WHERE study_tab_id IS NULL;

CREATE INDEX IF NOT EXISTS radiology_protocols_study_tab_idx
  ON radiology_protocols (study_tab_id, is_active, sort_order);
