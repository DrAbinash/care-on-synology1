/**
 * What a refused worklist close actually means, in the words the radiologist is
 * shown — and whether one click can finish the job.
 *
 * The finalize has two legs after the report row exists: the signature and the
 * `REPORT_FINAL` status flip. When the second one is refused the first has
 * usually already committed, so the screen has to say two different things about
 * two different objects (the report is signed; the study is still open). It did
 * that by printing whatever the server's sentence was into one fixed string,
 * which produced the production failure this module exists to prevent:
 *
 *   "Report signed — the study is NOT closed yet. Report #null is signed and
 *    prints from Report Hub."
 *
 * over a study that had no report row at all, because the branch asked only
 * "did the flip fail?" and never "was anything signed?". A radiologist who
 * believed that sentence stops re-signing, and the patient's report is not
 * signed.
 *
 * So the rules are stated here, once, as a pure function:
 *   - the word "signed" appears only when `signed` is true;
 *   - a report number is printed only when there is one, and never as `#null`;
 *   - the recovery offered is decided by the server's machine `code`, never by
 *     its sentence — three routes each hold their own copy of that text, and a
 *     button must not be offered because a string happened to match.
 */

/** The one refusal this app can answer with a click. */
export const UNLINKED_CONFIRM_REQUIRED = "UNLINKED_CONFIRM_REQUIRED";

export interface FinalizeRefusalState {
  /** `finalizeRadiologyReport().signed` — a signature is on the report row. */
  signed: boolean;
  reportId: number | null;
  /** `reportStatusCode` — the `code` from the refused flip's body, or null. */
  reportStatusCode?: string | null;
  /** The server's own sentence for the refusal, safe to quote but never to test. */
  reportStatusError?: string | null;
  /** Why no report row was created, when that is the case. */
  reportCreationSkipped?: string | null;
}

export interface FinalizeRefusalMessage {
  title: string;
  description: string;
  /**
   * True only when the radiologist holds a SIGNED report and the server refused
   * the close for the one reason a click can resolve: this worklist row has no
   * billed examination to verify its images against, and the route asks for a
   * single explicit confirmation. Every other refusal — a contradictory match, a
   * dead session, a study that was never signed — needs work the app cannot do
   * for him, so no click is offered.
   */
  canConfirmUnlinked: boolean;
}

export function finalizeRefusalMessage(r: FinalizeRefusalState): FinalizeRefusalMessage {
  const said = r.reportStatusError ? ` ${r.reportStatusError}` : "";
  const number = r.reportId ?? "—";

  if (!r.signed) {
    return {
      title: "NOT signed and NOT closed — no report was created",
      description:
        `Nothing has been signed, printed or sent${r.reportCreationSkipped ? `: ${r.reportCreationSkipped}` : ""}. `
        + "What is on screen is your draft, and it is also in this device's draft backup, so nothing is lost."
        + said
        + " Link the study to its patient and bill it in Match Center, then finalize again — the same draft is "
        + "reused, so no second report is created. Do not send this study to the patient from Report Hub: there is "
        + "nothing there to send.",
      canConfirmUnlinked: false,
    };
  }

  if (r.reportStatusCode === UNLINKED_CONFIRM_REQUIRED) {
    return {
      title: "Report signed — the study is NOT closed yet",
      description:
        `Report #${number} is signed and prints from Report Hub. It could not close the study because this `
        + "worklist row is not linked to a billed examination, so its images cannot be verified against one."
        + " Your images are NOT discarded and the report is NOT signed a second time: the button below only marks "
        + "the study final. If you would rather the images be verified first, relink the study in Match Center and "
        + "finalize again — the same report is reused either way.",
      canConfirmUnlinked: true,
    };
  }

  return {
    title: "Report signed — the study is NOT closed yet",
    description:
      `Report #${number} is signed and prints from Report Hub. The worklist could not be marked final:`
      + said
      + " Nothing was lost and nothing was signed twice — the study stays open, your draft backup is kept, and "
      + "finalizing again returns this same report rather than creating a second one.",
    canConfirmUnlinked: false,
  };
}

/**
 * The outcome of the one-click close, told truthfully. `ALREADY_FINAL` is a
 * success (the study is closed; the refusal only says a second close was not
 * needed), and nothing here may claim a signature — this leg does not sign.
 *
 * `unanswered` is the case the app has always got wrong: a lost response does
 * not prove the write did not land, so it must not read as "refused, try again".
 */
export function unlinkedCloseMessage(outcome: {
  closed: boolean;
  alreadyClosed: boolean;
  error: string | null;
  unanswered?: boolean;
}): { title: string; description: string; variant: "default" | "destructive" } {
  if (outcome.closed) {
    return {
      title: "Study closed",
      description:
        "The worklist is now final. The signed report is unchanged — this action only closes the study, "
        + "it does not sign or write anything.",
      variant: "default",
    };
  }
  if (outcome.alreadyClosed) {
    return {
      title: "Study was already closed",
      description: "The worklist already reads final, so nothing needed to change and nothing was written.",
      variant: "default",
    };
  }
  if (outcome.unanswered) {
    return {
      title: "No answer — check before closing again",
      description:
        "The server did not answer the close, so the study may already be final. Reload the worklist and check "
        + "its status before using this button again. The signed report is unchanged either way.",
      variant: "destructive",
    };
  }
  return {
    title: "Study still NOT closed",
    description:
      `Report stays signed and prints from Report Hub. Closing the study was refused again: ${outcome.error ?? "no reason given by the server"}`
      + " Nothing was signed a second time and no second report was created.",
    variant: "destructive",
  };
}
