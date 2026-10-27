/**
 * D-27 — laterality deselect boundaries, pinned as contract.
 *
 * Owner ruling (2026-10-19, recorded against the audit finding): left and
 * right of the same concept at the same level are INDEPENDENT clinical
 * observations — opposite laterality never mutexes (observationSlot.ts:
 * `isOppositeLaterality`), so bilateral disease reports as two observations.
 * The deselect boundary follows from that independence: taking one side's
 * observation off the report may never take the other side's contribution
 * with it, may never restore the other side's retired normal over its live
 * finding, and may never delete a manual edit made on the other side.
 *
 * All six cases drive the REAL shipped tile — quick-select-tiles.data.ts:142,
 * "Foraminal stenosis L4-L5", the side-parameterised family — through the
 * same quickSelectTilePatch → applyPathologyOverlay entry the workspace
 * itself uses, with the side supplied exactly as the parameter dialog
 * supplies it. No invented tile text anywhere.
 *
 * All six passed at the reconstruction baseline: this file is a CONTRACT pin,
 * not a defect fix — the independent-observation guarantee was verified to
 * hold, and the owner ruling is documented here so it cannot be tightened
 * into a loss without this suite noticing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./store";
import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "./quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./quickSelectTileFixture";
import {
  DEFAULT_REPORT_FORMATS,
} from "./report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});

/** quick-select-tiles.data.ts:142 — the shipped side-parameterised family. */
const FORAMINAL = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Foraminal stenosis L4-L5")!;
if (!FORAMINAL) throw new Error("the shipped Foraminal stenosis L4-L5 tile is missing");

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;

function resetWorkspace() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    impressionOrderFrozen: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, startingCanvasBaseline: null, appliedFormatName: null,
    appliedFormatReportTitle: null, reportingContext: STUDY_CTX,
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], isFinalized: false,
    coverageMarks: [], coverageByScope: {}, normalLinesRemovedByRadiologist: [],
    selectedObservationId: null, patchUndoStack: [], patchRedoStack: [],
  });
}

function openNormalLsSpine() {
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status).toBe("generated");
}

/** One click on the shipped tile, one side chosen in its parameter dialog. */
function clickSide(side: "left" | "right" | "bilateral") {
  const patch = quickSelectTilePatch(FORAMINAL, "findings", { side, severity: "Moderate" });
  expect(
    useWorkspace.getState().applyPathologyOverlay(patch),
    `${side} click must apply`,
  ).toBe("applied");
  return tileRowId(FORAMINAL, side);
}

beforeEach(resetWorkspace);

describe("D-27 — laterality deselect boundaries (owner ruling, pinned)", () => {
  it("left and right of the same slot coexist as two independent observations", () => {
    openNormalLsSpine();
    clickSide("left");
    clickSide("right");
    const rows = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && String(p.id).startsWith("qf-") && p.observation?.concept === "foraminal_stenosis");
    expect(rows.map((r) => r.observation?.laterality).sort()).toEqual(["left", "right"]);
    expect(lines(findings())).toContain("Moderate left neural foraminal stenosis at L4-L5.");
    expect(lines(findings())).toContain("Moderate right neural foraminal stenosis at L4-L5.");
  });

  it("deselecting the left side leaves the right side's finding and row intact", () => {
    openNormalLsSpine();
    clickSide("left");
    clickSide("right");
    useWorkspace.getState().removeObservation(tileRowId(FORAMINAL, "left"));
    expect(lines(findings()), "the right side's contribution is not taken away")
      .toContain("Moderate right neural foraminal stenosis at L4-L5.");
    expect(lines(findings())).not.toContain("Moderate left neural foraminal stenosis at L4-L5.");
    const surviving = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && String(p.id).startsWith("qf-") && p.observation?.concept === "foraminal_stenosis");
    expect(surviving.map((r) => r.observation?.laterality)).toEqual(["right"]);
  });

  it("a shared normal stays retired while either side is held, and returns only when both are off", () => {
    openNormalLsSpine();
    clickSide("left");
    clickSide("right");
    useWorkspace.getState().removeObservation(tileRowId(FORAMINAL, "right"));
    // The left finding is still selected, so the foramina normal the first
    // click retired stays retired — restoring it would print a normal beside a
    // live finding (suppression is a property of the SURVIVING set, the rule
    // removeObservation itself documents).
    expect(lines(findings()), "the normal stays retired while the left finding holds it")
      .not.toContain("L4-L5: Neural foramina are patent bilaterally.");
    expect(lines(findings())).toContain("Moderate left neural foraminal stenosis at L4-L5.");
    useWorkspace.getState().removeObservation(tileRowId(FORAMINAL, "left"));
    expect(lines(findings()), "with both sides off, the approved normal returns")
      .toContain("L4-L5: Neural foramina are patent bilaterally.");
    expect(lines(findings())).not.toContain("Moderate left neural foraminal stenosis at L4-L5.");
    expect(lines(findings())).not.toContain("Moderate right neural foraminal stenosis at L4-L5.");
  });

  it("click order does not matter: right then left prints the same page", () => {
    const journeys: string[][] = [];
    for (const order of [["left", "right"], ["right", "left"]] as const) {
      resetWorkspace();
      openNormalLsSpine();
      clickSide(order[0]);
      clickSide(order[1]);
      journeys.push(lines(findings()).slice().sort());
    }
    expect(journeys[1], "both click orders must carry the same findings lines").toEqual(journeys[0]);
  });

  it("bilateral and one-sided findings never fold into a single observation", () => {
    openNormalLsSpine();
    clickSide("left");
    clickSide("bilateral");
    // Bilateral mutexes with left (the same slot family, observationSlot.ts),
    // so the bilateral claim replaces the left one — the documented rule —
    // and never collapses the two into one merged wording.
    expect(lines(findings())).toContain("Moderate bilateral neural foraminal stenosis at L4-L5.");
    expect(lines(findings())).not.toContain("Moderate left neural foraminal stenosis at L4-L5.");
    const rows = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && String(p.id).startsWith("qf-") && p.observation?.concept === "foraminal_stenosis");
    expect(rows.map((r) => r.observation?.laterality)).toEqual(["bilateral"]);
  });

  it("a manual edit on the right survives deselecting the left", () => {
    openNormalLsSpine();
    clickSide("left");
    clickSide("right");
    const his = "Right lateral recess is also narrowed, typed by the radiologist.";
    useWorkspace.getState().mergeField("findings", his, "manual");
    useWorkspace.getState().removeObservation(tileRowId(FORAMINAL, "left"));
    expect(lines(findings())).toContain(his);
    expect(impression()).toMatch(/right neural foraminal stenosis/i);
  });
});
