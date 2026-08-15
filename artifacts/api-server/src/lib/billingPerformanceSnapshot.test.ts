import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => {
  const pool = {
    totalCount: 4,
    idleCount: 3,
    waitingCount: 0,
    query: vi.fn(async (sql: string) => {
      if (String(sql).includes("pg_settings")) {
        return {
          rows: [
            { name: "shared_buffers", setting: "128", unit: "MB" },
            { name: "max_wal_size", setting: "2", unit: "GB" },
            { name: "checkpoint_timeout", setting: "15", unit: "min" },
            { name: "synchronous_commit", setting: "on", unit: null },
          ],
        };
      }
      if (String(sql).includes("pg_stat_checkpointer")) {
        return { rows: [{ checkpoint_time: new Date("2026-08-15T10:00:00Z"), write_time: 1.5, sync_time: 0.2 }] };
      }
      return { rows: [{ ok: 1 }] };
    }),
  };
  return {
    pool,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
            orderBy: () => ({ limit: async () => [] }),
          }),
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    },
  };
});

vi.mock("./redisClient", () => ({
  redisIsHealthy: vi.fn(async () => false),
}));

vi.mock("./usgExtractor", () => ({
  isUsgErpPipelineEnabled: vi.fn(async () => false),
}));

vi.mock("./pacs/mriStudyWarmer", () => ({
  getMriWarmCacheStatus: vi.fn(() => ({
    enabled: true,
    mode: "last_n",
    lastN: 20,
    running: false,
    lastRunAt: "2026-08-15T09:00:00.000Z",
    lastDurationMs: 100,
    lastWarmed: 2,
    lastFailed: 0,
    lastSkipped: 0,
    lastError: null,
    candidates: 2,
    orthancReachable: true,
    pausedForPeakHours: true,
    recent: [
      { studyInstanceUID: "1.2.3", patientName: "SECRET PATIENT", modality: "MR", ok: true, series: 1, previews: 0 },
    ],
  })),
}));

vi.mock("./clinicPeakHours", () => ({
  isClinicPeakHours: () => true,
  clinicPeakHoursLabel: () => "08:00–16:00 IST",
  clinicPeakWindowMinutes: () => ({ start: 480, end: 960 }),
}));

vi.mock("./operationsHistory", () => ({
  recentOpsRuns: vi.fn(async () => []),
}));

vi.mock("./requestMetrics", async () => {
  const actual = await vi.importActual<typeof import("./requestMetrics")>("./requestMetrics");
  return {
    ...actual,
    getLatencyForMatcher: () => ({
      count: 4,
      slowCount: 1,
      p50Ms: 200,
      p95Ms: 1600,
      maxMs: 1600,
      avgMs: 500,
    }),
    getRequestsPerMinute: () => 12,
    getSlowEndpointsInWindow: () => [
      { method: "POST", path: "/bills", count: 4, slowCount: 1, p95Ms: 1600, maxMs: 1600 },
    ],
    getSlowThresholdMs: () => 1000,
    isBillSavePath: actual.isBillSavePath,
    isPatientSearchPath: actual.isPatientSearchPath,
  };
});

import { buildBillingPerformanceSnapshot, formatBillingPerformanceSnapshotText } from "./billingPerformanceSnapshot";

describe("billingPerformanceSnapshot", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 }) as Response),
    );
  });

  test("builds PHI-free snapshot and survives Redis down", async () => {
    const snap = await buildBillingPerformanceSnapshot();
    expect(snap.billingLane.tone).toBe("AMBER");
    expect(snap.peakMode.active).toBe(true);
    expect(snap.redis.connected).toBe(false);
    expect(snap.usgErpPipeline.enabled).toBe(false);
    expect(snap.usgErpPipeline.note).toMatch(/C-STORE/i);
    expect(snap.mriWarmCache.state).toBe("paused-for-peak-hours");
    expect(JSON.stringify(snap)).not.toMatch(/SECRET PATIENT/);
    expect(JSON.stringify(snap)).not.toMatch(/1\.2\.3/);
    expect((snap as { mriWarmCache: { recent?: unknown } }).mriWarmCache.recent).toBeUndefined();

    const text = formatBillingPerformanceSnapshotText(snap);
    expect(text).toContain("billingLane: AMBER");
    expect(text).not.toMatch(/SECRET PATIENT/);
    expect(text).toContain("PHI note");
  });
});
