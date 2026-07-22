-- =============================================================================
-- aaaa_bootstrap_feature_flags.sql — clean-boot ordering correction
-- =============================================================================
--
-- WHY THIS FILE EXISTS
--   Feature migrations in migrations/ are applied by
--   docker/db-patch-entrypoint.sh in PLAIN ALPHABETICAL FILENAME ORDER, and a
--   failing feature migration hard-stops the whole deploy (psql
--   -v ON_ERROR_STOP=1). The server-side feature-flag table `feature_flags`
--   is CREATEd by `add_radiology_feature_flags.sql`, but
--   `add_ai_clinical_config.sql` sorts alphabetically BEFORE it
--   ("add_ai_" < "add_radiology_") and does
--       INSERT INTO feature_flags (...) VALUES ('ff_radiology_ai', ...);
--   On an EXISTING (production/populated) database `feature_flags` already
--   exists, so this ordering was invisible. On a COMPLETELY EMPTY database the
--   INSERT hits a table that does not exist yet:
--       ERROR: relation "feature_flags" does not exist
--   which hard-stops the migrator and every feature migration after it never
--   runs — i.e. a clean bootstrap could never complete. See
--   MIGRATION_FRAMEWORK_AUDIT.md for the incident write-up.
--
-- THE FIX (additive, idempotent, forward-only — repository policy compliant)
--   Create `feature_flags` FIRST (this filename sorts before every existing
--   migration: "aaaa" < "add_"), with the exact shape
--   add_radiology_feature_flags.sql expects. That later migration keeps its
--   own `CREATE TABLE IF NOT EXISTS feature_flags` + seed INSERTs, which now
--   become harmless no-ops. No rows are seeded here — seeding stays owned by
--   the feature migrations that know their own keys.
--
-- SAFETY
--   * `CREATE TABLE IF NOT EXISTS` → on production (table already present) this
--     is a pure no-op; nothing is dropped, altered, or reseeded.
--   * No data is written; existing flag values are untouched.
--   * Safe to run any number of times.
--   * `node scripts/check-migration-order.cjs` now statically enforces this
--     ordering for INSERT/UPDATE/DELETE targets, so the class of bug this file
--     fixes cannot silently return.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
