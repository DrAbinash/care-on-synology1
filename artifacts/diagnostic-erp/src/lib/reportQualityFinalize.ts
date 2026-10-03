/**
 * reportQualityFinalize.ts — canonical engine integration for the workspace
 * finalize gate (PR #101 Phase 5).
 *
 * Blocking policy is NOT settled, and nothing in this gate stops a signature
 * today. ARCHITECTURE.md §8.1 lists "block vs warn" as an open product-owner
 * decision ("Needs sign-off — this changes radiologist workflow"), and the
 * structured tier is still Phase-3 shadow: every one of its rule definitions
 * carries `blockingEligibility: false` (rules/structured/index.ts:26), so the
 * engine itself declares them non-blocking. FinalizeSignDialog renders
 * `unresolvedBlockers` under "Review before signing (does not block)" and they
 * are deliberately absent from its `canConfirm`. Heuristic text-tier findings
 * are advisory. Overrides are append-only via
 * POST /api/report-quality/evaluations/:id/override and keyed by stable ruleId.
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

/**
 * Names the findings that WOULD hard-block finalize once the block-vs-warn
 * decision (ARCHITECTURE.md §8.1) is made and wired. Review-only today — they
 * never reach FinalizeSignDialog's `canConfirm`. See the file header.
 */
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
  /** Canonical patient demography. Q109 (sex vs anatomy) and Q110 (age vs
   *  wording) cannot fire without these; the server re-resolves both from the
   *  draft's worklist/patient record and its value wins, so this is the
   *  fallback for a finalize with no saved draft. */
  sex?: string | null;
  age?: string | null;
}) {
  const impressionLines = (params.impression ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    reportDraftId: params.draftId ?? undefined,
    modality: params.modality ?? undefined,
    studyType: params.studyDescription ?? undefined,
    source: "workspace-finalize",
    text: {
      findings: params.findings?.trim() ?? "",
      // One element per impression point, exactly as the report renders them.
      // Passing the whole field as a single element made the duplicate-
      // impression-line rule (Q102) unable to fire at sign-off: with one
      // element there is never a pair to compare.
      impression: impressionLines,
      recommendation: params.recommendation?.trim() ?? undefined,
      technique: params.technique?.trim() ?? undefined,
      clinicalHistory: params.clinicalHistory?.trim() ?? undefined,
      sex: params.sex?.trim() || null,
      age: params.age?.trim() || null,
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
