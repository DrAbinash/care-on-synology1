/**
 * mriDorsalNumbering.test.ts — the DorsalLevelResolver (dorsal spec §4, §10, §12).
 *
 * Thoracic safety is a coverage question: the resolver owns the level list, the
 * AP canal rows, the conus availability answer and the numbering caveat, and
 * every consumer must agree with it. These tests fail if any consumer keeps its
 * own level array or if the conus becomes describable outside acquired coverage.
 */

import { describe, expect, it } from "vitest";

import {
  DORSAL_COVERAGE_OPTIONS,
  DORSAL_NUMBERING_MODES,
  conusCovered,
  defaultDorsalNumbering,
  dorsalApCanalLevels,
  dorsalLevelKeyStrings,
  dorsalLevelKeys,
  dorsalNumberingBanner,
  dorsalNumberingCautionSentence,
  dorsalNumberingNeedsConsistencyCheck,
  dorsalObservationReviewWarnings,
  dorsalRootDescription,
  isDefaultDorsalNumbering,
  isDorsalLevelKeyAllowed,
  isJunctionLevelKey,
  junctionCovered,
  type DorsalNumberingState,
} from "@/lib/mriDorsalNumbering";

function state(overrides: Partial<DorsalNumberingState> = {}): DorsalNumberingState {
  return { ...defaultDorsalNumbering(), ...overrides };
}

describe("DorsalLevelResolver — acquired coverage decides the level list", () => {
  it("upper coverage stops before the junction and never offers T12-L1", () => {
    const keys = dorsalLevelKeyStrings(state({ coverage: "upper" }));
    expect(keys).toHaveLength(9);
    expect(keys[0]).toBe("T1-T2");
    expect(keys[keys.length - 1]).toBe("T9-T10");
    expect(keys).not.toContain("T12-L1");
  });

  it("complete coverage reaches T11-T12 but still not the junction", () => {
    const keys = dorsalLevelKeyStrings(state({ coverage: "complete" }));
    expect(keys).toHaveLength(11);
    expect(keys[keys.length - 1]).toBe("T11-T12");
    expect(conusCovered(state({ coverage: "complete" }))).toBe(false);
  });

  it("thoracolumbar coverage adds exactly the T12-L1 junction level", () => {
    const keys = dorsalLevelKeys(state({ coverage: "thoracolumbar" }));
    expect(keys).toHaveLength(12);
    const junction = keys[keys.length - 1]!;
    expect(junction.key).toBe("T12-L1");
    expect(junction.junction).toBe(true);
    expect(isJunctionLevelKey("T12-L1", state({ coverage: "thoracolumbar" }))).toBe(true);
    expect(isJunctionLevelKey("T11-T12", state({ coverage: "thoracolumbar" }))).toBe(false);
    expect(conusCovered(state({ coverage: "thoracolumbar" }))).toBe(true);
    expect(junctionCovered(state({ coverage: "thoracolumbar" }))).toBe(true);
  });

  it("the AP canal table is the same list, not a second array", () => {
    for (const coverage of ["upper", "complete", "thoracolumbar"] as const) {
      const s = state({ coverage });
      expect(dorsalApCanalLevels(s)).toEqual(dorsalLevelKeyStrings(s));
    }
  });

  it("rejects a level key outside the acquired coverage", () => {
    expect(isDorsalLevelKeyAllowed("T8-T9", state({ coverage: "upper" }))).toBe(true);
    expect(isDorsalLevelKeyAllowed("T12-L1", state({ coverage: "upper" }))).toBe(false);
    expect(isDorsalLevelKeyAllowed("T12-L1", state({ coverage: "thoracolumbar" }))).toBe(true);
    expect(isDorsalLevelKeyAllowed("L1-L2", state({ coverage: "thoracolumbar" }))).toBe(false);
    expect(isDorsalLevelKeyAllowed("", state())).toBe(false);
  });

  it("changing coverage flags the affected observations instead of renumbering them", () => {
    const wide = state({ coverage: "thoracolumbar" });
    const narrow = state({ coverage: "upper" });
    const rows = [
      { observation: { level: "D8-D9" } },
      { observation: { level: "D12-L1" } },
      { ownership: { anatomicalSection: "T10-T11" } },
      // Lumbar and free-text sections are not this check's business.
      { observation: { level: "L4-L5" } },
      { ownership: { anatomicalSection: "dorsal spine" } },
    ];
    expect(dorsalObservationReviewWarnings(rows, wide)).toEqual([]);
    const warnings = dorsalObservationReviewWarnings(rows, narrow);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("T12-L1");
    expect(warnings[0]).toMatch(/never renumbers/i);
    expect(warnings[0]).not.toMatch(/L4-L5|dorsal spine/);
  });
});

describe("DorsalLevelResolver — numbering confidence", () => {
  it("lists every supported numbering basis and coverage option", () => {
    expect(DORSAL_NUMBERING_MODES.map((m) => m.id)).toEqual([
      "localizer-confirmed",
      "cervicothoracic-landmark",
      "thoracolumbar-landmark",
      "manual",
      "uncertain",
    ]);
    expect(DORSAL_COVERAGE_OPTIONS).toHaveLength(3);
  });

  it("states the counting basis and the reduced certainty without a localizer", () => {
    const caution = dorsalNumberingCautionSentence(state({ mode: "thoracolumbar-landmark", coverage: "complete" }));
    expect(caution).toContain("last rib-bearing vertebra");
    expect(caution).toContain("reduced certainty");
    expect(caution).toContain("Acquired coverage extends to T11-T12");
  });

  it("says nothing when numbering is localizer-confirmed and coverage is complete to the junction", () => {
    expect(dorsalNumberingCautionSentence(state({
      mode: "localizer-confirmed",
      coverage: "thoracolumbar",
      wholeSpineLocalizer: true,
    }))).toBe("");
  });

  it("keeps an uncertain scheme visible and requires a consistency check", () => {
    const s = state({ mode: "uncertain", coverage: "complete" });
    expect(dorsalNumberingCautionSentence(s)).toContain("uncertain");
    expect(dorsalNumberingNeedsConsistencyCheck(s)).toBe(true);
    expect(dorsalNumberingBanner(s)).toContain("absolute levels require review");
  });

  it("carries the radiologist's own designation wording", () => {
    const s = state({ mode: "manual", designationNote: "lowest rib-bearing vertebra taken as T12", coverage: "complete" });
    expect(dorsalNumberingCautionSentence(s)).toContain("(lowest rib-bearing vertebra taken as T12)");
  });

  it("recognises an untouched default state", () => {
    expect(isDefaultDorsalNumbering(defaultDorsalNumbering())).toBe(true);
    expect(isDefaultDorsalNumbering(state({ coverage: "upper" }))).toBe(false);
    expect(isDefaultDorsalNumbering(state({ wholeSpineLocalizer: true }))).toBe(false);
  });

  it("describes a thoracic root without asserting a root number", () => {
    expect(dorsalRootDescription("T6-T7")).toBe("the intercostal nerve at this level");
    expect(dorsalRootDescription("T11-T12")).toContain("T11 nerve root");
    expect(dorsalRootDescription("L1-L2")).toContain("exiting nerve root");
  });
});
