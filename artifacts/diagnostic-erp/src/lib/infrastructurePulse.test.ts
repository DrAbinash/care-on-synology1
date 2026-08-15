import { describe, it, expect } from "vitest";
import { buildInfrastructurePulse, toneFromStatuses } from "./infrastructurePulse";

describe("infrastructurePulse", () => {
  it("maps FAIL to red tone", () => {
    expect(toneFromStatuses(["PASS", "FAIL"])).toBe("red");
  });

  it("maps WARNING to amber", () => {
    expect(toneFromStatuses(["PASS", "WARNING"])).toBe("amber");
  });

  it("maps all SKIPPED to grey", () => {
    expect(toneFromStatuses(["SKIPPED", "SKIPPED"])).toBe("grey");
  });

  it("builds pills from check ids with separate CARE ERP / CARE DB", () => {
    const pills = buildInfrastructurePulse([
      { id: "app.responding", status: "PASS", message: "API up" },
      { id: "db.connect", status: "PASS", message: "DB ok" },
      { id: "orthanc.reachable", status: "FAIL", message: "Orthanc down" },
      { id: "ai.ollama", status: "SKIPPED", message: "not configured" },
      { id: "integ.icici_orange", status: "PASS", message: "ICICI configured" },
    ]);
    const erp = pills.find((p) => p.key === "care_erp");
    const db = pills.find((p) => p.key === "care_db");
    const orthanc = pills.find((p) => p.key === "orthanc");
    const ollama = pills.find((p) => p.key === "ollama");
    const icici = pills.find((p) => p.key === "icici");
    expect(erp?.tone).toBe("green");
    expect(erp?.label).toBe("CARE ERP");
    expect(db?.tone).toBe("green");
    expect(db?.label).toBe("CARE DB");
    expect(orthanc?.tone).toBe("red");
    expect(orthanc?.shouldBlink).toBe(true);
    expect(ollama?.tone).toBe("grey");
    // Healthy Orange Pay product uses semantic GREEN — not orange branding.
    expect(icici?.tone).toBe("green");
    expect(icici).not.toHaveProperty("accent");
  });
});
