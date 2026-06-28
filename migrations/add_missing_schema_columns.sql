-- =============================================================================
-- Forensic fix: add columns present in Drizzle TS schema but missing from SQL
-- =============================================================================
--
-- Root cause: Three columns exist in Drizzle TypeScript schema definitions
-- but were never included in any SQL migration file, causing schema
-- verification to fail on every deployment.
--
-- 1. clinic_settings.ollama_enabled
--    Defined in: lib/db/src/schema/clinicSettings.ts (ollamaEnabled)
--    Missing from: add_ollama_columns_to_clinic_settings.sql (added base_url,
--    model, local_only, known_models but forgot ollama_enabled)
--    Missing from: 0000_dear_forge.sql (not in original CREATE TABLE)
--
-- 2. clinic_settings.ollama_model
--    Defined in: lib/db/src/schema/clinicSettings.ts
--    Present in: add_ollama_columns_to_clinic_settings.sql ← ALREADY EXISTS
--    (The migration adds it, but it was parsed incorrectly in forensic check.
--    Keeping the ADD COLUMN IF NOT EXISTS here is idempotent and safe.)
--
-- 3. bills.original_total
--    Defined in: lib/db/src/schema/bills.ts (originalTotal)
--    Missing from: lib/db/drizzle/0000_dear_forge.sql CREATE TABLE bills
--    Added to TS schema without generating a Drizzle SQL migration.
--
-- All statements use ADD COLUMN IF NOT EXISTS — safe on:
--   - Fresh database (column absent → added)
--   - Existing database (column already present → skipped, no error)
--   - Re-run (idempotent)
--
-- No data is modified. No columns are dropped.
-- =============================================================================

-- 1. clinic_settings.ollama_enabled
--    boolean, not null, default false
--    (Matches: clinicSettings.ts ollamaEnabled: boolean("ollama_enabled").notNull().default(false))
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS ollama_enabled boolean NOT NULL DEFAULT false;

-- 2. clinic_settings.ollama_model
--    text, nullable
--    (Also in add_ollama_columns_to_clinic_settings.sql — IF NOT EXISTS makes this safe)
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS ollama_model text;

-- 3. bills.original_total
--    numeric(10,2), not null, default 0
--    (Matches: bills.ts originalTotal: numeric("original_total", {precision:10, scale:2}).notNull().default("0"))
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS original_total numeric(10, 2) NOT NULL DEFAULT 0;
