/**
 * The finalize gate for unreviewed AI Composer proposals ("Guard 10").
 *
 * Extracted from useStudyFinalize so the decision can be tested. It was inline
 * in a hook that no test in this repo can reach — the ERP test environment has
 * no DOM — which meant the only thing standing between an outstanding AI review
 * and a signed report was an untested `if`.
 */

export type AiFinalizeGateJob = {
  status?: string | null;
  trackedChanges?: ReadonlyArray<{ reviewState?: string | null }>;
};

export type AiFinalizeGateDecision =
  | { block: false }
  | { block: true; pendingCount: number };

/**
 * Job statuses whose pending proposals are still live and still actionable in
 * the review panel. A FAILED / DISCARDED / CANCELLED / OBSOLETE job shows no
 * action bar (ReportComposerAssistant gates on the same two), and an APPLIED job
 * has already had every pending change accepted by applyAccepted — so pending
 * rows under those statuses are neither visible nor signable, and blocking on
 * them would strand the radiologist with a dialog they cannot clear.
 */
export const REVIEWABLE_AI_JOB_STATUSES = ["READY", "STALE_READY"] as const;

export function decideAiFinalizeGate(opts: {
  job: AiFinalizeGateJob | null | undefined;
  bypassed: boolean;
}): AiFinalizeGateDecision {
  const { job, bypassed } = opts;
  if (bypassed || !job) return { block: false };
  if (!REVIEWABLE_AI_JOB_STATUSES.includes(job.status as (typeof REVIEWABLE_AI_JOB_STATUSES)[number])) {
    return { block: false };
  }
  const pendingCount = (job.trackedChanges ?? []).filter((c) => c.reviewState === "PENDING").length;
  if (pendingCount === 0) return { block: false };
  return { block: true, pendingCount };
}
