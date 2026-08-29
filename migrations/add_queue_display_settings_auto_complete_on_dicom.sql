-- USG TV queue hack: auto-complete waiting/serving tokens when Orthanc→ERP
-- intake receives a scan (modality worklist on the USG machine is unavailable).
-- Per-room toggle in Settings → Queue Display (TV) → Queue Cards.

ALTER TABLE queue_display_settings ADD COLUMN IF NOT EXISTS auto_complete_token_on_dicom BOOLEAN NOT NULL DEFAULT TRUE;
