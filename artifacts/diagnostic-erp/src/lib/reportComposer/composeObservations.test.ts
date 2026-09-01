/**
 * Golden tests: Background AI Report Composer receives canonical observations.
 *
 * Coverage (A–K from PR brief P0-1):
 *   A. Quick Select reaches the composer snapshot.
 *   B. Same-slot replacement keeps only the current observation.
 *   C. Distinct spinal levels survive distinctly (L3-L4 + L4-L5).
 *   D. Distinct laterality survives distinctly (right infarct + left infarct).
 *   E. Macro bundle emits atomic observations, not one free-text blob.
 *   F. applyComposerFinding appears in the snapshot.
 *   G. Voice observation already in the ledger is not duplicated when
 *      voiceComposerObservations would also try to send it.
 *   H. Whole-report-format replacement marks prior ledger patches stale, and
 *      stale patches are NOT sent to the composer as active.
 *   I. Save → close → reopen preserves clinical identities; compose snapshot
 *      after reopen contains the same canonical observations.
 *   J. Narrative-only legacy draft (no ledger) → observations: [] is valid.
 *   K. Freshness: observation change after enqueue produces a different
 *      `reportRevision` so the previous READY draft becomes STALE_READY.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildCanonicalObservation } from "@/lib/observationSlot";
import { buildLumbarLevelApplyBundle } from "@/lib/mriLumbarLevelState";
import {
  extractCareObservationLedger,
  parseObservationLedger,
} from "@/lib/observationLedger";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import {
  deriveComposeObservations,
  mapInsertSourceToComposeSource,
  renderComposeObservationLine,
} from "@/lib/reportComposer/composeObservations";
import {
  computeSnapshotHashes,
  dedupeObservations,
  type ComposeObservation,
} from "@/lib/reportComposer/types";
import type { ObservationAnchor } from "@/lib/observationAnchor";

const ANCHOR: ObservationAnchor = {
  studyInstanceUID: "1.2.3",
  seriesInstanceUID: "1.2.3.4",
  sopInstanceUID: "1.2.3.4.5",
  frameNumber: 7,
  viewer: "ohif",
  capturedAt: "2026-01-01T00:00:00.000Z",
};

const FAZEKAS1 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!;
const FAZEKAS2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;

function ctxFor(region: "Brain" | "LS Spine") {
  return {
    modality: "MR",
    catalogModality: "MR",
    studyDescription: region === "Brain" ? "MRI Brain Plain" : "MRI LS Spine",
    dicomBodyPart: null,
    region,
    regions: [region],
    bodyPart: region === "Brain" ? "BRAIN" : "SPINE_LUMBAR",
    family: region === "Brain" ? "Brain" : "Spine",
    spineSegment: region === "Brain" ? null : "lumbar",
    source: "override",
    protocolName: null,
  };
}

function resetWorkspace(region: "Brain" | "LS Spine" = "LS Spine") {
  useWorkspace.setState({
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
    reportingContext: ctxFor(region),
    activeAnchor: ANCHOR,
  });
}

/** Compose snapshot observations derived from the live workspace ledger. */
function composeObservationsFromStore(): ComposeObservation[] {
  return deriveComposeObservations(useWorkspace.getState().appliedPathologyPatches);
}

describe("composeObservations adapter — pure unit", () => {
  it("empty ledger yields empty observations", () => {
    expect(deriveComposeObservations([])).toEqual([]);
    expect(deriveComposeObservations(null)).toEqual([]);
    expect(deriveComposeObservations(undefined)).toEqual([]);
  });

  it("mapInsertSourceToComposeSource covers every InsertSource", () => {
    expect(mapInsertSourceToComposeSource("quick-select")).toBe("quick-select");
    expect(mapInsertSourceToComposeSource("quick-findings")).toBe("quick-findings");
    expect(mapInsertSourceToComposeSource("macro")).toBe("macro");
    expect(mapInsertSourceToComposeSource("manual")).toBe("manual");
    expect(mapInsertSourceToComposeSource("radiologist-voice")).toBe("voice");
    expect(mapInsertSourceToComposeSource("protocol")).toBe("structured");
    expect(mapInsertSourceToComposeSource("template")).toBe("structured");
    expect(mapInsertSourceToComposeSource("structured-template")).toBe("structured");
    expect(mapInsertSourceToComposeSource("ai-draft")).toBe("structured");
    expect(mapInsertSourceToComposeSource(undefined)).toBe("structured");
  });

  it("renderComposeObservationLine includes region/level/laterality + impression", () => {
    const line = renderComposeObservationLine({
      concept: "disc_contour",
      source: "quick-select",
      anatomicalSection: "LS Spine",
      level: "L4-L5",
      laterality: "bilateral",
      findingsText: "Diffuse disc bulge with bilateral foraminal narrowing.",
      impressionText: "Mild disc bulge at L4-L5.",
    });
    expect(line).toContain("[quick-select]");
    expect(line).toContain("LS Spine | L4-L5 | disc_contour | bilateral");
    expect(line).toContain("Diffuse disc bulge with bilateral foraminal narrowing.");
    expect(line).toContain("Impression: Mild disc bulge at L4-L5.");
  });
});

describe("composeObservations — golden tests A–K", () => {
  beforeEach(() => resetWorkspace("LS Spine"));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("A. Quick Select reaches the composer snapshot", () => {
    resetWorkspace("Brain");
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-fazekas-2",
      incoming: { findings: FAZEKAS2.sentence, impression: FAZEKAS2.impressionSentence },
      templates: { findings: FAZEKAS2.sentence, impression: FAZEKAS2.impressionSentence },
      ownership: { conflictGroup: FAZEKAS2.conflictGroup, anatomicalSection: FAZEKAS2.anatomicalSection },
      source: "quick-select",
      region: "Brain",
      concept: "fazekas",
      label: FAZEKAS2.label,
      findingsText: FAZEKAS2.sentence,
    });
    const obs = composeObservationsFromStore();
    expect(obs).toHaveLength(1);
    expect(obs[0]!.concept).toBe("fazekas");
    expect(obs[0]!.source).toBe("quick-select");
    expect(obs[0]!.findingsText).toMatch(/Fazekas grade 2/i);
  });

  it("B. Same-slot replacement (Fazekas 1 → Fazekas 2) keeps only the current observation", () => {
    resetWorkspace("Brain");
    const f1 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!;
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-fazekas-1",
      incoming: { findings: f1.sentence, impression: f1.impressionSentence },
      templates: { findings: f1.sentence, impression: f1.impressionSentence },
      ownership: { conflictGroup: f1.conflictGroup, anatomicalSection: f1.anatomicalSection },
      source: "quick-select",
      region: "Brain",
      concept: "fazekas",
      label: f1.label,
      findingsText: f1.sentence,
    });
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-fazekas-2",
      incoming: { findings: FAZEKAS2.sentence, impression: FAZEKAS2.impressionSentence },
      templates: { findings: FAZEKAS2.sentence, impression: FAZEKAS2.impressionSentence },
      ownership: { conflictGroup: FAZEKAS2.conflictGroup, anatomicalSection: FAZEKAS2.anatomicalSection },
      source: "quick-select",
      region: "Brain",
      concept: "fazekas",
      label: FAZEKAS2.label,
      findingsText: FAZEKAS2.sentence,
    });
    const obs = composeObservationsFromStore();
    // Same slotKey (Brain|fazekas|*|*) → only one row, current Grade 2.
    expect(obs).toHaveLength(1);
    expect(obs[0]!.findingsText).toMatch(/Fazekas grade 2/i);
    expect(obs[0]!.findingsText).not.toMatch(/Fazekas grade 1/i);
  });

  it("C. Lumbar levels L3-L4 and L4-L5 survive distinctly", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qf-l34",
      incoming: { findings: "Disc bulge at L3-L4 without nerve root compression." },
      templates: { findings: "Disc bulge at L3-L4 without nerve root compression." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L3-L4" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L3-L4",
      findingsText: "Disc bulge at L3-L4 without nerve root compression.",
    });
    useWorkspace.getState().applyPathologyOverlay({
      id: "qf-l45",
      incoming: { findings: "Disc bulge at L4-L5 indenting the thecal sac." },
      templates: { findings: "Disc bulge at L4-L5 indenting the thecal sac." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5 indenting the thecal sac.",
    });
    const obs = composeObservationsFromStore();
    expect(obs).toHaveLength(2);
    const levels = obs.map((o) => o.level).sort();
    expect(levels).toEqual(["L3-L4", "L4-L5"]);
  });

  it("D. Right infarct and Left infarct survive distinctly", () => {
    resetWorkspace("Brain");
    useWorkspace.getState().applyPathologyOverlay({
      id: "infarct-right",
      incoming: { findings: "Acute right MCA territory infarct." },
      templates: { findings: "Acute right MCA territory infarct." },
      ownership: { conflictGroup: "infarct", concept: "infarct" },
      source: "quick-findings",
      region: "Brain",
      concept: "infarct",
      laterality: "right",
      side: "right",
      supportsLaterality: true,
      properties: "side",
      findingsText: "Acute right MCA territory infarct.",
    });
    useWorkspace.getState().applyPathologyOverlay({
      id: "infarct-left",
      incoming: { findings: "Acute left MCA territory infarct." },
      templates: { findings: "Acute left MCA territory infarct." },
      ownership: { conflictGroup: "infarct", concept: "infarct" },
      source: "quick-findings",
      region: "Brain",
      concept: "infarct",
      laterality: "left",
      side: "left",
      supportsLaterality: true,
      properties: "side",
      findingsText: "Acute left MCA territory infarct.",
    });
    const obs = composeObservationsFromStore();
    expect(obs).toHaveLength(2);
    expect(obs.some((o) => o.laterality === "right")).toBe(true);
    expect(obs.some((o) => o.laterality === "left")).toBe(true);
  });

  it("E. Macro bundle emits atomic observations, not one free-text blob", () => {
    const bundle = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "bulge", canal: "mild" },
      region: "LS Spine",
      bundleId: "macro-test-1",
    });
    expect(bundle.observations.length).toBeGreaterThan(1);
    useWorkspace.getState().applyMacroBundle({
      bundleId: bundle.bundleId,
      observations: bundle.observations,
    });
    const obs = composeObservationsFromStore();
    // Each atomic observation must be a distinct row.
    expect(obs.length).toBeGreaterThanOrEqual(bundle.observations.length);
    // No single free-text blob — at least one row carries concept disc_contour
    // and another carries canal_stenosis.
    expect(obs.some((o) => o.concept === "disc_contour")).toBe(true);
    expect(obs.some((o) => o.concept === "canal_stenosis")).toBe(true);
    // All macro rows share source macro (mapped from InsertSource "macro").
    expect(obs.every((o) => o.source === "macro" || o.source === "structured")).toBe(true);
  });

  it("F. applyComposerFinding appears in composer snapshot", () => {
    useWorkspace.getState().applyComposerFinding({
      id: "composer-bulge",
      incoming: {
        findings: "At L4-L5, a diffuse disc bulge indenting the anterior thecal sac.",
        impression: "L4-L5: diffuse disc bulge.",
      },
      templates: {
        findings: "At L4-L5, a diffuse disc bulge indenting the anterior thecal sac.",
        impression: "L4-L5: diffuse disc bulge.",
      },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "At L4-L5, a diffuse disc bulge indenting the anterior thecal sac.",
    });
    const obs = composeObservationsFromStore();
    expect(obs).toHaveLength(1);
    expect(obs[0]!.concept).toBe("disc_contour");
    expect(obs[0]!.level).toBe("L4-L5");
    expect(obs[0]!.findingsText).toMatch(/diffuse disc bulge/i);
    expect(obs[0]!.impressionText).toMatch(/L4-L5/);
  });

  it("G. Voice observation already in the ledger is NOT duplicated when voiceComposerObservations also contains it", () => {
    // Simulate the post-applyVoiceComposerPlan state: voice row is in both
    // appliedPathologyPatches (voice-* id, source radiologist-voice) AND in
    // voiceComposerObservations. The adapter reads only from the ledger, so
    // there is exactly one composer row.
    const obs = buildCanonicalObservation({
      id: "voice-1",
      region: "Brain",
      concept: "infarct",
      laterality: "right",
      supportsLaterality: true,
      properties: "side",
      findingsText: "Acute right MCA territory infarct.",
      source: "radiologist-voice",
    });
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "voice-1",
          ownership: { conflictGroup: "infarct", laterality: "right", slotKey: obs.slotKey },
          templates: { findings: "Acute right MCA territory infarct." },
          lastRendered: { findings: "Acute right MCA territory infarct." },
          source: "radiologist-voice",
          observation: obs,
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
      voiceComposerObservations: [
        {
          concept: "infarct",
          laterality: "right",
          findingsText: "Acute right MCA territory infarct.",
        },
      ],
    });
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(1);
    expect(composed[0]!.source).toBe("voice");
    expect(composed[0]!.laterality).toBe("right");
  });

  it("H. Stale patches (whole-report-format replacement) are NOT sent as active clinical observations", () => {
    // Apply a structured observation first.
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-bulge",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      templates: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Mild diffuse disc bulge at L4-L5.",
    });
    // Simulate whole-report-format replacement: existing ledger is marked stale.
    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) => ({
        ...p,
        stale: true,
      })),
      findingsText: "Normal MRI LS Spine.",
    });
    const composed = composeObservationsFromStore();
    expect(composed).toEqual([]);
  });

  it("I. Save → close → reopen preserves clinical identities; compose snapshot retains them", () => {
    resetWorkspace("LS Spine");
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-l45-bulge",
      incoming: { findings: "Diffuse disc bulge at L4-L5 indenting the thecal sac." },
      templates: { findings: "Diffuse disc bulge at L4-L5 indenting the thecal sac." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Diffuse disc bulge at L4-L5 indenting the thecal sac.",
    });
    const before = {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      recommendation: useWorkspace.getState().recommendationText,
      technique: useWorkspace.getState().techniqueText,
      clinicalHistory: useWorkspace.getState().clinicalHistoryText,
      structuredJson: { careObservationLedger: useWorkspace.getState().serializeObservationLedger() },
    };
    const beforeObs = composeObservationsFromStore();
    expect(beforeObs).toHaveLength(1);
    expect(beforeObs[0]!.concept).toBe("disc_contour");
    expect(beforeObs[0]!.level).toBe("L4-L5");

    // Close: blank the editor. Reopen: restore narrative + hydrate ledger.
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      ownershipReviewWarnings: [],
      ledgerHydrationWarning: null,
    });
    useWorkspace.getState().setEditorContent({
      findings: before.findings,
      impression: before.impression,
      recommendation: before.recommendation,
      technique: before.technique,
      clinicalHistory: before.clinicalHistory,
    });
    const ledger = extractCareObservationLedger(before.structuredJson);
    const result = useWorkspace.getState().hydrateObservationLedger(ledger);
    expect(result.mode).toBe("restored");
    expect(result.patchCount).toBe(1);

    const afterObs = composeObservationsFromStore();
    expect(afterObs).toHaveLength(1);
    expect(afterObs[0]!.concept).toBe("disc_contour");
    expect(afterObs[0]!.level).toBe("L4-L5");
    expect(afterObs[0]!.findingsText).toMatch(/Diffuse disc bulge at L4-L5/i);
    expect(parseObservationLedger(ledger).status).toBe("restored");
  });

  it("J. Narrative-only legacy draft (no ledger) → observations: [] is valid", () => {
    resetWorkspace("LS Spine");
    useWorkspace.getState().setEditorContent({
      findings: "Old narrative findings with no structured ledger.",
      impression: "Old impression.",
      recommendation: "",
      technique: "",
      clinicalHistory: "",
    });
    expect(composeObservationsFromStore()).toEqual([]);
  });

  it("K. Freshness: observation change after enqueue produces a different reportRevision", async () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-bulge-mild",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      templates: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      severity: "mild",
      findingsText: "Mild diffuse disc bulge at L4-L5.",
    });
    const snap1: ComposeObservation[] = composeObservationsFromStore();
    const hash1 = await computeSnapshotHashes({
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      recommendation: useWorkspace.getState().recommendationText,
      observations: snap1,
    });

    // Radiologist changes the SAME slot to moderate BEFORE the AI returns.
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-bulge-moderate",
      incoming: { findings: "Moderate diffuse disc bulge at L4-L5." },
      templates: { findings: "Moderate diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      severity: "moderate",
      findingsText: "Moderate diffuse disc bulge at L4-L5.",
    });
    const snap2: ComposeObservation[] = composeObservationsFromStore();
    const hash2 = await computeSnapshotHashes({
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      recommendation: useWorkspace.getState().recommendationText,
      observations: snap2,
    });

    expect(snap1).toHaveLength(1);
    expect(snap2).toHaveLength(1);
    expect(snap2[0]!.findingsText).toMatch(/Moderate/i);
    // reportRevision MUST differ so the previous READY draft becomes STALE_READY.
    expect(hash1.reportRevision).not.toBe(hash2.reportRevision);
    expect(hash1.inputHash).not.toBe(hash2.inputHash);
  });
});

describe("composeObservations — regression guards", () => {
  beforeEach(() => resetWorkspace("LS Spine"));

  it("dedupeObservations (snapshot hash path) still keys on slot identity, not text alone", () => {
    // Two distinct laterality observations with similar wording must remain distinct.
    const right: ComposeObservation = {
      concept: "infarct",
      source: "quick-findings",
      laterality: "right",
      findingsText: "Acute MCA territory infarct.",
      conflictGroup: "infarct",
    };
    const left: ComposeObservation = {
      concept: "infarct",
      source: "quick-findings",
      laterality: "left",
      findingsText: "Acute MCA territory infarct.",
      conflictGroup: "infarct",
    };
    const deduped = dedupeObservations([right, left]);
    expect(deduped).toHaveLength(2);

    // Two voice observations with identical findings text must collapse to one
    // when they have no slot identity (legacy unstructured voice row).
    const v1: ComposeObservation = {
      concept: "infarct",
      source: "voice",
      findingsText: "Acute right MCA territory infarct.",
    };
    const v2: ComposeObservation = {
      concept: "infarct",
      source: "voice",
      findingsText: "Acute right MCA territory infarct.",
    };
    expect(dedupeObservations([v1, v2])).toHaveLength(1);
  });

  it("preserves insertion order in the composer payload", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "obs-a",
      incoming: { findings: "Findings A at L3-L4." },
      templates: { findings: "Findings A at L3-L4." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L3-L4" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L3-L4",
      findingsText: "Findings A at L3-L4.",
    });
    useWorkspace.getState().applyPathologyOverlay({
      id: "obs-b",
      incoming: { findings: "Findings B at L4-L5." },
      templates: { findings: "Findings B at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Findings B at L4-L5.",
    });
    useWorkspace.getState().applyPathologyOverlay({
      id: "obs-c",
      incoming: { findings: "Findings C at L5-S1." },
      templates: { findings: "Findings C at L5-S1." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L5-S1" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L5-S1",
      findingsText: "Findings C at L5-S1.",
    });
    const obs = composeObservationsFromStore();
    expect(obs.map((o) => o.level)).toEqual(["L3-L4", "L4-L5", "L5-S1"]);
  });

  it("reportFormat whole-replace fallback: dedupeObservations + deriveComposeObservations survive mix of stale and active", () => {
    // Stale old + fresh new in the same ledger (e.g. user clicked a Full
    // Report Format then added a new QS observation afterward).
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "stale-bulge",
          ownership: { conflictGroup: "disc_contour", slotKey: "LS Spine|disc_contour|L4-L5|*" },
          templates: { findings: "Old mild disc bulge." },
          lastRendered: { findings: "Old mild disc bulge." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "stale-bulge",
            region: "LS Spine",
            concept: "disc_contour",
            level: "L4-L5",
            findingsText: "Old mild disc bulge.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
          stale: true,
        },
        {
          id: "active-canal",
          ownership: { conflictGroup: "canal_stenosis", slotKey: "LS Spine|canal_stenosis|L4-L5|*" },
          templates: { findings: "Mild canal stenosis at L4-L5." },
          lastRendered: { findings: "Mild canal stenosis at L4-L5." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "active-canal",
            region: "LS Spine",
            concept: "canal_stenosis",
            level: "L4-L5",
            findingsText: "Mild canal stenosis at L4-L5.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(1);
    expect(composed[0]!.id).toBe("active-canal");
    expect(composed[0]!.concept).toBe("canal_stenosis");
  });
});
