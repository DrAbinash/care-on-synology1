/**
 * X-ray Lumbosacral Spine VIEW / ADEQUACY / COVERAGE model (spec §2, and the
 * view half of §7, §8, §9, §13). These tests exist because the live LS protocol
 * is a conditional sentence: "(with flexion-extension views where indicated)"
 * must record AP and lateral without opening the dynamic workflow, and a pars or
 * SI-joint claim must be traceable to a projection that can support it.
 */
import { describe, expect, it } from "vitest";
import {
  assessDynamic,
  assessForaminal,
  assessL5S1,
  assessPars,
  assessSiJoints,
  assessT12L1,
  limitedLsAdequacyLabels,
  lsSiJointNormalSentence,
  lsL5S1NormalSentence,
  lsViewAllows,
  missingLsViewLabels,
  parseXrayLsViews,
  setLsAdequacyInTechnique,
  setLsCoverageInTechnique,
  toggleLsViewInTechnique,
  unsupportedLsTechniqueStatements,
  XRAY_LS_VIEW_SENTENCES,
} from "./xrayLsViews";

/** Verbatim technique_text seeded for the 'X-Ray Lumbar Spine' tab. */
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

const LIMITING_SERIES = [
  "AP lumbar radiograph.",
  "Lateral lumbar radiograph.",
  "The L5-S1 junction is obscured by bowel gas.",
  "The posterior elements are not adequately visualized.",
  "T12-L1 is not included in the field of view.",
  "The sacroiliac joints are not adequately visualized.",
  "Patient rotation limits assessment.",
].join(" ");

describe("performance parsing", () => {
  it("reads the live protocol as AP + lateral without opening the dynamic workflow", () => {
    const ctx = parseXrayLsViews(LIVE_PROTOCOL);
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.lateral).toBe(true);
    // The conditional is an offer, not an achievement (spec §9).
    expect(ctx.performed.flexion).toBe(false);
    expect(ctx.performed.extension).toBe(false);
    expect(ctx.performed.obliqueRight).toBe(false);
    expect(ctx.performed.obliqueLeft).toBe(false);
    expect(ctx.performed.spotL5S1).toBe(false);
    expect(ctx.hasTechniqueSignal).toBe(true);
  });

  it("still records the views when the conditional is written without brackets", () => {
    const ctx = parseXrayLsViews(
      "AP and lateral views of the lumbar spine with flexion-extension views where indicated.",
    );
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.lateral).toBe(true);
    expect(ctx.performed.flexion).toBe(false);
    expect(ctx.performed.extension).toBe(false);
  });

  it("records flexion and extension when they were actually performed", () => {
    const ctx = parseXrayLsViews(
      "AP and lateral views of the lumbar spine. Flexion and extension views were obtained.",
    );
    expect(ctx.performed.flexion).toBe(true);
    expect(ctx.performed.extension).toBe(true);
  });

  it("never infers a view from a statement that it was withheld", () => {
    const ctx = parseXrayLsViews(
      "AP view, no lateral. Oblique views were not performed. T12-L1 not included.",
    );
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.lateral).toBe(false);
    expect(ctx.performed.obliqueRight).toBe(false);
    expect(ctx.performed.obliqueLeft).toBe(false);
  });

  it("reads a complete series, including side-specific obliques and a spot view", () => {
    const ctx = parseXrayLsViews(FULL_SERIES);
    expect(
      lsViewAllows(ctx, ["ap", "lateral", "obliqueRight", "obliqueLeft", "flexion", "extension"]),
    ).toBe(true);
    expect(ctx.performed.spotL5S1).toBe(true);
    expect(missingLsViewLabels(ctx, ["ap", "flexion"])).toEqual([]);
  });

  it("treats an empty technique field as no signal at all", () => {
    const ctx = parseXrayLsViews("");
    expect(ctx.hasTechniqueSignal).toBe(false);
    expect(Object.values(ctx.performed).every((v) => v === false)).toBe(true);
    expect(Object.values(ctx.adequacy).every((v) => v === "unknown")).toBe(true);
    expect(ctx.inferiorCoverage).toBe("unknown");
  });
});

describe("adequacy and coverage parsing", () => {
  it("grades each dimension from the technique prose", () => {
    const ctx = parseXrayLsViews(FULL_SERIES);
    expect(ctx.adequacy.l5s1Visualization).toBe("adequate");
    expect(ctx.adequacy.posteriorElementVisualization).toBe("adequate");
    expect(ctx.adequacy.t12l1Included).toBe("adequate");
    expect(ctx.adequacy.siJointVisualization).toBe("adequate");
    expect(ctx.adequacy.rotation).toBe("adequate");
    expect(ctx.adequacy.motion).toBe("adequate");
    expect(ctx.inferiorCoverage).toBe("L5-S1");
    expect(limitedLsAdequacyLabels(ctx)).toEqual([]);
  });

  it("grades the limiting phrasings as limitations", () => {
    const ctx = parseXrayLsViews(LIMITING_SERIES);
    expect(ctx.adequacy.l5s1Visualization).toBe("limited");
    expect(ctx.adequacy.posteriorElementVisualization).toBe("limited");
    expect(ctx.adequacy.t12l1Included).toBe("limited");
    expect(ctx.adequacy.siJointVisualization).toBe("limited");
    expect(ctx.adequacy.rotation).toBe("limited");
    expect(ctx.inferiorCoverage).toBe("unknown");
    expect(limitedLsAdequacyLabels(ctx)).toEqual([
      "L5-S1 visualization",
      "posterior elements",
      "T12-L1 inclusion",
      "sacroiliac joints",
      "rotation",
    ]);
  });

  it("does not mistake an unrelated negation for an inadequacy", () => {
    const ctx = parseXrayLsViews(
      "Lateral lumbar radiograph. No fracture at L5-S1. The posterior elements are adequately visualized.",
    );
    expect(ctx.adequacy.l5s1Visualization).toBe("unknown");
    expect(ctx.adequacy.posteriorElementVisualization).toBe("adequate");
  });

  it("reads a hedged statement as a limitation, never as adequacy", () => {
    // This is the seeded normal prose; CARE must not certify its own caution.
    const ctx = parseXrayLsViews(
      "AP lumbar radiograph. The sacroiliac joints, where visualized, are unremarkable.",
    );
    expect(ctx.adequacy.siJointVisualization).toBe("limited");
  });

  it("grades sacral coverage as coverage below the junction", () => {
    const ctx = parseXrayLsViews(
      "AP and lateral views. The inferior coverage includes the sacrum below L5-S1.",
    );
    expect(ctx.inferiorCoverage).toBe("S1");
  });

  it("records coverage from the model-written sentence", () => {
    const ctx = parseXrayLsViews(
      setLsCoverageInTechnique("AP lumbar radiograph.", "L5-S1"),
    );
    expect(ctx.inferiorCoverage).toBe("L5-S1");
    expect(ctx.adequacy.l5s1Visualization).toBe("adequate");
  });
});

describe("gates", () => {
  it("blocks a pars claim unless the posterior elements are recorded as adequate", () => {
    // spec §7: "Do not diagnose a pars defect from an equivocal projection alone."
    expect(assessPars(parseXrayLsViews(LIVE_PROTOCOL)).allowed).toBe(false);
    expect(assessPars(parseXrayLsViews(LIVE_PROTOCOL)).reason).toContain("posterior elements");
    expect(assessPars(parseXrayLsViews(FULL_SERIES)).allowed).toBe(true);
    expect(assessPars(parseXrayLsViews(LIMITING_SERIES)).allowed).toBe(false);
  });

  it("requires an oblique projection for a unilateral pars defect", () => {
    const lateralOnly = parseXrayLsViews(
      "Lateral lumbar radiograph. The posterior elements are adequately visualized.",
    );
    expect(assessPars(lateralOnly).allowed).toBe(true);
    expect(assessPars(lateralOnly, { unilateral: true }).allowed).toBe(false);
    expect(assessPars(lateralOnly, { unilateral: true }).reason).toContain("oblique");
    const withObliques = parseXrayLsViews(
      "Lateral lumbar radiograph. Right oblique views. The posterior elements are adequately visualized.",
    );
    expect(assessPars(withObliques, { unilateral: true }).allowed).toBe(true);
  });

  it("blocks pars when rotation degrades the posterior elements", () => {
    const rotated = parseXrayLsViews(
      "Lateral lumbar radiograph. The posterior elements are adequately visualized. Patient rotation limits assessment.",
    );
    expect(assessPars(rotated).allowed).toBe(false);
    expect(assessPars(rotated).reason).toContain("rotation");
  });

  it("requires both positions for any dynamic claim", () => {
    // spec §9: neutral films cannot demonstrate instability.
    const neutral = parseXrayLsViews(LIVE_PROTOCOL);
    expect(assessDynamic(neutral).allowed).toBe(false);
    expect(assessDynamic(neutral).reason).toContain("Neutral films cannot demonstrate instability");
    const flexOnly = parseXrayLsViews(
      "AP and lateral views. Flexion views were obtained.",
    );
    expect(assessDynamic(flexOnly).allowed).toBe(false);
    expect(assessDynamic(flexOnly).reason).toContain("extension");
    expect(assessDynamic(parseXrayLsViews(FULL_SERIES)).allowed).toBe(true);
  });

  it("requires the oblique for the reported side for foraminal claims", () => {
    const ctx = parseXrayLsViews(
      "AP and lateral views. Right oblique views.",
    );
    expect(assessForaminal(ctx, "right").allowed).toBe(true);
    expect(assessForaminal(ctx, "left").allowed).toBe(false);
    expect(assessForaminal(ctx, "left").reason).toContain("left oblique");
    expect(assessForaminal(ctx, "bilateral").allowed).toBe(false);
  });

  it("requires demonstrated lumbosacral coverage for L5-S1 claims", () => {
    expect(assessL5S1(parseXrayLsViews(LIVE_PROTOCOL)).allowed).toBe(false);
    expect(assessL5S1(parseXrayLsViews(LIMITING_SERIES)).allowed).toBe(false);
    expect(assessL5S1(parseXrayLsViews(FULL_SERIES)).allowed).toBe(true);
    // A dedicated spot view is itself a demonstration of the junction.
    const withSpot = parseXrayLsViews("AP lumbar radiograph. Spot L5-S1 view.");
    expect(assessL5S1(withSpot).allowed).toBe(true);
  });

  it("requires T12-L1 inclusion before commenting on the upper junction", () => {
    expect(assessT12L1(parseXrayLsViews(LIVE_PROTOCOL)).allowed).toBe(false);
    expect(assessT12L1(parseXrayLsViews(LIMITING_SERIES)).allowed).toBe(false);
    expect(assessT12L1(parseXrayLsViews(FULL_SERIES)).allowed).toBe(true);
  });

  it("requires an AP projection for sacroiliac statements", () => {
    const lateralOnly = parseXrayLsViews("Lateral lumbar radiograph.");
    expect(assessSiJoints(lateralOnly).allowed).toBe(false);
    expect(assessSiJoints(parseXrayLsViews(LIVE_PROTOCOL)).allowed).toBe(true);
    expect(assessSiJoints(parseXrayLsViews(LIMITING_SERIES)).allowed).toBe(false);
  });
});

describe("coverage-aware normal prose", () => {
  it("matches the seeded caution when SI adequacy was never recorded", () => {
    expect(lsSiJointNormalSentence(parseXrayLsViews(LIVE_PROTOCOL))).toBe(
      "The sacroiliac joints, where visualized, are unremarkable.",
    );
    expect(lsSiJointNormalSentence(parseXrayLsViews(FULL_SERIES))).toBe(
      "The sacroiliac joints show no gross radiographic abnormality.",
    );
    expect(lsSiJointNormalSentence(parseXrayLsViews(LIMITING_SERIES))).toBe(
      "The sacroiliac joints are not assessed on the views obtained.",
    );
  });

  it("hedged junction prose when coverage is unrecorded", () => {
    const spot = parseXrayLsViews("AP lumbar radiograph. Spot L5-S1 view.");
    expect(lsL5S1NormalSentence(spot)).toBe(
      "The lumbosacral junction, where visualized, is unremarkable.",
    );
    expect(lsL5S1NormalSentence(parseXrayLsViews(FULL_SERIES))).toBe(
      "The lumbosacral junction is adequately visualized.",
    );
    expect(lsL5S1NormalSentence(parseXrayLsViews(LIVE_PROTOCOL))).toBe(
      "The lumbosacral junction is not adequately visualized on these radiographs.",
    );
  });
});

describe("technique statement support", () => {
  it("flags claims the recorded views cannot support", () => {
    const ctx = parseXrayLsViews(LIVE_PROTOCOL);
    const findings =
      "There is a pars defect at L5. Dynamic instability is present. The sacroiliac joints show ankylosis.";
    const unsupported = unsupportedLsTechniqueStatements(ctx, findings);
    expect(unsupported.join(" ")).toContain("a pars / posterior-element statement");
    expect(unsupported.join(" ")).toContain("a dynamic-alignment statement");
    expect(unsupported.join(" ")).toContain("a specific sacroiliac-joint abnormality");
    expect(unsupported.join(" ")).toContain("posterior elements is not recorded as adequate");
  });

  it("gates a named sacroiliac abnormality more tightly than a preserved statement", () => {
    // spec §13: an AP film may say the joints are preserved, but ankylosis needs
    // them demonstrably seen.
    const ctx = parseXrayLsViews("AP lumbar radiograph.");
    expect(unsupportedLsTechniqueStatements(ctx, "The sacroiliac joints are preserved.")).toEqual(
      [],
    );
    expect(
      unsupportedLsTechniqueStatements(ctx, "The sacroiliac joints show ankylosis.").join(" "),
    ).toContain("sacroiliac joints is not recorded as adequate");
  });

  it("stays quiet when the series supports the claims", () => {
    const ctx = parseXrayLsViews(FULL_SERIES);
    expect(
      unsupportedLsTechniqueStatements(
        ctx,
        "No pars defect. The sacroiliac joints are preserved. L5-S1 disc space is narrowed.",
      ),
    ).toEqual([]);
  });

  it("does not flag a statement whose supporting view was recorded", () => {
    const ctx = parseXrayLsViews(
      "AP lumbar radiograph. Lateral lumbar radiograph. Flexion view. Extension view. The L5-S1 junction is adequately visualized. The sacroiliac joints are adequately visualized. The posterior elements are adequately visualized.",
    );
    expect(
      unsupportedLsTechniqueStatements(
        ctx,
        "No dynamic instability. Pars interarticularis intact bilaterally.",
      ),
    ).toEqual([]);
  });
});

describe("technique writers", () => {
  it("appends and removes only its own sentence, preserving radiologist prose", () => {
    const base = "AP and lateral views of the lumbar spine (with flexion-extension views where indicated).";
    const withFlexion = toggleLsViewInTechnique(base, "flexion", true);
    expect(withFlexion).toContain(base);
    expect(withFlexion).toContain(XRAY_LS_VIEW_SENTENCES.flexion);
    expect(parseXrayLsViews(withFlexion).performed.flexion).toBe(true);
    expect(toggleLsViewInTechnique(withFlexion, "flexion", false)).toBe(base);
  });

  it("never asserts a projection it cannot name", () => {
    const base = "AP lumbar radiograph.";
    expect(toggleLsViewInTechnique(base, "other", true)).toBe(base);
  });

  it("round-trips each adequacy grade through the parser", () => {
    let text = "AP lumbar radiograph.";
    text = setLsAdequacyInTechnique(text, "posteriorElementVisualization", "adequate");
    expect(parseXrayLsViews(text).adequacy.posteriorElementVisualization).toBe("adequate");
    text = setLsAdequacyInTechnique(text, "posteriorElementVisualization", "limited");
    expect(parseXrayLsViews(text).adequacy.posteriorElementVisualization).toBe("limited");
    expect(text).toBe("AP lumbar radiograph. The posterior elements are not adequately visualized.");
    text = setLsAdequacyInTechnique(text, "posteriorElementVisualization", "unknown");
    expect(parseXrayLsViews(text).adequacy.posteriorElementVisualization).toBe("unknown");
    expect(text).toBe("AP lumbar radiograph.");
  });

  it("replaces one coverage sentence with another rather than stacking them", () => {
    const text = setLsCoverageInTechnique(
      setLsCoverageInTechnique("AP lumbar radiograph.", "L5-S1"),
      "S1",
    );
    expect(text).toBe("AP lumbar radiograph. The inferior coverage includes the sacrum below L5-S1.");
  });
});
