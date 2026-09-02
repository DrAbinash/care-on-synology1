/**
 * conceptCanon/conceptCanon.ts — the SINGLE canonical concept resolver.
 *
 * Generated at module load from `CLINICAL_CONTENT_PACKS`. There is no
 * second synonym engine. Unknown concepts fail conservatively.
 *
 * Public API (stable, used by observationSlot.ts and tests):
 *   - resolveCanonicalConcept(raw)  → canonical id or null
 *   - canonicalAliasIndex()         → Record<alias, canonical> (frozen)
 *   - isKnownCanonicalConcept(id)   → boolean
 *   - canonicalConceptTokens(id)    → string[] (for sentence matching)
 *
 * The resolver normalises input by:
 *   1. Trimming + lowercasing
 *   2. Collapsing internal whitespace
 *   3. Treating `_` / `-` as spaces (so "disc-bulge" === "disc bulge")
 *
 * Broad-anatomy words (disc, spine, brain, …) are NEVER canonical aliases.
 * Callers (observationSlot.resolveConcept) reject them upstream — the
 * resolver returns null for them so that slot identity never silently
 * collapses onto an anatomy word.
 */

import {
  CLINICAL_CONTENT_PACKS,
  type CanonicalConceptId,
  type ClinicalContentPack,
} from "./contentPacks";

// ─── Slug normalisation ────────────────────────────────────────────────────

/**
 * Normalise an arbitrary concept string for alias lookup.
 * Returns a lowercase, whitespace-collapsed, separator-normalised key.
 */
export function normaliseConceptKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

// ─── Generated alias index ────────────────────────────────────────────────

/**
 * Frozen alias → canonical concept map. Generated ONCE at module load.
 *
 * Includes both the canonical id itself and every declared alias.
 * The canonical id normalises to itself (so resolveCanonicalConcept
 * of a canonical id is idempotent).
 */
const ALIAS_INDEX: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const pack of CLINICAL_CONTENT_PACKS) {
    const canonical = pack.concept;
    // Canonical id itself (slug form) — both spaced and underscored variants
    // so callers can pass either form.
    out[normaliseConceptKey(canonical)] = canonical;
    if (!out[canonical]) out[canonical] = canonical;
    for (const alias of pack.aliases) {
      const key = normaliseConceptKey(alias);
      // First-declared alias wins for any collision (preserves clinical intent).
      if (!out[key]) out[key] = canonical;
    }
  }
  return Object.freeze(out);
})();

/**
 * Read-only view of the alias → canonical map. Returned frozen so callers
 * cannot accidentally mutate the shared index.
 */
export function canonicalAliasIndex(): Readonly<Record<string, string>> {
  return ALIAS_INDEX;
}

/**
 * Look up the canonical concept id for an arbitrary input.
 *
 * Returns null for:
 *   - Empty / whitespace-only input
 *   - Unknown aliases (conservative failure — caller must handle)
 *
 * Note: broad-anatomy words are NOT in the index, so they resolve to null.
 * Callers (observationSlot.resolveConcept) treat null as "no concept"
 * and fall back to the legacy section/level resolution path.
 */
export function resolveCanonicalConcept(raw: string | null | undefined): string | null {
  const key = normaliseConceptKey(raw);
  if (!key) return null;
  return ALIAS_INDEX[key] ?? null;
}

/**
 * Returns true if the given id is a declared canonical concept
 * (matches a `concept` field on some content pack). Does NOT match aliases.
 */
export function isKnownCanonicalConcept(id: string | null | undefined): boolean {
  if (!id) return false;
  return CLINICAL_CONTENT_PACKS.some((p) => p.concept === id);
}

/**
 * Returns every alias (and the canonical id itself) for a given concept.
 * Used by sentence-matching helpers to enumerate synonyms.
 *
 * Returns [] for unknown concepts (conservative — never invents aliases).
 */
export function canonicalConceptTokens(concept: string | null | undefined): string[] {
  if (!concept) return [];
  const pack: ClinicalContentPack | undefined = CLINICAL_CONTENT_PACKS.find(
    (p) => p.concept === concept,
  );
  if (!pack) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const k = normaliseConceptKey(raw);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  add(pack.concept);
  for (const alias of pack.aliases) add(alias);
  return out;
}

/**
 * Generate the legacy `CONCEPT_CANON` shape (Record<string, string>) from
 * the content packs. Used by observationSlot.ts as the single source for
 * the runtime canon, replacing the previous hardcoded object literal.
 *
 * The returned record maps every alias (and the canonical id) to its
 * canonical concept id. It is frozen so accidental mutation fails loudly.
 */
export function generateConceptCanonRecord(): Readonly<Record<string, string>> {
  return ALIAS_INDEX;
}
