/**
 * reportQualityFinalize.ts — canonical engine integration for the workspace
 * finalize gate (PR #101 Phase 5).
 *
 * Policy (docs/report-quality-engine/ARCHITECTURE.md §8): only deterministic
 * structured-tier findings with severity "blocker" hard-block finalize. Heuristic
 * text-tier findings are advisory (warnings in the dialog). Overrides are
 * append-only via POST /api/report-quality/evaluations/:id/override and keyed
 * by stable ruleId.
 */

export type CanonicalQualityFinding = {
  ruleId: string;
  severity: string;
  tier?: string;
  category?: string;
  message: string;
  suggestedFix?: string | null;
  /** Parent evaluation row — required for override API calls. */
  evaluationId?: number;
};

export type QualityOverrideRow = {
  id: number;
  evaluationId: number;
  ruleId: string;
  reason: string;
  action: string;
  overriddenByName?: string | null;
};

export type QualityEvaluationRow = {
  evaluationId: number;
  source: string;
  score: number;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  findings: CanonicalQualityFinding[];
};

export type FinalizeQualityGate = {
  textEvaluationId: number;
  structuredEvaluationId: number | null;
  score: number;
  blockingCount: number;
  warningCount: number;
  /** All findings (text + structured shadow), each stamped with evaluationId. */
  findings: CanonicalQualityFinding[];
  /** Structured-tier blockers still unresolved (shown as review-only; do not block sign-off). */
  unresolvedBlockers: CanonicalQualityFinding[];
  /** Heuristic / warning-tier items for display (non-blocking). */
  advisoryFindings: CanonicalQualityFinding[];
  overrides: QualityOverrideRow[];
};

/** Deterministic structured blockers are the only hard finalize gate. */
export function isHardBlockingFinding(f: CanonicalQualityFinding): boolean {
  return f.severity === "blocker" && f.tier === "structured";
}

export function isAdvisoryFinding(f: CanonicalQualityFinding): boolean {
  return !isHardBlockingFinding(f);
}

export function overriddenRuleIds(overrides: QualityOverrideRow[]): Set<string> {
  return new Set(overrides.map((o) => o.ruleId));
}

export function computeUnresolvedBlockers(
  findings: CanonicalQualityFinding[],
  overrides: QualityOverrideRow[],
): CanonicalQualityFinding[] {
  const overridden = overriddenRuleIds(overrides);
  return findings.filter((f) => isHardBlockingFinding(f) && !overridden.has(f.ruleId));
}

export function stampEvaluationId(
  findings: CanonicalQualityFinding[],
  evaluationId: number,
): CanonicalQualityFinding[] {
  return findings.map((f) => ({ ...f, evaluationId }));
}

export function buildWorkspaceQualityRequest(params: {
  draftId?: number | null;
  modality?: string | null;
  studyDescription?: string | null;
  clinicalHistory?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  recommendation?: string;
  checklistPercent?: number;
  missingRequiredMeasurements?: string[];
}) {
  const impressionLine = params.impression?.trim() ?? "";
  return {
    reportDraftId: params.draftId ?? undefined,
    modality: params.modality ?? undefined,
    studyType: params.studyDescription ?? undefined,
    source: "workspace-finalize",
    text: {
      findings: params.findings?.trim() ?? "",
      impression: impressionLine ? [impressionLine] : [],
      recommendation: params.recommendation?.trim() ?? undefined,
      technique: params.technique?.trim() ?? undefined,
      clinicalHistory: params.clinicalHistory?.trim() ?? undefined,
      modality: params.modality ?? null,
      studyDescription: params.studyDescription ?? null,
      checklistPercent: params.checklistPercent,
      missingRequiredMeasurements: params.missingRequiredMeasurements,
    },
  };
}

type EvaluateApiResponse = {
  evaluationId: number;
  shadowStructuredEvaluationId: number | null;
  score: number;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  findings: CanonicalQualityFinding[];
};

export function composeFinalizeQualityGate(
  evaluateRes: EvaluateApiResponse,
  structuredFindings: CanonicalQualityFinding[],
  overrides: QualityOverrideRow[],
): FinalizeQualityGate {
  const textFindings = stampEvaluationId(evaluateRes.findings ?? [], evaluateRes.evaluationId);
  const structuredEvalId = evaluateRes.shadowStructuredEvaluationId;
  const structuredStamped = structuredEvalId
    ? stampEvaluationId(structuredFindings, structuredEvalId)
    : [];
  const findings = [...textFindings, ...structuredStamped];
  const unresolvedBlockers = computeUnresolvedBlockers(findings, overrides);
  const advisoryFindings = findings.filter(isAdvisoryFinding);

  return {
    textEvaluationId: evaluateRes.evaluationId,
    structuredEvaluationId: structuredEvalId,
    score: evaluateRes.score,
    blockingCount: evaluateRes.blockingCount + structuredStamped.filter(isHardBlockingFinding).length,
    warningCount: evaluateRes.warningCount,
    findings,
    unresolvedBlockers,
    advisoryFindings,
    overrides,
  };
}

/** Render advisory findings for the finalize confirm pre block. */
export function formatQualityAdvisoryForDialog(gate: FinalizeQualityGate): string {
  const lines: string[] = [];
  if (gate.score != null) {
    lines.push(`Quality score: ${gate.score}/100`);
  }
  if (gate.unresolvedBlockers.length > 0) {
    lines.push(`${gate.unresolvedBlockers.length} quality issue(s) to review (does not block signing).`);
  }
  const warns = gate.advisoryFindings.filter((f) => f.severity === "warning" || f.severity === "blocker");
  if (warns.length > 0) {
    const shown = warns.slice(0, 6).map((f) => `  • ${f.ruleId}: ${f.message}`);
    lines.push("Quality advisories:");
    lines.push(...shown);
    if (warns.length > 6) lines.push(`  • +${warns.length - 6} more`);
  }
  return lines.length ? `\n${lines.join("\n")}\n` : "";
}
