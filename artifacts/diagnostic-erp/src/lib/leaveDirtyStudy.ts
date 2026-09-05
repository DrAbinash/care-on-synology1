/**
 * Unified leave behavior for dirty studies.
 * Save & leave · Discard · Stay — one dialog culture for Next/Back/queue click.
 */
import type { TransitionGuards, TransitionVerdict } from "./reportingWorkflow";
import { canLeaveStudy } from "./reportingWorkflow";

export type LeaveChoice = "save_and_leave" | "discard" | "stay";

export type LeaveStudyResult =
  | { action: "navigate" }
  | { action: "stay"; reason?: string };

export type LeaveDirtyStudyDeps = {
  guards: TransitionGuards;
  /** Prompt radiologist when dirty. Must return one of the three choices. */
  promptDirty: (reason: string) => Promise<LeaveChoice> | LeaveChoice;
  /** Flush ensure-draft + save. Return false on failure (blocks navigation). */
  saveAndConfirm: () => Promise<boolean>;
  /** Explicit discard of unsaved local editor state (does not delete server draft). */
  discardLocal: () => void;
  /** Optional toast/notify when leave is blocked. */
  onBlocked?: (reason: string) => void;
};

/**
 * Shared leave gate. Finalized/clean → navigate. Busy → stay.
 * Dirty → Save & leave / Discard / Stay. Failed save → stay (no navigation).
 */
export async function leaveDirtyStudy(deps: LeaveDirtyStudyDeps): Promise<LeaveStudyResult> {
  const verdict: TransitionVerdict = canLeaveStudy(deps.guards);
  if (verdict.kind === "blocked") {
    deps.onBlocked?.(verdict.reason);
    return { action: "stay", reason: verdict.reason };
  }
  if (verdict.kind === "ok") {
    return { action: "navigate" };
  }

  // dirty → confirm
  const choice = await deps.promptDirty(verdict.reason);
  if (choice === "stay") return { action: "stay", reason: "cancelled" };
  if (choice === "discard") {
    deps.discardLocal();
    return { action: "navigate" };
  }

  // save_and_leave
  const ok = await deps.saveAndConfirm();
  if (!ok) return { action: "stay", reason: "save_failed" };
  return { action: "navigate" };
}
