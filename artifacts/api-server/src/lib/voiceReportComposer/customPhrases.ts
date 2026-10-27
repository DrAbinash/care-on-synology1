/**
 * Smart Dictation custom findings — the radiologist-authored vocabulary.
 *
 * Task 15 (Part E, follow-up): the owner asked for NEW findings to be addable
 * from the user interface, so dictation keeps recognising the clinic's own
 * wording without a code change. This module is the bridge: it loads the
 * `radiology_smart_dictation_phrases` rows authored in Settings → Radiology →
 * Voice and compiles them into the same `CatalogPhrase` shape the built-in
 * code catalog uses, so the deterministic composer matches them with zero
 * special cases downstream.
 *
 * Contract (mirror of the built-in catalog's):
 *   - every synonym is compiled into a LITERAL, case-insensitive,
 *     regex-escaped pattern: a synonym containing punctuation or regex
 *     metacharacters is a plain substring, never code;
 *   - a row may never collide with a built-in concept key — the write API
 *     rejects it (409) so a custom phrase can never silently override
 *     clinical tile wording;
 *   - a DB error degrades to "built-in catalog only" — dictation never fails
 *     because the custom vocabulary could not be read.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologySmartDictationPhrasesTable } from "@workspace/db";
import type { CatalogPhrase } from "./phraseCatalog";

export const SMART_DICTATION_FAMILIES = ["brain", "lumbar", "cervical", "dorsal"] as const;
export type SmartDictationFamily = (typeof SMART_DICTATION_FAMILIES)[number];

/** Drizzle row shape for a custom phrase (mirrors lib/db schema columns). */
export type SmartDictationPhraseRow = {
  id: number;
  concept: string;
  label: string;
  families: string;
  synonyms: string;
  findingsText: string;
  impressionText: string;
  anatomicalSection: string;
  conflictGroup: string;
  baselineReplaces: string;
  enabled: boolean;
};

/** Split the comma-separated house convention into clean lowercase tokens. */
export function splitCommaField(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Regex-escape a literal so a synonym can never inject pattern code. */
export function escapeSynonym(syn: string): string {
  return syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFamilies(raw: string): SmartDictationFamily[] {
  const kept = splitCommaField(raw).filter((f): f is SmartDictationFamily =>
    (SMART_DICTATION_FAMILIES as readonly string[]).includes(f),
  );
  return kept.length ? kept : ["lumbar"];
}

/**
 * Compile one stored row into a `CatalogPhrase`. Pure — tests pass plain rows,
 * the loader passes drizzle rows, both get the same result.
 */
export function phraseFromRow(row: SmartDictationPhraseRow): CatalogPhrase {
  const synonyms = splitCommaField(row.synonyms);
  return {
    concept: row.concept.trim().toLowerCase(),
    patterns: synonyms.map((s) => new RegExp(escapeSynonym(s), "i")),
    findingsText: row.findingsText,
    impressionText: row.impressionText?.trim() ? row.impressionText : undefined,
    anatomicalSection: row.anatomicalSection?.trim() || undefined,
    conflictGroup: row.conflictGroup?.trim() || undefined,
    baselineReplaces: row.baselineReplaces?.trim() || undefined,
    families: parseFamilies(row.families),
  };
}

/** Compile all rows (enabled filtering is the caller's query's job). */
export function phrasesFromRows(rows: SmartDictationPhraseRow[]): CatalogPhrase[] {
  return rows.map(phraseFromRow);
}

/**
 * Load the enabled custom vocabulary for composing. Read on every dictation
 * turn — dictations are seconds apart and the settings UI is the only writer,
 * so a query beats a cache the doctor would have to remember to invalidate.
 * Any DB failure degrades to the built-in catalog only (never fails dictation).
 */
export async function loadCustomPhrases(): Promise<CatalogPhrase[]> {
  try {
    const rows = await db
      .select()
      .from(radiologySmartDictationPhrasesTable)
      .where(eq(radiologySmartDictationPhrasesTable.enabled, true))
      .orderBy(asc(radiologySmartDictationPhrasesTable.id));
    return phrasesFromRows(rows as SmartDictationPhraseRow[]);
  } catch {
    // tests / early boot / transient DB hiccup — dictation must still work
    return [];
  }
}

/** All rows (admin list view) — never throws; the UI shows a readable error. */
export async function listAllCustomPhraseRows(): Promise<SmartDictationPhraseRow[]> {
  const rows = await db
    .select()
    .from(radiologySmartDictationPhrasesTable)
    .orderBy(asc(radiologySmartDictationPhrasesTable.id));
  return rows as SmartDictationPhraseRow[];
}
