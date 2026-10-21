-- Smart Dictation custom findings — the radiologist-authored dictation vocabulary.
-- ==========================================================================
--
-- WHY THIS FILE EXISTS
-- Smart Dictation V1 recognises the six MRI examinations' findings through a
-- code-owned phrase catalog (voiceReportComposer/phraseCatalog.ts) whose
-- wording is copied verbatim from the Quick Select tiles. The owner asked for
-- the NEXT findings to be addable from the user interface, without a code
-- change and without touching the Quick Select catalogue. This table holds
-- those findings. On every compose turn the API loads enabled rows, compiles
-- each row's synonyms into literal case-insensitive match patterns, and merges
-- them with the built-in catalog — so a dictated custom finding prints exactly
-- its stored findings sentence, through the same deterministic composer, the
-- same observation ledger, and the same normal-retirement engine (the optional
-- baseline_replaces column) as a built-in one.
--
-- WHAT THIS TABLE STORES
--   concept           unique slug key (e.g. tarlov_cyst). The write API rejects
--                     a collision with a built-in concept key (409) rather
--                     than silently overriding clinical tile wording.
--   label             human display name.
--   families          comma-separated subset of brain,lumbar,cervical,dorsal —
--                     the same family vocabulary the built-in catalog filters
--                     prompts by, so a brain-only phrase never fires in a
--                     spine study.
--   synonyms          comma-separated dictated phrasings, matched literally and
--                     case-insensitively (regex-escaped — a synonym with
--                     punctuation is a plain substring, never code).
--   findings_text     the exact Findings sentence a dictation writes.
--   impression_text   optional exact Impression sentence ('' → none).
--   anatomical_section / conflict_group / baseline_replaces
--                     the same placement/exclusivity/retirement semantics a
--                     Quick Select finding carries; all optional.
--   enabled           disabled rows stay stored (wording preserved) but are
--                     skipped by the composer.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No seed rows. This is the doctor's own vocabulary — the settings UI
--     (Radiology Settings → Voice → Smart Dictation findings) is the only
--     writer, and an empty table means "built-in catalog only", exactly the
--     shipped V1 behaviour.
--   * No FK to any quick-findings table. The two vocabularies are linked by
--     convention (verbatim wording), not by referential integrity; a Quick
--     Select tile deletion must never delete a dictation phrase the doctor
--     taught, and vice versa.
--   * No NOT NULL without a DEFAULT beyond concept/label/synonyms/findings
--     (the four fields every dictation genuinely needs), so a future additive
--     column never needs a backfill.
--
-- Idempotent by the house rules: safe to run 10 times, CREATE TABLE IF NOT
-- EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS, no DML, no seeds. The drizzle
-- journal path (lib/db/drizzle/0015_smart_dictation_phrases.sql) creates the
-- same schema for CI/dev bootstraps; whichever path runs first wins and the
-- other is a no-op.

CREATE TABLE IF NOT EXISTS radiology_smart_dictation_phrases (
  id serial PRIMARY KEY,
  concept text NOT NULL,
  label text NOT NULL,
  families text NOT NULL DEFAULT 'lumbar',
  synonyms text NOT NULL,
  findings_text text NOT NULL,
  impression_text text NOT NULL DEFAULT '',
  anatomical_section text NOT NULL DEFAULT '',
  conflict_group text NOT NULL DEFAULT '',
  baseline_replaces text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_smart_dictation_phrases_concept_uq
  ON radiology_smart_dictation_phrases (concept);
