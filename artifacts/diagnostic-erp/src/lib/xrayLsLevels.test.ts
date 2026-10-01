/**
 * X-ray Lumbosacral Spine LEVEL vocabulary and numbering consistency
 * (spec §4, §5, §18). In lumbar radiography the commonest report error is a
 * wrong level rather than a missed fracture, so these tests pin the conservative
 * contract: a level CARE cannot place is reported, never guessed.
 */
import { describe, expect, it } from "vitest";
import {
  LS_DISC_LEVELS,
  LS_VERTEBRAL_LEVELS,
  levelIsAboveConus,
  levelIsAtLumbosacralJunction,
  lsLevelConsistencyIssues,
  lsLevelsInText,
  lsVertebraIndex,
  normalizeLsLevel,
  vertebraeOfLsDiscLevel,
} from "./xrayLsLevels";

const details = (text: string, opts?: Parameters<typeof lsLevelConsistencyIssues>[1]) =>
  lsLevelConsistencyIssues(text, opts).map((i) => i.detail);

describe("LS level vocabulary", () => {
  it("spans T12-L1 through L5-S1 so the included upper junction is nameable", () => {
    // spec §5: "disc spaces T12-L1 if included and L1-2 through L5-S1".
    expect(LS_DISC_LEVELS[0]).toBe("T12-L1");
    expect(LS_DISC_LEVELS).toContain("L5-S1");
    expect(LS_DISC_LEVELS).toHaveLength(6);
    expect(LS_VERTEBRAL_LEVELS[0]).toBe("T12");
    expect(LS_VERTEBRAL_LEVELS).toContain("S1");
  });

  it("orders vertebrae top-down with T12 above L1 and S1 below L5", () => {
    expect(lsVertebraIndex("T12")).toBe(0);
    expect(lsVertebraIndex("D12")).toBe(0);
    expect(lsVertebraIndex("L1")).toBe(1);
    expect(lsVertebraIndex("L5")).toBe(5);
    expect(lsVertebraIndex("S1")).toBe(6);
    expect(lsVertebraIndex("L10")).toBeNull();
    expect(lsVertebraIndex("S2")).toBeNull();
    expect(lsVertebraIndex("C5")).toBeNull();
    expect(lsVertebraIndex("T11")).toBeNull();
    expect(lsVertebraIndex(null)).toBeNull();
  });
});

describe("normalizeLsLevel", () => {
  it("canonicalizes the spellings that actually appear in dictated prose", () => {
    expect(normalizeLsLevel("L4-5")).toBe("L4-L5");
    expect(normalizeLsLevel("l4/5")).toBe("L4-L5");
    expect(normalizeLsLevel("L4 - L5")).toBe("L4-L5");
    expect(normalizeLsLevel("L5 s1")).toBe("L5-S1");
    expect(normalizeLsLevel("L5–S1")).toBe("L5-S1");
    expect(normalizeLsLevel("D12-L1")).toBe("T12-L1");
    expect(normalizeLsLevel("T12-L1")).toBe("T12-L1");
    expect(normalizeLsLevel("L5")).toBe("L5");
    expect(normalizeLsLevel("s1")).toBe("S1");
    expect(normalizeLsLevel("D12")).toBe("T12");
  });

  it("transitional junction labels stay nameable", () => {
    // A film numbered by counting lumbar-type bodies calls the junction L6-S1;
    // the designated-L5 scheme calls it L5-S1. Both are the same junction and
    // neither may be silently dropped, or the coverage gates miss it.
    expect(normalizeLsLevel("L6-S1")).toBe("L6-S1");
    expect(normalizeLsLevel("L6")).toBe("L6");
  });

  it("refuses to guess anything outside the thoracolumbosacral range", () => {
    expect(normalizeLsLevel("L0")).toBeNull();
    expect(normalizeLsLevel("L8")).toBeNull();
    expect(normalizeLsLevel("C5-C6")).toBeNull();
    expect(normalizeLsLevel("S2")).toBeNull();
    expect(normalizeLsLevel("L5-L4")).toBeNull(); // reversed pair is an error
    expect(normalizeLsLevel("L4-L4")).toBeNull();
    expect(normalizeLsLevel("")).toBeNull();
    expect(normalizeLsLevel(null)).toBeNull();
    expect(normalizeLsLevel("sacrum")).toBeNull();
  });
});

describe("lsLevelsInText", () => {
  it("keeps the lower letter of a pair instead of inventing a segment", () => {
    expect(lsLevelsInText("Disc space narrowing at L5-S1.")).toEqual(["L5-S1"]);
    expect(lsLevelsInText("The D12-L1 disc is included.")).toEqual(["T12-L1"]);
  });

  it("collects every level mentioned, canonical and de-duplicated", () => {
    const text =
      "Disc spaces preserved at L1-2, L2-L3 and L4-5. The L5 S1 junction is narrowed. T12-L1 is not included. L5 is wedged.";
    expect(lsLevelsInText(text)).toEqual([
      "L1-L2",
      "L2-L3",
      "L4-L5",
      "L5-S1",
      "T12-L1",
      "L5",
    ]);
  });

  it("ignores non-anatomical digit runs", () => {
    expect(lsLevelsInText("11x14 film, 70 kg, 2 views.")).toEqual([]);
  });

  it("pairs a space-separated junction only when the second token is a vertebra", () => {
    // "the L5 S1 junction" is one segment; "L5 6 mm of translation" is a level
    // plus a measurement and must not become an L5-L6 segment.
    expect(lsLevelsInText("The L5 S1 junction is narrowed.")).toEqual(["L5-S1"]);
    expect(lsLevelsInText("There is 6 mm of translation at L5.")).toEqual(["L5"]);
  });
});

describe("vertebraeOfLsDiscLevel and junction tests", () => {
  it("splits a segment into its two bodies", () => {
    expect(vertebraeOfLsDiscLevel("L5-S1")).toEqual(["L5", "S1"]);
    expect(vertebraeOfLsDiscLevel("T12-L1")).toEqual(["T12", "L1"]);
    expect(vertebraeOfLsDiscLevel("L5")).toBeNull();
    expect(vertebraeOfLsDiscLevel(null)).toBeNull();
  });

  it("recognizes the lumbosacral junction under either numbering convention", () => {
    expect(levelIsAtLumbosacralJunction("L5-S1")).toBe(true);
    expect(levelIsAtLumbosacralJunction("L6-S1")).toBe(true);
    expect(levelIsAtLumbosacralJunction("l5 s1")).toBe(true);
    expect(levelIsAtLumbosacralJunction("L4-L5")).toBe(false);
    expect(levelIsAtLumbosacralJunction(null)).toBe(false);
    expect(levelIsAboveConus("T12-L1")).toBe(true);
    expect(levelIsAboveConus("L1-L2")).toBe(false);
  });
});

describe("lsLevelConsistencyIssues", () => {
  it("stays quiet on the canonical library normal prose", () => {
    // The seeded LS normal text must never raise a numbering alarm.
    expect(
      lsLevelConsistencyIssues(
        "Normal lumbar alignment and vertebral body heights. No spondylolisthesis or pars defect. Disc spaces are preserved. No compression fracture. The sacroiliac joints, where visualized, are unremarkable.",
      ),
    ).toEqual([]);
    expect(
      lsLevelConsistencyIssues("Disc spaces are preserved from L1-L2 through L5-S1."),
    ).toEqual([]);
  });

  it("rejects a vertebra that does not exist", () => {
    expect(details("L0 is fractured.")).toContain('"L0" is not a lumbar vertebra');
  });

  it("only tolerates an L6 label when a transitional vertebra was designated", () => {
    // spec §4: never silently assume the lowest mobile segment is L5-S1.
    const flagged = lsLevelConsistencyIssues("There is a pars defect at L6.");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].detail).toContain("no transitional vertebra has been designated");
    expect(
      lsLevelConsistencyIssues("There is a pars defect at L6.", {
        allowTransitionalLevels: true,
      }),
    ).toEqual([]);
  });

  it("catches cervical numbering pasted into a lumbosacral report", () => {
    expect(details("There is C5-C6 disc space narrowing.")[0]).toContain(
      "cervical numbering in a lumbosacral report",
    );
  });

  it("requires a listhesis to name adjacent vertebrae", () => {
    const joined = details("Anterolisthesis of L4 over L6.").join(" ");
    expect(joined).toContain("not adjacent");
    expect(lsLevelConsistencyIssues("Anterolisthesis of L5 over S1.")).toEqual([]);
    expect(
      lsLevelConsistencyIssues("Anterolisthesis of L6 over S1.", {
        allowTransitionalLevels: true,
      }),
    ).toEqual([]);
  });

  it("requires the level quoted beside a listhesis to be the same segment", () => {
    const issues = lsLevelConsistencyIssues(
      "Anterolisthesis of L5 over S1 at the L4-L5 level, grade II.",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("is the L5-S1 segment, but the same sentence quotes the L4-L5 level");
  });

  it("reports a reversed segment in the corrected form", () => {
    const issues = lsLevelConsistencyIssues("Disc space narrowing at L5-L4.");
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("L4-L5");
    expect(issues[0].detail).toContain("the segment is L4-L5");
  });

  it("flags six counted lumbar-type bodies while the basis is not transitional", () => {
    const issues = lsLevelConsistencyIssues("Disc spaces preserved at L5-S1.", {
      lumbarTypeCount: 6,
      allowTransitionalLevels: false,
    });
    expect(issues.map((i) => i.detail).join(" ")).toContain(
      "do not silently call the lowest mobile segment L5-S1",
    );
  });

  it("compares levels only inside one sentence, never across the report", () => {
    // Two separate observations at two levels are not a contradiction.
    expect(
      lsLevelConsistencyIssues(
        "There is grade I anterolisthesis of L5 over S1. Disc-space narrowing is also present at L4-L5.",
      ),
    ).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(lsLevelConsistencyIssues("")).toEqual([]);
    expect(lsLevelConsistencyIssues(null)).toEqual([]);
  });
});
