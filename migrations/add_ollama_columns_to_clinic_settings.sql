-- Safe migration: add Ollama columns to clinic_settings
-- These columns are nullable with sensible defaults.
-- No existing data is modified or deleted.

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS ollama_base_url text,
  ADD COLUMN IF NOT EXISTS ollama_model text,
  ADD COLUMN IF NOT EXISTS ollama_local_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ollama_known_models text NOT NULL DEFAULT '[]';
