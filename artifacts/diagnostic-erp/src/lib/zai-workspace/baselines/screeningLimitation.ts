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
