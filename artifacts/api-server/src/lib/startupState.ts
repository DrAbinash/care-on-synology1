/**
 * startupState.ts — Ticket BEND-1 Phase 9: truthful startup/readiness state.
 *
 * The API binds its socket BEFORE in-process startup migrations/seeds finish
 * (deliberate: Docker liveness must not flap during long patches). Previously
 * nothing recorded that window or a startup-migration failure — /api/healthz
 * said "ok" while startup work was still running and swallowed failures.
 *
 * This module is that missing truth: STARTING → READY (or READY-degraded
 * when the best-effort in-process migrations failed — the process keeps
 * serving, matching the long-standing policy, but health now SAYS so).
 * State holder only: no IO, and no timer of its own — the deadline below is a
 * helper the caller races, so nothing here can hold a process open by itself.
 */

export type StartupPhase = "starting" | "ready";

export interface StartupState {
  phase: StartupPhase;
  startedAt: string;
  /** null until in-process startup migrations settle. */
  startupMigrationsOk: boolean | null;
  startupMigrationError: string | null;
  readyAt: string | null;
}

const state: StartupState = {
  phase: "starting",
  startedAt: new Date().toISOString(),
  startupMigrationsOk: null,
  startupMigrationError: null,
  readyAt: null,
};

/** Called once when the in-process startup work settles (success or failure).
 *  Failure still transitions to "ready" — the server serves (existing
 *  policy: db-patch-v2 is the authoritative migration runner) — but the
 *  failure is RECORDED and drives health DEGRADED instead of being swallowed. */
export function markStartupMigrationsSettled(ok: boolean, error?: string): void {
  state.startupMigrationsOk = ok;
  state.startupMigrationError = ok ? null : (error ?? "unknown startup migration failure").slice(0, 1000);
  state.phase = "ready";
  state.readyAt = new Date().toISOString();
}

export function getStartupState(): Readonly<StartupState> {
  return state;
}

/** How long the boot is allowed to keep readiness at "starting" before it has to
 *  say WHY instead. Measured on the NAS 2026-11-13: a healthy boot settles in 54 s.
 *  `deploy.sh`'s READINESS_TIMEOUT stays above this (startupState.test.ts asserts the
 *  ordering across the two files) so a slow-but-honest boot never reads as a failed
 *  deploy. */
export const STARTUP_DEADLINE_MS = 180_000;

/**
 * Race the boot's startup work against a deadline.
 *
 * runStartupMigrations() is a chain of awaits on Postgres, and a chain that loses a
 * response never settles: measured 2026-11-12 18:31Z on the clinic box, where the
 * migration session sat `idle` with its advisory lock still granted and
 * `pg_advisory_unlock` never issued, the process asleep at 0.01 % CPU, while every
 * other route kept serving 200. Readiness stayed at STARTING for the life of that
 * process — the worst answer health can give, because a permanently-starting endpoint
 * looks exactly like a five-seconds-one, and the deploy gate stopped a deploy of code
 * that was serving the clinic.
 *
 * Winning the race turns that silent pin into a RECORDED failure: the rejection lands
 * in the caller's existing catch, which marks startupMigrationsOk=false, so
 * `/api/healthz` answers 200 on its own DB probe and names the failed startup work
 * instead of withholding a verdict forever. The timer is unref'd and cleared as soon
 * as the work settles, so neither branch can hold a process open.
 */
export function withStartupDeadline<T>(
  work: Promise<T>,
  ms: number = STARTUP_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `startup work did not settle within ${ms} ms — readiness forced, because a hung boot must not pin /api/healthz at "starting"`,
      ));
    }, ms);
    if (typeof (timer as { unref?: unknown }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Health verdict for the startup component. */
export function startupHealth(s: Readonly<StartupState> = state): {
  status: "HEALTHY" | "DEGRADED" | "UNKNOWN";
  phase: StartupPhase;
  detail: string;
} {
  if (s.phase === "starting") {
    return { status: "UNKNOWN", phase: "starting", detail: "startup work still running — not ready" };
  }
  if (s.startupMigrationsOk === false) {
    return {
      status: "DEGRADED",
      phase: "ready",
      detail: `in-process startup migrations FAILED: ${s.startupMigrationError} (db-patch-v2 remains authoritative — verify /api/health/schema)`,
    };
  }
  return { status: "HEALTHY", phase: "ready", detail: "startup complete" };
}
