/**
 * spineCanvasSeed — unit contracts.
 *
 * A completely normal MRI spine study still costs one open + one chip + one
 * Apply per disc level (5 for lumbar, 6 for cervical, up to 12 for dorsal).
 * The seed plan is the pure half of the fix: which levels are still EMPTY
 * (per the canvas' own display derivation) and may be seeded with a normal
 * disc observation in one click. Levels that already carry structure are
 * never in the plan — a correction is a radiologist decision, not a button.
 *
 * Wiring pins live in spineCanvasSeed.sourceContract.test.ts.
 */
import { describe, expect, it } from "vitest";
import { planSpineNormalSeed } from "./spineCanvasSeed";

const L = (key: string, label: string, displayKind: string) => ({ key, label, displayKind });

describe("planSpineNormalSeed — what gets seeded", () => {
  it("1. seeds ONLY levels whose display kind is empty", () => {
    const plan = planSpineNormalSeed([
      L("L1-L2", "L1-L2", "empty"),
      L("L2-L3", "L2-L3", "structured"),
      L("L3-L4", "L3-L4", "empty"),
    ]);
    expect(plan.seeds.map((s) => s.key)).toEqual(["L1-L2", "L3-L4"]);
  });

  it("2. skips structured, stale, conflict AND template-narrative levels", () => {
    // template-narrative = the radiologist's prose already references this
    // level — seeding a structured normal beside their own words is exactly
    // the kind of silent rewrite the canvas must never do.
    const plan = planSpineNormalSeed([
      L("C2-C3", "C2-C3", "structured"),
      L("C3-C4", "C3-C4", "stale"),
      L("C4-C5", "C4-C5", "conflict"),
      L("C5-C6", "C5-C6", "template-narrative"),
      L("C6-C7", "C6-C7", "empty"),
    ]);
    expect(plan.seeds.map((s) => s.key)).toEqual(["C6-C7"]);
    expect(plan.skipped).toBe(4);
  });

  it("3. a fully empty study seeds every level, in anatomical order", () => {
    const plan = planSpineNormalSeed([
      L("L1-L2", "L1-L2", "empty"),
      L("L2-L3", "L2-L3", "empty"),
      L("L3-L4", "L3-L4", "empty"),
      L("L4-L5", "L4-L5", "empty"),
      L("L5-S1", "L5-S1", "empty"),
    ]);
    expect(plan.seeds.map((s) => s.key)).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    expect(plan.skipped).toBe(0);
  });

  it("4. a fully structured study yields an EMPTY plan (button hides itself)", () => {
    const plan = planSpineNormalSeed([
      L("T1-T2", "T1-T2", "structured"),
      L("T2-T3", "T2-T3", "structured"),
    ]);
    expect(plan.seeds).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("5. empty input → empty plan, no crash", () => {
    const plan = planSpineNormalSeed([]);
    expect(plan.seeds).toEqual([]);
    expect(plan.skipped).toBe(0);
  });

  it("6. seeds carry both the level label (apply identity) and the region key (coverage identity)", () => {
    const plan = planSpineNormalSeed([L("L4-L5", "L4-L5", "empty")]);
    expect(plan.seeds[0]).toEqual({ key: "L4-L5", label: "L4-L5" });
  });

  it("7. an unknown display kind is skipped, never seeded (fail closed)", () => {
    const plan = planSpineNormalSeed([
      L("X1-X2", "X1-X2", "loading"),
      L("X2-X3", "X2-X3", ""),
      L("X3-X4", "X3-X4", "EMPTY"),
    ]);
    // Only the exact lowercase "empty" counts — a case variant or novel kind
    // must never quietly become a seed.
    expect(plan.seeds).toEqual([]);
    expect(plan.skipped).toBe(3);
  });

  it("8. mixed case keeps order and counts honest", () => {
    const plan = planSpineNormalSeed([
      L("T1-T2", "T1-T2", "structured"),
      L("T2-T3", "T2-T3", "empty"),
      L("T3-T4", "T3-T4", "empty"),
      L("T4-T5", "T4-T5", "template-narrative"),
      L("T5-T6", "T5-T6", "empty"),
    ]);
    expect(plan.seeds.map((s) => s.key)).toEqual(["T2-T3", "T3-T4", "T5-T6"]);
    expect(plan.seeds.length + plan.skipped).toBe(5);
  });
});
