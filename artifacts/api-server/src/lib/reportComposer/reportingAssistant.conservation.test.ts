/**
 * Clinical conservation (CARE AI assistant, Phase 5/6).
 *
 * The composer has always been able to say "the model ADDED something it was not
 * told". This suite is the other half: "the model LOST something the radiologist
 * wrote". Before this rule, a dropped measurement was an advisory warning that
 * still let the job reach READY and be accepted into the report of record, and a
 * dropped vertebral level was not detected at all.
 *
 * Every case here is written against the shipped validator, and each hard-error
 * case has a matching positive control, because a guard that always fails is as
 * useless as no guard.
 */
import { describe, expect, it } from "vitest";
import {
  detectConservationLosses,
  extractConservationLevels,
  extractConservationMeasurements,
  validateComposerOutput,
} from "./validateOutput";
import {
  parseComposerSnapshot,
  type ComposerDraftOutput,
  type ProposedObservation,
} from "./types";

const LUMBAR_REPORT = [
  "Loss of normal lumbar lordosis.",
  "Disc desiccation seen at L2-L3, L3-L4, L4-L5 and L5-S1.",
  "Diffuse posterior disc bulge at L3-L4.",
  "Broad-based posterior disc bulge at L4-L5 with mild bilateral lateral recess narrowing.",
  "Facet arthropathy at L4-L5 and L5-S1.",
  "AP canal diameters measure 12, 11, 9, 10, 13 mm at L1-L2 through L5-S1.",
  "No spondylolisthesis. Conus terminates normally at L1.",
].join("\n");

function draft(over: Partial<ComposerDraftOutput> = {}): ComposerDraftOutput {
  return {
    findings: LUMBAR_REPORT,
    impression: "Degenerative lumbar disease at L4-L5 with bilateral lateral recess narrowing.",
    recommendation: "",
    unresolvedQuestions: [],
    warnings: [],
    ...over,
  };
}

function snapshotOf(findings: string, impression = "Degenerative lumbar disease.") {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    findings,
    impression,
    recommendation: "",
    observations: [],
  });
}

describe("measurement tokens include dictated comma series", () => {
  it("reads every value out of '12, 11, 9, 10, 13 mm'", () => {
    const found = extractConservationMeasurements("AP canal 12, 11, 9, 10, 13 mm at L1-L2.");
    // The old single-value regex saw only `13 mm` from this string, so four of
    // five measurements were unprotected.
    expect([...found].sort()).toEqual(["10mm", "11mm", "12mm", "13mm", "9mm"]);
  });

  it("still reads a lone value and a decimal", () => {
    expect([...extractConservationMeasurements("canal AP diameter 8.2 mm")]).toContain("8.2mm");
    expect([...extractConservationMeasurements("4.2 cm lesion")]).toContain("4.2cm");
  });

  it("does not invent a series out of two unrelated numbers", () => {
    // The shape that makes a loose series regex dangerous: "45" is an age and
    // "5" is half of a level name, not measurements.
    expect([...extractConservationMeasurements("A 45 and 12 mm")]).toEqual(["12mm"]);
    expect([...extractConservationMeasurements("bulge at L4-L5 and 8 mm canal")]).toEqual([
      "8mm",
    ]);
  });
});

describe("level tokens normalise the way radiologists type", () => {
  it("treats L4-5, L4-L5, L4/5 and L4 to L5 as one fact", () => {
    const canonicals = (t: string) => extractConservationLevels(t).map((x) => x.canonical);
    expect(canonicals("bulge at L4-5")).toEqual(["L4-5"]);
    expect(canonicals("bulge at L4-L5")).toEqual(["L4-5"]);
    expect(canonicals("bulge at L4/L5")).toEqual(["L4-5"]);
    expect(canonicals("bulge at L4 to L5")).toEqual(["L4-5"]);
  });

  it("keeps a mixed pair's own letters in its components", () => {
    const [token] = extractConservationLevels("transition at C7-T1.");
    expect(token?.canonical).toBe("C7-1");
    expect(token?.components).toEqual(["C7", "T1"]);
  });

  it("does not demand a standalone L4 when the input said L4-L5", () => {
    const canonicals = extractConservationLevels("bulge at L4-L5").map((x) => x.canonical);
    expect(canonicals).toEqual(["L4-5"]);
  });
});

describe("conservation: what may not disappear", () => {
  it("fails when a measurement is dropped", () => {
    const out = draft({
      findings: LUMBAR_REPORT.replace("12, 11, 9, 10, 13 mm", "12, 11, 13 mm"),
    });
    const losses = detectConservationLosses(snapshotOf(LUMBAR_REPORT), out);
    expect(losses.errors).toContain("measurement_dropped");
    expect(losses.droppedMeasurements).toEqual(expect.arrayContaining(["9mm", "10mm"]));
  });

  it("fails when a vertebral level is dropped", () => {
    // Every spelling of L5-S1 in the report goes, so nothing can re-state it.
    const out = draft({ findings: LUMBAR_REPORT.replace(/L5-S1/g, "the sacrum") });
    const losses = detectConservationLosses(snapshotOf(LUMBAR_REPORT), out);
    expect(losses.errors).toContain("level_dropped");
    // Canonical form of "L5-S1" is `L5-1`: letter + first number + second number.
    expect(losses.droppedLevels).toContain("L5-1");
  });

  it("fails when laterality is dropped", () => {
    const out = draft({
      findings: LUMBAR_REPORT.replace("bilateral lateral recess", "lateral recess"),
      impression: "Degenerative lumbar disease at L4-L5.",
    });
    expect(detectConservationLosses(snapshotOf(LUMBAR_REPORT), out).errors).toContain(
      "laterality_dropped",
    );
  });

  it("fails when a section that had content comes back empty", () => {
    const losses = detectConservationLosses(snapshotOf(LUMBAR_REPORT), draft({ impression: "" }));
    expect(losses.errors).toContain("section_dropped");
    expect(losses.droppedSections).toEqual(["IMPRESSION"]);
  });

  it("passes a faithful rewrite that rewords everything but loses nothing", () => {
    const rewritten = [
      "The normal lumbar lordosis is lost.",
      "Desiccated discs are noted at L2-L3, L3-L4, L4-L5 and L5-S1.",
      "There is a diffuse posterior disc bulge at L3-L4.",
      "A broad-based posterior disc bulge at L4-L5 produces mild bilateral lateral recess narrowing.",
      "Facet arthropathy is present at L4-L5 and L5-S1.",
      "The AP canal diameters are 12, 11, 9, 10 and 13 mm from L1-L2 to L5-S1.",
      "No spondylolisthesis is seen, and the conus terminates normally at L1.",
    ].join("\n");
    const result = validateComposerOutput(snapshotOf(LUMBAR_REPORT), draft({ findings: rewritten }), {
      kind: "PROFESSIONALIZE",
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts a pair written as its two levels separately", () => {
    const out = draft({ findings: LUMBAR_REPORT.replace(/L4-L5/g, "L4 and L5") });
    const losses = detectConservationLosses(snapshotOf(LUMBAR_REPORT), out);
    expect(losses.errors).not.toContain("level_dropped");
  });

  it("accepts L4-5 in the input answered as L4-L5 in the output", () => {
    const input = "Disc bulge at L4-5 with 9 mm canal stenosis.";
    const out = draft({
      findings: "There is a disc bulge at the L4-L5 level, with a canal diameter of 9 mm.",
      impression: "L4-L5 disc bulge with 9 mm canal stenosis.",
    });
    const losses = detectConservationLosses(snapshotOf(input), out);
    expect(losses.errors).toEqual([]);
  });
});

describe("conservation is scoped to the kinds that promise it", () => {
  it("the validator is a no-op for kinds that are not preserving", () => {
    const truncated = draft({
      findings: "Loss of normal lumbar lordosis.",
      impression: "Degenerative change.",
    });
    const asProfessionalize = validateComposerOutput(
      snapshotOf(LUMBAR_REPORT),
      truncated,
      { kind: "PROFESSIONALIZE" },
    );
    const asFullReport = validateComposerOutput(snapshotOf(LUMBAR_REPORT), truncated, {
      kind: "FULL_REPORT",
    });
    // FULL_REPORT drafts FROM observations and may legitimately restructure —
    // holding it to this rule would fail every normal spine draft.
    expect(asProfessionalize.errors).toContain("measurement_dropped");
    expect(asProfessionalize.ok).toBe(false);
    expect(asFullReport.errors).not.toContain("measurement_dropped");
    expect(asFullReport.conservation).toBeUndefined();
  });

  it("stays off entirely for callers that pass no kind", () => {
    // The overnight draft path and every pre-existing caller.
    const result = validateComposerOutput(
      snapshotOf(LUMBAR_REPORT),
      draft({ findings: "Lordosis lost.", impression: "Degenerative change." }),
    );
    expect(result.conservation).toBeUndefined();
    expect(result.errors).not.toContain("measurement_dropped");
  });

  it("reports an observation measurement the narrative never carried as a warning", () => {
    // Shaped deliberately: `detectDefiniteClinicalMutations` already hard-fails a
    // measurement that is unique to one slot, so this is the case where only the
    // new advisory layer can say anything — the same value carried by two levels,
    // never written into the report text at all.
    const snap = parseComposerSnapshot({
      modality: "MR",
      region: "LS Spine",
      findings: "Disc bulge at L3-L4 with canal AP 11 mm, and at L4-L5 and L5-S1.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "canal stenosis", level: "L4-L5", measurement: "8.2", findingsText: "Canal AP 8.2 mm." },
        { concept: "canal stenosis", level: "L5-S1", measurement: "8.2", findingsText: "Canal AP 8.2 mm." },
      ],
    });
    const out: ComposerDraftOutput = {
      findings: "Disc bulge at L3-L4, with a canal AP diameter of 11 mm. Bulging also at L4-L5 and L5-S1.",
      impression: "Multilevel lumbar disc bulging.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, out, { kind: "PROFESSIONALIZE" });
    expect(result.errors).toEqual([]);
    expect(result.conservation?.observationOnlyLosses).toContain("8.2mm");
    expect(result.warnings.join(" ")).toMatch(/8\.2mm/);
  });
});

/**
 * Three defects the LIVE model run found (2026-10-11, `mriRealModel.live.test.ts`).
 * Each was invisible to a mocked fixture because it only appears when a real
 * answer carries the second report's facts, or spells the same word the other
 * way round.
 */
describe("a COMBINE answer is grounded in the report it was handed as well", () => {
  const CERVICAL = "Loss of cervical lordosis. Left C5-C6 foraminal disc protrusion.";
  const LUMBAR =
    "Broad-based posterior disc bulge at L4-L5 with bilateral lateral recess narrowing, AP canal 8.2 mm.";

  const snap = parseComposerSnapshot({
    modality: "MR",
    region: "Cervical Spine",
    findings: CERVICAL,
    impression: "Left C6 root contact.",
    recommendation: "",
    observations: [],
    additionalReports: [
      {
        label: "MRI LUMBOSACRAL SPINE (same patient, same day)",
        modality: "MRI",
        region: "LS Spine",
        findings: LUMBAR,
        impression: "Canal stenosis at L4-L5.",
      },
    ],
  });

  it("does not call the merged study's own levels and measurements invented", () => {
    const result = validateComposerOutput(
      snap,
      draft({
        findings: `${CERVICAL} ${LUMBAR}`,
        impression: "Left C6 root contact. Canal stenosis at L4-L5.",
      }),
      { kind: "COMBINE" },
    );
    // gemma3:12b produced exactly this faithful merge and the guard blocked it
    // with `level_change` + `unsupported_abnormality`, because the corpus knew
    // only the cervical report.
    expect(result.errors).not.toContain("level_change");
    expect(result.errors).not.toContain("unsupported_abnormality");
    expect(result.errors).toEqual([]);
  });

  it("fails when the merge quietly discards the second study", () => {
    const result = validateComposerOutput(
      snap,
      draft({ findings: CERVICAL, impression: "Left C6 root contact." }),
      { kind: "COMBINE" },
    );
    // medgemma1.5:4b did this on the live run and reached READY, because the
    // conservation input side did not contain the added report either.
    expect(result.errors).toContain("level_dropped");
    expect(result.errors).toContain("measurement_dropped");
    expect(result.errors).toContain("laterality_dropped");
    expect(result.conservation?.droppedMeasurements).toContain("8.2mm");
  });
});

describe("US and UK spelling of one word is not an invented abnormality", () => {
  const BRAIN_INPUT = "No acute infarct or haemorrhage. Fazekas grade 2 small-vessel change.";

  it("accepts the same fact spelled the way the model prefers", () => {
    const result = validateComposerOutput(
      parseComposerSnapshot({
        modality: "MR",
        region: "Brain",
        findings: BRAIN_INPUT,
        impression: "No acute pathology.",
        recommendation: "",
        observations: [],
      }),
      draft({
        findings:
          "There is no acute infarct or hemorrhage. Periventricular and deep white matter "
          + "FLAIR hyperintensities are present, Fazekas grade 2.",
        impression: "Grade 2 small-vessel change. No acute intracranial pathology.",
      }),
      { kind: "PROFESSIONALIZE" },
    );
    // qwen3:12b/gemma3:12b both rewrote "haemorrhage" as "hemorrhage" and were
    // failed for inventing a hemorrhage in a report that had denied one.
    expect(result.errors).not.toContain("unsupported_abnormality");
  });

  it("still blocks a hemorrhage the input never mentioned in either spelling", () => {
    const result = validateComposerOutput(
      parseComposerSnapshot({
        modality: "MR",
        region: "Brain",
        findings: "No acute infarct. Fazekas grade 1.",
        impression: "Minor chronic change.",
        recommendation: "",
        observations: [],
      }),
      draft({
        findings: "A small acute hemorrhage is present in the right frontal lobe.",
        impression: "Acute intracerebral hemorrhage.",
      }),
      { kind: "PROFESSIONALIZE" },
    );
    expect(result.errors).toContain("unsupported_abnormality");
  });
});

describe("an OBSERVATIONS answer must cover the dictation, not only stay inside it", () => {
  const DICTATION = "L4-5 diffuse bulge, bilateral recess narrowing, LF hypertrophy, canal 8.2 mm.";

  const snap = parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    findings: DICTATION,
    impression: "",
    recommendation: "",
    observations: [],
  });

  function obsDraft(observations: ProposedObservation[]): ComposerDraftOutput {
    return {
      findings: "",
      impression: "",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
      observations,
    };
  }

  const COMPLETE = [
    { concept: "disc bulge", level: "L4-5", findingsText: "Diffuse disc bulge at L4-5." },
    {
      concept: "recess narrowing",
      level: "L4-5",
      laterality: "bilateral",
      findingsText: "Bilateral recess narrowing at L4-5.",
    },
    {
      concept: "ligamentum flavum hypertrophy",
      findingsText: "Hypertrophy of the ligamentum flavum.",
    },
    {
      concept: "canal diameter",
      level: "L4-5",
      measurement: "8.2 mm",
      findingsText: "Canal AP diameter 8.2 mm at L4-5.",
    },
  ];

  it("passes when every dictated fact is carried by a row", () => {
    const result = validateComposerOutput(snap, obsDraft(COMPLETE), { kind: "OBSERVATIONS" });
    expect(result.errors).toEqual([]);
    expect(result.conservation?.droppedMeasurements).toEqual([]);
  });

  it("drops a measurement that was relabelled as a diagnosis it never stated", () => {
    // "canal 8.2 mm" is a number; "canal stenosis" is a conclusion. The row that
    // upgrades one to the other is ungrounded, and dropping it then loses the
    // number — which is exactly why the omission is reported as well.
    const relabelled = obsDraft([
      ...COMPLETE.slice(0, 3),
      {
        concept: "canal stenosis",
        level: "L4-5",
        measurement: "8.2 mm",
        findingsText: "Canal AP diameter 8.2 mm, causing canal stenosis at L4-5.",
      },
    ]);
    const result = validateComposerOutput(snap, relabelled, { kind: "OBSERVATIONS" });
    expect(result.warnings.join(" ")).toMatch(/Observation dropped as ungrounded.*stenosis/);
    expect(result.errors).toContain("measurement_dropped");
  });

  it("fails when the rows answer with one fact out of four", () => {
    const result = validateComposerOutput(snap, obsDraft([COMPLETE[0]]), { kind: "OBSERVATIONS" });
    // Every local model tried did exactly this, and the job reached READY as an
    // "accepted" proposal — nothing required the 8.2 mm to come back.
    expect(result.errors).toContain("measurement_dropped");
    expect(result.errors).toContain("laterality_dropped");
    expect(result.ok).toBe(false);
  });

  it("does not invent a loss when the dictation carried no measurement", () => {
    const bare = parseComposerSnapshot({
      modality: "MR",
      region: "LS Spine",
      findings: "L4-5 diffuse bulge.",
      impression: "",
      recommendation: "",
      observations: [],
    });
    const result = validateComposerOutput(
      bare,
      obsDraft([{ concept: "disc bulge", level: "L4-5", findingsText: "Diffuse bulge at L4-5." }]),
      { kind: "OBSERVATIONS" },
    );
    expect(result.errors).toEqual([]);
  });
});
