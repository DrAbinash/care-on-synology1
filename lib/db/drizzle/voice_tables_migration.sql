-- ============================================================
-- Care Diagnostics ERP — Voice Dictation Tables Migration
-- Generated: 2026-06-24
-- Run this on the Synology via:
--   docker exec -i care-db psql -U erp -d diagnostic_erp < voice_tables_migration.sql
-- ============================================================

-- Table 1: voice_dictation_logs
-- Audit log for every voice dictation action (start/stop/insert/ai_cleaned)
CREATE TABLE IF NOT EXISTS voice_dictation_logs (
  id                  serial PRIMARY KEY,
  user_id             integer,
  user_name           text,
  study_id            integer,
  accession_number    text,
  action              text NOT NULL,
  duration_secs       integer,
  word_count          integer,
  was_ai_cleaned      boolean NOT NULL DEFAULT false,
  inserted_to_report  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Table 2: ai_voice_transcriptions
-- Phase 24 AI voice transcription workflow (pending → transcribed → reviewed → inserted)
CREATE TABLE IF NOT EXISTS ai_voice_transcriptions (
  id                      serial PRIMARY KEY,
  worklist_id             integer,
  report_id               integer,
  patient_id              integer,
  radiologist_id          integer,
  radiologist_name        text,
  audio_url               text,
  audio_duration_seconds  real,
  raw_transcript          text,
  confidence_score        real,
  corrected_text          text,
  inserted_into_report    boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'pending',
  modality                text,
  body_part               text,
  ai_safety_label         text NOT NULL DEFAULT 'AI Draft – Requires Radiologist Review',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Confirm
SELECT 'voice_dictation_logs' AS table_name,
       COUNT(*) AS row_count
FROM   voice_dictation_logs
UNION ALL
SELECT 'ai_voice_transcriptions',
       COUNT(*)
FROM   ai_voice_transcriptions;
