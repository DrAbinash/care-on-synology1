/**
 * X-ray LS validation surface (spec §18, §17). Every detection the specification
 * lists is exercised here, together with the equally important negative cases: a
 * sentence that WITHHOLDS a claim ("No pars defect.", "the junction is not
 * adequately visualized") names its subject only to disclaim it, and warning
 * about that would train radiologists to ignore the strip.
 */
import { describe, expect, it } from "vitest";
import {
  LS_CONTRADICTION_RULES,
  LS_IMPRESSION_PRIORITY,
  derivedMeasurementWarnings,
  lsImpressionOrderWarnings,
  lsImpressionPriorityIndex,
  lsTextContradictions,
  lsUncoveredLevelClaims,
} from "./xrayLsContradictions";
import { parseXrayLsViews } from "./xrayLsViews";
import { UNSET_LS_NUMBERING, type LsNumbering } from "./xrayLsNumbering";

const LIVE_PROTOCOL =
  "AP and lateral views of the lumbar spine (with flexion-extension views where indicated).";

const FULL_SERIES = [
  "AP lumbar radiograph.",
  "Lateral lumbar radiograph.",
  "Right oblique views.",
  "Left oblique views.",
  "Flexion view.",
  "Extension view.",
  "Spot L5-S1 view.",
  "The L5-S1 junction is adequately visualized.",
  "The posterior elements are adequately visualized.",
  "T12-L1 is included in the field of view.",
  "The sacroiliac joints are adequately visualized.",
  "No significant rotation.",
  "No motion artifact.",
].join(" ");

const STANDARD_5: LsNumbering = {
  basis: "standard",
  lumbarTypeCount: 5,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const LSTV_6: LsNumbering = {
  basis: "lstv",
  lumbarTypeCount: 6,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const run = (
  findingsText: string,
  opts: { technique?: string; numbering?: LsNumbering | null; impression?: string } = {},
) =>
  lsTextContradictions({
    findingsText,
    impressionText: opts.impression,
    techniqueText: opts.technique ?? FULL_SERIES,
    numbering: opts.numbering ?? STANDARD_5,
  });

const joined = (...args: Parameters<typeof run>) => run(...args).join(" | ");

describe("normal versus abnormal (spec §18 items 1-4)", () => {
  it("catches normal alignment beside a listhesis", () => {
    expect(
      joined("Lumbar lordosis and alignment are maintained. There is grade I anterolisthesis of L5 over S1."),
    ).toContain("Normal alignment / no listhesis");
  });

  it("catches preserved discs beside narrowing, globally and per level", () => {
    expect(
      joined("Intervertebral disc spaces are preserved. There is L4-L5 disc-space narrowing."),
    ).toContain("Disc spaces preserved");
    expect(
      joined("The L4-L5 disc space is preserved. There is L4-L5 disc-space narrowing."),
    ).toContain("The L4-L5 disc is described as both preserved and narrowed");
  });

  it("catches no-fracture language beside a fracture", () => {
    expect(
      joined("No acute fracture or listhesis is identified. There is a compression fracture of L1."),
    ).toContain("No fracture / preserved heights");
  });

  it("catches a normal-study statement beside a significant abnormality", () => {
    expect(
      joined("No acute osseous abnormality. There is a focal lytic lesion of L3."),
    ).toContain("A normal-study statement coexists");
  });

  it("keeps the rules declarative and labelled", () => {
    expect(LS_CONTRADICTION_RULES.length).toBeGreaterThanOrEqual(8);
    for (const rule of LS_CONTRADICTION_RULES) {
      expect(rule.id).toMatch(/^[a-z0-9_]+$/);
      expect(rule.label).not.toMatch(/\[[a-z]/);
    }
  });
});

describe("sacroiliac, pars and hardware self-contradiction (§18 items 9-10)", () => {
  it("catches SI normality beside ankylosis", () => {
    expect(
      joined("The sacroiliac joints show no gross radiographic abnormality. There is sacroiliac joint ankylosis."),
    ).toContain("Sacroiliac joints normal");
  });

  it("catches an intact pars beside a defect", () => {
    expect(
      joined("Pars interarticularis is intact bilaterally. There is a pars defect at L5."),
    ).toContain("Pars intact");
  });

  it("catches hardware called intact and failed", () => {
    expect(
      joined(
        "Pedicle screws and rods at L4-L5 are grossly intact. Hardware breakage is identified at L4-L5.",
      ),
    ).toContain("grossly intact while breakage");
  });

  it("catches equivocal lucency promoted into loosening", () => {
    expect(
      joined("There is equivocal perihardware lucency at L4-L5, indicating loosening."),
    ).toContain("equivocal perihardware lucency is reported as loosening");
    // The permitted wordings stay quiet.
    expect(
      run(
        "Equivocal perihardware lucency at L4-L5; this is not diagnostic of loosening on plain radiographs.",
      ),
    ).toEqual([]);
    expect(
      run("Convincing perihardware lucency at L4-L5, concerning for loosening."),
    ).toEqual([]);
  });
});

describe("view and coverage gating (§18 items 5-6, §2, §9, §13)", () => {
  it("warns about a pars claim the recorded views cannot support", () => {
    const warnings = run("There is a pars defect at L5.", { technique: LIVE_PROTOCOL });
    expect(joined("There is a pars defect at L5.", { technique: LIVE_PROTOCOL })).toContain(
      "pars assessment is not supportable",
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(run("There is a pars defect at L5.")).toEqual([]);
  });

  it("requires an oblique for a unilateral pars defect", () => {
    const lateralOnly = "Lateral lumbar radiograph. The posterior elements are adequately visualized.";
    expect(
      joined("There is a right unilateral pars defect at L5.", { technique: lateralOnly }),
    ).toContain("unilateral pars defect");
  });

  it("warns about a dynamic claim on neutral films only", () => {
    expect(
      joined("There is dynamic instability at L4-L5.", { technique: LIVE_PROTOCOL }),
    ).toContain("Neutral films cannot demonstrate instability");
    expect(run("There is dynamic instability at L4-L5.")).toEqual([]);
  });

  it("never repeats the same gate warning for several sentences", () => {
    const warnings = run(
      "There is dynamic instability at L4-L5. Flexion shows increased translation at L3-L4.",
      { technique: LIVE_PROTOCOL },
    );
    expect(warnings.filter((w) => w.includes("Neutral films cannot demonstrate instability"))).toHaveLength(1);
  });

  it("warns when the junction is claimed without coverage", () => {
    expect(
      joined("The L5-S1 disc space is preserved.", { technique: LIVE_PROTOCOL }),
    ).toContain("coverage of the lumbosacral junction is not recorded");
    expect(run("The L5-S1 disc space is preserved.")).toEqual([]);
  });

  it("warns when T12-L1 is commented on outside the field of view", () => {
    const excluded = "AP lumbar radiograph. T12-L1 is not included in the field of view.";
    expect(joined("The T12-L1 disc space is narrowed.", { technique: excluded })).toContain(
      "T12-L1 is recorded as not included",
    );
  });

  it("requires recorded sacroiliac adequacy for a named SI abnormality", () => {
    expect(
      joined("There is sacroiliac joint sclerosis on the right.", { technique: LIVE_PROTOCOL }),
    ).toContain("sacroiliac joints are not recorded as adequately visualized");
    expect(run("There is sacroiliac joint sclerosis on the right.")).toEqual([]);
  });

  it("says so when the technique field records nothing at all", () => {
    expect(joined("There is a pars defect at L5.", { technique: "" })).toContain(
      "no views are recorded in the technique field",
    );
  });
});

describe("withheld claims are not claims", () => {
  it("accepts the library's own caution wording", () => {
    expect(
      run(
        [
          "No pars defect is identified.",
          "The lumbosacral junction is not adequately visualized on these radiographs.",
          "Dynamic instability cannot be assessed on neutral films.",
          "The sacroiliac joints, where visualized, are unremarkable.",
          "Inclusion of T12-L1 is not recorded on these radiographs.",
        ].join(" "),
        { technique: LIVE_PROTOCOL },
      ),
    ).toEqual([]);
  });

  it("still gates a claim that merely denies a different subject", () => {
    expect(
      joined("L5-S1 foraminal narrowing with no fracture.", {
        technique: "AP lumbar radiograph. Lateral lumbar radiograph.",
      }),
    ).toContain("a foraminal statement");
  });
});

describe("numbering consistency (§18 items 7-8, 11)", () => {
  it("refuses an L6 label while the numbering basis is standard", () => {
    expect(joined("There is a pars defect at L6.")).toContain(
      "no transitional vertebra has been designated",
    );
  });

  it("catches LSTV with conflicting labels", () => {
    expect(
      joined("Retrolisthesis at L6-S1.", { numbering: LSTV_6 }),
    ).toContain("cannot be produced by the recorded numbering");
  });

  it("requires a designated L5 before labelling the lumbosacral junction", () => {
    const unanchored: LsNumbering = { ...LSTV_6, designatedL5Position: null };
    expect(joined("Grade I anterolisthesis at L5-S1.", { numbering: unanchored })).toContain(
      "without a designated L5",
    );
  });

  it("catches a five-versus-six segment conflict", () => {
    expect(joined("There are five lumbar vertebrae.", { numbering: LSTV_6 })).toContain(
      "states five lumbar vertebrae while 6 lumbar-type bodies are recorded",
    );
    expect(
      joined("Five lumbar-type vertebrae are counted. There is transitional lumbosacral anatomy with a Castellvi type IIa.", {
        numbering: STANDARD_5,
      }),
    ).toContain("A standard five-segment statement coexists with transitional anatomy");
  });

  it("flags cervical numbering pasted into a lumbar report", () => {
    expect(joined("There is C5-C6 disc space narrowing.")).toContain(
      "cervical numbering in a lumbosacral report",
    );
  });
});

describe("derived measurement consistency (§18 item 12)", () => {
  it("accepts a grade that matches its slip percentage", () => {
    expect(derivedMeasurementWarnings("Meyerding grade II anterolisthesis with 40% slip.")).toEqual([]);
    expect(
      derivedMeasurementWarnings("Anterolisthesis of L5 over S1, 20% of the vertebral body width, Meyerding grade I."),
    ).toEqual([]);
  });

  it("catches a grade that no longer matches an edited percentage", () => {
    expect(joined("Meyerding grade I anterolisthesis with 60% slip.")).toContain(
      "Meyerding grade I does not match the measured 60% slip — 60% is grade III",
    );
  });

  it("catches an impossible percentage", () => {
    expect(
      derivedMeasurementWarnings("Meyerding grade II with 160% of the vertebral body width.").join(" "),
    ).toContain("not a valid slip percentage");
  });

  it("stays quiet when only one of the two figures is present", () => {
    expect(derivedMeasurementWarnings("Meyerding grade II spondylolisthesis.")).toEqual([]);
    expect(derivedMeasurementWarnings("40% slip of the vertebral body width.")).toEqual([]);
  });
});

describe("unfinished catalog tokens", () => {
  it("are surfaced before the report can print them", () => {
    expect(joined("There is [direction] of [upper] over [lower] at [level].")).toContain(
      "unfinished placeholders",
    );
    expect(run("There is anterolisthesis of L5 over S1 at L5-S1.")).toEqual([]);
  });
});

describe("impression priority (spec §17)", () => {
  it("ranks fracture and destruction above everything else", () => {
    expect(lsImpressionPriorityIndex("Compression fracture of L1.")).toBe(0);
    expect(lsImpressionPriorityIndex("Destructive lesion at L2.")).toBe(0);
    expect(lsImpressionPriorityIndex("Grade I anterolisthesis at L5-S1.")).toBe(1);
    expect(lsImpressionPriorityIndex("Multilevel lumbar spondylotic changes.")).toBe(2);
    expect(lsImpressionPriorityIndex("Lumbar scoliosis, Cobb 30 degrees.")).toBe(3);
    expect(lsImpressionPriorityIndex("Transitional lumbosacral vertebra.")).toBe(4);
    expect(lsImpressionPriorityIndex("Hardware breakage at L4-L5.")).toBe(5);
    expect(LS_IMPRESSION_PRIORITY).toHaveLength(6);
  });

  it("warns when a lower-priority line is listed first", () => {
    expect(
      lsImpressionOrderWarnings([
        "Multilevel lumbar spondylotic changes.",
        "Compression fracture of L1.",
      ]),
    ).toHaveLength(1);
    expect(
      lsImpressionOrderWarnings([
        "Compression fracture of L1.",
        "Grade I anterolisthesis at L5-S1.",
        "Multilevel lumbar spondylotic changes.",
      ]),
    ).toEqual([]);
    expect(lsImpressionOrderWarnings([])).toEqual([]);
  });
});

describe("lsUncoveredLevelClaims", () => {
  it("names the sentence it cannot support", () => {
    const claims = lsUncoveredLevelClaims(
      "The L5-S1 disc space is preserved. Alignment is maintained.",
      parseXrayLsViews(LIVE_PROTOCOL),
      STANDARD_5,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]).toContain("The L5-S1 disc space is preserved");
  });

  it("is quiet when coverage is demonstrated", () => {
    expect(
      lsUncoveredLevelClaims(
        "The L5-S1 disc space is narrowed.",
        parseXrayLsViews(FULL_SERIES),
        STANDARD_5,
      ),
    ).toEqual([]);
  });

  it("adds numbering problems for the study's own numbering record", () => {
    const claims = lsUncoveredLevelClaims(
      "There is a pars defect at L6.",
      parseXrayLsViews(FULL_SERIES),
      UNSET_LS_NUMBERING,
    );
    expect(claims.join(" ")).toContain("no transitional vertebra has been designated");
  });
});
