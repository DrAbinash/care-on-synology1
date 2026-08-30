/**
 * Finding Composer + Impression participation + dictation proposal tests.
 * All structured commits go through applyComposerFinding → applyPathologyOverlay.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildComposerCatalog,
  draftFromObservation,
  emptyComposerDraft,
  observationIncludesInImpression,
  pendingFromComposerDraft,
  proposeComposerFromTranscript,
  renderComposerPhrase,
  visibleComposerControls,
} from "./findingComposerModel";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState, upsertStructuredMeasurement } from "./structuredViewerMeasurements";
import { buildCanonicalObservation } from "./observationSlot";
import type { ObservationAnchor } from "./observationAnchor";

const ANCHOR: ObservationAnchor = {
  studyInstanceUID: "1.2.3",
  seriesInstanceUID: "1.2.3.4",
  sopInstanceUID: "1.2.3.4.5",
  frameNumber: 7,
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

describe("findingComposerModel (pure)", () => {
  it("shows level+severity for disc bulge; grade for Fazekas; no empty laterality for canal", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.concept === "disc_contour")!;
    const canal = catalog.find((e) => e.concept === "canal_stenosis")!;
    expect(visibleComposerControls(bulge, "LS Spine")).toMatchObject({
      level: true,
      severity: true,
      laterality: true,
    });
    expect(visibleComposerControls(canal, "LS Spine").laterality).toBe(false);

    const brain = buildComposerCatalog([], "Brain");
    const faz = brain.find((e) => e.concept === "fazekas")!;
    expect(visibleComposerControls(faz, "Brain")).toMatchObject({
      level: false,
      grade: true,
      laterality: false,
    });
  });

  it("renders mild→moderate phrase from builtin disc bulge", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const mild = renderComposerPhrase({
      region: "LS Spine",
      catalogKey: bulge.key,
      level: "L4-L5",
      severity: "mild",
      laterality: "",
      includeInImpression: true,
    }, bulge);
    expect(mild.findings).toMatch(/Mild.*disc bulge.*L4-L5/i);
    expect(mild.impression).toBeTruthy();

    const noImp = renderComposerPhrase({
      region: "LS Spine",
      catalogKey: bulge.key,
      level: "L4-L5",
      severity: "moderate",
      laterality: "bilateral",
      includeInImpression: false,
    }, bulge);
    expect(noImp.findings).toMatch(/Moderate/i);
    expect(noImp.impression).toBe("");
  });

  it("high-confidence dictation proposal does not auto-commit — only returns draft", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const p = proposeComposerFromTranscript(
      "Moderate diffuse disc bulge at L4-L5 with bilateral foraminal narrowing.",
      catalog,
      "LS Spine",
    );
    expect(p.confidence).toBe("high");
    expect(p.draft.level).toBe("L4-L5");
    expect(p.draft.severity).toBe("moderate");
    expect(p.catalogKey).toBeTruthy();
  });

  it("low-confidence dictation stays low", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const p = proposeComposerFromTranscript(
      "There is mild motion artefact limiting evaluation.",
      catalog,
      "LS Spine",
    );
    expect(p.confidence).toBe("low");
  });
});

describe("applyComposerFinding (same-slot)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    baseWorkspace();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a new canonical observation", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const draft = {
      region: "LS Spine",
      catalogKey: bulge.key,
      level: "L4-L5",
      severity: "mild",
      laterality: "",
      includeInImpression: true,
      editingId: null as string | null,
    };
    const phrase = renderComposerPhrase(draft, bulge);
    const pending = pendingFromComposerDraft(draft, bulge, phrase);
    const status = useWorkspace.getState().applyComposerFinding(pending);
    expect(status).toBe("applied");
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);
    expect(useWorkspace.getState().findingsText).toMatch(/Mild.*disc bulge/i);
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.observation?.anchor?.sopInstanceUID).toBe("1.2.3.4.5");
  });

  it("same-slot edit preserves observation id, measurement, anchor, annotation", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const mildDraft = {
      region: "LS Spine",
      catalogKey: bulge.key,
      level: "L4-L5",
      severity: "mild",
      laterality: "",
      includeInImpression: false,
      editingId: "O123" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(mildDraft, bulge, renderComposerPhrase(mildDraft, bulge)),
      editingId: "O123",
      id: "O123",
    });
    expect(useWorkspace.getState().appliedPathologyPatches[0]!.id).toBe("O123");

    useWorkspace.setState({
      structuredViewerMeasurements: upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
        id: "m1",
        concept: "LINEAR",
        values: { primary: 4.8, unit: "mm" },
        observationId: "O123",
        viewerAnnotationId: "ann-55",
        anchor: ANCHOR,
        manualOverride: false,
      }),
    });

    const modDraft = { ...mildDraft, severity: "moderate", editingId: "O123" };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(modDraft, bulge, renderComposerPhrase(modDraft, bulge)),
      editingId: "O123",
      id: "O123",
    });
    const after = useWorkspace.getState();
    expect(after.appliedPathologyPatches).toHaveLength(1);
    expect(after.appliedPathologyPatches[0]!.id).toBe("O123");
    expect(after.appliedPathologyPatches[0]!.observation?.severity).toBe("moderate");
    expect(after.appliedPathologyPatches[0]!.observation?.anchor?.frameNumber).toBe(7);
    expect(after.findingsText).toMatch(/Moderate/i);
    expect(after.findingsText).not.toMatch(/Mild diffuse/i);
    expect(after.structuredViewerMeasurements.items[0]?.observationId).toBe("O123");
    expect(after.structuredViewerMeasurements.items[0]?.viewerAnnotationId).toBe("ann-55");
  });

  it("different concepts at same level remain separate", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const canal = catalog.find((e) => e.key === "builtin-canal-stenosis")!;
    for (const [entry, sev] of [[bulge, "mild"], [canal, "moderate"]] as const) {
      const d = {
        region: "LS Spine",
        catalogKey: entry.key,
        level: "L4-L5",
        severity: sev,
        laterality: "",
        includeInImpression: false,
        editingId: null as string | null,
      };
      useWorkspace.getState().applyComposerFinding(pendingFromComposerDraft(d, entry, renderComposerPhrase(d, entry)));
    }
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
  });

  it("left/right foraminal coexist", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const foramen = catalog.find((e) => e.key === "builtin-foraminal")!;
    for (const lat of ["left", "right"] as const) {
      const d = {
        region: "LS Spine",
        catalogKey: foramen.key,
        level: "L4-L5",
        severity: "mild",
        laterality: lat,
        includeInImpression: false,
        editingId: null as string | null,
      };
      useWorkspace.getState().applyComposerFinding(pendingFromComposerDraft(d, foramen, renderComposerPhrase(d, foramen)));
    }
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
  });

  it("changing to an occupied slot invokes same-slot conflict / replace keeping target id", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    // O-a at L4-L5 mild
    const a = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-a" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(a, bulge, renderComposerPhrase(a, bulge)),
      id: "O-a", editingId: "O-a",
    });
    // O-b at L5-S1 mild
    const b = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-b" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(b, bulge, renderComposerPhrase(b, bulge)),
      id: "O-b", editingId: "O-b",
    });
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);

    // Edit O-a → L5-S1 moderate (occupied by O-b)
    const move = {
      region: "LS Spine", catalogKey: bulge.key, level: "L5-S1", severity: "moderate",
      laterality: "", includeInImpression: false, editingId: "O-a" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(move, bulge, renderComposerPhrase(move, bulge)),
      editingId: "O-a",
      force: true,
    });
    const ids = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
    expect(ids).toContain("O-b");
    expect(ids).not.toContain("O-a");
    expect(useWorkspace.getState().findingsText).toMatch(/Moderate.*L5-S1/i);
  });

  it("Quick Finding → draftFromObservation prefills composer", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qf-9",
      incoming: { findings: "Mild diffuse disc bulge at L4-L5." },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
      severity: "mild",
    });
    const patch = useWorkspace.getState().appliedPathologyPatches[0]!;
    const catalog = buildComposerCatalog([], "LS Spine");
    const draft = draftFromObservation(patch, catalog, "LS Spine");
    expect(draft.editingId).toBe("qf-9");
    expect(draft.level).toBe("L4-L5");
    expect(draft.severity).toBe("mild");
    expect(draft.catalogKey).toBeTruthy();
  });

  it("undo restores composer update", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const mild = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: "O-u" as string | null,
    };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(mild, bulge, renderComposerPhrase(mild, bulge)),
      id: "O-u", editingId: "O-u",
    });
    const mod = { ...mild, severity: "severe" };
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(mod, bulge, renderComposerPhrase(mod, bulge)),
      id: "O-u", editingId: "O-u",
    });
    expect(useWorkspace.getState().findingsText).toMatch(/Severe/i);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toMatch(/Mild/i);
  });

  it("finalized report blocks composer mutation", () => {
    useWorkspace.setState({ isFinalized: true, findingsText: "Locked." });
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const d = emptyComposerDraft("LS Spine");
    Object.assign(d, { catalogKey: bulge.key, level: "L4-L5", severity: "mild" });
    const status = useWorkspace.getState().applyComposerFinding(
      pendingFromComposerDraft(d, bulge, renderComposerPhrase(d, bulge)),
    );
    expect(status).toBe("blocked");
    expect(useWorkspace.getState().findingsText).toBe("Locked.");
  });
});

describe("Impression participation toggle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    baseWorkspace();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("toggle does not remove Findings; preserves evidence; marks Impression stale", () => {
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
      severity: "mild",
      anchor: ANCHOR,
    });
    useWorkspace.setState({
      structuredViewerMeasurements: upsertStructuredMeasurement(emptyViewerMeasurementsState(), {
        id: "m2",
        concept: "LINEAR",
        values: { primary: 3, unit: "mm" },
        observationId: "O-imp",
        viewerAnnotationId: "ann-1",
        anchor: ANCHOR,
        manualOverride: false,
      }),
    });
    expect(observationIncludesInImpression(useWorkspace.getState().appliedPathologyPatches[0]!)).toBe(true);

    useWorkspace.getState().setObservationImpressionParticipation("O-imp", false);
    const after = useWorkspace.getState();
    expect(after.findingsText).toMatch(/Mild diffuse disc bulge/i);
    expect(observationIncludesInImpression(after.appliedPathologyPatches[0]!)).toBe(false);
    expect(after.impressionNeedsRefresh).toBe(true);
    expect(after.structuredViewerMeasurements.items[0]?.observationId).toBe("O-imp");
    expect(after.appliedPathologyPatches[0]!.observation?.anchor?.sopInstanceUID).toBe("1.2.3.4.5");

    useWorkspace.getState().setObservationImpressionParticipation("O-imp", true);
    expect(observationIncludesInImpression(useWorkspace.getState().appliedPathologyPatches[0]!)).toBe(true);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("manual Impression is never silently overwritten by include toggle", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-man",
      incoming: { findings: "Mild canal stenosis at L4-L5.", impression: "" },
      ownership: { conflictGroup: "canal stenosis", concept: "canal_stenosis", level: "L4-L5" },
      source: "quick-findings",
      concept: "canal_stenosis",
      level: "L4-L5",
      region: "LS Spine",
    });
    useWorkspace.getState().setField("impression", "My custom impression.");
    useWorkspace.getState().setObservationImpressionParticipation("O-man", true);
    expect(useWorkspace.getState().impressionText).toMatch(/My custom impression/i);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("undo restores impression participation change", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "O-u2",
      incoming: {
        findings: "Moderate disc bulge at L4-L5.",
        impression: "Moderate disc bulge at L4-L5.",
      },
      ownership: { conflictGroup: "disc bulge", concept: "disc_contour", level: "L4-L5" },
      source: "quick-findings",
      concept: "disc_contour",
      level: "L4-L5",
      region: "LS Spine",
    });
    useWorkspace.getState().setObservationImpressionParticipation("O-u2", false);
    expect(observationIncludesInImpression(useWorkspace.getState().appliedPathologyPatches[0]!)).toBe(false);
    useWorkspace.getState().undoLastPatch();
    expect(observationIncludesInImpression(useWorkspace.getState().appliedPathologyPatches[0]!)).toBe(true);
  });

  it("finalized blocks impression toggle", () => {
    useWorkspace.setState({ isFinalized: true });
    expect(useWorkspace.getState().setObservationImpressionParticipation("x", true)).toBe("blocked");
  });
});

describe("Dictation note path", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    baseWorkspace();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Add as Note creates protected free text without observation row", () => {
    useWorkspace.getState().mergeField(
      "findings",
      "There is mild motion artefact limiting evaluation.",
      "radiologist-voice",
    );
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
    expect(useWorkspace.getState().findingsText).toMatch(/motion artefact/i);
    const prov = useWorkspace.getState().fieldProvenance.findings ?? {};
    const sources = Object.values(prov).flat();
    expect(sources).toContain("radiologist-voice");
  });

  it("confirmed structured dictation goes through same-slot (no duplicate on re-confirm)", () => {
    const catalog = buildComposerCatalog([], "LS Spine");
    const proposal = proposeComposerFromTranscript(
      "Mild diffuse disc bulge at L4-L5.",
      catalog,
      "LS Spine",
    );
    expect(proposal.confidence).toBe("high");
    const entry = catalog.find((e) => e.key === proposal.catalogKey)!;
    const draft = {
      ...emptyComposerDraft("LS Spine"),
      ...proposal.draft,
      catalogKey: proposal.catalogKey!,
    };
    const pending = pendingFromComposerDraft(draft, entry, renderComposerPhrase(draft, entry));
    useWorkspace.getState().applyComposerFinding({ ...pending, id: "dict-1", editingId: null });
    useWorkspace.getState().applyComposerFinding({
      ...pendingFromComposerDraft(
        { ...draft, severity: "mild" },
        entry,
        renderComposerPhrase({ ...draft, severity: "mild" }, entry),
      ),
      id: "dict-2",
    });
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);
  });

  it("legacy incomplete observation is not incorrectly replaced by composer", () => {
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
        }),
        protected: false,
      }],
      findingsText: "Old freeform disc note.",
    });
    const catalog = buildComposerCatalog([], "LS Spine");
    const bulge = catalog.find((e) => e.key === "builtin-disc-bulge")!;
    const d = {
      region: "LS Spine", catalogKey: bulge.key, level: "L4-L5", severity: "mild",
      laterality: "", includeInImpression: false, editingId: null as string | null,
    };
    useWorkspace.getState().applyComposerFinding(pendingFromComposerDraft(d, bulge, renderComposerPhrase(d, bulge)));
    const ids = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
    expect(ids).toContain("legacy-1");
    expect(ids.length).toBe(2);
  });
});
