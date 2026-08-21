/**
 * Overnight vision ops controls — persisted on ai_scheduler_config.overnight_ops_json.
 *
 * Defaults preserve CURRENT production behaviour for vision knobs:
 *   paused=false, imageCap=auto, visionCtx=current, safeMode=false
 * Changing these via UI does NOT require Docker redeploy.
 * This module never silently raises production num_ctx to 16384.
 *
 * Legacy backlog hold: pre-cutover pending/retrying jobs are not auto-claimed.
 * Cutover is metadata on this JSON (no bulk row rewrites / deletes).
 *
 * FAIL-SAFE: missing/ambiguous upgrade state prefers HELD over RELEASED.
 * Explicit release requires legacyHoldExplicitlyReleased=true (release_all).
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
   * Derived display/claim flag: true when cutover is set and hold was not explicitly released.
   * Do not treat a bare false in older JSON as intentional RELEASED without
   * legacyHoldExplicitlyReleased.
   */
  legacyBacklogHold: boolean;
  /** ISO cutover timestamp. Jobs created before this are "legacy" while hold is on. */
  legacyHoldBefore: string | null;
  /**
   * Set only by explicit release_all. Absent/false + cutover present ⇒ HELD (fail-safe).
   * Prevents unrelated saves / resource-streak writes from turning HOLD into RELEASED.
   */
  legacyHoldExplicitlyReleased: boolean;
  /** Explicitly released job ids (selective bypass without rewriting backlog rows). */
  legacyReleasedJobIds: number[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Vision defaults only — legacy hold is applied by cutover init / fail-safe, not this bare default. */
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
  legacyHoldExplicitlyReleased: false,
  legacyReleasedJobIds: [],
  updatedAt: null,
  updatedBy: null,
};

/** Cap allowlist size so overnight_ops_json stays small. */
export const LEGACY_RELEASED_JOB_IDS_MAX = 500;

/** Fields that must never be clobbered by unrelated overnight vision saves. */
export const LEGACY_HOLD_PROTECTED_KEYS = [
  "legacyBacklogHold",
  "legacyHoldBefore",
  "legacyHoldExplicitlyReleased",
  "legacyReleasedJobIds",
] as const;

const IMAGE_CAPS = new Set(["auto", "1", "2", "3", "4", "6"]);
const VISION_CTX = new Set(["current", "4096", "8192", "16384"]);

function normalizeHoldFlags(opts: {
  legacyHoldBefore: string | null;
  legacyHoldExplicitlyReleased: boolean;
}): { legacyBacklogHold: boolean; legacyHoldExplicitlyReleased: boolean } {
  const explicitlyReleased = opts.legacyHoldExplicitlyReleased === true;
  // Fail-safe: cutover present + not explicitly released ⇒ HELD
  // (ignores a bare legacyBacklogHold:false left by accidental wipe / old release_all).
  const hold =
    opts.legacyHoldBefore != null && !explicitlyReleased;
  return {
    legacyBacklogHold: hold,
    legacyHoldExplicitlyReleased: explicitlyReleased,
  };
}

export function parseOvernightOpsJson(raw: unknown): OvernightOpsControls {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return failSafeHeldOps(new Date(), "parse-error");
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
  const holdFlags = normalizeHoldFlags({
    legacyHoldBefore,
    legacyHoldExplicitlyReleased: obj.legacyHoldExplicitlyReleased === true,
  });
  return {
    paused: obj.paused === true,
    pauseReason: typeof obj.pauseReason === "string" ? obj.pauseReason.slice(0, 300) : null,
    imageCap: (IMAGE_CAPS.has(imageCap) ? imageCap : "auto") as OvernightImageCap,
    visionCtx: (VISION_CTX.has(visionCtx) ? visionCtx : "current") as OvernightVisionCtx,
    safeMode: obj.safeMode === true,
    resourceFailStreak: Math.max(0, Math.floor(Number(obj.resourceFailStreak) || 0)),
    lastResourceFailCode:
      typeof obj.lastResourceFailCode === "string" ? obj.lastResourceFailCode.slice(0, 80) : null,
    legacyBacklogHold: holdFlags.legacyBacklogHold,
    legacyHoldBefore,
    legacyHoldExplicitlyReleased: holdFlags.legacyHoldExplicitlyReleased,
    legacyReleasedJobIds,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : null,
    updatedBy: typeof obj.updatedBy === "string" ? obj.updatedBy.slice(0, 80) : null,
  };
}

/** In-memory fail-safe when overnight_ops_json is unreadable / missing column. */
export function failSafeHeldOps(now = new Date(), reason = "fail-safe-hold"): OvernightOpsControls {
  return {
    ...DEFAULT_OVERNIGHT_OPS,
    legacyBacklogHold: true,
    legacyHoldBefore: now.toISOString(),
    legacyHoldExplicitlyReleased: false,
    updatedAt: now.toISOString(),
    updatedBy: reason.slice(0, 80),
  };
}

export function serializeOvernightOps(ops: OvernightOpsControls): string {
  return JSON.stringify(ops);
}

/**
 * Merge vision/ops patches. By default legacy-hold fields are protected so
 * Save vision controls / resource-streak writes cannot turn HOLD into RELEASED.
 */
export function mergeOvernightOpsPatch(
  current: OvernightOpsControls,
  patch: Partial<OvernightOpsControls>,
  updatedBy?: string | null,
  opts?: { allowLegacyHoldMutation?: boolean },
): OvernightOpsControls {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (
      !opts?.allowLegacyHoldMutation
      && (LEGACY_HOLD_PROTECTED_KEYS as readonly string[]).includes(key)
    ) {
      continue;
    }
    next[key] = value;
  }
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

/** Patch fields safe to persist from shadow resource streak updates (no hold keys). */
export function resourceStreakPatchFromOps(
  ops: OvernightOpsControls,
): Pick<
  OvernightOpsControls,
  "resourceFailStreak" | "lastResourceFailCode" | "paused" | "pauseReason"
> {
  return {
    resourceFailStreak: ops.resourceFailStreak,
    lastResourceFailCode: ops.lastResourceFailCode,
    paused: ops.paused,
    pauseReason: ops.pauseReason,
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
    // Re-derive hold flags (fail-safe) without moving cutover.
    const holdFlags = normalizeHoldFlags({
      legacyHoldBefore: ops.legacyHoldBefore,
      legacyHoldExplicitlyReleased: ops.legacyHoldExplicitlyReleased,
    });
    return {
      ops: {
        ...ops,
        legacyBacklogHold: holdFlags.legacyBacklogHold,
        legacyHoldExplicitlyReleased: holdFlags.legacyHoldExplicitlyReleased,
      },
      initialized: false,
    };
  }
  return {
    ops: {
      ...ops,
      legacyHoldBefore: now.toISOString(),
      legacyBacklogHold: true,
      legacyHoldExplicitlyReleased: false,
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
  if (!ops.legacyHoldBefore) return null;
  if (ops.legacyHoldExplicitlyReleased) return null;
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
    legacyHoldExplicitlyReleased: true,
    updatedAt: new Date().toISOString(),
  };
}

/** Re-enable hold after an explicit release (keeps cutover marker). */
export function reenableLegacyBacklogHold(ops: OvernightOpsControls): OvernightOpsControls {
  if (!ops.legacyHoldBefore) {
    return initializeLegacyBacklogCutover(ops).ops;
  }
  return {
    ...ops,
    legacyBacklogHold: true,
    legacyHoldExplicitlyReleased: false,
    updatedAt: new Date().toISOString(),
  };
}
