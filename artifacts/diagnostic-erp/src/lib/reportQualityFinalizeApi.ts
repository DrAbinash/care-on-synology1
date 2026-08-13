import { api } from "@/lib/fetchApi";
import {
  buildWorkspaceQualityRequest,
  composeFinalizeQualityGate,
  type CanonicalQualityFinding,
  type FinalizeQualityGate,
  type QualityOverrideRow,
} from "./reportQualityFinalize";

type EvaluateResponse = {
  evaluationId: number;
  shadowStructuredEvaluationId: number | null;
  score: number;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  findings: CanonicalQualityFinding[];
};

type EvaluationsListResponse = {
  evaluations: Array<{
    evaluationId: number;
    findings: CanonicalQualityFinding[];
  }>;
};

type OverridesListResponse = {
  overrides: QualityOverrideRow[];
};

/**
 * Run canonical quality evaluation immediately before finalize confirm.
 * Persists append-only rows server-side and returns a gate snapshot for the dialog.
 */
export async function runFinalizeQualityEvaluation(
  params: Parameters<typeof buildWorkspaceQualityRequest>[0],
): Promise<FinalizeQualityGate> {
  const request = buildWorkspaceQualityRequest(params);
  const evaluateRes = await api.post<EvaluateResponse>("/api/report-quality/evaluate", request);

  let structuredFindings: CanonicalQualityFinding[] = [];
  let overrides: QualityOverrideRow[] = [];

  if (request.reportDraftId != null) {
    const overridesRes = await api.get<OverridesListResponse>(
      `/api/report-quality/drafts/${request.reportDraftId}/overrides`,
    );
    overrides = overridesRes.overrides ?? [];

    if (evaluateRes.shadowStructuredEvaluationId != null) {
      const history = await api.get<EvaluationsListResponse>(
        `/api/report-quality/drafts/${request.reportDraftId}/evaluations`,
      );
      const structuredEv = history.evaluations?.find(
        (e) => e.evaluationId === evaluateRes.shadowStructuredEvaluationId,
      );
      structuredFindings = structuredEv?.findings ?? [];
    }
  }

  return composeFinalizeQualityGate(evaluateRes, structuredFindings, overrides);
}

export async function submitQualityOverride(
  evaluationId: number,
  ruleId: string,
  reason: string,
): Promise<number> {
  const res = await api.post<{ overrideId: number }>(
    `/api/report-quality/evaluations/${evaluationId}/override`,
    { ruleId, reason, action: "override" },
  );
  return res.overrideId;
}
