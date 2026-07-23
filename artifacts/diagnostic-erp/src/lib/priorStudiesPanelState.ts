/**
 * Prior-studies panel display-state logic, shared by ComparisonPanel and
 * RadiologyCopilotPanel so both render the same four user-visible states —
 * a failed request must show an error (with retry), never a silent
 * "no prior studies" (that silence is how the dead endpoint went unnoticed).
 * Pure so it is unit-testable in this repo's node test environment.
 */

export type PriorPanelState = "no-patient" | "loading" | "error" | "empty" | "populated";

export function derivePriorPanelState(input: {
  patientId: number | null | undefined;
  isLoading: boolean;
  isError: boolean;
  studyCount: number;
}): PriorPanelState {
  if (!input.patientId) return "no-patient";
  if (input.isLoading) return "loading";
  if (input.isError) return "error";
  return input.studyCount === 0 ? "empty" : "populated";
}

/** Query string for GET /api/radiology-copilot/prior-studies. */
export function buildPriorStudiesPath(params: {
  patientId: number;
  limit?: number;
  excludeStudyId?: number | null;
}): string {
  const qs = new URLSearchParams({ patientId: String(params.patientId), limit: String(params.limit ?? 20) });
  if (params.excludeStudyId) qs.set("excludeStudyId", String(params.excludeStudyId));
  return `/api/radiology-copilot/prior-studies?${qs.toString()}`;
}
