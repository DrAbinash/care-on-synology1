/**
 * Server-side unreviewed-AI finalize guard.
 *
 * The workspace already refuses to finalize while AI Composer proposals remain
 * unreviewed (`diagnostic-erp/src/lib/aiFinalizeGate.ts`, "Guard 10"). That is
 * the only thing standing between an outstanding AI draft and a signed report,
 * and it lives entirely in the browser — a direct API call to
 * `POST /api/patient-reports` or `POST /api/patient-reports/:id/sign` never
 * evaluates it. This is the same rule, evaluated at the authoritative
 * finalize/sign boundary instead.
 *
 * Scope is deliberately narrow, so that no report that never used AI is
 * affected in any way:
 *  - only jobs in `READY` / `STALE_READY` count (the two statuses the review
 *    panel can still act on — the same pair the client gate uses);
 *  - only a job belonging to THIS study/worklist/report counts;
 *  - only changes whose `reviewState` is still `PENDING` count, so a fully
 *    ACCEPTED/REJECTED review, an APPLIED job, a FAILED/DISCARDED/OBSOLETE job,
 *    or no job at all all finalize exactly as before.
 *
 * "Reject remaining and continue" keeps working because the client rejects the
 * pending changes first — by the time finalize is retried there is nothing
 * PENDING left, which is the point of that button.
 *
 * No second review system is introduced: this reads the same
 * `ai_report_compose_jobs.tracked_changes_json` the review panel already writes.
 */
import { db } from "@workspace/db";
import { aiReportComposeJobsTable } from "@workspace/db/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { logger } from "../logger";
import type { TrackedChange } from "./types";

/** Statuses whose PENDING proposals are still live and still signable. */
export const UNREVIEWED_AI_JOB_STATUSES = ["READY", "STALE_READY"] as const;

export type UnreviewedAiDraft = {
  jobId: number;
  status: string;
  pendingChangeCount: number;
};

/**
 * Pure half of the guard — parse job rows and decide. Mirrors the client gate's
 * `reviewState === "PENDING"` test exactly, so the two can never drift apart in
 * what "unreviewed" means.
 */
export function firstUnreviewedJob(
  rows: Array<{ id: number; status: string; trackedChangesJson: string | null }>,
): UnreviewedAiDraft | null {
  for (const row of rows) {
    if (!UNREVIEWED_AI_JOB_STATUSES.includes(row.status as (typeof UNREVIEWED_AI_JOB_STATUSES)[number])) {
      continue;
    }
    let changes: TrackedChange[] = [];
    try {
      const parsed: unknown = JSON.parse(row.trackedChangesJson ?? "[]");
      // A corrupt or non-array review state is not proof anything is waiting for
      // review, and throwing here would break finalize for the whole study.
      changes = Array.isArray(parsed) ? (parsed as TrackedChange[]) : [];
    } catch {
      changes = [];
    }
    const pending = changes.filter((c) => c?.reviewState === "PENDING").length;
    if (pending > 0) {
      return { jobId: row.id, status: row.status, pendingChangeCount: pending };
    }
  }
  return null;
}

/**
 * Does this study have AI output the radiologist has not finished reviewing?
 *
 * On a query failure the finalize is allowed: this guard is defence in depth
 * behind "the server never writes draft text into the report", and refusing to
 * sign every report because the composer table was momentarily unreachable is
 * the worse clinical failure. The error is logged, never swallowed silently.
 */
export async function findUnreviewedAiDraft(refs: {
  worklistId?: number | null;
  studyId?: number | null;
  reportId?: number | null;
}): Promise<UnreviewedAiDraft | null> {
  const idRefs = [...new Set(
    [refs.worklistId, refs.studyId]
      .map((v) => (Number.isFinite(Number(v)) ? Number(v) : null))
      .filter((v): v is number => v != null),
  )];
  const reportId = Number.isFinite(Number(refs.reportId)) ? Number(refs.reportId) : null;
  if (idRefs.length === 0 && reportId == null) return null;

  try {
    const scopes = [
      ...idRefs.map((id) => eq(aiReportComposeJobsTable.worklistId, id)),
      ...idRefs.map((id) => eq(aiReportComposeJobsTable.studyId, id)),
      ...(reportId != null ? [eq(aiReportComposeJobsTable.reportId, reportId)] : []),
    ];
    const rows = await db
      .select({
        id: aiReportComposeJobsTable.id,
        status: aiReportComposeJobsTable.status,
        trackedChangesJson: aiReportComposeJobsTable.trackedChangesJson,
      })
      .from(aiReportComposeJobsTable)
      .where(
        and(
          inArray(aiReportComposeJobsTable.status, [...UNREVIEWED_AI_JOB_STATUSES]),
          or(...scopes),
        ),
      )
      .orderBy(desc(aiReportComposeJobsTable.updatedAt))
      .limit(20);
    return firstUnreviewedJob(rows);
  } catch (err) {
    logger.warn({ err, refs }, "unreviewed-AI finalize guard could not read compose jobs");
    return null;
  }
}

/**
 * The typed rejection every finalize/sign boundary returns. `error` is the
 * stable code; `message` is written for the radiologist, because it is what the
 * workspace toast shows.
 */
export function unreviewedAiFinalizeError(draft: UnreviewedAiDraft) {
  return {
    error: "unreviewed_ai_compose_changes" as const,
    message:
      `${draft.pendingChangeCount} AI suggestion(s) for this study are still unreviewed. `
      + "Review them in Reporting Tools → AI & Copilot, or Reject the remaining ones, then finalize again.",
    jobId: draft.jobId,
    jobStatus: draft.status,
    pendingChangeCount: draft.pendingChangeCount,
  };
}
