/**
 * usgProstateConfig — the ONE place USG prostate clinical thresholds live.
 *
 * The prostatomegaly volume threshold is defined here, not scattered across
 * React components or finding definitions, so it can be tuned/managed centrally
 * (and later made server-configurable without touching the builder). The
 * frontend uses this only to SUGGEST a clinical finding — never to write one.
 */

/** Upper limit of normal prostate volume (mL). ~30 mL is the widely-referenced
 *  cutoff. This is a size threshold used only to raise a suggestion the
 *  radiologist must confirm — it is NOT a diagnosis and NOT a numeric grade. */
export const PROSTATE_ENLARGEMENT_THRESHOLD_ML = 30;

/** No approved prostate volume GRADING rule exists in the platform, so no
 *  numeric grade is ever assigned. If/when an approved grading configuration is
 *  added, wire it here; until then the system only offers the binary size
 *  suggestion (normal vs enlarged). */
export const PROSTATE_GRADING_CONFIG: null = null;

/** The radiologist-controlled clinical decision — distinct from the measurement.
 *  "Awaiting radiologist" is the default: the impression is NOT written until a
 *  human confirms one of the definite outcomes. */
export type ProstateClinicalFinding =
  | "Awaiting radiologist"
  | "Normal prostate"
  | "Prostatomegaly"
  | "Indeterminate";

export const PROSTATE_CLINICAL_OPTIONS: ProstateClinicalFinding[] = [
  "Awaiting radiologist",
  "Normal prostate",
  "Prostatomegaly",
  "Indeterminate",
];

export interface ProstateSuggestion {
  suggestsProstatomegaly: boolean;
  thresholdMl: number;
  volumeMl: number | null;
}

/** Suggestion only — the caller decides whether/how to surface it. Never a
 *  decision, never mutates a report. */
export function suggestProstatomegaly(volumeMl: number | null | undefined): ProstateSuggestion {
  return {
    suggestsProstatomegaly: volumeMl != null && volumeMl >= PROSTATE_ENLARGEMENT_THRESHOLD_ML,
    thresholdMl: PROSTATE_ENLARGEMENT_THRESHOLD_ML,
    volumeMl: volumeMl ?? null,
  };
}
