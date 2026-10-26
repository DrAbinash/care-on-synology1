/**
 * P1-a from the 20-case rendered audit (2026-10-26) — the per-level canal normal
 * survived beside the very tile that contradicts it.
 *
 * The audit's L2: a study composed from "MRI LS Spine — Standard Normal" (the
 * owned baseline whose per-level scaffold carries "L4-L5: No spinal canal or
 * thecal sac compression is seen.") then clicked the shipped "Disc herniation
 * L4-L5" box — whose prose asserts "indentation on the thecal sac" — printed
 * both sentences side by side: the report denies at L4-L5 exactly what it
 * describes there. Measured on main by this file's harness: the click retires
 * the L4-L5 DISC-CONTOUR row (the concept arm, correctly level-scoped) but the
 * canal row survives at every level, because the box declares concept
 * `disc_contour` — not `canal_stenosis` — and no `baselineReplaces` names the
 * canal sentence. The cervical strip already solved this exact shape the other
 * way round: its "Cord compression C5-C6" box declares
 * `baselineReplaces: "C5-C6: No spinal canal or thecal sac compression is
 * seen."` (quick-select-tiles.data.ts, the cord-compression box). This file
 * pins the same contract for the two LS boxes whose prose indents the thecal
 * sac: "Disc herniation L4-L5" and "Disc protrusion L5-S1".
 *
 * Environment honesty: store boundary only (no browser in this container),
 * same controlled-synthetic harness as quickSelectRetirementPreview.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";

const STUDY = "syn-canal-retirement-1";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();

const LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;
const canalRow = (lvl: string) => `${lvl}: No spinal canal or thecal sac compression is seen.`;
const discRow = (lvl: string) => `${lvl}: No significant disc bulge or protrusion is seen.`;
const foraminaRow = (lvl: string) => `${lvl}: Neural foramina are patent bilaterally.`;

const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

/** The audit's vehicle: the owned LS baseline with the per-level scaffold. */
function openStandardNormalStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: lsCtx(),
    studies: [{ id: STUDY, patient: { name: "SYNTHETIC PATIENT", sex: "M" }, modality: "MR" }],
    activeStudyId: STUDY,
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
  const fmt = DEFAULT_REPORT_FORMATS
    .find((f) => f.name.includes("LS Spine") && f.name.includes("Standard Normal"));
  if (!fmt) throw new Error("no MRI LS Spine Standard Normal format");
  S().applyFormatById(fmt.id);
  for (const lvl of LEVELS) {
    if (!S().findingsText.includes(canalRow(lvl))) {
      throw new Error(`scaffold missing canal row for ${lvl}`);
    }
  }
}

function click(t: QuickSelectTile) {
  const outcome = S().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openStandardNormalStudy();
});

describe("a box that indents the thecal sac retires the canal normal at that level", () => {
  it("Disc herniation L4-L5 removes the L4-L5 canal normal — the page cannot deny what it describes", () => {
    click(tile("Disc herniation L4-L5"));
    expect(S().findingsText).toContain("indentation on the thecal sac");
    expect(S().findingsText).not.toContain(canalRow("L4-L5"));
    // The same tile's prose also narrows the bilateral foramina, so the
    // patent-foramina row at that level is the same denial.
    expect(S().findingsText).not.toContain(foraminaRow("L4-L5"));
    for (const lvl of LEVELS) {
      if (lvl === "L4-L5") continue;
      expect(S().findingsText, `${lvl} foramina normal must survive`).toContain(foraminaRow(lvl));
    }
  });

  it("Disc herniation L4-L5 retires no other level's canal normal", () => {
    click(tile("Disc herniation L4-L5"));
    for (const lvl of LEVELS) {
      if (lvl === "L4-L5") continue;
      expect(S().findingsText, `${lvl} canal normal must survive`).toContain(canalRow(lvl));
    }
  });

  it("Disc protrusion L5-S1 removes the L5-S1 canal normal and no other level's", () => {
    click(tile("Disc protrusion L5-S1"));
    expect(S().findingsText).toContain("indenting the thecal sac");
    expect(S().findingsText).not.toContain(canalRow("L5-S1"));
    for (const lvl of LEVELS) {
      if (lvl === "L5-S1") continue;
      expect(S().findingsText, `${lvl} canal normal must survive`).toContain(canalRow(lvl));
    }
  });

  it("Severe canal stenosis L4-L5 still retires the canal normal via its concept (control)", () => {
    click(tile("Severe canal stenosis L4-L5"));
    expect(S().findingsText).not.toContain(canalRow("L4-L5"));
    expect(S().findingsText).toContain(canalRow("L3-L4"));
  });

  it("deselecting Disc herniation L4-L5 restores the retired canal normal", () => {
    click(tile("Disc herniation L4-L5"));
    expect(S().findingsText).not.toContain(canalRow("L4-L5"));
    expect(S().removeObservation(tileRowId(tile("Disc herniation L4-L5")))).toBe("removed");
    expect(S().findingsText).toContain(canalRow("L4-L5"));
    expect(S().findingsText).not.toContain("indentation on the thecal sac");
  });
});
