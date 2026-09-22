-- Manual-only CONCURRENTLY twin of add_radiology_worklist_updated_at_indexes.sql
-- Not auto-applied. Run outside a transaction on large production DBs.
--
--   psql -U erp -d diagnostic_erp -f migrations/manual-only/add_radiology_worklist_updated_at_indexes_concurrently.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS radiology_worklist_updated_at_idx
  ON radiology_worklist (updated_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS radiology_worklist_updated_at_id_idx
  ON radiology_worklist (updated_at, id);
