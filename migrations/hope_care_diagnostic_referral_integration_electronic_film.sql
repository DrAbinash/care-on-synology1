-- Electronic Film artifacts: DicomToWindows → CARE ingest + HOPE delivery tracking.
-- Additive, idempotent, non-destructive.

CREATE TABLE IF NOT EXISTS electronic_film_artifacts (
  id                  SERIAL PRIMARY KEY,
  source_system       TEXT NOT NULL DEFAULT 'DICOMTOWINDOWS',
  source_job_key      TEXT NOT NULL,
  ingest_status       TEXT NOT NULL DEFAULT 'DISCOVERED',
  study_id            INTEGER REFERENCES radiology_studies(id),
  order_id            INTEGER,
  patient_id          INTEGER,
  study_instance_uid  TEXT,
  accession_number    TEXT,
  dicom_patient_id    TEXT,
  modality            TEXT,
  study_description   TEXT,
  study_date          TEXT,
  source_ae           TEXT,
  film_session_uid    TEXT,
  identity_summary    TEXT,
  match_method        TEXT,
  matched_by          TEXT,
  matched_at          TIMESTAMPTZ,
  match_locked        BOOLEAN NOT NULL DEFAULT FALSE,
  file_path           TEXT,
  file_name           TEXT,
  mime_type           TEXT NOT NULL DEFAULT 'application/pdf',
  artifact_hash       TEXT,
  preview_path        TEXT,
  page_count          INTEGER,
  image_count         INTEGER,
  version             INTEGER NOT NULL DEFAULT 1,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by_id    INTEGER REFERENCES electronic_film_artifacts(id),
  hope_delivery_status TEXT,
  hope_sent_at        TIMESTAMPTZ,
  hope_document_ref   TEXT,
  emitted_outbox_id   INTEGER REFERENCES integration_outbox(id),
  access_token        TEXT,
  source_created_at   TIMESTAMPTZ,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message       TEXT,
  correlation_id      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS electronic_film_source_job_uidx
  ON electronic_film_artifacts (source_system, source_job_key);

CREATE INDEX IF NOT EXISTS electronic_film_study_idx
  ON electronic_film_artifacts (study_id);

CREATE INDEX IF NOT EXISTS electronic_film_ingest_status_idx
  ON electronic_film_artifacts (ingest_status);

CREATE INDEX IF NOT EXISTS electronic_film_study_current_idx
  ON electronic_film_artifacts (study_id, is_current)
  WHERE is_current = TRUE;

-- Settings keys (category electronic_film) are stored in pacs_settings — no DDL needed.
