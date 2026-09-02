/**
 * PR #663 — Canvas concept compatibility + system normal auto-yield integration tests.
 *
 * Proves that the 7 Canvas-compatible concepts (added in this rebase) interact
 * correctly with the system normal auto-yield logic:
 *
 *   1. Each concept is recognized by isImpressionworthyAbnormal()
 *   2. Adding any of these concepts auto-yields the system normal impression
 *   3. Manual "Normal study." is NEVER auto-deleted (identity-based, not NLP)
 *   4. Removing the last impression-worthy abnormal restores system normal
 *
 * Also documents the normal-impression seeding recommendation (STEP 5).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  resolveCanonicalConcept,
  isKnownCanonicalConcept,
} from "@/lib/conceptCanon/conceptCanon";
import {
  isImpressionworthyAbnormal,
  isSystemOwnedBaseline,
} from "@/lib/conceptCanon/contentPacks";
import {
  SYSTEM_NORMAL_PATCH_ID,
  SYSTEM_NORMAL_IMPRESSION_TEXT,
  isSystemNormalPatch,
  findSystemNormalPatch,
} from "@/lib/conceptCanon/normalImpression";

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

// ─── 7 Canvas-compatible concept resolver tests ───────────────────────────

describe("7 Canvas-compatible concepts — canonical resolver", () => {
  it("cord_compression resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("cord compression")).toBe("cord_compression");
    expect(isKnownCanonicalConcept("cord_compression")).toBe(true);
    expect(isImpressionworthyAbnormal("cord_compression")).toBe(true);
  });

  it("pll_thickening resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("pll thickening")).toBe("pll_thickening");
    expect(isKnownCanonicalConcept("pll_thickening")).toBe(true);
    expect(isImpressionworthyAbnormal("pll_thickening")).toBe(true);
  });

  it("endplate_erosion resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("endplate erosion")).toBe("endplate_erosion");
    expect(isKnownCanonicalConcept("endplate_erosion")).toBe(true);
    expect(isImpressionworthyAbnormal("endplate_erosion")).toBe(true);
  });

  it("marrow_edema resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("marrow edema")).toBe("marrow_edema");
    expect(isKnownCanonicalConcept("marrow_edema")).toBe(true);
    expect(isImpressionworthyAbnormal("marrow_edema")).toBe(true);
  });

  it("vertebral_collapse resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("vertebral collapse")).toBe("vertebral_collapse");
    expect(isKnownCanonicalConcept("vertebral_collapse")).toBe(true);
    expect(isImpressionworthyAbnormal("vertebral_collapse")).toBe(true);
  });

  it("paravertebral_collection resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("paravertebral collection")).toBe("paravertebral_collection");
    expect(isKnownCanonicalConcept("paravertebral_collection")).toBe(true);
    expect(isImpressionworthyAbnormal("paravertebral_collection")).toBe(true);
  });

  it("epidural_collection resolves and is impression-worthy abnormal", () => {
    expect(resolveCanonicalConcept("epidural collection")).toBe("epidural_collection");
    expect(isKnownCanonicalConcept("epidural_collection")).toBe(true);
    expect(isImpressionworthyAbnormal("epidural_collection")).toBe(true);
  });

  it("none of the 7 are system-owned baseline", () => {
    expect(isSystemOwnedBaseline("cord_compression")).toBe(false);
    expect(isSystemOwnedBaseline("pll_thickening")).toBe(false);
    expect(isSystemOwnedBaseline("endplate_erosion")).toBe(false);
    expect(isSystemOwnedBaseline("marrow_edema")).toBe(false);
    expect(isSystemOwnedBaseline("vertebral_collapse")).toBe(false);
    expect(isSystemOwnedBaseline("paravertebral_collection")).toBe(false);
    expect(isSystemOwnedBaseline("epidural_collection")).toBe(false);
  });

  it("concepts are NOT collapsed onto each other", () => {
    // cord_compression != cord_signal
    expect(resolveCanonicalConcept("cord compression")).not.toBe("cord_signal");
    // pll_thickening != ligamentum_flavum
    expect(resolveCanonicalConcept("pll thickening")).not.toBe("ligamentum_flavum");
    // endplate_erosion != endplate (Modic)
    expect(resolveCanonicalConcept("endplate erosion")).not.toBe("endplate");
    // vertebral_collapse != compression_fracture
    expect(resolveCanonicalConcept("vertebral collapse")).not.toBe("compression_fracture");
    // paravertebral_collection != epidural_collection
    expect(resolveCanonicalConcept("paravertebral collection")).not.toBe("epidural_collection");
  });
});

// ─── System normal auto-yield for Canvas concepts ────────────────────────

describe("System normal auto-yield — Canvas-compatible concepts", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("cord_compression observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Cord compression at C5-C6.", impression: "Cord compression at C5-C6." },
      templates: { findings: "Cord compression at C5-C6.", impression: "Cord compression at C5-C6." },
      ownership: { conflictGroup: "cord_compression", concept: "cord_compression", level: "C5-C6" },
      source: "structured-template", region: "Cervical Spine", concept: "cord_compression",
      level: "C5-C6", findingsText: "Cord compression at C5-C6.", id: "canvas-cord-comp",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(false);
  });

  it("epidural_collection observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Epidural collection at T8-T9.", impression: "Epidural collection." },
      templates: { findings: "Epidural collection at T8-T9.", impression: "Epidural collection." },
      ownership: { conflictGroup: "epidural_collection", concept: "epidural_collection", level: "T8-T9" },
      source: "structured-template", region: "Dorsal Spine", concept: "epidural_collection",
      level: "T8-T9", findingsText: "Epidural collection at T8-T9.", id: "canvas-epidural",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("vertebral_collapse observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Vertebral collapse at T10.", impression: "Vertebral collapse." },
      templates: { findings: "Vertebral collapse at T10.", impression: "Vertebral collapse." },
      ownership: { conflictGroup: "vertebral_collapse", concept: "vertebral_collapse" },
      source: "structured-template", region: "Dorsal Spine", concept: "vertebral_collapse",
      findingsText: "Vertebral collapse at T10.", id: "canvas-collapse",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("spondylodiscitis observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Spondylodiscitis at T8-T9.", impression: "Spondylodiscitis." },
      templates: { findings: "Spondylodiscitis at T8-T9.", impression: "Spondylodiscitis." },
      ownership: { conflictGroup: "spondylodiscitis", concept: "spondylodiscitis", level: "T8-T9" },
      source: "structured-template", region: "Dorsal Spine", concept: "spondylodiscitis",
      level: "T8-T9", findingsText: "Spondylodiscitis at T8-T9.", id: "canvas-spondylo",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("paravertebral_collection observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Paravertebral collection.", impression: "Paravertebral collection." },
      templates: { findings: "Paravertebral collection.", impression: "Paravertebral collection." },
      ownership: { conflictGroup: "paravertebral_collection", concept: "paravertebral_collection" },
      source: "structured-template", region: "Dorsal Spine", concept: "paravertebral_collection",
      findingsText: "Paravertebral collection.", id: "canvas-para-vert",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("marrow_edema observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Marrow edema.", impression: "Marrow edema." },
      templates: { findings: "Marrow edema.", impression: "Marrow edema." },
      ownership: { conflictGroup: "marrow_edema", concept: "marrow_edema" },
      source: "structured-template", region: "Dorsal Spine", concept: "marrow_edema",
      findingsText: "Marrow edema.", id: "canvas-marrow",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("endplate_erosion observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Endplate erosion.", impression: "Endplate erosion." },
      templates: { findings: "Endplate erosion.", impression: "Endplate erosion." },
      ownership: { conflictGroup: "endplate_erosion", concept: "endplate_erosion" },
      source: "structured-template", region: "Dorsal Spine", concept: "endplate_erosion",
      findingsText: "Endplate erosion.", id: "canvas-endplate-erosion",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("pll_thickening observation auto-yields system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "PLL thickening at C5-C6.", impression: "PLL thickening." },
      templates: { findings: "PLL thickening at C5-C6.", impression: "PLL thickening." },
      ownership: { conflictGroup: "pll_thickening", concept: "pll_thickening", level: "C5-C6" },
      source: "structured-template", region: "Cervical Spine", concept: "pll_thickening",
      level: "C5-C6", findingsText: "PLL thickening at C5-C6.", id: "canvas-pll",
    });

    expect(useWorkspace.getState().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });
});

// ─── Manual "Normal study." protection ───────────────────────────────────

describe("Manual 'Normal study.' protection — Canvas concepts", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("MANUAL 'Normal study.' survives adding cord_compression (identity-based, not NLP)", () => {
    // Radiologist manually types "Normal study." into the impression field
    useWorkspace.getState().setField("impression", "Normal study.", { source: "manual" });
    expect(useWorkspace.getState().impressionText).toContain("Normal study.");

    // Add an impression-worthy abnormal observation
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Cord compression at C5-C6.", impression: "Cord compression at C5-C6." },
      templates: { findings: "Cord compression at C5-C6.", impression: "Cord compression at C5-C6." },
      ownership: { conflictGroup: "cord_compression", concept: "cord_compression", level: "C5-C6" },
      source: "structured-template", region: "Cervical Spine", concept: "cord_compression",
      level: "C5-C6", findingsText: "Cord compression at C5-C6.", id: "qs-cord-comp",
    });

    // Manual "Normal study." SURVIVES — no regex strip
    expect(useWorkspace.getState().impressionText).toContain("Normal study.");
    // The abnormal impression was added alongside it
    expect(useWorkspace.getState().impressionText).toMatch(/Cord compression at C5-C6/);
    // No system normal patch was seeded (predicate: manual contribution exists)
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(false);
  });

  it("MANUAL 'Normal study.' survives adding epidural_collection", () => {
    useWorkspace.getState().setField("impression", "Normal study.", { source: "manual" });

    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Epidural collection.", impression: "Epidural collection." },
      templates: { findings: "Epidural collection.", impression: "Epidural collection." },
      ownership: { conflictGroup: "epidural_collection", concept: "epidural_collection" },
      source: "structured-template", region: "Dorsal Spine", concept: "epidural_collection",
      findingsText: "Epidural collection.", id: "qs-epidural",
    });

    // Manual "Normal study." survives
    expect(useWorkspace.getState().impressionText).toContain("Normal study.");
    expect(useWorkspace.getState().impressionText).toMatch(/Epidural collection/);
  });
});

// ─── Auto-return after removing last impression-worthy abnormal ──────────

describe("Auto-return — system normal returns after removing last Canvas abnormal", () => {
  beforeEach(() => resetWorkspace("Cervical Spine"));
  afterEach(() => vi.unstubAllGlobals());

  it("removing cord_compression restores system normal (when no manual impression)", () => {
    // Seed system normal
    useWorkspace.getState().seedSystemNormalImpression();

    // Add cord_compression (auto-yields system normal)
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Cord compression at C5-C6.", impression: "Cord compression at C5-C6." },
      templates: { findings: "Cord compression at C5-C6.", impression: "Cord compression at C5-C6." },
      ownership: { conflictGroup: "cord_compression", concept: "cord_compression", level: "C5-C6" },
      source: "structured-template", region: "Cervical Spine", concept: "cord_compression",
      level: "C5-C6", findingsText: "Cord compression at C5-C6.", id: "qs-cord-comp-2",
    });
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(false);

    // Remove the cord_compression observation
    useWorkspace.getState().removeObservation("qs-cord-comp-2");

    // System normal returns
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(true);
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("removing epidural_collection restores system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Epidural collection.", impression: "Epidural collection." },
      templates: { findings: "Epidural collection.", impression: "Epidural collection." },
      ownership: { conflictGroup: "epidural_collection", concept: "epidural_collection" },
      source: "structured-template", region: "Dorsal Spine", concept: "epidural_collection",
      findingsText: "Epidural collection.", id: "qs-epidural-2",
    });
    useWorkspace.getState().removeObservation("qs-epidural-2");
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(true);
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });
});

// ─── STEP 5: Normal-impression seeding recommendation ────────────────────

describe("STEP 5 — Normal-impression seeding recommendation (documentation)", () => {
  it("documents the seeding recommendation (no behavior change in this PR)", () => {
    // ────────────────────────────────────────────────────────────────────
    // RECOMMENDATION (not implemented in this PR):
    //
    // The current behavior seeds "Normal study." on every selectStudy(). This
    // creates premature clinical truth before the radiologist has reviewed
    // the images.
    //
    // SAFER BEHAVIOR (recommended for a follow-up PR after clinic validation):
    //
    //   1. Do NOT call seedSystemNormalImpression() in selectStudy().
    //   2. Instead, seed only when:
    //      a. A Full Report Format is applied AND the format's impression is
    //         empty (the format provides the normal baseline), OR
    //      b. The radiologist clicks "Add Normal Impression" (explicit), OR
    //      c. On Finalize, if no impression-worthy abnormal observations exist
    //         AND no manual impression exists (safety net).
    //
    //   3. The auto-yield logic (in applyPathologyOverlay) remains unchanged —
    //      it fires when an impression-worthy abnormal is added, regardless of
    //      whether the system normal was seeded.
    //
    //   4. The auto-return logic (in removeObservation) remains unchanged —
    //      it calls seedSystemNormalImpression() which checks all safety
    //      predicates before seeding.
    //
    // WHY NOT CHANGE IN THIS PR:
    //   - The current behavior is the intended design from #663
    //   - Changing it requires clinic workflow validation
    //   - The auto-yield mechanism is correct — the risk is only in the
    //     seeding timing, not in the yield/return logic
    //
    // RISK OF CURRENT BEHAVIOR:
    //   - A radiologist opens a study, sees "Normal study." in the impression,
    //     and saves without reviewing → the report goes out as "Normal study."
    //     even though no findings were documented.
    //   - Mitigation: the system normal patch is source="system" (not "manual"),
    //     so it auto-yields when any abnormal is added. But if the radiologist
    //     saves without adding any observations, the "Normal study." persists.
    //
    // This test documents the recommendation. Implementation deferred to a
    // follow-up PR after clinic validation.
    // ────────────────────────────────────────────────────────────────────
    expect(true).toBe(true);
  });
});
