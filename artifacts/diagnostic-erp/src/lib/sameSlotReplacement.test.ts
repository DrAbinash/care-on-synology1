import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildCanonicalObservation,
  buildSlotKey,
  findSameSlotSiblings,
  mergeObservationInPlace,
  observationsMutuallyExclusive,
  planSameSlotReplacement,
} from "./observationSlot";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { provenanceFromText } from "./reportFieldMerge";
import { emptyViewerMeasurementsState, upsertStructuredMeasurement } from "./structuredViewerMeasurements";
import { buildLumbarLevelApplyBundle } from "./mriLumbarLevelState";
import type { ObservationAnchor } from "./observationAnchor";

const ANCHOR: ObservationAnchor = {
  studyInstanceUID: "1.2.3",
  seriesInstanceUID: "1.2.3.4",
  sopInstanceUID: "1.2.3.4.5",
  frameNumber: 12,
  viewer: "ohif",
  capturedAt: "2026-01-01T00:00:00.000Z",
};

describe("same-slot identity (pure)", () => {
  it("slotKey excludes severity; mild/moderate share a slot", () => {
    const mild = buildCanonicalObservation({
      region: "LS Spine",
      concept: "disc_contour",
      conflictGroup: "disc bulge",
      level: "L4-L5",
      findingsText: "Mild diffuse disc bulge at L4-L5.",
      severity: "mild",
    });
    const moderate = buildCanonicalObservation({
      region: "LS Spine",
      concept: "disc_contour",
      conflictGroup: "disc bulge",
      level: "L4-L5",
      findingsText: "Moderate diffuse disc bulge at L4-L5.",
      severity: "moderate",
    });
    expect(mild.slotKey).toBe(moderate.slotKey);
    expect(mild.slotKey).toBe(buildSlotKey({
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      laterality: "",
    }));
    expect(observationsMutuallyExclusive(mild, moderate)).toBe(true);
  });

  it("different concepts at L4-L5 coexist", () => {
    const bulge = buildCanonicalObservation({
      region: "LS Spine", concept: "disc_contour", level: "L4-L5",
    });
    const canal = buildCanonicalObservation({
      region: "LS Spine", concept: "canal_stenosis", level: "L4-L5",
    });
    const facet = buildCanonicalObservation({
      region: "LS Spine", concept: "facet_joint", level: "L4-L5",
    });
    expect(observationsMutuallyExclusive(bulge, canal)).toBe(false);
    expect(observationsMutuallyExclusive(bulge, facet)).toBe(false);
  });

  it("left/right foraminal stenosis coexist when laterality is slot-defining", () => {
    const left = buildCanonicalObservation({
      region: "LS Spine",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      laterality: "left",
      supportsLaterality: true,
      properties: "side",
    });
    const right = buildCanonicalObservation({
      region: "LS Spine",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      laterality: "right",
      supportsLaterality: true,
      properties: "side",
    });
    expect(left.slotKey).not.toBe(right.slotKey);
    expect(observationsMutuallyExclusive(left, right)).toBe(false);
  });

  it("legacy unstructured does not plan a silent sibling replace", () => {
    const plan = planSameSlotReplacement({
      incoming: buildCanonicalObservation({ region: "LS Spine", findingsText: "Something vague." }),
      incomingFindings: "Something vague.",
      siblings: [],
    });
    expect(plan.action).toBe("insert");
    if (plan.action === "insert") expect(plan.reason).toBe("unstructured");
  });

  it("exact same finding plans noop; severity change plans update with stable id", () => {
    const existingObs = buildCanonicalObservation({
      id: "O123",
      region: "LS Spine",
      concept: "disc_contour",
      conflictGroup: "disc bulge",
      level: "L4-L5",
      findingsText: "Mild diffuse disc bulge at L4-L5.",
      severity: "mild",
      anchor: ANCHOR,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const sibling = {
      id: "O123",
      observation: existingObs,
      lastRendered: { findings: "Mild diffuse disc bulge at L4-L5." },
      protected: false,
      source: "quick-findings" as const,
    };
    const noop = planSameSlotReplacement({
      incoming: existingObs,
      incomingFindings: "Mild diffuse disc bulge at L4-L5.",
      siblings: [sibling],
    });
    expect(noop.action).toBe("noop");

    const moderate = buildCanonicalObservation({
      region: "LS Spine",
      concept: "disc_contour",
      conflictGroup: "disc bulge",
      level: "L4-L5",
      findingsText: "Moderate diffuse disc bulge at L4-L5.",
      severity: "moderate",
    });
    const update = planSameSlotReplacement({
      incoming: moderate,
      incomingFindings: "Moderate diffuse disc bulge at L4-L5.",
      siblings: [sibling],
    });
    expect(update.action).toBe("update");
    if (update.action === "update") {
      expect(update.existingId).toBe("O123");
      expect(update.requiresConfirmation).toBe(false);
    }

    const manual = planSameSlotReplacement({
      incoming: moderate,
      incomingFindings: "Moderate diffuse disc bulge at L4-L5.",
      siblings: [{ ...sibling, protected: true }],
    });
    expect(manual.action).toBe("update");
    if (manual.action === "update") expect(manual.requiresConfirmation).toBe(true);
  });

  it("mergeObservationInPlace preserves id, anchor, createdAt, measurement", () => {
    const existing = buildCanonicalObservation({
      id: "O123",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      severity: "mild",
      measurement: "4.1 mm",
      anchor: ANCHOR,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const incoming = buildCanonicalObservation({
      id: "NEW",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      severity: "moderate",
      findingsText: "Moderate diffuse disc bulge at L4-L5.",
    });
    const merged = mergeObservationInPlace(existing, incoming);
    expect(merged.id).toBe("O123");
    expect(merged.severity).toBe("moderate");
    expect(merged.measurement).toBe("4.1 mm");
    expect(merged.anchor?.sopInstanceUID).toBe("1.2.3.4.5");
    expect(merged.anchor?.frameNumber).toBe(12);
    expect(merged.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("same-slot applyPathologyOverlay (store)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      lastPatchSnapshot: null,
      confirmOverwriteOpen: false,
      pendingPathologyPatch: null,
      isFinalized: false,
      isDirty: false,
      impressionNeedsRefresh: false,
      selectedObservationId: null,
      structuredViewerMeasurements: emptyViewerMeasurementsState(),
      reportingContext: {
        modality: "MR",
        catalogModality: "MR",
        studyDescription: "MRI LS Spine",
        dicomBodyPart: null,
        region: "LS Spine",
        regions: ["LS Spine"],
        bodyPart: "SPINE_LUMBAR",
        family: "Spine",
        spineSegment: "lumbar",
        source: "override",
        protocolName: null,
      },
      activeAnchor: ANCHOR,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("L4-L5 mild → moderate uses incoming id; remaps measurements; no duplicate", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O123",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5.", impression: "Mild disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
      anchor: ANCHOR,
    });
    const first = useWorkspace.getState().appliedPathologyPatches;
    expect(first).toHaveLength(1);
    expect(first[0]!.id).toBe("O123");
    expect(first[0]!.observation?.anchor?.sopInstanceUID).toBe("1.2.3.4.5");
    expect(first[0]!.observation?.anchor?.frameNumber).toBe(12);

    // Attach a measurement + viewer annotation to O123
    const withMeas = upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
      id: "m1",
      concept: "LINEAR",
      values: { primary: 4.1, unit: "mm" },
      observationId: "O123",
      viewerAnnotationId: "ann-9",
      anchor: ANCHOR,
      manualOverride: false,
    });
    useWorkspace.setState({ structuredViewerMeasurements: withMeas });

    useWorkspace.getState().applyPathologyOverlay({
      id: "qf-new-moderate",
      incoming: { findings: "Moderate diffuse disc bulge at L4-L5.", impression: "Moderate disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "moderate",
    });
    const after = useWorkspace.getState().appliedPathologyPatches;
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe("qf-new-moderate");
    expect(after[0]!.observation?.id).toBe("qf-new-moderate");
    expect(after[0]!.observation?.severity).toBe("moderate");
    expect(after[0]!.observation?.anchor?.sopInstanceUID).toBe("1.2.3.4.5");
    expect(after[0]!.observation?.anchor?.frameNumber).toBe(12);
    expect(useWorkspace.getState().findingsText).toMatch(/Moderate diffuse disc bulge/i);
    expect(useWorkspace.getState().findingsText).not.toMatch(/Mild diffuse disc bulge/i);
    // Measurement + viewer annotation remapped onto incoming survivor id
    const meas = useWorkspace.getState().structuredViewerMeasurements.items[0];
    expect(meas?.observationId).toBe("qf-new-moderate");
    expect(meas?.viewerAnnotationId).toBe("ann-9");
  });

  it("exact same finding clicked twice remains one observation (noop)", () => {
    const payload = {
      id: "O1",
      incoming: { findings: "Mild canal stenosis at L4-L5." },
      ownership: { conflictGroup: "canal stenosis", concept: "canal_stenosis", level: "L4-L5" },
      source: "quick-findings" as const,
      concept: "canal_stenosis",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
    };
    useWorkspace.getState().applyPathologyOverlay(payload);
    useWorkspace.getState().applyPathologyOverlay({ ...payload, id: "O1-dup" });
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("O1");
    expect(useWorkspace.getState().selectedObservationId).toBe("O1");
  });

  it("manual observation requires confirmation; cancel restores; replace uses incoming id", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-man",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
    });
    // Mark as manually edited
    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) =>
        p.id === "O-man" ? { ...p, protected: true } : p),
      fieldProvenance: {
        findings: provenanceFromText("Mild diffuse disc bulge at L4-L5.", "manual"),
      },
    });

    useWorkspace.getState().applyPathologyOverlay({
      id: "O-new",
      incoming: { findings: "Moderate diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "moderate",
    });
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(true);
    expect(useWorkspace.getState().pendingPathologyPatch?.vacatedObservationId).toBe("O-man");
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("O-new");

    useWorkspace.getState().cancelOverwrite();
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
    expect(useWorkspace.getState().findingsText).toMatch(/Mild diffuse/i);
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("O-man");

    // Re-apply and confirm
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-new2",
      incoming: { findings: "Moderate diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "moderate",
    });
    useWorkspace.getState().confirmOverwriteAndApply();
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("O-new2");
    expect(useWorkspace.getState().findingsText).toMatch(/Moderate diffuse/i);
  });

  it("Impression becomes stale; manual Impression is not silently overwritten on refresh gate", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-imp",
      incoming: {
        findings: "Mild diffuse disc bulge at L4-L5.",
        impression: "Mild disc bulge at L4-L5.",
      },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
    });
    // Radiologist edits impression manually
    useWorkspace.getState().setField("impression", "Custom impression I typed.");
    expect(useWorkspace.getState().fieldProvenance.impression).toBeTruthy();

    useWorkspace.getState().applyPathologyOverlay({
      id: "O-imp2",
      incoming: {
        findings: "Moderate diffuse disc bulge at L4-L5.",
        impression: "Moderate disc bulge at L4-L5.",
      },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "moderate",
    });
    // Manual impression text must not be silently replaced by the new impression sentence
    // when pathology overlay treats it as protected — either pending confirm or preserved.
    const s = useWorkspace.getState();
    if (!s.confirmOverwriteOpen) {
      // If auto-applied findings, impression may be stale for refresh flow
      expect(s.impressionNeedsRefresh === true || /Custom impression/i.test(s.impressionText)).toBe(true);
    }
  });

  it("Quick Findings and lumbar level block share the same slot engine (stable id)", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qf-canal",
      incoming: { findings: "Mild canal stenosis at L4-L5 without cord compression." },
      ownership: { conflictGroup: "canal stenosis", concept: "canal_stenosis", level: "L4-L5" },
      source: "quick-findings",
      concept: "canal_stenosis",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
    });
    const id = useWorkspace.getState().appliedPathologyPatches.find((p) => p.observation?.concept === "canal_stenosis")!.id;

    const bundle = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { canal: "severe" },
      region: "LS Spine",
      bundleId: "r2-canal-update",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: bundle.bundleId, observations: bundle.observations });
    const canal = useWorkspace.getState().appliedPathologyPatches.find((p) => p.observation?.concept === "canal_stenosis");
    expect(canal?.id).toBe(id);
    expect(canal?.observation?.severity).toBe("severe");
  });

  it("undo restores previous observation state via lastPatchSnapshot", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-u",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
    });
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-u2",
      incoming: { findings: "Moderate diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "moderate",
    });
    expect(useWorkspace.getState().findingsText).toMatch(/Moderate/i);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toMatch(/Mild/i);
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("O-u");
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.observation?.severity).toBe("mild");
  });

  it("finalized report cannot mutate observations", () => {
    useWorkspace.setState({ isFinalized: true, findingsText: "Prior." });
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-lock",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
    });
    expect(useWorkspace.getState().findingsText).toBe("Prior.");
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
  });

  it("legacy incomplete observation is not incorrectly replaced", () => {
    useWorkspace.setState({
      appliedPathologyPatches: [{
        id: "legacy-1",
        ownership: { anatomicalSection: "disc" },
        templates: { findings: "Old freeform disc note." },
        lastRendered: { findings: "Old freeform disc note." },
        source: "quick-findings",
        observation: buildCanonicalObservation({
          id: "legacy-1",
          region: "LS Spine",
          anatomicalSection: "disc",
          findingsText: "Old freeform disc note.",
          // no concept — unstructured
        }),
        protected: false,
      }],
      findingsText: "Old freeform disc note.",
    });
    const siblings = findSameSlotSiblings(
      useWorkspace.getState().appliedPathologyPatches,
      buildCanonicalObservation({
        region: "LS Spine",
        concept: "disc_contour",
        level: "L4-L5",
      }),
    );
    expect(siblings).toHaveLength(0);

    useWorkspace.getState().applyPathologyOverlay({
      id: "O-new-struct",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
    });
    const ids = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id).sort();
    expect(ids).toContain("legacy-1");
    expect(ids).toContain("O-new-struct");
  });
});
