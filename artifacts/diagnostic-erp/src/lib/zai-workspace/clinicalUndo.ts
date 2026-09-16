/**
 * Bounded clinical Undo history — radiologist actions, not every internal mutation.
 * Reuses PatchSnapshot shape from the workspace store.
 */
export const CLINICAL_UNDO_DEPTH = 5;

export type ClinicalUndoSnapshot = {
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  fieldProvenance: unknown;
  appliedPathologyPatches: unknown[];
  voiceComposerObservations: unknown[];
  voiceComposerTranscriptHistory: string[];
  appliedFormatName?: string | null;
  appliedFormatReportTitle?: string | null;
  /** Optional Starting Canvas identity captured with the action. */
  startingCanvasBaseline?: unknown;
};

/** Push a new clinical action snapshot; drop oldest when over capacity. */
export function pushClinicalUndoSnapshot<T>(
  stack: readonly T[],
  snapshot: T,
  depth = CLINICAL_UNDO_DEPTH,
): T[] {
  const next = [...stack, snapshot];
  if (next.length <= depth) return next;
  return next.slice(next.length - depth);
}

/** Pop the newest snapshot; returns [snapshot, remainingStack] or null. */
export function popClinicalUndoSnapshot<T>(
  stack: readonly T[],
): { snapshot: T; remaining: T[] } | null {
  if (stack.length === 0) return null;
  const snapshot = stack[stack.length - 1]!;
  return { snapshot, remaining: stack.slice(0, -1) };
}

export function topClinicalUndoSnapshot<T>(stack: readonly T[]): T | null {
  return stack.length ? stack[stack.length - 1]! : null;
}
