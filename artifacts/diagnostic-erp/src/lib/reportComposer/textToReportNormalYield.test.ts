/**
 * Normal replacement, the workspace half: an abnormality the radiologist entered with
 * his own hands must retire ONLY the normal statements that contradict it.
 *
 * The examination opens as its approved normal, and on MRI Brain that normal is a
 * system-owned ledger row (`system-normal-study`, concept `normal_study`) carrying the
 * Conclusion "Normal MRI of the brain. No acute intracranial abnormality." Every other
 * scaffold sentence is a per-slot baseline row that contributes to Findings only, so
 * this one row is the whole of what the ledger says the Impression should be.
 *
 * A typed or dictated abnormality has no ledger row, so the two predicates that already
 * govern that row read the report as normal:
 *
 *   `suppressesSystemNormal` — concepts and the rows' own Conclusion prose;
 *   `statesAbnormalImpression` — same, per row.
 *
 * Measured on this change (tmp, MRI Brain): after a right basal ganglia DWI finding is
 * typed into Findings, `reportAssertsAbnormality` — the shipped twin that also reads the
 * free text — answers `true` while `suppressesSystemNormal` answers `false`, and the
 * workspace's automatic pass
 * (`useWorkspaceClinicalUi.tsx:3643` → `refreshImpressionFromLedger({ automatic: true })`)
 * collects the row's contribution straight back into the Conclusion. The report then
 * asserts an acute infarction and, two lines below it, that there is no acute
 * intracranial abnormality. Same for a press.
 *
 * The fix is the yield, not a deletion. `conceptCanon/normalImpression.ts` states it as
 * invariant 1 — the system normal patch is the ONLY impression contribution that
 * auto-yields — and the Full Normal Format door already blanks it on exactly this
 * condition (`store.ts`, `assertsAbnormality && isSystemNormalPatch(p)`). This is the
 * same rule for the same row, applied at the one place that still re-reads it, so:
 *
 *   nothing is removed from Findings — the per-slot normals the typed sentence says
 *   nothing about stay where the radiologist left them;
 *   nothing is removed from the ledger — the row stays live, so deleting the typed
 *   abnormality brings its own conclusion back on the next pass;
 *   a normal he wrote himself is untouched — that sentence reaches the Conclusion as
 *   protected text, and protection is applied before any of this.
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
import { contributionProtected } from "@/lib/observationSlot";
import { reportAssertsAbnormality, suppressesSystemNormal } from "@/lib/conceptCanon/normalImpression";

const S = () => useWorkspace.getState();

/** The format's own whole-examination normal, as the system normal row carries it. */
const BRAIN_NORMAL_CONCLUSION = "Normal MRI of the brain. No acute intracranial abnormality.";

const DWI_FINDING =
  "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.";

/** An unrelated anatomy sentence the typed finding says nothing about. */
const UNRELATED_NORMAL = "Brainstem shows normal morphology and signal intensity.";

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
}

const lines = (t: string) => t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const hasImpressionLine = (line: string) =>
  lines(S().impressionText).some((s) => normalizeForDedupe(s) === normalizeForDedupe(line));

/** The exact call the workspace's derived-impression effect makes (`automatic: true`). */
const runAutomaticPass = () => S().refreshImpressionFromLedger({ automatic: true });

/** Type an abnormality into Findings the way the editor does — no row, no concept. */
function typeFinding(sentence: string): void {
  S().setField("findings", `${S().findingsText}\n${sentence}`);
}

describe("a typed abnormality yields the whole-examination normal, and nothing else", () => {
  it("control: a study nobody has typed into still concludes its approved normal", () => {
    openBrainStudy();
    expect(S().impressionText).toContain(BRAIN_NORMAL_CONCLUSION);
    // The reading the fix turns on must be false here, or a normal report loses its
    // conclusion — the alarm-on-normal-reports failure mode the contradiction
    // validators are already known for.
    expect(reportAssertsAbnormality(S().appliedPathologyPatches, {
      findings: S().findingsText, impression: S().impressionText,
    })).toBe(false);
    runAutomaticPass();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION),
      "a genuinely normal report keeps its normal conclusion").toBe(true);
  });

  it("an automatic pass does not print the exam's normal under a typed abnormality", () => {
    openBrainStudy();
    typeFinding(DWI_FINDING);
    // Measured before the fix: the ledger-only predicate sees no abnormality, so the
    // pass collects the system normal's contribution back into the Conclusion.
    expect(suppressesSystemNormal(S().appliedPathologyPatches)).toBe(false);
    expect(reportAssertsAbnormality(S().appliedPathologyPatches, {
      findings: S().findingsText, impression: S().impressionText,
    })).toBe(true);
    runAutomaticPass();
    expect(hasImpressionLine(DWI_FINDING), "the typed abnormality is still concluded").toBe(true);
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION),
      "the report asserts a normal for the whole examination beside its own contradiction")
      .toBe(false);
  });

  it("a pressed refresh reaches the same answer as the pass nobody pressed", () => {
    openBrainStudy();
    typeFinding(DWI_FINDING);
    S().refreshImpressionFromLedger();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION),
      "the dependency cannot depend on which door ran").toBe(false);
  });

  it("only the contradicted normal yields: unrelated anatomy stays on the page", () => {
    openBrainStudy();
    const findingsBefore = S().findingsText;
    expect(findingsBefore).toContain(UNRELATED_NORMAL);
    typeFinding(DWI_FINDING);
    runAutomaticPass();
    expect(S().findingsText).toContain(UNRELATED_NORMAL);
    // …and the denial the finding does contradict is not silently cut out from under his
    // cursor either — the page is his, the yield is in the derived Conclusion only.
    expect(S().findingsText).toContain("No acute infarct is seen.");
  });

  it("the yield reverses: with nothing left asserting an abnormality, the same live row gives its conclusion back", () => {
    openBrainStudy();
    const asOpened = { findings: S().findingsText, impression: S().impressionText };
    typeFinding(DWI_FINDING);
    runAutomaticPass();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION)).toBe(false);
    // Yield, not deletion: the row never left the ledger and still carries its own words.
    const row = S().appliedPathologyPatches.find((p) => p.id === "system-normal-study");
    expect(row, "the normal's row must survive the yield").toBeDefined();
    expect(row!.stale, "a stale row cannot give its conclusion back").toBeFalsy();
    expect(row!.templates.impression).toContain("No acute intracranial abnormality");

    // Take the abnormality back out of the report the way he would — both fields, since
    // the pass concluded what he typed and a Conclusion that still asserts restricted
    // diffusion is not a normal report. Deleting only the Findings sentence leaves his
    // concluded abnormality standing, and the normal correctly stays out (measured).
    S().setField("findings", asOpened.findings);
    S().setField("impression", asOpened.impression);
    runAutomaticPass();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION),
      "a yield that never returns is a deletion").toBe(true);
  });

  it("a normal the radiologist wrote himself is never taken by the yield", () => {
    openBrainStudy();
    // His own handwriting, not the row's: reworded, so the editor credits the sentence
    // to him rather than leaving the scaffold's identical text in place.
    const HIS = "No acute intracranial abnormality is identified.";
    S().setField("impression", HIS);
    expect(contributionProtected(HIS, S().fieldProvenance.impression)).toBe(true);
    typeFinding(DWI_FINDING);
    // The shipped rule that runs first: a silent pass never rebuilds a Conclusion the
    // radiologist wrote, so nothing moves at all — the yield cannot reach his text.
    expect(runAutomaticPass()).toBe("held-protected");
    expect(hasImpressionLine(HIS),
      "invariant 1: manual impression text is never deleted by the normal's auto-yield")
      .toBe(true);
    // A press is allowed to rebuild, and still must not take his sentence: protection is
    // applied to the current Conclusion before the ledger is collected, and the row the
    // yield drops is the system's own, not the one he authored.
    S().refreshImpressionFromLedger();
    expect(hasImpressionLine(HIS), "a press keeps what he wrote").toBe(true);
    expect(hasImpressionLine(DWI_FINDING), "a press concludes his finding").toBe(true);
  });

  it("a negated finding yields nothing: a denial is not an abnormality", () => {
    openBrainStudy();
    typeFinding("No restricted diffusion is seen on DWI or ADC sequences.");
    runAutomaticPass();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION),
      "the report still says the examination is normal, so its normal still stands")
      .toBe(true);
  });

  it("laterality does not make a contradicted normal stand: a left-sided infarct yields it", () => {
    openBrainStudy();
    typeFinding("Small acute infarct in the left MCA territory.");
    runAutomaticPass();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION)).toBe(false);
    expect(hasImpressionLine("Small acute infarct in the left MCA territory.")).toBe(true);
  });

  // MEASURED RESIDUAL, pinned rather than papered over. The abnormality reading this yield
  // reuses is `isAbnormalFindingsLine` — the shipped, precision-first classifier that
  // decides which Findings lines print bold. It keys on named cues, and "restricted
  // diffusion" is not one of them (measured with tmp classifier probe:
  // `isAbnormalFindingsLine("Restricted diffusion in the left frontal cortex.")` is false
  // while `assertsAbnormality(…)` is true). So a report whose ONLY abnormal statement is
  // that sentence keeps its whole-examination normal. Widening the bolding classifier is
  // not this change's to make: it would restyle every printed surface in the clinic and
  // its own suite pins the current vocabulary. Named here so the gap is one measurement
  // wide, not invisible.
  it.fails("vocabulary gap: a finding the bolding classifier does not name leaves its normal standing", () => {
    openBrainStudy();
    typeFinding("Restricted diffusion in the left frontal cortex, with corresponding low signal on ADC.");
    runAutomaticPass();
    expect(hasImpressionLine(BRAIN_NORMAL_CONCLUSION)).toBe(false);
  });
});
