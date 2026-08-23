-- Add show_letterpad_header column to radiology_report_preferences.
-- When false, the CARE logo + address + services bar are omitted from
-- PDF/Word/Print exports — for printing on pre-printed letterheads.
-- Default true preserves existing behavior for all existing rows.

ALTER TABLE radiology_report_preferences
  ADD COLUMN IF NOT EXISTS show_letterpad_header boolean NOT NULL DEFAULT true;
