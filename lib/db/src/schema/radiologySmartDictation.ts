import { pgTable, text, serial, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

// ── Smart Dictation custom findings ──────────────────────────────────────────
// The radiologist's own dictation vocabulary, authored from the settings UI
// (Radiology Settings → Voice → "Smart Dictation findings"). Every built-in
// concept lives in code (voiceReportComposer/phraseCatalog.ts, wording copied
// verbatim from the Quick Select catalogue); this table exists for everything
// the six-exam V1 catalogue does not cover yet — a doctor who wants
// "tarlov cyst" recognised in dictation adds it here, and the SAME deterministic
// composer matches it on the next dictation without a code change.
//
// Created by migrations/zzzzzzzzzzzzzzzzzzzzz_smart_dictation_custom_phrases.sql
// (idempotent, CREATE TABLE IF NOT EXISTS) and drizzle journal 0015 — both the
// db-patch-v2 path and the drizzle bootstrap path must be able to reach it.
//
// Safety contract (mirrors the built-in catalog's):
//   * The compose path never invents wording — a custom finding prints exactly
//     the findings_text stored here, no more and no less.
//   * `concept` is a unique slug and may never collide with a built-in concept
//     key; the write API rejects a collision with a readable 409 rather than
//     silently overriding clinical tile wording.
//   * `families` is a comma-separated subset of brain,lumbar,cervical,dorsal —
//     the same family vocabulary the built-in catalog filters prompts by, so a
//     brain-only phrase can never fire in a spine study.
//   * `synonyms` is comma-separated dictated phrasing; each becomes a literal,
//     escaped, case-insensitive match pattern.
export const radiologySmartDictationPhrasesTable = pgTable(
  "radiology_smart_dictation_phrases",
  {
    id: serial("id").primaryKey(),
    /** Unique slug key, e.g. `tarlov_cyst`. Must differ from every built-in concept. */
    concept: text("concept").notNull(),
    /** Human display name, e.g. `Tarlov cyst`. */
    label: text("label").notNull(),
    /** Comma-separated subset of brain,lumbar,cervical,dorsal. */
    families: text("families").notNull().default("lumbar"),
    /** Comma-separated dictated phrasings matched case-insensitively. */
    synonyms: text("synonyms").notNull(),
    /** The exact Findings sentence a dictation of this finding writes. */
    findingsText: text("findings_text").notNull(),
    /** Optional exact Impression sentence. Empty → no impression contribution. */
    impressionText: text("impression_text").notNull().default(""),
    /** Optional structured-report section label for anatomical placement. */
    anatomicalSection: text("anatomical_section").notNull().default(""),
    /** Optional conflict group — findings sharing one are mutually exclusive. */
    conflictGroup: text("conflict_group").notNull().default(""),
    /** Optional exact baseline normal sentence this finding retires on apply. */
    baselineReplaces: text("baseline_replaces").notNull().default(""),
    /** Disabled phrases are skipped by the composer but keep their wording. */
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    conceptUq: uniqueIndex("radiology_smart_dictation_phrases_concept_uq").on(t.concept),
  }),
);
