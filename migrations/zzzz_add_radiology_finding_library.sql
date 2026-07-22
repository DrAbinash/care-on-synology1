-- =============================================================================
-- Migration: radiology_finding_library — editable findings catalogue behind the
-- Report Builder (add / modify / delete abnormal findings per modality + organ).
--
-- Self-contained: no foreign keys, no references to other tables, so ordering
-- is irrelevant (named zzzz_* to sort last). Idempotent DDL-add only — no
-- DROP / DELETE / UPDATE. Safe to run on every deployment.
-- =============================================================================

CREATE TABLE IF NOT EXISTS radiology_finding_library (
  id            serial PRIMARY KEY,
  modality      text        NOT NULL,               -- CT | USG | MRI | XRAY
  section       text        NOT NULL,               -- organ / region label
  region        text,                               -- study region (optional)
  finding_text  text        NOT NULL,               -- the finding sentence
  is_abnormal   boolean     NOT NULL DEFAULT true,
  is_impression boolean     NOT NULL DEFAULT false,
  frequency     integer     NOT NULL DEFAULT 0,
  source        text        NOT NULL DEFAULT 'custom', -- starter | custom
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    text,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rfl_modality_section_idx
  ON radiology_finding_library (modality, section);

CREATE INDEX IF NOT EXISTS rfl_active_idx
  ON radiology_finding_library (is_active);
