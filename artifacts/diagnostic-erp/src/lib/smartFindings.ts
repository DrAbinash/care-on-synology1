/**
 * smartFindings — the Smart Reporting Engine's pure core.
 *
 * It does NOT introduce a new report model. It reuses the EXISTING structured
 * report (`findingsMap`: an anatomically-ordered `Record<sectionLabel,
 * {normal, text}>` seeded from the auto-loaded template), the EXISTING
 * abnormality renderer (`renderAbnormality`), and the EXISTING exact-remove /
 * dedupe-merge text primitives (`mergeBlock`/`removeBlock`).
 *
 * A finding drives one section. Selecting it replaces that section's baseline
 * normal with the finding text; a second finding on the same section merges in;
 * deselecting removes exactly that finding's contribution and restores the
 * normal when the section empties. Because the section key already exists in
 * template order, replacement, conflict-resolution and anatomical ordering all
 * fall out for free.
 *
 * Crucially, the per-finding contribution is applied with the SAME
 * exact-remove/dedupe-merge used by the free-text engine, so a radiologist's
 * manual edit to a section is never silently overwritten (removeBlock only
 * strips an exact previously-inserted sentence; mergeBlock never duplicates).
 *
 * v2 structured formats (repeating groups, mutex, tokens, combineMode) live in
 * `@/lib/structuredFormat`. This module still owns Quick Findings → findingsMap
 * section matching; the format engine expands group items to those same keys.
 */

import { mergeBlock, removeBlock } from "./quickFindingsMerge";

export type SectionState = { normal: boolean; text: string };
export type FindingsMap = Record<string, SectionState>;

// ── Keyword section matching ────────────────────────────────────────────────
// Real-world finding data (technician labels, imported catalogs, admin typos)
// almost never matches a structured-template region label character-for-
// character — "L4/5" vs "L4-L5", "cervical cord" vs "Spinal Cord",
// "screening: dorsal" vs "Screening — Dorsal Spine". Exact-equality matching
// then scatters the finding into its own stray section instead of flipping the
// intended region. matchTemplateSection() maps a raw section string to the
// best-fitting template label using normalization + spine-level tokens +
// keyword overlap, so near-misses land on the right region.

const STOPWORDS = new Set([
  "the", "and", "of", "a", "an", "in", "on", "at", "to", "for", "with",
  "screening", "region", "regions", "level", "levels", "study", "spine",
  "section", "&", "-", "—",
]);

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
function normalizeSection(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse spine-level spellings to a canonical token set, e.g. "l4-l5",
 *  "l4 l5", "l4/5", "l4 5", "l45" → "l4l5"; "c5-c6" → "c5c6"; "c7-d1"/"c7-t1"
 *  → "c7d1". Returns the set of level tokens found in the string. */
function levelTokens(normalized: string): Set<string> {
  const out = new Set<string>();
  const compact = normalized.replace(/\s+/g, "");
  // paired levels like l4l5 / l4 5 / l45 / c5c6 / c7d1 / c7t1 / d10d11
  const paired = compact.matchAll(/([lcdts])(\d{1,2})[^a-z0-9]?([lcdts]?)(\d{1,2})/g);
  for (const m of paired) {
    const a = m[1] + m[2];
    const b = (m[3] || m[1]) + m[4];
    out.add(`${a}${b}`.replace("t", "d")); // treat thoracic T as dorsal D
  }
  return out;
}

/** Significant tokens for keyword overlap (stopwords + level tokens removed). */
function keywordTokens(normalized: string): Set<string> {
  return new Set(
    normalized.split(" ").filter((t) => t && !STOPWORDS.has(t) && !/^[lcdts]\d/.test(t)),
  );
}

/**
 * Map a raw section string to the best-matching template label (from
 * `labels`), or null when nothing fits well enough. Priority:
 *   1. exact / case-insensitive-normalized equality
 *   2. shared spine-level token (l4l5, c5c6, …)
 *   3. keyword overlap above a threshold (distinctive words shared)
 */
export function matchTemplateSection(raw: string, labels: string[]): string | null {
  const rawTrim = (raw || "").trim();
  if (!rawTrim || labels.length === 0) return null;

  // 1 — exact, then normalized-exact.
  const exact = labels.find((l) => l === rawTrim);
  if (exact) return exact;
  const nRaw = normalizeSection(rawTrim);
  const normLabels = labels.map((l) => ({ label: l, norm: normalizeSection(l) }));
  const normExact = normLabels.find((l) => l.norm === nRaw);
  if (normExact) return normExact.label;

  // 2 — spine-level token match (most decisive for per-level spine sections).
  const rawLevels = levelTokens(nRaw);
  if (rawLevels.size > 0) {
    for (const { label, norm } of normLabels) {
      const labLevels = levelTokens(norm);
      for (const lv of rawLevels) if (labLevels.has(lv)) return label;
    }
  }

  // 3 — keyword overlap. Score = shared / rawKeywordCount, tie-broken by the
  // label that shares the most tokens; require a meaningful overlap.
  const rawKw = keywordTokens(nRaw);
  if (rawKw.size > 0) {
    let best: { label: string; score: number; shared: number } | null = null;
    for (const { label, norm } of normLabels) {
      const labKw = keywordTokens(norm);
      let shared = 0;
      for (const t of rawKw) if (labKw.has(t)) shared++;
      if (shared === 0) continue;
      const score = shared / rawKw.size;
      if (!best || score > best.score || (score === best.score && shared > best.shared)) {
        best = { label, score, shared };
      }
    }
    // Accept a strong overlap (>= half the raw keywords, or every raw keyword
    // present in the label even if the label has extra words).
    if (best && (best.score >= 0.5 || best.shared === rawKw.size)) return best.label;
  }

  return null;
}

/**
 * Update one structured section for a single finding whose contribution changes
 * from `prevText` (what it last put there, or null) to `nextText` (its new
 * text, or null when deselected).
 *
 * @param current       the section's current state (undefined if not present)
 * @param baselineNormal the template's normal text for this section, or
 *                       undefined for a created (non-template) section
 * @returns the new section state, or null to drop a created section that has
 *          emptied out
 */
export function applySectionContribution(
  current: SectionState | undefined,
  baselineNormal: string | undefined,
  prevText: string | null,
  nextText: string | null,
): SectionState | null {
  // Start from the current ABNORMAL text (a normal/absent section contributes
  // no prior text — the finding replaces the normal).
  let text = current && !current.normal ? current.text : "";
  if (prevText) text = removeBlock(text, prevText); // exact — manual edits survive
  const add = (nextText ?? "").trim();
  if (add) text = mergeBlock(text, add);            // dedupe-merge
  if (text.trim()) return { normal: false, text };
  if (baselineNormal !== undefined) return { normal: true, text: baselineNormal };
  return null; // created section with nothing left → drop it
}

/**
 * Given a finding's conflict group and the currently-selected findings, return
 * the ids that must be de-selected because they share the same non-empty group
 * within the same study (mutual exclusion, e.g. Fazekas grade 1 vs 2).
 */
export function conflictingSelections(
  selecting: { id: number; studyType: string; conflictGroup: string },
  selected: Array<{ id: number; studyType: string; conflictGroup: string }>,
): number[] {
  const group = (selecting.conflictGroup ?? "").trim();
  if (!group) return [];
  return selected
    .filter(
      (f) =>
        f.id !== selecting.id &&
        f.studyType === selecting.studyType &&
        (f.conflictGroup ?? "").trim() === group,
    )
    .map((f) => f.id);
}
