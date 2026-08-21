/**
 * Single-job overnight AI canary. Claims ONE existing pending/retrying
 * ai_shadow_pipeline row (newest fresh MRI by default). Does not bulk-drain.
 */
import { db } from "@workspace/db";
import { aiShadowDraftsTable, radiologyWorklistTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { isClinicPeakHours, clinicPeakHoursLabel } from "../clinicPeakHours";
import {
  getRadiologyJobById,
  peekOvernightAiClaim,
} from "../radiologyJobs";
import { shadowQueueComposition } from "./overnightDraftQueue";
import { getLatestDraftForStudy } from "./draftService";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";
import { AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";

function uidFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const uid = (payload as { studyInstanceUid?: unknown }).studyInstanceUid;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

export async function runOvernightAiCanary(opts: { jobId?: number } = {}) {
  const peak = isClinicPeakHours();
  if (peak) {
    return {
      ok: false,
      blocked: "peak_hold",
      detail: `Clinic peak hours (${clinicPeakHoursLabel()}) — AI drain paused`,
    };
  }
  const before = await shadowQueueComposition();
  let legacyHold: { holdBefore: string; releasedJobIds: number[] } | null = null;
  if (opts.jobId == null) {
    try {
      const { getOvernightOpsControls } = await import("./clinicalConfigService");
      const { resolveLegacyHoldClaimFilter } = await import("./overnightOpsControls");
      legacyHold = resolveLegacyHoldClaimFilter(await getOvernightOpsControls());
    } catch { /* no hold */ }
  }
  const peek = await peekOvernightAiClaim({
    preferNewest: opts.jobId == null,
    jobId: opts.jobId,
    legacyHold,
  });
  if (!peek) {
    return { ok: false, reason: "no_eligible_job", before };
  }
  const uid = peek.studyInstanceUid;
  const draftsBefore = uid ? await countShadowDrafts(uid) : 0;
  const wlBefore = uid ? await worklistDraftStatus(uid) : null;

  const { fireOvernightAiTick } = await import("../../cron");
  const tick = await fireOvernightAiTick({ canary: true, jobId: peek.id });
  const jobAfter = await getRadiologyJobById(peek.id);
  const draftsAfter = uid ? await countShadowDrafts(uid) : 0;
  const draft = uid ? await getLatestDraftForStudy(uid) : null;
  const wlAfter = uid ? await worklistDraftStatus(uid) : null;
  const runtime = await resolveLocalAiRuntime();
  const after = await shadowQueueComposition();

  const completed = jobAfter?.status === "success";
  return {
    ok: completed,
    jobId: peek.id,
    operationType: AI_SHADOW_PIPELINE_JOB,
    studyInstanceUid: uid,
    modality: peek.modality,
    beforeStatus: peek.status,
    afterStatus: jobAfter?.status ?? null,
    tick,
    model: runtime.localChatVisionModel,
    endpointUrl: runtime.ollamaBaseUrl,
    draftsBefore,
    draftsAfter,
    duplicateDraftCreated: draftsAfter > draftsBefore + 1,
    worklistBefore: wlBefore,
    worklistAfter: wlAfter,
    lastError: jobAfter?.failureReason ?? null,
    draftId: draft?.draftId ?? null,
    queueBefore: { pending: before.pending, running: before.running, abandoned: before.abandoned, dueNow: before.dueNow },
    queueAfter: { pending: after.pending, running: after.running, abandoned: after.abandoned, dueNow: after.dueNow },
  };
}

async function countShadowDrafts(studyInstanceUid: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiShadowDraftsTable)
    .where(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid));
  return row?.n ?? 0;
}

async function worklistDraftStatus(studyInstanceUid: string): Promise<string | null> {
  const [row] = await db
    .select({ status: radiologyWorklistTable.aiDraftStatus })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUid))
    .limit(1);
  return row?.status ?? null;
}

export { uidFromPayload };
