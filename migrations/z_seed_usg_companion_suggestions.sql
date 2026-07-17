-- CARE USG Companion (Phase 2) — seed the EXISTING `suggests` (co-occurrence)
-- and `conflictGroup` (mutual-exclusion) fields on USG quick findings so the
-- Companion's deterministic suggestion engine (QuickFinding.suggests + the
-- conflictingSelections primitive, both already live for Brain/Spine) also
-- works for USG. This is DATA ONLY — no new engine, no hardcoded React.
--
-- Idempotent: plain UPDATEs scoped by (study_type, label); a no-op where the
-- target rows don't exist. Only points at labels that already exist as rows so
-- the label-based resolver (findingsByLabel) can resolve them.

-- Fatty-liver grades are mutually exclusive: selecting one clears the others.
UPDATE radiology_quick_findings SET conflict_group = 'fatty_liver_grade'
  WHERE study_type = 'Whole Abdomen' AND label IN ('Fatty Liver Gr I', 'Fatty Liver Gr II', 'Fatty Liver Gr III');

-- Renal tract co-occurrence (all target labels already exist as KUB rows).
UPDATE radiology_quick_findings SET suggests = 'Renal Calculus, Ureteric Calculus'
  WHERE study_type = 'KUB' AND label = 'Hydronephrosis' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Hydronephrosis'
  WHERE study_type = 'KUB' AND label = 'Renal Calculus' AND (suggests IS NULL OR suggests = '');
UPDATE radiology_quick_findings SET suggests = 'Hydronephrosis'
  WHERE study_type = 'KUB' AND label = 'Ureteric Calculus' AND (suggests IS NULL OR suggests = '');
