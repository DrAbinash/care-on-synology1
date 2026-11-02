/**
 * PR 1 — Clinical state safety: a normal template is a starting document, not
 * evidence that the patient's anatomy has been reviewed.
 *
 * The owner's Phase 1 finding, measured live on a real MRI brain study on
 * 2026-11-02: opening the examination auto-inserted 12 normal statements, every
 * one of them reached the AI under "CONFIRMED OBSERVATIONS — from the canonical
 * ledger" / "RADIOLOGIST OBSERVATIONS (canonical clinical truth)", and neither
 * Clear Content nor Undo took them out of the set the composer sends.
 *
 * The provenance itself is NOT missing — `materializeFormatBaseline` already
 * stamps each scaffold row with `role: "baseline"` (or `"screening"`) and
 * `source: "template" | "system"`, and four other modules already branch on that
 * role (`clinicalSelection/normalSuppression.ts`, `conceptCanon/normalImpression.ts`,
 * `conceptCanon/contentPacks.ts`). It is destroyed at the composer boundary:
 * `mapInsertSourceToComposeSource` folds every template origin into
 * `"structured"` and the `ComposeObservation` contract carries no role at all.
 *
 * These tests drive the real doors — Mode A `composeInstantReport`, the Quick
 * Select click payload builder, `setField` as Clear Content performs it, the real
 * ledger serialize/hydrate pair — and never hand-build a composer payload.
 */
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "@/lib/zai-workspace/quick-select-library";
import { clickedTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { buildLumbarLevelApplyBundle } from "@/lib/mriLumbarLevelState";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";
import {
  deriveComposeObservations,
  isProvisionalNormalTemplate,
  mapInsertSourceToComposeSource,
} from "@/lib/reportComposer/composeObservations";
import {
  canonicalObservationHashPayload as clientHashPayload,
  computeSnapshotHashes,
  type ComposeObservation,
} from "@/lib/reportComposer/types";
import {
  canonicalObservationHashPayload as serverHashPayload,
  computeSnapshotHashes as serverComputeSnapshotHashes,
} from "../../../../api-server/src/lib/reportComposer/snapshot";
import { isProvisionalNormalTemplate as serverIsProvisional } from "../../../../api-server/src/lib/reportComposer/types";
import { buildComposerInputPreview } from "@/lib/reportComposer/composerInputPreview";

const S = () => useWorkspace.getState();
const brainCtx = (): ReportingStudyContext => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
});
const lsCtx = (): ReportingStudyContext => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function tile(label: string) {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

function resetShell(ctx: ReportingStudyContext): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: FORMATS,
    reportingContext: ctx,
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
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
}

/** Open the examination the way the workspace opens it: the Mode A auto pass. */
function openBrainStudy(): ReportingStudyContext {
  const ctx = brainCtx();
  resetShell(ctx);
  const decision = S().composeInstantReport(ctx, false);
  expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
  return ctx;
}

const scaffoldSentences = () =>
  S().appliedPathologyPatches.filter((p) => p.observation?.role === "baseline" && !p.stale)
    .map((p) => (p.lastRendered.findings ?? p.templates.findings ?? "").trim())
    .filter(Boolean);

/** The rows the composer would send, split the way the AI must see them. */
function partition() {
  const all = deriveComposeObservations(S().appliedPathologyPatches);
  return {
    all,
    provisional: all.filter(isProvisionalNormalTemplate),
    confirmed: all.filter((o) => !isProvisionalNormalTemplate(o)),
  };
}

describe("PR 1 — normal-template provenance at the composer boundary", () => {
  it("TEST 1 (open study): the auto pass writes the complete normal, and the ledger already knows it is a template", () => {
    openBrainStudy();
    // Control for the whole file — and the owner's "do not replace the normal
    // template with a blank report": the Zero-Click Read Loop must still produce
    // the full anatomy.
    const scaffold = scaffoldSentences();
    expect(scaffold.length).toBeGreaterThanOrEqual(10);
    expect(S().findingsText).toContain("Ventricular system and cisternal spaces are normal");
    // The producer stamps provenance already. If this ever stops being true the
    // boundary fix has nothing to carry and this suite is the alarm.
    expect(S().appliedPathologyPatches.every((p) => Boolean(p.observation?.role))).toBe(true);
  });

  it("TEST 1 (open study): no auto-inserted normal leaves the adapter as a confirmed observation", () => {
    openBrainStudy();
    const { all, provisional, confirmed } = partition();
    // Red on main: every scaffold row is emitted as a plain observation with no
    // role and `source: "structured"`, so all twelve land in the confirmed set.
    expect(all.length).toBeGreaterThan(0);
    expect(provisional.length).toBe(all.filter((o) => o.role === "baseline").length);
    expect(confirmed.some((o) => o.role === "baseline")).toBe(false);
    expect(confirmed).toHaveLength(0);
  });

  it("TEST 2 (adapter): a scaffold row carries its role and an honest origin, not \"structured\"", () => {
    openBrainStudy();
    const row = deriveComposeObservations(S().appliedPathologyPatches).find((o) => o.role === "baseline");
    expect(row, "the composer contract carries no role at all").toBeDefined();
    expect(row?.source).toBe("normal-template");
    expect(mapInsertSourceToComposeSource("template")).toBe("normal-template");
    expect(mapInsertSourceToComposeSource("system")).toBe("normal-template");
    expect(mapInsertSourceToComposeSource("quick-normal")).toBe("normal-template");
    // An AI suggestion is not a structured catalogue entry either.
    expect(mapInsertSourceToComposeSource("ai-draft")).toBe("ai-draft");
    // …but the structured-template family is NOT a normal template. The MRI level
    // canvas writes every row with this source, including a real disc bulge and a
    // real canal stenosis, so widening this arm would reclassify picked
    // abnormalities as unreviewed scaffolding. Their `role` decides.
    expect(mapInsertSourceToComposeSource("structured-template")).toBe("structured");
    expect(mapInsertSourceToComposeSource("protocol")).toBe("structured");
    const canvas = S().appliedPathologyPatches.filter((p) => p.source === "structured-template");
    expect(canvas.every((p) => p.observation?.role !== "baseline")).toBe(true);
  });

  it("TEST 2b (level canvas): a structured-template abnormality is never provisional", () => {
    openBrainStudy();
    const bundle = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      sel: { morphology: "bulge", canal: "mild" },
      region: "LS Spine",
      bundleId: "provenance-canvas-1",
    });
    resetShell(lsCtx());
    S().applyMacroBundle({ bundleId: bundle.bundleId, observations: bundle.observations });
    const { provisional, confirmed } = partition();
    expect(confirmed.length).toBeGreaterThan(0);
    expect(provisional.every((o) => o.source !== "structured-template")).toBe(true);
    expect(confirmed.some((o) => o.concept === "disc_contour")).toBe(true);
  });

  it("TEST 3 (add abnormality): the clicked tile is confirmed truth and the normal it falsifies is not", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    expect(S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }))).toBe("applied");
    const { confirmed, provisional } = partition();
    const texts = confirmed.map((o) => normalizeForDedupe(o.findingsText));
    expect(texts.some((t) => t.includes(normalizeForDedupe("Restricted diffusion in the right MCA territory")))).toBe(true);
    // The scaffold sentence this abnormality falsifies must not stand beside it as
    // a confirmed observation (the owner's positive-to-negative check).
    expect(texts.some((t) => t.includes("no restricted diffusion on dwi/adc")
      || t.includes("no acute infarct, hemorrhage, or mass lesion"))).toBe(false);
    expect(provisional.length).toBeGreaterThan(0);
  });

  it("TEST 4 (deselect abnormality): the restored normal comes back provisional, never confirmed", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    const row = S().appliedPathologyPatches.find((p) => !p.stale && p.observation?.concept === "infarct");
    expect(row, "the click wrote no live row").toBeDefined();
    expect(S().removeObservation(row!.id)).toBe("removed");
    const { confirmed } = partition();
    expect(confirmed.some((o) => normalizeForDedupe(o.findingsText).includes("restricted diffusion in the right mca"))).toBe(false);
    // A restored normal is still a template statement the radiologist has not reviewed.
    expect(confirmed.every((o) => o.role !== "baseline")).toBe(true);
  });

  it("TEST 5 (undo): stepping back leaves no stale observation behind", () => {
    openBrainStudy();
    const before = S().appliedPathologyPatches.length;
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    expect(S().appliedPathologyPatches.length).toBeGreaterThan(before);
    expect(S().undoLastPatch()).toBe(true);
    const { confirmed } = partition();
    expect(S().appliedPathologyPatches.filter((p) => p.stale)).toHaveLength(0);
    expect(confirmed.some((o) => normalizeForDedupe(o.findingsText).includes("restricted diffusion in the right mca"))).toBe(false);
    // Undo restores the normal scaffold it was sitting on — it does not blank it.
    expect(scaffoldSentences().length).toBeGreaterThanOrEqual(10);
  });

  it("TEST 6 (Clear Content): a row whose prose the radiologist deleted stops being claimed as truth", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    // Exactly what the Clear Content button does (findings-editor.tsx: onClear).
    S().setField("findings", "");
    const { confirmed } = partition();
    // `setField` marked the orphaned row `protected` and left it LIVE, so the
    // composer still sent the deleted sentence as a confirmed observation.
    expect(confirmed.filter((o) => normalizeForDedupe(o.findingsText).includes("restricted diffusion in the right mca")))
      .toHaveLength(0);
    // The same verdict applies to the scaffold it also orphaned: a cleared page
    // has no reviewed normals either, so the composer gets no findings rows at all.
    expect(partition().all.filter((o) => o.findingsText.trim())).toHaveLength(0);
  });

  it("TEST 6b (Clear Content): the row's WORDING is retired, its CLAIM is not", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    const patch = clickedTilePatch(infarct, "findings", { side: "right" });
    S().applyPathologyOverlay(patch);
    const rowsBefore = S().appliedPathologyPatches.length;
    S().setField("findings", "");
    // Nothing is deleted from the ledger.
    expect(S().appliedPathologyPatches).toHaveLength(rowsBefore);
    const row = S().appliedPathologyPatches.find((p) => p.observation?.concept === "infarct" && !p.stale);
    expect(row, "the click wrote no live row").toBeDefined();
    expect(row?.protected, "main already protected a row whose prose moved").toBe(true);
    expect(row?.narrativeOrphan, "the composer must not send wording the doctor overwrote").toBe(true);
    // THE POINT OF THE SEPARATE FIELD. `stale` is a clinical verdict with readers
    // outside the composer — normalSuppression treats a stale row as a withdrawn
    // claim, so retiring these rows made the infarct stop falsifying "No
    // restricted diffusion on DWI/ADC." and re-clicking a normal tile printed that
    // denial back over the doctor's own finding.
    expect(row.stale ?? false).toBe(false);
    expect(S().appliedPathologyPatches.filter((p) => p.stale).map((p) => p.id).sort())
      .toEqual(["baseline:mri-brain-standard-normal-r1:infarct"]);
    // The wording the doctor overwrote is gone from the projection, and the rest
    // of the ledger is exactly the state main would have left it in.
    expect(partition().all.some((o) => normalizeForDedupe(o.findingsText).includes("restricted diffusion in the right mca"))).toBe(false);
    expect(S().appliedPathologyPatches.filter((p) => p.narrativeOrphan).length).toBeGreaterThan(0);
  });

  it("TEST 7 (manual edit): the edited sentence is not re-sent in its old wording", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    const row = S().appliedPathologyPatches.find((p) => p.observation?.concept === "infarct" && !p.stale);
    expect(row, "the click wrote no row to edit").toBeDefined();
    const written = (row!.lastRendered.findings ?? "").trim();
    expect(written.length).toBeGreaterThan(0);
    const edited = S().findingsText.replace(written, "Restricted diffusion in the left MCA territory.");
    expect(edited).not.toBe(S().findingsText);
    S().setField("findings", edited);
    const { confirmed } = partition();
    expect(confirmed.some((o) => o.findingsText.includes("right MCA"))).toBe(false);
    // The radiologist's own text is still the report, word for word.
    expect(S().findingsText).toContain("left MCA territory");
  });

  /**
   * A hand-edit of Findings must retire WORDING (what the composer may claim) and
   * nothing else. The ledger's clinical verdict — which rows are `stale` — has to
   * come back identical, because every reader of `stale` treats it as a WITHDRAWN
   * claim, and a withdrawn claim stops falsifying the normal it contradicted.
   * That is exactly the property the four suites this PR first broke
   * (`withheldNormalClaims`, `normalReplacement` x2, `generateProfessionalReport`)
   * depends on.
   */
  function editVerdicts(edit: (written: string) => string) {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    const row = S().appliedPathologyPatches.find((p) => p.observation?.concept === "infarct" && !p.stale);
    const written = (row!.lastRendered.findings ?? "").trim();
    // The click already retired the normals it falsifies; those rows are stale on
    // main too, and are the verdict this comparison must leave untouched.
    const staleBefore = S().appliedPathologyPatches.filter((p) => p.stale).map((p) => p.id).sort();

    S().setField("findings", edit(written));
    return {
      staleAfter: S().appliedPathologyPatches.filter((p) => p.stale).map((p) => p.id).sort(),
      staleBefore,
      orphaned: S().appliedPathologyPatches.filter((p) => p.narrativeOrphan).map((p) => p.id),
      sent: partition().all.map((o) => normalizeForDedupe(o.findingsText)),
      infarctId: row!.id,
      written,
    };
  }

  it("TEST 7b (wording, not the claim): a hand-edit retires no ledger verdict", () => {
    for (const [name, edit] of [
      ["cleared", () => ""],
      ["side rewritten", (w: string) => w.replace("right MCA", "left MCA")],
      ["sentence extended", (w: string) => `${w.replace(/\.$/, "")} with mild mass effect.`],
    ] as Array<[string, (w: string) => string]>) {
      const v = editVerdicts(edit);
      // (a) no row becomes stale because the doctor typed in the Findings box.
      expect(v.staleAfter, name).toEqual(v.staleBefore);
      // (b) the wording he overwrote leaves the AI's view.
      expect(v.orphaned, name).toContain(v.infarctId);
      expect(v.sent.filter((t) => t.includes(normalizeForDedupe(v.written))), name).toEqual([]);
    }
  });

  it("TEST 8 (save / reopen): provenance survives the round trip", () => {
    openBrainStudy();
    const s = S();
    const wire = S().serializeObservationLedger();
    // A reopen restores the narrative AND the ledger together; hydrating against an
    // empty page would mark every row stale on purpose, which is a different test.
    const narrative = {
      findingsText: s.findingsText,
      impressionText: s.impressionText,
      recommendationText: s.recommendationText,
      techniqueText: s.techniqueText,
      clinicalHistoryText: s.clinicalHistoryText,
    };
    resetShell(brainCtx());
    useWorkspace.setState(narrative);
    const hydrated = S().hydrateObservationLedger(wire);
    expect(hydrated.ok).toBe(true);
    expect(hydrated.patchCount).toBeGreaterThan(0);
    const { all } = partition();
    expect(all.some((o) => o.role === "baseline"), "role did not survive the ledger round trip").toBe(true);
    expect(all.every((o) => Boolean(o.role))).toBe(true);
  });

  /**
   * `narrativeOrphan` is session state, exactly like `stale`, so what has to hold
   * across a save/reopen is the VERDICT, not the flag. Measured here: reopen's
   * existing `reconcilePatchAgainstNarrative` re-derives the edited row as `stale`
   * (its `lastRendered.findings` is no longer on the page), so the wording the
   * radiologist replaced never returns to the composer. Same outcome, older
   * mechanism — and it is the mechanism that also drops the row's own claim from
   * the confirmed set, which is main's behaviour for any hand-edit of a tile
   * sentence and is left alone here.
   */
  it("TEST 8b (save / reopen after a hand-edit): the overwritten wording stays out", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    const row = S().appliedPathologyPatches.find((p) => p.observation?.concept === "infarct" && !p.stale);
    const written = (row!.lastRendered.findings ?? "").trim();
    expect(written).toContain("right MCA");
    S().setField("findings", written.replace("right MCA", "left MCA"));
    expect(partition().all.some((o) => o.findingsText.includes("right MCA"))).toBe(false);

    const wire = S().serializeObservationLedger();
    const narrative = {
      findingsText: S().findingsText,
      impressionText: S().impressionText,
      recommendationText: S().recommendationText,
      techniqueText: S().techniqueText,
      clinicalHistoryText: S().clinicalHistoryText,
    };
    resetShell(brainCtx());
    useWorkspace.setState(narrative);
    expect(S().hydrateObservationLedger(wire).ok).toBe(true);

    expect(S().findingsText).toContain("left MCA");
    // Either way the deleted wording is not sent — nothing in the projection
    // carries the right side the doctor overwrote.
    expect(partition().all.some((o) => o.findingsText.includes("right MCA"))).toBe(false);
    // …and the mechanism is reopen's own: the edited row comes back stale, not orphaned.
    const reopened = S().appliedPathologyPatches.find((p) => p.id === row!.id);
    expect(reopened?.stale, "reopen did not re-derive the edited row as withdrawn").toBe(true);
    expect(reopened?.narrativeOrphan ?? false, "the session flag must not pretend to persist").toBe(false);
  });

  it("TEST 9 (laterality): a right-sided finding never becomes a left-sided one", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    const row = partition().confirmed.find((o) => o.concept === "infarct");
    expect(row?.laterality).toBe("right");
  });

  it("TEST 10 (cross-patient leakage): opening a second study carries no scaffold from the first", () => {
    openBrainStudy();
    const brainRows = S().appliedPathologyPatches.length;
    expect(brainRows).toBeGreaterThan(0);
    const ctx = lsCtx();
    resetShell(ctx);
    expect(S().appliedPathologyPatches).toHaveLength(0);
    expect(deriveComposeObservations(S().appliedPathologyPatches)).toHaveLength(0);
    S().applyFormatById(FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!.id);
    const { confirmed } = partition();
    expect(confirmed).toHaveLength(0);
    expect(S().findingsText).not.toContain("Ventricular system and cisternal spaces are normal");
  });

  it("TEST 11 (preview): the radiologist is told which statements are template scaffolding", async () => {
    openBrainStudy();
    const s = S();
    const snapshot = {
      studyId: 101, worklistId: 201, reportId: null,
      modality: "MR", region: s.reportingContext?.region, regions: s.reportingContext?.regions,
      bodyPart: s.reportingContext?.bodyPart, family: s.reportingContext?.family,
      spineSegment: s.reportingContext?.spineSegment, studyType: s.reportingContext?.studyDescription,
      reportTitle: s.appliedFormatReportTitle ?? undefined,
      clinicalHistory: s.clinicalHistoryText, technique: s.techniqueText,
      findings: s.findingsText, impression: s.impressionText, recommendation: s.recommendationText,
      observations: deriveComposeObservations(s.appliedPathologyPatches),
      jobKindHint: "FULL_REPORT", aiMode: "TEXT_ONLY", selectedKeyImages: [],
    } as never;
    const preview = buildComposerInputPreview(snapshot, await computeSnapshotHashes(snapshot));
    expect(preview.text).not.toMatch(/CONFIRMED OBSERVATIONS/);
    expect(preview.text).toMatch(/RADIOLOGIST OBSERVATIONS \(0\)/);
    expect(preview.text).toMatch(/PROVISIONAL NORMAL-TEMPLATE SENTENCES \(1[0-9]\)/);
    // The headline count means "what you confirmed", so an unread normal report
    // shows zero rather than twelve findings nobody reviewed.
    expect(preview.observationCount).toBe(0);
    expect(preview.provisionalCount).toBeGreaterThanOrEqual(10);
  });

  it("TEST 12 (hash stability): provenance must not invalidate a frozen AI input", async () => {
    const base: ComposeObservation = {
      concept: "ventricles", findingsText: "Ventricular system is normal in size.", region: "Brain",
    };
    const withRole: ComposeObservation = { ...base, role: "baseline", source: "normal-template" };
    expect(clientHashPayload(base)).toBe(clientHashPayload(withRole));
    expect(serverHashPayload(base)).toBe(serverHashPayload(withRole));
    // Both halves of provenance are hash-inert, not just `role`: an honest
    // `source` correction must never invalidate a READY draft and make the
    // radiologist's own report look stale on arrival.
    expect(clientHashPayload({ ...base, source: "structured" })).toBe(clientHashPayload({ ...base, source: "ai-draft" }));
    expect(serverHashPayload({ ...base, source: "structured" })).toBe(serverHashPayload({ ...base, source: "ai-draft" }));
    // The two mirrors still agree field-for-field.
    expect(clientHashPayload(withRole)).toBe(serverHashPayload(withRole));
    const snapshot = {
      modality: "MR", region: "Brain", findings: "x", impression: "y", technique: "z",
      observations: [base],
    } as never;
    const moved = { ...snapshot, observations: [withRole] } as never;
    expect((await computeSnapshotHashes(snapshot)).inputHash)
      .toBe((await computeSnapshotHashes(moved)).inputHash);
    expect((await serverComputeSnapshotHashes(snapshot)).inputHash)
      .toBe((await serverComputeSnapshotHashes(moved)).inputHash);
  });

  it("TEST 13 (mirror): the client and server agree on what counts as provisional", () => {
    for (const probe of [
      { concept: "a", findingsText: "Normal.", role: "baseline" },
      { concept: "a", findingsText: "Normal.", role: "screening" },
      { concept: "a", findingsText: "Normal.", source: "normal-template" },
      { concept: "a", findingsText: "Normal.", role: "finding", source: "quick-select" },
      { concept: "a", findingsText: "Normal.", role: "finding", source: "manual" },
      { concept: "a", findingsText: "Normal.", source: "ai-draft" },
      { concept: "a", findingsText: "Normal." },
    ] as ComposeObservation[]) {
      expect(isProvisionalNormalTemplate(probe), `client ${JSON.stringify(probe)}`)
        .toBe(serverIsProvisional(probe));
    }
    expect(isProvisionalNormalTemplate({ concept: "a", findingsText: "Normal.", role: "baseline" } as ComposeObservation)).toBe(true);
    expect(isProvisionalNormalTemplate({ concept: "a", findingsText: "Normal.", role: "finding", source: "manual" } as ComposeObservation)).toBe(false);
  });
});
