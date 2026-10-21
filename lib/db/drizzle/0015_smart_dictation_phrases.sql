-- Smart Dictation custom findings — the radiologist-authored dictation vocabulary.
-- Rows are read by the voice composer on every dictation turn and merged with the
-- built-in phrase catalog (code), so a finding added in Settings → Radiology →
-- Voice is recognised by the SAME deterministic composer, with the SAME
-- never-invent-wording contract: a matched finding prints exactly its findings
-- sentence and nothing else.
--
-- The production path for this table is
-- migrations/zzzzzzzzzzzzzzzzzzzzz_smart_dictation_custom_phrases.sql (db-patch-v2
-- applies feature migrations in alphabetical order); this journal entry exists so
-- the drizzle bootstrap path (CI's apply-all-migrations.mjs and dev bootstraps)
-- reaches the same schema. Both files are idempotent, so whichever runs first
-- creates the table and the other is a no-op.

CREATE TABLE IF NOT EXISTS "radiology_smart_dictation_phrases" (
  "id" serial PRIMARY KEY,
  "concept" text NOT NULL,
  "label" text NOT NULL,
  "families" text NOT NULL DEFAULT 'lumbar',
  "synonyms" text NOT NULL,
  "findings_text" text NOT NULL,
  "impression_text" text NOT NULL DEFAULT '',
  "anatomical_section" text NOT NULL DEFAULT '',
  "conflict_group" text NOT NULL DEFAULT '',
  "baseline_replaces" text NOT NULL DEFAULT '',
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_smart_dictation_phrases_concept_uq"
  ON "radiology_smart_dictation_phrases" ("concept");
