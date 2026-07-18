/**
 * Evaluation runner — Phase P2 / Gate G8 (DB-backed).
 *
 * Runs a model/prompt version against the golden dataset, persists per-case
 * results + aggregate metrics, and moves the version shadow → candidate when
 * metrics pass. `approveVersion` is the HUMAN gate: only a human can take a
 * candidate → live. Reuses the pure metrics in @workspace/ai-providers.
 */
import { db } from "@workspace/db";
import {
  aiGoldenCasesTable, aiEvaluationRunsTable, aiEvaluationCaseResultsTable, aiModelVersionsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  criticalFindingRecall, aggregateMetrics, decideVersionPromotion, DEFAULT_THRESHOLDS,
  type CaseOutcome, type RefFinding, type ProducedFinding, type PromotionThresholds,
  type ProvisionalReport,
} from "@workspace/ai-providers";

/** Produce a draft for one golden case. In staging this calls the gateway; in
 *  tests it is faked. `validationOk` reflects contract validity. */
export type EvalInferenceFn = (goldenCase: {
  caseKey: string;
  studyInstanceUid: string | null;
  modality: string | null;
  referenceJson: unknown;
}) => Promise<{ report: ProvisionalReport; validationOk: boolean }>;

export interface EvaluationRunSummary {
  runId: number;
  versionRef: string;
  metrics: ReturnType<typeof aggregateMetrics>;
  passed: boolean;
}

export async function runEvaluation(
  versionRef: string,
  infer: EvalInferenceFn,
  opts: { thresholds?: PromotionThresholds } = {},
): Promise<EvaluationRunSummary> {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const cases = await db.select().from(aiGoldenCasesTable).where(eq(aiGoldenCasesTable.isActive, true));

  const [run] = await db
    .insert(aiEvaluationRunsTable)
    .values({ versionRef, goldenSetSize: cases.length, startedAt: new Date() })
    .returning({ id: aiEvaluationRunsTable.id });

  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    const reference = (c.referenceJson ?? {}) as { findings?: Array<{ key: string; critical?: boolean }> };
    const refFindings: RefFinding[] = (reference.findings ?? []).map((f) => ({ key: f.key, critical: !!f.critical }));
    const { report, validationOk } = await infer({
      caseKey: c.caseKey, studyInstanceUid: c.studyInstanceUid, modality: c.modality, referenceJson: c.referenceJson,
    });
    const produced: ProducedFinding[] = report.findings.map((f) => ({ key: f.key }));
    const recall = criticalFindingRecall(refFindings, produced);
    const passed = validationOk && recall >= thresholds.minCriticalRecall;
    outcomes.push({ validationOk, criticalRecall: recall });
    await db.insert(aiEvaluationCaseResultsTable).values({
      runId: run.id, caseKey: c.caseKey, passed, validationOk, criticalRecall: recall,
      diffsJson: { producedKeys: produced.map((p) => p.key), referenceCriticals: refFindings.filter((f) => f.critical).map((f) => f.key) },
    });
  }

  const metrics = aggregateMetrics(outcomes);
  const decision = decideVersionPromotion(metrics, thresholds, false); // metrics-only here
  const passed = decision.metricsPass;
  await db.update(aiEvaluationRunsTable).set({ metricsJson: metrics, passed, completedAt: new Date() }).where(eq(aiEvaluationRunsTable.id, run.id));

  // Metrics passing promotes shadow → candidate (never live — that needs a human).
  if (passed) {
    await db
      .update(aiModelVersionsTable)
      .set({ state: "candidate" })
      .where(and(eq(aiModelVersionsTable.versionRef, versionRef), eq(aiModelVersionsTable.state, "shadow")));
  }
  return { runId: run.id, versionRef, metrics, passed };
}

/** The HUMAN approval gate: only a candidate (metrics already passed) → live. */
export async function approveVersion(versionRef: string, approver: string): Promise<{ ok: boolean; state: string; reason: string }> {
  const [v] = await db.select().from(aiModelVersionsTable).where(eq(aiModelVersionsTable.versionRef, versionRef)).limit(1);
  if (!v) return { ok: false, state: "unknown", reason: "version not found" };
  if (v.state !== "candidate") return { ok: false, state: v.state, reason: `only a candidate can be approved (state=${v.state})` };
  await db
    .update(aiModelVersionsTable)
    .set({ state: "live", approvedBy: approver, approvedAt: new Date() })
    .where(eq(aiModelVersionsTable.versionRef, versionRef));
  return { ok: true, state: "live", reason: "approved" };
}
