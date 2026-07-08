-- =============================================================================
-- Migration: Billing desk save-and-print latency indexes
-- Date: 2026-07-08
-- =============================================================================
-- The bill save path runs four "MAX + 1" sequence allocators on every save:
-- bill number, queue token, per-department test tokens, and radiology
-- accession numbers. None of them could use an existing index, so each one
-- degraded into a scan that grows with table size — directly adding to the
-- time the billing desk waits before the receipt prints.
--
-- All statements are IF NOT EXISTS — safe to run on every deployment.
-- =============================================================================

-- generateBillNumber() runs on EVERY bill save (and on the billing desk's
-- next-number preview):
--   SELECT MAX(bill_number) FROM bills WHERE bill_number ~ '^[0-9]+$'
-- The regex predicate cannot use the plain idx_bills_bill_number btree
-- efficiently, and the query runs INSIDE the bill-creation transaction, so it
-- also serializes concurrent saves. A partial index whose predicate matches
-- the query exactly turns the MAX into a single backward index probe.
CREATE INDEX IF NOT EXISTS idx_bills_bill_number_numeric
  ON bills (bill_number DESC)
  WHERE bill_number ~ '^[0-9]+$';

-- Double-billing guard: "same patient billed in the last 60s" runs on every
-- save (patient_id + created_at + status). idx_bills_patient_id alone forces
-- a heap re-check of every historical bill of that patient.
CREATE INDEX IF NOT EXISTS idx_bills_patient_created
  ON bills (patient_id, created_at DESC);

-- Queue-token allocator (tokens.ts generateTokenForBill): the INSERT computes
-- MAX(token_no) per (token_date, ledger). tokens only had the COALESCE-based
-- unique index, which the planner cannot use for these predicates.
CREATE INDEX IF NOT EXISTS idx_tokens_date_ledger_no
  ON tokens (token_date, ledger_id, token_no);

-- Per-department token allocator (test-tokens.ts generateTestToken): the
-- INSERT computes MAX(token_no) per (token_date, department, ledger).
-- Complements idx_test_tokens_date_dept_status, which lacks token_no and so
-- cannot answer the MAX from the index alone.
CREATE INDEX IF NOT EXISTS idx_test_tokens_date_dept_no
  ON test_tokens (token_date, department, token_no);

-- Accession-number allocator (radiology.ts nextAccessionNumber):
--   ... WHERE accession_number LIKE 'ACC-<yyyymmdd>-<modality>-%'
-- The unique index on accession_number uses the database's default collation,
-- which cannot serve LIKE prefix scans; text_pattern_ops can.
CREATE INDEX IF NOT EXISTS idx_radiology_studies_accession_prefix
  ON radiology_studies (accession_number text_pattern_ops);
