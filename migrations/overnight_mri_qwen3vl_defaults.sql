-- Overnight MRI AI drafts: clinical window 17:00–10:00 IST, concurrency 1,
-- MRI-only night_batch. Idempotent. Does not enable ff_radiology_ai (admin must).
--
-- Rollback:
--   UPDATE ai_scheduler_config SET night_start='23:00', night_end='06:00',
--     quiet_start='08:00', quiet_end='20:00', max_concurrent_jobs=2,
--     draft_timing='on_arrival' WHERE id = 1;
--   UPDATE ai_modality_policies SET mode='disabled';

INSERT INTO ai_scheduler_config (id, draft_timing, night_start, night_end, quiet_start, quiet_end, max_concurrent_jobs)
SELECT 1, 'scheduled', '17:00', '10:00', '10:00', '17:00', 1
WHERE NOT EXISTS (SELECT 1 FROM ai_scheduler_config);

-- Move the historical 23:00–06:00 default to the clinical 17:00–10:00 window.
UPDATE ai_scheduler_config
SET night_start = '17:00',
    night_end = '10:00',
    quiet_start = '10:00',
    quiet_end = '17:00',
    draft_timing = 'scheduled',
    max_concurrent_jobs = 1
WHERE night_start = '23:00' AND night_end = '06:00';

UPDATE ai_scheduler_config
SET max_concurrent_jobs = 1
WHERE max_concurrent_jobs IS NULL OR max_concurrent_jobs > 1;

INSERT INTO ai_modality_policies (modality, mode, updated_by)
SELECT v.modality, v.mode, 'overnight-mri-defaults'
FROM (VALUES
  ('MR', 'night_batch'),
  ('CT', 'disabled'),
  ('CR', 'disabled'),
  ('US', 'disabled'),
  ('MG', 'disabled'),
  ('Doppler', 'disabled')
) AS v(modality, mode)
WHERE NOT EXISTS (
  SELECT 1 FROM ai_modality_policies p WHERE p.modality = v.modality
);

UPDATE ai_modality_policies SET mode = 'night_batch', updated_by = 'overnight-mri-defaults', updated_at = now()
WHERE modality IN ('MR', 'MRI');
UPDATE ai_modality_policies SET mode = 'disabled', updated_by = 'overnight-mri-defaults', updated_at = now()
WHERE modality IN ('CT', 'CR', 'DX', 'XR', 'US', 'MG', 'Doppler');
