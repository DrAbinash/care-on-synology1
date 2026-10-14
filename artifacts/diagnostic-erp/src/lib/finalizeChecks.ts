/**
 * finalizeChecks.ts — one place that knows whether a pre-sign validation actually
 * ran.
 *
 * The finalize path asks two services to look at the report before the sign
 * dialog opens: the server's draft validator and the canonical quality engine.
 * Both are advisory, and both used to report a failure as an absence — an empty
 * `catch {}` for the first, a null gate that made the dialog hide its quality
 * block for the second. To the radiologist, "nothing was found" and "nothing was
 * run" were the same screen. This module makes them different values.
 *
 * It changes no authorization and blocks nothing: the checks were advisory before
 * and are advisory now, and a check that failed is retried rather than escalated.
 * The signing policy is the product owner's decision (ARCHITECTURE.md §8.1), not
 * something a reliability fix gets to make.
 */

import type { FinalizeQualityGate } from "./reportQualityFinalize";

export type FinalizeCheckKey = "validateDraft" | "qualityEvaluation";

/** What the radiologist is shown. A key with no label is a check nobody can name. */
export const FINALIZE_CHECK_LABELS: Record<FinalizeCheckKey, string> = {
  validateDraft: "Server draft validation",
  qualityEvaluation: "Report quality evaluation",
};

export type FinalizeCheckOutcome<T> =
  | { state: "completed"; value: T }
  | { state: "failed"; key: FinalizeCheckKey; reason: string }
  /**
   * The check was never attempted, because the thing it reads is absent. Distinct
   * from "failed": a failure can be retried, and a skip cannot — retrying re-runs
   * the same closure over the same absent precondition. Offering Retry for a skip
   * would be naming a remedy that does not work.
   */
  | { state: "skipped"; key: FinalizeCheckKey; reason: string };

/** A check that did not look at this report — it threw, or it had nothing to read. */
export type FinalizeCheckNotRun = Extract<
  FinalizeCheckOutcome<unknown>,
  { state: "failed" | "skipped" }
>;

/**
 * What the sign dialog is built from: the findings the checks produced, the gate
 * they returned, and the list of checks that never ran. A retry produces a new
 * one of these and replaces the dialog's copy — which is why the three travel
 * together instead of the failure being a toast nobody can find again.
 */
export type FinalizeServiceChecks = {
  validationSummary: string;
  qualityGate: FinalizeQualityGate | null;
  checksIncomplete: FinalizeCheckNotRun[];
};

/** Runs one check and keeps the outcome, failure included. Never throws. */
export async function runFinalizeCheck<T>(
  key: FinalizeCheckKey,
  fn: () => Promise<T>,
): Promise<FinalizeCheckOutcome<T>> {
  try {
    return { state: "completed", value: await fn() };
  } catch (err) {
    return { state: "failed", key, reason: describeFailure(err) };
  }
}

/** Records a check that was not attempted, so its absence is a value and not a silence. */
export function skippedFinalizeCheck(key: FinalizeCheckKey, reason: string): FinalizeCheckNotRun {
  return { state: "skipped", key, reason };
}

export function valueOr<T>(outcome: FinalizeCheckOutcome<T>, fallback: T): T {
  return outcome.state === "completed" ? outcome.value : fallback;
}

/**
 * Every check that did not look at this report, whatever the reason.
 *
 * There is deliberately no narrower "which ones failed" query exported here. The
 * previous one was `failedFinalizeChecks`, and its name was the trap: a caller
 * that asks only for failures gets an empty list for a check that was never
 * attempted, which is precisely the silence this module exists to remove. Ask
 * what did not run, then ask `hasRetryableCheck` whether anything can be re-run.
 */
export function incompleteFinalizeChecks(outcomes: readonly FinalizeCheckOutcome<unknown>[]): FinalizeCheckNotRun[] {
  return outcomes.filter((o): o is FinalizeCheckNotRun => o.state !== "completed");
}

/** Whether Retry can help. Only a check that was attempted and threw can be re-attempted. */
export function hasRetryableCheck(outcomes: readonly FinalizeCheckNotRun[]): boolean {
  return outcomes.some((o) => o.state === "failed");
}

/**
 * The dialog block for checks that did not run. Returns "" when everything
 * completed, so the dialog can render nothing rather than a false reassurance.
 */
export function formatIncompleteChecks(outcomes: readonly FinalizeCheckOutcome<unknown>[]): string {
  const notRun = incompleteFinalizeChecks(outcomes);
  if (notRun.length === 0) return "";
  const failed = notRun.filter((o) => o.state === "failed");
  const skipped = notRun.filter((o) => o.state === "skipped");
  const lines: string[] = [];
  if (failed.length > 0) {
    lines.push(`Checks that did not complete (${failed.length}):`);
    lines.push(...failed.map((f) => `  • ${FINALIZE_CHECK_LABELS[f.key]} — ${f.reason}`));
  }
  if (skipped.length > 0) {
    lines.push(`Checks that could not run on this report (${skipped.length}):`);
    lines.push(...skipped.map((f) => `  • ${FINALIZE_CHECK_LABELS[f.key]} — ${f.reason}`));
  }
  lines.push("Nothing below was produced by these checks, so their absence is not a pass.");
  if (failed.length > 0) {
    lines.push("Signing is unchanged: use Retry checks to run them again, or continue knowing");
    lines.push("this report was signed without them.");
  } else {
    lines.push("Signing is unchanged, and Retry will not change it: a check that had nothing");
    lines.push("to read still has nothing to read.");
  }
  return `\n${lines.join("\n")}\n`;
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) return err.message.trim() || "the request failed";
  if (typeof err === "string") return err.trim() || "the request failed";
  return "the request failed";
}
