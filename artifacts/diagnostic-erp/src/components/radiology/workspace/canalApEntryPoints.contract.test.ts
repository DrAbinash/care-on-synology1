/**
 * RIS-013 DECISION 3 (owner, 2026-10-17) — "Keep one measurement entry point:
 * Measure → AP Canal Measurements (mm). Keep the retired ReportCanvas block disabled.
 * Audit the old AI-tab measurement box. Remove duplicate active entry controls only
 * after proving no existing saved measurement or reporting workflow depends on them."
 *
 * Measured, not assumed:
 *  - The live canal AP grid is the rail's Measure tab (`ReportingToolsRail.tsx`,
 *    section `canal-ap-measurements-section`), gated by the same four predicates the
 *    canvases use, so an examination earns exactly the tables it has.
 *  - `ReportCanvas.tsx` still contains `<SpineApCanalMeasurements …>` for lumbar and
 *    cervical. Both sit inside the `{false && (` block that retires the legacy inline
 *    assistance, so they render nothing. They are the duplicate controls the owner
 *    chose to keep disabled rather than delete, and this file is what notices if that
 *    block is ever re-enabled.
 *  - The AI-tab box (`SpineCanalApBox`, mounted by `CopilotRail` on the rail's AI pane)
 *    is NOT a duplicate of that grid: it is the only caller of the store's viewer-capture
 *    action, and the only writer of the legacy `spinal_measurements` rows the print fold
 *    still reads. So the owner's removal condition is unproven and the box stays.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../../../.."); // artifacts/diagnostic-erp
const read = (abs: string) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

const CANVAS = resolve(here, "ReportCanvas.tsx");
const RAIL = resolve(here, "ReportingToolsRail.tsx");

/** Every canal AP grid the reporting canvas mounts, by index in the source. */
function canalMountIndices(src: string): number[] {
  const out: number[] = [];
  for (const tag of ["<SpineApCanalMeasurements", "<DorsoLumbarApCanalMeasurements"]) {
    let i = src.indexOf(tag);
    while (i !== -1) {
      out.push(i);
      i = src.indexOf(tag, i + tag.length);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * The retired legacy-assistance block: `{false && (` followed by its `<div>`, closed at the
 * matching `)}`. Found by delimiters rather than a character budget, so a longer comment above
 * or inside it cannot silently shrink the slice and make the test pass vacuously.
 */
function retiredBlockSpan(src: string): { start: number; end: number } | null {
  const open = src.indexOf("{false && (");
  if (open === -1) return null;
  let depth = 0;
  for (let i = open + "{false && ".length; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return { start: open, end: i + 1 };
      depth--;
    }
  }
  return null;
}

function liveCanalMounts(src: string): number[] {
  const span = retiredBlockSpan(src);
  return canalMountIndices(src).filter((i) => !(span && i > span.start && i < span.end));
}

describe("the reporting canvas holds no live canal AP grid", () => {
  const canvas = read(CANVAS);

  it("mounts the two grids it historically did, and no more", () => {
    // A third mount would have to be adjudicated against the rail rather than added quietly.
    expect(canalMountIndices(canvas)).toHaveLength(2);
  });

  it("keeps both of them inside the permanently-disabled legacy block", () => {
    expect(liveCanalMounts(canvas), "a canal grid rendered in the canvas duplicates the Measure tab")
      .toEqual([]);
  });

  it("reads the block it excludes as the real retired region", () => {
    // Positive control for the slice: the retired block is the legacy inline-assistance
    // surface, which is where these grids used to live. An empty or mis-bounded slice would
    // make the assertion above pass while the grids were actually on screen.
    const span = retiredBlockSpan(canvas);
    expect(span).not.toBeNull();
    const block = canvas.slice(span!.start, span!.end);
    expect(block).toContain("<ChocolateBoxMacros");
    expect(block).toContain("<FindingsAnatomyStrip");
    expect(block).toContain('<SpineApCanalMeasurements segment="lumbar"');
    expect(block).toContain('<SpineApCanalMeasurements segment="cervical"');
    expect(block.length, "the retired block is implausibly small").toBeGreaterThan(8_000);
  });

  it("reports the same grids as live the moment the block is re-enabled", () => {
    // Mutation control for the helper itself: `false &&` is the only thing retiring them, so
    // swapping it for a flag must flip this file's verdict. Without it, "no live mounts" could
    // be the helper failing to see the block at all.
    const reEnabled = canvas.replace("{false && (", "{showLegacyAssistance && (");
    expect(reEnabled).not.toBe(canvas);
    const live = liveCanalMounts(reEnabled);
    expect(live, "un-retiring the canvas block must resurrect both grids").toHaveLength(2);
    expect(reEnabled.slice(live[0], live[0] + 45)).toContain('segment="lumbar"');
    expect(reEnabled.slice(live[1], live[1] + 45)).toContain('segment="cervical"');
  });

  it("never mounts the dorso-lumbar table, which only the rail gates", () => {
    expect(canvas).not.toContain("<DorsoLumbarApCanalMeasurements");
  });
});

describe("the live entry point is the rail's Measure tab alone", () => {
  const rail = read(RAIL);

  it("offers one canal section, under one heading", () => {
    expect((rail.match(/data-testid="canal-ap-measurements-section"/g) ?? []).length).toBe(1);
    expect(rail).toContain("AP Canal Measurements (mm)");
  });

  it("has no second copy anywhere else in the workspace surface", () => {
    // The canvas is the file that used to carry one; nothing else may start carrying one.
    expect(read(CANVAS)).not.toContain('data-testid="canal-ap-measurements-section"');
  });
});

/**
 * DECISION 3 asks for an audit of the AI-tab box before anything is removed, and the removal
 * is gated on proving nothing depends on it. These two facts are the dependency: they are
 * censused from the source tree, so a removal that drops either capability fails here instead
 * of silently costing the clinic a measurement path.
 */
describe("the AI-tab measurement box is still load-bearing", () => {
  const listTs = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) out.push(...listTs(abs));
      else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) out.push(abs);
    }
    return out;
  };
  const files = listTs(resolve(pkgRoot, "src"));
  const relative = (abs: string) =>
    abs.slice(pkgRoot.length + 1).replace(/\\/g, "/").replace(/^src\//, "");
  const containing = (needle: string) =>
    files
      .filter((f) => read(f).includes(needle))
      .map(relative)
      .sort();

  it("is the only path that captures an OHIF caliper into the canonical record", () => {
    // The needle is the call form, so store.ts — which declares and implements the action but
    // never invokes it — is not in this list. The box is the only file that calls it. Delete the
    // box and viewer numbers stop reaching the record the signed report prints from.
    expect(containing("recordCanalApViewerValue(")).toEqual(["components/radiology/SpineCanalApBox.tsx"]);
    expect(read(resolve(pkgRoot, "src/lib/zai-workspace/store.ts"))).toContain("recordCanalApViewerValue: (write) => {");
  });

  it("is the only reporting-workspace writer of the legacy spinal-measurement rows", () => {
    // Scoped to the workspace surface on purpose. The legacy generator page keeps its own panel
    // (asserted below), so the store is shared, but the box is the only way a number can be
    // entered into it while reporting. The print fold (mergeCanalApLevels) still reads those
    // rows, so removing the box would leave a saved legacy measurement with no way to correct it.
    const inWorkspace = (list: string[]) =>
      list.filter(
        (f) => f.startsWith("components/radiology/") || f.startsWith("hooks/radiology-workspace/"),
      );
    const legacyPost = 'api.post("/api/radiology/report-generator/spinal-measurements"';
    expect(inWorkspace(containing(legacyPost))).toEqual(["components/radiology/SpineCanalApBox.tsx"]);
    expect(inWorkspace(containing("/api/radiology/report-generator/spinal-measurements?studyId=")))
      .toEqual([
        "components/radiology/SpineCanalApBox.tsx",
        "hooks/radiology-workspace/useWorkspaceExportShare.ts",
      ]);
  });

  it("leaves the legacy generator page's own panel exactly as it was", () => {
    // Not part of the reporting workspace, and not in DECISION 3's scope — named here so the
    // audit cannot be read as "the legacy store has no other writer".
    const panel = read(resolve(pkgRoot, "src/components/SpinalMeasurementPanel.tsx"));
    expect(panel).toContain('api.post<SpinalMeasurement>("/api/radiology/report-generator/spinal-measurements"');
    expect(read(resolve(pkgRoot, "src/pages/RadiologyReportGenerator.tsx"))).toContain("<SpinalMeasurementPanel");
  });

  it("is mounted, so it is a control the radiologist can actually reach", () => {
    expect(read(resolve(pkgRoot, "src/components/radiology/zai-workspace/copilot-rail.tsx")))
      .toContain("<SpineCanalApBox");
    expect(read(RAIL)).toContain("<CopilotRail");
  });
});
