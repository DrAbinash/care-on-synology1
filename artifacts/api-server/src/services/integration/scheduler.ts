// ============================================================================
// Integration background workers (outbox dispatch + results reconcile).
// Self-contained so the large cron.ts is left untouched. Started from index.ts
// alongside startCronScheduler(), only when ENABLE_SCHEDULERS is set. Each tick
// is a no-op unless the ff_hope_care_referrals feature flag is enabled, so the
// integration is fully dark until deliberately turned on.
//
// On autoscale hosts (ENABLE_SCHEDULERS off) the same two functions are exposed
// through /api/internal/cron for external CRON_SECRET-authenticated triggering.
// ============================================================================
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db, featureFlagsTable } from "@workspace/db";
import { dispatchPendingOutbox } from "./outbox";
import { reconcileResults } from "./resultsEmitter";
import { reconcileStatuses } from "./statusReconciler";
import { escalateCriticalResults } from "./criticalEscalation";
import { pollElectronicFilmJobs } from "../electronicFilm/poller";
import { getElectronicFilmSettings } from "../electronicFilm/settings";

let flagCache: { value: boolean; at: number } | null = null;
export async function integrationEnabled(): Promise<boolean> {
  if (process.env["HOPE_CARE_INTEGRATION_FORCE"] === "1") return true;
  if (flagCache && Date.now() - flagCache.at < 60_000) return flagCache.value;
  try {
    const [f] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, "ff_hope_care_referrals")).limit(1);
    const value = !!f?.enabled;
    flagCache = { value, at: Date.now() };
    return value;
  } catch {
    return false;
  }
}

export async function tickOutbox(): Promise<void> {
  if (!(await integrationEnabled())) return;
  try {
    const r = await dispatchPendingOutbox({ limit: 50 });
    if (r.claimed) console.log("[integration] outbox dispatch", r);
  } catch (e) {
    console.error("[integration] outbox dispatch failed:", (e as Error)?.message);
  }
}

export async function tickReconcile(): Promise<void> {
  if (!(await integrationEnabled())) return;
  try {
    // Phase 2: advance per-item sample/study status first, then results.
    const s = await reconcileStatuses({ limit: 100 });
    if (s.sampleEvents || s.studyEvents) console.log("[integration] status reconcile", s);
    const r = await reconcileResults({ limit: 100 });
    if (r.emitted) console.log("[integration] results reconcile", r);
    // Phase 3: re-notify critical results HOPE has not acknowledged in time.
    const e2 = await escalateCriticalResults({ limit: 50 });
    if (e2.escalated) console.log("[integration] critical escalation", e2);
  } catch (e) {
    console.error("[integration] reconcile failed:", (e as Error)?.message);
  }
}

export async function tickElectronicFilmPoll(): Promise<void> {
  try {
    const settings = await getElectronicFilmSettings();
    if (!settings.integrationEnabled || !settings.autoImport) return;
    const r = await pollElectronicFilmJobs();
    if (r.discovered || r.imported || r.errors) console.log("[electronic-film] poll", r);
  } catch (e) {
    console.error("[electronic-film] poll failed:", (e as Error)?.message);
  }
}

let started = false;
export function startIntegrationScheduler(): void {
  if (started) return;
  started = true;
  cron.schedule("* * * * *", tickOutbox); // outbox dispatch — every minute
  cron.schedule("*/5 * * * *", tickReconcile); // results reconcile — every 5 min
  cron.schedule("*/2 * * * *", tickElectronicFilmPoll); // electronic film poll — every 2 min
  console.log("[integration] scheduler started (outbox dispatch + results reconcile + electronic film poll)");
}
