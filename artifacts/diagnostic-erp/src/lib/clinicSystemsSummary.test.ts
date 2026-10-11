import { describe, expect, it } from "vitest";
import {
  buildClinicSystemsSummary,
  buildDs225PulsePill,
  type EmergencyStatusLike,
} from "./clinicSystemsSummary";

const healthyChecks = [
  { id: "app.responding", status: "PASS" as const, message: "API up" },
  { id: "db.connect", status: "PASS" as const, message: "DB ok" },
  { id: "backup.age", status: "PASS" as const, message: "latest backup 2h ago" },
  { id: "orthanc.reachable", status: "PASS" as const, message: "Orthanc up" },
  { id: "ai.ollama", status: "PASS" as const, message: "Ollama up" },
  { id: "integ.ocr_worker", status: "PASS" as const, message: "OCR up" },
  { id: "backup.restore_verified", status: "PASS" as const, message: "verified" },
  { id: "integ.icici_orange", status: "PASS" as const, message: "ICICI configured" },
];

function healthyEmergency(over: Partial<EmergencyStatusLike> = {}): EmergencyStatusLike {
  return {
    nasStatus: "ONLINE",
    configured: true,
    neverSynced: false,
    lastSuccessfulPushAt: "2026-08-14T10:00:00.000Z",
    snapshotAgeHours: 2,
    ageBand: "fresh",
    contract: {
      status: "COMPATIBLE",
      careExpected: "CARE_EMERGENCY_MASTER_V1",
      remoteSupported: ["CARE_EMERGENCY_MASTER_V1"],
      remotePrimary: "CARE_EMERGENCY_MASTER_V1",
    },
    pendingEmergencyBills: 0,
    openEmergencySessions: 0,
    failedImportCount24h: 0,
    ...over,
  };
}

describe("clinicSystemsSummary", () => {
  it("daily summary healthy idle state has no alerts", () => {
    const s = buildClinicSystemsSummary({ checks: healthyChecks, emergency: healthyEmergency() });
    expect(s.degraded).toBe(false);
    expect(s.alerts).toEqual([]);
    expect(s.sections.map((x) => x.title)).toEqual([
      "CARE / Core",
      "Emergency DS225+",
      "DR / Backup",
      "Supporting Systems",
    ]);
    const ds225 = s.sections.find((x) => x.title === "Emergency DS225+")?.rows;
    expect(ds225?.find((r) => r.key === "ds225")?.value).toBe("✓ ONLINE");
    expect(ds225?.find((r) => r.key === "contract")?.value).toBe("✓ COMPATIBLE");
    expect(ds225?.find((r) => r.key === "pending")?.value).toBe("0");
    expect(ds225?.find((r) => r.key === "open")?.value).toBe("0");
    const dr = s.sections.find((x) => x.title === "DR / Backup")?.rows;
    expect(dr?.find((r) => r.key === "pg-care")?.value).toBe("✓ latest");
    expect(dr?.find((r) => r.key === "hyper")?.value).toBe("status unavailable");
    expect(dr?.find((r) => r.key === "pg-hope")?.value).toBe("status unavailable");
    const supporting = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    // Healthy ICICI / Orange Pay uses semantic GREEN — not orange branding.
    expect(supporting?.find((r) => r.key === "icici")?.tone).toBe("green");
    expect(supporting?.find((r) => r.key === "icici")?.value).toBe("✓ ONLINE");
  });

  it("225app offline is a prominent degraded alert", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ nasStatus: "OFFLINE", contract: { status: "UNAVAILABLE", careExpected: "CARE_EMERGENCY_MASTER_V1", remoteSupported: [], remotePrimary: null } }),
    });
    expect(s.degraded).toBe(true);
    expect(s.alerts.some((a) => a.id === "emg-offline")).toBe(true);
    expect(s.sections.flatMap((x) => x.rows).find((r) => r.key === "ds225")?.value).toBe("OFFLINE");
  });

  it("no initial snapshot is flagged", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ neverSynced: true, lastSuccessfulPushAt: null, snapshotAgeHours: null, ageBand: "never" }),
    });
    expect(s.alerts.some((a) => a.id === "emg-never")).toBe(true);
  });

  it("stale >24h snapshot is flagged without treating idle zeros as noise", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ snapshotAgeHours: 30, ageBand: "stale" }),
    });
    expect(s.alerts.map((a) => a.id)).toEqual(["emg-stale"]);
  });

  it("pending emergency bills are surfaced", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ pendingEmergencyBills: 3 }),
    });
    expect(s.alerts.some((a) => a.message.includes("3 unreconciled"))).toBe(true);
    expect(s.sections.flatMap((x) => x.rows).find((r) => r.key === "pending")?.value).toBe("3");
  });

  it("open emergency session is surfaced", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ openEmergencySessions: 1 }),
    });
    expect(s.alerts.some((a) => a.id === "emg-open")).toBe(true);
    expect(s.sections.flatMap((x) => x.rows).find((r) => r.key === "open")?.value).toBe("1");
  });

  it("contract mismatch degrades the daily summary", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({
        contract: {
          status: "MISMATCH",
          careExpected: "CARE_EMERGENCY_MASTER_V1",
          remoteSupported: ["CARE_EMERGENCY_MASTER_V2"],
          remotePrimary: "CARE_EMERGENCY_MASTER_V2",
        },
      }),
    });
    expect(s.degraded).toBe(true);
    expect(s.alerts.some((a) => a.id === "emg-mismatch")).toBe(true);
  });

  it("unconfigured emergency system stays quiet", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ configured: false }),
    });
    expect(s.alerts).toEqual([]);
    expect(s.degraded).toBe(false);
  });

  it("DS225 ribbon pill uses existing emergency status without inventing APIs", () => {
    expect(buildDs225PulsePill(null).tone).toBe("grey");
    expect(buildDs225PulsePill(healthyEmergency()).tone).toBe("green");
    expect(buildDs225PulsePill(healthyEmergency({ nasStatus: "OFFLINE" })).tone).toBe("red");
  });

  it("Orthanc → ERP shows the delivered count and the last sync age when healthy", () => {
    const s = buildClinicSystemsSummary({
      checks: [
        ...healthyChecks,
        { id: "orthanc.sync_divergence", status: "PASS" as const, message: "all 7 studies due are in the ERP worklist", metadata: { due: 7, missing: 0 } },
        { id: "orthanc.sync_fresh", status: "PASS" as const, message: "last Orthanc delivery 12 min ago", metadata: { ageMinutes: 12 } },
      ],
      emergency: healthyEmergency(),
    });
    const supporting = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    expect(supporting?.find((r) => r.key === "sync-delivery")).toMatchObject({ label: "Orthanc → ERP", tone: "green", value: "✓ 7 delivered" });
    expect(supporting?.find((r) => r.key === "sync-fresh")).toMatchObject({ label: "Last Orthanc sync", tone: "green", value: "12m ago" });
    expect(s.alerts).toEqual([]);
  });

  it("undelivered studies raise a red row and an alert that does NOT point at emergency billing", () => {
    const s = buildClinicSystemsSummary({
      checks: [
        ...healthyChecks,
        { id: "orthanc.sync_divergence", status: "FAIL" as const, message: "3 of 9 Orthanc studies due never reached the ERP worklist", metadata: { due: 9, missing: 3 } },
        { id: "orthanc.sync_fresh", status: "WARNING" as const, message: "no Orthanc delivery for 40h", metadata: { ageMinutes: 2400 } },
      ],
      emergency: healthyEmergency(),
    });
    const rows = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    expect(rows?.find((r) => r.key === "sync-delivery")).toMatchObject({ tone: "red", value: "3 NOT DELIVERED" });
    expect(rows?.find((r) => r.key === "sync-fresh")?.value).toBe("40h ago");
    const alert = s.alerts.find((a) => a.id === "pacs-not-delivering");
    expect(alert?.severity).toBe("red");
    expect(alert?.message).toBe("3 studies in Orthanc have not reached the ERP");
    expect(alert?.detailsHref).toBe("/radiology/operational-health");
    expect(s.degraded).toBe(true);
  });

  it("emergency alerts keep their emergency-billing link", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ nasStatus: "OFFLINE" }),
    });
    expect(s.alerts.find((a) => a.id === "emg-offline")?.detailsHref).toBeUndefined();
  });

  it("no Orthanc checks at all → grey rows, never a green all-clear", () => {
    const s = buildClinicSystemsSummary({ checks: healthyChecks, emergency: healthyEmergency() });
    const rows = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    expect(rows?.find((r) => r.key === "sync-delivery")?.tone).toBe("grey");
    expect(rows?.find((r) => r.key === "sync-fresh")?.tone).toBe("grey");
  });
});
