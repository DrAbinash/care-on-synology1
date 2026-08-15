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
      // PostgreSQL 17 pg_stat_checkpointer — no checkpoint_time; write_time/sync_time already ms.
      if (String(sql).includes("pg_stat_checkpointer")) {
        expect(String(sql)).toContain("num_timed");
        expect(String(sql)).toContain("stats_reset");
        expect(String(sql)).not.toContain("checkpoint_time");
        return {
          rows: [{
            num_timed: 12,
            num_requested: 3,
            write_time: 4514.2,
            sync_time: 2.0,
            stats_reset: new Date("2026-08-15T08:00:00Z"),
          }],
        };
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

import {
  applyCheckpointerRow,
  buildBillingPerformanceSnapshot,
  formatBillingPerformanceSnapshotText,
  resetCheckpointerSampleForTests,
} from "./billingPerformanceSnapshot";

describe("pg_stat_checkpointer PG17 units", () => {
  beforeEach(() => {
    resetCheckpointerSampleForTests();
  });

  test("treats write_time/sync_time as cumulative milliseconds (no ×1000)", () => {
    const first = applyCheckpointerRow(
      {
        num_timed: 12,
        num_requested: 3,
        write_time: 4514.2,
        sync_time: 2,
        stats_reset: "2026-08-15T08:00:00.000Z",
      },
      1_000_000,
    );
    expect(first.available).toBe(true);
    expect(first.cumulativeWriteTimeMs).toBe(4514);
    expect(first.cumulativeSyncTimeMs).toBe(2);
    expect(first.numTimed).toBe(12);
    expect(first.numRequested).toBe(3);
    expect(first.statsResetAt).toBe("2026-08-15T08:00:00.000Z");
    expect(first.sinceLastSample).toBeNull();

    const second = applyCheckpointerRow(
      {
        num_timed: 13,
        num_requested: 3,
        write_time: 4800,
        sync_time: 5,
        stats_reset: "2026-08-15T08:00:00.000Z",
      },
      1_000_000 + 45_000,
    );
    expect(second.sinceLastSample).toEqual({
      sampleIntervalMs: 45_000,
      writeTimeDeltaMs: 286,
      syncTimeDeltaMs: 3,
      numTimedDelta: 1,
      numRequestedDelta: 0,
    });
  });

  test("does not invent last-checkpoint duration fields", () => {
    const row = applyCheckpointerRow({
      num_timed: 1,
      num_requested: 0,
      write_time: 100,
      sync_time: 10,
      stats_reset: null,
    });
    expect(row).not.toHaveProperty("lastCheckpointAt");
    expect(row).not.toHaveProperty("checkpointWriteTimeMs");
  });
});

describe("billingPerformanceSnapshot", () => {
  beforeEach(() => {
    resetCheckpointerSampleForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 }) as Response),
    );
  });

  test("builds PHI-free snapshot with honest checkpointer fields", async () => {
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

    expect(snap.postgres.checkpointer.available).toBe(true);
    expect(snap.postgres.checkpointer.cumulativeWriteTimeMs).toBe(4514);
    expect(snap.postgres.checkpointer.cumulativeSyncTimeMs).toBe(2);
    expect(snap.postgres.checkpointer.numTimed).toBe(12);
    expect(snap.postgres.checkpointer.numRequested).toBe(3);
    expect(snap.postgres).not.toHaveProperty("lastCheckpointAt");
    expect(snap.postgres).not.toHaveProperty("checkpointWriteTimeMs");

    const text = formatBillingPerformanceSnapshotText(snap);
    expect(text).toContain("billingLane: AMBER");
    expect(text).toContain("pg_stat_checkpointer cumulative");
    expect(text).toContain("write_ms=4514");
    expect(text).not.toMatch(/last checkpoint duration/i);
    expect(text).not.toMatch(/SECRET PATIENT/);
    expect(text).toContain("PHI note");
  });
});
