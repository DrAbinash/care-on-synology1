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
  PREVIEW_WIDTH_KEY,
  clampPreviewPaneWidthPct,
  EDITOR_MIN_PX,
  editorHasRoomForPreview,
  readPreviewPrefs,
  writePreviewPref,
} from "@/lib/reportPreviewPrefs";

const CANVAS = readFileSync(
  resolve(__dirname, "../../components/radiology/workspace/ReportCanvas.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const SHELL = readFileSync(
  resolve(__dirname, "../../components/radiology/workspace/WorkspaceShell.tsx"),
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
 * The preview is a clinical control, not a second editor — which is why it is his
 * to collapse and to size, and why it does NOT join the continuous set: measured,
 * the third continuous body leaves the Impression editor ~30 px tall on the
 * smallest cockpit viewport.
 */
describe("the live preview is a column beside the editors, not a pane under them", () => {
  // Concatenated marker for the reason given above: this directory is scanned by
  // readModularWorkspaceSrc(), and a literal here would become a position-pinning
  // suite's first match.
  const reportMount = CANVAS.indexOf('accordionProps("re' + 'port")');

  it("section 9 stays exclusive — and no longer carries the rendered report at all", () => {
    // The first attempt at the live-preview defect mounted this section as a third
    // continuous body so the rendered report could sit beside Findings and
    // Impression. In a real browser at 1536x800 (the smallest viewport the cockpit
    // admits) the canvas column holds 582 px and wants 1112, its overflow is
    // `hidden` with no scrollable ancestor, and the Impression editor keeps ~30 px
    // of visible height with the pane open — ~155 px of it is lost with the pane
    // closed, from this section joining the continuous set alone. A preview that
    // costs the text it previews is not a fix.
    //
    // OWNER DECISION 2026-11-01 made the column decision the comment asked him for: the
    // panel mounts as a column beside the editors, so the section keeps its density and
    // the preview stops depending on which accordion body is open.
    expect(reportMount).toBeGreaterThan(0);
    expect(CANVAS.slice(reportMount, reportMount + 200)).not.toContain("continuous={");
    expect(CANVAS).not.toContain("<ReportExportPanel");
    expect(SHELL).toContain("<ReportLivePreviewColumn");
    // The separator is what makes the column resizable — the owner's "resizable and
    // collapsible". Spelled in two pieces: a literal testid here enters the workspace's
    // testid inventory, which is an inventory of shipped DOM, not of strings in tests.
    expect(SHELL).toContain("live-preview-re" + "size");
    // …and it is a SIBLING of the editor column, not a third panel of the
    // `ReportCanvas | ReportingToolsRail` group. Measured inside that group: mounting a
    // new child re-normalises the group's percentages, which pushed the Quick Select
    // rail to its `minSize` and folded the preview to its own strip. Wrapped in a panel
    // of its own, every percentage the rail and the pane-focus machinery already speak
    // keeps meaning what it meant.
    const canvasAt = SHELL.indexOf("<ReportCanvas vm={vm} editorColumnRef=");
    const innerClose = SHELL.indexOf("</ResizablePanelGroup>", canvasAt);
    const previewAt = SHELL.indexOf("<ReportLivePreviewColumn");
    expect(canvasAt).toBeGreaterThan(0);
    expect(previewAt).toBeGreaterThan(innerClose);
    expect(SHELL.slice(canvasAt, innerClose)).toContain("<ReportingToolsRail vm={vm} />");
    expect(SHELL.slice(canvasAt, innerClose)).not.toContain("ReportLivePreviewColumn");
    // The editor column is what the preview measures itself against, so the shell hands
    // the same element to both of them.
    expect(SHELL).toContain("const editorColumnRef = useRef<HTMLDivElement>(null);");
    expect(SHELL).toContain("<ReportLivePreviewColumn vm={vm} editorColumnRef={editorColumnRef} />");
    expect(CANVAS).toContain("<div ref={editorColumnRef}");
    // One read at mount feeds both panels' defaults, so the pair sums to 100 instead of
    // being re-normalised at mount and quietly repricing the width he persisted.
    expect(SHELL).toContain("useState(() => readPreviewPrefs())");
    expect(SHELL).toContain("100 - previewPrefs.widthPct");
  });

  it("the pane is mounted whenever the column is, and the fetch follows what is on screen", () => {
    // It used to hang on a flag inside this panel, with a drag strip under it that
    // fought the accordion for the same pixels. A column has one resizer — its
    // separator — and one visibility owner — the column.
    expect(EXPORT).not.toContain("{previewOpen && (");
    expect(EXPORT).not.toContain("report-live-previe" + "w-resize");
    const iframe = EXPORT.indexOf('data-testid="report-layout-preview"');
    const drawer = EXPORT.indexOf("{open && (");
    expect(iframe).toBeGreaterThan(0);
    expect(drawer).toBeGreaterThan(iframe);
    // The layout drawer still folds the controls away without destroying the report.
    expect(EXPORT.slice(drawer)).not.toContain('data-testid="report-layout-preview"');
    expect(EXPORT).toContain("enabled: enlarged || !!serverPreviewUrl,");
    // Closing the column unmounts the panel, so a hidden preview asks the server for
    // nothing and re-saves no draft.
    expect(EXPORT).toContain("onCollapseColumn");
  });

  it("the preview folds itself away before it can squeeze the editors", () => {
    // "At constrained widths, collapse the preview automatically instead of squeezing
    // the editor." The floor is the editor's, and the preview is the thing that goes.
    expect(editorHasRoomForPreview(EDITOR_MIN_PX)).toBe(true);
    expect(editorHasRoomForPreview(EDITOR_MIN_PX - 1)).toBe(false);
    // An unmeasured column is not evidence of a squeeze. `clientWidth` is 0 before the
    // browser lays the page out, and folding a preview he opened on that reading is the
    // same class of failure as the pane that seated itself at the minimum on a null.
    expect(editorHasRoomForPreview(0)).toBe(true);
    expect(editorHasRoomForPreview(Number.NaN)).toBe(true);
    expect(editorHasRoomForPreview(-40)).toBe(true);
  });

  it("an automatic fold is not a preference, and his own click outranks the rule", () => {
    // The column, not the pane: the toggle that used to live inside `ReportExportPanel`
    // governed a height, and the accordion above it governed whether the preview existed.
    const COLUMN = readFileSync(
      resolve(__dirname, "../../components/radiology/workspace/ReportLivePreviewColumn.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    // Folding because the editor lost room must not write `open=0`: he did not close
    // anything, and the next study would open with a preview he cannot find.
    expect(COLUMN).toContain("if (autoFoldRef.current) return;");
    // Reopening it himself is explicit. The rule stands down while the editor is short,
    // or the strip he just clicked would fold itself again on the next frame.
    expect(COLUMN).toContain("armedRef.current = false;");
    expect(COLUMN).toContain("if (!armedRef.current || settle !== undefined) return;");
    // And a squeeze only counts once the layout has stopped moving: opening Quick
    // Select takes the width and the pane-focus compensation hands it back a frame
    // later — measured at 1536x800 as 558px mid-move against 598px settled, which folded
    // a preview that had every right to stay open.
    expect(COLUMN).toContain("}, SETTLE_MS);");
    expect(COLUMN).toContain("if (!editorHasRoomForPreview(editor.clientWidth)) {");
    // …and room returning re-arms it for the next squeeze.
    expect(COLUMN).toContain("armedRef.current = true;");
    // Only a position he moved is persisted. The drag releases on the separator, not
    // inside this panel — measured: a drag that widened the column 283px -> 370px left
    // `care.reportPreview.width` null with the handler on the panel's own content.
    expect(COLUMN).toContain('window.addEventListener("pointerup", persistWidth)');
    expect(COLUMN).toContain("if (rounded === widthPct) return;");
    // …and a folded column never becomes his stored width: its 3% strip clamped to the
    // minimum would come back on the next study as a slit.
    expect(COLUMN).toContain("if (collapsed) return;");
    // The expanded floor has to sit above the strip, or the strip's Expand restores the
    // strip — measured as a 33px preview column behind a working-looking button.
    expect(COLUMN).toContain("minSize={MIN_PREVIEW_PANE_PCT}");
    expect(COLUMN).toContain("collapsedSize={PREVIEW_STRIP_PCT}");
  });

  it("a preview he has never chosen is ON, and his width survives the next report", () => {
    expect(readPreviewPrefs(null)).toEqual({ open: true, widthPct: 30 });
    const store = (items: Record<string, string>): Pick<Storage, "getItem"> => ({
      getItem: (k: string) => items[k] ?? null,
    });
    expect(readPreviewPrefs(store({ "care.reportPreview.open": "0" })).open).toBe(false);
    expect(readPreviewPrefs(store({ "care.reportPreview.open": "1" })).open).toBe(true);
    expect(readPreviewPrefs(store({ "care.reportPreview.width": "40" })).widthPct).toBe(40);
    // localStorage answers `null` for a key that was never written, and
    // `Number(null)` is 0 — a finite number — so reading the width that way seats the
    // column at the MINIMUM on every radiologist's first report.
    expect(readPreviewPrefs(store({}))).toEqual({ open: true, widthPct: 30 });
    expect(readPreviewPrefs(store({ "care.reportPreview.width": "" })).widthPct).toBe(30);
    // Garbage and out-of-range values fall back rather than seating a slit or a column
    // wider than the report group.
    expect(readPreviewPrefs(store({ "care.reportPreview.width": "abc" })).widthPct).toBe(30);
    expect(clampPreviewPaneWidthPct(1)).toBe(18);
    expect(clampPreviewPaneWidthPct(90)).toBe(45);
    // A storage that throws (private mode) is not allowed to fail the panel.
    const hostile: Pick<Storage, "getItem"> = {
      getItem() { throw new Error("SecurityError"); },
    };
    expect(readPreviewPrefs(hostile)).toEqual({ open: true, widthPct: 30 });

    // And the write half: only the two known keys, and a refusal is swallowed.
    const written: Record<string, string> = {};
    writePreviewPref(PREVIEW_OPEN_KEY, "0", { setItem: (k: string, v: string) => { written[k] = v; } });
    expect(written).toEqual({ "care.reportPreview.open": "0" });
    expect(() => writePreviewPref(PREVIEW_WIDTH_KEY, "34", {
      setItem() { throw new Error("QuotaExceeded"); },
    })).not.toThrow();
  });
});
