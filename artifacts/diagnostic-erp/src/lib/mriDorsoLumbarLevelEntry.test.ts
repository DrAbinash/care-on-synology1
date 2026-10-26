/**
 * mriDorsoLumbarLevelEntry.test.ts — one level-entry point dispatches each
 * domain to its existing regional builder (dorso-lumbar spec §5, §6, §12).
 *
 * The Dorso-Lumbar canvas must reuse the thoracic and lumbar compiling rather
 * than reimplement it, and the dispatcher is the only place that decides which
 * one owns a level. These tests pin the decisions that matter clinically:
 * coverage decides availability, domain decides vocabulary, and the bridge is
 * entered once, under its canonical region, whichever spelling arrived.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildDorsoLumbarLevelEntry,
  dorsoLumbarConusAvailable,
  dorsoLumbarDorsalNumbering,
  dorsoLumbarLevelEntryOptions,
} from "@/lib/mriDorsoLumbarLevelEntry";
import {
  JUNCTION_LEDGER_REGION,
  JUNCTION_LEVEL,
  defaultDorsoLumbarState,
  dorsolumbarLevelKeyStrings,
  type DorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import type { DorsalLevelDetail } from "@/lib/mriDorsalLevelDetail";
import type { LumbarLevelDetail } from "@/lib/mriLumbarLevelDetail";
import { useWorkspace } from "@/lib/zai-workspace/store";

const SYSTEM_NORMAL_PATCH_ID = "system-normal-study";

const dorsalDetail: DorsalLevelDetail = {
  discLocation: "central",
  discSeverity: "moderate",
  cordEffect: "compressed",
};

const lumbarDetail: LumbarLevelDetail = {
  canalMorphology: "cauda_crowding",
};

/** Lumbar-level anatomy that must never be compiled at the bridge. */
const junctionIntruder: LumbarLevelDetail = {
  facet: { arthropathy: true },
};

const sequences = defaultSpineSequences();

function entry(
  level: string,
  over: {
    state?: DorsoLumbarState;
    dorsal?: DorsalLevelDetail;
    lumbar?: LumbarLevelDetail;
  } = {},
) {
  return buildDorsoLumbarLevelEntry({
    level,
    state: over.state ?? defaultDorsoLumbarState({ superior: "T8-T9", inferior: "L5-S1" }),
    sequences,
    dorsal: over.dorsal ?? dorsalDetail,
    lumbar: over.lumbar ?? lumbarDetail,
  });
}

function regionsOf(e: { observations: Array<{ region?: string | null }> }) {
  return [...new Set(e.observations.map((o) => o.region ?? ""))];
}

describe("dispatch by domain", () => {
  it("sends a thoracic level to the dorsal builder", () => {
    const e = entry("T8-T9");
    expect(e.refused).toBe(false);
    expect(e.domain).toBe("thoracic");
    expect(e.detailKind).toBe("dorsal");
    expect(e.neural).toBe("cord");
    expect(e.ledgerRegion).toBe("Dorsal Spine");
    expect(e.bundleId).toBe("spm-dx-detail-D8-D9");
    expect(regionsOf(e)).toEqual(["Dorsal Spine"]);
    expect(e.observations.length).toBeGreaterThan(0);
  });

  it("sends a lumbar level to the lumbar builder", () => {
    const e = entry("L3-L4");
    expect(e.refused).toBe(false);
    expect(e.domain).toBe("lumbar");
    expect(e.detailKind).toBe("lumbar");
    expect(e.neural).toBe("cauda");
    expect(e.ledgerRegion).toBe("LS Spine");
    expect(e.bundleId).toBe("spm-ls-detail-L3-L4");
    expect(regionsOf(e)).toEqual(["LS Spine"]);
  });

  it("enters the bridge once, through the canonical junction region", () => {
    for (const spelling of ["T12-L1", "D12-L1", "L1-T12", "T12 - L1"]) {
      const e = entry(spelling);
      expect(e.level, spelling).toBe(JUNCTION_LEVEL);
      expect(e.domain, spelling).toBe("junction");
      expect(e.ledgerRegion, spelling).toBe(JUNCTION_LEDGER_REGION);
      expect(e.detailKind, spelling).toBe("dorsal");
      expect(e.bundleId, spelling).toBe("spm-dx-detail-D12-L1");
      expect(regionsOf(e), spelling).toEqual([JUNCTION_LEDGER_REGION]);
    }
  });

  it("does not let lumbar vocabulary open a second junction entry", () => {
    const e = buildDorsoLumbarLevelEntry({
      level: "L1-T12",
      state: defaultDorsoLumbarState(),
      sequences,
      dorsal: dorsalDetail,
      lumbar: junctionIntruder,
    });
    expect(e.domain).toBe("junction");
    // Every patch still belongs to the one junction owner…
    expect(regionsOf(e)).toEqual([JUNCTION_LEDGER_REGION]);
    // …and no lumbar concept was compiled into the bundle.
    expect(e.notice).toMatch(/recorded once/);
    expect(e.observations.some((o) => /facet/i.test(o.label ?? ""))).toBe(false);
  });

  it("reports a thoracic form supplied for a lumbar level without compiling it", () => {
    const e = buildDorsoLumbarLevelEntry({
      level: "L4-L5",
      state: defaultDorsoLumbarState(),
      sequences,
      dorsal: dorsalDetail,
      lumbar: lumbarDetail,
    });
    expect(e.detailKind).toBe("lumbar");
    expect(e.notice).toMatch(/Thoracic-only fields/);
    expect(e.observations.every((o) => (o.region ?? "") === "LS Spine")).toBe(true);
  });

  it("names the neural structure the level actually contains", () => {
    const bridged = defaultDorsoLumbarState({ superior: "T10-T11", inferior: "L2-L3" });
    expect(entry("T11-T12", { state: bridged }).neural).toBe("cord");
    expect(entry("T12-L1", { state: bridged }).neural).toBe("conus");
    expect(entry("L1-L2", { state: bridged }).neural).toBe("conus");
    expect(entry("L2-L3", { state: bridged }).neural).toBe("cauda");
  });
});

describe("coverage decides availability", () => {
  it("refuses a level the series never showed", () => {
    const short = defaultDorsoLumbarState({ superior: "T8-T9", inferior: "T11-T12" });
    const e = entry("L4-L5", { state: short });
    expect(e.refused).toBe(true);
    expect(e.observations).toEqual([]);
    expect(e.notice).toMatch(/outside the acquired coverage \(D8-D9 to D11-D12\)/);
  });

  it("refuses the bridge when coverage stops above it", () => {
    const noJunction = defaultDorsoLumbarState({ superior: "T6-T7", inferior: "T11-T12" });
    const e = entry(JUNCTION_LEVEL, { state: noJunction });
    expect(e.refused).toBe(true);
    expect(e.notice).toMatch(/outside the acquired coverage/);
    // and the numbering half it would have used is honest about that
    expect(dorsoLumbarDorsalNumbering(noJunction).coverage).toBe("complete");
    expect(dorsoLumbarConusAvailable(noJunction)).toEqual({
      allowed: false,
      notice: "Recorded coverage does not reach the conus, so conus sentences are omitted.",
    });
  });

  it("refuses a level that is not a spine level at all", () => {
    const e = entry("C5-C6");
    expect(e.refused).toBe(true);
    expect(e.domain).toBeNull();
    expect(e.notice).toMatch(/not a Dorso-Lumbar level/);
  });

  it("refuses an empty form instead of writing an empty observation", () => {
    const e = buildDorsoLumbarLevelEntry({
      level: "T9-T10",
      state: defaultDorsoLumbarState(),
      sequences,
      dorsal: {},
      lumbar: {},
    });
    expect(e.refused).toBe(true);
    expect(e.observations).toEqual([]);
    expect(e.notice).toMatch(/Nothing selected for D9-D10/);
  });
});

describe("the level list the canvas renders", () => {
  it("offers exactly the acquired levels, in order, each with one vocabulary", () => {
    const state = defaultDorsoLumbarState({ superior: "T11-T12", inferior: "L2-L3" });
    const options = dorsoLumbarLevelEntryOptions(state);
    expect(options.map((o) => o.level)).toEqual(dorsolumbarLevelKeyStrings(state));
    expect(options.map((o) => o.level)).toEqual(["D11-D12", JUNCTION_LEVEL, "L1-L2", "L2-L3"]);
    expect(options.filter((o) => o.junction)).toHaveLength(1);
    expect(options.map((o) => o.detailKind)).toEqual(["dorsal", "dorsal", "lumbar", "lumbar"]);
    expect(options.map((o) => o.neural)).toEqual(["cord", "conus", "conus", "cauda"]);
  });

  it("carries transitional lumbar anatomy without moving the bridge", () => {
    const sacralized = defaultDorsoLumbarState({
      superior: "T12-L1",
      inferior: "L5-T",
      lumbar: { ...defaultLumbarNumbering(), mode: "lstv-sacralization", castellvi: "IIa", side: "unilateral" },
    });
    const options = dorsoLumbarLevelEntryOptions(sacralized);
    expect(options.filter((o) => o.junction).map((o) => o.level)).toEqual([JUNCTION_LEVEL]);
    const transitional = options.at(-1)!;
    expect(transitional.level).toBe("L5-T");
    expect(transitional.transitional).toBe(true);
    expect(transitional.detailKind).toBe("lumbar");
    expect(entry("L5-T", { state: sacralized }).ledgerRegion).toBe("LS Spine");
  });

  it("maps a Dorso-Lumbar numbering basis onto the dorsal resolver without inventing certainty", () => {
    expect(dorsoLumbarDorsalNumbering(defaultDorsoLumbarState({ numbering: "localizer-confirmed" })))
      .toMatchObject({ mode: "localizer-confirmed", coverage: "thoracolumbar" });
    // "standard-morphology" has no dorsal equivalent: it is carried as a manual
    // designation, never silently upgraded to localizer-confirmed.
    expect(dorsoLumbarDorsalNumbering(defaultDorsoLumbarState({ numbering: "standard-morphology" })))
      .toMatchObject({ mode: "manual" });
    expect(dorsoLumbarDorsalNumbering(defaultDorsoLumbarState({ numbering: "uncertain" })))
      .toMatchObject({ mode: "uncertain", coverage: "thoracolumbar" });
  });
});

describe("with the ledger boundary", () => {
  beforeEach(() => {
    useWorkspace.setState({
      appliedPathologyPatches: [],
      patchUndoStack: [],
      lastPatchSnapshot: null,
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      fieldProvenance: {},
      canalApProvenance: {},
      studyComposition: "dorsolumbar-dedicated",
      studyCompositionProvenance: "catalog-code",
      studyCompositionOverridden: false,
    });
  });

  it("re-entering the bridge in another spelling replaces it instead of duplicating it", () => {
    const state = defaultDorsoLumbarState();
    const junctionSlots = () => useWorkspace.getState().appliedPathologyPatches
      .filter((p) => p.id !== SYSTEM_NORMAL_PATCH_ID)
      .filter((p) => p.observation?.level === "D12-L1")
      .map((p) => `${p.observation?.region}::${p.observation?.concept}`);

    // Entered from the thoracic form first…
    const first = entry(JUNCTION_LEVEL, { state });
    expect(first.refused).toBe(false);
    useWorkspace.getState().applyMacroBundle({ bundleId: first.bundleId, observations: first.observations });
    const afterFirst = junctionSlots();
    expect(afterFirst.length).toBeGreaterThan(0);
    // …then re-entered with a lumbar-domain spelling and the stored lettering.
    for (const level of ["L1-T12", "D12-L1"]) {
      const again = entry(level, { state });
      expect(again.refused, level).toBe(false);
      expect(again.bundleId, level).toBe(first.bundleId);
      useWorkspace.getState().applyMacroBundle({ bundleId: again.bundleId, observations: again.observations });
    }
    // Same slots, no second identity: a level carries one observation per
    // concept, and every one of them belongs to the canonical junction region.
    expect(junctionSlots()).toEqual(afterFirst);
    expect(new Set(afterFirst.map((s) => s.split("::")[0]))).toEqual(new Set([JUNCTION_LEDGER_REGION]));
  });

  it("keeps thoracic and lumbar level entries in their own regions", () => {
    const state = defaultDorsoLumbarState();
    for (const level of ["T8-T9", JUNCTION_LEVEL, "L3-L4"]) {
      const e = entry(level, { state });
      useWorkspace.getState().applyMacroBundle({ bundleId: e.bundleId, observations: e.observations });
    }
    const rows = useWorkspace.getState().appliedPathologyPatches.filter((p) => p.id !== SYSTEM_NORMAL_PATCH_ID);
    expect(new Set(rows.map((p) => p.observation?.region))).toEqual(new Set(["Dorsal Spine", "LS Spine"]));
    // the bridge never appears under LS Spine
    expect(rows.some((p) => p.observation?.region === "LS Spine" && p.observation?.level === "D12-L1")).toBe(false);
  });
});
