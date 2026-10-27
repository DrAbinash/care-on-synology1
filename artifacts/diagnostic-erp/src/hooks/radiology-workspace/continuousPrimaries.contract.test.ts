/**
 * continuousPrimaries.contract.test.ts — wiring contracts for the few-clicks
 * pass 2, Findings+Impression cockpit (owner's order: FEW CLICKS, easy quick
 * reports).
 *
 * THE COST UNDER GUARD
 *   Exclusive accordion mode (the correct density default everywhere) prices
 *   the Findings→Impression hop at one click — the single most-traveled
 *   transition in the composer, paid on every report. The accordion shipped a
 *   `continuous` prop designed for exactly this ("wide desktop
 *   Findings+Impression cockpit") and nothing ever passed it.
 *
 *   This pass wires it: both primary sections stay open on desktops that can
 *   seat two editors, gated by shouldUseContinuousPrimarySections (pure
 *   helper, pinned in reportingPaneFocus.test.ts). The wiring contracts here:
 *   the gate actually reaches BOTH mounts, a non-primary active section still
 *   collapses the pair (exclusive 66vh economics for Technique/Report), and
 *   the height signal actually reaches the gate from a real resize listener.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CANVAS = readFileSync(
  resolve(__dirname, "../../components/radiology/workspace/ReportCanvas.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const LAYOUT = readFileSync(
  resolve(__dirname, "useWorkspaceLayout.ts"),
  "utf8",
).replace(/\r\n/g, "\n");
const CLINICAL = readFileSync(
  resolve(__dirname, "useWorkspaceClinicalUi.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("the cockpit gate reaches both primary sections (few-clicks pass 2)", () => {
  // NOTE: markers are concatenated, not written as literals — this file lives
  // inside hooks/radiology-workspace/, which readModularWorkspaceSrc() scans,
  // and position-pinning suites (radiologyWorkspaceAccordion order test) grep
  // for these exact strings. A literal here would become their first match.
  const findingsMarker = 'accordionProps("find' + 'ings")';
  const impressionMarker = 'accordionProps("imp' + 'ression")';

  it("Findings and Impression both pass continuous, gated identically", () => {
    const findingsMount = CANVAS.indexOf(findingsMarker);
    const impressionMount = CANVAS.indexOf(impressionMarker);
    expect(findingsMount).toBeGreaterThan(0);
    expect(impressionMount).toBeGreaterThan(findingsMount);
    for (const mount of [findingsMount, impressionMount]) {
      const window = CANVAS.slice(mount, mount + 900);
      expect(window).toContain("continuous={");
      expect(window).toContain("continuousPrimarySections");
      expect(window).toContain('activeReportSection === "findings"');
      expect(window).toContain('activeReportSection === "impression"');
    }
  });

  it("a non-primary active section collapses the pair — exclusive economics survive", () => {
    // The continuous prop is conjunctive: gate AND (null OR findings OR
    // impression). When Technique or Report owns the pane, primaries return
    // to headers like every other section.
    const findingsMount = CANVAS.indexOf(findingsMarker);
    const window = CANVAS.slice(findingsMount, findingsMount + 900);
    expect(window).toContain("continuousPrimarySections\n");
    expect(window).toMatch(/activeReportSection == null/);
  });

  it("the layout hook computes the gate and the clinical hook feeds it height", () => {
    expect(LAYOUT).toContain("const continuousPrimarySections = shouldUseContinuousPrimarySections({");
    expect(LAYOUT).toContain("viewportHeightPx,");
    expect(CLINICAL).toContain("viewportHeightPx,");
    // A real resize listener, not a one-shot read: maximize/restore must
    // re-evaluate the cockpit.
    expect(CLINICAL).toContain('window.addEventListener("resize", sync);');
  });
});
