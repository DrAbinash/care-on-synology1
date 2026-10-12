/**
 * autoBootstrapRegionProvenance.test.ts — the report that opens itself is not an override.
 *
 * Measured in a real browser before this file existed: opening a billed MRI study marked
 * its own region as a manual override. The auto-open normal bootstrap
 * (`resolveNormalBootstrapFormat` in `useWorkspaceClinicalUi.tsx`) calls the same applyFormatById the radiologist's
 * Quick Normal button calls, and that path resolves a region off the FORMAT and writes it
 * through the apply bridge into `selectPrimaryRegion` → `regionOverrides`. The study then
 * reports `source: "override"` although nobody chose anything, which is the one piece of
 * provenance the billed code is supposed to keep: the region the centre billed is what
 * the report is about.
 *
 * The fix has to keep both halves, so both are asserted: an automatic apply must not
 * claim the region, and a radiologist's apply must still sync it. Without the second the
 * first would pass by deleting the feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { setFormatApplyBridge } from "@/lib/zai-workspace/formatApplyBridge";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const CATALOG = ["Brain", "Cervical Spine", "LS Spine", "Knee", "Whole Spine"];

let regionWrites: string[] = [];
let autosaveBumps = 0;

function armBridge() {
  regionWrites = [];
  autosaveBumps = 0;
  setFormatApplyBridge({
    availableRegions: () => CATALOG,
    currentRegion: () => "LS Spine",
    applyReportingRegion: (regionName) => { regionWrites.push(regionName); },
    invalidatePendingAutosave: () => { autosaveBumps += 1; },
  });
}

function emptyReport(ctx = buildReportingStudyContext({
  modality: "MR",
  studyDescription: "MRI LS SPINE",
  regions: ["LS Spine"],
  source: "billed",
})) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    selectedFormatIds: [], pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, confirmOverwriteOpen: false, mergePreviewOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    isFinalized: false, isDirty: false, reportingContext: ctx,
    reportFormats: DEFAULT_REPORT_FORMATS,
  });
  return ctx;
}

const liveBaselineRows = () =>
  useWorkspace.getState().appliedPathologyPatches.filter((p) => p.observation?.role === "baseline");

describe("the normal report that opens itself does not override the region", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    armBridge();
  });
  afterEach(() => {
    setFormatApplyBridge(null);
    vi.unstubAllGlobals();
  });

  it("writes no region when the apply is the auto-open bootstrap", () => {
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Standard Normal")!;
    emptyReport();
    useWorkspace.getState().applyFormatById(format.id, { regionChoice: "automatic" });
    expect(regionWrites, "the automatic bootstrap must not claim a region the radiologist never chose").toEqual([]);
    expect(useWorkspace.getState().pendingFormatRegion).toBeNull();
  });

  it("still syncs the region when the radiologist presses the same format", () => {
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Standard Normal")!;
    emptyReport();
    useWorkspace.getState().applyFormatById(format.id);
    expect(regionWrites).toEqual(["LS Spine"]);
  });

  it("puts the whole report on the page either way — the fix is the claim, not the content", () => {
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Standard Normal")!;
    emptyReport();
    useWorkspace.getState().applyFormatById(format.id, { regionChoice: "automatic" });
    const s = useWorkspace.getState();
    expect(s.findingsText.length).toBeGreaterThan(200);
    expect(s.appliedFormatName).toBe(format.name);
    expect(liveBaselineRows().length).toBeGreaterThan(0);
  });

  it("stamps the owned baseline with the billed region, not with a region it just invented", () => {
    // The study is billed LS Spine; the format applied is a Cervical Spine normal. An
    // automatic apply takes no region decision, so the rows land on what the context
    // already resolved from the billed code.
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Cervical Spine — Standard Normal")!;
    const ctx = emptyReport();
    useWorkspace.getState().applyFormatById(format.id, { regionChoice: "automatic" });
    const regions = [...new Set(liveBaselineRows().map((p) => p.observation?.region))];
    expect(regions).toEqual([ctx.region]);
    expect(regionWrites).toEqual([]);
  });

  it("keeps the billing authority visible: no override means the source stays billed", () => {
    const ctx = buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS SPINE", regions: ["LS Spine"], source: "billed",
    });
    expect(ctx.source).toBe("billed");
    // The UI's `override` label is reached only through regionOverrides, which the
    // automatic path no longer writes; this is the mapping the browser test checks.
    const overridden = buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS SPINE", regions: ["Cervical Spine"], source: "override",
    });
    expect(overridden.source).toBe("override");
  });
});

/**
 * The behaviour above lives in the store, but the defect lives in WHO CALLS IT. Only
 * the mount-time effect may opt out; every press of a button must still sync the
 * region. A browser proves that today, and no browser runs in CI, so the call sites
 * are pinned at source too — same convention as `startReportDelegation.contract.test.ts`:
 * each slice is bounded on syntactic markers, never a character budget, and carries a
 * positive control so an empty slice fails instead of passing on nothing.
 */
describe("the opt-out belongs to the mount-time bootstrap and to nobody else", () => {
  const read = (...p: string[]) =>
    readFileSync(resolve(__dirname, ...p), "utf8").replace(/\r\n/g, "\n");
  const CLINICAL_UI = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
  const USER_INITIATED = {
    "Quick Normal": read("../components/radiology/workspace/ReportCanvas.tsx"),
    abnormalStrip: read("../components/radiology/MriAbnormalFormatStrip.tsx"),
    wholeReportControl: read("../components/radiology/WholeReportFormatControl.tsx"),
    formatPicker: read("../components/radiology/zai-workspace/report-format-picker.tsx"),
  };

  function autoOpenBootstrapBody(): string {
    const start = CLINICAL_UI.indexOf("const decision = resolveNormalBootstrapFormat({");
    expect(start, "auto-open bootstrap: could not find its resolver call").toBeGreaterThanOrEqual(0);
    const end = CLINICAL_UI.indexOf("setCanUndoStartReport(true);", start);
    expect(end, "auto-open bootstrap: no end marker after it").toBeGreaterThan(start);
    const body = CLINICAL_UI.slice(start, end);
    expect(body.length, "auto-open bootstrap: sliced an empty body").toBeGreaterThan(200);
    return body;
  }

  it("applies its format exactly once, and that apply opts out of the region", () => {
    const body = autoOpenBootstrapBody();
    const applies = [...body.matchAll(/applyFormatById\(/g)];
    expect(applies.length, "the bootstrap must make exactly one format apply").toBe(1);
    const callArgs = body.slice(applies[0]!.index + "applyFormatById(".length);
    const args = callArgs.slice(0, callArgs.indexOf("});") + 1);
    expect(args, `bootstrap apply must name the region choice, got: ${args}`).toContain(
      'regionChoice: "automatic"',
    );
  });

  it("leaves every radiologist-initiated apply on the region-syncing default", () => {
    for (const [label, src] of Object.entries(USER_INITIATED)) {
      expect(src, `${label}: a press must not opt out of the region`).not.toContain("regionChoice");
      for (const m of src.matchAll(/applyFormatById\(([^)]*)\)/g)) {
        expect(m[1], `${label}: this apply carries an options object`).not.toMatch(/\{/);
      }
    }
  });

  it("keeps the picker's Apply on the store method without handing it the click event", () => {
    const picker = USER_INITIATED.formatPicker;
    // Positive control: the picker really does hold the store's apply as `apply`.
    expect(picker).toContain("const apply = useWorkspaceSelector(s => s.applySelectedFormats)");
    // `onClick={apply}` passes the MouseEvent as `opts`, which is how a press could
    // silently arrive looking automatic (or not) depending on the event's shape.
    expect(picker, "a bare handler reference forwards the click event into opts").not.toContain(
      "onClick={apply}",
    );
  });
});
