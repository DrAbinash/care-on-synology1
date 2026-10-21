/**
 * Phase 3, item B — "parameterize the spine abnormality tiles."
 *
 * The shipped lumbar strip hard-codes its levels: "Facet arthropathy L4-L5",
 * a mild/moderate/severe canal trio at L4-L5, one bulge at L3-L4, one
 * protrusion at L5-S1. A patient whose facet arthropathy is at L2-L3 had NO
 * tile — the radiologist typed it, and the study-wide facet normal stayed on
 * the page contradicting it.
 *
 * These tests pin the whole parameterization chain at the real store boundary:
 *
 *   · the level grammar — what the chip may answer ("L2-L3" yes, "l4-l5" is
 *     normalised, "banana" refuses the click before any write);
 *   · the parameterized tile at a level NO shipped tile covers — findings,
 *     impression, retirement of the study-wide normal, deselect-restore;
 *   · byte-identity with the shipped family — filling L4-L5 into the
 *     parameterized canal trio reproduces the shipped tile's exact sentence,
 *     so both families share one slot and a severity upgrade works across
 *     them;
 *   · the refusal contract — no level picked means nothing written, ever.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./store";
import { emptyClinicalState } from "./clinicalStateReset";
import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "./quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./quickSelectTileFixture";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import {
  isSuppliedLevel,
  quickSelectParametersIn,
  resolvedQuickSelectLevel,
} from "./quickSelectParameterContract";

const STUDY = "syn-level-1";

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
  const hits = splitToSentences(text).filter((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)).length;
  expect(hits, `REQUIRED "${sentence}" in ${where}`).toBe(1);
}
function forbidden(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  expect(
    splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)),
    `FORBIDDEN "${sentence}" in ${where}`,
  ).toBe(false);
}

const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function openSyntheticStudy() {
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
}

/** A parameterized tile click carrying a chosen level — what the strip sends. */
function clickAt(t: QuickSelectTile, level: string) {
  return S().applyPathologyOverlay(quickSelectTilePatch(t, "findings", { level }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openSyntheticStudy();
});

describe("the level grammar (quickSelectParameterContract)", () => {
  it("accepts the spine levels a radiologist actually writes, and normalises them", () => {
    expect(resolvedQuickSelectLevel("L2-L3")).toBe("L2-L3");
    expect(resolvedQuickSelectLevel("l4-l5")).toBe("L4-L5");
    expect(resolvedQuickSelectLevel(" L5 – S1 ")).toBe("L5-S1");
    expect(resolvedQuickSelectLevel("C5-C6")).toBe("C5-C6");
    expect(resolvedQuickSelectLevel("T12-L1")).toBe("T12-L1");
    expect(resolvedQuickSelectLevel("D8-D9")).toBe("D8-D9");
    expect(resolvedQuickSelectLevel("L1")).toBe("L1");
    expect(resolvedQuickSelectLevel("S2")).toBe("S2");
  });

  it("refuses everything that is not spine anatomy — no guessed level ever writes", () => {
    expect(resolvedQuickSelectLevel("banana")).toBe("");
    expect(resolvedQuickSelectLevel("level 4")).toBe("");
    expect(resolvedQuickSelectLevel("L0")).toBe("");
    expect(resolvedQuickSelectLevel("L99")).toBe("");
    expect(resolvedQuickSelectLevel("C9")).toBe("");
    expect(resolvedQuickSelectLevel("S9")).toBe("");
    expect(resolvedQuickSelectLevel("{level}")).toBe("");
    expect(resolvedQuickSelectLevel("")).toBe("");
    expect(isSuppliedLevel(undefined)).toBe(false);
    expect(isSuppliedLevel("L3-L4")).toBe(true);
  });

  it("the contract recognises {level} as a parameter a click must resolve", () => {
    const names = quickSelectParametersIn("Facet arthropathy at {level}. Also {side} pain.");
    expect(names.has("level")).toBe(true);
    expect(names.has("side")).toBe(true);
    expect(quickSelectParametersIn("Plain sentence with no token.").size).toBe(0);
  });
});

describe("a parameterized facet tile at a level no shipped tile covers", () => {
  it("writes the finding and the conclusion, retires the study-wide facet normal, deselect restores it", () => {
    const decision = S().composeInstantReport(lsCtx(), false);
    expect(decision.action).toBe("compose");
    required("Lumbar facet joints are unremarkable.");

    // L2-L3 — the gap the shipped family left.
    const outcome = clickAt(tile("Facet arthropathy (pick level)"), "L2-L3");
    expect(outcome).toBe("applied");
    required("Facet arthropathy at L2-L3.");
    required("Facet arthropathy at L2-L3.", "impression");
    forbidden("Lumbar facet joints are unremarkable.");
    // Unrelated normals untouched.
    required("Ligamentum flavum is not hypertrophied.");

    // Deselect restores the retired study-wide normal (the #1090 lineage).
    S().removeObservation(tileRowId(tile("Facet arthropathy (pick level)")));
    S().composeInstantReport(lsCtx(), false);
    required("Lumbar facet joints are unremarkable.");
    forbidden("Facet arthropathy at L2-L3.");
  });

  it("shares the shipped family's slot: L4-L5 filled in is byte-identical to the shipped tile", () => {
    S().composeInstantReport(lsCtx(), false);
    expect(clickAt(tile("Facet arthropathy (pick level)"), "L4-L5")).toBe("applied");
    required("Facet arthropathy at L4-L5.");
    // ONE row for the same wording, not two — the shipped tile's click is a
    // noop over this row and the strip shows a single lit chip.
    const rows = S().appliedPathologyPatches.filter(
      (p) => p.lastRendered?.findings?.includes("Facet arthropathy at L4-L5"),
    );
    expect(rows.length).toBe(1);
    expect(S().applyPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"))).toBe("applied");
    const after = S().appliedPathologyPatches.filter(
      (p) => p.lastRendered?.findings?.includes("Facet arthropathy at L4-L5"),
    );
    expect(after.length).toBe(1);
  });

  it("severity chains across the parameterized canal trio, and the lineage restores the level normal", () => {
    S().composeInstantReport(lsCtx(), false);
    expect(clickAt(tile("Mild canal stenosis (pick level)"), "L3-L4")).toBe("applied");
    required("Mild canal stenosis at L3-L4 without cord compression.");
    // The level's own canal normal retired.
    forbidden("L3-L4: No spinal canal or thecal sac compression is seen.");

    // Severity upgrade at the same picked level — same slot, wording replaced.
    const severe = clickAt(tile("Severe canal stenosis (pick level)"), "L3-L4");
    expect(severe).toBe("applied");
    required("Severe canal stenosis at L3-L4 with thecal sac compression.");
    required("Severe canal stenosis at L3-L4.", "impression");
    forbidden("Mild canal stenosis at L3-L4 without cord compression.");

    // Deselect: the slot's own lineage — the LEVEL normal returns, never the
    // intermediate mild wording (C3).
    S().removeObservation(tileRowId(tile("Severe canal stenosis (pick level)")));
    S().composeInstantReport(lsCtx(), false);
    required("L3-L4: No spinal canal or thecal sac compression is seen.");
    forbidden("Mild canal stenosis at L3-L4 without cord compression.");
    forbidden("Severe canal stenosis at L3-L4 with thecal sac compression.");
  });

  it("an unresolved level refuses the click and writes nothing — same contract as side and severity", () => {
    S().composeInstantReport(lsCtx(), false);
    const before = { findings: findingsOf(), impression: impressionOf(), rows: S().appliedPathologyPatches.length };
    expect(clickAt(tile("Facet arthropathy (pick level)"), "")).toBe("refused");
    expect(clickAt(tile("Facet arthropathy (pick level)"), "banana")).toBe("refused");
    expect(clickAt(tile("Facet arthropathy (pick level)"), "not a level")).toBe("refused");
    expect(findingsOf()).toBe(before.findings);
    expect(impressionOf()).toBe(before.impression);
    expect(S().appliedPathologyPatches.length).toBe(before.rows);
    // And the retired-preview agrees (Phase 3 item C reads the same guard).
    expect(S().previewPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy (pick level)"), "findings")).refusal)
      .toContain("level");
  });

  it("the level reaches the ledger row's observation, so ownership stays level-scoped", () => {
    S().composeInstantReport(lsCtx(), false);
    clickAt(tile("LF hypertrophy (pick level)"), "L2-L3");
    // By the rendered prose — the ledger also holds the scaffold's baseline
    // row for the same concept, and it must NOT be the row this finds.
    const row = S().appliedPathologyPatches.find(
      (p) => p.lastRendered?.findings?.includes("Ligamentum flavum hypertrophy at L2-L3"),
    );
    expect(row?.observation?.level).toBe("L2-L3");
    required("Ligamentum flavum hypertrophy at L2-L3.");
  });

  it("cervical parameterized tiles answer the cervical strip's own levels", () => {
    useWorkspace.setState({
      reportingContext: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI Cervical Spine Plain", regions: ["Cervical Spine"], source: "auto",
      }),
    } as never);
    expect(S().composeInstantReport(useWorkspace.getState().reportingContext, false).action).toBe("compose")
      .catch?.(() => undefined);
    const outcome = clickAt(tile("Severe central canal stenosis (pick level)"), "C3-C4");
    expect(outcome).toBe("applied");
    required("Severe central canal stenosis at C3-C4.");
    required("Severe canal stenosis at C3-C4.", "impression");
  });
});

/** The strip collects the level through the same chip row as side/severity. */
describe("the strip wiring (source contract)", () => {
  it("renders a level input when a visible box asks for {level} and passes it on the toggle", () => {
    const source = readSource("../../components/radiology/zai-workspace/quick-select-strip.tsx");
    expect(source).toMatch(/qs-level-input/);
    expect(source).toMatch(/STANDARD_SPINE_LEVELS/);
    expect(source).toMatch(/level: qsLevel/);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}
