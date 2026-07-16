// dto.ts — the ONE canonical Data Transfer Object for quality evaluations.
//
// This is the only shape the API exposes and the DB persists (requirement 8).
// Internal legacy validator structures are never surfaced; legacy callers adapt
// INTO this DTO. Findings are stored STRUCTURED (not rendered text) so wording
// can change without breaking analytics (requirement 4).

import type { DataTier, QualityContext, QualityReport, Severity } from "./contract";

/** One structured finding as persisted/transported. Keyed by ruleId, never text. */
export interface QualityFindingDTO {
  ruleId: string;
  /** Hierarchical namespaced id, when known (e.g. "care.text.laterality.*"). */
  canonicalId?: string;
  category: string;
  severity: Severity;
  tier: DataTier; // "structured" (deterministic) | "heuristic"
  modality?: string;
  studyType?: string;
  knowledgePackSource?: string;
  /** Score deduction this finding contributed. */
  weight?: number;
  message: string;
  rationale?: string;
  evidence?: string;
  suggestedFix?: string;
  targetRef?: string;
}

/** A full evaluation result as persisted/transported. */
export interface QualityReportDTO {
  // identity (set by the API layer)
  reportDraftId: number | null;
  reportId: number | null;
  source: string;
  modality: string | null;
  studyType: string | null;
  // result
  score: number;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  evaluatedRuleCount: number;
  deterministicRuleCount: number;
  heuristicRuleCount: number;
  notEvaluated: string[];
  runtimeMs: number;
  // versioning (reproducibility)
  engineVersion: string;
  ruleVersion: string;
  knowledgePackVersion: string | null;
  evaluatedAt: string;
  findings: QualityFindingDTO[];
}

/** The request a caller sends to evaluate a report. */
export interface QualityEvaluationRequest {
  reportDraftId?: number;
  reportId?: number;
  modality?: string;
  studyType?: string;
  /** Which caller/adapter produced this (e.g. "workspace", "smart-radiology", "usg"). */
  source?: string;
  knowledgePackVersion?: string | null;
  /** The report content under evaluation. */
  text: QualityContext["text"];
}

export interface DTOIdentity {
  reportDraftId?: number | null;
  reportId?: number | null;
  source?: string;
  modality?: string | null;
  studyType?: string | null;
}

/** Serialize an engine QualityReport into the canonical DTO. */
export function toQualityReportDTO(report: QualityReport, identity?: DTOIdentity): QualityReportDTO {
  return {
    reportDraftId: identity?.reportDraftId ?? null,
    reportId: identity?.reportId ?? null,
    source: identity?.source ?? "unknown",
    modality: identity?.modality ?? null,
    studyType: identity?.studyType ?? null,
    score: report.score,
    blockingCount: report.blockingCount,
    warningCount: report.warningCount,
    infoCount: report.infoCount,
    evaluatedRuleCount: report.evaluatedRuleCount,
    deterministicRuleCount: report.deterministicRuleCount,
    heuristicRuleCount: report.heuristicRuleCount,
    notEvaluated: report.notEvaluated,
    runtimeMs: report.runtimeMs,
    engineVersion: report.engineVersion,
    ruleVersion: report.ruleVersion,
    knowledgePackVersion: report.knowledgePackVersion,
    evaluatedAt: report.evaluatedAt,
    findings: report.findings.map((f): QualityFindingDTO => ({
      ruleId: f.ruleId,
      canonicalId: f.canonicalId,
      category: f.category,
      severity: f.severity,
      tier: f.tier,
      modality: f.modality,
      studyType: f.studyType,
      knowledgePackSource: f.knowledgePackSource,
      weight: f.weight,
      message: f.message,
      rationale: f.rationale,
      evidence: f.evidence,
      suggestedFix: f.suggestedFix,
      targetRef: f.targetRef,
    })),
  };
}
