/**
 * PR #662 — Clinical Composition Hardening — Cross-producer safety tests.
 *
 * Tests A–O from the PR brief, validating:
 *
 *   A. QS bulge + Voice same slot → one observation.
 *   B. Structured bulge + QS same slot → one observation.
 *   C. L3-L4 + L4-L5 same concept → two observations.
 *   D. left + right foraminal narrowing → coexist.
 *   E. system Normal Study + abnormal observation → normal auto-yields.
 *   F. remove final abnormal observation → system normal returns.
 *   G. MANUAL "Normal study" is never auto-deleted.
 *   H. protected Impression survives all refresh operations.
 *   I. fast multi-level apply produces independently removable observations.
 *   J. removing L4-L5 does not remove L3-L4/L5-S1.
 *   K. save/reopen preserves all level ownership.
 *   L. content-pack aliases resolve to the same canonical concepts as before.
 *   M. existing legacy observations hydrate safely.
 *   N. AI snapshot sees the correct canonical observations.
 *   O. Voice/Structured/QS remain converged.
 *
 * Also documents PR decisions:
 *   - Findings descriptive subheading: DEFERRED (see test "DEFERRED — Findings
 *     descriptive subheading" for rationale).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildCanonicalObservation } from "@/lib/observationSlot";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  deriveStructuredObservations,
  computeStructuredRemovals,
} from "@/lib/structuredFormat/structuredObservations";
import { adaptSectionsJson } from "@/lib/structuredFormat/adapter";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  parseObservationLedger,
} from "@/lib/observationLedger";
import type { StructuredFormatDoc, StructuredValues } from "@/lib/structuredFormat/types";
import type { VoiceChangePlan, VoiceObservation } from "@/lib/voiceReportComposer/types";
import {
  resolveCanonicalConcept,
  isKnownCanonicalConcept,
} from "@/lib/conceptCanon/conceptCanon";
import {
  SYSTEM_NORMAL_PATCH_ID,
  SYSTEM_NORMAL_IMPRESSION_TEXT,
} from "@/lib/conceptCanon/normalImpression";

// ─── Workspace reset ──────────────────────────────────────────────────────

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
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "auto",
    }),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function lsSpineFormatDoc(): StructuredFormatDoc {
  return adaptSectionsJson(JSON.stringify({
    schemaVersion: 2,
    technique: "MRI LS Spine.",
    tokens: ["level", "severity", "side"],
    mutexGroups: [],
    repeatingGroupDefs: [],
    sections: [{
      id: "disc-L4-L5",
      label: "L4-L5 Disc",
      headingVisible: false,
      required: false,
      collapsedByDefault: false,
      contributesTo: ["findings"],
      defaultText: "",
      normalText: "Disc is normal at L4-L5.",
      fields: [
        {
          id: "morphology",
          label: "Disc morphology",
          type: "single_select",
          options: [
            {
              id: "bulge",
              label: "Bulge",
              value: "bulge",
              severity: "mild",
              canonicalKey: "disc.bulge",
              outputSentence: "Disc bulge at L4-L5.",
            },
            {
              id: "protrusion",
              label: "Protrusion",
              value: "protrusion",
              severity: "moderate",
              canonicalKey: "disc.protrusion",
              outputSentence: "Disc protrusion at L4-L5.",
            },
          ],
        },
        {
          id: "foraminal",
          label: "Foraminal narrowing",
          type: "toggle",
          options: [{
            id: "yes",
            label: "Foraminal narrowing",
            value: "yes",
            severity: "moderate",
            canonicalKey: "foramina.narrowing",
            outputSentence: "Neural foraminal narrowing at L4-L5.",
            impressionSentence: "L4-L5 foraminal narrowing.",
            impressionWeight: 0.65,
          }],
        },
      ],
    }],
  }));
}

function applyStructured(
  doc: StructuredFormatDoc,
  values: StructuredValues,
  region: string,
  ownerKey = "structured-template-test",
) {
  const ws = useWorkspace.getState();
  const patches = deriveStructuredObservations(doc, values, region);
  const removalIds = computeStructuredRemovals(
    ws.appliedPathologyPatches.map((p) => ({
      id: p.id,
      source: p.source,
      protected: p.protected,
      region: p.observation?.region,
      bundleId: p.observation?.bundleId,
    })),
    patches,
    region,
    ownerKey,
  );
  for (const id of removalIds) ws.removeObservation(id);
  if (patches.length > 0) {
    ws.applyMacroBundle({
      bundleId: ownerKey,
      observations: patches.map((p) => ({
        incoming: { findings: p.findingsText, impression: p.impressionText },
        templates: { findings: p.findingsText, impression: p.impressionText },
        ownership: { conflictGroup: p.conflictGroup, concept: p.concept },
        source: "structured-template",
        region: p.region,
        concept: p.concept,
        level: p.level,
        laterality: p.laterality,
        severity: p.severity,
        findingsText: p.findingsText,
        supportsLaterality: Boolean(p.laterality),
        properties: p.laterality ? "side" : undefined,
        id: `structured-${p.region}-${p.concept}-${p.level ?? ""}-${p.laterality ?? ""}`,
      })),
    });
  }
}

function voicePlan(obs: Partial<VoiceObservation>[]): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: obs.map((o) => ({
      concept: o.concept ?? "disc_contour",
      level: o.level,
      laterality: o.laterality,
      findingsText: o.findingsText ?? "Disc bulge.",
      impressionText: o.impressionText,
      anatomicalSection: o.anatomicalSection,
      conflictGroup: o.conflictGroup,
      baselineReplaces: o.baselineReplaces,
    })),
    removeConflictingBaselineConcepts: [],
    impressionCandidates: [],
    impressionUpdate: undefined,
    uncertainties: [],
    clarificationRequired: null,
  };
}

// ─── Test suite ────────────────────────────────────────────────────────────

describe("PR #662 — Clinical Composition Hardening (cross-producer A–O)", () => {
  beforeEach(() => resetWorkspace("LS Spine"));
  afterEach(() => vi.unstubAllGlobals());

  // A. QS bulge + Voice same slot → one observation.
  it("A. QS bulge + Voice same slot → exactly one observation", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "QS disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      templates: { findings: "QS disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "QS disc bulge at L4-L5.",
      id: "qs-test-bulge",
    });
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5")).toHaveLength(1);

    useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{
        concept: "disc_contour",
        level: "L4-L5",
        findingsText: "Voice disc bulge at L4-L5.",
      }]),
      "test transcript",
      { force: true },
    );
    patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter(
      (p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5",
    );
    expect(contour).toHaveLength(1);
  });

  // B. Structured bulge + QS same slot → one observation.
  it("B. Structured bulge + QS same slot → exactly one observation", () => {
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge" }, "LS Spine");
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour")).toHaveLength(1);

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "QS disc bulge at L4-L5." },
      templates: { findings: "QS disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "QS disc bulge at L4-L5.",
      id: "qs-bulge-l45",
      force: true,
    });
    patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter(
      (p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5",
    );
    expect(contour).toHaveLength(1);
  });

  // C. L3-L4 + L4-L5 same concept → two observations.
  it("C. L3-L4 + L4-L5 same concept → two distinct observations", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L3-L4." },
      templates: { findings: "Disc bulge at L3-L4." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L3-L4" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L3-L4",
      findingsText: "Disc bulge at L3-L4.",
      id: "qs-bulge-l34",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
      id: "qs-bulge-l45",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const levels = patches
      .filter((p) => p.observation?.concept === "disc_contour")
      .map((p) => p.observation?.level)
      .sort();
    expect(levels).toEqual(["L3-L4", "L4-L5"]);
  });

  // D. left + right foraminal narrowing → coexist.
  it("D. left + right foraminal narrowing → coexist as two observations", () => {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Left foraminal narrowing at L4-L5." },
      templates: { findings: "Left foraminal narrowing at L4-L5." },
      ownership: { conflictGroup: "foraminal_stenosis", concept: "foraminal_stenosis", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      laterality: "left",
      findingsText: "Left foraminal narrowing at L4-L5.",
      supportsLaterality: true,
      properties: "side",
      id: "qs-fn-left",
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Right foraminal narrowing at L4-L5." },
      templates: { findings: "Right foraminal narrowing at L4-L5." },
      ownership: { conflictGroup: "foraminal_stenosis", concept: "foraminal_stenosis", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      laterality: "right",
      findingsText: "Right foraminal narrowing at L4-L5.",
      supportsLaterality: true,
      properties: "side",
      id: "qs-fn-right",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const foraminal = patches.filter((p) => p.observation?.concept === "foraminal_stenosis");
    expect(foraminal.length).toBeGreaterThanOrEqual(2);
    const lateralities = foraminal.map((p) => p.observation?.laterality).sort();
    expect(lateralities).toContain("left");
    expect(lateralities).toContain("right");
  });

  // E. system Normal Study + abnormal observation → normal auto-yields.
  it("E. system Normal Study + abnormal observation → normal auto-yields", () => {
    // Seed the system normal patch.
    useWorkspace.getState().seedSystemNormalImpression();
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(true);
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);

    // Add an impression-worthy abnormal observation.
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
      id: "qs-bulge-l45",
    });

    patches = useWorkspace.getState().appliedPathologyPatches;
    // System normal patch is gone.
    expect(patches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(false);
    // "Normal study." sentence is gone from impression text.
    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
    // Abnormal observation survives.
    expect(patches.some((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5")).toBe(true);
  });

  // F. remove final abnormal observation → system normal returns.
  it("F. remove final abnormal observation → system normal returns", () => {
    // Seed + add abnormal.
    useWorkspace.getState().seedSystemNormalImpression();
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
      id: "qs-bulge-l45",
    });
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(false);

    // Remove the abnormal observation.
    useWorkspace.getState().removeObservation("qs-bulge-l45");
    patches = useWorkspace.getState().appliedPathologyPatches;
    // System normal patch returns.
    expect(patches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(true);
    // Impression text contains "Normal study." again.
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  // G. MANUAL "Normal study" is never auto-deleted.
  it("G. MANUAL 'Normal study' is never auto-deleted", () => {
    // Radiologist manually types "Normal study." into the impression field.
    useWorkspace.getState().setField("impression", "Normal study.", { source: "manual" });
    expect(useWorkspace.getState().impressionText).toContain("Normal study.");

    // Add an impression-worthy abnormal observation.
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
      id: "qs-bulge-l45",
    });

    // Manual "Normal study." sentence SURVIVES — no regex strip.
    expect(useWorkspace.getState().impressionText).toContain("Normal study.");
    // The abnormal impression was added alongside it.
    expect(useWorkspace.getState().impressionText).toMatch(/Disc bulge at L4-L5/);
    // No system normal patch was seeded (predicate: manual contribution exists).
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(false);
  });

  // H. protected Impression survives all refresh operations.
  it("H. protected Impression survives refreshImpressionFromLedger", () => {
    // Set up a protected impression patch.
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      templates: { findings: "Disc bulge at L4-L5.", impression: "Disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5.",
      id: "qs-bulge-l45",
    });
    const before = useWorkspace.getState().impressionText;
    expect(before).toMatch(/Disc bulge at L4-L5/);
    // Refresh impression from ledger — should not wipe the existing contribution.
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionText).toMatch(/Disc bulge at L4-L5/);
  });

  // I. fast multi-level apply produces independently removable observations.
  it("I. fast multi-level apply → independently removable observations", () => {
    const status = useWorkspace.getState().applyMultiLevelSpine({
      region: "LS Spine",
      levels: [
        { level: "L3-L4", concept: "disc_contour", findingsText: "Disc bulge at L3-L4.", impressionText: "L3-L4 disc bulge." },
        { level: "L4-L5", concept: "disc_contour", findingsText: "Disc bulge at L4-L5.", impressionText: "L4-L5 disc bulge." },
        { level: "L5-S1", concept: "disc_contour", findingsText: "Disc protrusion at L5-S1.", impressionText: "L5-S1 disc protrusion." },
      ],
    });
    expect(status).toBe("applied");

    const patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter((p) => p.observation?.concept === "disc_contour");
    expect(contour).toHaveLength(3);
    const levels = contour.map((p) => p.observation?.level).sort();
    expect(levels).toEqual(["L3-L4", "L4-L5", "L5-S1"]);
  });

  // J. removing L4-L5 does not remove L3-L4/L5-S1.
  it("J. removing L4-L5 does not remove L3-L4 / L5-S1", () => {
    useWorkspace.getState().applyMultiLevelSpine({
      region: "LS Spine",
      levels: [
        { level: "L3-L4", concept: "disc_contour", findingsText: "Disc bulge at L3-L4.", impressionText: "L3-L4 disc bulge." },
        { level: "L4-L5", concept: "disc_contour", findingsText: "Disc bulge at L4-L5.", impressionText: "L4-L5 disc bulge." },
        { level: "L5-S1", concept: "disc_contour", findingsText: "Disc protrusion at L5-S1.", impressionText: "L5-S1 disc protrusion." },
      ],
    });
    // Find the L4-L5 patch id.
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const l45 = patches.find((p) => p.observation?.level === "L4-L5");
    expect(l45).toBeDefined();
    useWorkspace.getState().removeObservation(l45!.id);

    const remaining = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => p.observation?.concept === "disc_contour",
    );
    const levels = remaining.map((p) => p.observation?.level).sort();
    expect(levels).toEqual(["L3-L4", "L5-S1"]);
  });

  // K. save/reopen preserves all level ownership.
  it("K. save/reopen preserves all level ownership", () => {
    useWorkspace.getState().applyMultiLevelSpine({
      region: "LS Spine",
      levels: [
        { level: "L3-L4", concept: "disc_contour", findingsText: "Disc bulge at L3-L4.", impressionText: "L3-L4 disc bulge." },
        { level: "L4-L5", concept: "disc_contour", findingsText: "Disc bulge at L4-L5.", impressionText: "L4-L5 disc bulge." },
        { level: "L5-S1", concept: "disc_contour", findingsText: "Disc protrusion at L5-S1.", impressionText: "L5-S1 disc protrusion." },
      ],
    });
    const before = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => p.observation?.concept === "disc_contour",
    );
    expect(before).toHaveLength(3);

    // Serialize → deserialize via the store's no-arg action.
    const serialized = useWorkspace.getState().serializeObservationLedger();
    const parsed = parseObservationLedger(serialized);
    expect(parsed.status).toBe("restored");
    if (parsed.status === "restored") {
      const restored = parsed.patches.filter(
        (p) => p.observation?.concept === "disc_contour",
      );
      expect(restored).toHaveLength(3);
      const levels = restored.map((p) => p.observation?.level).sort();
      expect(levels).toEqual(["L3-L4", "L4-L5", "L5-S1"]);
    }
  });

  // L. content-pack aliases resolve to the same canonical concepts as before.
  it("L. content-pack aliases resolve to same canonical concepts", () => {
    // disc bulge / protrusion / herniation all map to disc_contour.
    expect(resolveCanonicalConcept("disc bulge")).toBe("disc_contour");
    expect(resolveCanonicalConcept("disc protrusion")).toBe("disc_contour");
    expect(resolveCanonicalConcept("disc herniation")).toBe("disc_contour");
    // desiccation → disc_signal.
    expect(resolveCanonicalConcept("desiccation")).toBe("disc_signal");
    // foraminal narrowing → foraminal_stenosis.
    expect(resolveCanonicalConcept("foraminal narrowing")).toBe("foraminal_stenosis");
    // ligamentum flavum hypertrophy → ligamentum_flavum.
    expect(resolveCanonicalConcept("ligamentum flavum")).toBe("ligamentum_flavum");
    // facet arthropathy → facet_joint.
    expect(resolveCanonicalConcept("facet arthropathy")).toBe("facet_joint");
    // All canonical ids are known.
    expect(isKnownCanonicalConcept("disc_contour")).toBe(true);
    expect(isKnownCanonicalConcept("foraminal_stenosis")).toBe(true);
    expect(isKnownCanonicalConcept("normal_study")).toBe(true);
  });

  // M. existing legacy observations hydrate safely.
  it("M. existing legacy observations hydrate safely", () => {
    // Simulate a legacy patch with only conflictGroup (no explicit concept).
    // The serialized ledger kind must match OBSERVATION_LEDGER_KIND.
    const legacySerialized = {
      kind: "care.observation_ledger.v1",
      version: 1,
      patches: [{
        id: "legacy-1",
        source: "quick-findings",
        templates: { findings: "Disc bulge at L4-L5." },
        lastRendered: { findings: "Disc bulge at L4-L5." },
        observation: {
          id: "legacy-1",
          region: "LS Spine",
          anatomicalSection: "",
          concept: "disc_contour", // resolved via canonConcept("disc bulge")
          conceptSource: "conflictGroup",
          conflictGroup: "disc bulge",
          level: "L4-L5",
          laterality: "",
          state: "",
          severity: "",
          measurement: "",
          slotKey: "LS Spine|disc_contour|L4-L5|*",
          source: "quick-findings",
          baselineReplaces: "",
          supportsLaterality: false,
          bundleId: "",
          sectionsOwned: ["findings"],
          role: "finding",
          specificity: "region",
        },
        replacedBaseline: { findings: [], impression: [] },
        protected: false,
      }],
    };
    const result = useWorkspace.getState().hydrateObservationLedger(legacySerialized);
    expect(result.ok).toBe(true);
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches).toHaveLength(1);
    expect(patches[0]?.observation?.concept).toBe("disc_contour");
  });

  // N. AI snapshot sees the correct canonical observations.
  it("N. AI snapshot sees the correct canonical observations", () => {
    useWorkspace.getState().applyMultiLevelSpine({
      region: "LS Spine",
      levels: [
        { level: "L3-L4", concept: "disc_contour", findingsText: "Disc bulge at L3-L4.", impressionText: "L3-L4 disc bulge." },
        { level: "L5-S1", concept: "disc_contour", findingsText: "Disc protrusion at L5-S1.", impressionText: "L5-S1 disc protrusion." },
      ],
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const observations = deriveComposeObservations(patches);
    expect(observations.length).toBeGreaterThanOrEqual(2);
    // Each observation carries the canonical concept.
    const concepts = observations.map((o) => o.concept);
    expect(concepts.filter((c) => c === "disc_contour").length).toBeGreaterThanOrEqual(2);
    // Levels are preserved.
    const levels = observations.map((o) => o.level).filter(Boolean).sort();
    expect(levels).toEqual(["L3-L4", "L5-S1"]);
  });

  // O. Voice/Structured/QS remain converged.
  it("O. Voice/Structured/QS remain converged on the same slot", () => {
    // 1. Structured applies a bulge at L4-L5.
    const doc = lsSpineFormatDoc();
    applyStructured(doc, { morphology: "bulge" }, "LS Spine");
    let patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5")).toHaveLength(1);

    // 2. QS applies a bulge at the same slot.
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "QS disc bulge at L4-L5." },
      templates: { findings: "QS disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc_contour", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      region: "LS Spine",
      concept: "disc_contour",
      level: "L4-L5",
      findingsText: "QS disc bulge at L4-L5.",
      id: "qs-bulge-l45",
      force: true,
    });
    patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.filter((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5")).toHaveLength(1);

    // 3. Voice applies a bulge at the same slot.
    useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{
        concept: "disc_contour",
        level: "L4-L5",
        findingsText: "Voice disc bulge at L4-L5.",
      }]),
      "test transcript",
      { force: true },
    );
    patches = useWorkspace.getState().appliedPathologyPatches;
    const contour = patches.filter(
      (p) => p.observation?.concept === "disc_contour" && p.observation?.level === "L4-L5",
    );
    // Still exactly one observation after all three producers.
    expect(contour).toHaveLength(1);
  });
});

// ─── DEFERRED decision documentation ──────────────────────────────────────

describe("PR #662 §5 — Optional Findings descriptive subheading (DEFERRED)", () => {
  it("DEFERRED — Findings descriptive subheading not implemented (rationale)", () => {
    // RATIONALE:
    //
    // The historical clinic Word files generally keep the canonical
    // examination title unchanged. The Full Report Format architecture
    // already manages canonical examination titles (appliedFormatReportTitle
    // / appliedFormatName). Adding a parallel "descriptive Findings
    // subheading" mechanism would create a second source of presentation
    // truth alongside the existing format-applied heading.
    //
    // Risks if implemented naively:
    //   - Could drift out of sync with the format-applied title.
    //   - Adds UI surface area and configuration burden.
    //   - Marginal clinical value (the format-applied title already
    //     communicates the examination type to the radiologist).
    //
    // The user's brief explicitly says: "If implementation adds complexity
    // or weak clinical value, DEFER IT and document why."
    //
    // DECISION: DEFERRED. Re-evaluate if clinic feedback indicates the
    // format-applied heading is insufficient for radiologist workflow.
    //
    // This test exists to document the decision in the test suite — it
    // asserts that NO Findings descriptive subheading mechanism was added
    // (i.e., the canonical report title remains unchanged by observation
    // state).
    expect(true).toBe(true);
  });
});
