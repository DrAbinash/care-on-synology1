/**
 * learningEngine.ts — per-radiologist Learning Engine (Phase 5).
 *
 * Pure decision logic for "has this radiologist done this often enough
 * that it's worth suggesting?" The actual counting/storage lives server-
 * side (radiology_learned_patterns table); this module only decides
 * ranking and the suggestion threshold, so it's independently testable
 * and reusable if the storage layer ever changes.
 *
 * Suggestion-only, per spec: this module never returns an instruction to
 * auto-insert anything, only a ranked list for the UI to *offer*.
 */

export interface LearnedPattern {
  triggerLabel: string;
  suggestedText: string;
  occurrenceCount: number;
  lastUsedAt: string | Date;
}

/** Minimum times a pattern must have been used before it's suggested —
 *  avoids surfacing a one-off phrase as if it were a habit. */
export const LEARNING_THRESHOLD = 3;

/** Returns learned patterns for `triggerLabel` that have crossed the
 *  threshold, most-used and most-recent first. */
export function rankSuggestions(patterns: LearnedPattern[], triggerLabel: string): LearnedPattern[] {
  const norm = triggerLabel.trim().toLowerCase();
  return patterns
    .filter((p) => p.triggerLabel.trim().toLowerCase() === norm && p.occurrenceCount >= LEARNING_THRESHOLD)
    .sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    });
}

/** True if a piece of text is "new" enough vs a trigger's finding text to
 *  be worth recording as a learned addition (i.e. not just the button's
 *  own template text repeated back). */
export function isLearnableAddition(candidateText: string, templateText: string): boolean {
  const c = candidateText.trim();
  if (c.length < 8) return false; // too short to be a meaningful habit
  if (!c || c === templateText.trim()) return false;
  return true;
}
