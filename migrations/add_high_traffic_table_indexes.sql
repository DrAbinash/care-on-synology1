-- =============================================================================
-- Migration: Add missing indexes on the highest-traffic ERP tables
-- Date: 2026-07-06
-- =============================================================================
-- Investigation finding: patients, appointments, and orders had NO indexes
-- at all beyond their primary key / unique constraints — every lookup by
-- patient, doctor, date, or status on these tables was a full sequential
-- scan. bills/payments already got partial coverage in
-- add_performance_indexes.sql (2026-06-26); this migration fills the
-- remaining gaps (FK join columns, date-range filters, phone search) on
-- patients, appointments, orders, and the bills/payments FK columns that
-- were still missing.
--
-- All statements are IF NOT EXISTS — safe to run on every deployment,
-- matching the idempotent pattern used by every other file in this folder.
-- =============================================================================

-- ── patients ─────────────────────────────────────────────────────────────
-- Reception search-by-phone is one of the most frequent queries in the app
-- (patient lookup at check-in, billing, WhatsApp receptionist).
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients (phone);
-- Date-range/report queries and "recently registered" views.
CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients (created_at);
-- Name search (reception typeahead).
CREATE INDEX IF NOT EXISTS idx_patients_last_first_name ON patients (last_name, first_name);

-- ── appointments ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id ON appointments (doctor_id);
-- The appointments page/queue filters by date + status on nearly every load.
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (appointment_date, status);

-- ── orders ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_patient_id ON orders (patient_id);
CREATE INDEX IF NOT EXISTS idx_orders_doctor_id ON orders (doctor_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);

-- ── order_tests ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_order_tests_order_id ON order_tests (order_id);
CREATE INDEX IF NOT EXISTS idx_order_tests_test_id ON order_tests (test_id);

-- ── bills / payments — FK columns not yet covered by add_performance_indexes.sql
CREATE INDEX IF NOT EXISTS idx_bills_patient_id ON bills (patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_order_id ON bills (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill_id ON payments (bill_id);

-- ── test_tokens (queue/TV kiosk displays poll this table every few seconds —
--    a missing index here means every waiting-room TV screen refresh does a
--    full table scan, which compounds under concurrent kiosk + reception load)
CREATE INDEX IF NOT EXISTS idx_test_tokens_date_dept_status ON test_tokens (token_date, department, status);
CREATE INDEX IF NOT EXISTS idx_test_tokens_patient_id ON test_tokens (patient_id);
CREATE INDEX IF NOT EXISTS idx_test_tokens_bill_id ON test_tokens (bill_id);
