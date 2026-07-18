-- ============================================================================
-- Phase P4 — AI Enterprise Interoperability & Clinical Exchange (Gates G12–G22)
-- ============================================================================
-- Additive + idempotent. Creates the backend storage/link tables for DICOM SR,
-- encapsulated PDF, GSPS/SEG foundations, MPPS / Storage Commitment status, and
-- FHIR export, and enriches ai_draft_feedback with the structured feedback-
-- dataset columns (G21). NOTHING here replaces the report: SR / PDF / FHIR are
-- ADDITIONAL exports linked to patient_reports. Byte-level DICOM/DIMSE encoding
-- and live PACS operations run through the EXISTING DICOM agent + Orthanc and
-- the existing dicom_sr_export_queue — no new queue/worker is created.
--
-- Sorts alphabetically after add_ai_clinical_config.sql (which creates
-- ai_draft_feedback), so the ALTER below always runs after that table exists.
--
-- Rollback (manual — NOT auto-applied):
--   DROP TABLE IF EXISTS dicom_sr_documents, encapsulated_pdf_exports,
--     presentation_states, segmentation_objects, mpps_events,
--     storage_commitments, fhir_export_log;
--   ALTER TABLE ai_draft_feedback
--     DROP COLUMN IF EXISTS reason, DROP COLUMN IF EXISTS laterality,
--     DROP COLUMN IF EXISTS measurement_ref, DROP COLUMN IF EXISTS confidence,
--     DROP COLUMN IF EXISTS prompt_version, DROP COLUMN IF EXISTS model_version;
-- ============================================================================

-- ── G12: DICOM Structured Report (TID 1500) ↔ ERP report ────────────────────
CREATE TABLE IF NOT EXISTS dicom_sr_documents (
  id                     SERIAL PRIMARY KEY,
  report_id              INTEGER,
  study_instance_uid     TEXT NOT NULL,
  sr_series_instance_uid TEXT,
  sr_sop_instance_uid    TEXT,
  template_id            TEXT NOT NULL DEFAULT 'TID1500',
  content_json           JSONB NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  pacs_instance_id       TEXT,
  error_message          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dicom_sr_doc_report_idx ON dicom_sr_documents (report_id);
CREATE INDEX IF NOT EXISTS dicom_sr_doc_uid_idx    ON dicom_sr_documents (study_instance_uid);

-- ── G13: Encapsulated PDF exports (versioned) ───────────────────────────────
CREATE TABLE IF NOT EXISTS encapsulated_pdf_exports (
  id                 SERIAL PRIMARY KEY,
  report_id          INTEGER,
  study_instance_uid TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  sop_instance_uid   TEXT,
  pdf_sha256         TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  pacs_instance_id   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS encap_pdf_report_idx      ON encapsulated_pdf_exports (report_id);
CREATE INDEX IF NOT EXISTS encap_pdf_uid_version_idx ON encapsulated_pdf_exports (study_instance_uid, version);

-- ── G14: Presentation State (GSPS) foundation — overlays only, no editor ────
CREATE TABLE IF NOT EXISTS presentation_states (
  id                    SERIAL PRIMARY KEY,
  study_instance_uid    TEXT NOT NULL,
  referenced_series_uid TEXT,
  referenced_sop_uid    TEXT,
  kind                  TEXT NOT NULL,
  payload_json          JSONB NOT NULL,
  gsps_sop_instance_uid TEXT,
  status                TEXT NOT NULL DEFAULT 'draft',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gsps_uid_idx ON presentation_states (study_instance_uid);

-- ── G15: DICOM SEG foundation — storage interface only ──────────────────────
CREATE TABLE IF NOT EXISTS segmentation_objects (
  id                    SERIAL PRIMARY KEY,
  study_instance_uid    TEXT NOT NULL,
  referenced_series_uid TEXT,
  seg_sop_instance_uid  TEXT,
  label                 TEXT,
  storage_ref           TEXT,
  status                TEXT NOT NULL DEFAULT 'registered',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seg_uid_idx ON segmentation_objects (study_instance_uid);

-- ── G16: MPPS events + Storage Commitment status ────────────────────────────
CREATE TABLE IF NOT EXISTS mpps_events (
  id                    SERIAL PRIMARY KEY,
  study_instance_uid    TEXT,
  accession_number      TEXT,
  mpps_sop_instance_uid TEXT,
  status                TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mpps_uid_idx ON mpps_events (study_instance_uid);

CREATE TABLE IF NOT EXISTS storage_commitments (
  id                 SERIAL PRIMARY KEY,
  study_instance_uid TEXT,
  sop_instance_uid   TEXT,
  transaction_uid    TEXT,
  status             TEXT NOT NULL DEFAULT 'requested',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_commit_uid_idx ON storage_commitments (study_instance_uid);

-- ── G17: FHIR export log (resources generated; no external send) ────────────
CREATE TABLE IF NOT EXISTS fhir_export_log (
  id                 SERIAL PRIMARY KEY,
  resource_type      TEXT NOT NULL,
  report_id          INTEGER,
  study_instance_uid TEXT,
  resource_json      JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fhir_export_type_idx   ON fhir_export_log (resource_type);
CREATE INDEX IF NOT EXISTS fhir_export_report_idx ON fhir_export_log (report_id);

-- ── G21: structured human-feedback dataset columns (analytics only) ─────────
-- No retraining is ever performed from these; they curate an offline dataset.
ALTER TABLE ai_draft_feedback ADD COLUMN IF NOT EXISTS reason          TEXT;
ALTER TABLE ai_draft_feedback ADD COLUMN IF NOT EXISTS laterality      TEXT;
ALTER TABLE ai_draft_feedback ADD COLUMN IF NOT EXISTS measurement_ref TEXT;
ALTER TABLE ai_draft_feedback ADD COLUMN IF NOT EXISTS confidence      INTEGER;
ALTER TABLE ai_draft_feedback ADD COLUMN IF NOT EXISTS prompt_version  TEXT;
ALTER TABLE ai_draft_feedback ADD COLUMN IF NOT EXISTS model_version   TEXT;
