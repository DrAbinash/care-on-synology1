/**
 * Pure MWL cleanup rules — no DB imports (safe for unit tests).
 */

import type { RemoveWorklistResult } from "./mwlWorklistWriter";
import { isRemoveWorklistSuccess } from "./mwlWorklistWriter";

export const MWL_WL_CLEANUP_JOB = "mwl_wl_cleanup";
export const MWL_WL_CLEANUP_MAX_RETRIES = 12;

export function mwlCleanupIdempotencyKey(accessionNumber: string): string {
  return `mwl_wl_cleanup:${accessionNumber.trim()}`;
}

export function assessMwlCleanupTrafficLight(input: {
  pending: number;
  retrying: number;
  abandoned: number;
  overdue: number;
}): { trafficLight: "green" | "amber" | "red"; detail: string } {
  const active = input.pending + input.retrying;
  if (input.abandoned > 0 || input.overdue > 0) {
    return {
      trafficLight: "red",
      detail: `Repeated/overdue MWL cleanup failures: abandoned=${input.abandoned}, overdue=${input.overdue}`,
    };
  }
  if (active > 0) {
    return {
      trafficLight: "amber",
      detail: `Pending MWL cleanup retry: ${active}`,
    };
  }
  return {
    trafficLight: "green",
    detail: "Pending MWL cleanup: 0",
  };
}

/** Decide whether cancel can claim wlRemoved and whether to enqueue retry. */
export function decideCleanupAfterRemove(removeResult: RemoveWorklistResult): {
  wlRemoved: boolean;
  shouldEnqueue: boolean;
} {
  if (isRemoveWorklistSuccess(removeResult)) {
    return { wlRemoved: true, shouldEnqueue: false };
  }
  return { wlRemoved: false, shouldEnqueue: true };
}

/** Terminal statuses that must never be republished to MWL. */
export const MWL_REPUBLISH_BLOCKED_STATUSES = new Set([
  "COMPLETED",
  "CANCELLED",
  "CANCELED",
  "DISCONTINUED",
]);

export function isTerminalMwlStatus(status: string | null | undefined): boolean {
  return MWL_REPUBLISH_BLOCKED_STATUSES.has((status || "").toUpperCase());
}
