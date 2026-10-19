/**
 * impressionReliabilityMatrix.test.ts — Task B: the owner's nine impression
 * reliability requirements, verified as named tests against the live engine.
 *
 * Each test names the requirement it discharges. All of them drive the REAL
 * Mode A entry (`composeInstantReport` — the function the workspace debounce
 * calls) on the real shipped catalogue, including the corrected alignment tile
 * from the owner's 2026-10-19 ruling, which the pre-existing impression suites
 * predate. No AI, no network, no mock beyond the fetch stub every workspace
 * test needs.
 *
 * Neighbouring suites already pin large parts of this territory —
 * impressionCompositionAdversarial (14 journeys), impressionOrdering,
 * manualImpressionNotForcedByBoxClick, quickSelectLsSpineImpressions, and the
 * 13 clinical acceptance journeys. This file is the owner's checklist made
 * executable in one place, on the corrected catalogue, so a review can read
 * requirement → test → verdict without excavating five files.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES, type QuickSelectTile } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext, type ReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";

const LORDOSIS = TILES.find((t) => t.label === "Loss of lumbar lordosis")!;
const BULGE = TILES.find((t) => t.label === "Disc herniation L4-L5")!;
const LF = TILES.find((t) => t.label === "LF hypertrophy L4-L5")!;
const SEVERE_STENOSIS = TILES.find((t) => t.label === "Severe canal stenosis L4-L5")!;
const DESICCATION = TILES.find((t) => t.label === "Disc desiccation L4-L5")!;

for (const tile of [LORDOSIS, BULGE, LF, SEVERE_STENOSIS, DESICCATION]) {
  if (!tile) throw new Error("a required tile is missing from the shipped catalogue");
}

type Ctx = ReturnType<typeof buildReportingStudyContext>;

function resetShell(ctx: Ctx): void {
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
    // Every pass over a study with selections earns entries in this list (a
    // retired normal reads as "the radiologist removed it" until a press clears
    // the memory). The clinic's session accumulates it; a TEST that does not
    // reset it inherits the previous test's removals and measures their state,
    // not this journey's.
    normalLinesRemovedByRadiologist: [],
  });
}

const lsCtx = (): Ctx => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

/** Open through Mode A — the live debounced entry the workspace actually runs. */
function openLumbarStudy(): void {
  const ctx = lsCtx();
  resetShell(ctx);
  const decision = useWorkspace.getState().composeInstantReport(ctx, false);
  expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
}

function click(tile: QuickSelectTile): void {
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(tile, "findings"),
  );
  if (outcome !== "applied") throw new Error(`${tile.label} click was ${outcome}`);
}

/** The row id the Quick Select strip's own deselect path uses. */
function qsRowIdByConcept(concept: string): string {
  const row = useWorkspace.getState().appliedPathologyPatches.find(
    (p) => !p.stale && p.observation?.concept === concept && String(p.id).startsWith("qf-"),
  );
  if (!row) throw new Error(`no clicked Quick Select row for concept ${concept}`);
  return row.id;
}

const S = () => useWorkspace.getState();
const impressionLines = (): string[] =>
  splitToSentences(S().impressionText).map((s) => s.trim()).filter(Boolean);
const impressionKeys = (): string[] =>
  impressionLines().map(normalizeForDedupe).filter(Boolean);
const findingsKeys = (): string[] =>
  splitToSentences(S().findingsText).map(normalizeForDedupe).filter(Boolean);

/** The Mode A pass the debounce runs. */
const recompose = () => S().composeInstantReport(lsCtx(), false);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Task B — the owner's nine impression reliability requirements (review of PR #1077)", () => {
  it("R1 — no pathology selected: the impression is the study's own normal, complete and singular", () => {
    openLumbarStudy();
    const lines = impressionLines();
    expect(lines.length).toBeGreaterThan(0);
    // The approved normal's own conclusion — the format's impression text.
    expect(S().impressionText).toMatch(/Normal MRI of the lumbosacral spine/i);
    // Exactly one statement of it: no duplicated normal lines.
    expect(new Set(impressionKeys()).size).toBe(impressionKeys().length);
    // And no finding vocabulary leaked into a normal study's impression.
    for (const line of lines) {
      expect(line).not.toMatch(/straightening|herniation|hypertroph|stenosis|desiccation/i);
    }
  });

  it("R2 — one abnormality: the impression states it, and drops the normal-study claim", () => {
    openLumbarStudy();
    click(LORDOSIS);
    recompose();
    expect(S().impressionText).toContain("Loss of lumbar lordosis.");
    expect(S().impressionText).not.toMatch(/^Normal MRI of the lumbosacral spine/i);
    // The same journey with a level finding: the impression names level and finding.
    openLumbarStudy();
    click(BULGE);
    recompose();
    expect(S().impressionText).toContain("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(S().impressionText).not.toMatch(/^Normal MRI of the lumbosacral spine/i);
  });

  it("R3 — multiple abnormalities: every selected finding is concluded, in one coherent list", () => {
    openLumbarStudy();
    click(BULGE);
    click(LF);
    click(LORDOSIS);
    recompose();
    const impression = S().impressionText;
    expect(impression).toContain("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(impression).toContain("Ligamentum flavum hypertrophy at L4-L5.");
    expect(impression).toContain("Loss of lumbar lordosis.");
    expect(impression).not.toMatch(/^Normal MRI of the lumbosacral spine/i);
    // Coherent = no line appears twice.
    expect(new Set(impressionKeys()).size).toBe(impressionKeys().length);
  });

  it("R4 — deselection recomputes: the removed finding leaves the impression, the rest stay", () => {
    openLumbarStudy();
    click(BULGE);
    click(LF);
    recompose(); // a pass runs between the click and the deselect — the live journey
    // Deselect the bulge through the strip's own removal path.
    useWorkspace.getState().removeObservation(qsRowIdByConcept("disc_contour"));
    const decision = recompose();
    expect(decision.action).toBe("compose");
    const impression = S().impressionText;
    expect(impression).not.toContain("Disc herniation at L4-L5");
    expect(impression).toContain("Ligamentum flavum hypertrophy at L4-L5.");
    // The retired level normal came back on the page — IN ITS LEVEL BLOCK, not
    // appended at the report tail. Before the canvas-baseline stamp fix the
    // restored sentence landed below L5-S1 (measured 2026-10-19).
    const findings = S().findingsText;
    expect(findings).toContain("L4-L5: No significant disc bulge or protrusion is seen.");
    const restoredAt = findings.indexOf("L4-L5: No significant disc bulge or protrusion is seen.");
    const nextCanonical = findings.indexOf("L4-L5: No spinal canal or thecal sac compression is seen.");
    expect(restoredAt).toBeGreaterThanOrEqual(0);
    expect(nextCanonical).toBeGreaterThan(restoredAt);
    expect(restoredAt, "the restored normal rejoins its level block, not the report tail")
      .toBeLessThan(findings.indexOf("L5-S1: Intervertebral disc signal is preserved."));
    // Deselecting the last abnormality returns the study to its normal claim.
    useWorkspace.getState().removeObservation(qsRowIdByConcept("ligamentum_flavum"));
    recompose();
    expect(S().impressionText).toMatch(/Normal MRI of the lumbosacral spine/i);
  });

  it("R5 — no duplicate impression lines, through click, deselect and recompose cycles", () => {
    openLumbarStudy();
    click(BULGE);
    click(LF);
    recompose();
    recompose(); // a second pass must not stack a second copy
    click(LORDOSIS);
    recompose();
    useWorkspace.getState().removeObservation(qsRowIdByConcept("disc_contour"));
    recompose();
    const keys = impressionKeys();
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes, `duplicated impression lines: ${dupes.join(" | ")}`).toEqual([]);
  });

  it("R6 — no contradictory normal-study impression while any abnormality is selected", () => {
    for (const tile of [LORDOSIS, BULGE, LF, SEVERE_STENOSIS, DESICCATION]) {
      openLumbarStudy();
      click(tile);
      recompose();
      expect(
        S().impressionText,
        `${tile.label} selected: the impression must not call the study normal`,
      ).not.toMatch(/^Normal MRI of the lumbosacral spine/i);
      expect(S().impressionText, `${tile.label} selected: the impression must state the finding`).not.toBe("");
    }
  });

  it("R7 — a hand-written impression is never silently overwritten by an automatic pass", () => {
    openLumbarStudy();
    click(BULGE);
    recompose();
    // The radiologist rewrites the conclusion in his own words.
    useWorkspace.getState().setField("impression", "Impression dictated by the radiologist: chronic L4-L5 disc disease.");
    // A later click and its automatic pass must not touch it.
    click(LF);
    const decision = recompose();
    // Mode A's own contract: a manual impression holds the pass (or passes with
    // the manual text intact); either way the sentence is still there, verbatim.
    expect([ "compose", "hold" ]).toContain(decision.action);
    expect(S().impressionText).toContain("Impression dictated by the radiologist: chronic L4-L5 disc disease.");
  });

  it("R8 — clinical prioritization: the urgent finding leads, minor degeneration trails", () => {
    openLumbarStudy();
    // Click the minor one first, the critical one second — deliberately against
    // the clinical order, so the ordering cannot be click order.
    click(DESICCATION);
    click(SEVERE_STENOSIS);
    recompose();
    const impression = S().impressionText;
    expect(impression).toContain("Severe canal stenosis at L4-L5.");
    expect(impression).toContain("Disc desiccation at L4-L5.");
    const severeAt = impression.indexOf("Severe canal stenosis at L4-L5");
    const desiccAt = impression.indexOf("Disc desiccation at L4-L5");
    expect(severeAt, "the severe stenosis must lead the impression").toBeGreaterThanOrEqual(0);
    expect(desiccAt, "the desiccation must be concluded").toBeGreaterThan(severeAt);
  });

  it("R9 — recommendations stay relevant: shipped advice arrives once, tiles without advice add nothing", () => {
    openLumbarStudy();
    // A tile with shipped advice contributes it exactly once, across passes.
    click(BULGE);
    recompose();
    recompose();
    const rec = S().recommendationText;
    expect(rec).toContain("Conservative management with NSAIDs and physiotherapy.");
    expect(rec.match(/Conservative management with NSAIDs and physiotherapy\./g)?.length ?? 0).toBe(1);
    // A second advised tile adds its own advice beside the first, not boilerplate.
    const SPONDY = TILES.find((t) => t.label === "Grade 1 spondylolisthesis L4-L5")!;
    click(SPONDY);
    recompose();
    expect(S().recommendationText).toContain("Surgical referral if neurological deficits develop.");
    // The corrected alignment tile (owner ruling 2026-10-19) pushes NO routine
    // physiotherapy — the recommendation field stays the doctor's.
    openLumbarStudy();
    click(LORDOSIS);
    recompose();
    expect(S().recommendationText).not.toMatch(/physiotherapy/i);
    expect(S().recommendationText).toMatch(/Clinical correlation/);
  });
});
