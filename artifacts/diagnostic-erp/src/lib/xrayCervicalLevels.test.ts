import { describe, expect, it } from "vitest";
import {
  CERVICAL_DISC_LEVELS,
  CERVICAL_LEVEL_OPTIONS,
  CERVICAL_VERTEBRAL_LEVELS,
  cervicalLevelConsistencyIssues,
  cervicalLevelsInText,
  normalizeCervicalLevel,
  vertebraeOfDiscLevel,
} from "./xrayCervicalLevels";

/**
 * The cervical level vocabulary is the display form the patient report reads.
 * CARE writes the first thoracic vertebra as D1 in its internal MRI
 * conventions (normalizeLevel, normalizeDiscLevel) while every piece of
 * cervical radiography content — the clinical library, the seeded XR protocol
 * checklist, the seeded cervical normal — writes C7-T1. Both spellings must
 * resolve to ONE level so the ledger slot key stays stable and the prose stays
 * readable; that reconciliation is the point of these tests.
 */
describe("normalizeCervicalLevel", () => {
  it.each([
    ["c5-6", "C5-C6"],
    ["C5/6", "C5-C6"],
    ["C5 / C6", "C5-C6"],
    ["C5-C6", "C5-C6"],
    ["C5 – C6", "C5-C6"],
    ["C5 C6", "C5-C6"],
    ["C7-T1", "C7-T1"],
    ["C7-D1", "C7-T1"],
    ["C7-T1 level", null],
    ["c1-c2", "C1-C2"],
    ["C5", "C5"],
    ["c7", "C7"],
    ["T1", "T1"],
    ["D1", "T1"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeCervicalLevel(raw)).toBe(expected);
  });

  it("returns null rather than guessing a level that is not cervical", () => {
    for (const raw of ["", "   ", null, undefined, "L4-L5", "L5", "S1", "T4", "C8", "C0"]) {
      expect(normalizeCervicalLevel(raw as string | null | undefined)).toBeNull();
    }
  });

  it("rejects reversed and same-vertebra pairs as numbering errors", () => {
    expect(normalizeCervicalLevel("C6-C5")).toBeNull();
    expect(normalizeCervicalLevel("C5-C5")).toBeNull();
  });
});

describe("cervicalLevelsInText", () => {
  it("reads C7-T1 as one segment, not as a reversed C7-C1 pair", () => {
    expect(cervicalLevelsInText("Adequacy requires visualization of C7-T1.")).toEqual(["C7-T1"]);
  });

  it("collects vertebral and disc levels in the order they appear", () => {
    expect(
      cervicalLevelsInText(
        "Loss of disc height at C5-C6 and C6-7 with posterior osteophytes at C5.",
      ),
    ).toEqual(["C5-C6", "C6-C7", "C5"]);
  });

  it("accepts the internal D1 spelling and deduplicates", () => {
    expect(cervicalLevelsInText("C7-D1 narrowing, C7/T1 reviewed again.")).toEqual(["C7-T1"]);
  });

  it("ignores lumbar and sacral numbering", () => {
    expect(cervicalLevelsInText("L4-L5 and S1 are not cervical levels.")).toEqual([]);
  });
});

describe("vertebraeOfDiscLevel", () => {
  it("splits a segment into its two vertebrae", () => {
    expect(vertebraeOfDiscLevel("c5-6")).toEqual(["C5", "C6"]);
    expect(vertebraeOfDiscLevel("C7-D1")).toEqual(["C7", "T1"]);
  });

  it("returns null for a single vertebra or an unknown level", () => {
    expect(vertebraeOfDiscLevel("C5")).toBeNull();
    expect(vertebraeOfDiscLevel("")).toBeNull();
    expect(vertebraeOfDiscLevel("L4-L5")).toBeNull();
  });
});

describe("cervicalLevelConsistencyIssues", () => {
  it("accepts a listhesis pair that matches the level it quotes", () => {
    expect(
      cervicalLevelConsistencyIssues(
        "Grade I anterolisthesis of C6 over C7 at the C6-C7 level.",
      ),
    ).toEqual([]);
  });

  it("catches anterolisthesis with the prefix attached to the word", () => {
    const issues = cervicalLevelConsistencyIssues("Anterolisthesis of C5 over C7 at the C5-C6 level.");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toMatch(/not adjacent/);
  });

  it("catches a listhesis pair that contradicts the level in the same sentence", () => {
    const issues = cervicalLevelConsistencyIssues(
      "Anterolisthesis of C6 over C7 at the C5-C6 level.",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.level).toBe("C6-C7");
    expect(issues[0]?.detail).toContain("C5-C6");
  });

  it("catches retrolisthesis and a single-level shorthand pair", () => {
    expect(cervicalLevelConsistencyIssues("Retrolisthesis of C4 over C6.")).toHaveLength(1);
    const issues = cervicalLevelConsistencyIssues("Spondylolisthesis of C2 over C3 at the C3-C4 level.");
    expect(issues[0]?.detail).toContain("C2-C3");
    expect(issues[0]?.detail).toContain("C3-C4");
  });

  it("catches a vertebra that does not exist", () => {
    const issues = cervicalLevelConsistencyIssues("Disc space reduced at C8.");
    expect(issues[0]?.detail).toContain("not a cervical vertebra");
  });

  it("catches lumbar numbering inside a cervical report", () => {
    const issues = cervicalLevelConsistencyIssues("Loss of lordosis with L4-L5 disc narrowing.");
    expect(issues.some((i) => i.level === "L4")).toBe(true);
  });

  it("catches a pair written with the lower vertebra first", () => {
    const issues = cervicalLevelConsistencyIssues("Disc space narrowing at C6-C5.");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.level).toBe("C5-C6");
  });

  it("says nothing about a correctly numbered report", () => {
    expect(
      cervicalLevelConsistencyIssues(
        "Cervical alignment and lordosis are maintained. Disc spaces are preserved from C2-C3 to C7-T1. " +
          "Marginal osteophytes at C5-C6. The odontoid and C1-C2 are unremarkable.",
      ),
    ).toEqual([]);
  });

  it("tolerates the internal D1 spelling", () => {
    expect(cervicalLevelConsistencyIssues("Disc space reduction at C7-D1.")).toEqual([]);
  });

  it("does not treat the inferior visualization limit as a numbering error", () => {
    expect(
      cervicalLevelConsistencyIssues("The inferior visualization extends to T2."),
    ).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(cervicalLevelConsistencyIssues("")).toEqual([]);
    expect(cervicalLevelConsistencyIssues(null)).toEqual([]);
  });
});

describe("level option lists", () => {
  it("covers C1-T1 vertebrae and the C2-C3 to C7-T1 segments the library names", () => {
    expect(CERVICAL_VERTEBRAL_LEVELS).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1"]);
    expect(CERVICAL_DISC_LEVELS).toEqual([
      "C2-C3",
      "C3-C4",
      "C4-C5",
      "C5-C6",
      "C6-C7",
      "C7-T1",
    ]);
    expect(CERVICAL_LEVEL_OPTIONS.map((o) => o.value)).toEqual([
      "C1-C2",
      ...CERVICAL_DISC_LEVELS,
    ]);
  });
});
