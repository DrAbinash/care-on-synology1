import { describe, expect, it } from "vitest";
import {
  isRadiologyReportingWorkspaceRoute,
  shouldSuppressPenDrivePairing,
} from "./penDrivePairingGuard";

/**
 * U11 regression pins: every route the Radiology Reporting Workspace can be
 * mounted on must suppress the Ctrl+Shift+K pen-drive pairing trigger, so the
 * combo single-owns "park study" there. Everywhere else the pairing trigger
 * keeps working.
 *
 * U14 pins: the same workspace routes are where the workspace's own Ctrl+K
 * palette owns the combo, so the global palette must stand down there too —
 * but NOT on /radiology/report-builder, which has no workspace palette.
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

describe("isRadiologyReportingWorkspaceRoute (U14: workspace owns Ctrl+K here)", () => {
  it("is true exactly where the workspace palette is mounted", () => {
    expect(isRadiologyReportingWorkspaceRoute("/radiology/report/42")).toBe(true);
    expect(isRadiologyReportingWorkspaceRoute("/radiology/report")).toBe(true);
    expect(isRadiologyReportingWorkspaceRoute("/radiology/reporting-workspace")).toBe(true);
    expect(isRadiologyReportingWorkspaceRoute("/radiology/reporting-workspace/42")).toBe(true);
    expect(isRadiologyReportingWorkspaceRoute("/radiology/report-legacy/7")).toBe(true);
    expect(isRadiologyReportingWorkspaceRoute("/radiology/report-generator")).toBe(true);
  });

  it("is false on non-workspace pages — the global palette keeps Ctrl+K there", () => {
    expect(isRadiologyReportingWorkspaceRoute("/")).toBe(false);
    expect(isRadiologyReportingWorkspaceRoute("/radiology/worklist")).toBe(false);
    // report-builder has NO workspace palette — suppressing the global one
    // there would leave Ctrl+K dead.
    expect(isRadiologyReportingWorkspaceRoute("/radiology/report-builder")).toBe(false);
    // Trailing slashes must not change the verdict.
    expect(isRadiologyReportingWorkspaceRoute("/radiology/reporting-workspace/")).toBe(true);
  });
});
