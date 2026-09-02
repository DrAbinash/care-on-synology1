/**
 * Tests: MRI Cervical/Dorsal Canvas + AP Measurements + Format Library Expansion.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  MRI_CERVICAL_DISC_LEVELS,
  MRI_DORSAL_DISC_LEVELS,
  CERVICAL_AP_LEVELS,
  LUMBAR_AP_LEVELS,
  DORSAL_AP_LEVELS,
  createCervicalApSet,
  createLumbarApSet,
  createDorsalApSet,
  formatApMeasurements,
  isMriCervicalReportingContext,
  isMriDorsalReportingContext,
  inferCervicalExitingRoot,
  inferCervicalTraversingRoot,
} from "@/lib/mriSpineCanvasRegions";

function resetWorkspace(region = "LS Spine") {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "",
    techniqueText: "", clinicalHistoryText: "",
    fieldProvenance: {}, appliedPathologyPatches: [],
    voiceComposerObservations: [], voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null, confirmOverwriteOpen: false, pendingPathologyPatch: null,
    isFinalized: false, isDirty: false, impressionNeedsRefresh: false,
    selectedObservationId: null, structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [], ledgerHydrationWarning: null,
    appliedFormatReportTitle: null, appliedFormatName: null,
    activeAnchor: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: `MRI ${region}`,
      regions: [region], source: "auto",
    }),
  });
}

describe("MRI Cervical/Dorsal Canvas — region definitions", () => {
  it("Cervical disc levels are C2-C3 through C7-T1", () => {
    const levels = MRI_CERVICAL_DISC_LEVELS.map((l) => l.key);
    expect(levels).toEqual(["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"]);
  });

  it("Dorsal disc levels are T1-T2 through T12-L1", () => {
    const levels = MRI_DORSAL_DISC_LEVELS.map((l) => l.key);
    expect(levels).toEqual([
      "T1-T2", "T2-T3", "T3-T4", "T4-T5", "T5-T6", "T6-T7",
      "T7-T8", "T8-T9", "T9-T10", "T10-T11", "T11-T12", "T12-L1",
    ]);
  });

  it("Cervical and dorsal levels are distinct", () => {
    const cKeys = new Set(MRI_CERVICAL_DISC_LEVELS.map((l) => l.key));
    const dKeys = new Set(MRI_DORSAL_DISC_LEVELS.map((l) => l.key));
    for (const k of cKeys) {
      expect(dKeys.has(k as never)).toBe(false);
    }
  });
});

describe("MRI Cervical/Dorsal Canvas — activation context", () => {
  it("Cervical Spine activates cervical canvas", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "Cervical Spine", spineSegment: "cervical",
    })).toBe(true);
  });

  it("LS Spine does NOT activate cervical canvas", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "LS Spine", spineSegment: "lumbar",
    })).toBe(false);
  });

  it("Dorsal Spine activates dorsal canvas", () => {
    expect(isMriDorsalReportingContext({
      modality: "MR", region: "Dorsal Spine", spineSegment: "dorsal",
    })).toBe(true);
  });

  it("Whole Spine does NOT activate cervical or dorsal canvas", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "Whole Spine", spineSegment: "whole",
    })).toBe(false);
    expect(isMriDorsalReportingContext({
      modality: "MR", region: "Whole Spine", spineSegment: "whole",
    })).toBe(false);
  });

  it("Brain does NOT activate spine canvas", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "Brain", family: "brain",
    })).toBe(false);
  });
});

describe("MRI Cervical/Dorsal Canvas — AP measurements", () => {
  it("Cervical AP levels are C2-C3 through C6-C7", () => {
    expect([...CERVICAL_AP_LEVELS]).toEqual(["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7"]);
  });

  it("Lumbar AP levels are L1-L2 through L5-S1", () => {
    expect([...LUMBAR_AP_LEVELS]).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
  });

  it("Dorsal AP levels are T1-T2 through T12-L1", () => {
    expect([...DORSAL_AP_LEVELS]).toEqual([
      "T1-T2", "T2-T3", "T3-T4", "T4-T5", "T5-T6", "T6-T7",
      "T7-T8", "T8-T9", "T9-T10", "T10-T11", "T11-T12", "T12-L1",
    ]);
  });

  it("createCervicalApSet creates null values for all levels", () => {
    const set = createCervicalApSet();
    expect(set.segment).toBe("cervical");
    expect(set.levels).toHaveLength(5);
    expect(set.levels.every((l) => l.value === null)).toBe(true);
  });

  it("formatApMeasurements formats correctly", () => {
    const set = createLumbarApSet();
    set.levels[0]!.value = 15;
    set.levels[1]!.value = 12;
    const text = formatApMeasurements(set);
    expect(text).toContain("Lumbar Canal AP Diameter");
    expect(text).toContain("L1-L2: 15 mm");
    expect(text).toContain("L2-L3: 12 mm");
  });

  it("formatApMeasurements returns empty when no values", () => {
    const set = createCervicalApSet();
    expect(formatApMeasurements(set)).toBe("");
  });

  it("measurements do not affect slot identity", () => {
    // AP measurements are data, not identity. Two observations at L4-L5
    // with different AP values share the same slotKey.
    resetWorkspace("LS Spine");
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5. AP canal 12 mm." },
      templates: { findings: "Disc bulge at L4-L5. AP canal 12 mm." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5. AP canal 12 mm.", id: "qs-bulge-1",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5. AP canal 10 mm." },
      templates: { findings: "Disc bulge at L4-L5. AP canal 10 mm." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5. AP canal 10 mm.", id: "qs-bulge-2",
    });
    // Same slot → one replaces the other (not two coexisting)
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5");
    expect(contour).toHaveLength(1);
  });
});

describe("MRI Cervical/Dorsal Canvas — root inference", () => {
  it("C5 exiting root is C5", () => {
    expect(inferCervicalExitingRoot("C5-C6")).toBe("C5");
  });

  it("C5 traversing root is C6", () => {
    expect(inferCervicalTraversingRoot("C5-C6")).toBe("C6");
  });

  it("C7-T1 traversing root is T1", () => {
    expect(inferCervicalTraversingRoot("C7-T1")).toBe("T1");
  });
});

describe("MRI Cervical/Dorsal Canvas — cross-region observation safety", () => {
  beforeEach(() => resetWorkspace("LS Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("Cervical C4-C5 and C5-C6 coexist as distinct observations", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at C4-C5." },
      templates: { findings: "Disc bulge at C4-C5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C4-C5" },
      source: "quick-findings", region: "Cervical Spine", concept: "disc_contour",
      level: "C4-C5", findingsText: "Disc bulge at C4-C5.", id: "qs-c45",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at C5-C6." },
      templates: { findings: "Disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "Disc bulge at C5-C6.", id: "qs-c56",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour.length).toBe(2);
    const levels = contour.map((p) => p.observation?.level).sort();
    expect(levels).toEqual(["C4-C5", "C5-C6"]);
  });

  it("Same cervical level same concept replaces safely", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Mild disc bulge at C5-C6." },
      templates: { findings: "Mild disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "Mild disc bulge at C5-C6.", id: "qs-c56-mild",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Severe disc bulge at C5-C6." },
      templates: { findings: "Severe disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "Severe disc bulge at C5-C6.", id: "qs-c56-severe",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6");
    expect(contour).toHaveLength(1);
  });

  it("Cervical and lumbar observations cannot collide (different regions)", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at C5-C6." },
      templates: { findings: "Disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "Disc bulge at C5-C6.", id: "qs-c56",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5.", id: "qs-l45",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour.length).toBe(2);
  });

  it("Dorsal levels remain independent", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at T6-T7." },
      templates: { findings: "Disc bulge at T6-T7." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "T6-T7" },
      source: "quick-findings", region: "Dorsal Spine", concept: "disc_contour",
      level: "T6-T7", findingsText: "Disc bulge at T6-T7.", id: "qs-t67",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at T8-T9." },
      templates: { findings: "Disc bulge at T8-T9." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "T8-T9" },
      source: "quick-findings", region: "Dorsal Spine", concept: "disc_contour",
      level: "T8-T9", findingsText: "Disc bulge at T8-T9.", id: "qs-t89",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour.length).toBe(2);
  });

  it("Left and right foraminal observations coexist at same cervical level", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Left foraminal stenosis at C5-C6." },
      templates: { findings: "Left foraminal stenosis at C5-C6." },
      ownership: { conflictGroup: "foraminal_stenosis", concept: "foraminal_stenosis", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "foraminal_stenosis",
      level: "C5-C6", laterality: "left", supportsLaterality: true, properties: "side",
      findingsText: "Left foraminal stenosis at C5-C6.", id: "qs-c56-left",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Right foraminal stenosis at C5-C6." },
      templates: { findings: "Right foraminal stenosis at C5-C6." },
      ownership: { conflictGroup: "foraminal_stenosis", concept: "foraminal_stenosis", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "foraminal_stenosis",
      level: "C5-C6", laterality: "right", supportsLaterality: true, properties: "side",
      findingsText: "Right foraminal stenosis at C5-C6.", id: "qs-c56-right",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const foraminal = patches.filter((p) => p.observation?.concept === "foraminal_stenosis" && p.observation?.level === "C5-C6");
    expect(foraminal).toHaveLength(2);
  });

  it("AP measurements survive save/reopen", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5. AP canal diameter 12 mm." },
      templates: { findings: "Disc bulge at L4-L5. AP canal diameter 12 mm." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5. AP canal diameter 12 mm.", id: "qs-bulge-ap",
    });
    const before = useWorkspace.getState().serializeObservationLedger();
    useWorkspace.setState({ findingsText: "", appliedPathologyPatches: [] });
    useWorkspace.getState().hydrateObservationLedger(before);
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const bulge = patches.find((p) => p.observation?.concept === "disc_contour");
    expect(bulge).toBeDefined();
    expect(bulge!.lastRendered?.findings).toContain("12 mm");
  });
});

describe("Full Report Format Library — expansion count", () => {
  it("has at least 35 MRI formats (was 13 before expansion)", async () => {
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const mriFormats = DEFAULT_REPORT_FORMATS.filter((f) => f.modality === "MR");
    expect(mriFormats.length).toBeGreaterThanOrEqual(35); // 13 original + 22+ new
  });

  it("includes Fazekas 2 and 3", async () => {
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const names = DEFAULT_REPORT_FORMATS.map((f) => f.name);
    expect(names.some((n) => n.includes("Fazekas 2"))).toBe(true);
    expect(names.some((n) => n.includes("Fazekas 3"))).toBe(true);
  });

  it("includes Dorsal Spine Normal and Spondylodiscitis", async () => {
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const names = DEFAULT_REPORT_FORMATS.map((f) => f.name);
    expect(names.some((n) => n.includes("Dorsal Spine — Normal"))).toBe(true);
    expect(names.some((n) => n.includes("Spondylodiscitis"))).toBe(true);
  });

  it("includes LS Spine + Whole Spine Screening combined format", async () => {
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const names = DEFAULT_REPORT_FORMATS.map((f) => f.name);
    expect(names.some((n) => n.includes("LS Spine + Whole Spine Screening"))).toBe(true);
  });

  it("screening formats use 'limited' wording in technique or fragments", async () => {
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const screeningFormats = DEFAULT_REPORT_FORMATS.filter(
      (f) => f.protocolScope === "Screening" && f.modality === "MR",
    );
    expect(screeningFormats.length).toBeGreaterThan(0);
    for (const f of screeningFormats) {
      const combinedText = `${f.technique} ${f.findings}`;
      const hasWording = /limited/i.test(combinedText)
        || (f.techniqueFragments ?? []).some((tf) => /limited/i.test(tf.text));
      expect(hasWording, `Format "${f.name}" missing screening wording`).toBe(true);
    }
  });
});
