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
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { isFeatureEnabledServer } from "../featureFlags";
import { AI_MASTER_FLAG, getSchedulerConfig, getModalityMode, getModalityPolicies, normalizeAiModality } from "./clinicalConfigService";
import { enqueueAiShadowJob, AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";
import { jobBacklogCounts, listDeadLetterJobs } from "../radiologyJobs";
import { resolveRadiologyStudyId } from "../canonicalStudy";
import { decideScheduling, isWithinNightWindow, type Priority } from "./aiScheduler";
import { logger } from "../logger";
import { istHourMinute } from "../istDate";

function nowMinutesLocal(): number {
  // Clinic timezone (Asia/Kolkata) — never use container UTC wall-clock.
  const { hour, minute } = istHourMinute();
  return hour * 60 + minute;
}

async function markWorklistPending(studyInstanceUid: string): Promise<void> {
  try {
    await db
      .update(radiologyWorklistTable)
      .set({ aiDraftStatus: "PENDING", updatedAt: new Date() })
      .where(and(
        eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUid),
        ne(radiologyWorklistTable.aiDraftStatus, "READY"),
      ));
  } catch {
    /* best-effort */
  }
}

/** Enqueue AI for one study, applying the scheduler decision. Returns what happened. */
export async function scheduleStudy(opts: {
  studyInstanceUid: string;
  modality?: string | null;
  priority?: Priority;
  manualRequest?: boolean;
  isFinalized?: boolean;
  arrivalSignature?: string;
  /** When true, studies whose decision is "defer to night" are enqueued now (night cron). */
  forceNightWindow?: boolean;
}): Promise<{ enqueued: boolean; reason: string; jobId?: number }> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) return { enqueued: false, reason: "master flag off" };
  const cfg = await getSchedulerConfig();
  const modalityMode = await getModalityMode(opts.modality);

  // "unchanged" = a manifest already exists for the current snapshot content.
  const isUnchanged = await hasCurrentManifest(opts.studyInstanceUid);
  const now = nowMinutesLocal();
  let decision = decideScheduling(
    {
      modalityMode,
      priority: opts.priority ?? "routine",
      nowMinutes: now,
      isFinalized: opts.isFinalized ?? false,
      isUnchanged,
      manualRequest: opts.manualRequest,
    },
    cfg,
  );
  // Night cron: force-enqueue anything already classified for night_batch
  // (including immediate studies deferred during quiet hours).
  if (
    !decision.enqueue
    && opts.forceNightWindow
    && decision.mode === "night_batch"
    && modalityMode !== "disabled"
    && modalityMode !== "manual"
  ) {
    decision = { enqueue: true, mode: "night_batch", reason: "night batch force (deferred study)" };
  }
  if (!decision.enqueue) return { enqueued: false, reason: decision.reason };

  // Concurrency is enforced at CLAIM time (runRadiologyJobTick concurrencyByType),
  // not at enqueue — overnight MRI must queue 8–10 studies and run them one-by-one.

  const radiologyStudyId = await resolveRadiologyStudyId({ studyInstanceUid: opts.studyInstanceUid });
  const res = await enqueueAiShadowJob({
    studyInstanceUid: opts.studyInstanceUid,
    radiologyStudyId,
    modality: opts.modality ?? null,
    arrivalSignature: opts.arrivalSignature ?? `${decision.mode}:${opts.manualRequest ? "manual" : "auto"}`,
  });
  await markWorklistPending(opts.studyInstanceUid);
  return { enqueued: true, reason: decision.reason, jobId: res.id };
}

/**
 * Hook for DICOM intake (Orthanc StableStudy / internal studies POST).
 * Fire-and-forget safe — never throws to the intake caller.
 */
export async function scheduleStudyOnDicomArrival(opts: {
  studyInstanceUid: string;
  modality?: string | null;
  priority?: Priority;
}): Promise<{ enqueued: boolean; reason: string }> {
  try {
    if (!opts.studyInstanceUid) return { enqueued: false, reason: "missing studyInstanceUid" };
    const res = await scheduleStudy({
      studyInstanceUid: opts.studyInstanceUid,
      modality: opts.modality,
      priority: opts.priority ?? "routine",
      arrivalSignature: `dicom-arrival:${Date.now()}`,
    });
    if (res.enqueued) {
      logger.info({ uid: opts.studyInstanceUid, modality: opts.modality, reason: res.reason }, "AI draft scheduled on DICOM arrival");
    }
    return { enqueued: res.enqueued, reason: res.reason };
  } catch (err) {
    logger.warn({ err, uid: opts.studyInstanceUid }, "AI draft schedule on DICOM arrival failed");
    return { enqueued: false, reason: err instanceof Error ? err.message : "schedule failed" };
  }
}

async function hasCurrentManifest(studyInstanceUid: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiProcessingManifestsTable.id })
    .from(aiProcessingManifestsTable)
    .where(eq(aiProcessingManifestsTable.studyInstanceUid, studyInstanceUid))
    .limit(1);
  return !!row;
}

async function overnightModalitySet(): Promise<Set<string>> {
  const policies = await getModalityPolicies();
  return new Set(
    policies
      .filter((p) => p.mode === "night_batch")
      .map((p) => normalizeAiModality(p.modality)),
  );
}

/** Night / scheduled batch: enqueue worklist + incoming studies still needing drafts. */
export async function runNightBatch(
  limit = 50,
  opts: { forceOutsideWindow?: boolean } = {},
): Promise<{ considered: number; enqueued: number; skippedWindow?: boolean; overnightModalities: string[] }> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) {
    return { considered: 0, enqueued: 0, overnightModalities: [] };
  }
  const cfg = await getSchedulerConfig();
  if (!opts.forceOutsideWindow && !isWithinNightWindow(nowMinutesLocal(), cfg)) {
    return { considered: 0, enqueued: 0, skippedWindow: true, overnightModalities: [] };
  }

  // Night batch only processes modalities explicitly in night_batch mode.
  // Immediate modalities are handled on DICOM arrival — do not silently pull CT/XR.
  const overnight = await overnightModalitySet();
  if (overnight.size === 0) {
    return { considered: 0, enqueued: 0, overnightModalities: [] };
  }

  const candidates: Array<{ uid: string; modality: string | null }> = [];
  const seen = new Set<string>();

  // Primary source: radiology worklist (Orthanc intake path).
  const wlRows = await db
    .select({
      uid: radiologyWorklistTable.studyInstanceUID,
      modality: radiologyWorklistTable.modality,
      aiDraftStatus: radiologyWorklistTable.aiDraftStatus,
    })
    .from(radiologyWorklistTable)
    .where(and(
      sql`${radiologyWorklistTable.studyInstanceUID} IS NOT NULL`,
      or(
        eq(radiologyWorklistTable.aiDraftStatus, "NONE"),
        eq(radiologyWorklistTable.aiDraftStatus, "PENDING"),
        eq(radiologyWorklistTable.aiDraftStatus, "ERROR"),
      ),
    ))
    .limit(Math.max(limit * 4, 80));

  for (const r of wlRows) {
    if (!r.uid || seen.has(r.uid)) continue;
    const mod = normalizeAiModality(r.modality ?? "");
    if (!overnight.has(mod)) continue;
    seen.add(r.uid);
    candidates.push({ uid: r.uid, modality: r.modality });
  }

  // Legacy / DIMSE path: dicom_incoming_studies complete without snapshot.
  const incoming = await db
    .select({ uid: dicomIncomingStudiesTable.studyInstanceUID, modality: dicomIncomingStudiesTable.modality })
    .from(dicomIncomingStudiesTable)
    .leftJoin(studySnapshotsTable, eq(studySnapshotsTable.studyInstanceUid, dicomIncomingStudiesTable.studyInstanceUID))
    .where(and(eq(dicomIncomingStudiesTable.transferStatus, "complete"), isNull(studySnapshotsTable.id)))
    .limit(Math.max(limit * 3, 50));

  for (const r of incoming) {
    if (!r.uid || seen.has(r.uid)) continue;
    const mod = normalizeAiModality(r.modality ?? "");
    if (!overnight.has(mod)) continue;
    seen.add(r.uid);
    candidates.push({ uid: r.uid, modality: r.modality });
  }

  let considered = 0;
  let enqueued = 0;
  for (const r of candidates) {
    considered++;
    if (enqueued >= limit) break;
    const res = await scheduleStudy({
      studyInstanceUid: r.uid,
      modality: r.modality,
      arrivalSignature: `night-batch:${Date.now()}:${enqueued}`,
      forceNightWindow: true,
    });
    if (res.enqueued) enqueued++;
  }
  return { considered, enqueued, overnightModalities: [...overnight] };
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
