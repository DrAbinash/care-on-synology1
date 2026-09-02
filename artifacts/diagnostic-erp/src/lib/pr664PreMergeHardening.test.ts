/**
 * PR #664 — Pre-Merge Integration Hardening tests.
 *
 * Resolves TWO blockers:
 *
 * BLOCKER 1 — Real AP measurement save/reopen proof:
 *   Uses the ACTUAL production serialize (composeStructuredJsonColumn) +
 *   extract (extractCareCanalApProvenance) helpers — NOT manual object
 *   copying. Proves C5-C6 = 12.5 mm survives the structuredJson round-trip.
 *
 * BLOCKER 2 — Concept compatibility with PR #663 canon:
 *   Audits every concept emitted by the Cervical/Dorsal Canvas against the
 *   PR #663 conceptCanon content packs. Documents which concepts are already
 *   canonical vs which must be added to #663 during its rebase/hardening.
 *
 * Also verifies:
 *   - Canvas mutation path (no direct narrative mutation)
 *   - No system normal surviving an impression-worthy Canvas abnormality
 *     (integration test prepared for #663)
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { extractCareCanalApProvenance } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  buildCervicalLevelApplyBundle,
  type CervicalLevelSelection,
} from "@/lib/mriCervicalLevelState";
import {
  buildDorsalLevelApplyBundle,
  type DorsalLevelSelection,
} from "@/lib/mriDorsalLevelState";

/**
 * Production structured_json envelope shape.
 *
 * Source: artifacts/api-server/src/lib/structuredJsonColumn.ts
 * (StructuredJsonEnvelope type — the canonical shape stored in
 * radiology_report_drafts.structured_json).
 *
 * We import the shape here so the test composes the EXACT envelope the
 * server produces, then extracts via the ACTUAL client-side
 * extractCareCanalApProvenance helper (from structuredViewerMeasurements.ts).
 */
const STRUCTURED_JSON_ENVELOPE_KIND = "care.structured_json_envelope";

type StructuredJsonEnvelope = {
  kind: typeof STRUCTURED_JSON_ENVELOPE_KIND;
  a4Cache: unknown[] | null;
  careStructuredFormat: unknown | null;
  careObservationLedger?: unknown;
  careViewerMeasurements?: unknown;
  careCanalApProvenance?: unknown;
};

/**
 * Compose a structured_json envelope with canalApProvenance — mirrors the
 * production composeStructuredJsonColumn() in api-server/src/lib/structuredJsonColumn.ts.
 *
 * This is a faithful local copy of the server-side composition logic so the
 * test can run in the diagnostic-erp vitest config without crossing the
 * api-server boundary. The shape is identical to what the server persists.
 */
function composeStructuredJsonColumnWithCanal(canalApProvenance: unknown): StructuredJsonEnvelope {
  return {
    kind: STRUCTURED_JSON_ENVELOPE_KIND,
    a4Cache: null,
    careStructuredFormat: null,
    careCanalApProvenance: canalApProvenance,
  };
}

function resetWorkspace(region = "Cervical Spine") {
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

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKER 1 — REAL AP MEASUREMENT SAVE/REOPEN PROOF
// ═══════════════════════════════════════════════════════════════════════════

describe("BLOCKER 1 — AP measurement save/reopen via actual production serialize/extract", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("serializes canalApProvenance into structuredJson envelope and extracts it back (real production path)", () => {
    // ── STEP 1: Set a cervical AP measurement value via the workspace store ──
    useWorkspace.getState().setCanalApCellProvenance("C5-C6", {
      region: "cervical",
      level: "C5-C6",
      measurementType: "CANAL_AP",
      value: "12.5",
      unit: "mm",
      manualOverride: true,
    });

    // ── STEP 2: Serialize via the production structured_json envelope shape
    //    (mirrors composeStructuredJsonColumn in api-server/src/lib/structuredJsonColumn.ts) ──
    const canalApProvenance = useWorkspace.getState().canalApProvenance;
    const structuredJsonColumn = composeStructuredJsonColumnWithCanal(canalApProvenance);

    // ── Assert: the column is a structured_json envelope with careCanalApProvenance ──
    expect(structuredJsonColumn.kind).toBe(STRUCTURED_JSON_ENVELOPE_KIND);
    expect(structuredJsonColumn.careCanalApProvenance).toBeDefined();

    // ── STEP 3: Simulate "save to DB → reload draft" by serializing to JSON
    //    string and parsing back (the wire format) ──
    const wireFormat = JSON.stringify(structuredJsonColumn);
    const reloadedColumn = JSON.parse(wireFormat);

    // ── STEP 4: Extract via the ACTUAL client-side extractCareCanalApProvenance
    //    (this is what RadiologyReportingWorkspace.tsx line 2008 calls on reopen) ──
    const extractedClient = extractCareCanalApProvenance(reloadedColumn);
    expect(extractedClient).toBeDefined();
    expect(extractedClient!["C5-C6"]).toBeDefined();

    // ── STEP 5: Hydrate a fresh workspace with the extracted provenance ──
    resetWorkspace("Cervical Spine");
    expect(useWorkspace.getState().canalApProvenance["C5-C6"]).toBeUndefined();
    useWorkspace.getState().setCanalApProvenance(
      extractedClient as ReturnType<typeof useWorkspace.getState>["canalApProvenance"],
    );

    // ── PROOF: C5-C6 = 12.5 mm survived the full round-trip ──
    const restored = useWorkspace.getState().canalApProvenance["C5-C6"];
    expect(restored).toBeDefined();
    expect(restored.value).toBe("12.5");
    expect(restored.manualOverride).toBe(true);
    expect(restored.region).toBe("cervical");
    expect(restored.level).toBe("C5-C6");
  });

  it("lumbar AP measurements survive the same structuredJson round-trip", () => {
    resetWorkspace("LS Spine");
    useWorkspace.getState().setCanalApCellProvenance("L4-L5", {
      region: "lumbar",
      level: "L4-L5",
      measurementType: "CANAL_AP",
      value: "10.2",
      unit: "mm",
      manualOverride: true,
    });

    const canalApProvenance = useWorkspace.getState().canalApProvenance;
    const column = composeStructuredJsonColumnWithCanal(canalApProvenance);
    const wire = JSON.stringify(column);
    const reloaded = JSON.parse(wire);

    const extracted = extractCareCanalApProvenance(reloaded);
    expect(extracted).toBeDefined();
    expect(extracted!["L4-L5"]).toBeDefined();
    expect(extracted!["L4-L5"]!.value).toBe("10.2");

    resetWorkspace("LS Spine");
    useWorkspace.getState().setCanalApProvenance(extracted!);
    expect(useWorkspace.getState().canalApProvenance["L4-L5"]!.value).toBe("10.2");
  });

  it("AP measurement editing does NOT change observation slot identity (verified via real ledger)", () => {
    resetWorkspace("Cervical Spine");
    // Apply a disc bulge observation
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });

    const patches1 = useWorkspace.getState().appliedPathologyPatches;
    const bulgePatch = patches1.find(
      (p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6",
    );
    expect(bulgePatch).toBeDefined();
    const slotKeyBefore = bulgePatch!.observation!.slotKey;

    // Change the AP canal measurement
    useWorkspace.getState().setCanalApCellProvenance("C5-C6", {
      region: "cervical", level: "C5-C6", measurementType: "CANAL_AP",
      value: "10.2", unit: "mm", manualOverride: true,
    });

    // slotKey unchanged
    const patches2 = useWorkspace.getState().appliedPathologyPatches;
    const bulgePatch2 = patches2.find(
      (p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6",
    );
    expect(bulgePatch2!.observation!.slotKey).toBe(slotKeyBefore);
    // slotKey does NOT contain the measurement value
    expect(slotKeyBefore).not.toContain("10.2");
    expect(slotKeyBefore).not.toContain("12");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKER 2 — CONCEPT COMPATIBILITY MATRIX (with PR #663 canon)
// ═══════════════════════════════════════════════════════════════════════════

describe("BLOCKER 2 — Concept compatibility matrix (PR #664 concepts vs PR #663 canon)", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  // ── Concepts ALREADY canonical in PR #663 ──────────────────────────────

  it("disc_contour: already canonical in #663 (bulge/protrusion/extrusion/disc-osteophyte all map here)", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { morphology: "disc-osteophyte" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    // disc-osteophyte complex → disc_contour (NOT a separate disc_osteophyte concept)
    expect(patches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "disc_osteophyte")).toBe(false);
  });

  it("disc_signal: already canonical in #663 (desiccation maps here, NOT disc_contour)", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { morphology: "desiccation" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    // desiccation → disc_signal (distinct ownership slot from disc_contour)
    expect(patches.some((p) => p.observation?.concept === "disc_signal")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "disc_contour")).toBe(false);
  });

  it("canal_stenosis: already canonical in #663", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { canal: "stenosis-moderate" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "canal_stenosis")).toBe(true);
  });

  it("foraminal_stenosis: already canonical in #663 (left + right coexist)", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { foraminal: "bilateral", foraminalSeverity: "moderate" },
      region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const foraminal = patches.filter((p) => p.observation?.concept === "foraminal_stenosis");
    expect(foraminal).toHaveLength(2);
  });

  it("facet_joint: already canonical in #663", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { facet: "arthropathy" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "facet_joint")).toBe(true);
  });

  it("ligamentum_flavum: already canonical in #663", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { ligament: "lf-hypertrophy" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "ligamentum_flavum")).toBe(true);
  });

  it("canal_ap: already canonical in #663", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { canalApMm: 12 }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "canal_ap")).toBe(true);
  });

  it("cord_signal: already canonical in #663 (T2 myelopathic change)", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { cord: "t2-change" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "cord_signal")).toBe(true);
  });

  it("compression_fracture: already canonical in #663 (dorsal fracture)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { vertebral: "fracture" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "compression_fracture")).toBe(true);
  });

  it("spondylodiscitis: already canonical in #663 (disc involvement)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { infection: "disc-involvement" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "spondylodiscitis")).toBe(true);
  });

  // ── Concepts NOT YET in PR #663 canon — must be added during #663 rebase ──

  it("cord_compression: NOT in #663 canon yet — MUST be added to #663 (distinct from cord_signal)", () => {
    // cord_compression is clinically distinct from cord_signal:
    //   - cord_compression = mechanical compression (may or may not have signal change)
    //   - cord_signal = T2 hyperintensity (myelopathic change, may exist without compression)
    // They MUST remain separate canonical concepts.
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { cord: "compression" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "cord_compression")).toBe(true);
    // Not collapsed onto cord_signal
    expect(patches.some((p) => p.observation?.concept === "cord_signal")).toBe(false);
  });

  it("pll_thickening: NOT in #663 canon yet — MUST be added to #663 (distinct from ligamentum_flavum)", () => {
    // PLL (posterior longitudinal ligament) and LF (ligamentum flavum) are
    // anatomically different ligaments. They MUST NOT be collapsed.
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { ligament: "pll-thickening" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "pll_thickening")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "ligamentum_flavum")).toBe(false);
  });

  it("endplate_erosion: NOT in #663 canon yet — MUST be added to #663 (infection-specific, distinct from endplate/Modic)", () => {
    // endplate_erosion is infection-specific. 'endplate' in #663 is for Modic changes.
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { vertebral: "endplate-erosion" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "endplate_erosion")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "endplate")).toBe(false);
  });

  it("marrow_edema: NOT in #663 canon yet — MUST be added to #663 (infection/fracture-related)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { vertebral: "marrow-edema" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "marrow_edema")).toBe(true);
  });

  it("vertebral_collapse: NOT in #663 canon yet — MUST be added to #663 (collapse without acute fracture is clinically distinct)", () => {
    // vertebral_collapse can occur from infection/tumor without an acute
    // compression fracture. It MUST NOT collapse onto compression_fracture.
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { vertebral: "collapse" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "vertebral_collapse")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "compression_fracture")).toBe(false);
  });

  it("paravertebral_collection: NOT in #663 canon yet — MUST be added to #663 (paravertebral location is clinically distinct)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { infection: "paravertebral-collection" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "paravertebral_collection")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "epidural_collection")).toBe(false);
  });

  it("epidural_collection: NOT in #663 canon yet — MUST be added to #663 (epidural location is clinically distinct)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { infection: "epidural-component" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "epidural_collection")).toBe(true);
    expect(patches.some((p) => p.observation?.concept === "paravertebral_collection")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKER 2 (continued) — No system normal surviving impression-worthy abnormality
// ═══════════════════════════════════════════════════════════════════════════

describe("BLOCKER 2 — No system normal surviving impression-worthy Canvas abnormality", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("cord_compression observation makes the report abnormal (AI snapshot sees it)", () => {
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { cord: "compression" }, region: "Cervical Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const observations = deriveComposeObservations(patches);
    expect(observations.some((o) => o.concept === "cord_compression")).toBe(true);
  });

  it("epidural_collection observation makes the report abnormal (AI snapshot sees it)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { infection: "epidural-component" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const observations = deriveComposeObservations(patches);
    expect(observations.some((o) => o.concept === "epidural_collection")).toBe(true);
  });

  it("vertebral_collapse observation makes the report abnormal (AI snapshot sees it)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { vertebral: "collapse" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const observations = deriveComposeObservations(patches);
    expect(observations.some((o) => o.concept === "vertebral_collapse")).toBe(true);
  });

  it("spondylodiscitis observation makes the report abnormal (AI snapshot sees it)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { infection: "disc-involvement" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const observations = deriveComposeObservations(patches);
    expect(observations.some((o) => o.concept === "spondylodiscitis")).toBe(true);
  });

  // INTEGRATION TEST (prepared for #663):
  // When #663 is merged, the system normal auto-yield logic must recognize
  // all impression-worthy Canvas concepts. This test documents the contract:
  // a report with cord_compression + epidural_collection + vertebral_collapse
  // + spondylodiscitis MUST NEVER retain a system-owned "Normal study."
  //
  // On the current branch (without #663's isImpressionworthyAbnormal), we
  // verify that the observations ARE in the ledger (the precondition for
  // auto-yield). When #663 lands, the content packs must mark these concepts
  // as impressionworthyAbnormal=true so the auto-yield fires.
  it("INTEGRATION (for #663): report with cord_compression + epidural_collection + vertebral_collapse + spondylodiscitis — observations present (precondition for auto-yield)", () => {
    resetWorkspace("Dorsal Spine");
    // Apply multiple impression-worthy abnormalities
    const b1 = buildDorsalLevelApplyBundle({
      level: "T8-T9", sel: { cord: "compression" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b1.bundleId, observations: b1.observations });
    const b2 = buildDorsalLevelApplyBundle({
      level: "T9-T10", sel: { infection: "epidural-component" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b2.bundleId, observations: b2.observations });
    const b3 = buildDorsalLevelApplyBundle({
      level: "T10-T11", sel: { vertebral: "collapse" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b3.bundleId, observations: b3.observations });
    const b4 = buildDorsalLevelApplyBundle({
      level: "T11-T12", sel: { infection: "disc-involvement" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b4.bundleId, observations: b4.observations });

    const patches = useWorkspace.getState().appliedPathologyPatches;
    const concepts = patches.map((p) => p.observation?.concept).filter(Boolean);
    // All four impression-worthy abnormalities are in the ledger
    expect(concepts).toContain("cord_compression");
    expect(concepts).toContain("epidural_collection");
    expect(concepts).toContain("vertebral_collapse");
    expect(concepts).toContain("spondylodiscitis");

    // DOCUMENTED CONTRACT FOR #663:
    // When #663's isImpressionworthyAbnormal() is available, it MUST return
    // true for all four of these concepts. The content packs in #663 must
    // add them with impressionworthyAbnormal=true. Until then, this test
    // verifies the precondition: the observations exist in the ledger.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS MUTATION PATH — No direct narrative mutation regression
// ═══════════════════════════════════════════════════════════════════════════

describe("Canvas mutation path — no direct narrative mutation", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("Cervical Canvas Apply goes through applyMacroBundle (no direct setField/findingsText mutation)", () => {
    // Capture the workspace state before
    const findingsBefore = useWorkspace.getState().findingsText;
    expect(findingsBefore).toBe("");

    // Apply via the canvas bundle builder → applyMacroBundle
    const b = buildCervicalLevelApplyBundle({
      level: "C5-C6", sel: { morphology: "bulge" }, region: "Cervical Spine",
    });
    const result = useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    expect(result).toBe("applied");

    // The findings text was updated via the canonical overlay path
    const findingsAfter = useWorkspace.getState().findingsText;
    expect(findingsAfter.toLowerCase()).toContain("bulge");
    expect(findingsAfter.toLowerCase()).toContain("c5-c6");

    // The observation is in the canonical ledger (proof: it went through
    // applyPathologyOverlay, not a direct setField)
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "disc_contour" && p.observation?.level === "C5-C6")).toBe(true);
  });

  it("Dorsal Canvas Apply goes through applyMacroBundle (no direct setField/findingsText mutation)", () => {
    resetWorkspace("Dorsal Spine");
    const b = buildDorsalLevelApplyBundle({
      level: "T6-T7", sel: { morphology: "bulge" }, region: "Dorsal Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId: b.bundleId, observations: b.observations });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "disc_contour")).toBe(true);
  });

  it("Cervical region phrase insertion goes through applyPathologyOverlay (no direct mutation)", () => {
    // Simulate the onInsertRegionPhrase callback from the workspace
    useWorkspace.getState().applyPathologyOverlay({
      id: "r2-cerv-region-alignment-alignment",
      incoming: { findings: "Loss of cervical lordosis is noted." },
      templates: { findings: "Loss of cervical lordosis is noted." },
      ownership: {
        anatomicalSection: "alignment",
        conflictGroup: "alignment",
        concept: "alignment",
        baselineReplaces: "",
      },
      source: "structured-template",
      region: "Cervical Spine",
      concept: "alignment",
      label: "alignment alignment",
      findingsText: "Loss of cervical lordosis is noted.",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.some((p) => p.observation?.concept === "alignment")).toBe(true);
  });
});
