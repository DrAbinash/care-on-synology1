/**
 * C2 — phrase fallback must attribute each dictated finding to the level it was
 * dictated at, and never to a level it was not.
 *
 * Levels, severity, laterality and grade used to be pooled from the whole
 * transcript and stamped on every matched concept, so a three-finding utterance
 * cross-multiplied into six observations — two of them findings at levels nobody
 * dictated. `composer.smartdictation.test.ts` asserted only
 * `observations.length >= 3`, which the six-observation output satisfies, so the
 * fabrication was invisible to the suite. These tests pin the PAIRS, not the
 * count, and pin the three faithful shapes the fix must not break.
 */
import { describe, expect, it } from "vitest";
import { deterministicCompose } from "./composer";
import { isPureLevelContinuation, splitDictationClauses } from "./transcriptNormalize";

const NORMAL_LS =
  "Lumbar vertebrae show normal alignment. Disc spaces are maintained. No significant disc bulge.";

const compose = (transcript: string) =>
  deterministicCompose({ transcript, region: "LS Spine", findingsText: NORMAL_LS });

const pairs = (transcript: string) =>
  (compose(transcript)?.observations ?? []).map((o) => `${o.concept}@${o.level}`);

describe("phrase fallback attributes findings to their own clause", () => {
  it("a three-finding utterance emits each finding at its dictated levels only", () => {
    expect(pairs(
      "Disc desiccation at L3-4 and L4-5, diffuse disc bulge at L4-5, and ligamentum flavum hypertrophy at L4-5.",
    )).toEqual([
      "disc_desiccation@L3-L4",
      "disc_desiccation@L4-L5",
      "disc_bulge@L4-L5",
      "ligamentum_flavum_hypertrophy@L4-L5",
    ]);
  });

  it("never invents a bulge or a ligamentum hypertrophy at L3-L4", () => {
    // The two observations the pooled-levels version fabricated. Named
    // individually because a count assertion passed while they existed.
    const emitted = pairs(
      "Disc desiccation at L3-4 and L4-5, diffuse disc bulge at L4-5, and ligamentum flavum hypertrophy at L4-5.",
    );
    expect(emitted).not.toContain("disc_bulge@L3-L4");
    expect(emitted).not.toContain("ligamentum_flavum_hypertrophy@L3-L4");
  });

  it("severity does not travel from one finding to the next", () => {
    const plan = compose("Mild left disc bulge at L4-5, severe central canal stenosis at L5-S1.")!;
    const texts = plan.observations.map((o) => o.findingsText ?? "").join(" | ");
    expect(texts).toMatch(/Severe central canal stenosis at L5-S1/);
    expect(texts).not.toMatch(/mild/i);
  });

  it("one finding across several levels still expands", () => {
    expect(pairs("Disc desiccation at L3-4 and L4-5.")).toEqual([
      "disc_desiccation@L3-L4",
      "disc_desiccation@L4-L5",
    ]);
  });

  it("a comma-separated level list keeps every level, not just the first", () => {
    // The clauses ", L4-5" and "and L5-S1" name no finding: they continue the
    // level list of the finding already being dictated. Dropping them would lose
    // dictated levels — as much a defect as inventing them.
    expect(pairs("Disc desiccation at L3-4, L4-5 and L5-S1.")).toEqual([
      "disc_desiccation@L3-L4",
      "disc_desiccation@L4-L5",
      "disc_desiccation@L5-S1",
    ]);
  });

  it("several findings sharing one level are all emitted at it", () => {
    const plan = compose("Disc desiccation at L4-5 and disc bulge at L4-5.")!;
    expect(plan.clarificationRequired).toBeNull();
    expect(pairs("Disc desiccation at L4-5 and disc bulge at L4-5.")).toEqual([
      "disc_desiccation@L4-L5",
      "disc_bulge@L4-L5",
    ]);
  });
});

describe("phrase fallback asks instead of guessing when a clause cannot be attributed", () => {
  it("two findings and two levels in one clause produce nothing at all", () => {
    const plan = compose("Disc desiccation at L3-L4 and disc bulge at L4-L5.");
    expect(plan, "an unresolvable utterance must still get an answer").not.toBeNull();
    expect(plan!.observations).toEqual([]);
    expect(plan!.impressionCandidates ?? []).toEqual([]);
    expect(plan!.removeConflictingBaselineConcepts ?? []).toEqual([]);
    expect(plan!.clarificationRequired).toMatch(/Which level belongs to which finding/);
  });

  it("the refusal names the findings and the levels so it can be acted on", () => {
    const message = compose("Disc desiccation at L3-L4 and disc bulge at L4-L5.")!
      .clarificationRequired ?? "";
    expect(message).toMatch(/L3-L4/);
    expect(message).toMatch(/L4-L5/);
    expect(message.toLowerCase()).toContain("disc desiccation");
    expect(message.toLowerCase()).toContain("disc bulge");
  });

  it("re-punctuating the same dictation with a comma resolves it", () => {
    // The clinician's recovery path, straight out of the refusal message.
    expect(compose("Disc desiccation at L3-L4 and disc bulge at L4-L5.")!.clarificationRequired)
      .toBeTruthy();
    expect(compose("Disc desiccation at L3-4, and disc bulge at L4-5.")!.clarificationRequired)
      .toBeNull();
  });
});

describe("isPureLevelContinuation", () => {
  it("recognises a bare level list as a continuation", () => {
    expect(isPureLevelContinuation("L4-5")).toBe(true);
    expect(isPureLevelContinuation("and L5-S1")).toBe(true);
    expect(isPureLevelContinuation("L4-5 and L5-S1")).toBe(true);
  });

  it("refuses to treat a clause naming anything else as a continuation", () => {
    // Folding this would hand the previous finding an S2 level nobody dictated.
    expect(isPureLevelContinuation("perineural cyst at S2")).toBe(false);
    expect(isPureLevelContinuation("mild")).toBe(false);
  });
});

describe("clause attribution across the spine regions", () => {
  const composeIn = (transcript: string, region: string) =>
    deterministicCompose({ transcript, region, findingsText: NORMAL_LS });

  it("cervical findings each keep their own cervical level", () => {
    const pairsOf = (transcript: string, region: string) =>
      (composeIn(transcript, region)?.observations ?? []).map((o) => `${o.concept}@${o.level}`);
    expect(pairsOf("Disc bulge at C5-C6, and central canal stenosis at C6-C7.", "Cervical Spine"))
      .toEqual(["disc_bulge@C5-C6", "cervical_canal_stenosis@C6-C7"]);
  });

  it("dorsal findings each keep their own dorsal level", () => {
    const plan = composeIn(
      "Disc bulge at T7-T8, and ligamentum flavum hypertrophy at T9-T10.", "Dorsal Spine");
    const pairsOf = (plan!.observations ?? []).map((o) => `${o.concept}@${o.level}`);
    expect(pairsOf).toEqual(["dorsal_disc_bulge@T7-T8", "ligamentum_flavum_hypertrophy@T9-T10"]);
  });

  it("a level from an unrecognised neighbouring finding is never borrowed", () => {
    // "arachnoid cyst at T9-T10" is not in the catalog. If a no-finding clause
    // folded into the finding before it, the bulge would expand across the
    // pooled levels and emit a DISC BULGE AT T9-T10 that nobody dictated.
    //
    // Do not "simplify" this to an S2 level: extractLevels returns as soon as it
    // finds a level pair, so a trailing "S2" is never extracted and the same
    // fold produces no fabrication — that variant passes with or without the fix.
    const plan = composeIn("Disc bulge at L4-5, arachnoid cyst at T9-T10.", "LS Spine")!;
    expect(plan.observations.map((o) => `${o.concept}@${o.level}`)).toEqual(["disc_bulge@L4-L5"]);
    expect(plan.clarificationRequired).toBeNull();
  });
});

describe("splitDictationClauses", () => {
  it("does not split on 'and', which separates levels within one finding", () => {
    expect(splitDictationClauses("Disc desiccation at L3-4 and L4-5.")).toEqual([
      "Disc desiccation at L3-4 and L4-5.",
    ]);
  });

  it("splits on commas and trims the list's trailing conjunction", () => {
    expect(splitDictationClauses("bulge at L4-5, and stenosis at L5-S1.")).toEqual([
      "bulge at L4-5",
      "stenosis at L5-S1.",
    ]);
  });

  it("drops empty clauses from stray punctuation", () => {
    expect(splitDictationClauses("bulge at L4-5,, , ")).toEqual(["bulge at L4-5"]);
  });
});
