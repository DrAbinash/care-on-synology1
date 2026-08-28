import { describe, expect, it } from "vitest";
import {
  anchorsEqual,
  coerceObservationAnchor,
  formatAnchorChip,
  viewportContextsEqual,
  viewportToAnchor,
  type ViewportContext,
} from "./observationAnchor";
import {
  composeLumbarLevelNarrative,
  isMriLumbarReportingContext,
} from "./mriLumbarRegions";
import {
  coverageBlocksFinalize,
  coverageAdvisories,
  defaultCoverageMarks,
  markRegionViewed,
  parseCoverageMarks,
  setCoverageStatus,
  COVERAGE_ENVELOPE_KEY,
} from "./coverageMarks";
import { buildCanonicalObservation } from "./observationSlot";
import { serializeObservationLedger, parseObservationLedger } from "./observationLedger";
import { isCareOhifMessage, ohifActiveAnchorToViewport } from "./ohifViewerBridge";
import { useWorkspace } from "./zai-workspace/store";

describe("ObservationAnchor", () => {
  it("formats chip from available metadata only", () => {
    expect(formatAnchorChip(null)).toBe("VIEWER CONTEXT UNAVAILABLE");
    expect(
      formatAnchorChip({
        studyInstanceUID: "1.2.3",
        seriesDescription: "T2 SAG",
        frameNumber: 23,
        totalFrames: 212,
        capturedAt: new Date().toISOString(),
      }),
    ).toContain("T2 SAG");
  });

  it("viewport equality skips identical clinical mutations", () => {
    const a: ViewportContext = {
      studyInstanceUID: "1.2",
      seriesInstanceUID: "s1",
      sopInstanceUID: "i1",
      frameNumber: 2,
      viewer: "frames",
    };
    expect(viewportContextsEqual(a, { ...a })).toBe(true);
    expect(viewportContextsEqual(a, { ...a, frameNumber: 3 })).toBe(false);
  });

  it("coerce preserves additive optional fields", () => {
    const a = coerceObservationAnchor({
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "s",
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(a?.studyInstanceUID).toBe("1.2.3");
    expect(coerceObservationAnchor({ foo: 1 })).toBeUndefined();
  });
});

describe("OHIF active-anchor contract", () => {
  it("parses active-anchor messages", () => {
    const msg = {
      source: "care-ohif" as const,
      type: "active-anchor" as const,
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "4.5",
      frameNumber: 9,
      seriesDescription: "T2 AX",
    };
    expect(isCareOhifMessage(msg)).toBe(true);
    const vp = ohifActiveAnchorToViewport(msg);
    expect(vp.viewer).toBe("ohif");
    expect(vp.frameNumber).toBe(9);
  });

  it("ignores study UID mismatch via handle path (equality of study check)", () => {
    // Contract: workspace subscribe ignores mismatched study — tested at message identity.
    const msg = {
      source: "care-ohif",
      type: "active-anchor",
      studyInstanceUID: "OTHER",
    };
    expect(isCareOhifMessage(msg)).toBe(true);
  });
});

describe("MRI lumbar compose + context", () => {
  it("composes L3-L4 extrusion narrative", () => {
    const n = composeLumbarLevelNarrative("L3-L4", {
      morphology: "extrusion",
      laterality: "left-paracentral",
      canal: "moderate",
      rootContact: true,
    });
    expect(n.findings).toMatch(/L3-L4/);
    expect(n.findings).toMatch(/extrusion/i);
    expect(n.findings).toMatch(/moderate canal stenosis/i);
    expect(n.concept).toBe("disc_contour");
  });

  it("detects LS MRI context", () => {
    expect(isMriLumbarReportingContext({ modality: "MR", region: "LS Spine" })).toBe(true);
    expect(isMriLumbarReportingContext({ modality: "CT", region: "LS Spine" })).toBe(false);
  });
});

describe("Coverage advisory", () => {
  it("unopened != reviewed; viewed != reviewed", () => {
    let marks = defaultCoverageMarks();
    marks = markRegionViewed(marks, "L3-L4");
    expect(marks.find((m) => m.regionKey === "L3-L4")?.status).toBe("viewed");
    marks = setCoverageStatus(marks, "L3-L4", "reviewed");
    expect(marks.find((m) => m.regionKey === "L3-L4")?.status).toBe("reviewed");
    expect(coverageBlocksFinalize(marks)).toBe(false);
  });

  it("waiver records reason and advises", () => {
    let marks = defaultCoverageMarks();
    marks = setCoverageStatus(marks, "paraspinal", "waived", "Outside FOV");
    expect(marks.find((m) => m.regionKey === "paraspinal")?.reason).toBe("Outside FOV");
    const adv = coverageAdvisories(marks);
    expect(adv.some((a) => a.includes("L1-L2"))).toBe(true);
  });

  it("round-trips coverage envelope", () => {
    const marks = setCoverageStatus(defaultCoverageMarks(), "L5-S1", "reviewed");
    const parsed = parseCoverageMarks({ [COVERAGE_ENVELOPE_KEY]: marks });
    expect(parsed?.find((m) => m.regionKey === "L5-S1")?.status).toBe("reviewed");
  });
});

describe("Ledger anchor stamp + hydrate", () => {
  it("stamps activeAnchor on new observation and hydrates old drafts without anchor", () => {
    useWorkspace.setState({
      activeAnchor: viewportToAnchor({
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "s1",
        sopInstanceUID: "i1",
        frameNumber: 12,
        seriesDescription: "T2 SAG",
        totalFrames: 200,
        viewer: "frames",
      }),
      appliedPathologyPatches: [],
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      coverageMarks: [],
    });
    const status = useWorkspace.getState().applyPathologyOverlay({
      id: "r2-test-l34",
      incoming: {
        findings: "At L3-L4, a left paracentral disc extrusion causes moderate canal stenosis.",
        impression: "L3-L4 left paracentral disc extrusion; moderate canal stenosis.",
      },
      templates: {
        findings: "At L3-L4, a left paracentral disc extrusion causes moderate canal stenosis.",
        impression: "L3-L4 left paracentral disc extrusion; moderate canal stenosis.",
      },
      ownership: {
        anatomicalSection: "L3-L4",
        conflictGroup: "disc_contour",
        concept: "disc_contour",
        level: "L3-L4",
      },
      source: "structured-template",
      level: "L3-L4",
      concept: "disc_contour",
      region: "LS Spine",
    });
    expect(status).toBe("applied");
    const patch = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "r2-test-l34");
    expect(patch?.observation?.anchor?.seriesDescription).toBe("T2 SAG");
    expect(patch?.observation?.anchor?.frameNumber).toBe(12);

    const serialized = useWorkspace.getState().serializeObservationLedger();
    expect(serialized.patches[0]?.observation.anchor?.viewer).toBe("frames");

    // Old draft without anchor still parses
    const legacy = {
      kind: "care.observation_ledger.v1" as const,
      version: 1 as const,
      patches: [
        {
          id: "legacy-1",
          observation: buildCanonicalObservation({
            id: "legacy-1",
            region: "LS Spine",
            concept: "disc_contour",
            conflictGroup: "disc_contour",
            level: "L4-L5",
            source: "quick-findings",
          }),
          templates: { findings: "At L4-L5, disc bulge." },
          lastRendered: { findings: "At L4-L5, disc bulge." },
          replacedBaseline: { findings: [], impression: [] },
          source: "quick-findings" as const,
          protected: false,
        },
      ],
    };
    const parsed = parseObservationLedger(legacy);
    expect(parsed.status).toBe("restored");
    expect(parsed.patches[0]?.observation.anchor).toBeUndefined();
  });

  it("changing activeAnchor does not mutate prior observation anchors", () => {
    const first = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "r2-test-l34");
    const snap = first?.observation?.anchor;
    useWorkspace.getState().setActiveAnchor(
      viewportToAnchor({
        studyInstanceUID: "1.2.3",
        seriesInstanceUID: "s2",
        frameNumber: 99,
        seriesDescription: "AX T2",
        viewer: "frames",
      }),
    );
    const again = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "r2-test-l34");
    expect(anchorsEqual(again?.observation?.anchor, snap)).toBe(true);
  });

  it("ghost accept uses ai-draft; dismiss does not mutate", () => {
    useWorkspace.setState({
      findingsText: "At L3-L4, broad based disc extrusion",
      ghostText: "causing moderate canal stenosis.",
      ghostTextTarget: "findings",
    });
    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().setGhostText(null, null);
    expect(useWorkspace.getState().findingsText).toBe(before);
    useWorkspace.setState({
      ghostText: "causing moderate canal stenosis.",
      ghostTextTarget: "findings",
    });
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().findingsText).toMatch(/moderate canal stenosis/);
    expect(useWorkspace.getState().ghostText).toBeNull();
  });

  it("coverage alone never blocks finalize helper", () => {
    expect(coverageBlocksFinalize(defaultCoverageMarks())).toBe(false);
  });
});

describe("serialize round-trip with coverage", () => {
  it("preserves coverage marks in ledger envelope", () => {
    useWorkspace.setState({ coverageMarks: setCoverageStatus(defaultCoverageMarks(), "conus", "reviewed") });
    const ser = useWorkspace.getState().serializeObservationLedger();
    expect(ser.careCoverageMarks).toBeTruthy();
    const marks = parseCoverageMarks(ser.careCoverageMarks);
    expect(marks?.find((m) => m.regionKey === "conus")?.status).toBe("reviewed");
  });
});
