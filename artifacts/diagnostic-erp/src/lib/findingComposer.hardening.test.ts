/**
 * Hardening regressions for PR #649 (same-slot + composer + impression + dictation).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildComposerCatalog,
  observationIncludesInImpression,
  pendingFromComposerDraft,
  proposeComposerFromTranscript,
  renderComposerPhrase,
} from "./findingComposerModel";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { provenanceFromText } from "./reportFieldMerge";
import {
  emptyViewerMeasurementsState,
  upsertStructuredMeasurement,
  remapStructuredMeasurementsObservationId,
} from "./structuredViewerMeasurements";
import { serializeObservationLedger } from "./observationLedger";
import type { ObservationAnchor } from "./observationAnchor";

const ANCHOR: ObservationAnchor = {
  studyInstanceUID: "1.2.3",
  seriesInstanceUID: "1.2.3.4",
  sopInstanceUID: "1.2.3.4.5",
  frameNumber: 3,
  viewer: "ohif",
  capturedAt: "2026-01-01T00:00:00.000Z",
};

function baseWorkspace() {
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
}

describe("hardening — impression participation semantic", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    baseWorkspace();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Include uses lastRendered.impression only — templates alone do not count", () => {
    expect(observationIncludesInImpression({
      lastRendered: { findings: "Mild disc bulge at L4-L5.", impression: "" },
      templates: { findings: "Mild disc bulge at L4-L5.", impression: "Mild disc bulge at L4-L5." },
    })).toBe(false);
    expect(observationIncludesInImpression({
      lastRendered: { findings: "Mild disc bulge at L4-L5.", impression: "Mild disc bulge at L4-L5." },
      templates: { findings: "Mild disc bulge at L4-L5.", impression: "" },
    })).toBe(true);
  });

  it("toggle does not recreate observation id or wipe findings / evidence", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-imp",
      incoming: { findings: "Mild disc bulge at L4-L5.", impression: "Mild disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
      anchor: ANCHOR,
    });
    useWorkspace.setState({
      structuredViewerMeasurements: upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
        id: "m-keep",
        concept: "LINEAR",
        values: { primary: 4.8, unit: "mm" },
        observationId: "O-imp",
        viewerAnnotationId: "ann-keep",
        anchor: ANCHOR,
        manualOverride: false,
      }),
    });
    const beforeFindings = useWorkspace.getState().findingsText;
    useWorkspace.getState().setObservationImpressionParticipation("O-imp", false);
    const mid = useWorkspace.getState();
    expect(mid.appliedPathologyPatches[0]!.id).toBe("O-imp");
    expect(mid.findingsText).toBe(beforeFindings);
    expect(mid.structuredViewerMeasurements.items[0]?.observationId).toBe("O-imp");
    expect(mid.structuredViewerMeasurements.items[0]?.viewerAnnotationId).toBe("ann-keep");
    expect(observationIncludesInImpression(mid.appliedPathologyPatches[0]!)).toBe(false);

    useWorkspace.getState().setField("impression", "Manual impression stays.");
    useWorkspace.getState().setObservationImpressionParticipation("O-imp", true);
    expect(useWorkspace.getState().impressionText).toBe("Manual impression stays.");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });
});

describe("hardening — slot-change + evidence", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    baseWorkspace();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("empty target L4-L5 → L5-S1 strips old generated prose and keeps id + measurement", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const mild = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-move" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(mild, bulge, renderComposerPhrase(mild, bulge)),
      id: "O-move", editingId: "O-move",
    });
    useWorkspace.setState({
      structuredViewerMeasurements: upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
        id: "m-move",
        concept: "LINEAR",
        values: { primary: 5, unit: "mm" },
        observationId: "O-move",
        viewerAnnotationId: "ann-move",
        anchor: ANCHOR,
        manualOverride: false,
      }),
    });
    const next = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "moderate",
      laterality: "", includeInImpression: false, editingId: "O-move" as string | null,
    };
    const status = useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(next, bulge, renderComposerPhrase(next, bulge)),
      editingId: "O-move",
    });
    expect(status).toBe("applied");
    const s = useWorkspace.getState();
    expect(s.appliedPathologyPatches).toHaveLength(1);
    expect(s.appliedPathologyPatches[0]!.id).toBe("O-move");
    expect(s.findingsText).toMatch(/L5-S1/i);
    expect(s.findingsText).not.toMatch(/L4-L5/i);
    expect(s.structuredViewerMeasurements.items[0]?.observationId).toBe("O-move");
    expect(s.structuredViewerMeasurements.items[0]?.viewerAnnotationId).toBe("ann-move");
  });

  it("occupied slot confirm remaps measurements onto survivor (no silent discard)", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const a = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-a" as string | null,
    };
    const b = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-b" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(a, bulge, renderComposerPhrase(a, bulge)),
      id: "O-a", editingId: "O-a",
    });
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(b, bulge, renderComposerPhrase(b, bulge)),
      id: "O-b", editingId: "O-b",
    });
    useWorkspace.setState({
      structuredViewerMeasurements: upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
        id: "m-a",
        concept: "LINEAR",
        values: { primary: 4.1, unit: "mm" },
        observationId: "O-a",
        viewerAnnotationId: "ann-a",
        anchor: ANCHOR,
        manualOverride: false,
      }),
    });

    // Protected sibling → pending confirm
    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) =>
        p.id === "O-b" ? { ...p, protected: true } : p),
      fieldProvenance: {
        findings: {
          ...provenanceFromText(useWorkspace.getState().findingsText, "quick-findings"),
          ...provenanceFromText(
            useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "O-b")!.lastRendered.findings!,
            "manual",
          ),
        },
      },
    });

    const move = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "severe",
      laterality: "", includeInImpression: false, editingId: "O-a" as string | null,
    };
    const status = useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(move, bulge, renderComposerPhrase(move, bulge)),
      editingId: "O-a",
    });
    expect(status).toBe("pending");
    expect(useWorkspace.getState().pendingPathologyPatch?.vacatedObservationId).toBe("O-a");
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === "O-a")).toBe(true);

    useWorkspace.getState().confirmOverwriteAndApply();
    const after = useWorkspace.getState();
    expect(after.confirmOverwriteOpen).toBe(false);
    expect(after.appliedPathologyPatches.map((p) => p.id)).toEqual(["O-b"]);
    expect(after.structuredViewerMeasurements.items[0]?.observationId).toBe("O-b");
    expect(after.structuredViewerMeasurements.items[0]?.viewerAnnotationId).toBe("ann-a");
    expect(after.findingsText).toMatch(/Severe.*L5-S1/i);
    expect(after.findingsText).not.toMatch(/L4-L5/i);
  });

  it("force-replace remaps evidence onto survivor", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const a = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-a" as string | null,
    };
    const b = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-b" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(a, bulge, renderComposerPhrase(a, bulge)),
      id: "O-a", editingId: "O-a",
    });
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(b, bulge, renderComposerPhrase(b, bulge)),
      id: "O-b", editingId: "O-b",
    });
    useWorkspace.setState({
      structuredViewerMeasurements: upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
        id: "m-a",
        concept: "LINEAR",
        values: { primary: 4.1, unit: "mm" },
        observationId: "O-a",
        viewerAnnotationId: "ann-a",
        anchor: ANCHOR,
        manualOverride: false,
      }),
    });
    const move = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "moderate",
      laterality: "", includeInImpression: false, editingId: "O-a" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(move, bulge, renderComposerPhrase(move, bulge)),
      editingId: "O-a",
      force: true,
    });
    const after = useWorkspace.getState();
    expect(after.appliedPathologyPatches.map((p) => p.id)).toEqual(["O-b"]);
    expect(after.structuredViewerMeasurements.items[0]?.observationId).toBe("O-b");
    expect(after.structuredViewerMeasurements.items[0]?.id).toBe("m-a");
  });

  it("remapStructuredMeasurementsObservationId is explicit", () => {
    const state = upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
      id: "m1",
      concept: "LINEAR",
      values: { primary: 1, unit: "mm" },
      observationId: "from",
      viewerAnnotationId: "ann",
      manualOverride: false,
    });
    const { remapped, state: next } = remapStructuredMeasurementsObservationId(state, "from", "to");
    expect(remapped).toBe(1);
    expect(next.items[0]?.observationId).toBe("to");
    expect(next.items[0]?.viewerAnnotationId).toBe("ann");
  });
});

describe("hardening — catalog / dictation / persistence / manual / finalize", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    baseWorkspace();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Quick Finding catalog concept suppresses builtin duplicate for same CONCEPT_CANON", () => {
    const qf = [{
      id: 42,
      studyType: "LS Spine",
      label: "Diffuse disc bulge",
      findingText: "{severity} disc bulge at {level}.",
      impressionText: "{severity} disc bulge at {level}.",
      techniqueText: "",
      recommendationText: "",
      icdCode: "",
      tags: "",
      suggests: "",
      properties: "side",
      category: "",
      anatomicalSection: "{level}",
      conflictGroup: "disc bulge",
      baselineReplaces: "",
      questionsJson: JSON.stringify([
        { key: "level", label: "Level", type: "select", options: ["L4-L5"], default: "L4-L5", required: true, sortOrder: 0 },
        { key: "severity", label: "Severity", type: "select", options: ["mild", "moderate"], default: "mild", required: true, sortOrder: 1 },
      ]),
      sortOrder: 0,
      isActive: true,
    }];
    const catalog = buildComposerCatalog(qf as never, "LS Spine");
    const disc = catalog.filter((e) => e.concept === "disc_contour");
    expect(disc).toHaveLength(1);
    expect(disc[0]!.key).toBe("qf-42");
  });

  it("ambiguous dictation never auto-commits; proposal alone leaves ledger empty", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const p = proposeComposerFromTranscript(
      "There is mild motion artefact limiting evaluation.",
      catalog,
      "LS Spine",
    );
    expect(p.confidence).toBe("low");
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
  });

  it("unrelated manual Findings remain byte-identical after same-slot replace", () => {
    useWorkspace.getState().setField("findings", "Radiologist free text about scoliosis.");
    const manual = useWorkspace.getState().findingsText;
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const mild = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O1" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(mild, bulge, renderComposerPhrase(mild, bulge)),
      id: "O1", editingId: "O1",
    });
    const mod = { ...mild, severity: "moderate" };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(mod, bulge, renderComposerPhrase(mod, bulge)),
      id: "O1", editingId: "O1",
    });
    expect(useWorkspace.getState().findingsText).toContain(manual);
    expect(useWorkspace.getState().findingsText).toMatch(/Moderate/i);
    expect(useWorkspace.getState().findingsText).not.toMatch(/Mild diffuse|Mild disc bulge/i);
  });

  it("serialize/hydrate preserves Include participation and observation id", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-hyd",
      incoming: { findings: "Mild disc bulge at L4-L5.", impression: "Mild disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
      anchor: ANCHOR,
    });
    useWorkspace.getState().setObservationImpressionParticipation("O-hyd", false);
    const blob = useWorkspace.getState().serializeObservationLedger();
    expect(observationIncludesInImpression(
      useWorkspace.getState().appliedPathologyPatches[0]!,
    )).toBe(false);

    baseWorkspace();
    useWorkspace.getState().hydrateObservationLedger(blob);
    const p = useWorkspace.getState().appliedPathologyPatches[0]!;
    expect(p.id).toBe("O-hyd");
    expect(observationIncludesInImpression(p)).toBe(false);
    expect(p.observation?.anchor?.sopInstanceUID).toBe("1.2.3.4.5");
  });

  it("finalized blocks composer and impression toggle programmatically", () => {
    useWorkspace.setState({ isFinalized: true });
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const d = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: null as string | null,
    };
    expect(useWorkspace.getState().applyComposerFinding(
      pendingFromComposerDraft(d, bulge, renderComposerPhrase(d, bulge)),
    )).toBe("blocked");
    expect(useWorkspace.getState().setObservationImpressionParticipation("x", true)).toBe("blocked");
  });

  it("Quick Findings overlay still works without composer", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qf-1",
      incoming: { findings: "Mild canal stenosis at L4-L5." },
      ownership: { conflictGroup: "canal stenosis", concept: "canal_stenosis", level: "L4-L5" },
      source: "quick-findings",
      concept: "canal_stenosis",
      level: "L4-L5",
      region: "LS Spine",
    });
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("qf-1");
    expect(useWorkspace.getState().findingsText).toMatch(/canal stenosis/i);
  });
});
