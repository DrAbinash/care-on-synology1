/**
 * MODE A — the instant report. The clinic's requirement is that a radiologist's
 * observations produce a complete report *without asking for it*, and with no model,
 * no cloud, no GPU and no internet anywhere in the path.
 *
 * The build itself is not tested here: `generateProfessionalReport` is already the
 * subject of `normalBootstrapOwnership.test.ts`, `clinicalCompositionHardening.test.ts`
 * and the golden corpus. What is new, and therefore what this file owns, is the
 * permission to run it unpressed. An automatic pass is a different clinical object
 * from a press: nobody chose it, so it may not claim a format use, may not spend an
 * undo frame, may not rebuild a hand-written Conclusion, and must never bring back a
 * normal the report already disowned.
 *
 * A1–A7 are that contract. Every one of them fails on a build where the automatic
 * flag is deleted or inverted — see the mutation notes in the commit message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeStructuredNormalFormats, type StructuredNormalRow } from "./structuredNormalFormats";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_BRAIN_STANDARD_NORMAL_NAME } from "./baselines/mriBrainStandardNormal";
import { MRI_CERVICAL_STANDARD_NORMAL_NAME } from "./baselines/mriCervicalStandardNormal";
import { MRI_CERVICAL_STANDARD_NORMAL_MANIFEST } from "./baselines/mriCervicalStandardNormal";
import { useWorkspace } from "./store";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { impressionProvenanceIsRadiologistManual } from "@/lib/impressionProvenance";
import { formatCanalApTableText } from "@/lib/spineCanalAp";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  decideInstantReport,
  holdFromRefusal,
  holdIsReportable,
  readInstantReportEnabled,
  writeInstantReportEnabled,
  INSTANT_REPORT_STORAGE_KEY,
  type InstantReportInput,
} from "./instantReport";
import { hasOwnedApprovedNormal } from "./professionalReport";

const brainCtx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});
const cervicalCtx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Cervical Spine", regions: ["Cervical Spine"], source: "auto",
});

/** A clinic Templates row with prose only — no `baselineManifest`, so no approved normal. */
function legacyProseRow(id: number, templateName: string, bodyPart: string): StructuredNormalRow {
  return {
    id,
    templateName,
    modality: "MRI",
    bodyPart,
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI on 3T. Multiplanar sequences were obtained.",
      recommendation: "Clinical correlation.",
      findingsItems: [],
    }),
    defaultFindings: "The examined region is normal.",
    defaultImpression: "Normal study. No significant abnormality detected.",
    isActive: true,
    isDefault: true,
  };
}

const eligible = (over: Partial<InstantReportInput> = {}): InstantReportInput => ({
  enabled: true,
  contentLocked: false,
  confirmationOpen: false,
  manualImpression: false,
  foreignFindingsLines: 0,
  engineOwnsCanvas: false,
  ...over,
});

function resetWorkspace(ctx = brainCtx, formats?: StructuredNormalRow[]) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    normalLinesRemovedByRadiologist: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], patchRedoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false, appliedFormatReportTitle: null, appliedFormatName: null,
    startingCanvasBaseline: null, canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: ctx, reportFormats: formats
      // The curated baselines are in the shipped library; a clinic row of prose is not
      // one, so passing `formats` here is how an examination with no approved normal
      // is reproduced without editing the library.
      ? mergeStructuredNormalFormats([], formats)
      : mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [
        legacyProseRow(1, "MRI Brain Plain", "BRAIN"),
        legacyProseRow(2, "MRI Cervical Spine Plain", "CERVICAL SPINE"),
      ]),
    selectedFormatIds: [], isFinalized: false, isDirty: false,
    instantReportHold: null, notification: null,
  });
}

/** Any network call during Mode A is a defect: this report path has no provider. */
function networkSpy() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    calls.push(String(typeof input === "string" ? input : (input as Request)?.url ?? input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("A1 — the decision is a table, not a mood", () => {
  it("composes on a clean, identified examination with an approved normal", () => {
    expect(decideInstantReport(eligible())).toEqual({ action: "compose" });
  });

  it("switched off and content-locked are silence, not a banner", () => {
    const off = decideInstantReport(eligible({ enabled: false }));
    const locked = decideInstantReport(eligible({ contentLocked: true }));
    expect(off.action).toBe("hold");
    expect(locked.action).toBe("hold");
    if (off.action !== "hold" || locked.action !== "hold") return;
    expect(off.code).toBe("off");
    expect(locked.code).toBe("locked");
    expect(holdIsReportable(off.code)).toBe(false);
    expect(holdIsReportable(locked.code)).toBe(false);
  });

  it("a Conclusion the radiologist wrote by hand is left alone", () => {
    const hold = decideInstantReport(eligible({ manualImpression: true }));
    expect(hold.action).toBe("hold");
    if (hold.action !== "hold") return;
    expect(hold.code).toBe("manual-impression");
    expect(hold.message).toContain("Press Generate");
  });

  it("a report that began as dictation needs the press for its first merge", () => {
    const hold = decideInstantReport(eligible({ foreignFindingsLines: 2 }));
    expect(hold.action).toBe("hold");
    if (hold.action !== "hold") return;
    expect(hold.code).toBe("starts-from-dictation");
    // Once the engine owns the canvas it keeps updating only what it wrote.
    expect(decideInstantReport(eligible({ foreignFindingsLines: 2, engineOwnsCanvas: true })))
      .toEqual({ action: "compose" });
  });

  it("the widest veto speaks first: a locked report with a manual Conclusion says locked", () => {
    const hold = decideInstantReport(eligible({ contentLocked: true, manualImpression: true }));
    expect(hold.action === "hold" && hold.code).toBe("locked");
  });

  it("an unanswered confirmation on screen blocks the rebuild", () => {
    const hold = decideInstantReport(eligible({ confirmationOpen: true }));
    expect(hold.action === "hold" && hold.code).toBe("confirmation-open");
  });

  it("every reason the generator refuses arrives as a hold, under its own name", () => {
    // Not reworded here: two surfaces describing one refusal differently is how a
    // radiologist ends up told two different things about the same blocked write.
    const hold = holdFromRefusal({
      status: "refused", code: "identity-unresolved", reason: "Set the study region, then generate again.",
    });
    expect(hold.code).toBe("identity-unresolved");
    expect(hold.message).toBe("Set the study region, then generate again.");
    expect(holdIsReportable(hold.code)).toBe(true);
    // A signed report is not this feature's to comment on.
    const signed = holdFromRefusal({ status: "refused", code: "signed", reason: "Withdraw it first." });
    expect(signed.code).toBe("locked");
    expect(signed.message).toBe("");
    expect(holdIsReportable(signed.code)).toBe(false);
  });
});

describe("A2 — the approved normal is the generator's decision, not the caller's", () => {
  it("the clinic's curated manifest is approved, and prose without one is not", () => {
    expect(hasOwnedApprovedNormal(MRI_CERVICAL_STANDARD_NORMAL_MANIFEST)).toBe(true);
    expect(hasOwnedApprovedNormal(undefined)).toBe(false);
    expect(hasOwnedApprovedNormal({ kind: "care.something_else.v1" })).toBe(false);
  });

  it("an examination whose only format is un-approved prose is never rebuilt automatically", () => {
    // The rule MODE A needs ("no normal inferred to fill space") cannot be decided by
    // looking at the canvas, so it must not be decided by a second format lookup
    // either. The generator resolves the format once and refuses here, before it
    // writes; `regionTransitionReload.test.ts` is why the caller may not resolve it.
    resetWorkspace(brainCtx, [legacyProseRow(1, "MRI Brain Plain", "BRAIN")]);
    networkSpy();
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(outcome.action).toBe("hold");
    if (outcome.action !== "hold") return;
    expect(outcome.code).toBe("no-owned-normal");
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(useWorkspace.getState().instantReportHold?.message).toContain("approved normal");
  });

  it("the same un-approved prose still builds when the radiologist presses it", () => {
    // The exemption is the press itself: a radiologist who chose this format is
    // allowed a report built from it, and the rule must not become a second veto.
    resetWorkspace(brainCtx, [legacyProseRow(1, "MRI Brain Plain", "BRAIN")]);
    networkSpy();
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx);
    expect(outcome.status).toBe("generated");
    expect(useWorkspace.getState().findingsText).toContain("The examined region is normal.");
  });
});

describe("A3 — the automatic pass against the real store", () => {
  beforeEach(() => {
    resetWorkspace();
    networkSpy();
  });

  it("builds the whole report with zero network calls", () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    });
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(outcome.action).toBe("compose");
    const state = useWorkspace.getState();
    expect(state.findingsText.length).toBeGreaterThan(0);
    expect(state.appliedFormatName).toBe(MRI_BRAIN_STANDARD_NORMAL_NAME);
    expect(state.instantReportHold).toBeNull();
    // Mode A has no provider and no telemetry to satisfy. Any request here is the
    // composer being reached for by a path that must never need it, or an unpressed
    // pass claiming a format use.
    expect(calls).toEqual([]);
  });

  it("claims no format use and pushes no notification, which a press does both of", () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    });
    useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(calls.filter((c) => c.includes("/use"))).toEqual([]);
    expect(useWorkspace.getState().notification).toBeNull();

    resetWorkspace();
    vi.stubGlobal("fetch", async (input: unknown) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    });
    useWorkspace.getState().generateProfessionalReport(brainCtx);
    expect(calls.filter((c) => c.includes("/use")).length).toBe(1);
  });

  it("is idempotent: a second pass writes nothing and spends no undo frame", () => {
    useWorkspace.getState().composeInstantReport(brainCtx, false);
    const findings = useWorkspace.getState().findingsText;
    const frames = useWorkspace.getState().patchUndoStack.length;
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(outcome.action).toBe("compose");
    expect(useWorkspace.getState().findingsText).toBe(findings);
    // `pushClinicalUndoSnapshot` does not dedupe, so the only thing keeping a idle
    // pass from filling the stack is the wrote-nothing short circuit.
    expect(useWorkspace.getState().patchUndoStack.length).toBe(frames);
  });

  it("a press always takes its undo frame, even when nothing changed", () => {
    useWorkspace.getState().generateProfessionalReport(brainCtx);
    const frames = useWorkspace.getState().patchUndoStack.length;
    useWorkspace.getState().generateProfessionalReport(brainCtx);
    expect(useWorkspace.getState().patchUndoStack.length).toBe(frames + 1);
  });

  it("never rewrites a Conclusion the radiologist wrote", () => {
    useWorkspace.getState().composeInstantReport(brainCtx, false);
    const manual = "Left MCA territory infarct. Clinical correlation advised.";
    // Written through the editor's own action, so the provenance is the one the app
    // actually records — a hand-made record would only prove my predicate agrees
    // with itself.
    useWorkspace.getState().setField("impression", manual, { source: "manual" });
    expect(impressionProvenanceIsRadiologistManual(useWorkspace.getState().fieldProvenance.impression))
      .toBe(true);
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(outcome.action).toBe("hold");
    if (outcome.action !== "hold") return;
    expect(outcome.code).toBe("manual-impression");
    expect(useWorkspace.getState().impressionText).toBe(manual);
    expect(useWorkspace.getState().instantReportHold?.message).toContain("Your Impression is yours");
  });

  it("never adds the clinic's normal conclusion underneath a hand-written Impression", () => {
    // The decision's hold is the second layer. This pins the first, inside the engine:
    // a caller that reaches the generator without consulting the decision still cannot
    // get "Normal MRI of the brain." appended to a Conclusion the radiologist wrote,
    // because a report cannot make two claims about the same examination.
    useWorkspace.getState().composeInstantReport(brainCtx, false);
    const manual = "Mild chronic small vessel ischaemic change only.";
    useWorkspace.getState().setField("impression", manual, { source: "manual" });
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx, { automatic: true });
    expect(outcome.status).toBe("generated");
    expect(useWorkspace.getState().impressionText).toBe(manual);
    expect(useWorkspace.getState().impressionText).not.toMatch(/Normal MRI/i);
    // The Findings scaffold is still merged — that part of Mode A is wanted.
    expect(useWorkspace.getState().findingsText.length).toBeGreaterThan(0);

    // A press is the radiologist asking for the conclusion to be rebuilt.
    resetWorkspace(brainCtx);
    useWorkspace.getState().composeInstantReport(brainCtx, false);
    useWorkspace.getState().setField("impression", manual, { source: "manual" });
    useWorkspace.getState().generateProfessionalReport(brainCtx);
    expect(useWorkspace.getState().impressionText).not.toBe(manual);
    expect(useWorkspace.getState().impressionText).toMatch(/Normal MRI/i);
  });

  it("the engine's own guard, not only the hold, protects a hand-written Conclusion", () => {
    // The decision refuses an automatic pass whenever the Impression is manual, so
    // nothing normally reaches the generator in that state — which is exactly why the
    // guard inside the generator needs its own test. A caller that goes straight to
    // the engine is one refactor away from silently rebuilding someone's Conclusion.
    useWorkspace.getState().composeInstantReport(brainCtx, false);
    useWorkspace.getState().setField("findings", "Acute infarct in the left MCA territory.", { source: "manual" });
    const manual = "Left MCA infarct — clinical correlation.";
    useWorkspace.getState().setField("impression", manual, { source: "manual" });
    const outcome = useWorkspace.getState().generateProfessionalReport(brainCtx, { automatic: true });
    expect(outcome.status).toBe("generated");
    expect(useWorkspace.getState().impressionText).toBe(manual);
    // And the refusal is REPORTED, not merely performed: a caller that cannot tell
    // "nothing was written, because what is there is protected" from "the refresh
    // ran" is exactly how a blanked Impression once read as a successful one.
    expect(useWorkspace.getState().refreshImpressionFromLedger({ automatic: true }))
      .toBe("held-protected");
    expect(useWorkspace.getState().impressionText).toBe(manual);
    // The same action over a Conclusion the engine owns still reports the write, so
    // "held-protected" is not the only answer this action can give.
    useWorkspace.getState().setField("impression", manual, { source: "quick-select" });
    expect(useWorkspace.getState().refreshImpressionFromLedger()).toBeUndefined();
    // And the same pass over a Conclusion the engine owns does rebuild it, so this is
    // not the action simply failing to run. It used to be proved with a finding that
    // writes no conclusion — where the pass blanked the Impression and the test read
    // that as a refresh. That blank is the defect A5 refuses, so the control here has
    // to be a box that really concludes.
    const hydro = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Hydrocephalus");
    if (!hydro) throw new Error("the shipped Brain catalogue no longer has Hydrocephalus");
    useWorkspace.getState().setField("impression", manual, { source: "quick-select" });
    expect(useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(hydro, "findings")))
      .not.toBe("refused");
    useWorkspace.getState().generateProfessionalReport(brainCtx, { automatic: true });
    expect(useWorkspace.getState().impressionText).not.toBe(manual);
    expect(useWorkspace.getState().impressionText).toContain("Hydrocephalus");
  });

  it("keeps a retired normal retired across a later automatic pass", () => {
    resetWorkspace(cervicalCtx);
    networkSpy();
    useWorkspace.getState().composeInstantReport(cervicalCtx, false);
    const c56Normal = MRI_CERVICAL_STANDARD_NORMAL_MANIFEST.observations
      .filter((o) => o.field === "findings" && /C5-C6/i.test(o.level ?? ""))
      .map((o) => o.renderedText.trim());
    expect(c56Normal.length).toBeGreaterThan(0);
    for (const line of c56Normal) {
      expect(useWorkspace.getState().findingsText).toContain(line);
    }

    // The radiologist describes the level in their own words. The pass retires the
    // scaffold's C5-C6 normal and marks its ledger row superseded.
    useWorkspace.getState().setField("findings", "C5-C6: Disc herniation with cord compression.", { source: "manual-typed" });
    useWorkspace.getState().composeInstantReport(cervicalCtx, false);
    for (const line of c56Normal) {
      expect(useWorkspace.getState().findingsText).not.toContain(line);
    }

    // Then they delete their own sentence. The scaffold now has nothing contradicting
    // it on the page, so a plain rebuild would merge the normal back in beside a
    // report that still says the level is abnormal somewhere else.
    useWorkspace.getState().setField("findings", "", { source: "manual-typed" });
    useWorkspace.getState().composeInstantReport(cervicalCtx, false);
    for (const line of c56Normal) {
      expect(useWorkspace.getState().findingsText).not.toContain(line);
    }
  });

  it("holds, and says why, when the examination is not identified", () => {
    const outcome = useWorkspace.getState().composeInstantReport({
      ...brainCtx, modality: "MR", studyDescription: "MRI Orbits", regions: ["Orbits"],
    }, false);
    expect(outcome.action).toBe("hold");
    if (outcome.action !== "hold") return;
    expect(["identity-unresolved", "no-owned-normal", "no-normal-format", "ambiguous"])
      .toContain(outcome.code);
    expect(useWorkspace.getState().instantReportHold).not.toBeNull();
    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("does nothing at all to a signed report, and does not nag about it", () => {
    useWorkspace.setState({ isFinalized: true });
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, true);
    expect(outcome.action).toBe("hold");
    if (outcome.action !== "hold") return;
    expect(outcome.code).toBe("locked");
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(useWorkspace.getState().instantReportHold).toBeNull();
  });

  it("the workspace lock outranks an identified study with an approved normal", () => {
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, true);
    expect(outcome.action).toBe("hold");
    if (outcome.action !== "hold") return;
    expect(outcome.code).toBe("locked");
    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("answers an open confirmation by holding, not by building underneath it", () => {
    useWorkspace.setState({ confirmOverwriteOpen: true });
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(outcome.action === "hold" && outcome.code).toBe("confirmation-open");
    expect(useWorkspace.getState().findingsText).toBe("");
  });
});

describe("A4 — the switch is the radiologist's, and defaults on", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });

  it("an absent preference is not a decision: Mode A is the default report path", () => {
    expect(readInstantReportEnabled()).toBe(true);
  });

  it("turning it off is remembered, and stops the engine touching the report", () => {
    writeInstantReportEnabled(false);
    expect(storage.get(INSTANT_REPORT_STORAGE_KEY)).toBe("0");
    expect(readInstantReportEnabled()).toBe(false);
    resetWorkspace();
    networkSpy();
    const outcome = useWorkspace.getState().composeInstantReport(brainCtx, false);
    expect(outcome.action === "hold" && outcome.code).toBe("off");
    expect(useWorkspace.getState().findingsText).toBe("");
    // Off is not news on a canvas; the radiologist chose it.
    expect(useWorkspace.getState().instantReportHold).toBeNull();
    writeInstantReportEnabled(true);
    expect(storage.has(INSTANT_REPORT_STORAGE_KEY)).toBe(false);
    expect(readInstantReportEnabled()).toBe(true);
  });
});

describe("A5 — an unpressed pass never deletes the Conclusion", () => {
  const lsCtx = buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
  });

  beforeEach(() => {
    resetWorkspace(lsCtx);
    networkSpy();
  });

  it("keeps a Conclusion when the box the radiologist clicked writes Findings only", () => {
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const approvedNormal = useWorkspace.getState().impressionText;
    expect(approvedNormal).toMatch(/Normal MRI/i);

    // Shipped catalogue content, not a hand-made payload: this box is abnormal, it
    // carries a concept so it retires the scaffold's disc normal, and it has no
    // `impressionSentence` — so nothing in the ledger concludes for it.
    const box = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc bulge L3-L4");
    if (!box) throw new Error("the shipped LS Spine catalogue no longer has Disc bulge L3-L4");
    expect((box.impressionSentence ?? "").trim()).toBe("");
    expect(useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(box, "findings")))
      .not.toBe("refused");

    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const state = useWorkspace.getState();
    // The Findings half of Mode A is the wanted half.
    expect(state.findingsText).toContain("Disc bulge at L3-L4");
    // The unpressed pass may not answer "what is the impression?" with nothing. An
    // empty Impression is not a judgement the engine is entitled to make: it is a
    // silent clinical mutation, and the report the radiologist is reading now makes
    // no claim about the examination at all.
    expect(state.impressionText.trim()).not.toBe("");
    // And the gap is stated, not hidden — the amber dependency the pressed surfaces
    // already render, plus the canvas reason naming what has to be written.
    expect(state.impressionNeedsRefresh).toBe(true);
    expect(state.instantReportHold?.code).toBe("impression-undecided");
    // Measured residual, recorded rather than fixed here: the generator's own merge
    // had already dropped the "Normal MRI of the lumbosacral spine." line, so the
    // sentence left standing ("No significant disc, canal, foraminal or neural
    // compressive abnormality.") still contradicts the bulge in the Findings. That
    // merge is the pressed path's own and predates Mode A — see the second test
    // below and the control at 8d14b121 — and which normal sentence a box falsifies
    // is authored clinical content, not something this engine may decide.
  });

  it("a press still rebuilds the Conclusion down to nothing", () => {
    // The guard is about nobody having asked. Pressing Generate is the radiologist
    // commanding the whole report be rebuilt from the ledger, and the ledger says
    // what it says; a rule that silenced their own press would be Mode A claiming
    // authority over the doctor. Measured at 8d14b121 on the pristine control: the
    // same box, pressed, leaves "" there too — this is inherited behaviour, and this
    // test is the control that keeps the automatic guard from quietly widening.
    resetWorkspace(lsCtx);
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const box = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc bulge L3-L4");
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(box!, "findings"));
    useWorkspace.getState().generateProfessionalReport(lsCtx);
    expect(useWorkspace.getState().findingsText).toContain("Disc bulge at L3-L4");
    expect(useWorkspace.getState().impressionText).toBe("");
  });

  it("keeps reporting the held Conclusion on every pass after it", () => {
    // The reason cannot be a one-shot. Measured over five further passes on this
    // report: the Findings do not drift, the Impression is never blanked, and each
    // pass still answers with the same code — including the ones that write no prose
    // at all, which is where an unreported hold would otherwise go silent while the
    // amber "needs refresh" flag stayed on screen.
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const box = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc bulge L3-L4");
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(box!, "findings"));
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const impression = useWorkspace.getState().impressionText;
    for (let i = 0; i < 5; i += 1) {
      const again = useWorkspace.getState().composeInstantReport(lsCtx, false);
      expect(again.action === "hold" && again.code).toBe("impression-undecided");
      expect(useWorkspace.getState().instantReportHold?.code).toBe("impression-undecided");
      expect(useWorkspace.getState().impressionText).toBe(impression);
    }
  });

  it("the recovery the hold names is the recovery that works", () => {
    // "write it; this pass will not overwrite what you type" is a promise, so it is
    // tested: the radiologist types a Conclusion over a held pass, another finding
    // arrives, and the hand-written line is still the Impression.
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const box = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc bulge L3-L4");
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(box!, "findings"));
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(useWorkspace.getState().instantReportHold?.code).toBe("impression-undecided");

    const written = "L3-L4 disc bulge, no nerve root compression.";
    useWorkspace.getState().setField("impression", written, { source: "manual" });
    const other = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Facet arthropathy L4-L5");
    expect(other).toBeTruthy();
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(other!, "findings"));
    const outcome = useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(outcome.action === "hold" && outcome.code).toBe("manual-impression");
    expect(useWorkspace.getState().impressionText).toBe(written);
  });
});

describe("A6 — a normal the radiologist deleted stays deleted", () => {
  const lsCtx = buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
  });
  const NL = String.fromCharCode(10);

  beforeEach(() => {
    resetWorkspace(lsCtx);
    networkSpy();
  });

  /** Compose the approved normal, then remove one of its sentences by hand. */
  function deleteOneNormalSentence(pattern: RegExp): string {
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const lines = useWorkspace.getState().findingsText.split(NL);
    const victim = lines.find((l) => pattern.test(l));
    if (!victim) throw new Error(`no ${pattern} sentence in the composed normal`);
    useWorkspace.getState().setField(
      "findings", lines.filter((l) => l !== victim).join(NL), { source: "manual-typed" },
    );
    return victim;
  }

  it("an unpressed pass does not put the sentence back", () => {
    const victim = deleteOneNormalSentence(/lumbar lordosis/i);
    // Measured before this guard existed: the line came back on the very next pass,
    // because the scaffold merge reads the FORMAT, not the page. Re-issuing clinical
    // prose the radiologist just rejected is overwriting their edit.
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(useWorkspace.getState().findingsText).not.toContain(victim);
  });

  it("and neither does any later pass", () => {
    const victim = deleteOneNormalSentence(/lumbar lordosis/i);
    // The suppression has to be REMEMBERED. Recomputing "what did they delete?" from
    // the engine's own last stamp finds nothing on the pass after next — the stamp has
    // already been restamped without the line — and the merge re-adds it. Measured:
    // it came back on pass three.
    for (let i = 0; i < 4; i += 1) {
      useWorkspace.getState().composeInstantReport(lsCtx, false);
      expect(useWorkspace.getState().findingsText).not.toContain(victim);
    }
    expect(useWorkspace.getState().normalLinesRemovedByRadiologist).toContain(victim);
  });

  it("a press rebuilds the whole normal, because the radiologist asked for it", () => {
    const victim = deleteOneNormalSentence(/lumbar lordosis/i);
    // The deletion must be RECORDED first — a pass has to see it — and then the press
    // has to forget it. Without the reset, a sentence removed months ago would keep
    // silencing the approved normal every time this doctor pressed Generate.
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(useWorkspace.getState().normalLinesRemovedByRadiologist).toContain(victim);
    expect(useWorkspace.getState().findingsText).not.toContain(victim);

    useWorkspace.getState().generateProfessionalReport(lsCtx);
    expect(useWorkspace.getState().findingsText).toContain(victim);
    expect(useWorkspace.getState().normalLinesRemovedByRadiologist).toEqual([]);
  });

  it("the record belongs to this examination and is gone with the study", () => {
    // A carry-over would refuse to merge a normal the NEXT patient's radiologist never
    // removed, and nothing on screen would explain why the sentence is missing. This is
    // the workspace's own switch (`setStudies` + `selectStudy`), which is what applies
    // `CLINICAL_RESET_FIELDS` — the same list `clinicalStateReset.hardening.test.ts`
    // ratchets, so the field cannot be dropped without both suites speaking.
    deleteOneNormalSentence(/lumbar lordosis/i);
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(useWorkspace.getState().normalLinesRemovedByRadiologist.length).toBeGreaterThan(0);
    useWorkspace.setState({
      activeStudyId: "17",
      studies: [{ id: "17", patientName: "Instant One" }, { id: "18", patientName: "Instant Two" }] as never,
    });
    useWorkspace.getState().selectStudy("18");
    expect(useWorkspace.getState().activeStudyId).toBe("18");
    expect(useWorkspace.getState().normalLinesRemovedByRadiologist).toEqual([]);
  });

  it("only a sentence the engine actually wrote can be suppressed", () => {
    // Deleting the radiologist's OWN sentence is not this mechanism's business, and a
    // sentence the findings contradict is already retired through the ledger. The set
    // is the intersection of {scaffold} and {last stamped}, so a line outside it can
    // never silence a normal that still belongs on the page.
    const victim = deleteOneNormalSentence(/lumbar lordosis/i);
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const suppressed = useWorkspace.getState().normalLinesRemovedByRadiologist;
    expect(suppressed).toEqual([victim]);
    const otherNormal = useWorkspace.getState().findingsText
      .split(NL).find((l) => l.trim() && l !== victim)!;
    expect(suppressed).not.toContain(otherNormal);
  });
});

describe("A7 — a measurement stays a number: not summarised, not removable", () => {
  // The canal AP grid is the one clinical value in a report that is NOT prose. Its
  // authority is `canalApProvenance`, and the printed table is drawn from that record
  // by the renderer at print time — so the automatic pass must neither invent a
  // Conclusion out of the block the box pastes into Findings, nor clean that block away
  // as if it were scaffold. Both halves are the same rule seen from either side: the
  // number is not this engine's to write, and not its to delete.
  const lsCtx = buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
  });
  const NL = String.fromCharCode(10);
  // Exactly what `SpineCanalApBox` merges (`formatCanalApTableText` → mergeField with
  // source "companion"): a title, a tab-separated header, a tab-separated row, and a
  // prose sentence carrying the numbers.
  const canalBlock = formatCanalApTableText("lumbar", { "L3-L4": "11", "L4-L5": "8" });

  beforeEach(() => {
    resetWorkspace(lsCtx);
    networkSpy();
  });

  function withMeasurementBlock() {
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    useWorkspace.getState().mergeField("findings", canalBlock, "companion");
  }

  it("the pasted grid is not summarised into the Impression", () => {
    withMeasurementBlock();
    const before = useWorkspace.getState().findingsText;
    expect(before).toContain("AP (mm)");
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const st = useWorkspace.getState();
    // The pass ran — the approved normal is on the page — and it changed nothing.
    expect(st.findingsText).toContain("lumbar lordosis");
    expect(st.findingsText).toBe(before);
    // A conclusion is a claim about the study, not a reading of a table.
    expect(st.impressionText).not.toMatch(/\d/);
    expect(st.impressionText).not.toMatch(/\bmm\b/i);
  });

  it("and a later pass still leaves the grid where the radiologist put it", () => {
    withMeasurementBlock();
    for (let i = 0; i < 3; i += 1) useWorkspace.getState().composeInstantReport(lsCtx, false);
    const lines = useWorkspace.getState().findingsText.split(NL);
    for (const line of canalBlock.split(NL)) {
      expect(lines, `the pass dropped "${line}"`).toContain(line);
    }
    // It is not remembered as a deleted normal either: it was never the engine's line.
    expect(useWorkspace.getState().normalLinesRemovedByRadiologist).toEqual([]);
  });

  it("a canonical record with no sentence of its own puts no number in the Conclusion", () => {
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    // The measurement exists, structured and attributed, with nothing typed anywhere.
    expect(useWorkspace.getState().recordCanalApManualValue("L4-L5", "8", "lumbar")).toBe("L4-L5");
    const decision = useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(decision.action).toBe("compose");
    expect(useWorkspace.getState().canalApProvenance["L4-L5"]).toBeTruthy();
    expect(useWorkspace.getState().impressionText).not.toMatch(/\d/);
  });

  it("the block is foreign text, so a report that began as dictation is not merged into", () => {
    // No engine-owned canvas, and a pasted grid: the decision must hold and say so,
    // rather than writing the whole approved normal underneath someone's own report.
    useWorkspace.getState().setField("findings", canalBlock, { source: "manual-typed" });
    const decision = useWorkspace.getState().composeInstantReport(lsCtx, false);
    expect(decision.action === "hold" && decision.code).toBe("starts-from-dictation");
    expect(useWorkspace.getState().findingsText).toBe(canalBlock);
  });

  it("a level the radiologist DID describe in prose still retires its normal", () => {
    // The control for both rules above. Excluding table markup and companion text must
    // not turn into "the scaffold never stands aside" — this is the case the rule was
    // written for, and the report must not say both things about one level.
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const before = useWorkspace.getState().findingsText;
    expect(before).toContain("L4-L5: No significant disc bulge or protrusion is seen.");
    useWorkspace.getState().setField(
      "findings", `${before}${NL}L4-L5: Disc extrusion with thecal sac compression.`,
      { source: "manual-typed" },
    );
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const after = useWorkspace.getState().findingsText;
    expect(after).toContain("L4-L5: Disc extrusion with thecal sac compression.");
    expect(after).not.toContain("L4-L5: No significant disc bulge or protrusion is seen.");
  });

  it("a PASTED grid is still not a claim about the first level it names", () => {
    // The same table markup reaching the page as someone's own text rather than through
    // the companion tool, where provenance cannot vouch for it and the shape has to.
    // `extractLevel` returns the FIRST level in a line, so a header row reads as a
    // description of L1-L2 — and without this rule that level's normal disappears from
    // a report in which nobody ever said anything about L1-L2.
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().setField(
      "findings", `${before}${NL}${canalBlock}`, { source: "manual-typed" },
    );
    useWorkspace.getState().composeInstantReport(lsCtx, false);
    const after = useWorkspace.getState().findingsText.split(NL);
    expect(after).toContain("L1-L2: No significant disc bulge or protrusion is seen.");
    expect(after).toContain("L2-L3: No significant disc bulge or protrusion is seen.");
    expect(after.some((l) => l.startsWith("LEVEL\t"))).toBe(true);
  });
});
