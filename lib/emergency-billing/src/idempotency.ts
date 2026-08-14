import type { ImportBatchResult } from "./types";

export function emptyImportResult(): ImportBatchResult {
  return {
    supplied: 0,
    imported: 0,
    alreadyReconciled: 0,
    created: 0,
    duplicates: 0,
    failures: 0,
    conflicts: 0,
    skippedReview: 0,
    failureDetails: [],
  };
}

/** Same UUID uploaded N times must never create extra CARE bills. */
export function applyIdempotentOutcome(
  result: ImportBatchResult,
  outcome: "created" | "already_reconciled" | "duplicate" | "failure" | "conflict" | "review",
  uuid?: string,
  error?: string,
): ImportBatchResult {
  const next = { ...result, supplied: result.supplied + 1, failureDetails: [...result.failureDetails] };
  if (outcome === "created") {
    next.created += 1;
    next.imported += 1;
  } else if (outcome === "already_reconciled") {
    next.alreadyReconciled += 1;
    next.duplicates += 1;
  } else if (outcome === "duplicate") {
    next.duplicates += 1;
    next.alreadyReconciled += 1;
  } else if (outcome === "failure") {
    next.failures += 1;
    if (uuid) next.failureDetails.push({ uuid, error: error ?? "import failed" });
  } else if (outcome === "conflict") {
    next.conflicts += 1;
  } else {
    next.skippedReview += 1;
  }
  return next;
}
