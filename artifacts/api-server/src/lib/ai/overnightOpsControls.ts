/**
 * Overnight vision ops controls — persisted on ai_scheduler_config.overnight_ops_json.
 *
 * Defaults preserve CURRENT production behaviour:
 *   paused=false, imageCap=auto, visionCtx=current, safeMode=false
 * Changing these via UI does NOT require Docker redeploy.
 * This module never silently raises production num_ctx to 16384.
 *
 * Legacy backlog hold: pre-cutover pending/retrying jobs are not auto-claimed.
 * Cutover is metadata on this JSON (no bulk row rewrites / deletes).
 */
export type OvernightImageCap = "auto" | "1" | "2" | "3" | "4" | "6";
export type OvernightVisionCtx = "current" | "4096" | "8192" | "16384";

export interface OvernightOpsControls {
  /** When true, overnight drain + night-batch enqueue are paused. */
  paused: boolean;
  pauseReason: string | null;
  /** Representative image cap override. "auto" = context-budget only. */
  imageCap: OvernightImageCap;
  /** "current" = env/runtime ollamaNumCtx (unchanged). Explicit values override overnight only. */
  visionCtx: OvernightVisionCtx;
  /** Conservative overnight: 1 image, concurrency 1, no multi-image escalation. */
  safeMode: boolean;
  /** Consecutive NEW overnight jobs that failed with the same resource code. */
  resourceFailStreak: number;
  lastResourceFailCode: string | null;
  /**
   * When true and legacyHoldBefore is set, overnight_ai claims exclude jobs with
   * created_at < holdBefore unless id is in legacyReleasedJobIds.
   * Explicit jobId canary/retry bypasses the claim filter.
   */
  legacyBacklogHold: boolean;
  /** ISO cutover timestamp. Jobs created before this are "legacy" while hold is on. */
  legacyHoldBefore: string | null;
  /** Explicitly released job ids (selective bypass without rewriting backlog rows). */
  legacyReleasedJobIds: number[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_OVERNIGHT_OPS: OvernightOpsControls = {
  paused: false,
  pauseReason: null,
  imageCap: "auto",
  visionCtx: "current",
  safeMode: false,
  resourceFailStreak: 0,
  lastResourceFailCode: null,
  legacyBacklogHold: false,
  legacyHoldBefore: null,
  legacyReleasedJobIds: [],
  updatedAt: null,
  updatedBy: null,
};

/** Cap allowlist size so overnight_ops_json stays small. */
export const LEGACY_RELEASED_JOB_IDS_MAX = 500;

const IMAGE_CAPS = new Set(["auto", "1", "2", "3", "4", "6"]);
const VISION_CTX = new Set(["current", "4096", "8192", "16384"]);

export function parseOvernightOpsJson(raw: unknown): OvernightOpsControls {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ...DEFAULT_OVERNIGHT_OPS };
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  } else {
    return { ...DEFAULT_OVERNIGHT_OPS };
  }

  const imageCap = String(obj.imageCap ?? "auto");
  const visionCtx = String(obj.visionCtx ?? "current");
  const holdBeforeRaw = obj.legacyHoldBefore;
  const legacyHoldBefore =
    typeof holdBeforeRaw === "string" && !Number.isNaN(Date.parse(holdBeforeRaw))
      ? new Date(holdBeforeRaw).toISOString()
      : null;
  const releasedRaw = obj.legacyReleasedJobIds;
  const legacyReleasedJobIds = Array.isArray(releasedRaw)
    ? [
        ...new Set(
          releasedRaw
            .map((n) => Math.floor(Number(n)))
            .filter((n) => Number.isFinite(n) && n > 0),
        ),
      ].slice(0, LEGACY_RELEASED_JOB_IDS_MAX)
    : [];
  return {
    paused: obj.paused === true,
    pauseReason: typeof obj.pauseReason === "string" ? obj.pauseReason.slice(0, 300) : null,
    imageCap: (IMAGE_CAPS.has(imageCap) ? imageCap : "auto") as OvernightImageCap,
    visionCtx: (VISION_CTX.has(visionCtx) ? visionCtx : "current") as OvernightVisionCtx,
    safeMode: obj.safeMode === true,
    resourceFailStreak: Math.max(0, Math.floor(Number(obj.resourceFailStreak) || 0)),
    lastResourceFailCode:
      typeof obj.lastResourceFailCode === "string" ? obj.lastResourceFailCode.slice(0, 80) : null,
    legacyBacklogHold: obj.legacyBacklogHold === true,
    legacyHoldBefore,
    legacyReleasedJobIds,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : null,
    updatedBy: typeof obj.updatedBy === "string" ? obj.updatedBy.slice(0, 80) : null,
  };
}

export function serializeOvernightOps(ops: OvernightOpsControls): string {
  return JSON.stringify(ops);
}

export function mergeOvernightOpsPatch(
  current: OvernightOpsControls,
  patch: Partial<OvernightOpsControls>,
  updatedBy?: string | null,
): OvernightOpsControls {
  const next = { ...current, ...patch };
  // Re-parse to coerce enums / strip invalid values.
  const coerced = parseOvernightOpsJson(next);
  return {
    ...coerced,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy ?? current.updatedBy,
  };
}

/** After a successful overnight draft, clear the resource-fail streak. */
export function recordOvernightResourceSuccess(ops: OvernightOpsControls): OvernightOpsControls {
  return {
    ...ops,
    resourceFailStreak: 0,
    lastResourceFailCode: null,
    // Do not auto-clear paused — operator must Resume.
  };
}

/**
 * Record a deterministic resource failure on a NEW overnight job.
 * After `threshold` consecutive same-code failures → pause overnight AI.
 */
export function recordOvernightResourceFailure(
  ops: OvernightOpsControls,
  code: "GPU_OUT_OF_MEMORY" | "CONTEXT_BUDGET_EXCEEDED",
  threshold = 3,
): OvernightOpsControls {
  const same = ops.lastResourceFailCode === code;
  const streak = same ? ops.resourceFailStreak + 1 : 1;
  const paused = streak >= threshold;
  return {
    ...ops,
    resourceFailStreak: streak,
    lastResourceFailCode: code,
    paused: ops.paused || paused,
    pauseReason: paused
      ? `OVERNIGHT AI PAUSED — RESOURCE FAILURE (${code} ×${streak})`
      : ops.pauseReason,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveOvernightNumCtx(opts: {
  configuredNumCtx: number;
  visionCtx: OvernightVisionCtx;
}): { numCtx: number; source: string } {
  if (opts.visionCtx === "current") {
    return {
      numCtx: Math.max(2048, Math.floor(opts.configuredNumCtx || 4096)),
      source: "runtime.ollamaNumCtx (unchanged)",
    };
  }
  const n = Number(opts.visionCtx);
  return {
    numCtx: Math.max(2048, Math.floor(n)),
    source: `UI overnight override ${opts.visionCtx}`,
  };
}

export function resolveOvernightImageCap(opts: {
  imageCap: OvernightImageCap;
  safeMode: boolean;
  contextBudgetMaxImages: number;
}): { maxImages: number; reason: string } {
  if (opts.safeMode) {
    return { maxImages: 1, reason: "Safe Mode — exactly one representative image" };
  }
  if (opts.imageCap === "auto") {
    return {
      maxImages: Math.max(1, opts.contextBudgetMaxImages),
      reason: `auto context budget → ${opts.contextBudgetMaxImages}`,
    };
  }
  const cap = Math.max(1, Math.min(6, Number(opts.imageCap)));
  const maxImages = Math.min(cap, Math.max(1, opts.contextBudgetMaxImages));
  return {
    maxImages,
    reason: `UI image cap ${opts.imageCap} ∩ context budget ${opts.contextBudgetMaxImages} → ${maxImages}`,
  };
}

/**
 * First boot after this feature ships: freeze cutover NOW and enable hold.
 * Safer than forcing Overnight AI Paused — post-cutover jobs may still drain.
 * Idempotent once legacyHoldBefore is set (survives restarts).
 */
export function initializeLegacyBacklogCutover(
  ops: OvernightOpsControls,
  now = new Date(),
): { ops: OvernightOpsControls; initialized: boolean } {
  if (ops.legacyHoldBefore != null) {
    return { ops, initialized: false };
  }
  return {
    ops: {
      ...ops,
      legacyHoldBefore: now.toISOString(),
      legacyBacklogHold: true,
      updatedAt: now.toISOString(),
      updatedBy: ops.updatedBy ?? "legacy-cutover-init",
    },
    initialized: true,
  };
}

/** Active hold filter for overnight_ai claims (null = do not filter). */
export function resolveLegacyHoldClaimFilter(
  ops: OvernightOpsControls,
): { holdBefore: string; releasedJobIds: number[] } | null {
  if (!ops.legacyBacklogHold || !ops.legacyHoldBefore) return null;
  return {
    holdBefore: ops.legacyHoldBefore,
    releasedJobIds: ops.legacyReleasedJobIds,
  };
}

export function isJobHeldByLegacyBacklog(
  ops: OvernightOpsControls,
  job: { id: number; createdAt: Date | string | null },
): boolean {
  const filter = resolveLegacyHoldClaimFilter(ops);
  if (!filter) return false;
  if (filter.releasedJobIds.includes(job.id)) return false;
  if (!job.createdAt) return true;
  const createdMs = new Date(job.createdAt).getTime();
  if (Number.isNaN(createdMs)) return true;
  return createdMs < new Date(filter.holdBefore).getTime();
}

/** Explicit canary/retry by jobId bypasses hold. */
export function shouldBypassLegacyHoldForClaim(opts: { jobId?: number | null }): boolean {
  return opts.jobId != null && Number.isFinite(opts.jobId) && opts.jobId > 0;
}

export function addLegacyReleasedJobIds(
  ops: OvernightOpsControls,
  jobIds: number[],
): OvernightOpsControls {
  const merged = [
    ...new Set([
      ...ops.legacyReleasedJobIds,
      ...jobIds.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0),
    ]),
  ].slice(0, LEGACY_RELEASED_JOB_IDS_MAX);
  return {
    ...ops,
    legacyReleasedJobIds: merged,
    updatedAt: new Date().toISOString(),
  };
}

/** Turn off hold for all legacy jobs. Does not delete rows or clear cutover marker. */
export function releaseAllLegacyBacklog(ops: OvernightOpsControls): OvernightOpsControls {
  return {
    ...ops,
    legacyBacklogHold: false,
    updatedAt: new Date().toISOString(),
  };
}
