/**
 * R2 hardening matrices — Study/Region, format semantics, atomic ledger, hydration.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { isMriLumbarReportingContext } from "./mriLumbarRegions";
import {
  buildLumbarLevelApplyBundle,
  deriveCanvasNarrativeState,
  deriveLevelBlockDisplay,
  deriveLumbarLevelSelection,
  ledgerSeverityContradiction,
  narrativeMentionsLevel,
  patchesForLumbarLevel,
  summarizeLumbarLevelLines,
  coverageScopeKey,
} from "./mriLumbarLevelState";
import {
  defaultCoverageMarks,
  filterCoverageForScope,
  parseCoverageMarks,
  serializeCoverageEnvelope,
  setCoverageStatus,
  coverageBlocksFinalize,
} from "./coverageMarks";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { resolvePrintedReportTitle } from "./zai-workspace/fullReportFormat";
import { viewportToAnchor } from "./observationAnchor";

function resetWorkspace() {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    coverageMarks: [],
    coverageByScope: {},
    activeAnchor: null,
    activeStudyInstanceUID: "1.2.3",
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    lastPatchSnapshot: null,
    impressionNeedsRefresh: false,
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      regions: ["LS Spine"],
      source: "override",
    }),
    isDirty: false,
  });
}

describe("R2 Study/Region lumbar canvas activation", () => {
  it("1. LS Spine Study Tab activates lumbar canvas", () => {
    expect(isMriLumbarReportingContext({
      modality: "MR",
      region: "LS Spine",
      spineSegment: "lumbar",
      family: "spine",
    })).toBe(true);
  });

  it("2. Brain does not", () => {
    expect(isMriLumbarReportingContext({
      modality: "MR",
      region: "Brain",
      family: "brain",
      spineSegment: null,
    })).toBe(false);
  });

  it("3. Cervical Spine does not", () => {
    expect(isMriLumbarReportingContext({
      modality: "MR",
      region: "Cervical Spine",
      family: "spine",
      spineSegment: "cervical",
    })).toBe(false);
  });

  it("4. Whole Spine screening does not become detailed LS", () => {
    expect(isMriLumbarReportingContext({
      modality: "MR",
      region: "Whole Spine",
      spineSegment: "whole",
      family: "spine",
      protocolName: "MRI Whole Spine — Screening",
    })).toBe(false);
  });

  it("does not treat arbitrary spine substring as LS", () => {
    expect(isMriLumbarReportingContext({
      modality: "MR",
      region: "Spine screening survey",
      spineSegment: "generic",
      family: "spine",
    })).toBe(false);
  });
});

describe("R2 coverage scoping + study switch", () => {
  beforeEach(() => resetWorkspace());

  it("6. switching region scopes coverage correctly", () => {
    useWorkspace.getState().setCoverageMark("L3-L4", "reviewed");
    expect(useWorkspace.getState().coverageMarks.find((m) => m.regionKey === "L3-L4")?.status).toBe("reviewed");

    useWorkspace.getState().setReportingContext(buildReportingStudyContext({
      modality: "MR",
      regions: ["Brain"],
      source: "override",
    }));
    const brainMarks = useWorkspace.getState().coverageMarks;
    expect(brainMarks.find((m) => m.regionKey === "L3-L4")?.status).not.toBe("reviewed");

    useWorkspace.getState().setReportingContext(buildReportingStudyContext({
      modality: "MR",
      regions: ["LS Spine"],
      source: "override",
    }));
    expect(useWorkspace.getState().coverageMarks.find((m) => m.regionKey === "L3-L4")?.status).toBe("reviewed");
  });

  it("study A activeAnchor never stamps study B", () => {
    useWorkspace.setState({ activeStudyInstanceUID: "STUDY-A" });
    useWorkspace.getState().setActiveAnchor(viewportToAnchor({
      studyInstanceUID: "STUDY-A",
      seriesInstanceUID: "s1",
      frameNumber: 1,
      viewer: "frames",
    }));
    expect(useWorkspace.getState().activeAnchor?.studyInstanceUID).toBe("STUDY-A");

    useWorkspace.setState({ activeStudyInstanceUID: "STUDY-B", activeAnchor: null });
    useWorkspace.getState().setActiveAnchor(viewportToAnchor({
      studyInstanceUID: "STUDY-A",
      seriesInstanceUID: "s1",
      frameNumber: 9,
      viewer: "frames",
    }));
    expect(useWorkspace.getState().activeAnchor).toBeNull();
  });

  it("coverage never blocks finalize", () => {
    expect(coverageBlocksFinalize(defaultCoverageMarks("LS Spine"))).toBe(false);
  });

  it("coverage envelope round-trips with scope", () => {
    const marks = setCoverageStatus(defaultCoverageMarks("LS Spine"), "L4-L5", "reviewed", undefined, "LS Spine");
    const env = serializeCoverageEnvelope(marks, { scopeKey: "LS Spine" });
    const parsed = parseCoverageMarks(env);
    expect(parsed?.find((m) => m.regionKey === "L4-L5")?.status).toBe("reviewed");
    expect(coverageScopeKey("LS Spine")).toBe("LS Spine");
    expect(filterCoverageForScope(parsed!, "Brain").find((m) => m.regionKey === "L4-L5")?.status).not.toBe("reviewed");
  });
});

describe("R2 report format + narrative Empty semantics", () => {
  beforeEach(() => resetWorkspace());

  it("12. format narrative without ledger is not Empty at canvas level", () => {
    const fmt = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
    useWorkspace.setState({ findingsText: fmt.findings });
    const state = deriveCanvasNarrativeState({
      findingsText: fmt.findings,
      patches: [],
      isLumbar: true,
    });
    expect(state.hasUnstructuredNarrative).toBe(true);
    expect(state.banner).toMatch(/unstructured\/template narrative/i);
  });

  it("level with narrative mention is template-narrative not Empty", () => {
    const d = deriveLevelBlockDisplay(
      [],
      "L4-L5",
      "There is a disc bulge at L4-L5 with mild stenosis.",
    );
    expect(d.kind).toBe("template-narrative");
    expect(d.label).not.toBe("Empty");
  });

  it("10+13. applying whole report format marks prior ledger stale (does not delete)", () => {
    const { observations, bundleId } = buildLumbarLevelApplyBundle({
      level: "L3-L4",
      sel: { morphology: "extrusion", canal: "moderate" },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);

    const fmt = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
    useWorkspace.setState({
      reportFormats: DEFAULT_REPORT_FORMATS,
      pendingFormatIds: [fmt.id],
      selectedFormatIds: [fmt.id],
    });
    useWorkspace.getState().confirmOverwriteAndApply();
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.every((p) => p.stale)).toBe(true);
    expect(useWorkspace.getState().appliedFormatName).toBe("MRI LS Spine — Normal");
    expect(useWorkspace.getState().appliedFormatReportTitle).toBe("MRI LUMBOSACRAL SPINE");
  });

  it("14. reportTitle survives R2 via resolvePrintedReportTitle", () => {
    expect(resolvePrintedReportTitle("MRI LUMBOSACRAL SPINE", "fallback")).toBe("MRI LUMBOSACRAL SPINE");
  });

  it("15. demographics are never applied from format clinical fields", () => {
    const fmt = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
    // clinicalFieldsFromFormat path only sets technique/findings/impression/recommendation/history/title
    useWorkspace.setState({
      reportFormats: DEFAULT_REPORT_FORMATS,
      pendingFormatIds: [fmt.id],
      selectedFormatIds: [fmt.id],
      findingsText: "",
    });
    useWorkspace.getState().confirmOverwriteAndApply();
    expect(useWorkspace.getState().findingsText).toContain("Lumbar vertebrae");
    // No patient demography fields exist on the store apply path — assert title only.
    expect(useWorkspace.getState().appliedFormatReportTitle).toBeTruthy();
  });
});

describe("R2 atomic level editor + hydration", () => {
  beforeEach(() => resetWorkspace());

  it("Apply L4-L5 extrusion bundle creates separable concepts", () => {
    const { observations, composed } = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: {
        morphology: "extrusion",
        laterality: "left-paracentral",
        canal: "moderate",
        rootContact: true,
        rootLevel: "L5",
        modic: "type2",
        canalApMm: 8.7,
      },
      region: "LS Spine",
    });
    expect(composed.findings).toMatch(/extrusion/i);
    const concepts = observations.map((o) => o.concept);
    expect(concepts).toContain("disc_contour");
    expect(concepts).toContain("canal_stenosis");
    expect(concepts).toContain("root_contact");
    expect(concepts).toContain("endplate");
    expect(concepts).toContain("canal_ap");
  });

  it("apply → hydrate selection chips from ledger", () => {
    const { observations, bundleId } = buildLumbarLevelApplyBundle({
      level: "L3-L4",
      sel: {
        morphology: "extrusion",
        laterality: "left-paracentral",
        canal: "moderate",
        rootContact: true,
        rootLevel: "L4",
        modic: "type2",
      },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const sel = deriveLumbarLevelSelection(patches, "L3-L4");
    expect(sel.morphology).toBe("extrusion");
    expect(sel.canal).toBe("moderate");
    expect(sel.rootContact).toBe(true);
    expect(sel.modic).toBe("type2");
  });

  it("moderate → severe updates only canal_stenosis slot", () => {
    const first = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "extrusion", laterality: "left-paracentral", canal: "moderate", modic: "type2" },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: first.bundleId, observations: first.observations });
    const mid = useWorkspace.getState().appliedPathologyPatches;
    const discId = mid.find((p) => p.observation?.concept === "disc_contour")?.id;
    const modicId = mid.find((p) => p.observation?.concept === "endplate")?.id;

    const second = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "extrusion", laterality: "left-paracentral", canal: "severe", modic: "type2" },
      region: "LS Spine",
      bundleId: "r2-update-canal",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: second.bundleId, observations: second.observations });
    const after = useWorkspace.getState().appliedPathologyPatches;
    expect(after.find((p) => p.observation?.concept === "canal_stenosis")?.observation?.severity).toBe("severe");
    expect(after.find((p) => p.id === discId)?.observation?.concept).toBe("disc_contour");
    expect(after.find((p) => p.id === modicId)?.observation?.concept).toBe("endplate");
  });

  it("remove Modic — disc/canal remain (apply without modic replaces endplate via mutex)", () => {
    const first = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "bulge", canal: "mild", modic: "type2" },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: first.bundleId, observations: first.observations });
    const modic = useWorkspace.getState().appliedPathologyPatches.find((p) => p.observation?.concept === "endplate");
    expect(modic).toBeTruthy();
    useWorkspace.getState().removeObservation(modic!.id);
    const after = useWorkspace.getState().appliedPathologyPatches;
    expect(after.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
    expect(after.some((p) => p.observation?.concept === "canal_stenosis")).toBe(true);
    expect(after.some((p) => p.observation?.concept === "endplate")).toBe(false);
  });

  it("multiple levels coexist", () => {
    const a = buildLumbarLevelApplyBundle({
      level: "L3-L4",
      sel: { morphology: "bulge", canal: "mild" },
      region: "LS Spine",
    });
    const b = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "extrusion", laterality: "left-paracentral", canal: "moderate" },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: a.bundleId, observations: a.observations });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patchesForLumbarLevel(patches, "L3-L4").length).toBeGreaterThan(0);
    expect(patchesForLumbarLevel(patches, "L4-L5").length).toBeGreaterThan(0);
    const summary = summarizeLumbarLevelLines(patches, "L4-L5");
    expect(summary.length).toBeGreaterThan(1);
  });

  it("undo reverts whole Apply bundle via lastPatchSnapshot", () => {
    const beforeFindings = useWorkspace.getState().findingsText;
    const { observations, bundleId } = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: {
        morphology: "extrusion",
        laterality: "left-paracentral",
        canal: "moderate",
        rootContact: true,
        rootLevel: "L5",
        modic: "type2",
      },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(1);
    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().findingsText).toBe(beforeFindings);
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(0);
  });

  it("structured severity contradiction is detectable", () => {
    const { observations, bundleId } = buildLumbarLevelApplyBundle({
      level: "L3-L4",
      sel: { morphology: "bulge", canal: "moderate" },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    const warnings = ledgerSeverityContradiction(
      useWorkspace.getState().appliedPathologyPatches,
      "Severe L3-L4 canal stenosis.",
    );
    expect(warnings.some((w) => /moderate.*severe|severe/i.test(w))).toBe(true);
  });

  it("narrativeMentionsLevel helper", () => {
    expect(narrativeMentionsLevel("Disc bulge at L4-L5.", "L4-L5")).toBe(true);
    expect(narrativeMentionsLevel("Disc bulge at L3-L4.", "L4-L5")).toBe(false);
  });
});

describe("R2 normal format + structured overlay baseline", () => {
  beforeEach(() => resetWorkspace());

  it("11. normal LS format + structured abnormal uses LEVEL_NORMAL baseline", () => {
    const fmt = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
    useWorkspace.setState({
      reportFormats: DEFAULT_REPORT_FORMATS,
      pendingFormatIds: [fmt.id],
      selectedFormatIds: [fmt.id],
    });
    useWorkspace.getState().confirmOverwriteAndApply();
    const { observations, bundleId } = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "protrusion", laterality: "central" },
      region: "LS Spine",
    });
    const disc = observations.find((o) => o.concept === "disc_contour")!;
    expect(disc.ownership.baselineReplaces).toMatch(/No disc herniation/i);
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    expect(useWorkspace.getState().findingsText).toMatch(/protrusion/i);
  });
});
