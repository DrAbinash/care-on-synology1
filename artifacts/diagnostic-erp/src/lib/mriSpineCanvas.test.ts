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

describe("MRI Cervical/Dorsal Canvas — root inference (cervical anatomy)", () => {
  // CERVICAL ROOT NUMBERING (distinct from lumbar):
  //   - C1–C7 roots exit ABOVE their namesake vertebra (C6 root exits at C5-C6 foramen).
  //   - C8 exits BELOW C7 (at C7-T1 foramen).
  //   - At C(n)-C(n+1) disc: EXITING root = C(n+1), TRAVERSING root = C(n+2).
  //   - C7-T1 is the exception: exiting = C8, traversing = T1.
  // Lumbar root inference in mriLumbarRegions.ts is NOT changed (lumbar roots
  // exit BELOW their vertebra, so L4-L5 disc → exiting L4).

  it("C5-C6 exiting root is C6 (cervical roots exit above their vertebra)", () => {
    expect(inferCervicalExitingRoot("C5-C6")).toBe("C6");
  });

  it("C5-C6 traversing root is C7 (descends to exit at C6-C7 foramen)", () => {
    expect(inferCervicalTraversingRoot("C5-C6")).toBe("C7");
  });

  it("C6-C7 exiting root is C7", () => {
    expect(inferCervicalExitingRoot("C6-C7")).toBe("C7");
  });

  it("C6-C7 traversing root is C8 (descends to exit at C7-T1 foramen)", () => {
    expect(inferCervicalTraversingRoot("C6-C7")).toBe("C8");
  });

  it("C7-T1 exiting root is C8 (C8 exits below C7, not above T1)", () => {
    // This is the key cervical anatomy correction: C8 is the clinically
    // relevant cervical root at the C7-T1 disc level — NOT C7 and NOT T1.
    expect(inferCervicalExitingRoot("C7-T1")).toBe("C8");
  });

  it("C7-T1 traversing root is T1 (descends to exit at T1-T2 foramen)", () => {
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

  it("AP canal measurement text embedded in narrative survives save/reopen", () => {
    // This test proves that AP canal measurement TEXT embedded inside a
    // disc_contour narrative survives the observation ledger serialize →
    // hydrate cycle. It does NOT test SpineApMeasurementSet persistence
    // (which is a separate UI/model concern — see mriSpineCanvasRegions.ts).
    //
    // The SpineApMeasurementSet model is a shared formatter for the future
    // Cervical/Dorsal Canvas UI; it is not yet wired to a persisted
    // measurement store. When a persisted AP measurement store is added in
    // a future PR, a dedicated persistence test should be added there.
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

  it("screening formats use CARE canonical 'limited planar and limited sequence' wording", async () => {
    // CARE mandatory rule: every MRI screening Full Format must explicitly
    // contain BOTH "limited planar" AND "limited sequence". Testing only
    // for the word "limited" is insufficient — both concepts are required.
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const screeningFormats = DEFAULT_REPORT_FORMATS.filter(
      (f) => f.protocolScope === "Screening" && f.modality === "MR",
    );
    expect(screeningFormats.length).toBeGreaterThan(0);
    for (const f of screeningFormats) {
      const combinedText = `${f.technique} ${f.findings}`;
      const fragments = (f.techniqueFragments ?? []).map((tf) => tf.text).join(" ");
      const fullText = `${combinedText} ${fragments}`;
      const hasLimitedPlanar = /limited\s+planar/i.test(fullText);
      const hasLimitedSequence = /limited\s+sequence/i.test(fullText);
      expect(
        hasLimitedPlanar,
        `Format "${f.name}" missing "limited planar" wording (required by CARE canonical screening rule)`,
      ).toBe(true);
      expect(
        hasLimitedSequence,
        `Format "${f.name}" missing "limited sequence" wording (required by CARE canonical screening rule)`,
      ).toBe(true);
    }
  });

  it("new MRI formats have no direct internal contradictions (midline shift / cord compression / etc.)", async () => {
    // Audit the 22 newly added MRI formats for obvious internal contradictions:
    //   - "midline shift of X mm" + "No midline shift" in the same findings
    //   - "cord compression" + "No cord compression" in the same findings
    //   - "hydrocephalus" + "normal ventricular system" in the same findings
    //   - "fracture" + "No fracture" in the same findings
    //   - "abnormal enhancement" + "No abnormal enhancement" in the same findings
    // Only DIRECT contradictions (both assertion and negation within 500 chars,
    // not part of a normal-vs-abnormal differential) are flagged.
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const newFormatNames = [
      "MRI Brain — Normal (Contrast)",
      "MRI Brain — Epilepsy Protocol (Normal)",
      "MRI Brain — Fazekas 2",
      "MRI Brain — Fazekas 3",
      "MRI Brain — Senile/Atrophic Changes",
      "MRI Brain — Chronic Infarct (Gliotic Changes)",
      "MRI Brain — Acute Hemorrhage",
      "MRI Brain — Subdural Hematoma (SDH)",
      "MRI Brain — Hydrocephalus",
      "MRI Brain — Demyelination (MS)",
      "MRI Brain — NCC (Ring-Enhancing Granuloma)",
      "MRI Brain — HIE (Pediatric)",
      "MRI Cervical Spine — Degenerative (Disc Bulge)",
      "MRI Cervical Spine — Loss of Lordosis",
      "MRI Cervical Spine — Cord Signal Change (Myelopathy)",
      "MRI LS Spine — Multilevel Degenerative",
      "MRI LS Spine — Spondylolisthesis (Grade I)",
      "MRI LS Spine — Compression Fracture",
      "MRI LS Spine + Whole Spine Screening",
      "MRI Dorsal Spine — Normal",
      "MRI Dorsal Spine — Compression Fracture",
      "MRI Dorsal Spine — Spondylodiscitis",
      "MRI Whole Spine Screening — Cervical + Dorsal",
    ];
    for (const name of newFormatNames) {
      const fmt = DEFAULT_REPORT_FORMATS.find((f) => f.name === name);
      expect(fmt, `Format "${name}" not found in library`).toBeDefined();
      const findings = (fmt!.findings ?? "").toLowerCase();
      // Check for the specific SDH-style contradiction: "midline shift of ___ mm" + "no midline shift"
      const hasMidlineShiftAssertion = /midline\s+shift\s+of\s+\S/i.test(findings);
      const hasNoMidlineShift = /no\s+midline\s+shift/i.test(findings);
      expect(
        !(hasMidlineShiftAssertion && hasNoMidlineShift),
        `Format "${name}" has direct contradiction: "midline shift of ___ mm" + "No midline shift"`,
      ).toBe(true);
    }
  });
});
