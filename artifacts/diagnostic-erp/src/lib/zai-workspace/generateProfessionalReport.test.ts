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
import { assertsAbnormality } from "@/lib/generateLocalImpression";
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
function cCtx() {
  return buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI Cervical Spine", regions: ["Cervical Spine"], source: "auto",
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

  it("keeps the technique and recommendation already on the page", () => {
    reset();
    // Start Report loads the study's protocol first and generates second, so by
    // the time this runs the Technique box holds what the protocol wrote and the
    // Recommendation box may hold something dictated. The format owns neither,
    // and replacing them is how a sequence list disappeared from a printed report.
    useWorkspace.getState().setField("technique", "DWI, FLAIR, T1, T2 and SWI sequences were acquired.", { source: "manual" });
    useWorkspace.getState().setField("recommendation", "Clinical correlation with the recent seizure.", { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    const s = useWorkspace.getState();
    expect(s.techniqueText).toContain("DWI, FLAIR, T1, T2 and SWI sequences were acquired.");
    expect(s.recommendationText).toContain("Clinical correlation with the recent seizure.");
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

  it("stays idempotent on a report that deviates — a second press must not re-add the normal", () => {
    reset();
    useWorkspace.getState().setField("findings", "Acute infarct in the left MCA territory.", { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    const first = narrative();
    expect(first.impression).toContain("Acute infarct");
    // The second press changes nothing in the Findings and the ledger, so it does
    // not re-derive the Impression — and if it merged the format's own normal
    // conclusion at that point, nothing downstream would remove it again. Measured:
    // without the guard, "Normal MRI of the brain. No acute intracranial
    // abnormality." arrives above the infarct on the SECOND press only, which an
    // idempotence test on a normal study can never see.
    expect(useWorkspace.getState().generateProfessionalReport(brainCtx()).status).toBe("generated");
    expect(narrative()).toEqual(first);
    expect(useWorkspace.getState().impressionText).not.toMatch(/Normal MRI of the brain/i);
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
    // The absence is the other half of the claim, and it was not asserted until
    // it was measured: a deviating report printed the format's own normal
    // conclusion first and the abnormality under it — "Normal MRI of the brain.
    // No acute intracranial abnormality." arriving immediately above "…consistent
    // with an acute infarct." A conclusion that asserts both is not a draft
    // waiting to be tidied; it is a report that can be signed exactly as written.
    expect(impression).not.toMatch(/Normal MRI of the brain/i);
    expect(impression).not.toMatch(/No acute intracranial abnormality/i);
    // Nor may the body's own negatives be promoted into its place.
    expect(impression).not.toMatch(/No restricted diffusion is seen/i);
    expect(impression).not.toMatch(/No extra-axial collection is identified/i);
    expect(impression).not.toMatch(/unremarkable/i);
  });

  it("does not read a normal sentence already on the page as a deviation", () => {
    reset();
    // A structured template autofills an empty Findings box with one normal
    // sentence before anyone presses anything. Reading that as a deviation
    // rebuilt the conclusion out of the report's own body — measured at seven
    // lines, "Lumbar facet joints are unremarkable." among them, where the
    // clinic had approved one.
    useWorkspace.getState().setField("findings", "Lumbar lordosis is maintained.", { source: "template" });
    expect(useWorkspace.getState().generateProfessionalReport(lsCtx()).status).toBe("generated");
    const chosen = resolveNormalBootstrapFormat({ ctx: lsCtx(), formats: DEFAULT_REPORT_FORMATS });
    expect(chosen?.status).toBe("apply");
    if (chosen?.status !== "apply") return;
    const asSentences = (t: string) => splitToSentences(t).map(normalizeForDedupe).filter(Boolean).sort();
    expect(asSentences(useWorkspace.getState().impressionText))
      .toEqual(asSentences(chosen.format.impression));
  });

  it("is undoable as one action", () => {
    reset();
    useWorkspace.getState().setField("findings", "Typed before the press.", { source: "manual" });
    const before = narrative();
    const ledgerBefore = ledgerShape();
    const stackDepth = useWorkspace.getState().patchUndoStack.length;
    useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(useWorkspace.getState().patchUndoStack.length).toBe(stackDepth + 1);
    expect(narrative().findings).not.toBe(before.findings);
    useWorkspace.getState().undoLastPatch();
    expect(narrative()).toEqual(before);
    // The prose is only half of what the press wrote. It also materialised the
    // format's baseline observations into the ledger, and Start Report's Undo
    // (which is this frame and no other) has to take those back with it: text
    // restored while the ledger still claims forty normal observations is a
    // report that disagrees with itself the moment anything re-renders from it.
    expect(ledgerShape()).toEqual(ledgerBefore);
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

describe("a hand-typed deviation over a cervical normal", () => {
  /**
   * The conclusion used to come back as six lines, five of them the report's own
   * per-level normals — "C2-C3: No exiting or traversing nerve root compression
   * is seen." among them — because the impression picker reads the Findings text,
   * and the Findings text is where the scaffold wrote those sentences. Excluding
   * the baseline ledger rows and then re-reading every sentence from the text put
   * them back through the door the ledger had just closed.
   */
  it("concludes the abnormality and nothing the scaffold already owns", () => {
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(cCtx()).status).toBe("generated");
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toContain("C5-C6: Disc herniation with cord compression.");
    expect(impression).not.toMatch(/No spinal canal or thecal sac compression/i);
    expect(impression).not.toMatch(/No exiting or traversing nerve root compression/i);
    expect(impression).not.toMatch(/Neural foramina are patent/i);
    expect(impression).not.toMatch(/unremarkable/i);
    // A deviating report still may not borrow the normal's own conclusion (PR B).
    expect(impression).not.toMatch(/Normal MRI of the cervical spine/i);
  });

  it("keeps every other level's normal that the deviation does not touch", () => {
    // Nothing here decides that C2-C3 is normal — the scaffold said so, and the
    // radiologist did not contradict it. Trimming the Conclusion must not trim
    // the body.
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(cCtx());
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("C2-C3: No significant disc bulge or protrusion is seen.");
    expect(findings).toContain("C6-C7: Neural foramina are patent bilaterally.");
  });

  it("does not treat a denial the radiologist typed as a deviation", () => {
    // The same sentence as a finding and as a denial differ only in the words
    // between the label and the cue, and six words was enough to lose it.
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: No spinal canal or thecal sac compression is seen.", { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(cCtx()).status).toBe("generated");
    const impression = useWorkspace.getState().impressionText;
    expect(impression).not.toMatch(/No spinal canal or thecal sac compression/i);
    expect(impression).toContain("Normal MRI of the cervical spine");
  });
});

describe("a selected observation speaks once in the Conclusion", () => {
  it("does not put a selected observation's Findings sentence in the Conclusion", () => {
    // The observation already speaks in the Conclusion, in the short form the tile
    // carries. The picker's leftovers are what the ledger does NOT speak for, and
    // reading them out of the whole Findings text instead appended the body's
    // sentence underneath it — two lines for one finding, and the longer one is
    // the prose that belongs in Findings.
    reset({ reportingContext: lsCtx() });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence ?? "" },
      templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence ?? "" },
      ownership: {
        concept: DISC_L45.concept, anatomicalSection: DISC_L45.anatomicalSection,
        conflictGroup: DISC_L45.conflictGroup, baselineReplaces: DISC_L45.baselineReplaces,
      },
      source: "quick-select", field: "findings", label: DISC_L45.label,
      region: "LS Spine", findingsText: DISC_L45.sentence,
    });
    useWorkspace.getState().generateProfessionalReport(lsCtx());
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toContain("Disc herniation at L4-L5");
    expect(impression).not.toContain("Broad-based disc bulge at L4-L5");
  });
});

describe("a deviation retires the scaffold's description of the level it contradicts", () => {
  /**
   * The report used to carry both statements. Pressing Generate over a typed
   * "C5-C6: Disc herniation with cord compression." wrote the approved cervical
   * normal underneath it, including "C5-C6: No significant disc bulge or
   * protrusion is seen." — and nothing on the page could tell the radiologist
   * which of the two the examination showed.
   */
  it("removes the contradicted level's normals and keeps every other level's", () => {
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(cCtx()).status).toBe("generated");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("C5-C6: Disc herniation with cord compression.");
    expect(findings).not.toContain("C5-C6: No significant disc bulge or protrusion is seen.");
    expect(findings).not.toContain("C5-C6: No spinal canal or thecal sac compression is seen.");
    expect(findings).not.toContain("C5-C6: Neural foramina are patent bilaterally.");
    // Levels nobody spoke about keep the normal the clinic approved.
    expect(findings).toContain("C4-C5: No significant disc bulge or protrusion is seen.");
    expect(findings).toContain("C6-C7: No significant disc bulge or protrusion is seen.");
  });

  it("one undo frame takes the whole press back and leaves what he typed", () => {
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(cCtx());
    const retired = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => p.observation?.role === "baseline" && p.stale,
    );
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.every((p) => p.observation?.level === "C5-C6")).toBe(true);
    expect(useWorkspace.getState().patchUndoStack).toHaveLength(1);
    useWorkspace.getState().undoLastPatch();
    // Undo of the press removes the normals it wrote — the ones it retired with
    // them — and cannot touch the sentence that was on the page before it.
    expect(useWorkspace.getState().findingsText).toBe("C5-C6: Disc herniation with cord compression.");
  });

  it("pressing twice does not retire a second time", () => {
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(cCtx());
    const once = useWorkspace.getState().findingsText;
    useWorkspace.getState().generateProfessionalReport(cCtx());
    expect(useWorkspace.getState().findingsText).toBe(once);
  });

  it("a denial that names a level is that level's normal, not a contradiction of it", () => {
    reset({ reportingContext: cCtx() });
    useWorkspace.getState().setField("findings", "C5-C6: No significant disc bulge is seen.", { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(cCtx());
    expect(useWorkspace.getState().findingsText)
      .toContain("C5-C6: No spinal canal or thecal sac compression is seen.");
  });

  it("a sentence that names no level retires nothing", () => {
    // An infarct is attributed to the study, not to a disc space, so there is no
    // level whose normal it denies and the rule must delete nothing.
    reset();
    useWorkspace.getState().setField("findings", "Acute infarct in the left MCA territory.", { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(brainCtx());
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.stale)).toBe(false);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("Acute infarct in the left MCA territory.");
    expect(findings).toContain("No intracranial hemorrhage is seen.");
  });

  it("strips only sentences the template itself wrote", () => {
    // The rows this rule may touch are the template's, and the sentences it
    // removes are theirs: a tile's finding or a dictated line is what the level
    // was contradicted BY, never what gets deleted to make the report agree.
    reset({ reportingContext: cCtx() });
    // A recorded finding AT the same level as the typed deviation — the only shape
    // that tells the two kinds of row apart, and therefore the only fixture that
    // can see this guard go missing.
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "C5-C6: Disc height loss with foraminal narrowing.", impression: "C5-C6: Disc height loss." },
      templates: { findings: "C5-C6: Disc height loss with foraminal narrowing.", impression: "C5-C6: Disc height loss." },
      ownership: {
        concept: "disc_height", anatomicalSection: "C5-C6", conflictGroup: "disc height",
        baselineReplaces: "C5-C6: Intervertebral disc height is maintained.",
      },
      source: "quick-select", field: "findings", label: "Reduced disc height C5-C6",
      region: "Cervical Spine", findingsText: "C5-C6: Disc height loss with foraminal narrowing.",
    });
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(cCtx());
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("C5-C6: Disc height loss with foraminal narrowing.");
    expect(findings).toContain("C5-C6: Disc herniation with cord compression.");
    expect(findings).not.toContain("C5-C6: Intervertebral disc height is maintained.");
    expect(useWorkspace.getState().appliedPathologyPatches
      .filter((p) => p.stale)
      .every((p) => p.observation?.role === "baseline")).toBe(true);
  });
});

describe("CARE's own baseline sentences can never read as findings", () => {
  /**
   * A content-wide gate rather than another hand-picked example: every sentence
   * the shipped formats write into Findings is a normal, so not one of them may
   * be recognised as pathology. Measured before the fix, 32 of 152 were — all of
   * them level-labelled or region-labelled denials and screening scope notices —
   * and every one of them was arriving in a signed Conclusion as an abnormality.
   */
  it("none of the baseline findings sentences asserts abnormality", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const format of DEFAULT_REPORT_FORMATS) {
      for (const observation of format.baselineManifest?.observations ?? []) {
        if (observation.field !== "findings") continue;
        scanned += 1;
        if (assertsAbnormality(observation.renderedText)) offenders.push(`${format.name}: ${observation.renderedText}`);
      }
    }
    // The scan itself has to be non-vacuous: a manifest that stopped loading
    // would satisfy `toEqual([])` on nothing.
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
