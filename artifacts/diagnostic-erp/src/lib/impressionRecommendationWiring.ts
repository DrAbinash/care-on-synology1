/**
 * Section 5–6 wiring helpers — pathology-linked impression/recommendation chips.
 * Reuses observation ledger + reportFieldMerge; no parallel clinical engine.
 */

import {
  mergeReportFieldContentWithProvenance,
  splitToSentences,
  type FieldProvenanceMap,
  type InsertSource,
} from "./reportFieldMerge";
import type { LedgerPatch } from "./observationLedger";

/**
 * Put each observation's own recommendation sentence into the recommendation
 * box. Sentences already there stay, including a normal-format line and
 * anything the radiologist typed. When no observation owns a recommendation,
 * the box is left untouched.
 */
export function alignRecommendationToObservations(opts: {
  current: string;
  provenance?: FieldProvenanceMap;
  patches: Array<{
    stale?: boolean;
    source?: InsertSource;
    lastRendered?: { recommendation?: string | null };
  }>;
}): { text: string; provenance: FieldProvenanceMap; changed: boolean } {
  const provenance = opts.provenance ?? {};
  const present = new Set(
    splitToSentences(opts.current).map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  let text = opts.current;
  let nextProv = provenance;
  let changed = false;
  const seen = new Set<string>();
  for (const patch of opts.patches) {
    if (patch.stale) continue;
    const source = patch.source ?? "quick-findings";
    for (const raw of splitToSentences(patch.lastRendered?.recommendation ?? "")) {
      const sentence = raw.trim();
      const key = sentence.toLowerCase();
      if (!sentence || seen.has(key)) continue;
      seen.add(key);
      if (present.has(key) || text.includes(sentence)) {
        present.add(key);
        continue;
      }
      const merged = mergeReportFieldContentWithProvenance({
        field: "recommendation",
        existing: text,
        incoming: sentence,
        source,
        existingProvenance: nextProv,
      });
      if (merged.text === text) continue;
      text = merged.text;
      nextProv = merged.provenance;
      present.add(key);
      changed = true;
    }
  }
  if (!changed) return { text: opts.current, provenance, changed: false };
  return { text, provenance: nextProv, changed: true };
}

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
