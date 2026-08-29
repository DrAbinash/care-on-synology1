/**
 * Section 5–6 wiring helpers — pathology-linked impression/recommendation chips.
 * Reuses observation ledger + reportFieldMerge; no parallel clinical engine.
 */

import { splitToSentences } from "./reportFieldMerge";
import type { LedgerPatch } from "./observationLedger";

/** Unique pathology-owned recommendation sentences from active patches. */
export function collectPathologyRecommendationChips(
  patches: Array<Pick<LedgerPatch, "lastRendered">>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of patches) {
    const text = (p.lastRendered.recommendation ?? "").trim();
    if (!text) continue;
    for (const s of splitToSentences(text)) {
      const key = s.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s.trim());
    }
  }
  return out;
}

/** Merge server/catalog chips with pathology-derived advice; dedupe case-insensitively. */
export function mergeRecommendationChipLists(base: string[], pathology: string[]): string[] {
  const out = [...base];
  const seen = new Set(base.map((s) => s.trim().toLowerCase()).filter(Boolean));
  for (const chip of pathology) {
    const key = chip.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(chip.trim());
  }
  return out;
}

/** Impression shortcut labels from active pathology patches (for compact chip row). */
export function collectPathologyImpressionShortcuts(
  patches: Array<Pick<LedgerPatch, "lastRendered" | "observation">>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of patches) {
    const text = (p.lastRendered.impression ?? "").trim();
    if (!text) continue;
    for (const s of splitToSentences(text)) {
      const key = s.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s.trim());
    }
  }
  return out;
}
