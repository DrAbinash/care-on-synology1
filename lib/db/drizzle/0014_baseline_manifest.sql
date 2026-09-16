-- Dedicated persistence for report_format baselineManifest ownership contracts.
-- Null remains valid for legacy/custom formats without ownership.
-- Also migrates any interim JSON previously stored in expansion_text for report_format rows.

ALTER TABLE radiology_snippets
  ADD COLUMN IF NOT EXISTS baseline_manifest text;

UPDATE radiology_snippets
SET baseline_manifest = expansion_text
WHERE type = 'report_format'
  AND baseline_manifest IS NULL
  AND expansion_text IS NOT NULL
  AND expansion_text LIKE '{%';

UPDATE radiology_snippets
SET expansion_text = NULL
WHERE type = 'report_format'
  AND baseline_manifest IS NOT NULL
  AND expansion_text = baseline_manifest;
