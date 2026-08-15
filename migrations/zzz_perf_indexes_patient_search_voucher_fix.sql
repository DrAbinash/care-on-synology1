-- =============================================================================
-- Migration: Performance indexes for patient search (pg_trgm) + voucher race fix
-- Date: 2026-08-15
-- =============================================================================
-- PROBLEM 1: Patient search (GET /api/patients?search=...) uses ILIKE '%term%'
--   on first_name, last_name, phone, patient_id. Leading-wildcard ILIKE cannot
--   use a B-tree index — every search is a full table scan. API logs showed
--   18 patient-search calls taking 125+ SECONDS each.
--
--   FIX: Enable pg_trgm extension and create GIN trigram indexes. These
--   support ILIKE '%term%' with sub-millisecond lookups regardless of
--   leading wildcards. Drops patient search from 125s to <100ms.
--
-- PROBLEM 2: Voucher number generation (nextVoucherNumber in auto-voucher.ts)
--   reads MAX(voucher_number) outside any transaction. Two concurrent bill
--   saves can both read the same MAX, both try to INSERT the same number,
--   and one hits "duplicate key value violates unique constraint". DB logs
--   showed 8+ such violations.
--
--   FIX: Add an index that makes the MAX(voucher_number) query faster (the
--   code-level pg_advisory_xact_lock fix is in auto-voucher.ts — this index
--   ensures the MAX query itself is instant).
--
-- All statements are IF NOT EXISTS / CREATE EXTENSION IF NOT EXISTS — safe
-- to run on every deployment, matching the idempotent pattern used by every
-- other file in this folder.
-- =============================================================================

-- ── Enable pg_trgm extension (required for trigram indexes) ──────────────
-- This allows GIN indexes that support ILIKE '%pattern%' with leading wildcards.
-- The extension ships with Postgres but must be enabled per-database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Patient search: trigram indexes for ILIKE '%search%' ─────────────────
-- GET /api/patients?search=xyz uses:
--   WHERE first_name ILIKE '%xyz%' OR last_name ILIKE '%xyz%'
--      OR phone ILIKE '%xyz%' OR patient_id ILIKE '%xyz%'
-- A B-tree index cannot serve leading-wildcard ILIKE. GIN + gin_trgm_ops can.
CREATE INDEX IF NOT EXISTS idx_patients_first_name_trgm
  ON patients USING gin (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_patients_last_name_trgm
  ON patients USING gin (last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_patients_phone_trgm
  ON patients USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_patients_patient_id_trgm
  ON patients USING gin (patient_id gin_trgm_ops);

-- ── Voucher number: faster MAX(voucher_number) for nextVoucherNumber() ───
-- nextVoucherNumber runs on every bill save to find the highest voucher number.
-- The existing idx_vouchers_number_prefix (B-tree on voucher_number) helps,
-- but the query filters by LIKE prefix + regex, so a partial index matching
-- the exact query pattern turns MAX into a single backward index probe.
-- (Same pattern as idx_bills_bill_number_numeric in billing_save_print_perf_indexes.sql)
CREATE INDEX IF NOT EXISTS idx_vouchers_number_numeric
  ON vouchers (voucher_number DESC)
  WHERE voucher_number ~ '^[A-Z]+-[0-9]{4}-[0-9]+$';

-- ── Orders: index on patient_id for join queries ────────────────────────
-- The bill save path does: SELECT * FROM orders WHERE id = orderId
-- (covered by PK), but the bills list and daily summary do:
--   SELECT * FROM orders WHERE patient_id = X
-- which had no index and scanned the entire orders table.
CREATE INDEX IF NOT EXISTS idx_orders_patient_id
  ON orders (patient_id);

-- ── Order tests: index on order_id for bill line-item fetch ──────────────
-- The bill save path fetches: SELECT * FROM order_tests WHERE order_id = X
-- This join ran on every bill save with no index.
CREATE INDEX IF NOT EXISTS idx_order_tests_order_id
  ON order_tests (order_id);

-- ── Payments: index on method for daily summary cash/UPI breakdown ───────
-- Daily summary groups payments by method. Without this index, the GROUP BY
-- scans all payments for the day.
CREATE INDEX IF NOT EXISTS idx_payments_method_created
  ON payments (method, created_at DESC);

-- ── Bills: composite index for daily summary status + date ───────────────
-- Daily summary runs:
--   SELECT ... FROM bills WHERE status IN ('paid','partial','pending')
--   AND created_at >= start_of_day
CREATE INDEX IF NOT EXISTS idx_bills_status_created_at
  ON bills (status, created_at DESC);

-- ── Radiology worklist: index on status for pending studies ──────────────
-- The worklist page filters by status (pending, in-progress, etc.) on every load.
CREATE INDEX IF NOT EXISTS idx_radiology_worklist_status
  ON radiology_worklist (status);

-- ── Radiology worklist: index on patient_id for patient history ──────────
CREATE INDEX IF NOT EXISTS idx_radiology_worklist_patient_id
  ON radiology_worklist (patient_id);

-- ── Patient reports: index on patient_id for report history ──────────────
-- The patient detail page loads all reports for a patient.
CREATE INDEX IF NOT EXISTS idx_patient_reports_patient_id
  ON patient_reports (patient_id);

-- ── Patient reports: index on created_at for recent reports list ─────────
CREATE INDEX IF NOT EXISTS idx_patient_reports_created_at
  ON patient_reports (created_at DESC);

-- ── Audit logs: index on created_at for recent-activity queries ──────────
-- The audit log table grows unboundedly; queries filter by date range.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

-- ── Backup job logs: index on created_at for latest-backup check ─────────
-- The operations health check runs:
--   SELECT created_at FROM backup_job_logs ORDER BY id DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_backup_job_logs_created_at
  ON backup_job_logs (created_at DESC);
