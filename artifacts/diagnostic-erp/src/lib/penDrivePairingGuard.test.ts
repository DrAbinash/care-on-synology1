import { describe, expect, it } from "vitest";
import { shouldSuppressPenDrivePairing } from "./penDrivePairingGuard";

/**
 * U11 regression pins: every route the Radiology Reporting Workspace can be
 * mounted on must suppress the Ctrl+Shift+K pen-drive pairing trigger, so the
 * combo single-owns "park study" there. Everywhere else the pairing trigger
 * keeps working.
 */
describe("shouldSuppressPenDrivePairing (U11: Ctrl+Shift+K single owner in the workspace)", () => {
  it("suppresses on every canonical workspace route", () => {
    expect(shouldSuppressPenDrivePairing("/radiology/report/42")).toBe(true);
    expect(shouldSuppressPenDrivePairing("/radiology/reporting-workspace")).toBe(true);
    expect(shouldSuppressPenDrivePairing("/radiology/reporting-workspace/42")).toBe(true);
  });

  it("suppresses on the deprecated aliases that redirect into the workspace", () => {
    expect(shouldSuppressPenDrivePairing("/radiology/report-legacy/42")).toBe(true);
    expect(shouldSuppressPenDrivePairing("/radiology/report-generator")).toBe(true);
    expect(shouldSuppressPenDrivePairing("/radiology/report-generator/42")).toBe(true);
  });

  it("keeps the pairing trigger on non-workspace routes", () => {
    expect(shouldSuppressPenDrivePairing("/")).toBe(false);
    expect(shouldSuppressPenDrivePairing("/radiology")).toBe(false);
    expect(shouldSuppressPenDrivePairing("/radiology/worklist")).toBe(false);
    expect(shouldSuppressPenDrivePairing("/radiology/advanced-tools")).toBe(false);
    expect(shouldSuppressPenDrivePairing("/settings")).toBe(false);
  });

  it("also stands down on /radiology/report-builder (shared prefix — harmless for a hidden admin dialog)", () => {
    expect(shouldSuppressPenDrivePairing("/radiology/report-builder")).toBe(true);
  });
});
