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

  it("builds pills from check ids", () => {
    const pills = buildInfrastructurePulse([
      { id: "app.responding", status: "PASS", message: "API up" },
      { id: "db.connect", status: "PASS", message: "DB ok" },
      { id: "orthanc.reachable", status: "FAIL", message: "Orthanc down" },
      { id: "ai.ollama", status: "SKIPPED", message: "not configured" },
    ]);
    const erp = pills.find((p) => p.key === "erp");
    const orthanc = pills.find((p) => p.key === "orthanc");
    const ollama = pills.find((p) => p.key === "ollama");
    expect(erp?.tone).toBe("green");
    expect(orthanc?.tone).toBe("red");
    expect(orthanc?.shouldBlink).toBe(true);
    expect(ollama?.tone).toBe("grey");
  });
});
