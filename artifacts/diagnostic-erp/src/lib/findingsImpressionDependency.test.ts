/**
 * D-1 and D-2 — the Findings → Impression dependency must answer one question the
 * same way in every situation: *does the summary still follow from the findings?*
 *
 * Before this file, two different predicates answered it. In a live session the
 * flag was armed by any write to Findings (store.ts setField/mergeField), while
 * every re-derivation — overlay apply, ledger hydration, format merge — recomputed
 * it from the observation ledger alone, which knows nothing about text a
 * radiologist typed. So the same report was protected before a reload and
 * unprotected after it (D-1). And a hand-edited Impression armed nothing at all:
 * no Findings write had happened, so a summary rewritten to contradict the
 * findings went through with no signal beyond an advisory badge (D-2).
 *
 * These tests pin the single predicate and its two halves:
 *
 *  - the Findings signature — the clinical content of the Findings, so that a
 *    level, a side, a measurement, or an abnormality appearing or disappearing
 *    counts as a change, while punctuation, headings and re-flowing do not;
 *  - the reading itself — an Impression that calls the study normal while the
 *    Findings assert an abnormality is stale *on its own terms*, whatever the
 *    provenance of either field.
 *
 * Nothing here rewrites radiologist text: arming is a flag and a reason, and the
 * only way it clears is a write that owns both sides, an explicit refresh, or the
 * radiologist's own acknowledgement at sign — which then survives the reload.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  evaluateImpressionDependency,
  extractImpressionBasis,
  type ImpressionBasis,
} from "@/lib/observationLedger";

const CORD_FINDINGS =
  "Left paracentral disc herniation at C5-C6 indenting the thecal sac, with resultant compression of the cervical cord at that level and intrinsic T2 hyperintensity consistent with myelomalacia. Canal AP diameter 8 mm. Cervical alignment is maintained.";
const CORD_REFORMATTED =
  "C-SPINE FINDINGS:\nLeft paracentral disc herniation at C5-C6 indenting the thecal sac. Resultant compression of the cervical cord at that level, with intrinsic T2 hyperintensity consistent with myelomalacia. Canal AP diameter: 8 mm. Cervical alignment is maintained.\n";
const NORMAL_IMPRESSION = "Normal MRI of the cervical spine.";
const OWNED_IMPRESSION =
  "C5-C6 left paracentral disc herniation with cervical cord compression and myelomalacia.";
const REVISED_IMPRESSION = "C5-C6 left paracentral disc herniation with cord compression. C2 fracture.";

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
    impressionBasis: null,
    impressionDependencyReasons: [],
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

const signatureOf = (findings: string) =>
  evaluateImpressionDependency({ findings, impression: "", patches: [] }).findingsSignature;

const basisOf = (
  findings: string,
  impression: string,
  recordedBy: ImpressionBasis["recordedBy"] = "impression-write",
): ImpressionBasis => {
  const state = evaluateImpressionDependency({ findings, impression, patches: [] });
  return {
    findingsSignature: state.findingsSignature,
    impressionFingerprint: state.impressionFingerprint,
    recordedBy,
  };
};

/** The save → close → reopen cycle, in the order the draft persistence hook performs it. */
function reopen(payload: unknown, findings: string, impression: string) {
  resetWorkspace();
  useWorkspace.getState().setEditorContent({
    findings,
    impression,
    recommendation: "",
    technique: "",
    clinicalHistory: "",
  });
  useWorkspace.getState().hydrateObservationLedger(payload);
}

function save(): unknown {
  return useWorkspace.getState().serializeObservationLedger();
}

describe("impression dependency — the reading itself", () => {
  beforeEach(() => resetWorkspace());

  it("an Impression that calls the study normal while the Findings assert an abnormality is stale on its own terms", () => {
    const state = evaluateImpressionDependency({
      findings: CORD_FINDINGS,
      impression: NORMAL_IMPRESSION,
      patches: [],
    });
    expect(state.needsRefresh).toBe(true);
    expect(state.reasons).toContain("impression-contradicts-findings");
  });

  it("findings that only DENY abnormalities support a normal impression", () => {
    const state = evaluateImpressionDependency({
      findings: "No fracture. No disc herniation. The cervical cord is normal in calibre and signal. No canal stenosis.",
      impression: NORMAL_IMPRESSION,
      patches: [],
    });
    expect(state.reasons).toEqual([]);
    expect(state.needsRefresh).toBe(false);
  });

  it("uncertainty is not denial: an abnormality that cannot be excluded contradicts a normal summary", () => {
    const state = evaluateImpressionDependency({
      findings: "A small left paracentral disc herniation at C5-C6 cannot be excluded.",
      impression: NORMAL_IMPRESSION,
      patches: [],
    });
    expect(state.reasons).toContain("impression-contradicts-findings");
  });

  it("a matching summary over the same findings is fresh", () => {
    const state = evaluateImpressionDependency({
      findings: CORD_FINDINGS,
      impression: OWNED_IMPRESSION,
      patches: [],
    });
    expect(state.reasons).toEqual([]);
  });

  it("a basis recorded against different findings reads as stale", () => {
    const state = evaluateImpressionDependency({
      findings: `${CORD_FINDINGS} There is also a C2 fracture.`,
      impression: OWNED_IMPRESSION,
      patches: [],
      basis: basisOf(CORD_FINDINGS, OWNED_IMPRESSION),
    });
    expect(state.reasons).toContain("findings-changed");
    expect(state.needsRefresh).toBe(true);
  });

  it("a basis recorded against these findings reads as fresh", () => {
    const state = evaluateImpressionDependency({
      findings: CORD_FINDINGS,
      impression: OWNED_IMPRESSION,
      patches: [],
      basis: basisOf(CORD_FINDINGS, OWNED_IMPRESSION),
    });
    expect(state.reasons).toEqual([]);
  });

  it("an acknowledgement covers the pairing it was given, and nothing after it", () => {
    const reviewed = evaluateImpressionDependency({
      findings: CORD_FINDINGS,
      impression: NORMAL_IMPRESSION,
      patches: [],
      basis: basisOf(CORD_FINDINGS, NORMAL_IMPRESSION, "review"),
    });
    expect(reviewed.reasons).toEqual([]);

    const findingsMoved = evaluateImpressionDependency({
      findings: `${CORD_FINDINGS} There is also a C2 fracture.`,
      impression: NORMAL_IMPRESSION,
      patches: [],
      basis: basisOf(CORD_FINDINGS, NORMAL_IMPRESSION, "review"),
    });
    expect(findingsMoved.reasons).toContain("findings-changed");

    const impressionRewritten = evaluateImpressionDependency({
      findings: CORD_FINDINGS,
      impression: "Normal MRI of the cervical spine. Otherwise unremarkable.",
      patches: [],
      basis: basisOf(CORD_FINDINGS, NORMAL_IMPRESSION, "review"),
    });
    expect(impressionRewritten.reasons).toContain("impression-contradicts-findings");

    const reviewWasForDifferentWords = evaluateImpressionDependency({
      findings: CORD_FINDINGS,
      impression: NORMAL_IMPRESSION,
      patches: [],
      basis: basisOf(CORD_FINDINGS, OWNED_IMPRESSION, "review"),
    });
    expect(reviewWasForDifferentWords.reasons).toContain("impression-contradicts-findings");
  });

  it("keeps arming on a ledger patch whose impression contribution is gone", () => {
    // The patch the Quick Select tile would have left behind: its own sentence
    // in the Impression is what the dependency tracks for that contribution.
    const patch = {
      id: "dep-1",
      observation: { slotKey: "Cervical Spine|disc_herniation|C5|left", concept: "disc_herniation" },
      templates: {},
      lastRendered: {
        findings: "Left paracentral disc herniation at C5-C6.",
        impression: "C5-C6 left paracentral disc herniation.",
      },
      replacedBaseline: { findings: [], impression: [] },
      source: "quick-select",
      protected: false,
    } as unknown as Parameters<typeof evaluateImpressionDependency>[0]["patches"][number];

    expect(
      evaluateImpressionDependency({
        findings: "Left paracentral disc herniation at C5-C6.",
        impression: NORMAL_IMPRESSION,
        patches: [patch],
      }).reasons,
    ).toContain("contribution-lost");
  });
});

describe("the findings signature ignores presentation and catches clinical change", () => {
  it("does not move for punctuation, case, headings or re-flowed wording", () => {
    expect(signatureOf(CORD_REFORMATTED)).toBe(signatureOf(CORD_FINDINGS));
  });

  it("moves when the level changes — the wrong level is the wrong operation", () => {
    expect(signatureOf(CORD_FINDINGS.replace("C5-C6", "C6-C7"))).not.toBe(signatureOf(CORD_FINDINGS));
  });

  it("moves when the side changes", () => {
    expect(signatureOf(CORD_FINDINGS.replace("Left paracentral", "Right paracentral"))).not.toBe(
      signatureOf(CORD_FINDINGS),
    );
  });

  it("moves when the operative measurement changes", () => {
    expect(signatureOf(CORD_FINDINGS.replace("8 mm", "18 mm"))).not.toBe(signatureOf(CORD_FINDINGS));
  });

  it("moves when an abnormality appears", () => {
    expect(signatureOf(`${CORD_FINDINGS} There is also a C2 fracture.`)).not.toBe(signatureOf(CORD_FINDINGS));
  });

  it("does not move when a denial is re-worded, and does when it is withdrawn", () => {
    const denied = "No acute haemorrhage.";
    expect(signatureOf("There is no acute haemorrhage.")).toBe(signatureOf(denied));
    expect(signatureOf("An acute haemorrhage is seen.")).not.toBe(signatureOf(denied));
  });
});

describe("impression dependency — session, save, reload, study switching", () => {
  beforeEach(() => resetWorkspace());

  it("a hand-typed Findings edit is still stale after save → reopen (D-1)", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);

    const revised = `${CORD_FINDINGS} There is also a C2 fracture.`;
    useWorkspace.getState().setField("findings", revised, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    const payload = save();
    reopen(payload, revised, OWNED_IMPRESSION);
    expect(useWorkspace.getState().impressionNeedsRefresh, "the flag must survive the reload").toBe(true);
    expect(useWorkspace.getState().impressionDependencyReasons).toContain("findings-changed");
  });

  it("an unchanged report is fresh after save → reopen", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
    const payload = save();

    reopen(payload, CORD_FINDINGS, OWNED_IMPRESSION);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(useWorkspace.getState().impressionDependencyReasons).toEqual([]);
  });

  it("a manually typed Impression cannot bypass the contradiction check (D-2)", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh, "a compressed cord summarised as normal").toBe(true);
    expect(useWorkspace.getState().impressionDependencyReasons).toContain("impression-contradicts-findings");
  });

  it("an acknowledgement does not cover a Findings change that comes after it", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    useWorkspace.getState().markImpressionReviewed();
    const payload = save();

    reopen(payload, `${CORD_FINDINGS} There is also a C2 fracture.`, NORMAL_IMPRESSION);
    expect(useWorkspace.getState().impressionNeedsRefresh, "the review was given to a report without a fracture").toBe(true);
    expect(useWorkspace.getState().impressionDependencyReasons).toContain("findings-changed");
  });

  it("a manual Impression edit that still follows the findings does not arm", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
    useWorkspace.getState().setField("impression", `${OWNED_IMPRESSION} No other level is significant.`, {
      source: "manual",
    });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("re-formatting the Findings alone does not arm", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
    useWorkspace.getState().setField("findings", CORD_REFORMATTED, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh, "presentation is not a clinical change").toBe(false);
  });

  it("a re-write that owns both sides clears the flag and keeps it cleared across the reload", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
    const revised = `${CORD_FINDINGS} There is also a C2 fracture.`;
    useWorkspace.getState().setField("findings", revised, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    useWorkspace.getState().setField("impression", REVISED_IMPRESSION, { source: "quick-select" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);

    const payload = save();
    reopen(payload, revised, REVISED_IMPRESSION);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("acknowledging a stale Impression is durable, not a nag on reopen", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", "Small herniation at C5-C6; no cord compression. Otherwise normal study.", {
      source: "manual",
    });
    expect(useWorkspace.getState().impressionNeedsRefresh, "the normal half contradicts the herniation asserted").toBe(true);

    useWorkspace.getState().markImpressionReviewed();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(extractImpressionBasis(save())?.recordedBy).toBe("review");

    const payload = save();
    reopen(
      payload,
      CORD_FINDINGS,
      "Small herniation at C5-C6; no cord compression. Otherwise normal study.",
    );
    expect(useWorkspace.getState().impressionNeedsRefresh, "this exact pairing was already reviewed").toBe(false);
  });

  it("switching studies takes the dependency state with the report, not to the next patient", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    resetWorkspace("Lumbar Spine");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(useWorkspace.getState().impressionBasis).toBeNull();

    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh, "the contradiction re-arms for the next report").toBe(true);
  });

  it("arming never rewrites the radiologist's Impression", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    useWorkspace.getState().setField("findings", `${CORD_FINDINGS} There is also a C2 fracture.`, { source: "manual" });
    useWorkspace.getState().markImpressionReviewed();
    expect(useWorkspace.getState().impressionText).toBe(NORMAL_IMPRESSION);
  });
});
