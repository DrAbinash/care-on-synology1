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
import type { CanonicalObservation } from "./observationSlot";

/**
 * Put each observation's own recommendation sentence into the recommendation
 * box. Sentences already there stay, including a normal-format line and
 * anything the radiologist typed. When no observation owns a recommendation,
 * the box is left untouched. A patch whose contribution was deleted or
 * rewritten by hand (protected) is skipped: re-inserting its advice would
 * silently undo the deletion — the same refusal the impression side makes.
 */
export function alignRecommendationToObservations(opts: {
  current: string;
  provenance?: FieldProvenanceMap;
  patches: Array<{
    stale?: boolean;
    /** A manual edit removed or rewrote this patch's contribution — the
     * patch is the radiologist's now, and its canned advice must not be
     * re-asserted behind their back (same rule as the impression side). */
    protected?: boolean;
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
    if (patch.stale || patch.protected) continue;
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

/** Impression shortcut labels from active pathology patches (for compact chip row).
 *
 * The observation is accepted OPTIONALLY: the store's AppliedPathologyPatch
 * carries `observation?: CanonicalObservation` while the ledger's LedgerPatch
 * requires it, and the workspace hands this helper the applied-patch view.
 * The observation itself is never read here — only the last-rendered
 * impression text — but accepting the shape keeps the call sites typable
 * without a per-site adapter. */
export function collectPathologyImpressionShortcuts(
  patches: Array<Pick<LedgerPatch, "lastRendered"> & { observation?: CanonicalObservation }>,
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
