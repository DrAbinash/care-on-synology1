/**
 * instantReport.ts — MODE A: the report builds itself while the radiologist works.
 *
 * The engine that assembles the report already exists (`generateProfessionalReport`
 * in the workspace store): it merges this examination's approved normal, replays the
 * observation ledger, retires the normals a recorded abnormality contradicts and
 * re-derives the Impression, with no model in the loop. What did not exist was the
 * *running of it as inputs change* — `reportComposerAutoCompose` was stored by the
 * AI settings page and read by nothing, so the whole-report build waited on a button.
 *
 * This module holds only the decisions that make an automatic build safe, kept apart
 * from the store so each one can be executed and falsified without a browser:
 *
 *  1. It never runs over content the radiologist wrote and the engine cannot
 *     reproduce. An automatic pass may not silently reformat a dictated report, so
 *     the first merge into a canvas that carries foreign text needs the press.
 *  2. It never rewrites a Conclusion the radiologist wrote by hand. The controls they
 *     press may; a pass they did not press may not.
 *  3. A hold is a stated state, not a silence. Every reason not to compose names the
 *     step the radiologist takes next.
 *  4. A pass that cannot produce a conclusion produces none of them: it rebuilds the
 *     Findings and leaves the Impression exactly as it was, then says so.
 *
 * What is deliberately NOT decided here: which report format this examination uses,
 * and whether the clinic owns its normal. That belongs to the generator, which is
 * the only code allowed to pick a format. A caller that resolved it again in order to
 * pre-check it would be a second authority answering the same question differently,
 * and `regionTransitionReload.test.ts` exists precisely to refuse that.
 */

import type { ProfessionalReportOutcome, ProfessionalReportRefusalCode } from "./professionalReport";

/** The radiologist's own switch, remembered per workstation. Mode A composes with no
 *  provider configured, so this is deliberately NOT the AI settings page's
 *  `reportComposerAutoCompose` — that flag governs an Ollama job and must keep doing
 *  only that. */
export const INSTANT_REPORT_STORAGE_KEY = "care.instantReport.modeA.enabled";

/** One composition per thought, not per keystroke. Long enough that a two-word
 *  finding typed in one flow produces one pass, short enough that the report is
 *  written by the time the radiologist looks up. */
export const INSTANT_REPORT_DEBOUNCE_MS = 700;

/** `off`, `locked` and the codes below them that come from a refusal are this module's
 *  own; the rest are the generator's refusal codes, passed through by name so one
 *  refusal cannot arrive on screen under two different labels. */
export type InstantReportHoldCode =
  | "off"
  | "locked"
  | "confirmation-open"
  | "manual-impression"
  | "starts-from-dictation"
  | "impression-undecided"
  | ProfessionalReportRefusalCode;

export type InstantReportInput = {
  /** The Mode A switch, read from the workstation preference. */
  enabled: boolean;
  /** A signed or content-locked report is not this feature's to touch. */
  contentLocked: boolean;
  /** A confirmation already on screen is CARE asking a question it has not answered. */
  confirmationOpen: boolean;
  /** `fieldProvenance.impression` says a radiologist wrote the Conclusion themselves. */
  manualImpression: boolean;
  /** Findings lines that belong to no ledger row and no scaffold sentence. */
  foreignFindingsLines: number;
  /** This canvas was already built by the engine (Start Report, or an earlier pass). */
  engineOwnsCanvas: boolean;
};

export type InstantReportDecision =
  | { action: "compose" }
  | { action: "hold"; code: InstantReportHoldCode; message: string };

/**
 * The order is load-bearing. `locked` and `off` answer "should this feature be here
 * at all" and say nothing to the radiologist; the rest are holds that must reach
 * them, and they are checked from the widest veto inwards — a signed report whose
 * Impression is also manual gets the locked sentence, not the impression one.
 */
export function decideInstantReport(input: InstantReportInput): InstantReportDecision {
  if (!input.enabled) return { action: "hold", code: "off", message: "" };
  if (input.contentLocked) return { action: "hold", code: "locked", message: "" };
  if (input.confirmationOpen) {
    return {
      action: "hold",
      code: "confirmation-open",
      message: "Answer the confirmation on screen before the report rebuilds itself.",
    };
  }
  if (input.manualImpression) {
    return {
      action: "hold",
      code: "manual-impression",
      message: "Your Impression is yours. Press Generate to rebuild it from your findings.",
    };
  }
  // The one hold that is about authorship rather than safety: an automatic first
  // merge would write the whole approved normal underneath a report that began as
  // dictation. Once the engine owns the canvas it only ever updates what it wrote.
  if (input.foreignFindingsLines > 0 && !input.engineOwnsCanvas) {
    return {
      action: "hold",
      code: "starts-from-dictation",
      message: "This report started from your own text. Press Generate to merge the approved normal.",
    };
  }
  return { action: "compose" };
}

/** A hold the radiologist has to see. `off` and `locked` are not news: the feature
 *  is switched off, or the report is signed and nothing about it is editable. */
export function holdIsReportable(code: InstantReportHoldCode): boolean {
  return code !== "off" && code !== "locked";
}

/**
 * The generator's own refusal, in the auto-compose state.
 *
 * The code passes through by name and the `reason` passes through by text: the
 * generator already explains itself in terms of the next action, and forking a
 * second wording here is how two surfaces start disagreeing about the same refusal.
 * `signed` is the one translation — to the silent `locked`, because a signed report
 * is not this feature's to comment on.
 */
export function holdFromRefusal(
  outcome: Extract<ProfessionalReportOutcome, { status: "refused" }>,
): { code: InstantReportHoldCode; message: string } {
  if (outcome.code === "signed") return { code: "locked", message: "" };
  return { code: outcome.code, message: outcome.reason };
}

/**
 * The pass built the Findings and declined to rebuild the Conclusion.
 *
 * This is not a refusal to compose — the report did change — it is the engine
 * reporting that one section of it is now the radiologist's work and not its own.
 * The case is reachable on shipped content: a Quick Select box that records an
 * abnormality writes Findings only, so once the approved normal it falsifies is
 * retired, NOTHING in the ledger concludes for the study. Deriving from an empty
 * set produces an empty Impression, and an unpressed pass that deletes the one
 * section that states the diagnosis is a silent clinical mutation with a
 * user-visible symptom: a report that makes no claim about the patient.
 *
 * The named recovery is the one `instantReport.test.ts` proves holds: text the
 * radiologist writes here is never overwritten by a later pass. "Press Generate"
 * would not be — a press takes the rebuild and the ledger still says nothing.
 */
export const IMPRESSION_UNDECIDED_HOLD: { code: InstantReportHoldCode; message: string } = {
  code: "impression-undecided",
  message: "Your findings left the approved normal, but no finding writes a conclusion. "
    + "The Impression is unchanged — write it; this pass will not overwrite what you type.",
};

export function readInstantReportEnabled(): boolean {
  try {
    // Mode A is the default report path, so the default is on: an absent key is not
    // a decision anybody made. Only an explicit "0" turns the feature off.
    return globalThis.localStorage?.getItem(INSTANT_REPORT_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeInstantReportEnabled(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.removeItem(INSTANT_REPORT_STORAGE_KEY);
    else globalThis.localStorage?.setItem(INSTANT_REPORT_STORAGE_KEY, "0");
  } catch {
    // A workstation that cannot persist a preference still gets the default.
  }
}
