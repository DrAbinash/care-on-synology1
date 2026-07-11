-- R1.2 — Enterprise report template engine. Additive and idempotent.
--
--  1. radiology_presentation_templates — versioned PRESENTATION templates
--     (distinct from report_template_versions, which versions CLINICAL
--     structured templates). Published versions are immutable; edits create
--     the next version; deletion is soft retirement.
--  2. radiology_report_presentation_freeze — the template identity a report
--     was SIGNED under, plus a resolved-definition snapshot for
--     reproducibility. Reports without a row (pre-R1.2) fall back to the
--     active selection.

CREATE TABLE IF NOT EXISTS radiology_presentation_templates (
  id SERIAL PRIMARY KEY,
  template_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  org_scope TEXT NOT NULL DEFAULT 'global',
  copy_type TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'published',
  renderer_version INTEGER NOT NULL DEFAULT 1,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  definition JSONB NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  retired_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS rpt_key_version_uq ON radiology_presentation_templates(template_key, version);
CREATE INDEX IF NOT EXISTS rpt_key_idx ON radiology_presentation_templates(template_key);
CREATE INDEX IF NOT EXISTS rpt_status_idx ON radiology_presentation_templates(status);

CREATE TABLE IF NOT EXISTS radiology_report_presentation_freeze (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS rrpf_report_uq ON radiology_report_presentation_freeze(report_id);
