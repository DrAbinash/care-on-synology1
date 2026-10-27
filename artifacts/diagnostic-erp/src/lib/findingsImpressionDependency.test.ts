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

/** The same report, read the way the store reads it in a live session and the way
 *  a reopen reads it. The pair has to agree: D-1 was exactly this split, and every
 *  writer that changes clinical text is supposed to answer through the one
 *  predicate. Comparing the two answers asks no policy question — it does not say
 *  which side is armed, only that a report cannot change its mind because it was
 *  closed and opened again. */
function answer() {
  const s = useWorkspace.getState();
  return {
    needsRefresh: s.impressionNeedsRefresh,
    reasons: [...s.impressionDependencyReasons].sort(),
  };
}

function reopenCurrent() {
  const payload = save();
  const { findingsText, impressionText } = useWorkspace.getState();
  reopen(payload, findingsText, impressionText);
  return answer();
}

/** One Quick Select tile: its own sentence in Findings and its own in Impression,
 *  which is what makes it removable and what makes the pairing claim it owns. */
function addFractureTile() {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: "There is also a C2 fracture.", impression: "C2 fracture." },
    templates: { findings: "There is also a C2 fracture.", impression: "C2 fracture." },
    ownership: { conflictGroup: "fracture", concept: "fracture", level: "C2" },
    source: "quick-findings",
    region: "Cervical Spine",
    concept: "fracture",
    level: "C2",
    findingsText: "There is also a C2 fracture.",
    id: "qs-c2-fracture",
  });
}

/** A fresh, paired report the radiologist has approved: typed findings and the
 *  summary that follows from them. */
function approvedCordReport() {
  useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
  useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
  expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
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

/**
 * THE FIVE TRANSITIONS, ONE QUESTION EACH.
 *
 * The brief for this branch asks whether the dependency survives removal, manual
 * editing, save, reload and AI rewriting. Manual editing, save and reload were
 * already pinned above. What was missing is the two ways a report moves that no
 * keystroke produces: something being TAKEN OUT of the Findings, and the model
 * writing into it.
 *
 * Both were found by reading the store's own rule back to it.
 * `deriveImpressionDependency` is documented as the one derivation "every writer
 * goes through — a keystroke, a Quick Select tile, dictation, a template, an
 * accepted AI ghost, a ledger restore". Four writers did not honour it:
 * `removeObservation`, the `missing-comparison` branch of `insertCopilotText`
 * (the only branch of that action that does not end in `mergeField`), and
 * `applyAiComposerAccepted` all changed clinical text without re-deriving at all,
 * and `applyPathologyOverlay` re-derived with a claim wider than its write — it
 * rebased the basis (re-recording it as though the summary now matched the
 * findings) even when the row it applied carries no Impression contribution, so a
 * findings-only tile, dictation sentence or structured row declared an untouched
 * summary reconciled. Each produced the failure this whole branch exists to kill:
 * one answer in the session, a different one for the identical report after a
 * reload — and the overlay one is worse, because it gets the answer wrong in both
 * places at once. `undoLastPatch` and `applyMergedResult` — the actions that put
 * text BACK — did already re-derive correctly, which is what makes the others an
 * inconsistency rather than a second defensible design.
 *
 * The fourth thing measured here is that two candidate defects are not defects:
 * a removal whose Impression sentence is the radiologist's own wording refuses
 * outright (`preserved-manual`) rather than half-applying, and `relateralizePatches`
 * was probed and gave the same answer live and reopened.
 */
describe("removal re-evaluates the dependency, in the session and not just after a reload", () => {
  beforeEach(() => resetWorkspace());

  it("removing a Quick Select observation gives the live session the same answer a reopen gives", () => {
    approvedCordReport();
    addFractureTile();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);

    expect(useWorkspace.getState().removeObservation("qs-c2-fracture")).toBe("removed");
    const live = answer();
    const reopened = reopenCurrent();
    expect(
      live,
      `the live session said ${JSON.stringify(live)} while the same report after a reload says ${JSON.stringify(reopened)}`,
    ).toEqual(reopened);
    // The pair came off together — the tile's Findings sentence and its Impression
    // sentence — so what is left is self-consistent and nothing is owed a re-read.
    // That answer used to be arrived at by accident: the session never re-evaluated
    // at all, which is why the same report said something different after a reload.
    expect(live.needsRefresh).toBe(false);
  });

  it("a deselection on a report that never carried a system normal invents no normal", () => {
    // CAT-P5's restore is a RESTORE, not a generator. Widening the trigger to boxes
    // whose concept the registry does not flag (this tile's `fracture` is one) made
    // `seedSystemNormalImpression` reach its fall-through on a hand-written cervical
    // cord report that had never had a system normal row, and "Normal study." landed
    // under a C2 fracture. Measured here as the guard's own failure mode.
    approvedCordReport();
    addFractureTile();
    expect(useWorkspace.getState().removeObservation("qs-c2-fracture")).toBe("removed");
    expect(useWorkspace.getState().impressionText).toBe(OWNED_IMPRESSION);
    expect(useWorkspace.getState().impressionText).not.toContain("Normal study.");
    expect(
      useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === "system-normal-study"),
    ).toBe(false);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("a removal that a radiologist's own summary has outranked is refused, and the contradiction stays armed", () => {
    approvedCordReport();
    addFractureTile();
    // The radiologist replaces the tile's sentence with a summary of their own —
    // one that calls a compressed cord normal.
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    // The store now refuses to remove the observation at all: the sentence it
    // generated is no longer in the summary, so nothing here is a pair coming off
    // together. That refusal is what makes the rebase above safe — a removal only
    // re-pairs the basis when both halves of the pair genuinely leave together.
    expect(useWorkspace.getState().removeObservation("qs-c2-fracture")).toBe("preserved-manual");
    const live = answer();
    expect(
      live.needsRefresh,
      "the cord compression is still in the Findings and the summary still says normal",
    ).toBe(true);
    expect(live.reasons).toContain("impression-contradicts-findings");
    expect(reopenCurrent()).toEqual(live);
  });

  it("removing a finding the radiologist re-worded in their own Impression is refused, not half-applied", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    addFractureTile();
    // The radiologist does not repeat the tile's sentence — they write their own.
    useWorkspace.getState().setField("impression", `${OWNED_IMPRESSION} A fracture is noted at C2.`, {
      source: "manual",
    });

    expect(useWorkspace.getState().removeObservation("qs-c2-fracture")).toBe("preserved-manual");
    // The finding stays, because the summary the radiologist wrote still names it.
    // The two directions a removal could go wrong are both closed here: silently
    // deleting a sentence the radiologist typed, or leaving an Impression that
    // asserts a finding its Findings no longer describe.
    expect(useWorkspace.getState().findingsText).toMatch(/C2 fracture/i);
    expect(useWorkspace.getState().impressionText).toMatch(/fracture is noted at C2/i);
    const live = answer();
    expect(live.needsRefresh).toBe(false);
    expect(reopenCurrent()).toEqual(live);
  });

  it("retiring an observation's Impression contribution stays armed across the reload", () => {
    approvedCordReport();
    addFractureTile();
    useWorkspace.getState().setObservationImpressionParticipation("qs-c2-fracture", false);
    const live = answer();
    expect(live.needsRefresh).toBe(true);
    expect(live.reasons).toContain("participation-changed");
    expect(reopenCurrent().needsRefresh, "an arm that dies on reload is D-1 again").toBe(true);
  });

  it("a removal that changed nothing leaves the radiologist's own review intact", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    addFractureTile();
    useWorkspace.getState().setField("impression", NORMAL_IMPRESSION, { source: "manual" });
    useWorkspace.getState().markImpressionReviewed();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(extractImpressionBasis(save())?.recordedBy).toBe("review");

    // A refused removal re-reads the pairing; it does not re-claim it. Rebasing
    // here would turn the review into an ordinary system write, and the summary
    // that was reviewed would start nagging again for no action the radiologist
    // took — and it would disagree with the same report after a reload, which is
    // the whole shape of the bug this branch exists to remove.
    expect(useWorkspace.getState().removeObservation("qs-c2-fracture")).toBe("preserved-manual");
    const live = answer();
    expect(live.needsRefresh, "nothing about the report changed").toBe(false);
    expect(extractImpressionBasis(save())?.recordedBy).toBe("review");
    expect(reopenCurrent()).toEqual(live);
  });
});

describe("AI rewriting re-evaluates the dependency instead of inheriting the old answer", () => {
  beforeEach(() => resetWorkspace());

  it("an accepted AI Findings sentence over an approved Impression arms it", () => {
    approvedCordReport();
    useWorkspace.getState().mergeField(
      "findings",
      "There is also a C2 fracture.",
      "ai-draft",
    );
    const live = answer();
    expect(live.needsRefresh, "the model changed the findings; the summary was written over the old ones").toBe(true);
    expect(live.reasons).toContain("findings-changed");
    expect(reopenCurrent()).toEqual(live);
  });

  it("an accepted AI Impression sentence cannot clear an armed dependency", () => {
    approvedCordReport();
    useWorkspace.getState().mergeField("findings", "There is also a C2 fracture.", "ai-draft");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    useWorkspace.getState().mergeField("impression", REVISED_IMPRESSION, "ai-draft");
    const live = answer();
    expect(
      live.needsRefresh,
      "ai-draft owns neither side: a model's summary proves nothing about the findings behind it",
    ).toBe(true);
    expect(reopenCurrent().needsRefresh).toBe(true);
  });

  it("the rail's prior-comparison insert re-evaluates the findings it just changed", () => {
    // `insertCopilotText` routes almost every item through mergeField, which
    // re-derives — except the `missing-comparison` branch, which prepends its own
    // sentence with a bare set(). Same button, two code paths.
    useWorkspace.setState({
      studies: [{ id: "study-1", accessionNumber: "A1" } as never],
      activeStudyId: "study-1",
    });
    approvedCordReport();
    useWorkspace.getState().insertCopilotText({
      id: "missing-comparison",
      kind: "missing",
      studyId: "study-1",
      insertText: "Comparison with the prior study of 12 August: there is a new C2 fracture.",
      insertTarget: "findings",
      provenance: "ai-draft",
    } as never);

    expect(useWorkspace.getState().findingsText).toMatch(/C2 fracture/);
    const live = answer();
    const reopened = reopenCurrent();
    expect(
      live,
      `the rail changed the Findings and the session still says ${JSON.stringify(live)} while a reload says ${JSON.stringify(reopened)}`,
    ).toEqual(reopened);
  });

  it("the Composer's accepted rewrite is re-read, not waved through", () => {
    approvedCordReport();
    useWorkspace.getState().applyAiComposerAccepted({
      findings: `${CORD_FINDINGS} There is also a C2 fracture.`,
      impression: NORMAL_IMPRESSION,
      recommendation: "",
    } as never);
    const live = answer();
    expect(
      live.needsRefresh,
      "a rewrite that summarises a compressed cord as normal is not presentation",
    ).toBe(true);
    expect(live.reasons).toContain("findings-changed");
    expect(live.reasons).toContain("impression-contradicts-findings");
    expect(reopenCurrent()).toEqual(live);
  });
});

/**
 * Dictation was the fifth door, and the probe into it is what found the overlay's
 * over-broad rebase. A dictated plan reaches the report through
 * `applyPathologyOverlay` (step 4), which re-derives — but until this commit it
 * always rebased, so a dictated finding whose row carries no Impression sentence
 * re-recorded the basis over a summary that never mentioned it, and nothing armed
 * either in the session or after a reload. The first test below is that case.
 *
 * What the probe also found is that the plan can be dropped on the floor. An
 * impression-only plan (no observations) returns `"applied"` while its text never
 * reaches the Impression at all: step 3 writes the *cleaned live* impression and step
 * 4 has no observation to apply, so the radiologist dictates a summary, keeps the one
 * they had, and is told it worked. `applyChangePlan.ts:141` has that branch,
 * `composer.ts:65` produces `impressionUpdate` and `contextBuilder.ts:43` prompts the
 * model for exactly that shape, so it is the live path, not a dead one. Both halves of
 * that — the sentence arriving, and the pairing being re-read once it does — are pinned
 * below.
 */
describe("dictation re-evaluates the dependency, as an observation and as a summary", () => {
  beforeEach(() => resetWorkspace());

  const plan = (over: Record<string, unknown>) =>
    ({
      operation: "report_change_plan",
      observations: [],
      removeConflictingBaselineConcepts: [],
      impressionCandidates: [],
      uncertainties: [],
      clarificationRequired: null,
      ...over,
    }) as never;

  it("a row that writes its finding AND its conclusion clears the flag and keeps it cleared", () => {
    approvedCordReport();
    // Something moved the Findings past the summary, so the pairing is unreconciled.
    useWorkspace.getState().setField("findings", `${CORD_FINDINGS} There is also a C2 fracture.`, {
      source: "manual",
    });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    // A Quick Select row that owns both halves is allowed to re-claim the pairing:
    // it writes the finding and its conclusion in one action. This is the other arm
    // of the overlay's decision, and without it the ownership test above could be
    // satisfied by never rebasing at all — which would nag on every tile.
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "There is also a C2 fracture.", impression: "C2 fracture." },
      templates: { findings: "There is also a C2 fracture.", impression: "C2 fracture." },
      ownership: { conflictGroup: "fracture", concept: "fracture", level: "C2" },
      source: "quick-findings",
      region: "Cervical Spine",
      concept: "fracture",
      level: "C2",
      findingsText: "There is also a C2 fracture.",
      impressionText: "C2 fracture.",
      id: "qs-c2-fracture",
    });
    expect(useWorkspace.getState().impressionText).toMatch(/C2 fracture/);
    const live = answer();
    expect(live.needsRefresh, "the row wrote the finding and its conclusion together").toBe(false);
    expect(reopenCurrent()).toEqual(live);
  });

  it("a dictated finding with no Impression contribution arms the dependency in the session", () => {
    approvedCordReport();
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        plan({
          observations: [{
            concept: "vertebral_lesion",
            level: "C2",
            findingsText: "Voice: a C2 fracture is seen.",
            impressionText: "",
          }],
        }),
        "voice transcript",
        { force: true },
      ),
    ).toBe("applied");
    expect(useWorkspace.getState().findingsText).toMatch(/C2 fracture/);
    expect(useWorkspace.getState().impressionText).toBe(OWNED_IMPRESSION);

    const live = answer();
    expect(
      live.needsRefresh,
      "the dictation put a fracture in the Findings and the summary was written before it",
    ).toBe(true);
    expect(live.reasons).toContain("findings-changed");
    expect(reopenCurrent()).toEqual(live);
  });

  it("removing the only dictated finding re-reads the pairing it just changed", () => {
    useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
    useWorkspace.getState().setField("impression", OWNED_IMPRESSION, { source: "quick-select" });
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        plan({
          observations: [{
            concept: "disc_contour",
            level: "C5-C6",
            laterality: "left",
            findingsText: "Voice: left C5-C6 disc herniation with cord compression.",
            impressionText: "Left C5-C6 disc herniation with cord compression.",
          }],
        }),
        "first transcript",
        { force: true },
      ),
    ).toBe("applied");
    const voiced = useWorkspace.getState().voiceComposerObservations;
    expect(voiced.length).toBeGreaterThan(0);

    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        plan({
          observations: [{ operation: "remove", concept: "disc_contour", targetObservationId: voiced[0]!.id }],
        }),
        "second transcript",
        { force: true },
      ),
    ).toBe("applied");
    // The removal is not just a ledger change: the dictated sentence has to leave the
    // report with it, or the finding stays in the printed exam while the observation
    // that owned it is gone — and the next reload reads the sentence as prose the
    // radiologist wrote by hand, which no later dictation can retire.
    expect(useWorkspace.getState().findingsText).not.toMatch(/left C5-C6 disc herniation/);
    expect(useWorkspace.getState().impressionText).not.toMatch(/Left C5-C6 disc herniation/);

    const live = answer();
    const reopened = reopenCurrent();
    expect(
      live.reasons,
      `the summary was written while the removed finding was still in the exam, so it has to be re-read: ${JSON.stringify(live)}`,
    ).toContain("findings-changed");
    expect(
      live,
      `dictation took a finding out and the session says ${JSON.stringify(live)} while the same report after a reload says ${JSON.stringify(reopened)}`,
    ).toEqual(reopened);
  });

  it("a dictated summary with no observation of its own reaches the Impression", () => {
    approvedCordReport();
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        plan({ impressionUpdate: NORMAL_IMPRESSION }),
        "normal MRI of the cervical spine",
      ),
    ).toBe("applied");
    expect(
      useWorkspace.getState().impressionText,
      `the plan returned "applied" but the Impression still reads ${JSON.stringify(
        useWorkspace.getState().impressionText,
      )}`,
    ).toMatch(/Normal MRI of the cervical spine/);

    const live = answer();
    expect(
      live.reasons,
      `a dictated normal over a myelopathy has to be re-read: ${JSON.stringify(live)}`,
    ).toContain("impression-contradicts-findings");
    expect(reopenCurrent()).toEqual(live);
  });

  it("a dictated summary that follows the Findings re-pairs them, in the session and after a reload", () => {
    approvedCordReport();
    useWorkspace.getState().setField("findings", `${CORD_FINDINGS} There is also a C2 fracture.`, {
      source: "manual",
    });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        plan({ impressionUpdate: REVISED_IMPRESSION }),
        "c5 c6 disc herniation with cord compression and a c2 fracture",
      ),
    ).toBe("applied");
    expect(useWorkspace.getState().impressionText).toMatch(/C2 fracture/);

    const live = answer();
    expect(live, `the dictation wrote the finding and its summary in one action: ${JSON.stringify(live)}`).toEqual({
      needsRefresh: false,
      reasons: [],
    });
    expect(reopenCurrent()).toEqual(live);
  });

  it("a dictated summary arrives when it is dictated alongside its findings too", () => {
    approvedCordReport();
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        plan({
          observations: [{
            concept: "vertebral_lesion",
            level: "C2",
            findingsText: "There is also a C2 fracture.",
            impressionText: "",
          }],
          impressionUpdate: REVISED_IMPRESSION,
        }),
        "a c2 fracture; c5 c6 disc herniation with cord compression and the fracture",
        { force: true },
      ),
    ).toBe("applied");
    expect(
      useWorkspace.getState().impressionText,
      `the plan carried both a finding and a summary, and the Impression reads ${JSON.stringify(
        useWorkspace.getState().impressionText,
      )}`,
    ).toMatch(/C2 fracture/);

    const live = answer();
    expect(live, `the summary covers the fracture the same dictation added: ${JSON.stringify(live)}`).toEqual({
      needsRefresh: false,
      reasons: [],
    });
    expect(reopenCurrent()).toEqual(live);
  });
});
