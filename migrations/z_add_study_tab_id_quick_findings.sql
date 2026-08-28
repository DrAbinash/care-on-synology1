-- Section 4 Findings: scope Quick Findings to Study Tab ID (mirrors PR #621 protocol pattern).
-- study_type remains denormalized display; study_tab_id is authoritative after backfill.
-- Unresolved legacy rows (study_tab_id NULL) are preserved — not deleted.

ALTER TABLE radiology_quick_findings
  ADD COLUMN IF NOT EXISTS study_tab_id integer;

UPDATE radiology_quick_findings AS f
SET study_tab_id = t.id
FROM radiology_study_tabs AS t
WHERE f.study_tab_id IS NULL
  AND lower(trim(f.study_type)) = lower(trim(t.name));

-- Drop global (study_type, label) uniqueness — labels are unique per Study Tab, not globally.
DROP INDEX IF EXISTS radiology_quick_findings_study_label_uq;

CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_findings_study_tab_label_uq
  ON radiology_quick_findings (study_tab_id, lower(trim(label)))
  WHERE study_tab_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS radiology_quick_findings_legacy_study_label_uq
  ON radiology_quick_findings (lower(trim(study_type)), lower(trim(label)))
  WHERE study_tab_id IS NULL;

CREATE INDEX IF NOT EXISTS radiology_quick_findings_study_tab_idx
  ON radiology_quick_findings (study_tab_id, is_active, sort_order);
