/**
 * X-ray Cervical Spine VIEW / ADEQUACY model (spec §2, and the view half of
 * §15). The gates here are the whole point of the module: an odontoid claim
 * without an odontoid view, a foraminal claim without the oblique for that side,
 * and a dynamic claim on neutral films are the three ways a cervical radiograph
 * report goes wrong.
 */
import { describe, expect, it } from "vitest";
import {
  assessC7T1,
  assessDynamic,
  assessForaminal,
  assessOdontoid,
  c7t1Visualized,
  cervicalViewAllows,
  missingCervicalViewLabels,
  parseXrayCervicalViews,
  setCervicalAdequacyInTechnique,
  setCervicalInferiorLevelInTechnique,
  toggleCervicalViewInTechnique,
  unsupportedCervicalTechniqueStatements,
  odontoidNotAssessedSentence,
} from "./xrayCervicalViews";

const FULL_SERIES =
  "AP cervical radiograph. Lateral cervical radiograph. Open-mouth odontoid view. Right oblique views. Left oblique views. Flexion view. Extension view. The odontoid is adequately visualized. C7-T1 is adequately visualized. The inferior visualization extends to T1. No significant rotation. No motion artifact.";

const LATERAL_ONLY =
  "Lateral cervical radiograph. AP cervical radiograph. The inferior visualization extends to C6.";

describe("projection parsing", () => {
  it("reads every recorded view from a complete series", () => {
    const ctx = parseXrayCervicalViews(FULL_SERIES);
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.lateral).toBe(true);
    expect(ctx.performed.odontoid).toBe(true);
    expect(ctx.performed.obliqueRight).toBe(true);
    expect(ctx.performed.obliqueLeft).toBe(true);
    expect(ctx.performed.flexion).toBe(true);
    expect(ctx.performed.extension).toBe(true);
    expect(ctx.visualizedInferiorLevel).toBe("T1");
    expect(ctx.hasTechniqueSignal).toBe(true);
  });

  it("records nothing from an empty technique field", () => {
    const ctx = parseXrayCervicalViews("");
    expect(ctx.performed.odontoid).toBe(false);
    expect(ctx.performed.flexion).toBe(false);
    expect(ctx.adequacy.c7t1Visualization).toBe("unknown");
    expect(ctx.visualizedInferiorLevel).toBe("unknown");
    expect(ctx.hasTechniqueSignal).toBe(false);
  });

  it("distinguishes an oblique that names its side from one that does not", () => {
    const sided = parseXrayCervicalViews("Right oblique views.");
    expect(sided.performed.obliqueRight).toBe(true);
    expect(sided.performed.obliqueLeft).toBe(false);

    // An unattributed oblique is "other": it cannot support a side-specific
    // foraminal statement, so the gate below stays closed.
    const unsided = parseXrayCervicalViews("Oblique views obtained.");
    expect(unsided.performed.other).toBe(true);
    expect(unsided.performed.obliqueRight).toBe(false);
    expect(assessForaminal(unsided, "right").allowed).toBe(false);
  });
});

describe("the live seeded cervical protocol string", () => {
  // radiology_protocols.technique_text seeded by
  // migrations/zzzz_xr_gold_standard_content.sql for 'X-Ray Cervical Spine'.
  const SEEDED =
    "AP, lateral, and open-mouth odontoid views of the cervical spine (adequacy requires C7-T1 visualization).";

  it("recognises the views the protocol actually names", () => {
    const ctx = parseXrayCervicalViews(SEEDED);
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.lateral).toBe(true);
    expect(ctx.performed.odontoid).toBe(true);
    expect(assessOdontoid(ctx).allowed).toBe(true);
  });

  it("does not read a requirement as a recorded achievement", () => {
    // "adequacy requires C7-T1 visualization" states what adequacy MEANS; it
    // does not certify that C7-T1 was seen on this film.
    const ctx = parseXrayCervicalViews(SEEDED);
    expect(ctx.adequacy.c7t1Visualization).toBe("unknown");
    expect(c7t1Visualized(ctx)).toBe(false);
    expect(assessC7T1(ctx).allowed).toBe(false);
  });
});

describe("odontoid gating (spec §2, §8)", () => {
  it("blocks odontoid statements when no odontoid view was recorded", () => {
    const ctx = parseXrayCervicalViews(LATERAL_ONLY);
    const gate = assessOdontoid(ctx);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/no open-mouth odontoid view/i);
  });

  it("blocks odontoid statements when the view is recorded as inadequate", () => {
    const ctx = parseXrayCervicalViews(
      "Open-mouth odontoid view. The odontoid is not adequately visualized.",
    );
    expect(ctx.performed.odontoid).toBe(true);
    expect(ctx.adequacy.odontoidVisualization).toBe("limited");
    expect(assessOdontoid(ctx).allowed).toBe(false);
  });

  it("allows them when the view is recorded and diagnostic", () => {
    expect(assessOdontoid(parseXrayCervicalViews(FULL_SERIES)).allowed).toBe(true);
  });

  it("changes the normal odontoid wording instead of certifying unseen anatomy", () => {
    expect(odontoidNotAssessedSentence(parseXrayCervicalViews(LATERAL_ONLY))).toContain(
      "when adequately visualized on the views obtained",
    );
    expect(odontoidNotAssessedSentence(parseXrayCervicalViews(FULL_SERIES))).toBe(
      "Odontoid and C1-C2 alignment are unremarkable.",
    );
  });
});

describe("foraminal gating (spec §6, §7)", () => {
  const rightOnly = parseXrayCervicalViews("Right oblique views.");

  it("requires the oblique for the side being reported", () => {
    expect(assessForaminal(rightOnly, "right").allowed).toBe(true);
    expect(assessForaminal(rightOnly, "left").allowed).toBe(false);
    expect(assessForaminal(rightOnly, "left").reason).toMatch(/left oblique/i);
  });

  it("requires both obliques for a bilateral statement", () => {
    expect(assessForaminal(rightOnly, "bilateral").allowed).toBe(false);
    expect(assessForaminal(parseXrayCervicalViews(FULL_SERIES), "bilateral").allowed).toBe(true);
  });

  it("is blocked by rotation even when the views exist", () => {
    const rotated = parseXrayCervicalViews(
      "Right oblique views. Left oblique views. Patient rotation limits assessment of alignment and the oblique views.",
    );
    expect(rotated.adequacy.rotation).toBe("limited");
    expect(assessForaminal(rotated, "bilateral").allowed).toBe(false);
  });
});

describe("dynamic gating (spec §2, §10)", () => {
  it("cannot be assessed on neutral films alone", () => {
    const neutral = parseXrayCervicalViews(LATERAL_ONLY);
    const gate = assessDynamic(neutral);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/neutral films cannot demonstrate instability/i);
  });

  it("requires BOTH positions — one positional film is not a dynamic study", () => {
    const flexionOnly = parseXrayCervicalViews("Lateral cervical radiograph. Flexion view.");
    expect(flexionOnly.performed.flexion).toBe(true);
    const gate = assessDynamic(flexionOnly);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/extension/i);
  });

  it("is permitted when flexion and extension are both recorded", () => {
    expect(assessDynamic(parseXrayCervicalViews(FULL_SERIES)).allowed).toBe(true);
  });

  it("stays blocked when the lower cervical spine is not visualized", () => {
    const poor = parseXrayCervicalViews(
      "Flexion view. Extension view. C7-T1 is not adequately visualized.",
    );
    expect(assessDynamic(poor).allowed).toBe(false);
  });
});

describe("inferior visualization limit (spec §2, §5)", () => {
  it("reads the recorded limit and gates C7-T1 on it", () => {
    expect(parseXrayCervicalViews(LATERAL_ONLY).visualizedInferiorLevel).toBe("C6");
    expect(assessC7T1(parseXrayCervicalViews(LATERAL_ONLY)).allowed).toBe(false);
    expect(assessC7T1(parseXrayCervicalViews(FULL_SERIES)).allowed).toBe(true);
  });

  it("treats an explicit non-visualization statement as limited", () => {
    const ctx = parseXrayCervicalViews("Lateral cervical radiograph. C7-T1 is not adequately visualized.");
    expect(ctx.adequacy.c7t1Visualization).toBe("limited");
    expect(c7t1Visualized(ctx)).toBe(false);
  });
});

describe("unsupported statements (spec §15)", () => {
  it("flags an odontoid conclusion the recorded views cannot carry", () => {
    const ctx = parseXrayCervicalViews(LATERAL_ONLY);
    const details = unsupportedCervicalTechniqueStatements(ctx, "The odontoid is intact.");
    expect(details.some((d) => /odontoid/i.test(d))).toBe(true);
  });

  it("flags foraminal narrowing without any oblique", () => {
    const ctx = parseXrayCervicalViews(LATERAL_ONLY);
    const details = unsupportedCervicalTechniqueStatements(
      ctx,
      "Neural foraminal narrowing at C5-C6.",
    );
    expect(details.some((d) => /foraminal/i.test(d))).toBe(true);
  });

  it("flags dynamic language on neutral films", () => {
    const ctx = parseXrayCervicalViews(LATERAL_ONLY);
    const details = unsupportedCervicalTechniqueStatements(
      ctx,
      "There is dynamic translation at C5-C6 suggesting instability.",
    );
    expect(details.some((d) => /dynamic/i.test(d))).toBe(true);
  });

  it("does not flag the same statement once the supporting view is recorded", () => {
    const ctx = parseXrayCervicalViews(FULL_SERIES);
    expect(unsupportedCervicalTechniqueStatements(ctx, "The odontoid is intact.")).toEqual([]);
  });
});

describe("technique field write / read round-trip", () => {
  it("records and clears one view without disturbing the others", () => {
    const start = "Lateral cervical radiograph.";
    const withOdontoid = toggleCervicalViewInTechnique(start, "odontoid", true);
    expect(parseXrayCervicalViews(withOdontoid).performed.odontoid).toBe(true);
    expect(parseXrayCervicalViews(withOdontoid).performed.lateral).toBe(true);

    const back = toggleCervicalViewInTechnique(withOdontoid, "odontoid", false);
    expect(back).toBe(start);
    expect(parseXrayCervicalViews(back).performed.odontoid).toBe(false);
    expect(parseXrayCervicalViews(back).performed.lateral).toBe(true);
  });

  it("clearing one adequacy dimension leaves the others graded", () => {
    const both = setCervicalAdequacyInTechnique(
      setCervicalAdequacyInTechnique("", "odontoidVisualization", "adequate"),
      "motion",
      "limited",
    );
    const cleared = setCervicalAdequacyInTechnique(both, "motion", "unknown");
    const ctx = parseXrayCervicalViews(cleared);
    expect(ctx.adequacy.motion).toBe("unknown");
    expect(ctx.adequacy.odontoidVisualization).toBe("adequate");
  });

  it("moves the inferior limit rather than stacking contradictory sentences", () => {
    const c6 = setCervicalInferiorLevelInTechnique("", "C6");
    const t1 = setCervicalInferiorLevelInTechnique(c6, "T1");
    expect(t1).toBe("The inferior visualization extends to T1.");
    expect(parseXrayCervicalViews(t1).visualizedInferiorLevel).toBe("T1");
    const cleared = setCervicalInferiorLevelInTechnique(t1, "unknown");
    expect(cleared).toBe("");
  });

  it("preserves the radiologist's own technique prose", () => {
    const manual = "Film obtained after trauma; patient unable to rotate fully.";
    const next = toggleCervicalViewInTechnique(manual, "lateral", true);
    expect(next).toContain(manual);
    expect(next).toContain("Lateral cervical radiograph.");
  });

  it("never claims a view through the 'other' toggle", () => {
    expect(toggleCervicalViewInTechnique("Lateral cervical radiograph.", "other", true)).toBe(
      "Lateral cervical radiograph.",
    );
  });
});

describe("helpers used by the canvas", () => {
  it("lists the views a requirement is still missing", () => {
    const ctx = parseXrayCervicalViews(LATERAL_ONLY);
    expect(missingCervicalViewLabels(ctx, ["odontoid", "lateral"])).toEqual([
      "open-mouth odontoid",
    ]);
    expect(cervicalViewAllows(ctx, ["lateral", "ap"])).toBe(true);
    expect(cervicalViewAllows(ctx, ["lateral", "odontoid"])).toBe(false);
  });
});
