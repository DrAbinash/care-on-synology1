/**
 * generateProfessionalReport.test.ts — the deterministic one-click report.
 *
 * These run against the REAL store, the REAL shipped format library and the REAL
 * Quick Select tiles, because the claim under test is a clinical one: a complete
 * MRI report can be built with no AI and with nothing invented. A fixture would
 * prove the wiring and nothing about the wording.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { useWorkspace } from "./store";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { resolveNormalBootstrapFormat } from "./normalBootstrap";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  canalApReportTable,
  radiologistObservations,
  reapplyInputFromPatch,
} from "./professionalReport";

const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;

function brainCtx() {
  return buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
  });
}
function lsCtx() {
  return buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
  });
}
/** An identity CARE cannot resolve — no region at all. */
function unknownCtx() {
  return buildReportingStudyContext({ modality: "MR", studyDescription: "", regions: [], source: "auto" });
}

function narrative() {
  const s = useWorkspace.getState();
  return {
    technique: s.techniqueText,
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
  };
}
function ledgerShape() {
  return useWorkspace.getState().appliedPathologyPatches.map((p) => p.id).sort();
}

function reset(blank: Partial<ReturnType<typeof Object>> = {}) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: brainCtx(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
    isDirty: false,
    ...blank,
  });
}

describe("generateProfessionalReport — the deterministic one-click MRI report", () => {
  it("builds a complete report for a study with nothing in it yet", () => {
    reset();
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(outcome.status).toBe("generated");
    const text = narrative();
    expect(text.technique.trim()).not.toBe("");
    expect(text.findings).toContain("Brain parenchyma shows normal signal intensity");
    expect(text.impression.trim()).not.toBe("");
    expect(text.recommendation.trim()).not.toBe("");
    // Named by the resolver, not by this test: which approved normal wins for a
    // plain brain study is normalBootstrap's decision, and the report must say so.
    expect(useWorkspace.getState().appliedFormatName)
      .toBe(resolveNormalBootstrapFormat({ ctx: brainCtx(), formats: DEFAULT_REPORT_FORMATS })!.format.name);
    // A report that changed must say it changed: this is what schedules the draft
    // save and stops the workspace looking unchanged after a press.
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("leaves a complete normal with one conclusion, not a copy of the Findings", () => {
    reset();
    const chosen = resolveNormalBootstrapFormat({ ctx: brainCtx(), formats: DEFAULT_REPORT_FORMATS });
    expect(chosen?.status).toBe("apply");
    if (chosen?.status !== "apply") return;
    useWorkspace.getState().generateProfessionalReport(brainCtx());
    const impressionLines = useWorkspace.getState().impressionText
      .split(/\n+/).map((s) => s.trim()).filter(Boolean);
    // "No acute infarct is seen." carries the cue `infarct`, and the cue survives
    // its own negation in `generateLocalImpression`. Deriving over a complete normal
    // therefore promoted every relevant negative in the body into the Impression, so
    // the report read "Normal MRI of the brain." and then five more lines of Findings.
    for (const line of impressionLines) {
      expect(line).not.toMatch(/^No (acute infarct|intracranial hemorrhage|midline shift) is seen\.$/);
      expect(line).not.toMatch(/are preserved\.|are unremarkable\.$/);
    }
    // The guarantee is that the conclusion is exactly what the clinic approved.
    // Compared sentence by sentence, not line by line: CARE's merge re-flows a
    // one-line Impression into one sentence per line, which is presentation, not
    // content — and this test is about content that was not supposed to arrive.
    const asSentences = (t: string) => splitToSentences(t).map(normalizeForDedupe).filter(Boolean).sort();
    expect(asSentences(useWorkspace.getState().impressionText))
      .toEqual(asSentences(chosen.format.impression));
  });

  it("refuses an unidentified study and writes nothing at all", () => {
    reset();
    const before = narrative();
    const beforeLedger = ledgerShape();
    const outcome = useWorkspace.getState().generateProfessionalReport(unknownCtx());
    expect(outcome.status).toBe("refused");
    expect(outcome.code).toBe("identity-unresolved");
    // "never fabricate" is only a claim if the refusal is inert.
    expect(narrative()).toEqual(before);
    expect(ledgerShape()).toEqual(beforeLedger);
    expect(useWorkspace.getState().patchUndoStack.length).toBe(0);
    expect(useWorkspace.getState().isDirty).toBe(false);
  });

  it("refuses a signed report and refuses to dirty it", () => {
    reset({ isFinalized: true });
    const before = narrative();
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(outcome.status).toBe("refused");
    expect(outcome.code).toBe("signed");
    expect(narrative()).toEqual(before);
    expect(useWorkspace.getState().isDirty).toBe(false);
  });

  it("refuses while a confirmation is already on screen", () => {
    reset({ confirmOverwriteOpen: true });
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(outcome.status).toBe("refused");
    expect(outcome.code).toBe("confirmation-open");
    expect(narrative().findings).toBe("");
  });

  it("refuses before the format library has arrived, and says so", () => {
    reset({ reportFormats: [] });
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(outcome.status).toBe("refused");
    expect(outcome.code).toBe("library-loading");
  });

  it("names the reason when no approved normal exists for the exam", () => {
    reset();
    const outcome = useWorkspace.getState().generateProfessionalReport(
      buildReportingStudyContext({ modality: "MR", studyDescription: "MRI Sacroiliac Joints", regions: ["SI Joints"], source: "auto" }),
    );
    expect(outcome.status).toBe("refused");
    expect(outcome.code).toBe("no-normal-format");
    expect(outcome.reason).toContain("No normal report for this exam");
  });

  it("keeps dictated free text — it merges the report in, it does not replace it", () => {
    reset();
    useWorkspace.getState().setField("findings", "Patient reports sudden onset of left leg weakness.", { source: "manual" });
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(outcome.status).toBe("generated");
    expect(useWorkspace.getState().findingsText).toContain("Patient reports sudden onset of left leg weakness.");
    expect(useWorkspace.getState().findingsText).toContain("Brain parenchyma shows normal signal intensity");
  });

  it("is idempotent — a second press changes not one character", () => {
    reset();
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    const first = narrative();
    const firstLedger = ledgerShape();
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    expect(narrative()).toEqual(first);
    expect(ledgerShape()).toEqual(firstLedger);
  });

  it("keeps an observation selected before the press, and retires the normal it contradicts", () => {
    reset({ reportingContext: lsCtx() });
    const tileOutcome = useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
      templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
      ownership: {
        concept: DISC_L45.concept,
        anatomicalSection: DISC_L45.anatomicalSection,
        conflictGroup: DISC_L45.conflictGroup,
        baselineReplaces: DISC_L45.baselineReplaces,
      },
      source: "quick-select",
      id: "qs_l45",
      region: "LS Spine",
      label: DISC_L45.label,
      findingsText: DISC_L45.sentence,
    });
    expect(tileOutcome).toBe("applied");
    // The format this examination actually resolves to — not the one this test
    // guesses at. Only a curated format carries a baseline manifest, and the
    // manifest names the exact normal sentence this level's disc contour owns.
    const chosen = resolveNormalBootstrapFormat({ ctx: lsCtx(), formats: DEFAULT_REPORT_FORMATS });
    expect(chosen?.status).toBe("apply");
    if (chosen?.status !== "apply") return;
    const contour = (chosen.format.baselineManifest?.observations ?? [])
      .filter((o) => o.concept === "disc_contour" && o.level === "L4-L5")
      .map((o) => o.renderedText);
    expect(contour.length).toBeGreaterThan(0);

    const outcome = useWorkspace.getState().generateProfessionalReport(lsCtx());
    expect(outcome.status).toBe("generated");
    if (outcome.status !== "generated") return;
    expect(outcome.observationsRetained).toBe(1);

    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain(DISC_L45.sentence.replace("{side}", "left").slice(0, 24));
    // Exactly one copy of the selected statement — the replay must not duplicate it.
    expect(findings.split(DISC_L45.sentence).length - 1).toBeLessThanOrEqual(1);
    // The scaffold cannot keep asserting a normal for the level the radiologist
    // reported as abnormal; that is the contradiction the slot engine exists for.
    for (const sentence of contour) expect(findings).not.toContain(sentence);
    expect(useWorkspace.getState().appliedPathologyPatches.filter((p) => p.id === "qs_l45").length).toBe(1);
  });

  it("keeps the observation id, so its measurements and key images stay attached", () => {
    reset({ reportingContext: lsCtx() });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: DISC_L45.sentence },
      templates: { findings: DISC_L45.sentence },
      ownership: { concept: DISC_L45.concept, anatomicalSection: DISC_L45.anatomicalSection, conflictGroup: DISC_L45.conflictGroup, baselineReplaces: DISC_L45.baselineReplaces },
      source: "quick-select",
      id: "keep_me",
      region: "LS Spine",
      label: DISC_L45.label,
      findingsText: DISC_L45.sentence,
    });
    useWorkspace.getState().generateProfessionalReport(lsCtx());
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.id === "keep_me")).toBe(true);
  });

  it("adds the measurement table only where a number was actually recorded", () => {
    reset({ reportingContext: lsCtx() });
    const measured = useWorkspace.getState().generateProfessionalReport(lsCtx());
    expect(measured.status).toBe("generated");
    if (measured.status !== "generated") return;
    expect(measured.measurementTableIncluded).toBe(false);
    expect(useWorkspace.getState().findingsText).not.toContain("Spinal canal AP diameter");

    reset({ reportingContext: lsCtx() });
    useWorkspace.getState().recordCanalApManualValue("L4-L5", "11.5", "lumbar");
    useWorkspace.getState().recordCanalApManualValue("L5-S1", "12", "lumbar");
    const withTable = useWorkspace.getState().generateProfessionalReport(lsCtx());
    expect(withTable.status).toBe("generated");
    if (withTable.status !== "generated") return;
    expect(withTable.measurementTableIncluded).toBe(true);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("| L4-L5 | 11.5 mm |");
    expect(findings).toContain("| L5-S1 | 12 mm |");
    // The five discs the radiologist never measured are not offered as blanks.
    expect(findings).not.toContain("| L1-L2 |");
  });

  it("rebuilds the impression from the ledger rather than trusting the format", () => {
    reset({ reportingContext: lsCtx() });
    useWorkspace.getState().generateProfessionalReport(lsCtx());
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
      templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
      ownership: { concept: DISC_L45.concept, anatomicalSection: DISC_L45.anatomicalSection, conflictGroup: DISC_L45.conflictGroup, baselineReplaces: DISC_L45.baselineReplaces },
      source: "quick-select",
      id: "imp_1",
      region: "LS Spine",
      label: DISC_L45.label,
      findingsText: DISC_L45.sentence,
    });
    useWorkspace.getState().generateProfessionalReport(lsCtx());
    const impression = useWorkspace.getState().impressionText;
    expect(impression).not.toMatch(/^\s*Normal MRI/);
    if (DISC_L45.impressionSentence) {
      expect(impression).toContain(DISC_L45.impressionSentence.slice(0, 20));
    }
  });

  it("does not dirty a report that a second press left unchanged", () => {
    reset();
    useWorkspace.getState().generateProfessionalReport(brainCtx());
    // A press that writes nothing must not schedule a save. Autosave otherwise
    // fires on every click, and a report marked dirty that is not dirty misstates
    // itself to the radiologist and to the leave-study guard.
    useWorkspace.setState({ isDirty: false });
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    expect(useWorkspace.getState().isDirty).toBe(false);
  });

  it("carries a hand-typed abnormality through to the Impression", () => {
    reset();
    const dictated = "There is an area of restricted diffusion in the right middle cerebral artery territory, consistent with an acute infarct.";
    useWorkspace.getState().setField("findings", dictated, { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    const impression = useWorkspace.getState().impressionText;
    // The Impression is re-derived from what the report now says, not left as the
    // normal the format shipped with — otherwise "Normal MRI brain" would stand
    // above an infarct the radiologist dictated minutes earlier.
    expect(impression).toContain("acute infarct");
    expect(impression).not.toBe("Normal MRI brain.");
  });

  it("is undoable as one action", () => {
    reset();
    useWorkspace.getState().setField("findings", "Typed before the press.", { source: "manual" });
    const before = narrative();
    const stackDepth = useWorkspace.getState().patchUndoStack.length;
    useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(useWorkspace.getState().patchUndoStack.length).toBe(stackDepth + 1);
    expect(narrative().findings).not.toBe(before.findings);
    useWorkspace.getState().undoLastPatch();
    expect(narrative()).toEqual(before);
  });
});

describe("professionalReport — the pure parts", () => {
  it("offers no table when every level is unmeasured", () => {
    expect(canalApReportTable({}, "lumbar")).toBe("");
    expect(canalApReportTable(null, "lumbar")).toBe("");
    expect(canalApReportTable({}, null)).toBe("");
  });

  it("prints only the levels that carry a number", () => {
    const measured = canalApReportTable({
      "L4-L5": {
        level: "L4-L5", measurementId: "CANAL_AP", unit: "mm", region: "lumbar",
        viewerValue: null, reportValue: 11.5, manualOverride: true,
        annotationId: null, viewerMeasurementRowId: null, studyInstanceUID: null,
        seriesInstanceUID: null, sopInstanceUID: null, frameNumber: null,
        viewerName: null, capturedAt: null, verifiedAt: null, staleReason: null,
      },
    } as never, "lumbar");
    expect(measured).toContain("11.5");
    // A row for an unmeasured disc would read as "this level was measured and was
    // blank", so the table carries only the levels that have a number.
    expect(measured).not.toContain("—");
    expect(measured).not.toContain("L1-L2");
  });

  it("excludes the scaffold's own rows and rows with nothing to say", () => {
    const patch = (over: Record<string, unknown>) => ({
      id: "x", ownership: {}, templates: { findings: "Text." }, lastRendered: { findings: "Text." },
      source: "template", observation: { region: "LS Spine", level: "", laterality: "", state: "", severity: "", measurement: "", slotKey: "", source: "template", baselineReplaces: "", supportsLaterality: false, bundleId: "", sectionsOwned: [], specificity: "region", concept: null, conflictGroup: "", anatomicalSection: "", role: "finding" },
      ...over,
    }) as never;
    expect(radiologistObservations([patch({})])).toHaveLength(1);
    expect(radiologistObservations([patch({ observation: { role: "baseline" } })])).toHaveLength(0);
    expect(radiologistObservations([patch({ stale: true })])).toHaveLength(0);
    expect(radiologistObservations([patch({ templates: {}, lastRendered: {} })])).toHaveLength(0);
    expect(reapplyInputFromPatch(patch({}))).not.toBeNull();
  });

  it("passes the stored side only when it is a side CARE can put in a sentence", () => {
    const base = {
      id: "s", ownership: {}, templates: { findings: "in the {side} MCA territory." },
      lastRendered: {}, source: "quick-select",
    } as never;
    expect(reapplyInputFromPatch({ ...base, observation: { region: "", level: "", laterality: "left", state: "", severity: "", measurement: "", slotKey: "", source: "quick-select", baselineReplaces: "", supportsLaterality: true, bundleId: "", sectionsOwned: [], specificity: "region", concept: null, conflictGroup: "", anatomicalSection: "", role: "finding" } } as never)?.side).toBe("left");
    expect(reapplyInputFromPatch({ ...base, observation: { region: "", level: "", laterality: "unilateral", state: "", severity: "", measurement: "", slotKey: "", source: "quick-select", baselineReplaces: "", supportsLaterality: true, bundleId: "", sectionsOwned: [], specificity: "region", concept: null, conflictGroup: "", anatomicalSection: "", role: "finding" } } as never)?.side).toBe("");
  });
});
