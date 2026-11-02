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

  it("TEST 6b (Clear Content): the ledger is flagged for refresh, not deleted, and re-applying restores it", () => {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    const patch = clickedTilePatch(infarct, "findings", { side: "right" });
    S().applyPathologyOverlay(patch);
    const rowsBefore = S().appliedPathologyPatches.length;
    S().setField("findings", "");
    // Stale is the ledger's existing "NEEDS REFRESH" state: every row keeps its
    // identity, nothing is thrown away.
    expect(S().appliedPathologyPatches).toHaveLength(rowsBefore);
    expect(S().appliedPathologyPatches.filter((p) => p.stale).length).toBeGreaterThan(0);
    expect(S().appliedPathologyPatches.every((p) => Boolean(p.observation))).toBe(true);
    // The recovery the state names must actually work: re-applying the same box
    // puts the finding back on the ledger as confirmed truth.
    expect(S().applyPathologyOverlay(patch)).toBe("applied");
    expect(partition().confirmed.some((o) => o.concept === "infarct")).toBe(true);
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
   * The `stale` marking `setField` now makes live must be the SAME verdict
   * `hydrateObservationLedger` makes on reopen — otherwise the PR would introduce
   * a second, stricter staleness rule with its own readers (suppression,
   * `inheritedClaims`, the level canvas). This drives both doors on one edit and
   * compares the row-id sets.
   */
  function staleVerdicts(edit: (written: string) => string) {
    openBrainStudy();
    const infarct = tile("Acute infarct (DWI)");
    S().applyPathologyOverlay(clickedTilePatch(infarct, "findings", { side: "right" }));
    const row = S().appliedPathologyPatches.find((p) => p.observation?.concept === "infarct" && !p.stale);
    const written = (row!.lastRendered.findings ?? "").trim();
    // The click already retired the two normals it falsifies — those rows are
    // stale on main too, and are the baseline this comparison must be against.
    const preExisting = S().appliedPathologyPatches.filter((p) => p.stale).map((p) => p.id).sort();
    // The ledger as it would be saved before the edit.
    const wire = S().serializeObservationLedger();

    S().setField("findings", edit(written));
    const live = S().appliedPathologyPatches.filter((p) => p.stale).map((p) => p.id).sort();

    // Reopen: hydrate that pre-edit ledger against the edited narrative.
    const hydrated = S().hydrateObservationLedger(wire);
    expect(hydrated.ok).toBe(true);
    const reopen = S().appliedPathologyPatches.filter((p) => p.stale).map((p) => p.id).sort();
    return {
      live,
      reopen,
      preExisting,
      // The dangerous direction: a row this edit retires that reopen would leave
      // live. Such a row stops being a suppressor (normalSuppression.ts:100) and
      // stops claiming its baseline (observationLedger `inheritedClaims`), so a
      // later door could state a normal the abnormality still falsifies.
      onlyLive: live.filter((id) => !preExisting.includes(id) && !reopen.includes(id)),
      newlyStaled: live.filter((id) => !preExisting.includes(id)).length,
      infarctStale: live.includes(row!.id),
    };
  }

  it("TEST 7b (one rule, two doors): the live stale verdict is never stricter than reopen's", () => {
    // (a) the radiologist deletes the sentence — Clear Content.
    const deleted = staleVerdicts(() => "");
    expect(deleted.newlyStaled).toBeGreaterThan(0);
    expect(deleted.onlyLive).toEqual([]);
    // (b) the radiologist changes the side: the row's own sentence is gone.
    const rewrote = staleVerdicts((w) => w.replace("right MCA", "left MCA"));
    expect(rewrote.infarctStale).toBe(true);
    expect(rewrote.newlyStaled).toBeGreaterThan(0);
    expect(rewrote.onlyLive).toEqual([]);
    // (c) the radiologist EXTENDS the sentence, keeping the tile's wording inside
    // it. Whichever way that one falls, the live door must not retire a row that
    // reopen would leave live.
    const extended = staleVerdicts((w) => `${w.replace(/\.$/, "")} with mild mass effect.`);
    expect(extended.onlyLive).toEqual([]);
    // (d) measured, and deliberately NOT pinned as equality. The two verdicts are
    // the same set except for `baseline:…:infarct`: the click retired it and
    // emptied its `lastRendered`, so reopen's `reconcilePatchAgainstNarrative` has
    // nothing to test and revives it while the live ledger keeps it retired. That
    // revival is main's behaviour and this PR does not touch it. What matters is
    // the direction proved above: `setField` never retires a row reopen would
    // leave live, so no normal loses its suppressor here.
    expect(deleted.preExisting).toEqual(["baseline:mri-brain-standard-normal-r1:infarct"]);
    expect(deleted.live).toContain("baseline:mri-brain-standard-normal-r1:infarct");
    expect(deleted.reopen).not.toContain("baseline:mri-brain-standard-normal-r1:infarct");
    expect(deleted.live.filter((id) => !deleted.reopen.includes(id))).toEqual(deleted.preExisting);
    expect(deleted.reopen.filter((id) => !deleted.live.includes(id))).toEqual([]);
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
