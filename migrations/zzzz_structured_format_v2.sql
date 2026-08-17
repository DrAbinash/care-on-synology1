-- Additive columns for radiologist-configurable structured formats (schema v2).
-- Existing sections_json remains valid (v1 findingsItems). Never drops columns.

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS format_version integer NOT NULL DEFAULT 1;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT '';

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS protocol_key text;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS parent_id integer;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

ALTER TABLE structured_report_templates
  ADD COLUMN IF NOT EXISTS previous_versions text NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS srt_default_idx
  ON structured_report_templates (body_part, is_default, is_active);
