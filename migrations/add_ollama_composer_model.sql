-- Voice Report Composer — task-specific Ollama model (separate from vision model).
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS ollama_composer_model text,
  ADD COLUMN IF NOT EXISTS ollama_composer_fallback_model text,
  ADD COLUMN IF NOT EXISTS ollama_composer_num_ctx integer NOT NULL DEFAULT 4096,
  ADD COLUMN IF NOT EXISTS ollama_composer_temperature numeric(4, 2) NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS ollama_composer_timeout_seconds integer NOT NULL DEFAULT 45;
