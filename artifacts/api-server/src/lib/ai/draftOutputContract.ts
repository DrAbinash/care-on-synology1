/**
 * draftOutputContract.ts — the two halves of one promise, kept in one file so
 * they cannot drift apart (Audit C / C1).
 *
 * THE PROMISE
 *   `/draft` asks the model for a specific SECTION of a report — the Impression
 *   on the workspace's Ctrl+I path — and the section it asks for is named by a
 *   marker the model is told to emit. So the instruction and the parser are one
 *   contract, and they used to live 150 lines apart in a route handler with
 *   nothing tying them together.
 *
 *   The consequence was reproduced, not theorised: for an impression-only
 *   request the parser was
 *
 *     aiResponse.match(/IMPRESSION:?\s*([\s\S]*?)$/i)?.[1] ?? aiResponse
 *
 *   A model that answered with plain prose — no marker, for any reason: a chat
 *   preamble it was told to omit, a different casing style, a small local model
 *   ignoring format — had that prose returned as THE IMPRESSION, with
 *   `parserSuccess: true`. It then landed in the ghost layer of a radiologist's
 *   Impression field, one Tab from becoming report content, labelled as a
 *   summarised impression when nothing was ever identified as one.
 *
 *   C1 fails closed instead. The whole response is never substituted for the
 *   requested section; the caller gets an empty section plus a reason.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   No keyword guessing, no second model call to "fix" the output, no smarter
 *   parsing, no change to what the model is asked to say. The markers below are
 *   the ones the shipped prompt has always demanded; only the failure behaviour
 *   changed. Grounding/verification stays where it is (`validateOutput`).
 */
import { DRAFT_SAFETY_CLAUSES } from "./draftPromptSafety";

/** The section markers the prompt demands and the parser requires. */
export const DRAFT_SECTION_MARKERS = {
  findings: "FINDINGS:",
  impression: "IMPRESSION:",
} as const;

/** Which section the caller will consume. `full` is the legacy two-section call. */
export type DraftFieldRequest = "impression" | "full";

export type DraftParseReason =
  | "empty_response"
  | "missing_impression_marker"
  | "missing_findings_marker";

export interface DraftParseResult {
  findings: string;
  impression: string;
  /** False when the response cannot be read as the section that was requested. */
  ok: boolean;
  reason: DraftParseReason | null;
  /** True when the FINDINGS: marker was found, whatever else happened. */
  findingsMarkerFound: boolean;
  /** True when the IMPRESSION: marker was found. */
  impressionMarkerFound: boolean;
}

const CROSS_MODALITY_CLAUSE =
  "Do NOT use wording from a different modality or body region " +
  "(e.g. never write 'chest radiograph' for a CT/MRI brain).\n";

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build the extractor for one marker from the marker itself, so the prompt's
 * demanded string and the regex that reads it are the same value. The colon is
 * optional (`IMPRESSION:` / `IMPRESSION :`) exactly as the shipped regexes
 * allowed; everything else is unchanged.
 */
function bodyOf(marker: string, stopAt?: string): RegExp {
  const word = escapeRe(marker.replace(/:$/, ""));
  const stop = stopAt ? `(?=${escapeRe(stopAt)}|$)` : "$";
  return new RegExp(`${word}:?\\s*([\\s\\S]*?)${stop}`, "i");
}

/**
 * The instruction block appended to every `/draft` prompt. Text preserved
 * verbatim from the handler — a radiologist-visible behaviour change would not
 * belong in an infrastructure PR — now generated from `DRAFT_SECTION_MARKERS`.
 */
export function draftInstructionBlock(field: DraftFieldRequest): string {
  if (field === "impression") {
    return "\n\n=== INSTRUCTION ===\n"
      + "Write ONLY the IMPRESSION for THIS study, summarising the Current Findings above.\n"
      + "Do NOT restate or rewrite the findings, and do NOT add any finding that is not already in them.\n"
      + CROSS_MODALITY_CLAUSE
      + DRAFT_SAFETY_CLAUSES
      + "\nReturn ONLY:\n"
      + `${DRAFT_SECTION_MARKERS.impression} (concise impression)\n`
      + "Do not include any other text or explanations.";
  }
  return "\n\n=== INSTRUCTION ===\n"
    + "Generate a refined radiology report for THIS study only.\n"
    + CROSS_MODALITY_CLAUSE
    + DRAFT_SAFETY_CLAUSES
    + "\nReturn ONLY two sections:\n"
    + `${DRAFT_SECTION_MARKERS.findings} (structured findings)\n`
    + `${DRAFT_SECTION_MARKERS.impression} (concise impression)\n`
    + "Do not include any other text or explanations.";
}

/**
 * Read the model's answer as the requested section — or refuse it.
 *
 * `findings` is only ever populated for a `full` request, and an Impression is
 * never read from a response that failed to mark one. There is no path through
 * this function that returns the whole response as a clinical section.
 */
export function parseDraftOutput(input: {
  aiResponse: string | null | undefined;
  field: DraftFieldRequest;
}): DraftParseResult {
  const raw = (input.aiResponse ?? "").trim();
  const refused = (reason: DraftParseReason, found: Partial<Pick<DraftParseResult, "findingsMarkerFound" | "impressionMarkerFound">> = {}): DraftParseResult => ({
    findings: "",
    impression: "",
    ok: false,
    reason,
    findingsMarkerFound: false,
    impressionMarkerFound: false,
    ...found,
  });

  if (!raw) return refused("empty_response");

  const impressionMatch = raw.match(bodyOf(DRAFT_SECTION_MARKERS.impression));
  const findingsMatch = raw.match(bodyOf(DRAFT_SECTION_MARKERS.findings, DRAFT_SECTION_MARKERS.impression));

  if (input.field === "impression") {
    if (!impressionMatch) {
      // The failure C1 exists for: prose that is not marked as an Impression is
      // not an Impression, and must not be handed back as one.
      return refused("missing_impression_marker", {
        findingsMarkerFound: !!findingsMatch,
        impressionMarkerFound: false,
      });
    }
    return {
      findings: "",
      impression: (impressionMatch[1] ?? "").trim(),
      ok: true,
      reason: null,
      findingsMarkerFound: false,
      impressionMarkerFound: true,
    };
  }

  if (!findingsMatch) return refused("missing_findings_marker");
  return {
    findings: (findingsMatch[1] ?? "").trim(),
    // A `full` answer without an Impression section still yields the findings it
    // was asked for; that partial case behaved this way before C1 and is not the
    // defect being closed.
    impression: impressionMatch ? (impressionMatch[1] ?? "").trim() : "",
    ok: true,
    reason: null,
    findingsMarkerFound: true,
    impressionMarkerFound: !!impressionMatch,
  };
}

/** Operator-facing sentence for a refusal, kept next to the reason it describes. */
export function draftParseFailureMessage(reason: DraftParseReason | null): string {
  switch (reason) {
    case "missing_impression_marker":
      return "The model answered without the IMPRESSION: section the request asked for, so nothing was returned as an impression.";
    case "missing_findings_marker":
      return "The model answered without the FINDINGS: section the request asked for, so nothing was returned as findings.";
    case "empty_response":
      return "The model returned no text.";
    default:
      return "The model's answer could not be read as the requested section.";
  }
}
