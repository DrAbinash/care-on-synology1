import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("emergency bridge routes", () => {
  it("mounts token-auth bridge outside staff session", () => {
    const index = readFileSync(path.resolve(__dirname, "../routes/index.ts"), "utf8");
    expect(index).toContain('"/emergency-bridge"');
    expect(index).toContain("emergencyBridgeRouter");
    const bridge = readFileSync(path.resolve(__dirname, "../routes/emergencyBridge.ts"), "utf8");
    expect(bridge).toContain("/master-snapshot");
    expect(bridge).toContain("/import-json");
    expect(bridge).toContain("X-Emergency-Fetch-Token");
    expect(bridge).toContain("requireEmergencyFetchToken");
  });
});
