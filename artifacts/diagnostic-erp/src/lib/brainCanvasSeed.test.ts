/**
 * Unit contracts for planBrainNormalSeed — the plan behind the MRI Brain
 * canvas' "seed unmentioned systems normal" button.
 *
 * The spine canvases seed empty disc LEVELS; the brain has no levels — it has
 * ~20 anatomical systems, each with a protocol-aware normal sentence in
 * buildBrainNormalAtoms. The seed button fills ONLY the systems no observation
 * documents yet, so a report that already names an infarct can still say what
 * the rest of the brain showed with one click — without re-asserting a normal
 * the radiologist has already contradicted.
 */
import { describe, expect, it } from "vitest";
import { planBrainNormalSeed, type BrainSeedCandidate } from "./brainCanvasSeed";

describe("planBrainNormalSeed", () => {
  it("seeds every system no observation documents, in the built order", () => {
    const plan = planBrainNormalSeed([
      { concept: "brain_parenchyma", active: false },
      { concept: "infarct", active: true },
      { concept: "ventricles", active: false },
      { concept: "cerebellum", active: false },
    ]);
    expect(plan.seeds).toEqual(["brain_parenchyma", "ventricles", "cerebellum"]);
    expect(plan.skipped).toBe(1);
  });

  it("refuses every system an observation already documents — a documented system is a radiologist decision", () => {
    const plan = planBrainNormalSeed([
      { concept: "brain_parenchyma", active: true },
      { concept: "infarct", active: true },
    ]);
    expect(plan.seeds).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("an all-documented report yields an empty plan — the button hides", () => {
    expect(planBrainNormalSeed([{ concept: "x", active: true }]).seeds).toHaveLength(0);
  });

  it("an all-undocumented report seeds everything (complete normal, same as the preset)", () => {
    const plan = planBrainNormalSeed([
      { concept: "brain_parenchyma", active: false },
      { concept: "ventricles", active: false },
    ]);
    expect(plan.seeds).toEqual(["brain_parenchyma", "ventricles"]);
    expect(plan.skipped).toBe(0);
  });

  it("fails closed: a blank concept never seeds", () => {
    const plan = planBrainNormalSeed([
      { concept: "", active: false },
      { concept: "ventricles", active: false },
    ]);
    expect(plan.seeds).toEqual(["ventricles"]);
    expect(plan.skipped).toBe(1);
  });

  it("concept identity is exact — no fuzzy matching between concept keys", () => {
    // "infarct" (the normal-system concept) and a hypothetical abnormal-side
    // concept that merely CONTAINS the word must not be conflated.
    const plan = planBrainNormalSeed([
      { concept: "infarct", active: false },
      { concept: "chronic_infarct_changes", active: true },
    ]);
    expect(plan.seeds).toEqual(["infarct"]);
  });

  it("empty input yields an empty plan, never a throw", () => {
    expect(planBrainNormalSeed([])).toEqual({ seeds: [], skipped: 0 });
  });

  it("is pure — input is not mutated and repeated calls agree", () => {
    const input: BrainSeedCandidate[] = [
      { concept: "brainstem", active: false },
      { concept: "midline", active: true },
    ];
    const snapshot = JSON.stringify(input);
    const first = planBrainNormalSeed(input);
    const second = planBrainNormalSeed(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
