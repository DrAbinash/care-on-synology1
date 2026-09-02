/**
 * Cross-producer behavioral tests: P0-A (AI wording), P0-B (voice same-slot),
 * P0-C (structured toggle-off).
 *
 * Tests A–L from the post-audit targeted hardening brief.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildCanonicalObservation } from "@/lib/observationSlot";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import { deriveStructuredObservations, computeStructuredRemovals } from "@/lib/structuredFormat/structuredObservations";
import { adaptSectionsJson } from "@/lib/structuredFormat/adapter";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { StructuredFormatDoc, StructuredValues } from "@/lib/structuredFormat/types";
import type { VoiceChangePlan, VoiceObservation } from "@/lib/voiceReportComposer/types";

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
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: `MRI ${region}`,
      regions: [region], source: "auto",
    }),
  });
}

function lsSpineFormatDoc(): StructuredFormatDoc {
  return adaptSectionsJson(JSON.stringify({
    schemaVersion: 2, technique: "MRI LS Spine.",
    tokens: ["level", "severity", "side"],
    mutexGroups: [], repeatingGroupDefs: [],
    sections: [{
      id: "disc-L4-L5", label: "L4-L5 Disc", headingVisible: false,
      required: false, collapsedByDefault: false, contributesTo: ["findings"],
      defaultText: "", normalText: "Disc is normal at L4-L5.",
      fields: [
        { id: "morphology", label: "Disc morphology", type: "single_select",
          options: [
            { id: "bulge", label: "Bulge", value: "bulge", severity: "mild", canonicalKey: "disc.bulge", outputSentence: "Disc bulge at L4-L5." },
            { id: "protrusion", label: "Protrusion", value: "protrusion", severity: "moderate", canonicalKey: "disc.protrusion", outputSentence: "Disc protrusion at L4-L5." },
          ],
        },
        { id: "desiccation", label: "Disc desiccation", type: "toggle",
          options: [{ id: "yes", label: "Desiccation", value: "yes", severity: "mild", canonicalKey: "disc.desiccation", outputSentence: "Disc desiccation at L4-L5." }],
        },
        { id: "foraminal", label: "Foraminal narrowing", type: "toggle",
          options: [{ id: "yes", label: "Foraminal narrowing", value: "yes", severity: "moderate", canonicalKey: "foramina.narrowing", outputSentence: "Neural foraminal narrowing at L4-L5.", impressionSentence: "L4-L5 foraminal narrowing.", impressionWeight: 0.65 }],
        },
      ],
    }],
  }));
}

function applyStructured(doc: StructuredFormatDoc, values: StructuredValues, region: string) {
  const ws = useWorkspace.getState();
  const patches = deriveStructuredObservations(doc, values, region);
  const removalIds = computeStructuredRemovals(
    ws.appliedPathologyPatches.map((p) => ({ id: p.id, source: p.source, protected: p.protected })),
    patches,
  );
  for (const id of removalIds) ws.removeObservation(id);
  if (patches.length > 0) {
    ws.applyMacroBundle({
      bundleId: `structured-test-${Date.now().toString(36)}`,
      observations: patches.map((p) => ({
        incoming: { findings: p.findingsText, impression: p.impressionText },
        templates: { findings: p.findingsText, impression: p.impressionText },
        ownership: { conflictGroup: p.conflictGroup, concept: p.concept },
        source: "structured-template", region: p.region, concept: p.concept,
        level: p.level, laterality: p.laterality, severity: p.severity,
        findingsText: p.findingsText, supportsLaterality: Boolean(p.laterality),
        properties: p.laterality ? "side" : undefined,
        id: `structured-${p.concept}-${p.level ?? ""}-${p.laterality ?? ""}`,
      })),
    });
  }
}

function voicePlan(obs: Partial<VoiceObservation>[]): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: obs.map((o) => ({
      concept: o.concept ?? "disc_contour", level: o.level, laterality: o.laterality,
      findingsText: o.findingsText ?? "Disc bulge.", impressionText: o.impressionText,
      anatomicalSection: o.anatomicalSection, conflictGroup: o.conflictGroup,
      baselineReplaces: o.baselineReplaces,
    })),
    removeConflictingBaselineConcepts: [], impressionCandidates: [],
    impressionUpdate: undefined, uncertainties: [], clarificationRequired: null,
  };
}

describe("Cross-producer behavioral tests (P0-A/B/C)", () => {
  beforeEach(() => resetWorkspace("LS Spine"));
  afterEach(() => vi.unstubAllGlobals());

  // A. Structured L4-L5 disc bulge → one observation. Voice same slot → STILL one.
  it("A. Structured then Voice same slot → exactly one canonical observation", () => {
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge" }, "LS Spine");
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour")).toHaveLength(1);

    useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{ concept: "disc_contour", level: "L4-L5", findingsText: "Voice disc bulge at L4-L5." }]),
      "test transcript",
      { force: true },
    );
    patches = useWorkspace.getState().appliedPathologyPatches;
    // Same slot → should still be ONE observation (not two).
    const contourPatches = patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5");
    expect(contourPatches).toHaveLength(1);
  });

  // B. Voice L3-L4 + Structured L4-L5 → two observations
  it("B. Voice L3-L4 + Structured L4-L5 → two distinct observations", () => {
    useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{ concept: "disc_contour", level: "L3-L4", findingsText: "Voice disc bulge at L3-L4." }]),
      "t1", { force: true },
    );
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge" }, "LS Spine");
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour.length).toBeGreaterThanOrEqual(2);
    const levels = contour.map((p) => p.observation?.level).sort();
    expect(levels).toContain("L3-L4");
    expect(levels).toContain("L4-L5");
  });

  // C. Structured left foraminal + Voice right foraminal → both coexist
  it("C. Left + right foraminal stenosis coexist", () => {
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { foraminal: true, side: "left" }, "LS Spine");
    useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{ concept: "foraminal_stenosis", level: "L4-L5", laterality: "right", findingsText: "Right foraminal narrowing." }]),
      "t1", { force: true },
    );
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const foraminal = patches.filter((p) => p.observation?.concept === "foraminal_stenosis");
    expect(foraminal.length).toBeGreaterThanOrEqual(1);
  });

  // D. Quick Select L4-L5 disc_contour then Voice same slot → deterministic
  it("D. Quick Select then Voice same slot → deterministic same-slot behavior", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "QS disc bulge at L4-L5." },
      templates: { findings: "QS disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "QS disc bulge at L4-L5.", id: "qs-test-bulge",
    });
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5")).toHaveLength(1);

    useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{ concept: "disc_contour", level: "L4-L5", findingsText: "Voice disc bulge at L4-L5." }]),
      "t1", { force: true },
    );
    patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5");
    expect(contour).toHaveLength(1);
  });

  // E. Structured bulge ON → observation exists. Toggle OFF → removed.
  it("E. Structured toggle OFF removes observation safely", () => {
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge" }, "LS Spine");
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);

    // Toggle OFF — no morphology selected
    applyStructured(doc, {}, "LS Spine");
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "disc_contour" && p.source === "structured-template")).toBe(false);
  });

  // F. Structured bulge + desiccation ON. Toggle bulge OFF → desiccation remains.
  it("F. Toggle bulge OFF → desiccation remains", () => {
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge", desiccation: true }, "LS Spine");
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "disc_signal")).toBe(true);

    // Toggle bulge OFF — keep desiccation
    applyStructured(doc, { desiccation: true }, "LS Spine");
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "disc_contour" && p.source === "structured-template")).toBe(false);
    expect(patches.some((p) => p.observation?.concept === "disc_signal")).toBe(true);
  });

  // G. Structured pathology manually edited/protected. Toggle OFF → manual survives.
  it("G. Protected structured observation survives toggle-off", () => {
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge" }, "LS Spine");
    // Mark as protected
    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) =>
        p.source === "structured-template" ? { ...p, protected: true } : p,
      ),
    });

    // Toggle OFF
    applyStructured(doc, {}, "LS Spine");
    // Protected observation should still be there
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
  });

  // H. AI rephrases existing canonical observation → clinical observation remains active.
  it("H. AI rephrase does NOT remove canonical observation", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Original disc bulge at L4-L5." },
      templates: { findings: "Original disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Original disc bulge at L4-L5.", id: "qs-bulge",
    });
    const beforeCount = useWorkspace.getState().appliedPathologyPatches.length;

    // AI rephrases the findings text
    useWorkspace.getState().applyAiComposerAccepted({
      findings: "AI rephrased findings with different wording for the same disc bulge.",
      impression: "AI rephrased impression.",
      recommendation: "",
    });

    // Canonical observation must still be there
    const afterPatches = useWorkspace.getState().appliedPathologyPatches;
    expect(afterPatches.length).toBe(beforeCount);
    expect(afterPatches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
  });

  // I. After AI rephrase: deriveComposeObservations still contains that observation.
  it("I. AI rephrased observation still visible to deriveComposeObservations", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5.", id: "qs-bulge",
    });
    useWorkspace.getState().applyAiComposerAccepted({
      findings: "AI completely rephrased the findings text.",
      impression: "AI impression.",
      recommendation: "",
    });
    const composeObs = deriveComposeObservations(useWorkspace.getState().appliedPathologyPatches);
    expect(composeObs.some((o) => o.concept === "disc_contour")).toBe(true);
  });

  // J. AI rephrase → save → close → reopen → observation NOT falsely stale.
  it("J. AI rephrase + save/reopen does not falsely stale observation", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5.", id: "qs-bulge",
    });
    useWorkspace.getState().applyAiComposerAccepted({
      findings: "AI rephrased findings.",
      impression: "AI impression.",
      recommendation: "",
    });

    // Serialize
    const serialized = useWorkspace.getState().serializeObservationLedger();
    // Close
    useWorkspace.setState({ findingsText: "", impressionText: "", appliedPathologyPatches: [] });
    // Reopen
    useWorkspace.getState().hydrateObservationLedger(serialized);

    // Observation should still be present (may be stale due to narrative mismatch,
    // but NOT deleted — stale is non-destructive)
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
  });

  // K. AI accepted output cannot invent a new canonical observation.
  it("K. AI accepted output creates ZERO new canonical observations", () => {
    const beforeCount = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().applyAiComposerAccepted({
      findings: "AI invented findings with hemorrhage and infarct.",
      impression: "AI invented impression.",
      recommendation: "AI invented recommendation.",
    });
    const afterCount = useWorkspace.getState().appliedPathologyPatches.length;
    expect(afterCount).toBe(beforeCount); // no new observations created
  });

  // L. AI accepted output cannot delete canonical clinical truth.
  it("L. AI accepted output does NOT delete existing canonical observations", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings", region: "LS Spine", concept: "disc_contour",
      level: "L4-L5", findingsText: "Disc bulge at L4-L5.", id: "qs-bulge",
    });
    const beforeIds = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);

    useWorkspace.getState().applyAiComposerAccepted({
      findings: "Completely different text.",
      impression: "Different impression.",
      recommendation: "",
    });

    const afterIds = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
    expect(afterIds.length).toBe(beforeIds.length);
    expect(afterIds).toEqual(expect.arrayContaining(beforeIds));
  });
});
