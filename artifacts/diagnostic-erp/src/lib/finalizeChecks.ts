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
  | { state: "failed"; key: FinalizeCheckKey; reason: string };

export type FinalizeCheckFailure = Extract<FinalizeCheckOutcome<unknown>, { state: "failed" }>;

/**
 * What the sign dialog is built from: the findings the checks produced, the gate
 * they returned, and the list of checks that never ran. A retry produces a new
 * one of these and replaces the dialog's copy — which is why the three travel
 * together instead of the failure being a toast nobody can find again.
 */
export type FinalizeServiceChecks = {
  validationSummary: string;
  qualityGate: FinalizeQualityGate | null;
  checksIncomplete: FinalizeCheckFailure[];
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

export function valueOr<T>(outcome: FinalizeCheckOutcome<T>, fallback: T): T {
  return outcome.state === "completed" ? outcome.value : fallback;
}

export function failedFinalizeChecks(outcomes: readonly FinalizeCheckOutcome<unknown>[]): FinalizeCheckFailure[] {
  return outcomes.filter((o): o is FinalizeCheckFailure => o.state === "failed");
}

/**
 * The dialog block for checks that did not run. Returns "" when everything
 * completed, so the dialog can render nothing rather than a false reassurance.
 */
export function formatIncompleteChecks(outcomes: readonly FinalizeCheckOutcome<unknown>[]): string {
  const failed = failedFinalizeChecks(outcomes);
  if (failed.length === 0) return "";
  const lines = [
    `Checks that did not complete (${failed.length}):`,
    ...failed.map((f) => `  • ${FINALIZE_CHECK_LABELS[f.key]} — ${f.reason}`),
    "Nothing below was produced by these checks, so their absence is not a pass.",
    "Signing is unchanged: use Retry checks to run them again, or continue knowing",
    "this report was signed without them.",
  ];
  return `\n${lines.join("\n")}\n`;
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) return err.message.trim() || "the request failed";
  if (typeof err === "string") return err.trim() || "the request failed";
  return "the request failed";
}
