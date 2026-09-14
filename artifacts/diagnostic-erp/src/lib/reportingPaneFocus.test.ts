import { describe, expect, it } from "vitest";
import {
  compactAccordionSummary,
  CONSTRAINED_REPORTING_VIEWPORT_MAX_PX,
  isConstrainedReportingViewport,
  layoutModeForPaneBias,
  outerPanelPercents,
  REPORTING_FOCUS_VIEWER_SHARE,
  shouldIgnorePaneFocusTarget,
  shouldUseCompactAccordion,
  shouldUseExclusiveReportSections,
  VIEWER_FOCUS_VIEWER_SHARE,
} from "./reportingPaneFocus";

describe("reportingPaneFocus viewport policy", () => {
  it("treats classic laptop widths as constrained, ultrawide as not", () => {
    expect(isConstrainedReportingViewport(1280)).toBe(true);
    expect(isConstrainedReportingViewport(1366)).toBe(true);
    expect(isConstrainedReportingViewport(CONSTRAINED_REPORTING_VIEWPORT_MAX_PX)).toBe(true);
    expect(isConstrainedReportingViewport(1440)).toBe(false);
    expect(isConstrainedReportingViewport(1920)).toBe(false);
  });

  it("enables exclusive + compact accordion on laptop and viewerFocus", () => {
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "viewerFocus" }),
    ).toBe(true);
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(false);
  });
});

describe("outerPanelPercents — Reporting Focus ↔ Viewer Focus", () => {
  it("A: Reporting Focus ≈ viewer 1/3, report 2/3 with queue collapsed", () => {
    const p = outerPanelPercents({ bias: "reporting", queueCollapsed: true });
    expect(p.queue).toBe(3);
    expect(p.viewer + p.report).toBe(97);
    expect(p.viewer / 97).toBeCloseTo(REPORTING_FOCUS_VIEWER_SHARE, 1);
    expect(p.report).toBeGreaterThanOrEqual(60);
    expect(p.viewer).toBeLessThanOrEqual(40);
    // Clinical laptop targets
    expect(p.report).toBeGreaterThanOrEqual(63);
    expect(p.report).toBeLessThanOrEqual(70);
  });

  it("B: Viewer Focus ≈ viewer 2/3, report 1/3", () => {
    const p = outerPanelPercents({ bias: "viewer", queueCollapsed: true });
    expect(p.viewer / 97).toBeCloseTo(VIEWER_FOCUS_VIEWER_SHARE, 1);
    expect(p.viewer).toBeGreaterThanOrEqual(60);
    expect(p.report).toBeLessThanOrEqual(40);
  });

  it("C: Impression after Findings — same reporting bias targets (section state separate)", () => {
    const findings = outerPanelPercents({ bias: "reporting", queueCollapsed: true });
    const impression = outerPanelPercents({ bias: "reporting", queueCollapsed: true });
    expect(impression).toEqual(findings);
  });

  it("maps bias onto existing layout modes", () => {
    expect(layoutModeForPaneBias("reporting")).toBe("split");
    expect(layoutModeForPaneBias("viewer")).toBe("viewerFocus");
  });

  it("softens extremes on very narrow viewports", () => {
    const p = outerPanelPercents({ bias: "reporting", queueCollapsed: true, narrow: true });
    expect(p.viewer).toBeGreaterThan(35);
    expect(p.report).toBeLessThan(65);
  });
});

describe("compactAccordionSummary", () => {
  it("keeps clinical text but shortens bulky secondary lines", () => {
    expect(compactAccordionSummary("Kapil Mandal • 48 Yrs/M • P-06186", 36)).toMatch(
      /Kapil Mandal/,
    );
    expect(compactAccordionSummary("Dr. Rakesh Kumar Tridev Hospital", 28).endsWith("…")).toBe(
      true,
    );
  });
});

describe("shouldIgnorePaneFocusTarget", () => {
  it("is a no-op without DOM Element", () => {
    expect(shouldIgnorePaneFocusTarget(null)).toBe(false);
  });
});
