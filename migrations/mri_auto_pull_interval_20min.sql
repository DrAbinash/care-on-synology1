-- Prefer a calmer MRI auto-pull cadence (20 min) when nodes were left on the
-- old 5-minute default. Only touches MR modality rows that still use 300s so
-- intentionally custom intervals are preserved.
UPDATE dicom_nodes
SET pull_interval_seconds = 1200
WHERE UPPER(TRIM(modality)) IN ('MR', 'MRI')
  AND auto_pull = true
  AND pull_interval_seconds = 300;
