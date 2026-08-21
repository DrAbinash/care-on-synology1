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
import { and, eq, desc, inArray, isNull, ne, sql } from "drizzle-orm";
import { isFeatureEnabledServer } from "../featureFlags";
import { AI_MASTER_FLAG, getSchedulerConfig, getModalityMode, getModalityPolicies, normalizeAiModality, DEFAULT_SCHEDULER } from "./clinicalConfigService";
import { enqueueAiShadowJob, AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";
import { jobBacklogCounts, listDeadLetterJobs, markJobRetryable, countDueJobs, peekOvernightAiClaim, getRadiologyJobById } from "../radiologyJobs";
import {
  deriveRadiologyJobConsumerHealth,
  getRadiologyJobConsumerHeartbeat,
} from "../radiologyJobConsumerHeartbeat";
import { isClinicPeakHours, clinicPeakHoursLabel } from "../clinicPeakHours";
import { resolveRadiologyStudyId } from "../canonicalStudy";
import { decideScheduling, isWithinNightWindow, type Priority } from "./aiScheduler";
import { logger } from "../logger";
import { istHourMinute } from "../istDate";
import { isStudyInAgeWindow } from "./studyAgeWindow";
import {
  cancelQueuedShadowJobs,
  duplicateEnqueueReason,
  enrichWorklistOvernightAi,
  findLatestShadowJob,
  overnightQueueStats,
  retryShadowJobs,
  shadowQueueComposition,
} from "./overnightDraftQueue";
import { compareOvernightDraftRows } from "./overnightAiDraftStatus";
import { probeOllamaReachable } from "@workspace/ai-providers";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";
import { CANONICAL_LOCAL_CHAT_VISION_MODEL } from "../aiPipeline/canonicalLocalAi";

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
  /** Explicit retry — still refuses if a job is already QUEUED/RUNNING. */
  forceRetry?: boolean;
  /** Night-batch / settings run: skip READY and in-flight unless forceRetry. */
  skipDuplicates?: boolean;
}): Promise<{ enqueued: boolean; reason: string; jobId?: number }> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) return { enqueued: false, reason: "master flag off" };
  const cfg = await getSchedulerConfig();
  const modalityMode = await getModalityMode(opts.modality);

  const skipDupes = opts.skipDuplicates !== false;
  if (skipDupes) {
    const dup = await duplicateEnqueueReason(opts.studyInstanceUid, { forceRetry: opts.forceRetry });
    if (dup) return { enqueued: false, reason: dup };
  }

  if (opts.forceRetry) {
    const latest = await findLatestShadowJob(opts.studyInstanceUid);
    if (latest && (latest.status === "abandoned" || latest.status === "failed")) {
      const ok = await markJobRetryable(latest.id);
      if (ok) {
        await markWorklistPending(opts.studyInstanceUid);
        return { enqueued: true, reason: "retried existing job", jobId: latest.id };
      }
    }
  }

  // "unchanged" = a manifest already exists for the current snapshot content.
  const isUnchanged = opts.forceRetry ? false : await hasCurrentManifest(opts.studyInstanceUid);
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
    arrivalSignature: opts.arrivalSignature ?? (opts.forceNightWindow ? "overnight" : `${decision.mode}:${opts.manualRequest ? "manual" : "auto"}`),
  });
  if (!res.created && res.id > 0) {
    const existing = await getRadiologyJobById(res.id);
    if (existing && (existing.status === "abandoned" || existing.status === "failed")) {
      await markJobRetryable(existing.id);
    }
  }
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
    const latest = await findLatestShadowJob(opts.studyInstanceUid);
    const noDicomAbandoned = latest?.status === "abandoned"
      && /no dicom instances found/i.test(latest.failureReason ?? "");
    const res = await scheduleStudy({
      studyInstanceUid: opts.studyInstanceUid,
      modality: opts.modality,
      priority: opts.priority ?? "routine",
      arrivalSignature: `dicom-arrival:${Date.now()}`,
      // DICOM is stable now — enqueue even outside the night window and revive
      // jobs that were abandoned while images were still transferring.
      forceNightWindow: true,
      forceRetry: noDicomAbandoned,
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

interface NightBatchCandidate {
  uid: string;
  modality: string | null;
  aiDraftStatus: string;
  studyDate: string | null;
  createdAt: Date | null;
}

async function collectNightBatchCandidates(overnight: Set<string>, scanLimit: number): Promise<NightBatchCandidate[]> {
  const candidates: NightBatchCandidate[] = [];
  const seen = new Set<string>();

  const wlRows = await db
    .select({
      uid: radiologyWorklistTable.studyInstanceUID,
      modality: radiologyWorklistTable.modality,
      aiDraftStatus: radiologyWorklistTable.aiDraftStatus,
      studyDate: radiologyWorklistTable.studyDate,
      createdAt: radiologyWorklistTable.createdAt,
    })
    .from(radiologyWorklistTable)
    .where(sql`${radiologyWorklistTable.studyInstanceUID} IS NOT NULL`)
    .orderBy(desc(radiologyWorklistTable.createdAt))
    .limit(scanLimit);

  for (const r of wlRows) {
    if (!r.uid || seen.has(r.uid)) continue;
    const mod = normalizeAiModality(r.modality ?? "");
    if (!overnight.has(mod)) continue;
    seen.add(r.uid);
    candidates.push({
      uid: r.uid,
      modality: r.modality,
      aiDraftStatus: (r.aiDraftStatus ?? "NONE").toUpperCase(),
      studyDate: r.studyDate,
      createdAt: r.createdAt,
    });
  }

  const incoming = await db
    .select({ uid: dicomIncomingStudiesTable.studyInstanceUID, modality: dicomIncomingStudiesTable.modality })
    .from(dicomIncomingStudiesTable)
    .leftJoin(studySnapshotsTable, eq(studySnapshotsTable.studyInstanceUid, dicomIncomingStudiesTable.studyInstanceUID))
    .where(and(eq(dicomIncomingStudiesTable.transferStatus, "complete"), isNull(studySnapshotsTable.id)))
    .limit(Math.min(scanLimit, 200));

  for (const r of incoming) {
    if (!r.uid || seen.has(r.uid)) continue;
    const mod = normalizeAiModality(r.modality ?? "");
    if (!overnight.has(mod)) continue;
    seen.add(r.uid);
    candidates.push({
      uid: r.uid,
      modality: r.modality,
      aiDraftStatus: "NONE",
      studyDate: null,
      createdAt: null,
    });
  }
  return candidates;
}

function applyStudyAgeWindow<T extends { studyDate: string | null; createdAt: Date | null }>(
  rows: T[],
  cfg: Awaited<ReturnType<typeof getSchedulerConfig>>,
): T[] {
  return rows.filter((r) => isStudyInAgeWindow({
    window: cfg.studyAgeWindow,
    studyDate: r.studyDate,
    createdAt: r.createdAt,
    customFrom: cfg.studyAgeCustomFrom,
    customTo: cfg.studyAgeCustomTo,
  }));
}

export interface NightBatchPreview {
  overnightModalities: string[];
  studyAgeWindow: string;
  eligible: number;
  alreadyReady: number;
  alreadyQueuedOrRunning: number;
  previouslyError: number;
  newEligible: number;
  skippedWindow?: boolean;
}

async function classifyNightCandidates(candidates: NightBatchCandidate[]): Promise<{
  eligible: NightBatchCandidate[];
  alreadyReady: number;
  alreadyQueuedOrRunning: number;
  previouslyError: number;
  newEligible: NightBatchCandidate[];
}> {
  const eligible = candidates;
  let alreadyReady = 0;
  let alreadyQueuedOrRunning = 0;
  let previouslyError = 0;
  const newEligible: NightBatchCandidate[] = [];
  for (const c of eligible) {
    const dup = await duplicateEnqueueReason(c.uid);
    if (dup === "already READY") {
      alreadyReady++;
      continue;
    }
    if (dup?.startsWith("already ")) {
      alreadyQueuedOrRunning++;
      continue;
    }
    if (c.aiDraftStatus === "ERROR") {
      previouslyError++;
      continue;
    }
    newEligible.push(c);
  }
  return { eligible, alreadyReady, alreadyQueuedOrRunning, previouslyError, newEligible };
}

/** Preview counts for Settings → Run batch, without enqueueing. */
export async function previewNightBatch(): Promise<NightBatchPreview> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) {
    return {
      overnightModalities: [], studyAgeWindow: "all",
      eligible: 0, alreadyReady: 0, alreadyQueuedOrRunning: 0, previouslyError: 0, newEligible: 0,
    };
  }
  const cfg = await getSchedulerConfig();
  const overnight = await overnightModalitySet();
  if (overnight.size === 0) {
    return {
      overnightModalities: [], studyAgeWindow: cfg.studyAgeWindow,
      eligible: 0, alreadyReady: 0, alreadyQueuedOrRunning: 0, previouslyError: 0, newEligible: 0,
    };
  }
  const raw = await collectNightBatchCandidates(overnight, 800);
  const inWindow = applyStudyAgeWindow(raw, cfg);
  const classified = await classifyNightCandidates(inWindow);
  return {
    overnightModalities: [...overnight],
    studyAgeWindow: cfg.studyAgeWindow,
    eligible: classified.eligible.length,
    alreadyReady: classified.alreadyReady,
    alreadyQueuedOrRunning: classified.alreadyQueuedOrRunning,
    previouslyError: classified.previouslyError,
    newEligible: classified.newEligible.length,
  };
}

/** Night / scheduled batch: enqueue worklist + incoming studies still needing drafts. */
export async function runNightBatch(
  limit = 50,
  opts: { forceOutsideWindow?: boolean; onlyNew?: boolean } = {},
): Promise<{
  considered: number;
  enqueued: number;
  skippedWindow?: boolean;
  overnightModalities: string[];
  skippedReady?: number;
  skippedInFlight?: number;
  preview?: NightBatchPreview;
}> {
  if (!(await isFeatureEnabledServer(AI_MASTER_FLAG))) {
    return { considered: 0, enqueued: 0, overnightModalities: [] };
  }
  const cfg = await getSchedulerConfig();
  if (cfg.overnightOps?.paused) {
    return {
      considered: 0,
      enqueued: 0,
      overnightModalities: [],
      skippedWindow: true,
      preview: undefined,
    };
  }
  if (!opts.forceOutsideWindow && !isWithinNightWindow(nowMinutesLocal(), cfg)) {
    return { considered: 0, enqueued: 0, skippedWindow: true, overnightModalities: [] };
  }

  const overnight = await overnightModalitySet();
  if (overnight.size === 0) {
    return { considered: 0, enqueued: 0, overnightModalities: [] };
  }

  const raw = await collectNightBatchCandidates(overnight, Math.max(limit * 8, 200));
  const candidates = applyStudyAgeWindow(raw, cfg);
  const classified = await classifyNightCandidates(candidates);

  const toEnqueue = opts.onlyNew
    ? classified.newEligible
    : [
        ...classified.newEligible,
        ...candidates.filter((c) => c.aiDraftStatus === "ERROR"),
      ];

  let considered = 0;
  let enqueued = 0;
  let skippedReady = 0;
  let skippedInFlight = 0;
  for (const r of toEnqueue) {
    considered++;
    if (enqueued >= limit) break;
    const res = await scheduleStudy({
      studyInstanceUid: r.uid,
      modality: r.modality,
      arrivalSignature: "overnight",
      forceNightWindow: true,
      forceRetry: r.aiDraftStatus === "ERROR",
      skipDuplicates: true,
    });
    if (res.enqueued) enqueued++;
    else if (res.reason === "already READY") skippedReady++;
    else if (res.reason.startsWith("already ")) skippedInFlight++;
  }
  return {
    considered,
    enqueued,
    overnightModalities: [...overnight],
    skippedReady,
    skippedInFlight,
    preview: {
      overnightModalities: [...overnight],
      studyAgeWindow: cfg.studyAgeWindow,
      eligible: classified.eligible.length,
      alreadyReady: classified.alreadyReady,
      alreadyQueuedOrRunning: classified.alreadyQueuedOrRunning,
      previouslyError: classified.previouslyError,
      newEligible: classified.newEligible.length,
    },
  };
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
    const res = await scheduleStudy({
      studyInstanceUid: r.uid,
      manualRequest: true,
      arrivalSignature: "reprocess",
      skipDuplicates: false,
    });
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

/** Cancel queued (pending/retrying) AI jobs only — never a running Ollama claim. */
export async function cancelAiJob(jobId: number): Promise<boolean> {
  const result = await cancelQueuedShadowJobs([jobId]);
  return result.cancelled === 1;
}

export async function cancelQueuedOvernightJobs(jobIds: number[]) {
  return cancelQueuedShadowJobs(jobIds);
}

export async function retryOvernightJobs(jobIds: number[]) {
  return retryShadowJobs(jobIds);
}

/** Queue selected worklist studies onto the existing shadow pipeline. */
export async function queueSelectedStudies(opts: {
  studyInstanceUids: string[];
  modalities?: Record<string, string | null>;
  retry?: boolean;
}): Promise<{ queued: number; skipped: Array<{ uid: string; reason: string }> }> {
  const skipped: Array<{ uid: string; reason: string }> = [];
  let queued = 0;
  for (const uid of opts.studyInstanceUids) {
    const res = await scheduleStudy({
      studyInstanceUid: uid,
      modality: opts.modalities?.[uid] ?? null,
      manualRequest: true,
      forceRetry: Boolean(opts.retry),
      skipDuplicates: true,
      arrivalSignature: opts.retry ? "overnight-retry" : "overnight",
    });
    if (res.enqueued) queued++;
    else skipped.push({ uid, reason: res.reason });
  }
  return { queued, skipped };
}

export async function attachOvernightAiToWorklist<T extends {
  studyInstanceUID?: string | null;
  aiDraftStatus?: string | null;
  createdAt?: Date | string | null;
}>(rows: T[]) {
  const enriched = await enrichWorklistOvernightAi(rows);
  return enriched.sort((a, b) => compareOvernightDraftRows(
    {
      displayStatus: a.overnightAi.displayStatus,
      completedAt: a.overnightAi.completedAt,
      startedAt: a.overnightAi.startedAt,
      lastAttemptAt: a.overnightAi.lastAttemptAt,
      queuePosition: a.overnightAi.queuePosition,
      queuedAt: a.overnightAi.queuedAt,
      jobId: a.overnightAi.jobId,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt ?? null,
    },
    {
      displayStatus: b.overnightAi.displayStatus,
      completedAt: b.overnightAi.completedAt,
      startedAt: b.overnightAi.startedAt,
      lastAttemptAt: b.overnightAi.lastAttemptAt,
      queuePosition: b.overnightAi.queuePosition,
      queuedAt: b.overnightAi.queuedAt,
      jobId: b.overnightAi.jobId,
      createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt ?? null,
    },
  ));
}

/** Compact overnight diagnostics — consumer heartbeat + queue truth, not Ollama health. */
export async function getOvernightDiagnostics() {
  let cfg = DEFAULT_SCHEDULER;
  let configError: string | null = null;
  try {
    cfg = await getSchedulerConfig();
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "overnight diagnostics: scheduler config unreadable — using defaults");
  }
  const nowMin = nowMinutesLocal();
  const nightWindow = isWithinNightWindow(nowMin, cfg);
  const schedulersOn = process.env.ENABLE_SCHEDULERS === "1" || process.env.ENABLE_SCHEDULERS === "true";
  let stats = {
    queueDepth: 0,
    running: 0,
    abandoned: 0,
    staleRunning: 0,
    oldestQueuedAt: null as string | null,
    lastSuccessfulDraftAt: null as string | null,
    lastError: null as string | null,
    lastErrorAt: null as string | null,
    topAbandonedReasons: [] as Array<{ reason: string; count: number }>,
  };
  let dueAi = 0;
  let composition: Awaited<ReturnType<typeof shadowQueueComposition>> | null = null;
  let claimPreview: Awaited<ReturnType<typeof peekOvernightAiClaim>> | null = null;
  try {
    stats = await overnightQueueStats();
    dueAi = await countDueJobs(AI_SHADOW_PIPELINE_JOB);
    composition = await shadowQueueComposition();
    claimPreview = await peekOvernightAiClaim({ preferNewest: false });
  } catch (err) {
    logger.warn({ err }, "overnight diagnostics: queue stats unreadable");
  }
  const hb = getRadiologyJobConsumerHeartbeat();
  const consumer = deriveRadiologyJobConsumerHealth(hb, {
    queueDepth: stats.queueDepth,
    running: stats.running,
    nightWindow,
  });
  const peak = isClinicPeakHours();
  let localAiReachable = false;
  let localAiError: string | null = null;
  let model = CANONICAL_LOCAL_CHAT_VISION_MODEL;
  try {
    const runtime = await resolveLocalAiRuntime();
    model = runtime.localChatVisionModel;
    const probe = await probeOllamaReachable(runtime.ollamaBaseUrl);
    localAiReachable = probe.reachable;
    localAiError = probe.error ?? null;
  } catch (err) {
    localAiError = err instanceof Error ? err.message : String(err);
  }
  return {
    timezone: "Asia/Kolkata",
    scheduler: schedulersOn ? "running" : "not_running",
    nightWindow: nightWindow ? "active" : "inactive",
    nightWindowHours: `${cfg.nightStart}–${cfg.nightEnd} IST`,
    clinicPeak: peak ? "active" : "inactive",
    clinicPeakHours: clinicPeakHoursLabel(),
    worker: consumer.status,
    workerDetail: consumer.detail,
    localAi: localAiReachable ? "reachable" : "unreachable",
    localAiError,
    model,
    concurrency: cfg.maxConcurrentJobs,
    queueDepth: stats.queueDepth,
    running: stats.running,
    abandoned: stats.abandoned,
    dueNow: dueAi,
    staleRunning: stats.staleRunning,
    oldestQueuedAt: stats.oldestQueuedAt,
    lastSuccessfulDraftAt: stats.lastSuccessfulDraftAt,
    lastError: stats.lastError,
    lastErrorAt: stats.lastErrorAt,
    lastHeartbeat: hb.lastCronTickAt,
    lastPoll: hb.lastTickAt,
    lastClaimedJob: hb.lastClaimedJobId,
    lastClaimedAt: hb.lastClaimAt,
    lastRan: hb.lastRan,
    lastOutcome: hb.lastOutcome,
    lastCompletedDraft: stats.lastSuccessfulDraftAt,
    currentJob: stats.running > 0 ? hb.lastClaimedJobId : null,
    topAbandonedReasons: stats.topAbandonedReasons,
    studyAgeWindow: cfg.studyAgeWindow,
    configError,
    composition,
    claimPreview,
    firstStop: describeOvernightFirstStop({
      consumer: consumer.status,
      registered: hb.registered,
      lastCronTickAt: hb.lastCronTickAt,
      lastRan: hb.lastRan,
      lastOutcome: hb.lastOutcome,
      lastError: hb.lastError ?? stats.lastError,
      dueNow: dueAi,
      pending: stats.queueDepth,
      running: stats.running,
      peak,
    }),
    meaning: {
      queueDepth: "dicom_retry_queue rows with operation_type=ai_shadow_pipeline and status pending|retrying (all ages/modalities)",
      worklistQueued: "Overnight AI Drafts filter: worklist rows in the selected age chip whose latest shadow job maps to QUEUED (not the full backlog)",
    },
  };
}

function describeOvernightFirstStop(input: {
  consumer: string;
  registered: boolean;
  lastCronTickAt: string | null;
  lastRan: number;
  lastOutcome: string | null;
  lastError: string | null;
  dueNow: number;
  pending: number;
  running: number;
  peak: boolean;
}): string {
  if (!input.registered) return "consumer_not_registered_in_this_api_process";
  if (input.running > 0) return "none_job_running";
  if (input.peak && input.pending > 0) return "clinic_peak_ai_concurrency_0";
  if (!input.lastCronTickAt) return "drain_timer_registered_but_never_polled";
  if (input.consumer === "STALE") return "drain_tick_stale_or_hung";
  if (input.consumer === "STARVED") return "claim_returned_no_row_despite_due_jobs";
  if (input.dueNow === 0 && input.pending > 0) return "jobs_waiting_on_next_retry_at_backoff";
  if (input.lastRan > 0 && input.lastOutcome && input.lastOutcome !== "success") {
    return `handler_failed:${(input.lastError ?? input.lastOutcome).slice(0, 120)}`;
  }
  return "none_consumer_polling";
}
