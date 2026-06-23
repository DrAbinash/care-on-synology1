-- =====================================================================
-- ERP Database Optimizations Migration
-- Generated: 2026-06-24
-- Covers:
--   1. Missing Indexes (11 tables)
--   2. 3-Table Study Overlap → v_unified_worklist VIEW
--   3. 2 Session Table Cleanup (portal_sessions absorbs user_sessions)
-- =====================================================================
-- IMPORTANT: Run on PostgreSQL. Safe to run multiple times (IF NOT EXISTS).
-- No DROP or DELETE statements. No schema breaking changes.
-- =====================================================================


-- =====================================================================
-- PART 1: MISSING INDEXES
-- =====================================================================

-- audit_logs — date-range + user-action queries
CREATE INDEX IF NOT EXISTS audit_logs_created_idx
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_user_action_idx
  ON audit_logs (user_id, action);

-- bills — daily dashboard queries
CREATE INDEX IF NOT EXISTS bills_status_date_idx
  ON bills (status, created_at DESC);

CREATE INDEX IF NOT EXISTS bills_ledger_date_idx
  ON bills (ledger_id, created_at DESC);

-- payments — daily payment reports
CREATE INDEX IF NOT EXISTS payments_created_idx
  ON payments (created_at DESC);

-- portal_sessions — cleanup + user session lookup
CREATE INDEX IF NOT EXISTS portal_sessions_expires_idx
  ON portal_sessions (expires_at, is_active);

CREATE INDEX IF NOT EXISTS portal_sessions_user_idx
  ON portal_sessions (user_id, is_active)
  WHERE scope = 'staff';

-- pacs_settings — prevent duplicate keys
CREATE UNIQUE INDEX IF NOT EXISTS pacs_settings_key_cat_uq
  ON pacs_settings (key, category)
  WHERE category IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pacs_settings_key_uq
  ON pacs_settings (key)
  WHERE category IS NULL;

-- test_tokens — queue display (compound index for per-date + ledger + status)
CREATE INDEX IF NOT EXISTS test_tokens_date_ledger_status_idx
  ON test_tokens (token_date, ledger_id, status);

-- bank_transactions — reconciliation queries
CREATE INDEX IF NOT EXISTS bank_txn_recon_idx
  ON bank_transactions (reconciliation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS bank_txn_account_date_idx
  ON bank_transactions (bank_account_id, transaction_date DESC);

-- reconciliation_logs — pending resolution queue
CREATE INDEX IF NOT EXISTS recon_logs_status_idx
  ON reconciliation_logs (status, created_at DESC);

-- fraud_alerts — alert dashboard
CREATE INDEX IF NOT EXISTS fraud_alerts_status_severity_idx
  ON fraud_alerts (status, severity, created_at DESC);

-- dicom_pull_jobs — pending job pickup by agent
CREATE INDEX IF NOT EXISTS dicom_pull_jobs_status_idx
  ON dicom_pull_jobs (status, created_at DESC)
  WHERE status = 'pending';

-- scan_sessions — cleanup old sessions
CREATE INDEX IF NOT EXISTS scan_sessions_expires_idx
  ON scan_sessions (expires_at);


-- =====================================================================
-- PART 2: 3-TABLE STUDY OVERLAP → v_unified_worklist VIEW
--
-- Problem:
--   radiology_studies  (RIS: billing-linked, source of truth for orders)
--   radiology_worklist (PACS-side worklist from Orthanc/Conquest pulls)
--   dicom_studies      (canonical PACS study registry, Phase 9+)
--
-- Solution:
--   Create a unified view that merges all three by accession_number.
--   Billing data always comes from radiology_studies.
--   PACS/image data prefers dicom_studies, falls back to radiology_worklist.
--   Callers can use this view instead of hitting all 3 tables.
-- =====================================================================

CREATE OR REPLACE VIEW v_unified_worklist AS
SELECT
  -- ── Identity ──
  COALESCE(rs.accession_number, ds.accession_number, rw.accession_number) AS accession_number,
  COALESCE(rs.study_instance_uid, ds.study_instance_uid, rw.study_instance_uid) AS study_instance_uid,

  -- ── RIS data (billing-authoritative) ──
  rs.id                      AS ris_study_id,
  rs.bill_id,
  rs.order_id,
  rs.order_test_id,
  rs.patient_id              AS ris_patient_id,
  rs.test_id,
  rs.status                  AS ris_status,
  rs.study_date,
  rs.modality                AS ris_modality,
  rs.department,
  rs.room_number,
  rs.technician_id,
  rs.technician_name,
  rs.assigned_radiologist_id AS ris_radiologist_id,
  rs.assigned_radiologist_name AS ris_radiologist_name,
  rs.claimed_at,
  rs.clinical_history,
  rs.prelim_report,
  rs.prelim_reported_by,
  rs.prelim_reported_at,
  rs.final_report,
  rs.final_reported_by,
  rs.final_reported_at,
  rs.priority                AS ris_priority,
  rs.priority_reason,
  rs.pacs_archive_status,
  rs.body_part               AS ris_body_part,
  rs.study_description       AS ris_study_description,
  rs.scheduled_station_ae_title,
  rs.referring_doctor        AS ris_referring_doctor,

  -- ── PACS / DICOM data (dicom_studies preferred, radiology_worklist fallback) ──
  ds.id                      AS dicom_study_id,
  COALESCE(ds.patient_id, rw.patient_id) AS pacs_patient_id,
  COALESCE(ds.patient_name, rw.patient_name) AS patient_name,
  COALESCE(ds.patient_age, rw.patient_age) AS patient_age,
  COALESCE(ds.patient_sex, rw.patient_sex) AS patient_sex,
  COALESCE(ds.modality, rw.modality) AS pacs_modality,
  COALESCE(ds.study_date, rw.study_date) AS pacs_study_date,
  COALESCE(ds.study_description, rw.study_description) AS pacs_study_description,
  COALESCE(ds.referring_doctor, rw.referring_doctor) AS pacs_referring_doctor,
  COALESCE(ds.body_part_examined, rw.body_part_examined) AS pacs_body_part,
  COALESCE(ds.number_of_images, rw.number_of_images) AS number_of_images,
  COALESCE(ds.number_of_series, 0) AS number_of_series,
  ds.ingest_status,
  ds.ingest_source,
  ds.link_status,
  ds.link_confidence,
  ds.report_status           AS pacs_report_status,
  ds.assigned_radiologist_id AS pacs_radiologist_id,
  ds.priority                AS pacs_priority,
  ds.sync_status,
  ds.last_sync_at,
  ds.dicom_metadata,

  -- ── Worklist-only fallback fields ──
  rw.id                      AS worklist_id,
  rw.status                  AS worklist_status,

  -- ── Computed unified fields ──
  -- Effective modality: prefer RIS (billing-confirmed), then PACS
  COALESCE(rs.modality, ds.modality, rw.modality) AS modality,
  -- Effective patient_id: RIS first (confirmed match), then PACS match
  COALESCE(rs.patient_id, ds.patient_id, rw.patient_id) AS patient_id,
  -- Effective priority
  COALESCE(rs.priority, ds.priority) AS priority,
  -- Source flags for debugging
  (rs.id IS NOT NULL) AS has_ris_entry,
  (ds.id IS NOT NULL) AS has_dicom_entry,
  (rw.id IS NOT NULL) AS has_worklist_entry,
  -- Overall completion status (for worklist display)
  CASE
    WHEN rs.status = 'reported_final' OR ds.report_status = 'finalized' THEN 'finalized'
    WHEN rs.status = 'reported_preliminary'                              THEN 'prelim_reported'
    WHEN rs.status = 'in_progress'                                       THEN 'in_progress'
    WHEN rs.status = 'acquired'                                          THEN 'acquired'
    WHEN ds.ingest_status = 'ingested'                                   THEN 'images_available'
    WHEN rs.status = 'scheduled'                                         THEN 'scheduled'
    ELSE 'unknown'
  END AS unified_status

FROM
  radiology_studies rs

  FULL OUTER JOIN dicom_studies ds
    ON  COALESCE(rs.accession_number, '')  = COALESCE(ds.accession_number, '')
    AND COALESCE(rs.accession_number, '') != ''

  FULL OUTER JOIN radiology_worklist rw
    ON  COALESCE(rs.accession_number, ds.accession_number, '')
      = COALESCE(rw.accession_number, '')
    AND COALESCE(rs.accession_number, ds.accession_number, '') != ''
;

-- Convenience filtered view: only today's studies (fast dashboard load)
CREATE OR REPLACE VIEW v_today_worklist AS
SELECT *
FROM   v_unified_worklist
WHERE  study_date = CURRENT_DATE
    OR pacs_study_date = TO_CHAR(CURRENT_DATE, 'YYYYMMDD');


-- =====================================================================
-- PART 3: SESSION TABLE CLEANUP
--
-- Problem:
--   portal_sessions — primary session table (scope = 'staff' or 'patient')
--   user_sessions   — parallel fingerprint/bridge login sessions
--
-- Solution:
--   Add login_method + bridge_session_id columns to portal_sessions
--   so fingerprint sessions can live there with their extra context.
--   user_sessions is NOT dropped (preserve data / active bridge routes).
--   A view v_active_sessions merges both for monitoring.
-- =====================================================================

-- Add login_method to portal_sessions if not already present
-- (guards against re-running migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'portal_sessions'
    AND    column_name = 'login_method'
  ) THEN
    ALTER TABLE portal_sessions
      ADD COLUMN login_method TEXT NOT NULL DEFAULT 'pin';
  END IF;
END
$$;

-- Add bridge_session_ref for cross-reference (nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'portal_sessions'
    AND    column_name = 'bridge_session_ref'
  ) THEN
    ALTER TABLE portal_sessions
      ADD COLUMN bridge_session_ref INTEGER;  -- FK → user_sessions.id when bridged
  END IF;
END
$$;

-- Unified active sessions monitoring view (read-only, for super admin panel)
CREATE OR REPLACE VIEW v_active_sessions AS
SELECT
  'portal'        AS session_source,
  ps.id           AS session_id,
  ps.token,
  ps.user_id,
  u.name          AS user_name,
  u.role          AS user_role,
  ps.scope,
  ps.login_method,
  ps.expires_at,
  ps.is_active,
  ps.created_at
FROM portal_sessions ps
LEFT JOIN users u ON u.id = ps.user_id
WHERE ps.is_active = true
  AND ps.expires_at > NOW()

UNION ALL

SELECT
  'bridge'        AS session_source,
  us.id           AS session_id,
  us.token,
  us.user_id,
  u.name          AS user_name,
  u.role          AS user_role,
  'staff'         AS scope,
  us.login_method,
  us.expires_at,
  us.is_active,
  us.created_at
FROM user_sessions us
LEFT JOIN users u ON u.id = us.user_id
WHERE us.is_active = true
  AND us.expires_at > NOW()
;

-- =====================================================================
-- CLEANUP MAINTENANCE: Session expiry (safe to run as cron daily)
-- =====================================================================

-- Safe nightly cleanup queries (run via pg_cron or external cron):
--
-- DELETE FROM portal_sessions
--   WHERE expires_at < NOW() - INTERVAL '7 days';
--
-- DELETE FROM scan_sessions
--   WHERE expires_at < NOW() - INTERVAL '1 day';
--
-- DELETE FROM super_admin_sessions
--   WHERE expires_at < NOW() - INTERVAL '7 days';
--
-- DELETE FROM dicom_pull_jobs
--   WHERE status IN ('completed', 'failed')
--   AND   created_at < NOW() - INTERVAL '30 days';


-- =====================================================================
-- VERIFICATION QUERIES (run after migration to confirm)
-- =====================================================================

-- Check view existence
SELECT viewname FROM pg_views
WHERE viewname IN ('v_unified_worklist', 'v_today_worklist', 'v_active_sessions');

-- Check new indexes
SELECT indexname, tablename FROM pg_indexes
WHERE indexname IN (
  'audit_logs_created_idx', 'audit_logs_user_action_idx',
  'bills_status_date_idx', 'bills_ledger_date_idx',
  'payments_created_idx', 'portal_sessions_expires_idx',
  'portal_sessions_user_idx', 'pacs_settings_key_cat_uq',
  'test_tokens_date_ledger_status_idx', 'bank_txn_recon_idx',
  'fraud_alerts_status_severity_idx', 'dicom_pull_jobs_status_idx',
  'scan_sessions_expires_idx', 'recon_logs_status_idx',
  'bank_txn_account_date_idx'
)
ORDER BY tablename, indexname;

-- Check today's unified worklist (spot check)
SELECT unified_status, modality, COUNT(*) AS cnt
FROM   v_today_worklist
GROUP  BY unified_status, modality
ORDER  BY cnt DESC
LIMIT  20;
