/**
 * Canonical Report Quality Engine API (PR #101 Phase 2).
 * Mounted at: /api/report-quality  (staff-auth + /radiology permission required)
 *
 * The ONE canonical surface for quality evaluations. Exposes the canonical DTO
 * only (never legacy validator structures). Persistence is append-only:
 * every evaluation is a new immutable row; every override is appended to
 * history and never overwrites a prior one.
 *
 * SHADOW (Phase 2): additive only. No existing endpoint is replaced and no
 * finalize/workflow behavior changes. Nothing in production calls these yet —
 * they establish the canonical persistence + API contract.
 *
 *   POST /evaluate                          — run the engine, persist, return DTO
 *   POST /evaluations/:evaluationId/override — append an override (never overwrite)
 *   GET  /drafts/:draftId/evaluations        — evaluation history for a draft
 *   GET  /drafts/:draftId/overrides          — override history for a draft
 */
import { Router } from "express";
import {
  db,
  reportQualityEvaluationsTable,
  reportQualityFindingsTable,
  reportQualityOverridesTable,
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  radiologyStudiesTable,
  type ReportQualityEvaluation,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  runQualityEngine,
  textParityScorer,
  toQualityReportDTO,
  createStructuredEngine,
  normalizeModality,
  type QualityEvaluationRequest,
  type QualityContext,
  type QualityReportDTO,
  type StudyContext,
} from "@workspace/report-quality";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();

// One scoped structured engine, reused across requests. It holds ONLY the
// Phase-3 structured rules and is never the default global engine that backs
// the live badge — so this shadow path cannot change the user-visible score.
const structuredEngine = createStructuredEngine();

function session(req: unknown) {
  return (req as StaffAuthRequest).staffSession!;
}

/**
 * Persist one evaluation append-only: the immutable summary+blob row, plus
 * normalized finding rows (best-effort). Returns the new evaluation id.
 */
async function persistEvaluation(dto: QualityReportDTO): Promise<number> {
  const [row] = await db
    .insert(reportQualityEvaluationsTable)
    .values({
      reportDraftId: dto.reportDraftId ?? undefined,
      reportId: dto.reportId ?? undefined,
      source: dto.source,
      modality: dto.modality ?? undefined,
      studyType: dto.studyType ?? undefined,
      score: dto.score,
      blockingCount: dto.blockingCount,
      warningCount: dto.warningCount,
      infoCount: dto.infoCount,
      evaluatedRuleCount: dto.evaluatedRuleCount,
      deterministicRuleCount: dto.deterministicRuleCount,
      heuristicRuleCount: dto.heuristicRuleCount,
      notEvaluatedJson: JSON.stringify(dto.notEvaluated),
      runtimeMs: dto.runtimeMs,
      engineVersion: dto.engineVersion,
      ruleVersion: dto.ruleVersion,
      knowledgePackVersion: dto.knowledgePackVersion ?? undefined,
      findingsJson: JSON.stringify(dto.findings),
      evaluatedAt: new Date(dto.evaluatedAt),
    })
    .returning();

  if (dto.findings.length > 0) {
    try {
      await db.insert(reportQualityFindingsTable).values(
        dto.findings.map((f) => ({
          evaluationId: row.id,
          reportDraftId: dto.reportDraftId ?? undefined,
          reportId: dto.reportId ?? undefined,
          ruleId: f.ruleId,
          canonicalId: f.canonicalId ?? undefined,
          category: f.category,
          severity: f.severity,
          tier: f.tier,
          modality: f.modality ?? undefined,
          studyType: f.studyType ?? undefined,
          knowledgePackSource: f.knowledgePackSource ?? undefined,
          weight: f.weight ?? undefined,
          message: f.message,
          evidence: f.evidence ?? undefined,
          suggestedFix: f.suggestedFix ?? undefined,
        })),
      );
    } catch {
      /* normalized analytics rows are non-critical; the blob is authoritative */
    }
  }
  return row.id;
}

/**
 * Assemble the authoritative `study` slot for a report draft (Phase 3): the
 * highest-value, lowest-risk structured slot. Resolves the authoritative
 * modality via worklist → study precedence and compares it to the draft's
 * declared modality. Best-effort — returns undefined on any gap so its rule is
 * honestly notEvaluated. NEVER throws into the caller.
 */
async function assembleStudyContext(draftId: number): Promise<StudyContext | undefined> {
  try {
    const [draft] = await db
      .select({ modality: radiologyReportDraftsTable.modality, studyId: radiologyReportDraftsTable.studyId, worklistId: radiologyReportDraftsTable.worklistId, studyName: radiologyReportDraftsTable.studyName })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, draftId))
      .limit(1);
    if (!draft) return undefined;

    let authoritativeRaw: string | null = null;
    let authoritativeSource: StudyContext["authoritativeSource"] | null = null;
    let studyDescription: string | null = null;
    if (draft.worklistId != null) {
      const [w] = await db.select({ modality: radiologyWorklistTable.modality, studyDescription: radiologyWorklistTable.studyDescription }).from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, draft.worklistId)).limit(1);
      if (w) { authoritativeRaw = w.modality; authoritativeSource = "worklist"; studyDescription = w.studyDescription ?? null; }
    }
    if (authoritativeRaw == null && draft.studyId != null) {
      const [s] = await db.select({ modality: radiologyStudiesTable.modality, studyDescription: radiologyStudiesTable.studyDescription }).from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, draft.studyId)).limit(1);
      if (s) { authoritativeRaw = s.modality; authoritativeSource = "study"; studyDescription = s.studyDescription ?? null; }
    }
    if (authoritativeRaw == null || authoritativeSource == null) return undefined; // no authoritative source → notEvaluated

    return {
      authoritativeSource,
      authoritativeModality: normalizeModality(authoritativeRaw),
      authoritativeModalityRaw: authoritativeRaw,
      authoritativeIsSentinel: authoritativeRaw.trim().toUpperCase() === "OT",
      declaredModality: normalizeModality(draft.modality),
      declaredModalityRaw: draft.modality ?? null,
      studyName: draft.studyName ?? null,
      studyDescription,
    };
  } catch {
    return undefined;
  }
}

/**
 * Best-effort Phase-3 structured shadow run. Assembles the structured context
 * (study slot from the draft + any structured slots supplied in the request),
 * evaluates the scoped structured engine, and persists a separate evaluation
 * with source "shadow:structured-v3". Never affects the primary response.
 * Returns the shadow evaluation id, or null.
 */
async function runStructuredShadow(body: QualityEvaluationRequest, modality: string, studyType: string | null): Promise<number | null> {
  try {
    const study = body.study ?? (body.reportDraftId != null ? await assembleStudyContext(body.reportDraftId) : undefined);
    const ctx: QualityContext = {
      modality,
      studyDescription: studyType ?? undefined,
      text: body.text,
      measurements: body.measurements,
      findingInstances: body.findingInstances,
      protocolRequiredMeasurements: body.protocolRequiredMeasurements,
      knowledgePack: body.knowledgePack,
      study,
    };
    // Nothing structured to evaluate → skip (no empty shadow rows).
    if (!study && !body.measurements && !body.findingInstances && !body.protocolRequiredMeasurements) return null;
    const report = structuredEngine.evaluate(ctx, { knowledgePackVersion: body.knowledgePackVersion ?? null });
    const dto = toQualityReportDTO(report, {
      reportDraftId: body.reportDraftId ?? null,
      reportId: body.reportId ?? null,
      source: "shadow:structured-v3",
      modality: modality || null,
      studyType,
    });
    return await persistEvaluation(dto);
  } catch {
    return null; // shadow structured is non-critical
  }
}

function serializeEvaluation(row: ReportQualityEvaluation) {
  return {
    evaluationId: row.id,
    reportDraftId: row.reportDraftId,
    reportId: row.reportId,
    source: row.source,
    modality: row.modality,
    studyType: row.studyType,
    score: row.score,
    blockingCount: row.blockingCount,
    warningCount: row.warningCount,
    infoCount: row.infoCount,
    evaluatedRuleCount: row.evaluatedRuleCount,
    deterministicRuleCount: row.deterministicRuleCount,
    heuristicRuleCount: row.heuristicRuleCount,
    notEvaluated: safeJsonArray(row.notEvaluatedJson),
    runtimeMs: row.runtimeMs,
    engineVersion: row.engineVersion,
    ruleVersion: row.ruleVersion,
    knowledgePackVersion: row.knowledgePackVersion,
    findings: safeJsonArray(row.findingsJson),
    evaluatedAt: row.evaluatedAt,
    createdAt: row.createdAt,
  };
}

function safeJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// POST /evaluate — run the canonical engine and persist an immutable evaluation.
router.post("/evaluate", async (req, res) => {
  const body = req.body as QualityEvaluationRequest | undefined;
  if (!body || typeof body.text !== "object" || body.text === null) {
    res.status(400).json({ error: "text (report content) is required" });
    return;
  }
  const text = body.text;
  const modality = body.modality ?? text.modality ?? "";
  const studyType = body.studyType ?? text.studyDescription ?? null;

  const report = runQualityEngine(
    { modality, studyDescription: studyType ?? undefined, text },
    { scorer: textParityScorer, knowledgePackVersion: body.knowledgePackVersion ?? null },
  );
  const dto = toQualityReportDTO(report, {
    reportDraftId: body.reportDraftId ?? null,
    reportId: body.reportId ?? null,
    source: body.source ?? "api",
    modality: modality || null,
    studyType,
  });

  const evaluationId = await persistEvaluation(dto);

  // Phase 3 (shadow): additionally run the scoped structured engine and persist
  // a SEPARATE evaluation (source "shadow:structured-v3") for analysis. The
  // primary text evaluation + response above are unchanged. Best-effort.
  const shadowStructuredEvaluationId = await runStructuredShadow(body, modality, studyType);

  res.status(201).json({ evaluationId, shadowStructuredEvaluationId, ...dto });
});

// POST /evaluations/:evaluationId/override — append an override to history.
router.post("/evaluations/:evaluationId/override", async (req, res) => {
  const evaluationId = Number(req.params.evaluationId);
  if (!Number.isInteger(evaluationId)) {
    res.status(400).json({ error: "invalid evaluation id" });
    return;
  }
  const { ruleId, reason, action } = (req.body ?? {}) as { ruleId?: string; reason?: string; action?: string };
  if (typeof ruleId !== "string" || !ruleId.trim()) {
    res.status(400).json({ error: "ruleId is required" });
    return;
  }
  if (typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason is required" });
    return;
  }
  const [ev] = await db
    .select({ id: reportQualityEvaluationsTable.id, reportDraftId: reportQualityEvaluationsTable.reportDraftId })
    .from(reportQualityEvaluationsTable)
    .where(eq(reportQualityEvaluationsTable.id, evaluationId))
    .limit(1);
  if (!ev) {
    res.status(404).json({ error: "evaluation not found" });
    return;
  }
  const s = session(req);
  const [row] = await db
    .insert(reportQualityOverridesTable)
    .values({
      evaluationId,
      reportDraftId: ev.reportDraftId ?? undefined,
      ruleId: ruleId.trim(),
      action: action && action.trim() ? action.trim() : "override",
      reason: reason.trim(),
      overriddenById: s.subjectId,
      overriddenByName: s.subjectName,
    })
    .returning();
  res.status(201).json({ overrideId: row.id });
});

// GET /drafts/:draftId/evaluations — append-only evaluation history, newest first.
router.get("/drafts/:draftId/evaluations", async (req, res) => {
  const draftId = Number(req.params.draftId);
  if (!Number.isInteger(draftId)) {
    res.status(400).json({ error: "invalid draft id" });
    return;
  }
  const rows = await db
    .select()
    .from(reportQualityEvaluationsTable)
    .where(eq(reportQualityEvaluationsTable.reportDraftId, draftId))
    .orderBy(desc(reportQualityEvaluationsTable.createdAt))
    .limit(50);
  res.json({ evaluations: rows.map(serializeEvaluation) });
});

// GET /drafts/:draftId/overrides — append-only override history, newest first.
router.get("/drafts/:draftId/overrides", async (req, res) => {
  const draftId = Number(req.params.draftId);
  if (!Number.isInteger(draftId)) {
    res.status(400).json({ error: "invalid draft id" });
    return;
  }
  const rows = await db
    .select()
    .from(reportQualityOverridesTable)
    .where(eq(reportQualityOverridesTable.reportDraftId, draftId))
    .orderBy(desc(reportQualityOverridesTable.createdAt))
    .limit(200);
  res.json({ overrides: rows });
});

export default router;
