-- Enable master radiology AI when local Ollama or draft automation is already configured.
-- Idempotent: safe to re-run on every deploy. Fixes verify-before-redeploy for on-prem clinics
-- that configured Ollama + MRI night_batch but never toggled ff_radiology_ai in the UI.
--
-- Rollback (manual):
--   UPDATE feature_flags SET enabled = false WHERE key = 'ff_radiology_ai';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clinic_settings
    WHERE COALESCE(ollama_enabled, true) IS NOT FALSE
      AND NULLIF(TRIM(COALESCE(ollama_base_url, '')), '') IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM ai_modality_policies WHERE mode IN ('night_batch', 'immediate')
  ) THEN
    INSERT INTO feature_flags (key, enabled, description, updated_by)
    VALUES ('ff_radiology_ai', true, 'Master radiology AI switch', 'onprem-ollama-bootstrap')
    ON CONFLICT (key) DO UPDATE
    SET enabled = true, updated_by = 'onprem-ollama-bootstrap', updated_at = now();

    INSERT INTO ai_feature_policies (scope, scope_key, enabled, mode, updated_by)
    VALUES ('global', '*', true, 'pilot', 'onprem-ollama-bootstrap')
    ON CONFLICT (scope, scope_key) DO UPDATE
    SET enabled = true, mode = 'pilot', updated_by = 'onprem-ollama-bootstrap', updated_at = now();
  END IF;
END $$;
