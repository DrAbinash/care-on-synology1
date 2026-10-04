import { describe, expect, it } from "vitest";
import {
  buildAbnormalContributionSpans,
  buildStartingCanvasChangeHighlights,
  clinicalTextHasHighlightMarkup,
  reconstructStartingCanvasBaseline,
  stripWorkspaceChangeDecoration,
  workspaceOverlayPieceClasses,
  workspaceOverlayPieces,
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

  it("flags known abnormal contributions for colour, never for weight", () => {
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
    expect(spans.some((s) => s.kind === "known-abnormal" && s.abnormal && s.text === abnormal)).toBe(true);
  });

  it("highlights manual edits without colouring them abnormal", () => {
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
    expect(manual?.abnormal).toBe(false);
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

const abnormalFinding = "L4-L5: Diffuse disc bulge with thecal sac indentation.";
const abnormalImpression = "Disc bulge at L4-L5.";

function abnormalPatch(
  partial: Partial<AppliedPathologyPatch> = {},
): AppliedPathologyPatch {
  return patch({
    id: "abn-1",
    source: "quick-select",
    lastRendered: { findings: abnormalFinding, impression: abnormalImpression },
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
    ...partial,
  });
}

describe("abnormal contribution colour", () => {
  it("colours a box's abnormal line with no Starting Canvas to diff against", () => {
    // The case the owner cares about: report reopened / never started from a
    // complete normal, so the baseline diff has nothing to work with.
    const findings = `Mild facetal arthropathy.\n${abnormalFinding}`;
    const spans = buildAbnormalContributionSpans({
      findingsText: findings,
      impressionText: abnormalImpression,
      patches: [abnormalPatch()],
    });
    expect(spans).toEqual([
      { field: "findings", text: abnormalFinding, kind: "known-abnormal", abnormal: true },
      { field: "impression", text: abnormalImpression, kind: "known-abnormal", abnormal: true },
    ]);
  });

  it("does not invent colour for text that is not on the page", () => {
    const spans = buildAbnormalContributionSpans({
      findingsText: "Normal MRI of the lumbosacral spine.",
      impressionText: "",
      patches: [abnormalPatch()],
    });
    expect(spans).toEqual([]);
  });

  it("colours every assisted contribution and no hand-typed or spoken one", () => {
    const coloured = ["quick-select", "quick-findings", "structured-template", "macro"];
    const bare = ["manual", "radiologist-voice", "ai-draft", "system"];
    for (const source of coloured) {
      const spans = buildAbnormalContributionSpans({
        findingsText: abnormalFinding,
        impressionText: "",
        patches: [abnormalPatch({ source: source as never })],
      });
      expect({ source, fields: spans.map((s) => s.field) }).toEqual({
        source, fields: ["findings"],
      });
    }
    for (const source of bare) {
      const spans = buildAbnormalContributionSpans({
        findingsText: abnormalFinding,
        impressionText: "",
        patches: [abnormalPatch({ source: source as never })],
      });
      expect({ source, count: spans.length }).toEqual({ source, count: 0 });
    }
  });

  it("leaves baseline-role and stale contributions uncoloured", () => {
    const asBaseline = abnormalPatch({
      observation: { ...abnormalPatch().observation!, role: "baseline" },
    });
    expect(buildAbnormalContributionSpans({
      findingsText: abnormalFinding, impressionText: abnormalImpression, patches: [asBaseline],
    })).toEqual([]);

    expect(buildAbnormalContributionSpans({
      findingsText: abnormalFinding,
      impressionText: abnormalImpression,
      patches: [abnormalPatch({ stale: true })],
    })).toEqual([]);
  });

  it("paints the abnormal piece and leaves the rest of the line bare", () => {
    const findings = `Mild facetal arthropathy.\n${abnormalFinding}`;
    const pieces = workspaceOverlayPieces(
      findings,
      buildAbnormalContributionSpans({
        findingsText: findings,
        impressionText: "",
        patches: [abnormalPatch()],
      }),
      "findings",
    );
    expect(pieces.map((p) => p.text)).toEqual([
      "Mild facetal arthropathy.\n",
      abnormalFinding,
    ]);
    expect(pieces[0].highlight).toBe(false);
    expect(pieces[1]).toMatchObject({ highlight: true, abnormal: true });
  });

  it("separates abnormal from manual-change by colour, and never by weight", () => {
    const abnormal = workspaceOverlayPieceClasses({
      text: abnormalFinding,
      highlight: true,
      abnormal: true,
    });
    const manual = workspaceOverlayPieceClasses({
      text: "Mild loss of lumbar lordosis.",
      highlight: true,
      abnormal: false,
    });
    expect(abnormal).toContain("rose");
    expect(manual).toContain("amber");
    expect(abnormal).not.toContain(manual);

    // The overlay sits behind a transparent textarea and must line up with it
    // character for character; a heavier glyph is wider and the caret drifts.
    for (const cls of [abnormal, manual, workspaceOverlayPieceClasses({
      text: "x", highlight: false, abnormal: true,
    })]) {
      expect(cls).not.toMatch(/font-(bold|semibold|medium|extrabold|black)|font-\[|leading|tracking/);
    }
    expect(workspaceOverlayPieceClasses({ text: "x", highlight: false, abnormal: false })).toBe("");
  });
});
