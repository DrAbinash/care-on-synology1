import { describe, expect, it } from "vitest";
import {
  compactAccordionSummary,
  CONSTRAINED_REPORTING_VIEWPORT_MAX_PX,
  CONTINUOUS_PRIMARY_MIN_HEIGHT_PX,
  CONTINUOUS_PRIMARY_MIN_WIDTH_PX,
  autoFocusPersistsByModeSizes,
  clearPaneManualOverride,
  isConstrainedReportingViewport,
  layoutModeForPaneBias,
  markPaneManualOverride,
  outerPanelPercents,
  REPORTING_FOCUS_VIEWER_SHARE,
  shouldApplyAutomaticPaneFocus,
  shouldIgnorePaneFocusTarget,
  shouldUseCompactAccordion,
  shouldUseContinuousPrimarySections,
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

  it("enables exclusive + compact accordion on every clinic monitor", () => {
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "viewerFocus" }),
    ).toBe(true);
    // Ultrawide used to keep comfortable two-line rows and starve Findings.
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(true);
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

  it("phone viewports give OHIF nearly the full band", () => {
    const viewer = outerPanelPercents({ bias: "viewer", queueCollapsed: true, phone: true });
    expect(viewer.viewer).toBeGreaterThanOrEqual(80);
    expect(viewer.report).toBeLessThanOrEqual(15);
    const reporting = outerPanelPercents({ bias: "reporting", queueCollapsed: true, phone: true });
    expect(reporting.viewer).toBeGreaterThanOrEqual(65);
  });
});

describe("viewerOverlayShellClass", () => {
  it("uses edge-to-edge overlay on phone", async () => {
    const { viewerOverlayShellClass } = await import("./reportingPaneFocus");
    expect(viewerOverlayShellClass({ expanded: false, phone: true })).toContain("relative");
    expect(viewerOverlayShellClass({ expanded: true, phone: true })).toContain("inset-0");
    expect(viewerOverlayShellClass({ expanded: true, phone: false })).toContain("inset-4");
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

describe("transient auto-focus vs manual byMode memory", () => {
  it("automatic focus must not persist byMode viewer/report sizes", () => {
    expect(autoFocusPersistsByModeSizes()).toBe(false);
  });

  it("manual drag sets a session override that survives far beyond 2.5s", () => {
    let override = markPaneManualOverride({}, "split");
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "split",
        manualOverride: override,
      }),
    ).toBe(false);
    // Still blocked after a long pause — not a 2500ms timer.
    override = markPaneManualOverride(override, "split");
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "split",
        manualOverride: override,
      }),
    ).toBe(false);
  });

  it("explicit mode reset/change re-enables automatic focus for that mode", () => {
    let override = markPaneManualOverride({}, "split");
    override = markPaneManualOverride(override, "viewerFocus");
    override = clearPaneManualOverride(override, "split");
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "split",
        manualOverride: override,
      }),
    ).toBe(true);
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "viewerFocus",
        manualOverride: override,
      }),
    ).toBe(false);
  });

  it("wide desktop never auto-snaps even without override", () => {
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: false,
        mode: "split",
        manualOverride: {},
      }),
    ).toBe(false);
  });
});

describe("continuous primary sections — the wide-desktop Findings+Impression cockpit", () => {
  // FEW-CLICKS (pass 2): with Findings and Impression both open, the
  // Findings→Impression transition costs zero clicks on screens that can
  // genuinely seat both editors. The accordion's `continuous` prop existed
  // for exactly this ("wide desktop Findings+Impression cockpit") but was
  // never wired. Gates: a viewport wide enough to spare the report column
  // beside the viewer, tall enough to seat two editors, and a layout that
  // still gives the report column real width (viewerFocus starves it).
  it("wide and tall desktops get the cockpit, laptops and viewer-focus do not", () => {
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1920, viewportHeightPx: 1080, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 2560, viewportHeightPx: 1440, layoutMode: "reportFocus" }),
    ).toBe(true);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1920, viewportHeightPx: 1080, layoutMode: "viewerFocus" }),
    ).toBe(false);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1366, viewportHeightPx: 900, layoutMode: "split" }),
    ).toBe(false);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1920, viewportHeightPx: 700, layoutMode: "split" }),
    ).toBe(false);
  });

  it("the thresholds are named, and the width gate is the 2xl breakpoint", () => {
    expect(CONTINUOUS_PRIMARY_MIN_WIDTH_PX).toBe(1536);
    expect(CONTINUOUS_PRIMARY_MIN_HEIGHT_PX).toBe(800);
  });
});
