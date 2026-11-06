/**
 * Prior-studies panel display-state logic, shared by ComparisonPanel and
 * RadiologyCopilotPanel so both render the same four user-visible states —
 * a failed request must show an error (with retry), never a silent
 * "no prior studies" (that silence is how the dead endpoint went unnoticed).
 * It also owns what one prior study's report box prints, so no panel can put
 * stored markup in front of the radiologist as if it were the clinical text.
 * Pure so it is unit-testable in this repo's node test environment.
 */
import { parseStoredReportBody } from "./storedReportBody";

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

/**
 * What one prior study's report is, in the two forms the panels need.
 *
 * `sections` is what the "Prior report" box prints: the signed FINDINGS and
 * IMPRESSION as labelled prose. `plainText` is what the deterministic comparison
 * and measurement extraction read: the whole report in document order.
 *
 * Both exist because the linked report's stored `body` is already-rendered report
 * HTML — five writers produce it in different shapes (see `storedReportBody.ts`) —
 * so printing the column puts `<div class="section-heading">FINDINGS</div>` in
 * front of the radiologist, and feeding it to a text extractor measures against
 * markup. That is what this panel did for every examination the workspace signed,
 * once the server began returning the content at all. It now reads through the
 * same parser the Follow-up panel uses.
 *
 * The `impression` column is the fallback when the stored body carries no
 * IMPRESSION section; a study with neither is reported as empty rather than
 * guessed at.
 */
export function derivePriorReport(prior: {
  finalReport: string | null;
  impression: string | null;
  testName: string;
} | null): { sections: Array<{ label: string; text: string }>; plainText: string } {
  const parsed = prior?.finalReport
    ? parseStoredReportBody(prior.finalReport, { title: prior.testName })
    : null;
  const findings = (parsed?.findings || "").trim();
  const impression
    = (parsed?.impression || "").trim() || (prior?.impression || "").trim();

  const sections: Array<{ label: string; text: string }> = [];
  if (findings) sections.push({ label: "Findings", text: findings });
  if (impression) sections.push({ label: "Impression", text: impression });
  if (sections.length === 0) {
    // No recognised section is not "nothing to show": an older report written as
    // one unlabelled block still has to be readable, and it still must not be
    // markup. parsed.fullText is the parser's plain-text rendering.
    const fullText = (parsed?.fullText || "").trim();
    if (fullText) sections.push({ label: "Report", text: fullText });
  }

  const plainText = [parsed?.fullText || "", impression].filter((t) => t.trim()).join("\n").trim();
  return { sections, plainText };
}
