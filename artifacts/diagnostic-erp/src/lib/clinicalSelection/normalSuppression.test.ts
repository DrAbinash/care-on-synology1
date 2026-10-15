import { describe, expect, it } from "vitest";
import { normalizeForDedupe } from "../reportFieldMerge";
import {
  canonicalOrderFromBaseline,
  falsifies,
  filterRestorableBaselines,
  insertAtCanonicalPosition,
  suppressedKeys,
} from "./normalSuppression";

/**
 * Pure tests for set-based normal suppression.
 *
 * The fixtures are **synthetic by design**: the Stage B catalogue ships structural examination rows
 * only (`zzzzz_seed_clinical_catalogue_v4_examinations.sql` inserts 18 `clinical_examinations` and no
 * tiles, slots, relationships or publications), so nothing here is or claims to be approved clinical
 * content. The sentences are placeholders with the same *shape* as shipped ones — a declared
 * `baselineReplaces` string plus a resolved concept — because that is the interface the reducer reads.
 */

const NORMAL_VERTEBRAE = "Synthetic vertebral bodies demonstrate normal height and signal.";
const NORMAL_CORD = "Synthetic spinal cord signal intensity is normal.";
const NORMAL_STENOSIS = "No synthetic spinal canal stenosis is seen.";

const LESION_A = { baselineReplaces: NORMAL_VERTEBRAE, concept: "focal_lytic_lesion" };
const LESION_B = { baselineReplaces: NORMAL_VERTEBRAE, concept: "burst_fracture" };
const LESION_C = { baselineReplaces: NORMAL_CORD, concept: "syrinx" };

describe("Stage C-1 · falsification is a property of one observation", () => {
  it("reads an exactly declared baseline", () => {
    expect(falsifies(LESION_A, NORMAL_VERTEBRAE)).toBe(true);
    expect(falsifies(LESION_A, NORMAL_STENOSIS)).toBe(false);
  });

  it("ignores layout differences that are not clinical differences", () => {
    expect(falsifies({ baselineReplaces: `  ${NORMAL_VERTEBRAE}  ` }, NORMAL_VERTEBRAE)).toBe(true);
    expect(falsifies({ baselineReplaces: NORMAL_VERTEBRAE.toLowerCase() }, NORMAL_VERTEBRAE)).toBe(true);
  });

  it("treats an observation declaring nothing as falsifying nothing", () => {
    expect(falsifies({ baselineReplaces: "", concept: null }, NORMAL_VERTEBRAE)).toBe(false);
    expect(falsifies({}, NORMAL_VERTEBRAE)).toBe(false);
  });
});

describe("Stage C-1 · suppression is computed from the complete active set", () => {
  it("suppresses the same normal whether one or two observations claim it", () => {
    // Compared through the module's own key so the assertion cannot drift from `normalizeForDedupe`,
    // which drops trailing punctuation — a hardcoded expectation here failed for exactly that reason.
    expect([...suppressedKeys([LESION_A], [NORMAL_VERTEBRAE, NORMAL_CORD])])
      .toEqual([normalizeForDedupe(NORMAL_VERTEBRAE)]);
    expect(suppressedKeys([LESION_A], [NORMAL_CORD]).size, "the cord normal is not claimed").toBe(0);
    const both = suppressedKeys([LESION_A, LESION_B], [NORMAL_VERTEBRAE, NORMAL_CORD, NORMAL_STENOSIS]);
    expect(both.size, "two observations sharing one normal suppress one sentence, not two").toBe(1);
    expect(both.has(normalizeForDedupe(NORMAL_VERTEBRAE))).toBe(true);
  });

  it("returns the same suppression set for every permutation of the same selection", () => {
    const candidates = [NORMAL_VERTEBRAE, NORMAL_CORD, NORMAL_STENOSIS];
    const orders = [
      [LESION_A, LESION_B, LESION_C],
      [LESION_C, LESION_A, LESION_B],
      [LESION_B, LESION_C, LESION_A],
    ];
    const sets = orders.map((o) => [...suppressedKeys(o, candidates)].sort().join("|"));
    expect(new Set(sets).size, "membership, not sequence, decides suppression").toBe(1);
    expect(sets[0], "the three claims cover exactly two distinct normals")
      .toEqual([normalizeForDedupe(NORMAL_VERTEBRAE), normalizeForDedupe(NORMAL_CORD)].sort().join("|"));
  });
});

describe("Stage C-1 · a deselection restores only what nothing still falsifies", () => {
  it("restores nothing while a surviving observation still falsifies the normal", () => {
    // Both lesions claimed the normal; the engine recorded it against whichever was clicked first.
    const replacedByTheRemovedPatch = [NORMAL_VERTEBRAE];
    expect(filterRestorableBaselines(replacedByTheRemovedPatch, [LESION_B]))
      .toEqual([], "the surviving lesion still falsifies it");
  });

  it("restores exactly once, when the last falsifying observation is removed", () => {
    expect(filterRestorableBaselines([NORMAL_VERTEBRAE], []))
      .toEqual([NORMAL_VERTEBRAE]);
  });

  it("restores some and not others from one mixed record", () => {
    const replaced = [NORMAL_VERTEBRAE, NORMAL_CORD];
    expect(filterRestorableBaselines(replaced, [LESION_C]),
      "the syrinx still falsifies the cord sentence; the vertebral one is free to return")
      .toEqual([NORMAL_VERTEBRAE]);
  });

  it("never invents a sentence the removal did not record", () => {
    expect(filterRestorableBaselines([], [LESION_A, LESION_C])).toEqual([]);
  });
});

describe("Stage C-1 · a restored normal returns to its anatomical position", () => {
  const canonical = canonicalOrderFromBaseline([NORMAL_VERTEBRAE, NORMAL_CORD, NORMAL_STENOSIS]);

  it("does not append a normal beneath the pathology it contradicts", () => {
    const field = [
      "Focal synthetic lytic lesion of the C2 vertebral body.",
      NORMAL_CORD,
      NORMAL_STENOSIS,
    ].join("\n");
    const next = insertAtCanonicalPosition(field, NORMAL_VERTEBRAE, canonical);
    const lines = next.split("\n");
    expect(lines.length, "restoration adds exactly one line").toBe(4);
    expect(lines.indexOf(NORMAL_VERTEBRAE),
      "vertebral normal rejoins the normal block, before the cord sentence")
      .toBeLessThan(lines.indexOf(NORMAL_CORD));
    expect(lines.some((l) => l.includes("lytic lesion")),
      "the lesion line is not moved by a restoration").toBe(true);
  });

  it("is a no-op when the sentence is already present", () => {
    const field = [NORMAL_VERTEBRAE, NORMAL_CORD].join("\n");
    expect(insertAtCanonicalPosition(field, NORMAL_VERTEBRAE, canonical)).toBe(field);
  });

  it("appends only when the sentence has no canonical slot at all", () => {
    const field = NORMAL_CORD;
    const unplaceable = "A sentence nobody ordered.";
    expect(insertAtCanonicalPosition(field, unplaceable, canonical)).toBe(`${field}\n${unplaceable}`);
  });

  it("places before the first surviving canonical neighbour, not the first line", () => {
    const field = [
      "Focal synthetic lytic lesion of the C2 vertebral body.",
      NORMAL_STENOSIS,
    ].join("\n");
    const lines = insertAtCanonicalPosition(field, NORMAL_CORD, canonical).split("\n");
    expect(lines.indexOf(NORMAL_CORD), "cord precedes stenosis in the canonical order")
      .toBeLessThan(lines.indexOf(NORMAL_STENOSIS));
  });
});

describe("Stage C-1 · canonical order is derived, never remembered per patch", () => {
  it("numbers slots from the baseline's own sequence", () => {
    const slots = canonicalOrderFromBaseline([NORMAL_VERTEBRAE, NORMAL_CORD, NORMAL_STENOSIS]);
    expect(slots.map((s) => s.ordinal)).toEqual([0, 1, 2]);
  });

  it("honours explicit ordinals where a catalogue supplies them", () => {
    const slots = canonicalOrderFromBaseline([NORMAL_CORD, NORMAL_VERTEBRAE], [7, 2]);
    expect(slots.map((s) => s.ordinal)).toEqual([7, 2]);
  });
});
