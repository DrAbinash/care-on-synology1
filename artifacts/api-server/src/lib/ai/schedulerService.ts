/**
 * AI Scheduler service — DB layer (Phase P3 / Gate G10).
 *
 * The policy layer above the EXISTING radiology job engine. It decides what to
 * enqueue (aiScheduler.ts pure logic) and enqueues via enqueueAiShadowJob →
 * the existing runner. No new worker/queue. All entry points are gated by the
 * master flag, so a disabled deployment is a hard no-op.
 */
import { db } from "@workspace/db";
import {
  dicomIncomingStudiesTable, studySnapshotsTable, aiProcessingManifestsTable, aiDraftFeedbackTable, dicomRetryQueueTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray, isNull, sql } from "drizzle-orm";
import { isFeatureEnabledServer } from "../featureFlags";
import { AI_MASTER_FLAG, getSchedulerConfig, getModalityMode } from "./clinicalConfigService";
import { enqueueAiShadowJob, AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";
import { jobBacklogCounts, listDeadLetterJobs } from "../radiologyJobs";
import { resolveRadiologyStudyId } from "../canonicalStudy";
import { decideScheduling, type Priority } from "./aiScheduler";

function nowMinutesLocal(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Enqueue AI for one study, applying the scheduler decision. Returns what happened. */
export async function scheduleStudy(opts: {
  studyInstanceUid: string;
  modality?: string | null;
  priority?: Priority;
  manualRequest?: boolean;
  isFinalized?: boolean;
  arrivalSignature?: string;
}): Promise<{ enqueued: boolean; reason: string; jobId?: number }> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) return { enqueued: false, reason: "master flag off" };
  const cfg = await getSchedulerConfig();
  const modalityMode = await getModalityMode(opts.modality);

  // "unchanged" = a manifest already exists for the current snapshot content.
  const isUnchanged = await hasCurrentManifest(opts.studyInstanceUid);
  const decision = decideScheduling(
    {
      modalityMode,
      priority: opts.priority ?? "routine",
      nowMinutes: nowMinutesLocal(),
      isFinalized: opts.isFinalized ?? false,
      isUnchanged,
      manualRequest: opts.manualRequest,
    },
    cfg,
  );
  if (!decision.enqueue) return { enqueued: false, reason: decision.reason };

  const radiologyStudyId = await resolveRadiologyStudyId({ studyInstanceUid: opts.studyInstanceUid });
  const res = await enqueueAiShadowJob({
    studyInstanceUid: opts.studyInstanceUid,
    radiologyStudyId,
    modality: opts.modality ?? null,
    arrivalSignature: opts.arrivalSignature ?? `${decision.mode}:${opts.manualRequest ? "manual" : "auto"}`,
  });
  return { enqueued: true, reason: decision.reason, jobId: res.id };
}

async function hasCurrentManifest(studyInstanceUid: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiProcessingManifestsTable.id })
    .from(aiProcessingManifestsTable)
    .where(eq(aiProcessingManifestsTable.studyInstanceUid, studyInstanceUid))
    .limit(1);
  return !!row;
}

/** Night Batch: enqueue complete, not-yet-snapshotted studies. Bounded. */
export async function runNightBatch(limit = 50): Promise<{ considered: number; enqueued: number }> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) return { considered: 0, enqueued: 0 };
  const rows = await db
    .select({ uid: dicomIncomingStudiesTable.studyInstanceUID, modality: dicomIncomingStudiesTable.modality })
    .from(dicomIncomingStudiesTable)
    .leftJoin(studySnapshotsTable, eq(studySnapshotsTable.studyInstanceUid, dicomIncomingStudiesTable.studyInstanceUID))
    .where(and(eq(dicomIncomingStudiesTable.transferStatus, "complete"), isNull(studySnapshotsTable.id)))
    .limit(limit);
  let enqueued = 0;
  for (const r of rows) {
    const res = await scheduleStudy({ studyInstanceUid: r.uid, modality: r.modality, arrivalSignature: "night-batch" });
    if (res.enqueued) enqueued++;
  }
  return { considered: rows.length, enqueued };
}

/** Scheduled Reprocessing: re-enqueue recent studies; the pipeline's inputHash
 *  dedup makes it a no-op unless model/prompt/pack/rules versions changed. */
export async function runScheduledReprocessing(limit = 50): Promise<{ considered: number; enqueued: number }> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) return { considered: 0, enqueued: 0 };
  const rows = await db
    .select({ uid: aiProcessingManifestsTable.studyInstanceUid })
    .from(aiProcessingManifestsTable)
    .orderBy(desc(aiProcessingManifestsTable.createdAt))
    .limit(limit);
  const seen = new Set<string>();
  let enqueued = 0;
  for (const r of rows) {
    if (seen.has(r.uid)) continue;
    seen.add(r.uid);
    const res = await scheduleStudy({ studyInstanceUid: r.uid, manualRequest: true, arrivalSignature: "reprocess" });
    if (res.enqueued) enqueued++;
  }
  return { considered: seen.size, enqueued };
}

/** Learning aggregation: summarize radiologist feedback (no auto-retrain). */
export async function runLearningAggregation(): Promise<Record<string, number>> {
  const rows = await db
    .select({ action: aiDraftFeedbackTable.action, count: sql<number>`count(*)::int` })
    .from(aiDraftFeedbackTable)
    .groupBy(aiDraftFeedbackTable.action);
  return Object.fromEntries(rows.map((r) => [r.action, r.count]));
}

/** Queue dashboard — reuses the existing job-engine counters, AI-scoped. */
export async function getAiQueueDashboard() {
  const backlog = await jobBacklogCounts([AI_SHADOW_PIPELINE_JOB]);
  const deadLetter = await listDeadLetterJobs([AI_SHADOW_PIPELINE_JOB]);
  const running = await db
    .select({ id: dicomRetryQueueTable.id, status: dicomRetryQueueTable.status, entityId: dicomRetryQueueTable.entityId })
    .from(dicomRetryQueueTable)
    .where(and(eq(dicomRetryQueueTable.operationType, AI_SHADOW_PIPELINE_JOB), inArray(dicomRetryQueueTable.status, ["running", "pending", "retrying"])));
  return { backlog, running, deadLetter };
}

/** Cancel a queued/running AI job (terminal 'abandoned' with an operator note). */
export async function cancelAiJob(jobId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: dicomRetryQueueTable.id, op: dicomRetryQueueTable.operationType, status: dicomRetryQueueTable.status })
    .from(dicomRetryQueueTable)
    .where(eq(dicomRetryQueueTable.id, jobId))
    .limit(1);
  if (!row || row.op !== AI_SHADOW_PIPELINE_JOB) return false;
  if (row.status === "success") return false;
  await db
    .update(dicomRetryQueueTable)
    .set({ status: "abandoned", failureReason: "cancelled by operator", lockedBy: null, lockedAt: null, updatedAt: new Date() })
    .where(eq(dicomRetryQueueTable.id, jobId));
  return true;
}
