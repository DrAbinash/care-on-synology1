/**
 * composerApplyGate.ts — the last instant before an AI draft is written into
 * the editor, read against the live store.
 *
 * `applyAccepted` runs a gauntlet of awaits between the radiologist's click and
 * the write: a freshness round trip, one accept call per pending change, a job
 * refresh, materialisation. The freshness check compares the CLICK-TIME text
 * against the server's record — it cannot see that the radiologist kept typing
 * while those round trips ran, and neither can the closure values it hashed:
 * they are frozen at click time by design. The store is not. Writing the
 * merged draft at that moment silently discarded every sentence typed inside
 * the async window (F1), and after a study switch the same write replaced
 * Patient B's editor content with Patient A's applied draft (D-13's
 * cross-study arm) — content the confirmation's server-side identity check
 * could not protect, because the mutation happens before the confirm call.
 *
 * The gate is byte equality between the click-time snapshot and
 * `readWorkspaceClinicalTexts()` read at the last moment before the write, over
 * the three narrative fields an Apply touches. One character typed in the
 * window is one character the write would delete, so one character of
 * difference stops the Apply. The radiologist's text wins; the draft stays in
 * the panel for a Compare or Regenerate.
 *
 * Pure, and deliberately ignorant of React: the hook wires it, tests execute
 * it against the real store, and nothing about it can re-derive clinical
 * meaning.
 */

/** The three narrative fields an Apply writes, in the closure's naming. */
export type ComposerClickTimeTexts = {
  findings: string;
  impression: string;
  recommendation: string;
};

/** The live store's shape for the same fields (readWorkspaceClinicalTexts). */
export type ComposerLiveTexts = {
  findingsText: string;
  impressionText: string;
  recommendationText: string;
};

export type ComposerApplyGateDecision =
  | { readonly proceed: true }
  | {
      readonly proceed: false;
      readonly reason: "content-moved-in-window";
      readonly detail: string;
    };

/**
 * May the draft be written into the editor right now?
 *
 * Byte equality is the whole contract. No normalisation, no sentence
 * similarity: the click-time snapshot is exactly what the freshness check
 * hashed, and anything the live store no longer matches was typed, dictated or
 * switched in after the radiologist pressed Apply.
 */
export function composerApplyGate(
  clickTime: ComposerClickTimeTexts,
  liveNow: ComposerLiveTexts,
): ComposerApplyGateDecision {
  const moved =
    clickTime.findings !== liveNow.findingsText
    || clickTime.impression !== liveNow.impressionText
    || clickTime.recommendation !== liveNow.recommendationText;
  if (!moved) return { proceed: true };
  return {
    proceed: false,
    reason: "content-moved-in-window",
    detail: "the report text changed while the Apply was running, so writing the "
      + "draft now would overwrite edits that have not been read — nothing was "
      + "written; Compare or Regenerate",
  };
}
