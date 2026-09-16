import type { BaselineManifestObservation } from "../types";

/** Exact screening limitation phrase — must appear once in each screening findings string. */
export const SCREENING_LIMITATION_TEXT =
  "SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.";

export const SCREENING_LIMITATION_CONCEPT = "screening_limitation";

export function screeningLimitationObservation(): BaselineManifestObservation {
  return {
    id: "screening-limitation",
    field: "findings",
    concept: SCREENING_LIMITATION_CONCEPT,
    conflictGroup: SCREENING_LIMITATION_CONCEPT,
    anatomicalSection: "screening",
    renderedText: SCREENING_LIMITATION_TEXT,
  };
}

/**
 * Preserved technique fragment — survives format merge via formatSlotMerge
 * techniqueFragments preserve machinery. Does not replace the findings-owned
 * screening limitation observation; both carry the same exact sentence.
 */
export function screeningLimitationTechniqueFragment(): {
  text: string;
  dedupeKey: string;
  preserve: true;
} {
  return {
    text: SCREENING_LIMITATION_TEXT,
    dedupeKey: "screening-limitation-exact",
    preserve: true,
  };
}
