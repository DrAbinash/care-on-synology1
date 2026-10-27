/**
 * ASK-FIRST HOLD SEMANTICS — the browser-demo clinical workflow defects, pinned
 * at the store boundary (PR #1105 follow-up, 2026-10-21).
 *
 * Priority 1 — never insert an abnormal finding while its conflicting normal
 * statement is awaiting the radiologist's answer; cancellation must leave the
 * report UNCHANGED. The pending branch of `applyPathologyOverlay` used to
 * write the merged narrative AND park the ledger row BEFORE the confirm dialog
 * (measured in the real browser: the contradiction lint fired at the study
 * while the decision was open, and "closing the dialog" had to undo its way
 * back through a write nobody authorised). The gate is now a HOLD: while the
 * dialog is open the click has written nothing — no prose, no ledger row, no
 * dirty flag, no undo frame — so a cancel is a pure dismissal.
 *
 * Priority 2 — the Replace dialog must be able to name what will be REMOVED and
 * what will be INSERTED. That needs the pending patch to carry the honest pair:
 * the radiologist's own sentences (`manualKept`) and the tile's resolved
 * incoming, while the row being vacated stays in the ledger for the dialog to
 * read. The old dialog looked the INCOMING row up in the ledger (the pending
 * write had parked it there), so "Existing" and "New" rendered the same
 * sentence twice and the sentence Replace would delete was never named.
 *
 * Priority 3 — an applied tile may not read "blocked — manual kept" when the
 * sentence is still on the page behind a level prefix ("L4-L5: …"), which is
 * what the engine's own re-anchored lines produce.
 *
 * Everything drives the REAL shipped tiles and the real store entries the
 * workspace uses — quickSelectTilePatch → applyPathologyOverlay for clicks,
 * cancelOverwrite / confirmOverwriteAndApply for the dialog, removeObservation
 * for deselects — exactly like the corpus suites.
 */
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./store";
import {
  DEFAULT_QUICK_SELECT_TILES,
  type QuickSelectTile,
} from "./quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./quickSelectTileFixture";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { normalizeForDedupe, splitToSentences, provenanceFromText } from "../reportFieldMerge";
import { emptyViewerMeasurementsState } from "../structuredViewerMeasurements";
import { defaultLumbarNumbering } from "../mriSpineNumbering";
import { defaultSpineSequences } from "../mriSpineSequences";
import { defaultScreeningState } from "../mriSpineScreening";
import { defaultVascularTechnique } from "../mriBrainVascularTechnique";
import { SYSTEM_NORMAL_PATCH_ID } from "../conceptCanon/normalImpression";
import { patchFindingsContributionBlocked } from "../observationLedger";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();
const findingsOf = () => S().findingsText;
const impressionOf = () => S().impressionText;

function required(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  const key = normalizeForDedupe(sentence);
  const hits = splitToSentences(text).filter((s) => normalizeForDedupe(s) === key).length;
  expect(hits, `REQUIRED "${sentence}" in ${where}`).toBe(1);
}
function forbidden(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  expect(
    splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)),
    `FORBIDDEN "${sentence}" in ${where}`,
  ).toBe(false);
}

type Ctx = ReturnType<typeof buildReportingStudyContext>;
const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function resetShell(ctx: Ctx): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: DEFAULT_REPORT_FORMATS, reportingContext: ctx,
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    lastPatchSnapshot: null, confirmOverwriteOpen: false, pendingPathologyPatch: null,
    voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [],
    isFinalized: false, isDirty: false, structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {}, regionTransitions: [], coverageMarks: [], coverageByScope: {},
    normalLinesRemovedByRadiologist: [], selectedObservationId: null,
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    linkedStudy: null, appliedPatternMarkers: [], instantReportHold: null,
  });
}

function openStudy(ctx: Ctx) {
  resetShell(ctx);
  const decision = S().composeInstantReport(ctx, false);
  expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
}

function click(t: QuickSelectTile, params: QuickSelectParameterValues = {}) {
  const outcome = S().applyPathologyOverlay(quickSelectTilePatch(t, "findings", params));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
  return tileRowId(t, params.side);
}

const FACET = tile("Facet arthropathy L4-L5");
const FACET_ROW = tileRowId(FACET);
const FACET_FINDING = "Facet arthropathy at L4-L5.";
const FACET_NORMAL = "Lumbar facet joints are unremarkable.";

/** The full pre-click report state that a cancelled click must leave untouched. */
function clinicalFingerprint() {
  const s = S();
  return {
    findingsText: s.findingsText,
    impressionText: s.impressionText,
    recommendationText: s.recommendationText,
    techniqueText: s.techniqueText,
    clinicalHistoryText: s.clinicalHistoryText,
    fieldProvenance: s.fieldProvenance,
    appliedPathologyPatches: s.appliedPathologyPatches,
    isDirty: s.isDirty,
    patchUndoStack: s.patchUndoStack,
    patchRedoStack: s.patchRedoStack,
    lastPatchSnapshot: s.lastPatchSnapshot,
    selectedObservationId: s.selectedObservationId,
  };
}
const sameClinicalState = (a: ReturnType<typeof clinicalFingerprint>, b: ReturnType<typeof clinicalFingerprint>) =>
  JSON.stringify(a) === JSON.stringify(b);

describe("Priority 1 — the ask-first gate holds the click; nothing is written while the answer is outstanding", () => {
  it("a hand-edited normal: while the dialog is open the report is byte-identical to the pre-click report", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });
    const before = clinicalFingerprint();

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    expect(S().confirmOverwriteOpen).toBe(true);
    // HOLD: no abnormal inserted, no ledger row parked, no undo frame, no dirty
    // flag — the report is exactly the report the radiologist was reading.
    expect(sameClinicalState(clinicalFingerprint(), before)).toBe(true);
    required(edited);
    forbidden(FACET_FINDING);
    expect(S().appliedPathologyPatches.some((p) => p.id === FACET_ROW)).toBe(false);
  });

  it("cancellation is a pure dismissal: every field, the ledger and the undo history are untouched", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });
    const before = clinicalFingerprint();

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    S().cancelOverwrite();

    expect(S().confirmOverwriteOpen).toBe(false);
    expect(S().pendingPathologyPatch).toBeNull();
    expect(sameClinicalState(clinicalFingerprint(), before)).toBe(true);
    required(edited);
    forbidden(FACET_FINDING);
  });

  it("a cancelled ask-first click never eats the radiologist's previous legitimate action", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });
    // A real action with a real undo frame, taken BEFORE the ask-first click.
    const discRow = click(tile("Disc herniation L4-L5"));
    const undoDepth = S().patchUndoStack.length;
    expect(undoDepth).toBeGreaterThan(0);

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    S().cancelOverwrite();
    // The confirm/cancel pair no longer pops the undo stack: the previous
    // action's frame is still the top one, so Ctrl+Z still removes the disc.
    expect(S().patchUndoStack.length).toBe(undoDepth);
    expect(S().undoLastPatch()).toBe(true);
    required(edited);
    forbidden("Broad-based disc bulge at L4-L5");
    expect(S().appliedPathologyPatches.some((p) => p.id === discRow)).toBe(false);
  });

  it("the system-normal yield is held with the click: the normal conclusion survives the dialog", () => {
    // generateProfessionalReport seeds the system normal row — the yield's
    // target. Before the hold, the yield withdrew "Normal MRI of the
    // lumbosacral spine." while the dialog was still open; now it runs only
    // on the commit path, below the gate.
    resetShell(lsCtx());
    const outcome = S().generateProfessionalReport(lsCtx(), {
      automatic: true,
      requireOwnedApprovedNormal: true,
    });
    expect(outcome.status).toBe("generated");
    expect(S().appliedPathologyPatches.some((p) => p.id === SYSTEM_NORMAL_PATCH_ID)).toBe(true);
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });
    const before = clinicalFingerprint();

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    // While pending the study's normal conclusion is STILL on the page — the
    // held click withdrew nothing, not even the system row's own line.
    expect(sameClinicalState(clinicalFingerprint(), before)).toBe(true);
    required("Normal MRI of the lumbosacral spine.", "impression");
    required(edited);
    forbidden(FACET_FINDING);
    S().cancelOverwrite();
    expect(sameClinicalState(clinicalFingerprint(), before)).toBe(true);
    required("Normal MRI of the lumbosacral spine.", "impression");
  });

  it("confirm still applies the whole click on the granted authority, and the normal restays deselectable", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    S().confirmOverwriteAndApply();
    expect(S().confirmOverwriteOpen).toBe(false);
    required(FACET_FINDING);
    required(FACET_FINDING, "impression");
    forbidden(edited);
    expect(S().appliedPathologyPatches.some((p) => p.id === FACET_ROW)).toBe(true);
    // The replaced sentence stays deselectable: the row's claim is the
    // radiologist's own wording, not invented text (corpus contract).
    expect(S().removeObservation(FACET_ROW)).toBe("removed");
    required(edited);
    forbidden(FACET_FINDING);
  });

  it("repeated selection stays honest: pending → cancel → pending → confirm applies exactly once", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    S().cancelOverwrite();
    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    S().confirmOverwriteAndApply();

    const rows = S().appliedPathologyPatches.filter((p) => p.id === FACET_ROW);
    expect(rows).toHaveLength(1);
    const findingsHits = splitToSentences(findingsOf())
      .filter((s) => normalizeForDedupe(s) === normalizeForDedupe(FACET_FINDING)).length;
    expect(findingsHits).toBe(1);
  });
});

describe("Priority 2 — the pending patch carries the honest remove/insert pair for the dialog", () => {
  it("manualKept names the radiologist's sentence; incoming names the tile's; the vacated row stays readable", () => {
    openStudy(lsCtx());
    const edited = "Lumbar facet joints show minimal irregularity, reworded by the radiologist.";
    S().setField("findings", findingsOf().replace(FACET_NORMAL, edited), { source: "manual" });

    expect(S().applyPathologyOverlay(quickSelectTilePatch(FACET, "findings"))).toBe("pending");
    const pending = S().pendingPathologyPatch;
    expect(pending).toBeTruthy();
    // What Replace will REMOVE — the radiologist's own words, named per section.
    expect(pending!.manualKept?.findings ?? []).toContain(edited);
    // What Replace will INSERT — the tile's resolved wording.
    expect(pending!.incoming.findings ?? "").toContain(FACET_FINDING);
    // The row being vacated is still in the ledger for the dialog's "Existing"
    // read — the incoming row is NOT (nothing was parked by the pending click).
    expect(S().appliedPathologyPatches.some((p) => p.id === pending!.id)).toBe(false);
    S().cancelOverwrite();
  });

  it("a severity upgrade names its vacated row: the mild wording is what Replace removes", () => {
    openStudy(lsCtx());
    const row = click(tile("Mild canal stenosis L4-L5"));
    required("Mild canal stenosis at L4-L5 without cord compression.");
    // The shipped same-slot confirm path: the radiologist's edit puts the row
    // under manual protection (same mechanism as sameSlotReplacement.test.ts).
    const MILD_FINDING = "Mild canal stenosis at L4-L5 without cord compression.";
    useWorkspace.setState({
      appliedPathologyPatches: S().appliedPathologyPatches.map((p) =>
        p.id === row ? { ...p, protected: true } : p),
      fieldProvenance: {
        ...S().fieldProvenance,
        findings: provenanceFromText(MILD_FINDING, "manual"),
      },
    });

    expect(S().applyPathologyOverlay(
      quickSelectTilePatch(tile("Moderate canal stenosis L4-L5"), "findings"),
    )).toBe("pending");
    const pending = S().pendingPathologyPatch;
    expect(pending).toBeTruthy();
    expect(pending!.vacatedObservationId).toBe(row);
    // The vacated row is still readable — the dialog's "Existing" source.
    const vacated = S().appliedPathologyPatches.find((p) => p.id === row);
    expect(vacated).toBeTruthy();
    expect(vacated!.lastRendered.findings ?? "").toContain("Mild canal stenosis at L4-L5");
    expect(pending!.incoming.findings ?? "").toContain("Moderate canal stenosis at L4-L5");
    // And the hold: the page still says mild, not moderate, while asking.
    required("Mild canal stenosis at L4-L5 without cord compression.");
    forbidden("Moderate canal stenosis at L4-L5.");
    S().cancelOverwrite();
    required("Mild canal stenosis at L4-L5 without cord compression.");
  });
});

describe("Priority 3 — an applied tile may not read blocked when its sentence lives behind a level prefix", () => {
  it("a sentence the engine re-anchored under 'L4-L5:' is present, not blocked", () => {
    const field = [
      "Lumbar vertebral bodies demonstrate normal height and marrow signal.",
      "L4-L5: Facet arthropathy at L4-L5.",
      "Normal lumbar lordosis is maintained.",
    ].join("\n");
    const row = { lastRendered: { findings: "Facet arthropathy at L4-L5." } };
    expect(patchFindingsContributionBlocked(row, field)).toBe(false);
  });

  it("a genuinely absent sentence still reads blocked", () => {
    const field = "Lumbar vertebral bodies demonstrate normal height and marrow signal.";
    const row = { lastRendered: { findings: "Facet arthropathy at L4-L5." } };
    expect(patchFindingsContributionBlocked(row, field)).toBe(true);
  });

  it("a same-slot journey through the real store keeps the applied chip unblocked after the upgrade", () => {
    openStudy(lsCtx());
    click(tile("Mild canal stenosis L4-L5"));
    // Upgrade in place — the row keeps exactly one rendered sentence present.
    const outcome = S().applyPathologyOverlay(
      quickSelectTilePatch(tile("Moderate canal stenosis L4-L5"), "findings"),
    );
    expect(outcome).toBe("applied");
    required("Moderate canal stenosis at L4-L5.");
    forbidden("Mild canal stenosis at L4-L5.");
    const row = S().appliedPathologyPatches.find((p) => p.observation?.concept === "canal_stenosis");
    expect(row).toBeTruthy();
    expect(patchFindingsContributionBlocked(row!, findingsOf())).toBe(false);
  });
});
