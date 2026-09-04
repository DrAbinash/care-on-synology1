-- Manual-only CONCURRENTLY twin of add_radiology_worklist_list_perf_indexes.sql
-- Not auto-applied. Run outside a transaction on large production DBs.
--
--   psql -U erp -d diagnostic_erp -f migrations/manual-only/add_radiology_worklist_list_perf_indexes_concurrently.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_worklist_modality
  ON radiology_worklist (modality);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_worklist_study_date
  ON radiology_worklist (study_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_worklist_created_at
  ON radiology_worklist (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_worklist_study_id
  ON radiology_worklist (study_id)
  WHERE study_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_worklist_modality_study_date
  ON radiology_worklist (modality, study_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usg_report_drafts_worklist_updated
  ON usg_report_drafts (worklist_id, updated_at DESC);
