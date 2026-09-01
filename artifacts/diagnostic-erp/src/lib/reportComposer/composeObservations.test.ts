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
  canonicalObservationKey,
  canonicalObservationHashPayload,
  type ComposeObservation,
} from "@/lib/reportComposer/types";
import {
  canonicalObservationKey as serverCanonicalObservationKey,
  canonicalObservationHashPayload as serverCanonicalObservationHashPayload,
  dedupeObservations as serverDedupeObservations,
  computeSnapshotHashes as serverComputeSnapshotHashes,
} from "../../../../api-server/src/lib/reportComposer/snapshot";
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

describe("composeObservations — review hardening (PR #654 review)", () => {
  beforeEach(() => resetWorkspace("LS Spine"));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ============================================================
  // Hardening §1 — Canonical dedupe identity (region|concept|level|laterality)
  // ============================================================

  it("dedupe-identity A. same concept + same level + same laterality in two different regions survives as 2 observations", () => {
    // LS Spine L4-L5 disc bulge (right) + Cervical Spine C4-C5 disc bulge (right)
    // — concept/level/laterality all identical, only region differs. They MUST
    // survive as two distinct clinical observations.
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "ls-l45-right",
          ownership: { conflictGroup: "disc_contour", slotKey: "LS Spine|disc_contour|L4-L5|right" },
          templates: { findings: "Right disc bulge at L4-L5." },
          lastRendered: { findings: "Right disc bulge at L4-L5." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "ls-l45-right",
            region: "LS Spine",
            concept: "disc_contour",
            level: "L4-L5",
            laterality: "right",
            supportsLaterality: true,
            properties: "side",
            findingsText: "Right disc bulge at L4-L5.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
        {
          id: "cs-c45-right",
          ownership: { conflictGroup: "disc_contour", slotKey: "Cervical Spine|disc_contour|C4-C5|right" },
          templates: { findings: "Right disc bulge at C4-C5." },
          lastRendered: { findings: "Right disc bulge at C4-C5." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "cs-c45-right",
            region: "Cervical Spine",
            concept: "disc_contour",
            level: "C4-C5",
            laterality: "right",
            supportsLaterality: true,
            properties: "side",
            findingsText: "Right disc bulge at C4-C5.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    // Even though level differs here, the canonical key also includes region.
    // To prove the region point cleanly: same concept + same level + same
    // laterality but different region must still survive as 2.
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "ls-l45-right-2",
          ownership: { conflictGroup: "disc_contour", slotKey: "LS Spine|disc_contour|L4-L5|right" },
          templates: { findings: "Right disc bulge at L4-L5 (LS)." },
          lastRendered: { findings: "Right disc bulge at L4-L5 (LS)." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "ls-l45-right-2",
            region: "LS Spine",
            concept: "disc_contour",
            level: "L4-L5",
            laterality: "right",
            supportsLaterality: true,
            properties: "side",
            findingsText: "Right disc bulge at L4-L5 (LS).",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
        {
          id: "cs-l45-right-2",
          // NOTE: same concept + same level + same laterality, only region differs.
          // CARE's slotKey for this would be "Cervical Spine|disc_contour|L4-L5|right"
          // — clinically nonsense but the test isolates region as a keying axis.
          ownership: { conflictGroup: "disc_contour", slotKey: "Cervical Spine|disc_contour|L4-L5|right" },
          templates: { findings: "Right disc bulge at L4-L5 (CS)." },
          lastRendered: { findings: "Right disc bulge at L4-L5 (CS)." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "cs-l45-right-2",
            region: "Cervical Spine",
            concept: "disc_contour",
            level: "L4-L5",
            laterality: "right",
            supportsLaterality: true,
            properties: "side",
            findingsText: "Right disc bulge at L4-L5 (CS).",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(2);
    expect(composed.map((o) => o.region).sort()).toEqual(["Cervical Spine", "LS Spine"]);
  });

  it("dedupe-identity B. same concept in different anatomical sections (no level/laterality) survives when clinically distinct via region", () => {
    // Brain fazekas vs Whole Spine fazekas — concept matches, no level, no
    // laterality. Region alone must keep them distinct.
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "brain-fazekas",
          ownership: { conflictGroup: "fazekas", slotKey: "Brain|fazekas|*|*" },
          templates: { findings: "Confluent white matter lesions, Fazekas grade 2." },
          lastRendered: { findings: "Confluent white matter lesions, Fazekas grade 2." },
          source: "quick-select",
          observation: buildCanonicalObservation({
            id: "brain-fazekas",
            region: "Brain",
            concept: "fazekas",
            findingsText: "Confluent white matter lesions, Fazekas grade 2.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
        {
          id: "spine-fazekas",
          ownership: { conflictGroup: "fazekas", slotKey: "Whole Spine|fazekas|*|*" },
          templates: { findings: "Confluent spinal cord lesions, Fazekas grade 2." },
          lastRendered: { findings: "Confluent spinal cord lesions, Fazekas grade 2." },
          source: "quick-select",
          observation: buildCanonicalObservation({
            id: "spine-fazekas",
            region: "Whole Spine",
            concept: "fazekas",
            findingsText: "Confluent spinal cord lesions, Fazekas grade 2.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(2);
  });

  it("dedupe-identity C. existing Fazekas same-slot replacement still produces one observation", () => {
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
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(1);
    expect(composed[0]!.findingsText).toMatch(/Fazekas grade 2/i);
    expect(composed[0]!.region).toBe("Brain");
  });

  it("dedupe-identity D. right/left infarcts remain separate under canonical key", () => {
    const right: ComposeObservation = {
      region: "Brain",
      concept: "infarct",
      source: "quick-findings",
      laterality: "right",
      findingsText: "Acute MCA territory infarct.",
      conflictGroup: "infarct",
    };
    const left: ComposeObservation = {
      region: "Brain",
      concept: "infarct",
      source: "quick-findings",
      laterality: "left",
      findingsText: "Acute MCA territory infarct.",
      conflictGroup: "infarct",
    };
    expect(canonicalObservationKey(right)).not.toBe(canonicalObservationKey(left));
    expect(dedupeObservations([right, left])).toHaveLength(2);
  });

  // ============================================================
  // Hardening §2 — baselineReplaces safety
  // ============================================================

  it("baselineReplaces-safety: patch with concept=disc_contour, baselineReplaces='No significant disc bulge.', no lastRendered/templates findings is OMITTED (never surfaced as active finding)", () => {
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "bulge-baseline-only",
          ownership: { conflictGroup: "disc_contour", slotKey: "LS Spine|disc_contour|L4-L5|*" },
          templates: {}, // no findings template
          lastRendered: {}, // no rendered findings
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "bulge-baseline-only",
            region: "LS Spine",
            concept: "disc_contour",
            level: "L4-L5",
            baselineReplaces: "No significant disc bulge.",
            findingsText: "", // explicitly empty — represents a patch that has
            // structural identity but no committed Findings sentence yet.
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    const composed = composeObservationsFromStore();
    // The patch MUST be omitted — there is no active Findings contribution.
    expect(composed).toEqual([]);
  });

  it("baselineReplaces-safety: a patch with concept=disc_contour AND a real lastRendered.findings does NOT leak 'No significant disc bulge.' as findingsText", () => {
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "bulge-active",
          ownership: { conflictGroup: "disc_contour", slotKey: "LS Spine|disc_contour|L4-L5|*" },
          templates: { findings: "Diffuse disc bulge at L4-L5 indenting the thecal sac." },
          lastRendered: { findings: "Diffuse disc bulge at L4-L5 indenting the thecal sac." },
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "bulge-active",
            region: "LS Spine",
            concept: "disc_contour",
            level: "L4-L5",
            baselineReplaces: "No significant disc bulge.",
            findingsText: "Diffuse disc bulge at L4-L5 indenting the thecal sac.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(1);
    expect(composed[0]!.findingsText).toMatch(/Diffuse disc bulge at L4-L5/i);
    expect(composed[0]!.findingsText).not.toMatch(/No significant disc bulge/i);
    // baselineReplaces IS still carried for provenance/ownership on the
    // ComposeObservation (the schema allows it), but it MUST NOT appear as
    // findingsText.
    expect(composed[0]!.baselineReplaces).toBe("No significant disc bulge.");
  });

  it("baselineReplaces-safety: templates.findings is used as fallback when lastRendered.findings is absent (radiologist-authored template, NOT baseline)", () => {
    useWorkspace.setState({
      appliedPathologyPatches: [
        {
          id: "bulge-template-only",
          ownership: { conflictGroup: "disc_contour", slotKey: "LS Spine|disc_contour|L4-L5|*" },
          templates: { findings: "Mild diffuse disc bulge at L4-L5." },
          lastRendered: {}, // e.g. freshly-hydrated draft where lastRendered is empty
          source: "quick-findings",
          observation: buildCanonicalObservation({
            id: "bulge-template-only",
            region: "LS Spine",
            concept: "disc_contour",
            level: "L4-L5",
            baselineReplaces: "No significant disc bulge.",
            findingsText: "Mild diffuse disc bulge at L4-L5.",
          }),
          replacedBaseline: { findings: [], impression: [] },
          protected: false,
        },
      ],
    });
    const composed = composeObservationsFromStore();
    expect(composed).toHaveLength(1);
    expect(composed[0]!.findingsText).toBe("Mild diffuse disc bulge at L4-L5.");
    expect(composed[0]!.findingsText).not.toMatch(/No significant disc bulge/i);
  });

  // ============================================================
  // Hardening §3 — Snapshot hashing / freshness canonicalization
  // ============================================================

  it("hash-canonical A. right → left laterality change with identical findingsText changes reportRevision", async () => {
    const base: ComposeObservation = {
      region: "Brain",
      concept: "infarct",
      source: "quick-findings",
      laterality: "right",
      findingsText: "Acute MCA territory infarct.",
    };
    const flipped: ComposeObservation = { ...base, laterality: "left" };
    expect(canonicalObservationHashPayload(base)).not.toBe(canonicalObservationHashPayload(flipped));
    const h1 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [base] });
    const h2 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [flipped] });
    expect(h1.reportRevision).not.toBe(h2.reportRevision);
  });

  it("hash-canonical B. mild → moderate severity metadata change with identical findingsText changes reportRevision", async () => {
    const mild: ComposeObservation = {
      region: "LS Spine",
      concept: "disc_contour",
      source: "quick-findings",
      level: "L4-L5",
      severity: "mild",
      findingsText: "Diffuse disc bulge at L4-L5.",
    };
    const moderate: ComposeObservation = { ...mild, severity: "moderate" };
    expect(canonicalObservationHashPayload(mild)).not.toBe(canonicalObservationHashPayload(moderate));
    const h1 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [mild] });
    const h2 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [moderate] });
    expect(h1.reportRevision).not.toBe(h2.reportRevision);
  });

  it("hash-canonical C. region change with otherwise identical observation changes reportRevision", async () => {
    const ls: ComposeObservation = {
      region: "LS Spine",
      concept: "disc_contour",
      source: "quick-findings",
      level: "L4-L5",
      findingsText: "Disc bulge indenting the thecal sac.",
    };
    const cs: ComposeObservation = { ...ls, region: "Cervical Spine" };
    expect(canonicalObservationHashPayload(ls)).not.toBe(canonicalObservationHashPayload(cs));
    const h1 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [ls] });
    const h2 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [cs] });
    expect(h1.reportRevision).not.toBe(h2.reportRevision);
  });

  it("hash-canonical D. impression contribution change changes reportRevision", async () => {
    const without: ComposeObservation = {
      region: "LS Spine",
      concept: "disc_contour",
      source: "quick-findings",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
    };
    const withImpression: ComposeObservation = { ...without, impressionText: "Mild disc bulge at L4-L5." };
    expect(canonicalObservationHashPayload(without)).not.toBe(canonicalObservationHashPayload(withImpression));
    const h1 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [without] });
    const h2 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [withImpression] });
    expect(h1.reportRevision).not.toBe(h2.reportRevision);
  });

  it("hash-canonical E. unchanged observation yields identical hash", async () => {
    const obs: ComposeObservation = {
      region: "LS Spine",
      concept: "disc_contour",
      source: "quick-findings",
      level: "L4-L5",
      laterality: "right",
      severity: "mild",
      anatomicalSection: "disc",
      findingsText: "Diffuse disc bulge at L4-L5.",
      impressionText: "Mild disc bulge at L4-L5.",
    };
    const h1 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [obs] });
    const h2 = await computeSnapshotHashes({ findings: "F", impression: "I", recommendation: "R", observations: [{ ...obs }] });
    expect(h1.reportRevision).toBe(h2.reportRevision);
    expect(h1.inputHash).toBe(h2.inputHash);
  });

  it("hash-canonical F. browser/client and API-server canonicalization remain equivalent (no drift)", async () => {
    const obs: ComposeObservation = {
      id: "obs-1",
      region: "LS Spine",
      concept: "disc_contour",
      source: "quick-findings",
      level: "L4-L5",
      laterality: "right",
      severity: "mild",
      anatomicalSection: "disc",
      findingsText: "Diffuse disc bulge at L4-L5.",
      impressionText: "Mild disc bulge at L4-L5.",
      conflictGroup: "disc bulge",
      baselineReplaces: "No significant disc bulge.",
    };

    // 1. Canonical identity (dedupe key) — client vs server MUST match.
    expect(canonicalObservationKey(obs)).toBe(serverCanonicalObservationKey(obs));

    // 2. Canonical hash payload — client vs server MUST match.
    expect(canonicalObservationHashPayload(obs)).toBe(serverCanonicalObservationHashPayload(obs));

    // 3. Dedupe output — client vs server MUST match.
    const list = [obs, { ...obs, id: "obs-1-dup" }];
    expect(dedupeObservations(list)).toEqual(serverDedupeObservations(list));

    // 4. Compute full snapshot hashes — client uses async WebCrypto SHA-256
    //    (truncated to 32 hex chars); server uses Node crypto SHA-256 truncated
    //    to 32 hex chars. Both must produce identical digest for the same
    //    canonical observation payload.
    const snap = {
      findings: "Findings narrative.",
      impression: "Impression narrative.",
      recommendation: "Recommendation narrative.",
      observations: [obs],
      jobKindHint: "FULL_REPORT" as const,
      clinicalHistory: "History.",
      technique: "Technique.",
      templateSections: [],
    };
    const clientHash = await computeSnapshotHashes(snap);
    const serverHash = serverComputeSnapshotHashes(snap);
    expect(clientHash.findingsHash).toBe(serverHash.findingsHash);
    expect(clientHash.impressionHash).toBe(serverHash.impressionHash);
    expect(clientHash.recommendationHash).toBe(serverHash.recommendationHash);
    expect(clientHash.inputHash).toBe(serverHash.inputHash);
    expect(clientHash.reportRevision).toBe(serverHash.reportRevision);
  });

  it("hash-canonical backward compatibility: old snapshot without `region` still parses and hashes cleanly", async () => {
    // Simulate a snapshot produced by a pre-hardening client (no `region`
    // field on observations). The schema must still accept it, the hash
    // must still compute, and the canonical key must fall back to the
    // legacy findings-text path when no structured identity is present.
    const legacyObs = {
      concept: "disc_contour",
      source: "quick-findings" as const,
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
      // intentionally no region, no laterality, no severity, no impressionText
    };
    const key = canonicalObservationKey(legacyObs);
    expect(key.startsWith("slot::")).toBe(true); // concept+level present → structured path
    const h = await computeSnapshotHashes({
      findings: "F",
      impression: "I",
      recommendation: "R",
      observations: [legacyObs],
    });
    expect(h.reportRevision).toBeTruthy();
    // And server-side canonicalization must agree.
    expect(serverCanonicalObservationKey(legacyObs)).toBe(key);
    expect(serverCanonicalObservationHashPayload(legacyObs)).toBe(canonicalObservationHashPayload(legacyObs));
  });

  // ============================================================
  // Hardening §4 — Prompt rendering includes region
  // ============================================================

  it("prompt-rendering: region appears in the compact observation line", () => {
    const line = renderComposeObservationLine({
      region: "LS Spine",
      concept: "disc_contour",
      source: "quick-select",
      anatomicalSection: "disc",
      level: "L4-L5",
      laterality: "bilateral",
      findingsText: "Diffuse disc bulge with bilateral foraminal narrowing.",
      impressionText: "Mild disc bulge at L4-L5.",
    });
    expect(line).toContain("[quick-select]");
    expect(line).toContain("LS Spine | disc | L4-L5 | disc_contour | bilateral");
    expect(line).toContain("Diffuse disc bulge with bilateral foraminal narrowing.");
    expect(line).toContain("Impression: Mild disc bulge at L4-L5.");
  });

  it("prompt-rendering: empty pieces are omitted (no orphan separators)", () => {
    const line = renderComposeObservationLine({
      region: "Brain",
      concept: "fazekas",
      source: "quick-select",
      findingsText: "Confluent white matter lesions, Fazekas grade 2.",
    });
    expect(line).toBe("- [quick-select] Brain | fazekas\n  Confluent white matter lesions, Fazekas grade 2.");
    expect(line).not.toMatch(/\| {2,}/); // no orphan separators from missing pieces
    expect(line).not.toContain("undefined");
    expect(line).not.toContain("null");
  });
});
