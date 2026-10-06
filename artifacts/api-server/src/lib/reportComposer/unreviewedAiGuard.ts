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
 *
 * FAILURE POSTURE — fail CLOSED. If the check itself cannot run, CARE does not
 * know whether unresolved AI proposals exist, and "we could not look" must never
 * be reported as "there was nothing to review". A 503 costs one retry; signing
 * an unreviewed AI draft is the failure that cannot be undone. This is safe with
 * respect to availability because the same Postgres serves the report write
 * anyway — if it is unreachable, finalize was going to fail regardless.
 */
import { db } from "@workspace/db";
import { aiReportComposeJobsTable } from "@workspace/db/schema";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { logger } from "../logger";
import type { TrackedChange } from "./types";

/** Statuses whose PENDING proposals are still live and still signable. */
export const UNREVIEWED_AI_JOB_STATUSES = ["READY", "STALE_READY"] as const;

/**
 * Coarse pre-filter for the query, in the exact compact form `JSON.stringify`
 * writes for these rows. It exists only so the row cap below applies to
 * *candidate* jobs rather than to the 20 most recent jobs of any kind — without
 * it, twenty fully-reviewed drafts could hide an unreviewed one behind them.
 * The decision itself is still made in `firstUnreviewedJob`, from parsed JSON.
 */
const PENDING_MARKER_LIKE = '%"reviewState":"PENDING"%';

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
 * Returns `null` only when the question was actually answered: nothing pending
 * among the jobs found (including the case where the study has no composer job
 * at all, or carries no study reference that a job could belong to). A database
 * or query error is thrown, NOT swallowed — callers must use
 * `checkUnreviewedAiFinalize`, which turns "could not look" into a refusal.
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
        like(aiReportComposeJobsTable.trackedChangesJson, PENDING_MARKER_LIKE),
        or(...scopes),
      ),
    )
    .orderBy(desc(aiReportComposeJobsTable.updatedAt))
    .limit(20);
  return firstUnreviewedJob(rows);
}

/**
 * The three answers a finalize/sign boundary can get, kept distinct because they
 * must not be confused:
 *  - `clear`     — looked, and there is nothing unreviewed. Finalize proceeds.
 *  - `unreviewed`— looked, and proposals are waiting. Finalize refused (409).
 *  - `unknown`   — the check itself failed. Finalize refused (503) and retried.
 */
export type UnreviewedAiFinalizeCheck =
  | { state: "clear" }
  | { state: "unreviewed"; draft: UnreviewedAiDraft }
  | { state: "unknown"; reason: "query_failed" };

export async function checkUnreviewedAiFinalize(refs: {
  worklistId?: number | null;
  studyId?: number | null;
  reportId?: number | null;
}): Promise<UnreviewedAiFinalizeCheck> {
  try {
    const draft = await findUnreviewedAiDraft(refs);
    return draft ? { state: "unreviewed", draft } : { state: "clear" };
  } catch (err) {
    logger.error(
      { err, refs },
      "unreviewed-AI finalize guard could not read compose jobs — finalize blocked (fail closed)",
    );
    return { state: "unknown", reason: "query_failed" };
  }
}

/**
 * The typed rejection every finalize/sign boundary returns. `error` is the
 * stable code for logs and clients; `message` is written for the radiologist.
 * Note that the shared client shows the message only when the payload opts in
 * with `retryable` (see `diagnostic-erp/src/lib/fetchApi.ts`), which the 503
 * does and this 409 does not — for an unreviewed draft the workspace's own
 * Guard 10 is what the radiologist normally sees first, with its own wording.
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

/**
 * Returned when CARE could not determine the review state at all. Deliberately
 * not merged with the 409: "nothing to review" and "we could not look" are
 * different clinical statements, and the radiologist's action differs — one is
 * review the suggestions, the other is try again.
 */
export function aiReviewStateUnavailableError() {
  return {
    error: "ai_review_state_unavailable" as const,
    message:
      "CARE could not check whether this study still has unreviewed AI suggestions, so the report was "
      + "NOT finalized and nothing was changed. Please try again in a moment. If it keeps failing, "
      + "finalize after the AI suggestions have been reviewed, or ask the admin to check the database.",
    retryable: true as const,
  };
}
