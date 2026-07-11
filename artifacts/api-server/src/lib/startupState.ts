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
 * Pure state holder — no timers, no IO.
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
