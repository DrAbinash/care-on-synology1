import { describe, expect, it } from "vitest";
import { normalizeForDedupe } from "../reportFieldMerge";
import {
  activeSuppressors,
  canonicalOrderFromBaseline,
  claimsDeclaredBy,
  falsifies,
  filterRestorableBaselines,
  insertAtCanonicalPosition,
  mergeBaselineClaims,
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

  it("scopes a concept-level claim to the level the baseline names", () => {
    // A three-level cervical composition retires each level's own normal at click time
    // and must be able to hand each one back when that box is clicked off. The oracle
    // had no level, so a bulge at C5-C6 also falsified the C4-C5 normal, and once that
    // row's record left with it the C4-C5 sentence was gone from the report for good.
    const BULGE_C56 = { concept: "disc_contour", level: "C5-C6" };
    expect(falsifies(BULGE_C56, "C5-C6: No significant disc bulge or protrusion is seen.")).toBe(true);
    expect(falsifies(BULGE_C56, "L4-L5: No significant disc bulge or protrusion is seen.")).toBe(false);
  });

  it("keeps a declared study-wide claim falsifying, whatever level the observation carries", () => {
    // The shared-baseline fix routes through `baselineReplaces`, not the concept oracle, so
    // a level must not give it an escape hatch: two fractures at two levels still hold one
    // declared vertebral-body normal false, and it returns only when the last of them goes.
    const burst = { baselineReplaces: NORMAL_VERTEBRAE, concept: "burst_fracture", level: "C5-C6" };
    expect(falsifies(burst, NORMAL_VERTEBRAE)).toBe(true);
    expect(filterRestorableBaselines([NORMAL_VERTEBRAE], [burst])).toEqual([]);
  });

  it("falls back to the concept when either side names no level", () => {
    // Guessing a level boundary here would leave a contradicted normal printed beside
    // the abnormality that contradicts it, which is the worse failure.
    expect(falsifies({ concept: "disc_contour" }, "C5-C6: No significant disc bulge or protrusion is seen.")).toBe(true);
    expect(falsifies({ concept: "disc_contour", level: "C5-C6" }, "No significant disc bulge or protrusion is seen.")).toBe(true);
  });

  it("reads a regional bucket as covering every level inside that region", () => {
    // Whole-spine screening observations resolve to a bucket, not a disc space.
    expect(falsifies({ concept: "disc_contour", level: "lumbar" }, "L4-L5: No significant disc bulge or protrusion is seen.")).toBe(true);
    expect(falsifies({ concept: "disc_contour", level: "cervical" }, "L4-L5: No significant disc bulge or protrusion is seen.")).toBe(false);
  });

  it("ignores layout differences that are not clinical differences", () => {
    expect(falsifies({ baselineReplaces: `  ${NORMAL_VERTEBRAE}  ` }, NORMAL_VERTEBRAE)).toBe(true);
    expect(falsifies({ baselineReplaces: NORMAL_VERTEBRAE.toLowerCase() }, NORMAL_VERTEBRAE)).toBe(true);
  });

  it("treats an observation declaring nothing as falsifying nothing", () => {
    expect(falsifies({ baselineReplaces: "", concept: null }, NORMAL_VERTEBRAE)).toBe(false);
    expect(falsifies({}, NORMAL_VERTEBRAE)).toBe(false);
  });

  it("carries the level through from the ledger row", () => {
    // Without this the guard above can never see a level, and the set the store passes
    // is exactly the shape a removal is judged against.
    const rows = [{ id: "r1", observation: { concept: "disc_contour", level: "C5-C6", role: "finding" } }];
    expect(activeSuppressors(rows)).toEqual([{ baselineReplaces: null, concept: "disc_contour", level: "C5-C6" }]);
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
    expect(filterRestorableBaselines(replacedByTheRemovedPatch, [LESION_B]),
      "the surviving lesion still falsifies it").toEqual([]);
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

  it("never invents a sentence the caller did not put in scope", () => {
    // The filter is a filter. Which sentences are *in scope* for a removal is decided by the caller,
    // from the canonical baseline plus the removed observation's own declaration — see
    // `claimsDeclaredBy` below.
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

describe("Stage C-1 · a baseline claim is derived from the observation that makes it", () => {
  const canonical = canonicalOrderFromBaseline([NORMAL_VERTEBRAE, NORMAL_CORD, NORMAL_STENOSIS]);

  it("recovers a sentence the removed patch never recorded", () => {
    // The whole point. Two observations declare the same normal; the engine writes the record only on
    // whichever was clicked first, so the second one has an empty `replacedBaseline` and its own
    // removal restores nothing. The declaration is still on the observation, so asking it recovers
    // the sentence in either direction.
    expect(claimsDeclaredBy(LESION_B, canonical)).toEqual([NORMAL_VERTEBRAE]);
    expect(claimsDeclaredBy(LESION_A, canonical)).toEqual([NORMAL_VERTEBRAE]);
  });

  it("lists each claimed baseline sentence once", () => {
    expect(claimsDeclaredBy(LESION_A, [...canonical, canonical[0]])).toEqual([NORMAL_VERTEBRAE]);
  });

  it("claims nothing for an observation that declares no baseline", () => {
    // Manual radiologist text reaches the reducer this way: it is an observation with no declared
    // baseline, so it can never authorise writing a canonical sentence back into the field.
    expect(claimsDeclaredBy({ concept: "prior_surgery", baselineReplaces: null }, canonical)).toEqual([]);
    expect(claimsDeclaredBy({}, canonical)).toEqual([]);
    expect(claimsDeclaredBy(null, canonical)).toEqual([]);
  });

  it("does not widen a claim into a sentence the baseline does not state", () => {
    // A concept alone is *not* a licence to insert text — that route decides only whether a normal may
    // come back (`suppressedKeys`), never what gets written.
    const unrelated = canonicalOrderFromBaseline(["Synthetic knees are unremarkable."]);
    expect(claimsDeclaredBy(LESION_A, unrelated)).toEqual([]);
  });

  it("refuses a row whose own words are the sentence", () => {
    // The region-transition case, and the reason the guard exists. A Whole Spine report moved to
    // Cervical Spine retires its dorsal rows one at a time through the same removal path, and each row
    // carries `baselineReplaces` naming the sentence it rendered. Treating that as a retired normal
    // would put back, line by line, exactly what the transition withdrew.
    const dorsal = "Synthetic dorsal spine alignment is within normal limits.";
    expect(claimsDeclaredBy(
      { baselineReplaces: dorsal, concept: "alignment", renderedText: dorsal },
      canonicalOrderFromBaseline([dorsal, NORMAL_VERTEBRAE]),
    )).toEqual([]);
    expect(claimsDeclaredBy(
      { baselineReplaces: dorsal, renderedText: `Incidental note. ${dorsal} at the upper limit.` },
      canonicalOrderFromBaseline([dorsal]),
    ), "a row that renders the sentence inside its own longer wording is still the sentence speaking")
      .toEqual([]);
    expect(claimsDeclaredBy(
      { baselineReplaces: NORMAL_VERTEBRAE, renderedText: "Synthetic burst fracture of the C5 body." },
      canonicalOrderFromBaseline([dorsal, NORMAL_VERTEBRAE]),
    ), "an abnormality naming a normal it did not write keeps the claim — that is the defect this fixes")
      .toEqual([NORMAL_VERTEBRAE]);
  });

  it("refuses a row that asserts the normal rather than opposing it", () => {
    // `role === "baseline"` is the catalogue's own spelling of "this row IS a normal", and it is the
    // same fact as the test above in a different vocabulary. Both are checked, because a census that
    // matches one spelling and misses the other is how the retirement came back.
    const dorsal = "Synthetic dorsal spine alignment is within normal limits.";
    expect(claimsDeclaredBy(
      { role: "baseline", baselineReplaces: dorsal, renderedText: "something else entirely" },
      canonicalOrderFromBaseline([dorsal]),
    )).toEqual([]);
  });

  it("matches a declaration that differs only in layout", () => {
    const spaced = canonicalOrderFromBaseline([`  ${NORMAL_VERTEBRAE.toUpperCase()}  `]);
    expect(claimsDeclaredBy(LESION_A, spaced)).toEqual([`  ${NORMAL_VERTEBRAE.toUpperCase()}  `]);
  });

  it("unions a recorded list with a derived one without duplicating", () => {
    expect(mergeBaselineClaims([NORMAL_VERTEBRAE], [NORMAL_VERTEBRAE, NORMAL_CORD]))
      .toEqual([NORMAL_VERTEBRAE, NORMAL_CORD]);
    expect(mergeBaselineClaims([], [NORMAL_CORD])).toEqual([NORMAL_CORD]);
    expect(mergeBaselineClaims([NORMAL_CORD], [])).toEqual([NORMAL_CORD]);
    const held = `${NORMAL_CORD}.`;
    expect(mergeBaselineClaims([held], [NORMAL_CORD]),
      "a trailing period is layout, not a second sentence — and the wording already on the record wins,"
      + " because that is the text the ledger was written against")
      .toEqual([held]);
  });
});

describe("Stage C-1 · who counts as a suppressor", () => {
  const holder = (over: Record<string, unknown>) => ({
    id: "obs-1",
    observation: { role: "finding", baselineReplaces: NORMAL_VERTEBRAE, concept: "burst_fracture" },
    ...over,
  });

  it("takes the claim from a selected abnormality", () => {
    expect(activeSuppressors([holder({})])).toEqual([
      { baselineReplaces: NORMAL_VERTEBRAE, concept: "burst_fracture" },
    ]);
  });

  it("excludes a stale row, which holds no clinical claim", () => {
    // A stale patch is a baseline whose text was emptied when something else took its place. Counting
    // it as a falsifier would keep a normal retired after the abnormality that retired it is gone.
    expect(activeSuppressors([holder({ stale: true })])).toEqual([]);
  });

  it("excludes a baseline-role observation, which asserts normality rather than opposing it", () => {
    expect(activeSuppressors([holder({ observation: { role: "baseline", baselineReplaces: NORMAL_CORD } })]))
      .toEqual([]);
  });

  it("keeps two abnormalities that share one normal as two suppressors", () => {
    // The case this module exists for: dropping either one must leave the other still suppressing.
    expect(activeSuppressors([holder({ id: "a" }), holder({ id: "b" })]).length).toBe(2);
  });

  it("excludes a row that declares neither a baseline nor a concept", () => {
    expect(activeSuppressors([holder({ observation: { role: "finding" } })])).toEqual([]);
    expect(activeSuppressors([holder({ observation: null })])).toEqual([]);
  });
});
