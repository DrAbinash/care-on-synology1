import type { AiDraftValidation } from "@workspace/api-zod";

/**
 * Error codes that do not apply to an Impression.
 *
 * An Impression is a summary: it legitimately condenses six measured levels down
 * to the one that matters, so a measurement that did not survive the condensing
 * is not evidence of anything. A full-report draft is a different contract — it
 * is expected to carry every supplied measurement forward, so there the same
 * code IS the finding. Conflating the two is what would make Ctrl+I warn on
 * almost every press and get ignored, and a warning nobody reads is worse than
 * no warning.
 */
const NOT_APPLICABLE_TO_IMPRESSION = new Set(["measurement_mutation"]);

/** Human phrasing for codes worth naming rather than showing raw. */
const ERROR_PHRASES: Record<string, string> = {
  impression_ungrounded: "states an abnormality in the Impression that the Findings do not support",
  empty_output: "came back empty",
};

/**
 * Turn the server's grounding verdict into the one line a radiologist should
 * read before accepting an AI draft — or null when there is nothing to warn
 * about.
 *
 * The verdict itself is computed server-side by the background composer's own
 * validator (see `AiDraftValidation.validator`). This module decides only what
 * is worth interrupting a radiologist over, which is a presentation question and
 * deliberately not a second validator.
 */
export function draftValidationNotice(
  validation: AiDraftValidation | null | undefined,
  opts: { impressionOnly: boolean },
): string | null {
  if (!validation) return null;

  const parts: string[] = [];
  if (validation.unsupportedMentions.length > 0) {
    parts.push(
      `names ${joinTerms(validation.unsupportedMentions)}, which appear nowhere in your findings`,
    );
  }
  if (validation.lateralitySwaps.length > 0) {
    parts.push(`may have changed the side (${joinTerms(validation.lateralitySwaps)})`);
  }
  if (validation.levelChanges.length > 0) {
    parts.push(`introduced ${joinTerms(validation.levelChanges)}, a level not in your findings`);
  }
  if (validation.severityEscalations.length > 0) {
    parts.push(`escalated severity (${joinTerms(validation.severityEscalations)})`);
  }
  if (!opts.impressionOnly && validation.errors.includes("measurement_mutation")) {
    parts.push("dropped or altered a supplied measurement");
  }

  if (parts.length > 0) {
    return `The AI draft ${parts.join("; ")}. Verify against the images before accepting.`;
  }

  // Any error code left over after the named checks above. Surfaced by default
  // so a check added to the validator later cannot silently vanish from the UI,
  // and so a draft the server refused to vouch for is never shown as clean.
  const unphrased = validation.errors.filter(
    (code) => !(opts.impressionOnly && NOT_APPLICABLE_TO_IMPRESSION.has(code)),
  );
  if (unphrased.length > 0) {
    const phrases = unphrased.map((code) => ERROR_PHRASES[code] ?? `failed a grounding check (${code})`);
    return `The AI draft ${phrases.join("; ")}. Verify against the images before accepting.`;
  }
  return null;
}

function joinTerms(terms: string[]): string {
  const unique = [...new Set(terms)];
  if (unique.length === 0) return "none reported";
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}
