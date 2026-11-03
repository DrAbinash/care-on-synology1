/**
 * P0 — the Impression a radiologist accepts from an AI draft must stay accepted.
 *
 * Measured in the real Composer UI (PR #1258 browser battery, tmp/t2r-testf-evidence.json):
 * the accepted draft's Impression carries the licensed diagnosis, the tracked change is
 * stored ACCEPTED, the editor receives it — and ~1.1 s later the field is back to its
 * pre-Apply text, byte-identical, with no banner, no toast and no warning. Findings in the
 * same Apply keep all three of their sentences, which is what localises the fault to the
 * Impression alone.
 *
 * The writer is not a mystery. Apply arms the Findings→Impression dependency
 * (`store.ts` `applyAiComposerAccepted` ends with `deriveImpressionDependency(get())`, no
 * ownership), and the workspace's automatic pass
 * (`useWorkspaceClinicalUi.tsx:3643` → `refreshImpressionFromLedger({ automatic: true })`)
 * rebuilds the Conclusion from the ledger plus the unexplained Findings lines. In
 * `refreshImpressionFromObservations` only `manual` / `radiologist-voice` sentences survive
 * that rebuild, so wording credited to `ai-draft` — which is exactly what an accepted draft
 * writes — is dropped on the floor one render later.
 *
 * The owner ruling of 2026-10-21 (quoted in `store.ts:4400`) says an `ai-draft` FINDING
 * waits for a press before it is summarised. Nothing in it says a Conclusion the
 * radiologist already accepted may be erased by a pass nobody pressed. These tests hold
 * both halves: nothing silently deleted, nothing silently rewritten.
 *
 * Synthetic study, no patient identity, no model in the loop.
 */
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";

const S = () => useWorkspace.getState();

const DICTATED =
  "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.";

/** The draft the clinic's qwen3:14b actually returned for this input (PR #1258 §3). */
const AI_DRAFT = {
  findings: [
    "Ventricular system and cisternal spaces are normal in size and configuration.",
    "Basal ganglia and thalami are normal in signal intensity.",
    "Brainstem shows normal morphology and signal intensity.",
    DICTATED,
    "Scattered T2 and FLAIR hyperintense foci in the bilateral periventricular and subcortical white matter.",
  ].join(" "),
  impression:
    "Diffusion restriction in the right basal ganglia, consistent with acute infarction.\n"
    + "Scattered T2 and FLAIR hyperintense foci in the periventricular white matter, suggesting chronic small vessel disease.",
  recommendation: "",
};

function brainCtx(): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Brain Plain",
    regions: ["Brain"],
    source: "auto",
  });
}

function openBrainStudy(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: FORMATS,
    reportingContext: brainCtx(),
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionBasis: null, impressionDependencyReasons: [],
    lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, voiceComposerObservations: [], voiceComposerTranscriptHistory: [],
    patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [], isFinalized: false,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {},
    regionTransitions: [],
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    linkedStudy: null,
    appliedPatternMarkers: [],
    activeStudyId: null,
    appliedFormatName: null,
    appliedFormatReportTitle: null,
  });
  const decision = S().composeInstantReport(brainCtx(), false);
  expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
  // The brief's entry point: a few abnormal findings, typed by the radiologist.
  S().setField("findings", `${S().findingsText}\n${DICTATED}`);
}

const sentences = (t: string) => t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const hasLine = (field: "findings" | "impression", line: string) =>
  sentences(S()[field === "findings" ? "findingsText" : "impressionText"])
    .some((s) => normalizeForDedupe(s) === normalizeForDedupe(line));

/**
 * The exact call the workspace's own effect makes after a findings edit
 * (`useWorkspaceClinicalUi.tsx:3647`). A fix that only satisfies a unit test which never
 * runs this has not fixed the browser.
 */
const runAutomaticPass = () => S().refreshImpressionFromLedger({ automatic: true });

describe("an accepted AI Impression survives the render after Apply", () => {
  it("control: Apply writes both fields and an undo frame", () => {
    openBrainStudy();
    const before = { findings: S().findingsText, impression: S().impressionText };
    expect(S().applyAiComposerAccepted(AI_DRAFT)).toBe("applied");
    expect(S().findingsText).toBe(AI_DRAFT.findings);
    expect(S().impressionText).toBe(AI_DRAFT.impression);
    expect(S().patchUndoStack.length).toBeGreaterThan(0);
    // One Undo restores BOTH halves of the pre-Apply report, not one of them.
    expect(S().undoLastPatch()).toBe(true);
    expect(S().findingsText).toBe(before.findings);
    expect(S().impressionText).toBe(before.impression);
  });

  it("the licensed diagnosis is still on the page after the automatic pass runs", () => {
    openBrainStudy();
    S().applyAiComposerAccepted(AI_DRAFT);
    runAutomaticPass();
    expect(S().impressionText, "accepted Impression was rewritten by a pass nobody pressed")
      .toContain("consistent with acute infarction");
    for (const line of sentences(AI_DRAFT.impression)) {
      expect(hasLine("impression", line), `accepted Impression line lost: ${line}`).toBe(true);
    }
  });

  it("the silent pass is idempotent — a second run neither grows nor shrinks the accept", () => {
    openBrainStudy();
    S().applyAiComposerAccepted(AI_DRAFT);
    runAutomaticPass();
    const once = S().impressionText;
    expect(once).toContain("consistent with acute infarction");
    runAutomaticPass();
    // A protection that re-added the accepted line each time would print the same
    // diagnosis twice by the third render; a protection that only survives one pass
    // would not survive the autosave tick that follows it.
    expect(S().impressionText).toBe(once);
    const counts = new Map<string, number>();
    for (const line of sentences(S().impressionText)) counts.set(line, (counts.get(line) ?? 0) + 1);
    for (const [line, n] of counts) expect(n, `Impression line repeated ${n}x: ${line}`).toBe(1);
  });

  it("a finding typed AFTER Apply does not cost the accepted diagnosis", () => {
    openBrainStudy();
    S().applyAiComposerAccepted(AI_DRAFT);
    S().setField("findings", `${S().findingsText}\nThere is a 12 mm left frontal extra-axial collection.`);
    runAutomaticPass();
    expect(S().impressionText).toContain("consistent with acute infarction");
    // and the new finding is not lost either: the pass still summarises what it can name
    expect(S().findingsText).toContain("left frontal extra-axial collection");
  });

  it("an explicitly pressed refresh still rebuilds — the accept is not a freeze", () => {
    openBrainStudy();
    S().applyAiComposerAccepted(AI_DRAFT);
    S().refreshImpressionFromLedger();
    // The protection added for the silent pass must not quietly make accepted wording
    // unrefreshable: a press commands a rebuild from the ledger (the 2026-10-21 ruling
    // and the A5 ruling in instantReport.test.ts), so the accepted line is the press's
    // to drop. If this ever survives, the fix moved from the automatic arm into a freeze.
    expect(hasLine("impression", sentences(AI_DRAFT.impression)[0]),
      "a pressed refresh must still be able to rebuild the Conclusion").toBe(false);
  });

  it("accepted wording is not relabelled as the radiologist's own handwriting", () => {
    openBrainStudy();
    S().applyAiComposerAccepted(AI_DRAFT);
    const key = normalizeForDedupe(sentences(AI_DRAFT.impression)[0]);
    const tags = S().fieldProvenance.impression?.[key] ?? [];
    expect(tags).toContain("ai-draft");
    expect(tags, "an accept must not mark the model's sentence `manual`").not.toContain("manual");
  });
});
