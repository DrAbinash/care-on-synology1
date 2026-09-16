import { describe, expect, it } from "vitest";
import {
  buildStartingCanvasChangeHighlights,
  clinicalTextHasHighlightMarkup,
  reconstructStartingCanvasBaseline,
  stripWorkspaceChangeDecoration,
  SCREENING_LIMITATION_TEXT,
  type StartingCanvasBaseline,
} from "./startingCanvasHighlight";
import type { AppliedPathologyPatch } from "./store";

const baseline: StartingCanvasBaseline = {
  formatName: "MRI LS Spine — Standard Normal",
  formatRevision: "r1",
  findings: "Normal lumbar lordosis is maintained.\nL4-L5: No significant disc bulge or protrusion is seen.\nSCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.",
  impression: "Normal MRI of the lumbosacral spine.",
  appliedAt: "2026-01-01T00:00:00.000Z",
};

function patch(partial: Partial<AppliedPathologyPatch> & { id: string }): AppliedPathologyPatch {
  return {
    ownership: { conflictGroup: "disc_contour", anatomicalSection: "L4-L5", concept: "disc_contour", level: "L4-L5" },
    templates: { findings: partial.lastRendered?.findings ?? "" },
    lastRendered: { findings: "" },
    source: "quick-select",
    ...partial,
  } as AppliedPathologyPatch;
}

describe("startingCanvasHighlight", () => {
  it("does not highlight unchanged baseline sentences", () => {
    const spans = buildStartingCanvasChangeHighlights({
      baseline,
      findingsText: baseline.findings,
      impressionText: baseline.impression,
      patches: [],
    });
    expect(spans).toEqual([]);
  });

  it("highlights+bolds known abnormal contributions", () => {
    const abnormal = "L4-L5: Diffuse disc bulge with thecal sac indentation.";
    const findings = baseline.findings.replace(
      "L4-L5: No significant disc bulge or protrusion is seen.",
      abnormal,
    );
    const spans = buildStartingCanvasChangeHighlights({
      baseline,
      findingsText: findings,
      impressionText: baseline.impression,
      patches: [
        patch({
          id: "abn-1",
          lastRendered: { findings: abnormal },
          source: "quick-select",
          observation: {
            id: "abn-1",
            region: "LS Spine",
            anatomicalSection: "L4-L5",
            concept: "disc_contour",
            conceptSource: "explicit",
            conflictGroup: "disc_contour",
            level: "L4-L5",
            laterality: "",
            state: "",
            severity: "",
            measurement: "",
            slotKey: "LS Spine|disc_contour|L4-L5|*",
            source: "quick-select",
            role: "finding",
            specificity: "study",
            sectionsOwned: ["findings"],
            createdAt: "",
            updatedAt: "",
          },
        }),
      ],
    });
    expect(spans.some((s) => s.kind === "known-abnormal" && s.bold && s.text === abnormal)).toBe(true);
  });

  it("highlights manual edits without bold / without classifying as abnormal", () => {
    const findings = baseline.findings.replace(
      "Normal lumbar lordosis is maintained.",
      "Mild loss of lumbar lordosis is noted.",
    );
    const spans = buildStartingCanvasChangeHighlights({
      baseline,
      findingsText: findings,
      impressionText: baseline.impression,
      patches: [],
    });
    const manual = spans.find((s) => s.text.includes("Mild loss"));
    expect(manual?.kind).toBe("manual-change");
    expect(manual?.bold).toBe(false);
  });

  it("does not treat screening limitation as a change", () => {
    const spans = buildStartingCanvasChangeHighlights({
      baseline,
      findingsText: baseline.findings,
      impressionText: baseline.impression,
      patches: [],
    });
    expect(spans.some((s) => s.text === SCREENING_LIMITATION_TEXT)).toBe(false);
  });

  it("strips workspace decoration from final HTML without removing clinical strong", () => {
    const html =
      '<p class="canvas-change-highlight known-abnormal-bold" data-canvas-change="1"><strong class="findings-abnormal">Disc bulge</strong></p>';
    const out = stripWorkspaceChangeDecoration(html);
    expect(out).toContain("<strong class=\"findings-abnormal\">Disc bulge</strong>");
    expect(out).not.toMatch(/canvas-change-highlight|data-canvas-change/);
    expect(clinicalTextHasHighlightMarkup("plain clinical text")).toBe(false);
  });

  it("reconstructs baseline when format revision matches and refuses on drift", () => {
    const ok = reconstructStartingCanvasBaseline({
      formatName: "MRI LS Spine — Standard Normal",
      baselineManifestRevision: "r1",
      format: {
        name: "MRI LS Spine — Standard Normal",
        findings: baseline.findings,
        impression: baseline.impression,
        baselineManifest: { revision: "r1" },
      },
    });
    expect(ok?.findings).toBe(baseline.findings);

    const drift = reconstructStartingCanvasBaseline({
      formatName: "MRI LS Spine — Standard Normal",
      baselineManifestRevision: "r-old",
      format: {
        name: "MRI LS Spine — Standard Normal",
        findings: baseline.findings,
        impression: baseline.impression,
        baselineManifest: { revision: "r1" },
      },
    });
    expect(drift).toBeNull();
  });
});
