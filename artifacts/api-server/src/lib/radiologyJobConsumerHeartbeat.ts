/**
 * In-process heartbeat for the radiology job drain (overnight AI consumer).
 * No new queue. Lets diagnostics tell STOPPED/STALE from a green Ollama probe.
 */

export type RadiologyJobConsumerStatus =
  | "HEALTHY"
  | "STOPPED"
  | "STALE"
  | "PEAK_HOLD"
  | "STARVED";

export type RadiologyJobConsumerHeartbeat = {
  registered: boolean;
  registeredAt: string | null;
  lastCronTickAt: string | null;
  lastTickAt: string | null;
  lastClaimAt: string | null;
  lastClaimedJobId: number | null;
  lastClaimedType: string | null;
  lastOutcome: string | null;
  lastError: string | null;
  lastPeak: boolean;
  lastAiBlocked: boolean;
  lastDueAi: number | null;
  lastRan: number;
};

const STALE_MS = 150_000; // 2.5 minutes — cron is every 60s

let hb: RadiologyJobConsumerHeartbeat = emptyHeartbeat();

function emptyHeartbeat(): RadiologyJobConsumerHeartbeat {
  return {
    registered: false,
    registeredAt: null,
    lastCronTickAt: null,
    lastTickAt: null,
    lastClaimAt: null,
    lastClaimedJobId: null,
    lastClaimedType: null,
    lastOutcome: null,
    lastError: null,
    lastPeak: false,
    lastAiBlocked: false,
    lastDueAi: null,
    lastRan: 0,
  };
}

export function resetRadiologyJobConsumerHeartbeatForTests(): void {
  hb = emptyHeartbeat();
}

export function markRadiologyJobConsumerRegistered(at = new Date()): void {
  hb = {
    ...hb,
    registered: true,
    registeredAt: at.toISOString(),
  };
}

export function recordRadiologyJobCronTick(args: {
  at?: Date;
  peak: boolean;
  aiBlocked: boolean;
  dueAi: number;
  ran: number;
  claimedJobId?: number | null;
  claimedType?: string | null;
  outcome?: string | null;
  error?: string | null;
}): void {
  const at = args.at ?? new Date();
  const iso = at.toISOString();
  const claimed = args.claimedJobId != null;
  hb = {
    ...hb,
    lastCronTickAt: iso,
    lastTickAt: iso,
    lastPeak: args.peak,
    lastAiBlocked: args.aiBlocked,
    lastDueAi: args.dueAi,
    lastRan: args.ran,
    lastError: args.error ?? null,
    ...(claimed
      ? {
          lastClaimAt: iso,
          lastClaimedJobId: args.claimedJobId ?? null,
          lastClaimedType: args.claimedType ?? null,
          lastOutcome: args.outcome ?? null,
        }
      : {}),
  };
}

export function recordRadiologyJobTickResult(args: {
  at?: Date;
  ran: Array<{ id: number; operationType: string; outcome: string }>;
  error?: string | null;
}): void {
  const at = args.at ?? new Date();
  const iso = at.toISOString();
  const ai = args.ran.find((r) => r.operationType === "ai_shadow_pipeline") ?? args.ran[0];
  hb = {
    ...hb,
    lastTickAt: iso,
    lastRan: args.ran.length,
    lastError: args.error ?? hb.lastError,
    ...(ai
      ? {
          lastClaimAt: iso,
          lastClaimedJobId: ai.id,
          lastClaimedType: ai.operationType,
          lastOutcome: ai.outcome,
        }
      : {}),
  };
}

export function getRadiologyJobConsumerHeartbeat(): RadiologyJobConsumerHeartbeat {
  return { ...hb };
}

export function deriveRadiologyJobConsumerHealth(
  snap: RadiologyJobConsumerHeartbeat,
  opts: {
    now?: Date;
    queueDepth: number;
    running: number;
    nightWindow: boolean;
  },
): { status: RadiologyJobConsumerStatus; detail: string } {
  const now = opts.now ?? new Date();
  if (!snap.registered) {
    return {
      status: "STOPPED",
      detail: "Overnight job consumer is not registered in this process — pending jobs will never be claimed",
    };
  }
  // A live running claim means the consumer already moved pending → running.
  // Do not call that STALE just because the tick waits on Ollama (up to 10 min).
  if (opts.running > 0) {
    return {
      status: "HEALTHY",
      detail: `Consumer polling; ${opts.running} job(s) running`,
    };
  }
  if (!snap.lastCronTickAt) {
    const registeredMs = snap.registeredAt ? now.getTime() - Date.parse(snap.registeredAt) : 0;
    if (registeredMs > STALE_MS) {
      return {
        status: "STOPPED",
        detail: "Consumer registered but has never polled — drain timer did not fire",
      };
    }
    return {
      status: "HEALTHY",
      detail: "Consumer registered; waiting for first drain tick",
    };
  }
  const tickAge = now.getTime() - Date.parse(snap.lastCronTickAt);
  if (tickAge > STALE_MS) {
    return {
      status: "STALE",
      detail: `Last consumer poll was ${Math.round(tickAge / 1000)}s ago (expected every 60s)`,
    };
  }
  if (snap.lastAiBlocked && snap.lastPeak && opts.queueDepth > 0 && opts.running === 0) {
    return {
      status: "PEAK_HOLD",
      detail: "Clinic peak hours — AI drain paused (concurrency 0); queued overnight jobs wait until peak ends",
    };
  }
  if (
    opts.nightWindow
    && opts.queueDepth > 0
    && opts.running === 0
    && (snap.lastDueAi ?? 0) > 0
    && !snap.lastAiBlocked
    && snap.lastRan === 0
  ) {
    return {
      status: "STARVED",
      detail: `${snap.lastDueAi} due AI job(s) and running=0 after a live poll that claimed nothing — claim path did not start a shadow job`,
    };
  }
  return {
    status: "HEALTHY",
    detail: snap.lastRan > 0
      ? `Consumer polling; last tick ran ${snap.lastRan} job(s)`
      : "Consumer polling every minute",
  };
}
