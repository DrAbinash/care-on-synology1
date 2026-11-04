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

/**
 * What the store actually did with the accepted text. `applyAiComposerAccepted`
 * answers this and `applyAccepted` used to throw the answer away, which is how a
 * study the signed boundary refused still finished with "AI draft applied".
 */
export type ComposerWriteVerdict = "applied" | "blocked";

export type ComposerApplyOutcome =
  | {
      readonly kind: "refused";
      readonly claimSuccess: false;
      readonly recordApplied: false;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "did-not-land";
      readonly claimSuccess: false;
      readonly recordApplied: false;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "already-there";
      readonly claimSuccess: false;
      readonly recordApplied: true;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "applied";
      readonly claimSuccess: true;
      readonly recordApplied: true;
      readonly title: string;
      readonly description: string;
    };

const sameTexts = (a: ComposerClickTimeTexts, b: ComposerLiveTexts): boolean =>
  a.findings === b.findingsText
  && a.impression === b.impressionText
  && a.recommendation === b.recommendationText;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence that closes an Apply, decided from what the editor holds rather
 * than from the fact that the code reached this line.
 *
 * The button reads "Apply accepted changes" and until now it could say
 * "AI draft applied" in three situations where nothing of the kind happened: the
 * signed boundary refused the write and its verdict was discarded; the write
 * landed and something else replaced it; or the accepted text was already exactly
 * the report, so no clinical text moved at all. "Success" is only owed when the
 * intended text is in the fields at the moment of the claim — the same
 * byte-equality standard `composerApplyGate` holds the pre-write window to.
 *
 * `claimSuccess` is what the closing sentence is allowed to say. `recordApplied`
 * is what the caller acts on: a refused or undone Apply must not be recorded as
 * applied on the server either, so it gates the two awaits that follow, not just
 * the wording. An `already-there` Apply is still recorded — the draft was consumed
 * and the study legitimately moves to APPLIED — it is just never called a change.
 *
 * The caller asks twice: once at the write instant, to decide `recordApplied`, and
 * once after the persistence awaits, for the closing sentence, because the text is
 * not guaranteed to still be there when the awaits return. Every description here is
 * therefore written to be true at both moments, and names no server-side outcome it
 * cannot see.
 */
export function composerApplyOutcome(opts: {
  verdict: ComposerWriteVerdict;
  intended: ComposerClickTimeTexts;
  beforeWrite: ComposerClickTimeTexts;
  landed: ComposerLiveTexts;
  unreviewedAccepted: number;
}): ComposerApplyOutcome {
  if (opts.verdict === "blocked") {
    return {
      kind: "refused",
      claimSuccess: false,
      recordApplied: false,
      title: "Nothing was written",
      description: "This report is signed, so the accepted draft was refused. Your report text is unchanged and the draft is still in the review panel.",
    };
  }
  if (!sameTexts(opts.intended, opts.landed)) {
    return {
      kind: "did-not-land",
      claimSuccess: false,
      recordApplied: false,
      title: "Accepted text is not in the report",
      description: "The editors do not hold the text this Apply was meant to write, so it is not being called a success. Nothing you had typed was replaced by it. Compare the draft or Regenerate.",
    };
  }
  if (sameTexts(opts.beforeWrite, opts.landed)) {
    return {
      kind: "already-there",
      claimSuccess: false,
      recordApplied: true,
      title: "Already in the report",
      description: opts.unreviewedAccepted > 0
        ? `The accepted text is byte-for-byte what the report already said, so no clinical text changed. ${plural(opts.unreviewedAccepted, "change", "changes")} you had not reviewed ${opts.unreviewedAccepted === 1 ? "is" : "are"} now recorded as accepted.`
        : "The accepted text is byte-for-byte what the report already said, so no clinical text changed.",
    };
  }
  return {
    kind: "applied",
    claimSuccess: true,
    recordApplied: true,
    title: "AI draft applied",
    description: opts.unreviewedAccepted > 0
      ? `${plural(opts.unreviewedAccepted, "change", "changes")} you had not reviewed were accepted with the accepted ones. One Undo restores the previous report.`
      : "One Undo restores the previous report.",
  };
}
