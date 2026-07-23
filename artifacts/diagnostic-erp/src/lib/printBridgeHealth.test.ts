import { describe, expect, it } from "vitest";
import { healthDotClass, healthTooltip, type BridgeHealth } from "./printBridgeHealth";

// Print-bridge health indicator: pins the mapping from GET
// /api/radiology/print-bridge/health's response to the dot color and
// tooltip PrintImagePicker shows next to "Print images" in the workspace.

const normal: BridgeHealth = { configured: true, reachable: true, printerStatus: "NORMAL", printerInfo: "ready" };
const failure: BridgeHealth = { configured: true, reachable: true, printerStatus: "FAILURE", printerInfo: "queue paused" };
const unreachable: BridgeHealth = { configured: true, reachable: false, printerStatus: null, printerInfo: "ECONNREFUSED" };
const notConfigured: BridgeHealth = { configured: false, reachable: false, printerStatus: null, printerInfo: null };

describe("healthDotClass", () => {
  it("is muted/gray while still loading (undefined)", () => {
    expect(healthDotClass(undefined)).toBe("bg-muted-foreground/30");
  });
  it("is muted/gray when the bridge isn't configured", () => {
    expect(healthDotClass(notConfigured)).toBe("bg-muted-foreground/30");
  });
  it("is red when configured but unreachable", () => {
    expect(healthDotClass(unreachable)).toBe("bg-red-500");
  });
  it("is amber when reachable but the printer itself reports a problem", () => {
    expect(healthDotClass(failure)).toBe("bg-amber-500");
  });
  it("is green when reachable and the printer reports NORMAL", () => {
    expect(healthDotClass(normal)).toBe("bg-emerald-500");
  });
});

describe("healthTooltip", () => {
  it("prompts a check while still loading", () => {
    expect(healthTooltip(undefined)).toMatch(/checking/i);
  });
  it("names PRINT_BRIDGE_URL when not configured", () => {
    expect(healthTooltip(notConfigured)).toMatch(/PRINT_BRIDGE_URL/);
  });
  it("includes the printerInfo reason when unreachable", () => {
    expect(healthTooltip(unreachable)).toContain("ECONNREFUSED");
  });
  it("surfaces printerInfo when reachable", () => {
    expect(healthTooltip(normal)).toBe("ready");
  });
  it("falls back to printerStatus when printerInfo is empty", () => {
    expect(healthTooltip({ ...normal, printerInfo: null })).toBe("NORMAL");
  });
});
