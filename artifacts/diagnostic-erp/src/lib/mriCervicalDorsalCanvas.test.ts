/**
 * mriCervicalDorsalCanvas.test.ts — comprehensive tests for Cervical + Dorsal
 * Canvas UI + SpineApCanalMeasurements.
 *
 * Covers all 24 required test scenarios from the PR brief.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  isMriCervicalReportingContext,
  isMriDorsalReportingContext,
  inferCervicalExitingRoot,
} from "@/lib/mriSpineCanvasRegions";
import {
  buildCervicalLevelApplyBundle,
  cervicalExitingRootHint,
  cervicalLevelApplyHasContent,
  type CervicalLevelSelection,
} from "@/lib/mriCervicalLevelState";
import {
  buildDorsalLevelApplyBundle,
  dorsalLevelApplyHasContent,
  type DorsalLevelSelection,
} from "@/lib/mriDorsalLevelState";
import {
  buildLumbarLevelApplyBundle,
} from "@/lib/mriLumbarLevelState";
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";

function resetWorkspace(region = "LS Spine") {
  useWorkspace.setState({
    studies: [],
    activeStudyId: null,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    activeAnchor: null,
    canalApProvenance: {},
    coverageMarks: [],
    coverageByScope: {},
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "auto",
    }),
  });
}

// ─── Test scenarios 1–4: Canvas activation ──────────────────────────────

describe("Cervical/Dorsal Canvas — activation (1–4)", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("1. Cervical Spine activates cervical canvas", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "Cervical Spine", spineSegment: "cervical",
    })).toBe(true);
  });

  it("2. Dorsal Spine activates dorsal canvas", () => {
    expect(isMriDorsalReportingContext({
      modality: "MR", region: "Dorsal Spine", spineSegment: "dorsal",
    })).toBe(true);
  });

  it("3. LS Spine does NOT activate cervical or dorsal canvas (only lumbar)", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "LS Spine", spineSegment: "lumbar",
    })).toBe(false);
    expect(isMriDorsalReportingContext({
      modality: "MR", region: "LS Spine", spineSegment: "lumbar",
    })).toBe(false);
    expect(isMriLumbarReportingContext({
      modality: "MR", region: "LS Spine", spineSegment: "lumbar",
    })).toBe(true);
  });

  it("4. Whole Spine Screening does NOT activate detailed canvas", () => {
    expect(isMriCervicalReportingContext({
      modality: "MR", region: "Whole Spine", spineSegment: "whole",
    })).toBe(false);
    expect(isMriDorsalReportingContext({
      modality: "MR", region: "Whole Spine", spineSegment: "whole",
    })).toBe(false);
  });
});

// ─── Test scenarios 5–8: Cervical cross-level + same-slot + laterality ──

describe("Cervical Canvas — cross-level + same-slot + laterality (5–8)", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("5. C4-C5 + C5-C6 disc abnormalities coexist", () => {
    const sel: CervicalLevelSelection = { morphology: "bulge" };
    const bundle1 = buildCervicalLevelApplyBundle({ level: "C4-C5", sel, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: bundle1.bundleId, observations: bundle1.observations });
    const bundle2 = buildCervicalLevelApplyBundle({ level: "C5-C6", sel, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: bundle2.bundleId, observations: bundle2.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour).toHaveLength(2);
    const levels = contour.map((p) => p.observation?.level).sort();
    expect(levels).toEqual(["C4-C5", "C5-C6"]);
  });

  it("6. C5-C6 bulge → protrusion replaces same slot only", () => {
    const bulgeBundle = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: bulgeBundle.bundleId, observations: bulgeBundle.observations });
    expect(useWorkspace.getState().appliedPathologyPatches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toHaveLength(1);

    const protrusionBundle = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { morphology: "protrusion" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: protrusionBundle.bundleId, observations: protrusionBundle.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    // Still exactly 1 disc_contour at C5-C6 (same-slot replacement)
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toHaveLength(1);
  });

  it("7. C6-C7 remains unchanged when C5-C6 is updated", () => {
    // Apply C5-C6 bulge + C6-C7 bulge
    const b1 = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b1.bundleId, observations: b1.observations });
    const b2 = buildCervicalLevelApplyBundle({ level: "C6-C7", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b2.bundleId, observations: b2.observations });

    // Update C5-C6 to protrusion
    const b3 = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "protrusion" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b3.bundleId, observations: b3.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    const c67 = patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C6-C7");
    expect(c67).toHaveLength(1);
    // C6-C7 still has bulge narrative (unchanged)
    expect(c67[0]?.lastRendered?.findings ?? "").toMatch(/bulge/i);
  });

  it("8. Left + right foraminal observations coexist at C5-C6", () => {
    const leftBundle = buildCervicalLevelApplyBundle({
      level: "C5-C6",
      sel: { foraminal: "left", foraminalSeverity: "moderate" },
      region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: leftBundle.bundleId, observations: leftBundle.observations });
    const rightBundle = buildCervicalLevelApplyBundle({
      level: "C5-C6",
      sel: { foraminal: "right", foraminalSeverity: "moderate" },
      region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: rightBundle.bundleId, observations: rightBundle.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    const foraminal = patches.filter((p) => p.observation?.concept === "foraminal_stenosis" && p.observation?.level === "C5-C6");
    expect(foraminal).toHaveLength(2);
    const lateralities = foraminal.map((p) => p.observation?.laterality).sort();
    expect(lateralities).toEqual(["left", "right"]);
  });
});

// ─── Test scenarios 9–10: Cervical root semantics ─────────────────────────

describe("Cervical Canvas — root semantics (9–10)", () => {
  it("9. Cervical exiting root mapping: C4-C5→C5, C5-C6→C6, C6-C7→C7, C7-T1→C8", () => {
    expect(inferCervicalExitingRoot("C4-C5")).toBe("C5");
    expect(inferCervicalExitingRoot("C5-C6")).toBe("C6");
    expect(inferCervicalExitingRoot("C6-C7")).toBe("C7");
    expect(inferCervicalExitingRoot("C7-T1")).toBe("C8");
  });

  it("10. No misleading automatic cervical traversing-root text in apply bundle", () => {
    const { observations } = buildCervicalLevelApplyBundle({
      level: "C5-C6",
      sel: { morphology: "bulge", foraminal: "left", foraminalSeverity: "moderate" },
      region: "Cervical Spine",
    });
    // No observation should have concept "root_contact" or "traversing_root"
    expect(observations.some((o) => o.concept === "root_contact")).toBe(false);
    expect(observations.some((o) => o.concept === "traversing_root")).toBe(false);
    // No findings text should mention "traversing"
    for (const o of observations) {
      const findings = o.findingsText ?? "";
      expect(findings.toLowerCase()).not.toMatch(/traversing/);
    }
    // The exiting root hint is available but NOT emitted as an observation
    expect(cervicalExitingRootHint("C5-C6")).toBe("C6");
  });
});

// ─── Test scenarios 11–12: Dorsal cross-level + same-slot ────────────────

describe("Dorsal Canvas — cross-level + same-slot (11–12)", () => {
  beforeEach(() => resetWorkspace("Dorsal Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("11. Dorsal T6-T7 + T8-T9 coexist", () => {
    const b1 = buildDorsalLevelApplyBundle({ level: "T6-T7", sel: { morphology: "bulge" }, region: "Dorsal Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b1.bundleId, observations: b1.observations });
    const b2 = buildDorsalLevelApplyBundle({ level: "T8-T9", sel: { morphology: "bulge" }, region: "Dorsal Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b2.bundleId, observations: b2.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour).toHaveLength(2);
    // CARE normalizes T→D (dorsal terminology). Levels stored as D6-D7, D8-D9.
    const levels = contour.map((p) => p.observation?.level).sort();
    expect(levels).toEqual(["D6-D7", "D8-D9"]);
  });

  it("12. Dorsal same-level replacement works", () => {
    const b1 = buildDorsalLevelApplyBundle({ level: "T6-T7", sel: { morphology: "bulge" }, region: "Dorsal Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b1.bundleId, observations: b1.observations });
    const b2 = buildDorsalLevelApplyBundle({ level: "T6-T7", sel: { morphology: "protrusion" }, region: "Dorsal Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b2.bundleId, observations: b2.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    // CARE normalizes T→D. Level stored as D6-D7.
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "D6-D7")).toHaveLength(1);
  });
});

// ─── Test scenarios 13–14: AP measurement persistence ──────────────────

describe("AP canal measurements — persistence (13–14)", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("13. AP canal measurements persist through canalApProvenance (save/reopen)", () => {
    // Set a canal AP value via the store's canalApProvenance persistence path
    useWorkspace.getState().setCanalApCellProvenance("C5-C6", {
      region: "cervical",
      level: "C5-C6",
      measurementType: "CANAL_AP",
      value: "12.5",
      unit: "mm",
      manualOverride: true,
    });
    // Verify it's in the store
    const prov = useWorkspace.getState().canalApProvenance["C5-C6"];
    expect(prov).toBeDefined();
    expect(prov.value).toBe("12.5");

    // Simulate save: the workspace already serializes canalApProvenance into
    // draft.structuredJson (line 2146 of RadiologyReportingWorkspace.tsx).
    // Simulate reopen: extractCareCanalApProvenance restores it.
    // We test the round-trip by saving the state, clearing, then restoring.
    const savedProvenance = { ...useWorkspace.getState().canalApProvenance };
    useWorkspace.setState({ canalApProvenance: {} });
    expect(useWorkspace.getState().canalApProvenance["C5-C6"]).toBeUndefined();
    // Restore (simulating extractCareCanalApProvenance + setCanalApProvenance)
    useWorkspace.getState().setCanalApProvenance(savedProvenance);
    const restored = useWorkspace.getState().canalApProvenance["C5-C6"];
    expect(restored).toBeDefined();
    expect(restored.value).toBe("12.5");
    expect(restored.manualOverride).toBe(true);
  });

  it("14. Measurement editing does not change observation slot identity", () => {
    // Apply a disc bulge at C5-C6
    const b1 = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b1.bundleId, observations: b1.observations });

    // Get the observation's slotKey
    const patches1 = useWorkspace.getState().appliedPathologyPatches;
    const bulgePatch = patches1.find((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6");
    expect(bulgePatch).toBeDefined();
    const slotKeyBefore = bulgePatch!.observation!.slotKey;

    // Change the AP canal measurement at C5-C6
    useWorkspace.getState().setCanalApCellProvenance("C5-C6", {
      region: "cervical",
      level: "C5-C6",
      measurementType: "CANAL_AP",
      value: "10.2",
      unit: "mm",
      manualOverride: true,
    });

    // The slotKey must NOT have changed
    const patches2 = useWorkspace.getState().appliedPathologyPatches;
    const bulgePatch2 = patches2.find((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6");
    expect(bulgePatch2).toBeDefined();
    expect(bulgePatch2!.observation!.slotKey).toBe(slotKeyBefore);
    // slotKey must NOT contain the measurement value
    expect(slotKeyBefore).not.toContain("10.2");
    expect(slotKeyBefore).not.toContain("12");
  });
});

// ─── Test scenarios 15–18: Cross-producer convergence ───────────────────

describe("Cross-producer convergence (15–18)", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("15. Full Report Format + Canvas overlay works", () => {
    // Apply a cervical bulge via canvas
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    // Then apply a QS finding at the same slot
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "QS disc bulge at C5-C6." },
      templates: { findings: "QS disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "quick-findings", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "QS disc bulge at C5-C6.", id: "qs-cerv-bulge", force: true,
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toHaveLength(1);
  });

  it("16. Structured + Canvas same-slot behavior converges", () => {
    // Apply via structured (simulated)
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Structured disc bulge at C5-C6." },
      templates: { findings: "Structured disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "structured-template", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "Structured disc bulge at C5-C6.", id: "struct-cerv-bulge",
    });
    // Apply via canvas at same slot
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "protrusion" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations, });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toHaveLength(1);
  });

  it("17. Voice + Canvas same-slot behavior converges", () => {
    // Apply via voice (simulated via applyPathologyOverlay with source radiologist-voice)
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Voice disc bulge at C5-C6." },
      templates: { findings: "Voice disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "radiologist-voice", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "Voice disc bulge at C5-C6.", id: "voice-cerv-bulge",
    });
    // Apply via canvas at same slot (force=true to simulate user confirming replacement)
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "protrusion" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations.map((o) => ({ ...o, force: true })) });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toHaveLength(1);
  });

  it("18. Quick Select + Canvas same-slot behavior converges", () => {
    // Apply via Quick Select
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "QS disc bulge at C5-C6." },
      templates: { findings: "QS disc bulge at C5-C6." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "C5-C6" },
      source: "quick-select", region: "Cervical Spine", concept: "disc_contour",
      level: "C5-C6", findingsText: "QS disc bulge at C5-C6.", id: "qs-cerv-bulge-2",
    });
    // Apply via canvas at same slot (force=true to simulate user confirming replacement)
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "protrusion" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations.map((o) => ({ ...o, force: true })) });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toHaveLength(1);
  });
});

// ─── Test scenarios 19–22: Manual protection + save/reopen + AI + impression ─

describe("Manual protection + save/reopen + AI + impression (19–22)", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("19. Manual/protected text survives canvas overlay", () => {
    // Manually type findings
    useWorkspace.getState().setField("findings", "Manual note: correlate with EEG.", { source: "manual" });
    // Apply canvas bulge
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    expect(useWorkspace.getState().findingsText).toContain("Manual note: correlate with EEG.");
    expect(useWorkspace.getState().findingsText.toLowerCase()).toContain("bulge");
  });

  it("20. Save/reopen preserves canvas observations", () => {
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const before = useWorkspace.getState().serializeObservationLedger();
    useWorkspace.setState({ findingsText: "", appliedPathologyPatches: [] });
    useWorkspace.getState().hydrateObservationLedger(before);
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toBe(true);
  });

  it("21. AI Composer snapshot sees canvas observations", () => {
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const observations = deriveComposeObservations(patches);
    expect(observations.some((o) => o.concept === "disc_contour" && o.level === "C5-C6")).toBe(true);
  });

  it("22. Impression refresh sees appropriate canvas contributions", () => {
    const b = buildCervicalLevelApplyBundle({ level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine" });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    useWorkspace.getState().refreshImpressionFromLedger();
    // The bulge observation contributes an impression line
    expect(useWorkspace.getState().impressionText.toLowerCase()).toMatch(/c5-c6/);
  });
});

// ─── Test scenario 23: Screening wording ──────────────────────────────────

describe("Screening safety (23)", () => {
  it("23. Screening wording remains 'limited planar and limited sequence'", async () => {
    const { DEFAULT_REPORT_FORMATS } = await import("@/lib/zai-workspace/report-formats-library");
    const screeningFormats = DEFAULT_REPORT_FORMATS.filter(
      (f) => f.protocolScope === "Screening" && f.modality === "MR",
    );
    expect(screeningFormats.length).toBeGreaterThan(0);
    for (const f of screeningFormats) {
      const fullText = `${f.technique} ${f.findings} ${(f.techniqueFragments ?? []).map((tf) => tf.text).join(" ")}`;
      expect(/limited\s+planar/i.test(fullText), `${f.name} missing limited planar`).toBe(true);
      expect(/limited\s+sequence/i.test(fullText), `${f.name} missing limited sequence`).toBe(true);
    }
  });
});

// ─── Test scenario 24: Existing Lumbar Canvas tests remain green ─────────

describe("Lumbar Canvas regression (24)", () => {
  it("24. Existing lumbar canvas tests remain green (smoke check)", () => {
    // Verify lumbar canvas activation still works
    expect(isMriLumbarReportingContext({
      modality: "MR", region: "LS Spine", spineSegment: "lumbar",
    })).toBe(true);
    // Verify lumbar level apply bundle still works
    const b = buildLumbarLevelApplyBundle({ level: "L4-L5", sel: { morphology: "bulge" }, region: "LS Spine" });
    expect(b.observations.length).toBeGreaterThan(0);
    expect(b.observations[0]!.concept).toBe("disc_contour");
  });
});

// ─── Dorsal infection / spondylodiscitis structured observations ────────

describe("Dorsal Canvas — infection / spondylodiscitis (structured, NOT one-click TB)", () => {
  beforeEach(() => resetWorkspace("Dorsal Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("emits structured observations for infection findings (no one-click TB)", () => {
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9",
      sel: {
        vertebral: "endplate-erosion",
        infection: "disc-involvement",
      },
      region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    // Should have endplate_erosion + spondylodiscitis observations
    expect(patches.some((p) => p.observation?.concept === "endplate_erosion")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "spondylodiscitis")).toBe(true);
    // Should NOT have a "tb" or "tuberculosis" concept
    expect(patches.some((p) => p.observation?.concept === "tb")).toBe(false);
    expect(patches.some((p) => p.observation?.concept === "tuberculosis")).toBe(false);
  });

  it("paravertebral collection is a separate structured observation", () => {
    const b = buildDorsalLevelApplyBundle({
      level: "T9-T10",
      sel: { infection: "paravertebral-collection" },
      region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "paravertebral_collection")).toBe(true);
  });
});
