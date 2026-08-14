import { describe, expect, it, vi } from "vitest";
import { MASTER_FORMAT, stampMasterSnapshot } from "@workspace/emergency-billing";
import {
  emergencyStatusFromState,
  postMasterSnapshotHttp,
  probeEmergencyNas,
  runEmergencyMasterPush,
  type MasterPushDeps,
  type MasterPushLogRow,
} from "./emergencyMasterPush";

function sampleSnap() {
  return stampMasterSnapshot({
    syncedAt: "2026-08-14T11:35:00.000Z",
    services: [{ id: 1, code: "MRI-BR", name: "MRI Brain", category: "MRI", price: 4000, isActive: true }],
    doctors: [{ id: 2, name: "Dr Test", specialization: "Radiology" }],
    patients: [{
      id: 10, patientId: "P-00010", firstName: "Ravi", lastName: "Kumar",
      phone: "9876543210", gender: "male", dateOfBirth: null, ageValue: 42, ageUnit: "years",
    }],
    staff: [{
      id: 1, name: "Owner", username: "owner@test", role: "super_admin",
      pinHash: "hash", maxDiscount: 100, permissions: null,
    }],
    discountReasons: ["STAFF"],
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeDeps(over: Partial<MasterPushDeps> & { fetchImpl: typeof fetch }): MasterPushDeps & { logs: MasterPushLogRow[]; lastSuccess: Date | null } {
  const logs: MasterPushLogRow[] = [];
  let lastSuccess: Date | null = null;
  const deps: MasterPushDeps & { logs: MasterPushLogRow[]; lastSuccess: Date | null } = {
    logs,
    get lastSuccess() { return lastSuccess; },
    getConfig: async () => ({ baseUrl: "http://ds225.test", token: "tok" }),
    lastSuccessAt: async () => lastSuccess,
    buildSnapshot: async () => sampleSnap(),
    recordLog: async (row) => { logs.push(row); },
    markLastSuccess: async (at) => { lastSuccess = at; },
    tryLock: async () => true,
    intervalHours: 6,
    now: new Date("2026-08-14T12:00:00.000Z"),
    ...over,
  };
  return deps;
}

describe("probeEmergencyNas", () => {
  it("ONLINE when /health is 200", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    expect(await probeEmergencyNas("http://ds225.test", fetchImpl as unknown as typeof fetch)).toBe("ONLINE");
  });

  it("OFFLINE when DS225+ is unreachable", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    expect(await probeEmergencyNas("http://ds225.test", fetchImpl as unknown as typeof fetch)).toBe("OFFLINE");
  });

  it("OFFLINE when URL is empty", async () => {
    expect(await probeEmergencyNas("")).toBe("OFFLINE");
  });
});

describe("postMasterSnapshotHttp", () => {
  it("rejects an incompatible schema version from the NAS", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { error: "Unsupported master-data version 99" }));
    const r = await postMasterSnapshotHttp({
      baseUrl: "http://ds225.test",
      token: "tok",
      snapshot: sampleSnap(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/409/);
  });
});

describe("runEmergencyMasterPush", () => {
  it("manual push succeeds and records counts", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(true);
    if (r.ok && !("skipped" in r && r.skipped)) {
      expect(r.serviceCount).toBe(1);
      expect(r.doctorCount).toBe(1);
      expect(r.patientCount).toBe(1);
      expect(r.staffCount).toBe(1);
    }
    expect(deps.logs).toHaveLength(1);
    expect(deps.logs[0]!.success).toBe(true);
    expect(deps.logs[0]!.initiatedBy).toBe("MANUAL");
    expect(deps.lastSuccess).toEqual(new Date("2026-08-14T12:00:00.000Z"));
  });

  it("manual push fails safely and does not update last success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(502, { error: "down" }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(false);
    expect(deps.logs[0]!.success).toBe(false);
    expect(deps.lastSuccess).toBeNull();
  });

  it("repeated manual push is idempotent (two successes)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const a = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    const b = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(a.ok && b.ok).toBe(true);
    expect(deps.logs).toHaveLength(2);
    expect(deps.logs.every((l) => l.success)).toBe(true);
  });

  it("scheduled push after a recent manual push is skipped", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    const callsAfterManual = fetchImpl.mock.calls.length;
    const scheduled = await runEmergencyMasterPush(
      { initiatedBy: "SCHEDULER", userName: "scheduler", userId: null, respectInterval: true },
      deps,
    );
    expect(scheduled).toEqual({ ok: true, skipped: true, reason: "interval" });
    expect(fetchImpl).toHaveBeenCalledTimes(callsAfterManual);
  });

  it("DS225+ offline fails without updating last success", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ECONNREFUSED/);
    expect(deps.lastSuccess).toBeNull();
  });

  it("first-ever sync has no last success and still pushes", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await deps.lastSuccessAt()).toBeNull();
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(true);
  });

  it("incompatible schema version from NAS does not update last success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { error: `Unsupported format ${MASTER_FORMAT}` }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(false);
    expect(deps.lastSuccess).toBeNull();
  });

  it("duplicate scheduler invocation skips when the lock is held", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, tryLock: async () => false });
    const r = await runEmergencyMasterPush(
      { initiatedBy: "SCHEDULER", userName: "scheduler", userId: null, requireLock: true, respectInterval: true },
      deps,
    );
    expect(r).toEqual({ ok: true, skipped: true, reason: "lock" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses master push on contract mismatch without posting snapshot", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/capability") || url.includes("/api/health")) {
        return jsonResponse(200, {
          status: "ok",
          appVersion: "1.0.0",
          buildSha: "deadbeef",
          supportedMasterContractVersions: ["CARE_EMERGENCY_MASTER_V2"],
          supportedBillingCsvVersions: ["CARE_EMERGENCY_BILLING_V1"],
          supportedBillingJsonVersions: ["CARE_EMERGENCY_BILLING_JSON_V1"],
          databaseHealthy: true,
          masterSnapshotPresent: true,
          masterSnapshotCreatedAt: "2026-08-14T10:00:00.000Z",
        });
      }
      return jsonResponse(200, { ok: true });
    });
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/VERSION MISMATCH/);
    expect(deps.lastSuccess).toBeNull();
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/api/internal/master-sync"))).toBe(false);
  });

  it("posts master snapshot when capability advertises CARE_EMERGENCY_MASTER_V1", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/capability")) {
        return jsonResponse(200, {
          status: "ok",
          supportedMasterContractVersions: [MASTER_FORMAT],
          supportedBillingCsvVersions: ["CARE_EMERGENCY_BILLING_V1"],
          supportedBillingJsonVersions: ["CARE_EMERGENCY_BILLING_JSON_V1"],
          databaseHealthy: true,
          masterSnapshotPresent: true,
          masterSnapshotCreatedAt: "2026-08-14T10:00:00.000Z",
        });
      }
      return jsonResponse(200, { ok: true });
    });
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runEmergencyMasterPush({ initiatedBy: "MANUAL", userName: "Owner", userId: 1 }, deps);
    expect(r.ok).toBe(true);
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/api/internal/master-sync"))).toBe(true);
  });
});

describe("emergencyStatusFromState", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("first-ever sync is neverSynced", () => {
    const s = emergencyStatusFromState({
      configured: true,
      nasStatus: "ONLINE",
      lastSuccessfulPushAt: null,
      counts: null,
      lastFailure: null,
      now,
    });
    expect(s.neverSynced).toBe(true);
    expect(s.ageBand).toBe("never");
  });

  it("stale snapshot is a warning band, not a hard failure", () => {
    const s = emergencyStatusFromState({
      configured: true,
      nasStatus: "OFFLINE",
      lastSuccessfulPushAt: "2026-08-13T10:00:00.000Z",
      counts: { serviceCount: 428, doctorCount: 312, patientCount: 5000, staffCount: 18 },
      lastFailure: null,
      now,
    });
    expect(s.ageBand).toBe("stale");
    expect(s.neverSynced).toBe(false);
    expect(s.counts?.serviceCount).toBe(428);
  });

  it("marks 225app offline as UNAVAILABLE contract (not a silent match)", () => {
    const s = emergencyStatusFromState({
      configured: true,
      nasStatus: "OFFLINE",
      lastSuccessfulPushAt: "2026-08-14T10:00:00.000Z",
      counts: null,
      lastFailure: null,
      now,
    });
    expect(s.nasStatus).toBe("OFFLINE");
    expect(s.contract.status).toBe("UNAVAILABLE");
  });

  it("surfaces compatible contract from capability", () => {
    const s = emergencyStatusFromState({
      configured: true,
      nasStatus: "ONLINE",
      lastSuccessfulPushAt: "2026-08-14T10:00:00.000Z",
      counts: null,
      lastFailure: null,
      now,
      capability: {
        status: "ok",
        appVersion: "1.0.0",
        buildSha: "abc123",
        supportedMasterContractVersions: [MASTER_FORMAT],
        supportedBillingCsvVersions: ["CARE_EMERGENCY_BILLING_V1"],
        supportedBillingJsonVersions: ["CARE_EMERGENCY_BILLING_JSON_V1"],
        databaseHealthy: true,
        masterSnapshotPresent: true,
        masterSnapshotCreatedAt: "2026-08-14T10:00:00.000Z",
      },
    });
    expect(s.contract.status).toBe("COMPATIBLE");
    expect(s.app225.buildSha).toBe("abc123");
  });
});
