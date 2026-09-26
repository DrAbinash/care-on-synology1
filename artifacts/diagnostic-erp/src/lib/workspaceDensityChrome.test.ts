import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isStudyDetailsSection,
  shouldCollapseSetupChrome,
  shouldUseCompactAccordion,
  shouldUseExclusiveReportSections,
} from "./reportingPaneFocus";

describe("workspace density chrome policy", () => {
  it("always uses compact + exclusive accordion (ultrawide included)", () => {
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
  });

  it("collapses setup chrome when a clinical section is active", () => {
    expect(shouldCollapseSetupChrome("findings")).toBe(true);
    expect(shouldCollapseSetupChrome("impression")).toBe(true);
    expect(shouldCollapseSetupChrome("technique")).toBe(true);
    expect(shouldCollapseSetupChrome("history")).toBe(true);
    expect(shouldCollapseSetupChrome("demography")).toBe(false);
    expect(shouldCollapseSetupChrome("refDoctor")).toBe(false);
    expect(shouldCollapseSetupChrome("region")).toBe(false);
    expect(shouldCollapseSetupChrome(null)).toBe(false);
  });

  it("recognizes Study details member sections", () => {
    expect(isStudyDetailsSection("demography")).toBe(true);
    expect(isStudyDetailsSection("findings")).toBe(false);
  });

  it("wires AnchorRail only when viewer context exists", () => {
    const page = readFileSync(
      join(__dirname, "../pages/RadiologyReportingWorkspace.tsx"),
      "utf8",
    );
    expect(page).toMatch(
      /activeAnchor\?\.studyInstanceUID[\s\S]{0,80}<AnchorRail/,
    );
  });

  it("Starting Canvas collapses to a thin row with Quick Normal reachable", () => {
    const page = readFileSync(
      join(__dirname, "../pages/RadiologyReportingWorkspace.tsx"),
      "utf8",
    );
    expect(page).toMatch(/data-testid="starting-canvas-toggle"/);
    expect(page).toMatch(/data-testid="full-normal-starting-canvas"/);
    expect(page).toMatch(/data-testid="quick-normal-fallback"/);
    expect(page).toMatch(/data-testid="study-details-toggle"/);
    expect(page).toMatch(/startingCanvasExpanded/);
    expect(page).toMatch(/studyDetailsOpen/);
    expect(page).toMatch(/shouldCollapseSetupChrome/);
  });

  it("viewer-focus strip opens patient details instead of a vanishing Show details", () => {
    const page = readFileSync(
      join(__dirname, "../pages/RadiologyReportingWorkspace.tsx"),
      "utf8",
    );
    expect(page).toMatch(/data-testid="viewer-focus-strip"/);
    expect(page).toMatch(/Show patient details/);
    expect(page).not.toMatch(
      />\s*Show details\s*</,
    );
    expect(page).toMatch(/setStudyDetailsOpen\(true\)/);
    expect(page).toMatch(/activateReportSection\("demography"\)/);
  });
});
