/**
 * Pure restore-verify status helpers — no DB / pg / crypto imports.
 * Used by operationsChecks (smoke dashboard) and restoreVerification.
 */
export type RestoreVerifyDashboardStatus = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";

/**
 * Classify a persisted restore-verification row for the ops dashboard.
 * Does NOT convert FAIL → PASS/WARNING: a failed proof stays FAIL.
 * Adds `historicalStale` so operators can distinguish "failed recently" from
 * "failed days ago and has not been re-run".
 */
export function classifyRestoreVerifyDashboardStatus(opts: {
  status: string;
  ranAt: Date;
  now?: Date;
  failedSteps?: string[];
  stepCount?: number;
}): {
  status: RestoreVerifyDashboardStatus;
  message: string;
  metadata: Record<string, unknown>;
} {
  const now = opts.now ?? new Date();
  const ageHours = Math.round((now.getTime() - opts.ranAt.getTime()) / 3600000);
  const failedSteps = opts.failedSteps ?? [];
  const stepCount = opts.stepCount ?? 0;
  const staleHours = 7 * 24;
  const historicalStale = ageHours > staleHours;

  if (opts.status === "pass") {
    if (historicalStale) {
      return {
        status: "WARNING",
        message: `last restore-verify PASSED ${ageHours}h ago (> 7d) — re-run to stay current`,
        metadata: { ageHours, stepCount, historicalStale: true },
      };
    }
    return {
      status: "PASS",
      message: `restore verified ${ageHours}h ago — ${stepCount} steps all passed`,
      metadata: { ageHours, stepCount, historicalStale: false },
    };
  }

  const stepList = failedSteps.join(", ") || "unknown";
  return {
    status: "FAIL",
    message: historicalStale
      ? `last restore-verify FAILED ${ageHours}h ago (no newer run) — failed steps: ${stepList}. Re-run Verify Backup; this is a historical result until then.`
      : `last restore-verify FAILED ${ageHours}h ago — failed steps: ${stepList}`,
    metadata: { ageHours, stepCount, failedSteps, historicalStale },
  };
}
