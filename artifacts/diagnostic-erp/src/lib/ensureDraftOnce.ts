/**
 * First-save without thinking — ensure a server draft exists exactly once
 * when the radiologist makes a meaningful edit (or when a path needs draftId).
 *
 * Pure concurrency helper: callers supply getDraftId / createDraft. Opening or
 * looking at a study must NOT call this — only meaningful edits / ensure paths.
 */
export type EnsureDraftOnceDeps = {
  getDraftId: () => number | null | undefined;
  /** Creates (or returns) a server draft id. Must be safe to call once. */
  createDraft: () => Promise<number | null>;
};

/**
 * Factory with in-flight mutex so simultaneous first edits share one POST.
 */
export function createEnsureDraftOnce(deps: EnsureDraftOnceDeps) {
  let inFlight: Promise<number | null> | null = null;

  return async function ensureDraftOnce(): Promise<number | null> {
    const existing = deps.getDraftId();
    if (existing != null && Number.isFinite(Number(existing)) && Number(existing) > 0) {
      return Number(existing);
    }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        // Re-check after awaiting the queue — another caller may have finished.
        const again = deps.getDraftId();
        if (again != null && Number.isFinite(Number(again)) && Number(again) > 0) {
          return Number(again);
        }
        return await deps.createDraft();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}

/** True when report body fields are non-empty enough to warrant a server draft. */
export function isMeaningfulReportEdit(fields: {
  findings?: string;
  impression?: string;
  recommendation?: string;
  technique?: string;
}): boolean {
  const has = (s?: string) => typeof s === "string" && s.trim().length > 0;
  return has(fields.findings) || has(fields.impression) || has(fields.recommendation) || has(fields.technique);
}
