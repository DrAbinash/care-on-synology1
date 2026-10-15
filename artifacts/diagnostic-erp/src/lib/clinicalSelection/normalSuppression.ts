/**
 * Stage C-1 · set-based normal suppression.
 *
 * A baseline normal is false when at least one **currently selected** observation falsifies it. It is
 * not a fact about which box was clicked first, and it is not a fact about which sentence a previous
 * render happened to delete.
 *
 * The shipped engine recorded, per patch, only the baseline sentences that patch happened to replace
 * (`observationLedger.ts:53`, filled at `store.ts:2472`), and restoring on deselection used exactly
 * that private list (`observationLedger.ts:181,184`). When two abnormalities declare the same normal,
 * the second one to be clicked records nothing, so deselecting either one produces a different report —
 * and one of those reports asserts a normal the surviving abnormality contradicts.
 *
 * This module is deliberately pure: no React, no database, no AI, no clock, no randomness. It takes the
 * active set and answers set questions. The observation ledger stays the single authoritative
 * application state — see `docs/clinical/V4_STAGE_C_INTEGRATION_MAP.md` §1.
 */

import { normalizeForDedupe, splitToSentences } from "../reportFieldMerge";
import { sentenceMatchesConcept } from "../observationSlot";

/** The minimum an observation has to say to be consulted. Mirrors `CanonicalObservation`. */
export type SuppressingObservation = {
  /** The baseline sentence this observation declares false, as the catalogue or tile states it. */
  baselineReplaces?: string | null;
  /** Resolved clinical concept, when one exists. */
  concept?: string | null;
  /** Text the observation actually put in the report — used for concept-level falsification. */
  renderedText?: string | null;
};

/** A baseline sentence with the position it holds in the canonical (anatomical) order. */
export type CanonicalSlot = {
  sentence: string;
  /** Catalogue placement order; lower prints earlier. Absent means unordered. */
  ordinal?: number | null;
};

const key = (s: string): string => normalizeForDedupe(s);

function nonEmpty(text: string | null | undefined): string {
  return (text ?? "").trim();
}

/**
 * True when `sentence` — a baseline normal — is falsified by `observation` on its own terms.
 *
 * Two routes, and only the two the catalogue already declares:
 *  1. the observation names this exact baseline (`baselineReplaces`), which is how shipped tiles
 *     express retirement today;
 *  2. the observation carries a resolved concept and the baseline sentence is about that concept —
 *     the same oracle `applyPathologyPatch` uses through `sentenceOwnedBySlot`, reused here rather
 *     than re-derived, so the two paths cannot disagree about what a tile falsifies.
 */
export function falsifies(observation: SuppressingObservation, sentence: string): boolean {
  const declared = nonEmpty(observation.baselineReplaces);
  if (declared && key(declared) === key(sentence)) return true;
  const concept = nonEmpty(observation.concept);
  if (concept && sentenceMatchesConcept(sentence, concept)) return true;
  return false;
}

/**
 * Which baseline sentences the **complete active set** still falsifies.
 *
 * Order-invariant by construction: the result depends only on set membership, never on the sequence
 * the members were added.
 */
export function suppressedKeys(active: readonly SuppressingObservation[], candidates: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const sentence of candidates) {
    if (active.some((observation) => falsifies(observation, sentence))) out.add(key(sentence));
  }
  return out;
}

/**
 * The sentences a deselection may legitimately put back.
 *
 * `replaced` is what the removed patch recorded; `surviving` is every observation still selected after
 * the removal. A sentence returns only when no surviving observation falsifies it — so a normal shared
 * by two abnormalities stays retired while either one is held, and comes back exactly once, when the
 * last one goes.
 */
export function filterRestorableBaselines(
  replaced: readonly string[],
  surviving: readonly SuppressingObservation[],
): string[] {
  const stillSuppressed = suppressedKeys(surviving, replaced);
  return replaced.filter((sentence) => !stillSuppressed.has(key(sentence)));
}

/**
 * Re-insert a restored normal at its canonical anatomical position instead of appending it.
 *
 * Appending is what put "vertebral bodies demonstrate normal height and marrow signal" *below* a C2
 * lytic lesion, where it reads as a finding. `canonical` is the baseline's own order — for a v4
 * publication it is the snapshot's `(ordinal NULLS LAST, identity)` sequence, already deterministic in
 * `cataloguePublicationSnapshot.ts:311-321`; for a shipped format it is the format's baseline text.
 *
 * The sentence is placed before the first present sentence that follows it canonically, so a restored
 * normal rejoins its neighbours and never lands under pathology it contradicts. Sentences the field
 * holds that are not in the canonical order (radiologist-written text, lesions) are never moved.
 */
export function insertAtCanonicalPosition(
  fieldText: string,
  sentence: string,
  canonical: readonly CanonicalSlot[],
): string {
  const lines = fieldText.split(/\r?\n/);
  if (lines.length === 0) return sentence;
  // Restoration is idempotent. A normal the field already holds is not re-inserted merely because a
  // second patch also recorded it — which is exactly how two tiles claiming one baseline would
  // otherwise print the same sentence twice.
  if (lines.some((line) => key(line) === key(sentence))) return fieldText;

  const presentAt = new Map<string, number>();
  lines.forEach((line, index) => {
    const k = key(line);
    if (k && !presentAt.has(k)) presentAt.set(k, index);
  });

  const myRank = canonical.findIndex((slot) => key(slot.sentence) === key(sentence));
  if (myRank < 0) return appendIfAbsent(fieldText, lines, sentence);

  for (const slot of canonical.slice(myRank + 1)) {
    const at = presentAt.get(key(slot.sentence));
    if (at !== undefined) {
      return [...lines.slice(0, at), sentence, ...lines.slice(at)].join("\n");
    }
  }
  return appendIfAbsent(fieldText, lines, sentence);
}

function appendIfAbsent(fieldText: string, lines: string[], sentence: string): string {
  if (lines.some((line) => key(line) === key(sentence))) return fieldText;
  return fieldText.trim() ? `${fieldText.trimEnd()}\n${sentence}` : sentence;
}

/** Canonical slot list from a baseline text, preserving the order the baseline itself is written in. */
export function canonicalOrderFromBaseline(
  sentences: readonly string[],
  ordinals?: readonly (number | null)[]): CanonicalSlot[] {
  return sentences.map((sentence, index) => ({
    sentence,
    ordinal: ordinals?.[index] ?? index,
  }));
}

/** The canonical anatomical order of a recorded baseline — a format's Findings or Impression text. */
export function canonicalOrderFromText(text: string | null | undefined): CanonicalSlot[] {
  if (!text || !text.trim()) return [];
  return canonicalOrderFromBaseline(splitToSentences(text).map((s) => s.trim()).filter(Boolean));
}

/**
 * The observations that still falsify a normal after a deselection.
 *
 * Two exclusions, both deliberate:
 *  - **`stale` patches are not suppressors.** A stale row is a baseline whose text was emptied when
 *    something else took its place (`store.ts:2419`); it holds no clinical claim, so counting it as
 *    falsifying a normal would keep a normal retired after the abnormality that retired it is gone.
 *  - **A baseline-role observation is not a suppressor.** Explicitly selecting a normal tile asserts
 *    that normality; it cannot simultaneously be what falsifies another normal.
 *
 * Independently-selected abnormalities are all kept, including two that share one baseline — which is
 * the case this whole module exists for. Manually authored text is not a suppressor either, because it
 * declares no baseline: the radiologist's sentence stays exactly where they wrote it.
 */
export function activeSuppressors(
  patches: readonly {
    stale?: boolean;
    observation?: {
      role?: string | null;
      baselineReplaces?: string | null;
      concept?: string | null;
    } | null;
  }[],
): SuppressingObservation[] {
  return patches
    .filter((p) => !p.stale && p.observation && p.observation.role !== "baseline")
    .map((p) => ({
      baselineReplaces: p.observation?.baselineReplaces ?? null,
      concept: p.observation?.concept ?? null,
    }))
    .filter((s) => nonEmpty(s.baselineReplaces) || nonEmpty(s.concept));
}
