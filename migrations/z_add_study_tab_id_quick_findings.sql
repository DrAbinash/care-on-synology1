-- Harden Quick Findings with stable study_tab_id (Section 4 Findings).
-- study_type remains for display / legacy seeds; study_tab_id is authoritative after backfill.
-- Unmatched legacy rows keep study_tab_id NULL and are not deleted.

ALTER TABLE radiology_quick_findings
  ADD COLUMN IF NOT EXISTS study_tab_id integer;

UPDATE radiology_quick_findings AS f
SET study_tab_id = t.id
FROM radiology_study_tabs AS t
WHERE f.study_tab_id IS NULL
  AND lower(trim(f.study_type)) = lower(trim(t.name));

CREATE INDEX IF NOT EXISTS radiology_quick_findings_study_tab_idx
  ON radiology_quick_findings (study_tab_id, is_active, sort_order);
