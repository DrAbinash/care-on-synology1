-- Harden Study Tab children with stable study_tab_id (Clinical History + Protocols/Technique).
-- study_type remains for display / legacy seeds; study_tab_id is authoritative after backfill.
-- Unmatched legacy rows keep study_tab_id NULL and are not deleted.

ALTER TABLE radiology_clinical_history_chips
  ADD COLUMN IF NOT EXISTS study_tab_id integer;

ALTER TABLE radiology_protocols
  ADD COLUMN IF NOT EXISTS study_tab_id integer;

UPDATE radiology_clinical_history_chips AS c
SET study_tab_id = t.id
FROM radiology_study_tabs AS t
WHERE c.study_tab_id IS NULL
  AND lower(trim(c.study_type)) = lower(trim(t.name));

UPDATE radiology_protocols AS p
SET study_tab_id = t.id
FROM radiology_study_tabs AS t
WHERE p.study_tab_id IS NULL
  AND lower(trim(p.study_type)) = lower(trim(t.name));

CREATE INDEX IF NOT EXISTS radiology_clinical_history_chips_study_tab_idx
  ON radiology_clinical_history_chips (study_tab_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS radiology_protocols_study_tab_idx
  ON radiology_protocols (study_tab_id, is_active, sort_order);
