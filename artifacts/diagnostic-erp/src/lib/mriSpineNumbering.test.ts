import { describe, expect, it } from "vitest";

import {
  CASTELLVI_OPTIONS,
  LUMBAR_NUMBERING_MODES,
  defaultLumbarNumbering,
  isLevelKeyAllowed,
  isNonStandardNumbering,
  isTransitionalLevelKey,
  lstvDescriptionPhrase,
  lumbarApCanalLevels,
  lumbarLevelKeyStrings,
  lumbarLevelKeys,
  lumbarRootConflictGroup,
  lumbarRootSuggestion,
  numberingBanner,
  numberingCautionSentence,
} from "./mriSpineNumbering";

describe("LumbarNumberingResolver (spec §5)", () => {
  it("keeps the five conventional levels in standard numbering", () => {
    const n = defaultLumbarNumbering();
    expect(lumbarLevelKeyStrings(n)).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    expect(isNonStandardNumbering(n)).toBe(false);
    expect(numberingBanner(n)).toBeNull();
    expect(numberingCautionSentence(n)).toBe("");
  });

  it("derives sacralization levels instead of assuming the lowest mobile segment is L5-S1", () => {
    const n = { mode: "lstv-sacralization", castellvi: "IIa", side: "unilateral" } as const;
    const keys = lumbarLevelKeys(n);
    expect(keys.map((k) => k.key)).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-T"]);
    expect(keys[keys.length - 1]!.transitional).toBe(true);
    expect(isTransitionalLevelKey("L5-T", n)).toBe(true);
    expect(isTransitionalLevelKey("L4-L5", n)).toBe(false);
    expect(isLevelKeyAllowed("L5-S1", n)).toBe(false);
    expect(isLevelKeyAllowed("l5-t", n)).toBe(true);
  });

  it("derives lumbarization as a sixth lumbar-type segment", () => {
    const n = { mode: "lstv-lumbarization" } as const;
    expect(lumbarLevelKeyStrings(n)).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-L6", "L6-S1"]);
  });

  it("feeds the AP canal table from the same resolver, never a fixed list", () => {
    const n = { mode: "lstv-sacralization" } as const;
    expect(lumbarApCanalLevels(n)).toEqual(lumbarLevelKeyStrings(n));
    expect(lumbarApCanalLevels(n)).toContain("L5-T");
  });

  it("maps expected roots per level and marks them uncertain without a localizer", () => {
    const n = defaultLumbarNumbering();
    expect(lumbarRootSuggestion("L3-L4", n)).toMatchObject({ traversing: "L4", exiting: "L3", uncertain: false });
    expect(lumbarRootSuggestion("L4-L5", n)).toMatchObject({ traversing: "L5", exiting: "L4" });
    expect(lumbarRootSuggestion("L5-S1", n).traversing).toBe("S1");
    // L5-S1 has no whole-spine localizer here, so root naming is flagged.
    expect(lumbarRootSuggestion("L5-S1", n).uncertain).toBe(true);
    expect(lumbarRootSuggestion("L5-S1", { mode: "standard", wholeSpineLocalizer: true }).uncertain).toBe(false);
  });

  it("gives traversing and exiting roots separate conflict groups so both survive one level", () => {
    const n = defaultLumbarNumbering();
    const trav = lumbarRootConflictGroup("L4-L5", lumbarRootSuggestion("L4-L5", n).traversing, "traversing");
    const exit = lumbarRootConflictGroup("L4-L5", lumbarRootSuggestion("L4-L5", n).exiting, "exiting");
    expect(trav).toBe("root-trav-L5-L4-L5");
    expect(exit).toBe("root-exit-L4-L4-L5");
    expect(trav).not.toBe(exit);
  });

  it("shows an amber banner and caution sentence for any non-standard numbering", () => {
    const n = {
      mode: "lstv-sacralization",
      castellvi: "IIb",
      side: "bilateral",
      pseudoarthrosis: true,
      reactiveMarrowChange: true,
      wholeSpineLocalizer: false,
    } as const;
    const caution = numberingCautionSentence(n);
    expect(caution).toContain("transitional lumbosacral vertebra with sacralization");
    expect(caution).toContain("Castellvi type IIb");
    expect(caution).toContain("bilateral");
    expect(caution).toContain("pseudoarthrosis");
    expect(caution).toContain("reactive marrow change");
    expect(caution).toContain("lowest mobile segment may not correspond to the conventional L5-S1 level");
    // Reduced certainty caveat is appended because no localizer was available.
    expect(caution).toContain("absolute vertebral level assignment carries reduced certainty");
    expect(numberingBanner(n)).toContain("no whole-spine localizer");
  });

  it("states localizer and manual numbering without asserting a vertebral count", () => {
    expect(numberingCautionSentence({ mode: "localizer-based", wholeSpineLocalizer: true }))
      .toBe("Vertebral numbering is based on the whole-spine / localizer series.");
    expect(numberingCautionSentence({ mode: "manual", designatedL5Label: "lowest prominent lumbar-type vertebra designated L5" }))
      .toContain("(lowest prominent lumbar-type vertebra designated L5)");
    // Manual mode keeps conventional keys — the numbering statement carries the caveat.
    expect(lumbarLevelKeyStrings({ mode: "manual" })).toEqual(lumbarLevelKeyStrings(defaultLumbarNumbering()));
  });

  it("exposes every numbering mode and Castellvi grade the spec lists", () => {
    expect(LUMBAR_NUMBERING_MODES.map((m) => m.id)).toEqual([
      "standard",
      "lstv-sacralization",
      "lstv-lumbarization",
      "localizer-based",
      "manual",
    ]);
    expect(CASTELLVI_OPTIONS.map((c) => c.id)).toEqual(["I", "IIa", "IIb", "IIIa", "IIIb", "IV"]);
    expect(lstvDescriptionPhrase(defaultLumbarNumbering())).toBe("");
  });
});
