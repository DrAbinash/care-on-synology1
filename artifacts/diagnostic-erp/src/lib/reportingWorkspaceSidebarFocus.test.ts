import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capturePreFocusCollapsed,
  isReportingWorkspaceLocation,
  shouldRestoreSidebarAfterFocus,
} from "./reportingWorkspaceSidebarFocus";

const layout = readFileSync(resolve(__dirname, "../components/Layout.tsx"), "utf8");

describe("Layout wiring", () => {
  it("uses one focus-session snapshot and the shared reporting-path matcher", () => {
    expect(layout).toContain('from "@/lib/reportingWorkspaceSidebarFocus"');
    expect(layout).toContain("isReportingWorkspaceLocation(location)");
    expect(layout).toContain("capturePreFocusCollapsed");
    expect(layout).toContain("shouldRestoreSidebarAfterFocus");
    expect(layout).toContain("preFocusCollapsed");
    // Dual independent pre-refs reintroduced the Settings leak.
    expect(layout).not.toContain("preViewerFocusCollapsed");
    expect(layout).not.toContain("preWorkspaceFocusCollapsed");
    expect(layout).not.toMatch(/\/radiology\\\/reporting-workspace/);
  });
});

describe("isReportingWorkspaceLocation", () => {
  it("matches every route that mounts the reporting workspace", () => {
    expect(isReportingWorkspaceLocation("/radiology/report/42")).toBe(true);
    expect(isReportingWorkspaceLocation("/radiology/reporting-workspace")).toBe(true);
    expect(isReportingWorkspaceLocation("/radiology/reporting-workspace/42")).toBe(true);
    expect(isReportingWorkspaceLocation("/radiology/unified-report/99")).toBe(true);
    expect(isReportingWorkspaceLocation("/radiology/legacy-workspace")).toBe(true);
    expect(isReportingWorkspaceLocation("/radiology/legacy-workspace/7")).toBe(true);
    expect(isReportingWorkspaceLocation("/radiology/report/42?tab=print")).toBe(true);
  });

  it("does not match neighbouring radiology pages", () => {
    expect(isReportingWorkspaceLocation("/radiology/worklist")).toBe(false);
    expect(isReportingWorkspaceLocation("/settings")).toBe(false);
    expect(isReportingWorkspaceLocation("/radiology/report-generator")).toBe(false);
    expect(isReportingWorkspaceLocation("/radiology/report-generator/42")).toBe(false);
    expect(isReportingWorkspaceLocation("/radiology/report-builder")).toBe(false);
    expect(isReportingWorkspaceLocation("/radiology/report-diff")).toBe(false);
    expect(isReportingWorkspaceLocation("/radiology/report-legacy/42")).toBe(false);
    expect(isReportingWorkspaceLocation("/radiology")).toBe(false);
  });
});

describe("capturePreFocusCollapsed", () => {
  it("records the first sidebar state when focus turns on", () => {
    expect(capturePreFocusCollapsed(null, false, true)).toBe(false);
    expect(capturePreFocusCollapsed(null, true, true)).toBe(true);
  });

  it("keeps the original snapshot when a second focus source turns on after collapse", () => {
    // viewer-focus collapsed first (pre=false), then workspace-focus sees cur=true
    expect(capturePreFocusCollapsed(false, true, true)).toBe(false);
  });

  it("does not change the snapshot when focus turns off", () => {
    expect(capturePreFocusCollapsed(false, true, false)).toBe(false);
    expect(capturePreFocusCollapsed(null, false, false)).toBe(null);
  });
});

describe("shouldRestoreSidebarAfterFocus", () => {
  it("restores only when every focus source is off and a snapshot exists", () => {
    expect(shouldRestoreSidebarAfterFocus({ viewer: false, workspace: false }, false)).toBe(true);
    expect(shouldRestoreSidebarAfterFocus({ viewer: true, workspace: false }, false)).toBe(false);
    expect(shouldRestoreSidebarAfterFocus({ viewer: false, workspace: true }, false)).toBe(false);
    expect(shouldRestoreSidebarAfterFocus({ viewer: false, workspace: false }, null)).toBe(false);
  });

  it("models the dual-focus leave bug that stuck Settings collapsed", () => {
    // Entry: expanded sidebar, then viewer + workspace both on.
    let pre = capturePreFocusCollapsed(null, false, true); // viewer on
    pre = capturePreFocusCollapsed(pre, true, true); // workspace on (sidebar already collapsed)
    expect(pre).toBe(false);

    // Mid-session: viewer turns off (Report Focus / dual-screen) while workspace stays.
    expect(
      shouldRestoreSidebarAfterFocus({ viewer: false, workspace: true }, pre),
    ).toBe(false);

    // Leave workspace → restore original expanded state, not the polluted true.
    expect(
      shouldRestoreSidebarAfterFocus({ viewer: false, workspace: false }, pre),
    ).toBe(true);
    expect(pre).toBe(false);
  });
});
