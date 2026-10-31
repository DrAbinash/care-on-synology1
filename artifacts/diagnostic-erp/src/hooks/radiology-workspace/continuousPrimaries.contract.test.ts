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
import {
  PREVIEW_OPEN_KEY,
  PREVIEW_HEIGHT_KEY,
  clampPreviewPaneHeight,
  readPreviewPrefs,
  writePreviewPref,
} from "@/lib/reportPreviewPrefs";

const CANVAS = readFileSync(
  resolve(__dirname, "../../components/radiology/workspace/ReportCanvas.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const EXPORT = readFileSync(
  resolve(__dirname, "../../components/radiology/ReportExportPanel.tsx"),
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

/**
 * THE THIRD CONTINUOUS SECTION — the live rendered report.
 *
 * Exclusive mode is the right density default, and the cockpit is the right
 * exception for the two editors. What nobody priced was that the exception list
 * decided more than editor switching: the live print preview lives in section 9,
 * so making that section exclusive took the rendered report out of the reporting
 * screen altogether. Watching it cost closing the editor it was rendered from, so
 * the radiologist stopped watching it and signed what he had typed instead of what
 * printed — reported from the clinic on 2026-11-01 as "the live print preview
 * disappeared".
 *
 * The preview is a clinical control, not a second editor, so on exactly the
 * viewports that already seat the cockpit it is continuous too, and it is his to
 * collapse and to size.
 */
describe("the live preview joins the cockpit on the same gate", () => {
  // Concatenated marker for the reason given above: this directory is scanned by
  // readModularWorkspaceSrc(), and a literal here would become a position-pinning
  // suite's first match.
  const reportMount = CANVAS.indexOf('accordionProps("re' + 'port")');

  it("section 9 passes continuous, gated like the primaries", () => {
    expect(reportMount).toBeGreaterThan(0);
    const window = CANVAS.slice(reportMount, reportMount + 900);
    expect(window).toContain("continuous={");
    expect(window).toContain("continuousPrimarySections");
    expect(window).toContain('activeReportSection === "report"');
    expect(window).toContain('activeReportSection === "findings"');
  });

  it("the preview is gated by its own toggle, not by the layout drawer", () => {
    // Before this, the iframe sat inside the `{open && …}` layout-drawer block, so
    // collapsing the controls also destroyed the rendered report — one toggle
    // governing two things used at different moments.
    const previewBlock = EXPORT.indexOf("{previewOpen && (");
    expect(previewBlock).toBeGreaterThan(0);
    const iframe = EXPORT.indexOf('data-testid="report-layout-preview"');
    expect(iframe).toBeGreaterThan(previewBlock);
    // The drawer's own block still exists and no longer contains the iframe.
    const drawer = EXPORT.indexOf("{open && (");
    expect(drawer).toBeGreaterThan(previewBlock);
    expect(EXPORT.slice(drawer)).not.toContain('data-testid="report-layout-preview"');
    // And the fetch follows what is on screen, so a hidden preview stops
    // re-rendering the report on every keystroke.
    expect(EXPORT).toContain("enabled: (previewOpen || enlarged) && !!serverPreviewUrl,");
  });

  it("a preview he has never chosen is ON, and his size survives the next report", () => {
    expect(readPreviewPrefs(null)).toEqual({ open: true, heightPx: 320 });
    const store = (items: Record<string, string>): Pick<Storage, "getItem"> => ({
      getItem: (k: string) => items[k] ?? null,
    });
    expect(readPreviewPrefs(store({ "care.reportPreview.open": "0" })).open).toBe(false);
    expect(readPreviewPrefs(store({ "care.reportPreview.open": "1" })).open).toBe(true);
    expect(readPreviewPrefs(store({ "care.reportPreview.height": "540" })).heightPx).toBe(540);
    // localStorage answers `null` for a key that was never written, and
    // `Number(null)` is 0 — a finite number — so reading the height that way
    // seats the pane at the MINIMUM on every radiologist's first report. Measured
    // in a real browser as a 180px preview beside a 320px default.
    expect(readPreviewPrefs(store({}))).toEqual({ open: true, heightPx: 320 });
    expect(readPreviewPrefs(store({ "care.reportPreview.height": "" })).heightPx).toBe(320);
    // Garbage and out-of-range values fall back rather than seating a slit or a
    // pane taller than the report column.
    expect(readPreviewPrefs(store({ "care.reportPreview.height": "abc" })).heightPx).toBe(320);
    expect(clampPreviewPaneHeight(10)).toBe(180);
    expect(clampPreviewPaneHeight(5000)).toBe(900);
    // A storage that throws (private mode) is not allowed to fail the panel.
    const hostile: Pick<Storage, "getItem"> = {
      getItem() { throw new Error("SecurityError"); },
    };
    expect(readPreviewPrefs(hostile)).toEqual({ open: true, heightPx: 320 });

    // And the write half: only the two known keys, and a refusal is swallowed.
    const written: Record<string, string> = {};
    writePreviewPref(PREVIEW_OPEN_KEY, "0", { setItem: (k: string, v: string) => { written[k] = v; } });
    expect(written).toEqual({ "care.reportPreview.open": "0" });
    expect(() => writePreviewPref(PREVIEW_HEIGHT_KEY, "400", {
      setItem() { throw new Error("QuotaExceeded"); },
    })).not.toThrow();
  });
});
