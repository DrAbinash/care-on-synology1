-- Report Composer: pre-fill the two settings the clinic has to type by hand,
-- without overwriting anything anyone already chose.
--
-- WHY THIS FILE EXISTS
-- `resolveComposerRuntime`
-- (artifacts/api-server/src/lib/voiceReportComposer/runtimeConfig.ts) computes
--
--   enabled: localRuntime.ollamaEnabled && !!composerModel
--
-- so with `ollama_composer_model` NULL — which is its shipped state, the column is
-- `text` and nullable with NO default (`lib/db/src/schema/clinicSettings.ts:283`,
-- created by migrations/add_ollama_composer_model.sql) — the Composer is disabled
-- on every install until an administrator opens AI Reporting Settings and types a
-- model name. The same row carries a materialised `ollama_composer_timeout_seconds`
-- of 45, because that was the column default when it was added;
-- zzz…_composer_timeout_default_90.sql moved the DEFAULT to 90 and, by its own
-- stated design, touched no existing row. So the clinic still runs at 45 s.
--
-- 45 s is not a neutral number here. Measured on the clinic's own Ollama host with
-- qwen3:14b (docs/smart-dictation-deployment-recommendations.md): warm 35.0 s,
-- cold 40.7 s, post-eviction reload 55.7 s, two queued composes 60.4 s. A 45 s
-- ceiling loses every contended request, and the radiologist is handed the
-- deterministic fallback while believing the model wrote the report.
--
-- The owner asked for both values to arrive pre-filled on the next rebuild rather
-- than being typed again by hand, and asked that neither be hardcoded in source.
-- That is what a data seed is: the row is written once here and every value below
-- stays editable on AI Reporting Settings, which is the only writer after this.
--
-- WHAT THIS FILE GUARANTEES
--   * A value anyone set on purpose is left exactly alone. The timeout is only
--     rewritten while it still equals 45 — the shipped default it was created
--     with — and the model only while it is NULL or blank. A clinic running 60 s,
--     120 s or a different model is untouched, and re-running this file matches
--     nothing.
--   * It changes what a NEW row inherits as well as what an existing row holds.
--     api-server/src/index.ts creates the singleton settings row with an
--     explicit column list that omits every `ollama_*` column, so a fresh
--     install gets these column DEFAULTS rather than anything from the Drizzle
--     schema — which is why SET DEFAULT is part of the fix, not decoration.
--   * Nothing here turns the AI on. `ollama_enabled` is a site-level master
--     switch, and a boolean cannot be told apart between "never set" and "deliberately
--     off", so this file does not touch it. That stays an operator's click.
--
-- Ordering: 24 z-prefix characters sort this after
-- zzz…_composer_timeout_default_90.sql (23) and after every migration that ADDs
-- these columns, which matters because docker/db-patch-entrypoint.sh applies
-- migrations/*.sql in plain alphabetical order under `set -e`, and a SET DEFAULT
-- on a column that does not exist yet would fail and skip every file after it.
--
-- Rollback, exact inverse:
--     UPDATE clinic_settings SET ollama_composer_model = NULL
--       WHERE ollama_composer_model = 'qwen3:14b';
--     UPDATE clinic_settings SET ollama_composer_timeout_seconds = 45
--       WHERE ollama_composer_timeout_seconds = 90;
--     ALTER TABLE clinic_settings ALTER COLUMN ollama_composer_model SET DEFAULT '';
-- The second line would also revert a value an administrator set to 90 by hand;
-- a rollback is a deliberate act, a seed is not.

BEGIN;

-- 1. What a brand-new install inherits. The singleton row is inserted by the API
--    at startup with an explicit column list, so an omitted column takes the
--    database default — this is the only mechanism that reaches a fresh site.
--    The timeout column's DEFAULT is already 90:
--    zzz…_composer_timeout_default_90.sql owns that fact and this file does not
--    restate it.
ALTER TABLE IF EXISTS clinic_settings
  ALTER COLUMN ollama_composer_model SET DEFAULT 'qwen3:14b';

-- 2. What an existing install holds. Guarded so a deliberate choice survives:
--    only the untouched shipped default 45 is replaced, and only an empty model.
UPDATE clinic_settings
   SET ollama_composer_model = 'qwen3:14b'
 WHERE ollama_composer_model IS NULL
    OR btrim(ollama_composer_model) = '';

UPDATE clinic_settings
   SET ollama_composer_timeout_seconds = 90
 WHERE ollama_composer_timeout_seconds = 45;

COMMIT;
