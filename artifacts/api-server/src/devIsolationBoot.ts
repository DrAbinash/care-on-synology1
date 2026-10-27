/**
 * devIsolationBoot.ts — the only place CARE_DEV_ISOLATED touches the process.
 *
 * Sits next to `index.ts` on purpose: both processes (`index.ts` for the API,
 * `worker.ts` for the scheduler worker) call `initializeDevIsolation()` as their
 * first statement after the environment is loaded, and every gated side effect is
 * started through `bootStep()` so the registry in `lib/devIsolation.ts` is the one
 * thing that decides whether it runs.
 *
 * Kept separate from `lib/devIsolation.ts` so that file stays free of logger and
 * global monkey-patching and can be unit tested without importing the world.
 */
import { logger } from "./lib/logger";
import {
  describeIsolation,
  evaluateDatabaseUrl,
  isIsolated,
  decideStartupStep,
  type IsolatedStartupStep,
} from "./lib/devIsolation";
import { installDevIsolationEgressGuards, type EgressObservation } from "./lib/devIsolationEgress";

type Env = Record<string, string | undefined>;

let restoreGuards: () => void = () => {};
let blockedCount = 0;
let allowedCount = 0;
let initialised = false;

function observeEgress(o: EgressObservation): void {
  if (o.allowed) {
    allowedCount += 1;
    logger.debug({ via: o.via, host: o.host, port: o.port, reason: o.reason }, "CARE_DEV_ISOLATED allowed outbound target");
    return;
  }
  blockedCount += 1;
  logger.error(
    { via: o.via, host: o.host, port: o.port, blockedTotal: blockedCount, reason: o.reason },
    "CARE_DEV_ISOLATED BLOCKED an outbound request — this is the guard working, not an outage",
  );
}

/**
 * Verify the database, install the egress guards, and say out loud what is
 * suppressed. Must be called before anything can open a socket or run a query.
 * Throws (fail closed) when isolation is enabled but DATABASE_URL is not the
 * approved development database.
 */
export function initializeDevIsolation(env: Env = process.env): void {
  if (initialised) return;
  if (!isIsolated(env)) {
    initialised = true;
    return;
  }

  logger.error(
    { mode: describeIsolation(env), pid: process.pid },
    "CARE_DEV_ISOLATED=1 — ISOLATED DEVELOPMENT MODE. Background consumers are disabled and outbound production integrations are blocked.",
  );

  const verdict = evaluateDatabaseUrl(env["DATABASE_URL"], env);
  if (!verdict.allowed) {
    // Loud and fatal: the whole point is that a restored .env that still points at
    // the clinic cannot boot "isolated" against the live database. `initialised` is
    // deliberately left false, so any later call fails closed the same way instead of
    // reporting that isolation had already been set up.
    throw new Error(`CARE_DEV_ISOLATED refuses to start: ${verdict.reason}`);
  }
  logger.info({ reason: verdict.reason }, "CARE_DEV_ISOLATED database check passed");

  restoreGuards = installDevIsolationEgressGuards(env, observeEgress);
  initialised = true;
}

/**
 * May this named boot side effect run? `step` must be registered in
 * `BLOCKED_STARTUP_STEPS`; an unregistered name throws, which is how a later
 * consumer is forced into the audit instead of silently opting out.
 *
 * Exported separately from `bootStep` for the cases that cannot be wrapped in a
 * callback — an async IIFE, or a call sequence whose intermediate state matters.
 */
export function mayRunStep(step: IsolatedStartupStep): boolean {
  const decision = decideStartupStep(step);
  if (decision.run) return true;
  logger.info({ step, why: decision.reason }, "CARE_DEV_ISOLATED skipped a startup side effect");
  return false;
}

/** Run a boot side effect unless isolation has suppressed it. */
export function bootStep(step: IsolatedStartupStep, run: () => void): void {
  if (mayRunStep(step)) run();
}

/** For `/health`-style surfaces: what this process believes about its own isolation. */
export function devIsolationStatus(env: Env = process.env) {
  return {
    enabled: isIsolated(env),
    description: describeIsolation(env),
    blockedEgress: blockedCount,
    allowedEgress: allowedCount,
  };
}

/** Test seam — put the process back the way it was. */
export function shutdownDevIsolation(): void {
  restoreGuards();
  restoreGuards = () => {};
  blockedCount = 0;
  allowedCount = 0;
  initialised = false;
}
