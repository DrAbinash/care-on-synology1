/**
 * billingPerformanceSnapshot.ts — PHI-free Clinic Peak / Billing Lane monitor.
 *
 * Observability only: composes existing in-memory requestMetrics, pool
 * counters, peak-hours helpers, MRI warmer status (sans study list), USG
 * pipeline flag, and a few cheap SHOW/SELECT probes. Never writes per-request
 * DB rows. Never includes patient names, phones, study UIDs, or report text.
 */

import { pool, db } from "@workspace/db";
import { dicomPullJobsTable } from "@workspace/db/schema";
import { inArray, desc, eq } from "drizzle-orm";
import {
  getLatencyForMatcher,
  getRequestsPerMinute,
  getSlowEndpointsInWindow,
  getSlowThresholdMs,
  isBillSavePath,
  isPatientSearchPath,
  type LatencySummary,
} from "./requestMetrics";
import { clinicPeakHoursLabel, clinicPeakWindowMinutes, isClinicPeakHours } from "./clinicPeakHours";
import { getMriWarmCacheStatus } from "./pacs/mriStudyWarmer";
import { isUsgErpPipelineEnabled } from "./usgExtractor";
import { redisIsHealthy } from "./redisClient";
import { recentOpsRuns } from "./operationsHistory";

export type BillingLaneTone = "GREEN" | "AMBER" | "RED";

export type BillingPerformanceSnapshot = {
  generatedAt: string;
  refreshHintSec: number;
  billingLane: {
    tone: BillingLaneTone;
    reason: string;
  };
  peakMode: {
    active: boolean;
    windowLabel: string;
    startMinutes: number;
    endMinutes: number;
  };
  latency: {
    windowMinutes: number;
    slowThresholdMs: number;
    billSave: LatencySummary;
    patientSearch: LatencySummary;
    requestsPerMinute: number;
  };
  last15m: {
    slowBillSaveCount: number;
    slowPatientSearchCount: number;
    slowEndpoints: Array<{
      method: string;
      path: string;
      count: number;
      slowCount: number;
      p95Ms: number | null;
      maxMs: number | null;
    }>;
    dbPoolWaiting: number | null;
    checkpointWriteTimeMs: number | null;
    background: {
      mriWarmRunning: boolean;
      mriPausedForPeak: boolean;
      dicomPausedForPeak: boolean;
      usgPipelineEnabled: boolean;
    };
  };
  dbPool: { total: number; idle: number; waiting: number } | null;
  postgres: {
    ok: boolean;
    message: string;
    sharedBuffers: string | null;
    maxWalSize: string | null;
    checkpointTimeout: string | null;
    synchronousCommit: string | null;
    lastCheckpointAt: string | null;
    checkpointWriteTimeMs: number | null;
    checkpointSyncTimeMs: number | null;
  };
  redis: {
    connected: boolean;
    cacheHits: number | null;
    cacheMisses: number | null;
    note: string;
  };
  mriWarmCache: {
    enabled: boolean;
    running: boolean;
    pausedForPeakHours: boolean;
    state: "running" | "paused-for-peak-hours" | "idle" | "disabled";
    lastRunAt: string | null;
    lastError: string | null;
    orthancReachable: boolean | null;
  };
  dicomAutoPull: {
    pausedForPeakHours: boolean;
    state: "paused-for-peak-hours" | "active-off-peak" | "unknown";
    pendingOrRunningJobs: number | null;
    lastCompletedAt: string | null;
  };
  usgErpPipeline: {
    enabled: boolean;
    note: string;
  };
  services: {
    careApi: { ok: boolean; message: string };
    careDb: { ok: boolean; message: string };
    careWeb: { ok: boolean; message: string };
    orthanc: { ok: boolean | null; message: string };
    icici: { ok: boolean | null; message: string };
  };
};

function poolStats(): { total: number; idle: number; waiting: number } {
  const p = pool as unknown as { totalCount?: number; idleCount?: number; waitingCount?: number };
  return { total: p.totalCount ?? 0, idle: p.idleCount ?? 0, waiting: p.waitingCount ?? 0 };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readPostgresHealth(): Promise<BillingPerformanceSnapshot["postgres"]> {
  const empty = {
    ok: false,
    message: "unavailable",
    sharedBuffers: null as string | null,
    maxWalSize: null as string | null,
    checkpointTimeout: null as string | null,
    synchronousCommit: null as string | null,
    lastCheckpointAt: null as string | null,
    checkpointWriteTimeMs: null as number | null,
    checkpointSyncTimeMs: null as number | null,
  };
  try {
    await pool.query("SELECT 1");
    const settings = await pool.query<{ name: string; setting: string; unit: string | null }>(
      `SELECT name, setting, unit FROM pg_settings
       WHERE name = ANY($1)`,
      [["shared_buffers", "max_wal_size", "checkpoint_timeout", "synchronous_commit"]],
    );
    const map = new Map(settings.rows.map((r) => [r.name, r]));
    const fmt = (name: string): string | null => {
      const row = map.get(name);
      if (!row) return null;
      return row.unit ? `${row.setting}${row.unit}` : row.setting;
    };

    let lastCheckpointAt: string | null = null;
    let checkpointWriteTimeMs: number | null = null;
    let checkpointSyncTimeMs: number | null = null;
    try {
      const cp = await pool.query<{
        checkpoint_time?: Date | string | null;
        write_time?: string | number | null;
        sync_time?: string | number | null;
      }>(
        `SELECT checkpoint_time, write_time, sync_time FROM pg_stat_checkpointer`,
      );
      const row = cp.rows[0];
      if (row?.checkpoint_time) {
        lastCheckpointAt = new Date(row.checkpoint_time).toISOString();
      }
      // write_time / sync_time are seconds (double) in pg_stat_checkpointer
      if (row?.write_time != null) checkpointWriteTimeMs = Math.round(Number(row.write_time) * 1000);
      if (row?.sync_time != null) checkpointSyncTimeMs = Math.round(Number(row.sync_time) * 1000);
    } catch {
      // Older Postgres without pg_stat_checkpointer — leave nulls.
    }

    return {
      ok: true,
      message: "connected",
      sharedBuffers: fmt("shared_buffers"),
      maxWalSize: fmt("max_wal_size"),
      checkpointTimeout: fmt("checkpoint_timeout"),
      synchronousCommit: fmt("synchronous_commit"),
      lastCheckpointAt,
      checkpointWriteTimeMs,
      checkpointSyncTimeMs,
    };
  } catch (err) {
    return {
      ...empty,
      message: err instanceof Error ? err.message.slice(0, 120) : "query failed",
    };
  }
}

async function probeOrthanc(): Promise<{ ok: boolean | null; message: string }> {
  const raw = process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "";
  if (!raw.trim()) return { ok: null, message: "ORTHANC_URL not configured" };
  const base = raw.replace(/\/+$/, "");
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (user) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  try {
    const res = await withTimeout(
      fetch(`${base}/system`, { headers, signal: AbortSignal.timeout(2000) }),
      2200,
      null as Response | null,
    );
    if (!res) return { ok: false, message: "timeout" };
    return res.ok
      ? { ok: true, message: `reachable (${res.status})` }
      : { ok: false, message: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message.slice(0, 80) : "unreachable" };
  }
}

async function dicomPullSnapshot(peak: boolean): Promise<BillingPerformanceSnapshot["dicomAutoPull"]> {
  const base = {
    pausedForPeakHours: peak,
    state: (peak ? "paused-for-peak-hours" : "active-off-peak") as BillingPerformanceSnapshot["dicomAutoPull"]["state"],
    pendingOrRunningJobs: null as number | null,
    lastCompletedAt: null as string | null,
  };
  try {
    const pending = await db
      .select({ id: dicomPullJobsTable.id })
      .from(dicomPullJobsTable)
      .where(inArray(dicomPullJobsTable.status, ["pending", "running"]))
      .limit(200);
    base.pendingOrRunningJobs = pending.length;
    const [last] = await db
      .select({ completedAt: dicomPullJobsTable.completedAt })
      .from(dicomPullJobsTable)
      .where(eq(dicomPullJobsTable.status, "completed"))
      .orderBy(desc(dicomPullJobsTable.id))
      .limit(1);
    if (last?.completedAt) base.lastCompletedAt = new Date(last.completedAt).toISOString();
  } catch {
    base.state = "unknown";
  }
  return base;
}

async function iciciFromLastOps(): Promise<{ ok: boolean | null; message: string }> {
  const merchant = (process.env.ICICI_MERCHANT_ID || "").trim();
  const secret = (process.env.ICICI_SECRET_KEY || "").trim();
  if (!merchant || !secret) {
    return { ok: null, message: "credentials not set in env (optional)" };
  }
  try {
    const runs = await recentOpsRuns(1);
    const checks = (runs[0]?.checksJson as Array<{ id?: string; status?: string; message?: string }> | null) ?? null;
    const icici = Array.isArray(checks) ? checks.find((c) => c.id === "integ.icici_orange") : null;
    if (icici?.status) {
      return {
        ok: icici.status === "PASS" ? true : icici.status === "FAIL" ? false : null,
        message: `last smoke: ${icici.status}${icici.message ? ` — ${String(icici.message).slice(0, 80)}` : ""}`,
      };
    }
  } catch {
    // ignore — history table may be empty
  }
  return { ok: null, message: "configured (no recent ops smoke sample; not probing bank from this dashboard)" };
}

function mriState(status: ReturnType<typeof getMriWarmCacheStatus>): BillingPerformanceSnapshot["mriWarmCache"]["state"] {
  if (!status.enabled) return "disabled";
  if (status.pausedForPeakHours) return "paused-for-peak-hours";
  if (status.running) return "running";
  return "idle";
}

function computeLane(input: {
  dbOk: boolean;
  poolWaiting: number;
  bill: LatencySummary;
  orthancOk: boolean | null;
}): { tone: BillingLaneTone; reason: string } {
  if (!input.dbOk) return { tone: "RED", reason: "PostgreSQL unavailable" };
  if (input.poolWaiting >= 8) return { tone: "RED", reason: `DB pool exhaustion (waiting=${input.poolWaiting})` };
  if (input.bill.count >= 3 && (input.bill.p95Ms ?? 0) >= 5000) {
    return { tone: "RED", reason: `Sustained slow bill save (p95=${input.bill.p95Ms}ms)` };
  }
  if (input.bill.slowCount >= 5) {
    return { tone: "RED", reason: `${input.bill.slowCount} slow bill saves in window` };
  }
  if (input.poolWaiting > 0) return { tone: "AMBER", reason: `DB pool pressure (waiting=${input.poolWaiting})` };
  if ((input.bill.p95Ms ?? 0) >= 1500 && input.bill.count >= 2) {
    return { tone: "AMBER", reason: `Elevated bill-save p95 (${input.bill.p95Ms}ms)` };
  }
  if (input.orthancOk === false) {
    return { tone: "AMBER", reason: "Orthanc unreachable (billing may still work; PACS degraded)" };
  }
  return { tone: "GREEN", reason: "Billing / API / DB healthy; no abnormal queue wait" };
}

export async function buildBillingPerformanceSnapshot(): Promise<BillingPerformanceSnapshot> {
  const now = Date.now();
  const windowMs = 15 * 60_000;
  const peak = isClinicPeakHours(new Date(now));
  const peakWindow = clinicPeakWindowMinutes();
  const slowThresholdMs = getSlowThresholdMs();

  const billSave = getLatencyForMatcher(isBillSavePath, windowMs, now);
  const patientSearch = getLatencyForMatcher(isPatientSearchPath, windowMs, now);
  const slowEndpoints = getSlowEndpointsInWindow(windowMs, 8, now);
  const requestsPerMinute = getRequestsPerMinute(now);
  const pool = poolStats();

  const mriRaw = getMriWarmCacheStatus();
  // Strip PHI: never return recent[] (has patientName / studyInstanceUID).
  const mriWarmCache = {
    enabled: mriRaw.enabled,
    running: mriRaw.running,
    pausedForPeakHours: mriRaw.pausedForPeakHours,
    state: mriState(mriRaw),
    lastRunAt: mriRaw.lastRunAt,
    lastError: mriRaw.lastError,
    orthancReachable: mriRaw.orthancReachable,
  };

  const [postgres, redisOk, usgEnabled, dicom, orthanc, icici] = await Promise.all([
    readPostgresHealth(),
    redisIsHealthy().catch(() => false),
    isUsgErpPipelineEnabled().catch(() => true),
    dicomPullSnapshot(peak),
    probeOrthanc(),
    iciciFromLastOps(),
  ]);

  const lane = computeLane({
    dbOk: postgres.ok,
    poolWaiting: pool.waiting,
    bill: billSave,
    orthancOk: orthanc.ok,
  });

  return {
    generatedAt: new Date(now).toISOString(),
    refreshHintSec: 45,
    billingLane: lane,
    peakMode: {
      active: peak,
      windowLabel: clinicPeakHoursLabel(),
      startMinutes: peakWindow.start,
      endMinutes: peakWindow.end,
    },
    latency: {
      windowMinutes: 15,
      slowThresholdMs,
      billSave,
      patientSearch,
      requestsPerMinute,
    },
    last15m: {
      slowBillSaveCount: billSave.slowCount,
      slowPatientSearchCount: patientSearch.slowCount,
      slowEndpoints,
      dbPoolWaiting: pool.waiting,
      checkpointWriteTimeMs: postgres.checkpointWriteTimeMs,
      background: {
        mriWarmRunning: mriRaw.running,
        mriPausedForPeak: mriRaw.pausedForPeakHours,
        dicomPausedForPeak: peak,
        usgPipelineEnabled: usgEnabled,
      },
    },
    dbPool: pool,
    postgres,
    redis: {
      connected: redisOk,
      cacheHits: null,
      cacheMisses: null,
      note: redisOk
        ? "Connected (hit/miss counters not instrumented — health only)"
        : "Disconnected or unconfigured — ERP continues without Redis",
    },
    mriWarmCache,
    dicomAutoPull: dicom,
    usgErpPipeline: {
      enabled: usgEnabled,
      note: "Machine C-STORE to Orthanc is independent of this ERP pipeline switch.",
    },
    services: {
      careApi: { ok: true, message: "this process responding" },
      careDb: { ok: postgres.ok, message: postgres.message },
      careWeb: { ok: true, message: "served by care-web / Vite separately; API snapshot does not probe SPA" },
      orthanc,
      icici,
    },
  };
}

/** Plain-text, PHI-free summary for clipboard / Cursor troubleshooting. */
export function formatBillingPerformanceSnapshotText(s: BillingPerformanceSnapshot): string {
  const L = s.latency;
  const lines = [
    `CARE Billing Performance Snapshot`,
    `generatedAt: ${s.generatedAt}`,
    `billingLane: ${s.billingLane.tone} — ${s.billingLane.reason}`,
    `peakMode: ${s.peakMode.active ? "ACTIVE" : "INACTIVE"} (${s.peakMode.windowLabel})`,
    ``,
    `Bill save (${L.windowMinutes}m): count=${L.billSave.count} slow=${L.billSave.slowCount} p50=${L.billSave.p50Ms ?? "-"} p95=${L.billSave.p95Ms ?? "-"} max=${L.billSave.maxMs ?? "-"} (threshold ${L.slowThresholdMs}ms)`,
    `Patient search (${L.windowMinutes}m): count=${L.patientSearch.count} slow=${L.patientSearch.slowCount} p50=${L.patientSearch.p50Ms ?? "-"} p95=${L.patientSearch.p95Ms ?? "-"} max=${L.patientSearch.maxMs ?? "-"}`,
    `API requests/min: ${L.requestsPerMinute}`,
    ``,
    `DB pool: total=${s.dbPool?.total ?? "-"} idle=${s.dbPool?.idle ?? "-"} waiting=${s.dbPool?.waiting ?? "-"}`,
    `Postgres: ok=${s.postgres.ok} shared_buffers=${s.postgres.sharedBuffers ?? "-"} max_wal_size=${s.postgres.maxWalSize ?? "-"} checkpoint_timeout=${s.postgres.checkpointTimeout ?? "-"} synchronous_commit=${s.postgres.synchronousCommit ?? "-"}`,
    `Checkpoint: last=${s.postgres.lastCheckpointAt ?? "-"} writeMs=${s.postgres.checkpointWriteTimeMs ?? "-"} syncMs=${s.postgres.checkpointSyncTimeMs ?? "-"}`,
    `Redis: ${s.redis.connected ? "connected" : "disconnected"} (${s.redis.note})`,
    ``,
    `MRI warm-cache: ${s.mriWarmCache.state} lastRun=${s.mriWarmCache.lastRunAt ?? "-"} lastError=${s.mriWarmCache.lastError ?? "none"}`,
    `DICOM auto-pull: ${s.dicomAutoPull.state} queue=${s.dicomAutoPull.pendingOrRunningJobs ?? "-"} lastCompleted=${s.dicomAutoPull.lastCompletedAt ?? "-"}`,
    `USG ERP pipeline: ${s.usgErpPipeline.enabled ? "enabled" : "paused"} — ${s.usgErpPipeline.note}`,
    `Orthanc: ${s.services.orthanc.ok === null ? "n/a" : s.services.orthanc.ok ? "ok" : "down"} (${s.services.orthanc.message})`,
    `ICICI: ${s.services.icici.ok === null ? "n/a" : s.services.icici.ok ? "ok" : "fail"} (${s.services.icici.message})`,
    ``,
    `Last 15m slow endpoints:`,
    ...(s.last15m.slowEndpoints.length
      ? s.last15m.slowEndpoints.map(
          (e) => `  ${e.method} ${e.path} count=${e.count} slow=${e.slowCount} p95=${e.p95Ms ?? "-"} max=${e.maxMs ?? "-"}`,
        )
      : ["  (none)"]),
    ``,
    `PHI note: this snapshot contains no patient names, phones, study IDs, or report text.`,
  ];
  return lines.join("\n");
}
