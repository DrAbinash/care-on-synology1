/**
 * Increment recommendation — pure, advisory.
 * ============================================================================
 * Maps an annual score to a recommendation BAND. This is advice only: the
 * system never alters payroll/salary (owner decision). Final decisions weigh
 * role, qualification, responsibility, current salary, market parity,
 * department needs, budget and promotion readiness — all outside this function.
 */
import { gradeFor, type GradeBand } from "./scoreEngine";

export const DEFAULT_INCREMENT_BANDS: GradeBand[] = [
  { min: 90, label: "90–100", recommendation: "Exceptional increment or promotion review" },
  { min: 85, label: "85–89", recommendation: "Higher increment" },
  { min: 75, label: "75–84", recommendation: "Standard increment" },
  { min: 65, label: "65–74", recommendation: "Limited increment" },
  { min: 55, label: "55–64", recommendation: "Increment deferred" },
  { min: 0, label: "Below 55", recommendation: "No increment; performance review" },
];

export interface IncrementRecommendation {
  band: string;
  recommendation: string;
}

/** Returns the advisory band for an annual score, or null if below all bands. */
export function recommendIncrement(
  annualScore: number,
  bands: GradeBand[] = DEFAULT_INCREMENT_BANDS,
): IncrementRecommendation | null {
  const band = gradeFor(annualScore, bands);
  if (!band) return null;
  return { band: band.label, recommendation: band.recommendation ?? "" };
}
