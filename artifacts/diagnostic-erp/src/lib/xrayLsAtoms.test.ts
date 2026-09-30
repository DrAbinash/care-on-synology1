/**
 * X-ray LS atom compiler — the only write path into the observation ledger
 * (spec §1, §16). These tests pin the ledger contract rather than the prose:
 * slot identity, bundle atomicity, baseline supersession and the rule that an
 * unfilled token stays visible instead of becoming an invented clinical fact.
 */
import { describe, expect, it } from "vitest";
import {
  applyLsTemplate,
  lsAtom,
  lsAtomsToPatches,
  lsBundleId,
  lsViewPhrase,
  unfilledLsTokens,
} from "./xrayLsAtoms";
import { LS_NORMAL_SENTENCES } from "./xrayLsNormalAtoms";

const details = (atoms: Parameters<typeof lsAtomsToPatches>[2], template?: Parameters<typeof lsAtomsToPatches>[3]) =>
  lsAtomsToPatches("Lumbar Spine", lsBundleId("tile", "test"), atoms, template);

describe("template filling", () => {
  it("normalizes the level into the prose so dictated spellings cannot leak", () => {
    expect(applyLsTemplate("Disc-space narrowing at [level].", { level: "l4-5" })).toBe(
      "Disc-space narrowing at L4-L5.",
    );
    expect(applyLsTemplate("[Level] is wedged.", { level: "D12" })).toBe("T12 is wedged.");
  });

  it("derives upper and lower from the normalized level", () => {
    expect(applyLsTemplate("[upper] over [lower].", { level: "L5 s1" })).toBe("L5 over S1.");
    expect(applyLsTemplate("[upper] over [lower].", { upperLevel: "L4", lowerLevel: "L5" })).toBe(
      "L4 over L5.",
    );
  });

  it("leaves an unfilled token visible instead of inventing a level", () => {
    // A silent omission would put a claim about an unspecified segment in front
    // of the radiologist; a visible token is caught by validation instead.
    const text = applyLsTemplate("Disc-space narrowing at [level].", {});
    expect(text).toBe("Disc-space narrowing at [level].");
    expect(unfilledLsTokens(text)).toEqual(["[level]"]);
    expect(unfilledLsTokens("No abnormality.")).toEqual([]);
  });

  it("fills the direction, grade and measurement tokens", () => {
    // [mm] substitutes the number only; the unit belongs to the catalog prose, so
    // a tile can say "mm", "degrees" or "% of the body width" explicitly.
    expect(
      applyLsTemplate("[direction] of [mm] mm at [level], [grade].", {
        direction: "anterolisthesis",
        mm: "5",
        level: "L5-S1",
        grade: "II",
      }),
    ).toBe("anterolisthesis of 5 mm at L5-S1, II.");
    expect(unfilledLsTokens(applyLsTemplate("[view] view.", {}))).toEqual(["[view]"]);
  });

  it("keeps laterality and view vocabulary readable", () => {
    expect(lsViewPhrase("obliqueRight")).toBe("right oblique");
    expect(lsViewPhrase("spotL5S1")).toBe("spot L5-S1");
    expect(lsViewPhrase(null)).toBeNull();
  });
});

describe("ledger patches", () => {
  it("keys slot identity on the normalized level", () => {
    const a = details([lsAtom("ls_disc_narrowing", "Narrowed at [level].", { level: "l4-5" })]);
    const b = details([lsAtom("ls_disc_narrowing", "Narrowed at [level].", { level: "L4-L5" })]);
    expect(a[0].level).toBe("L4-L5");
    expect(b[0].level).toBe(a[0].level);
    expect(a[0].ownership.level).toBe("L4-L5");
  });

  it("keeps an unusable level verbatim rather than losing it", () => {
    // The slot keeps what the radiologist typed even when it is not a level CARE
    // can place, so the report cannot silently drop it; validation surfaces it.
    const [patch] = details([lsAtom("ls_fracture", "Fracture of X9.", { level: "X9" })]);
    expect(patch.level).toBe("X9");
    expect(patch.label).toBe("ls_fracture (X9)");
    expect(patch.findingsText).toBe("Fracture of X9.");
  });

  it("fills prose and slot identity from the tile level selector", () => {
    const [patch] = details([lsAtom("ls_disc_narrowing", "Narrowed at [level].")], { level: "l4-5" });
    expect(patch.findingsText).toBe("Narrowed at L4-L5.");
    expect(patch.level).toBe("L4-L5");
  });

  it("records the projection on the label, never inside the sentence", () => {
    // Baseline sentences are the supersession contract: rewriting them to add a
    // view phrase would break the match and read like boilerplate.
    const [patch] = details([
      lsAtom("ls_pars_defect", "A pars defect is present.", { view: "obliqueLeft", level: "L5" }),
    ]);
    expect(patch.findingsText).toBe("A pars defect is present.");
    expect(patch.label).toBe("ls_pars_defect (L5) — left oblique view");
  });

  it("owns the impression section only when an impression was written", () => {
    const [findingOnly] = details([lsAtom("ls_osteophytes", "Marginal osteophytes at [level].", { level: "L3-L4" })]);
    expect(findingOnly.sectionsOwned).toEqual(["findings"]);
    const [withImpression] = details([
      lsAtom("ls_listhesis", "[direction] of [upper] over [lower].", {
        level: "L5-S1",
        impression: "Grade [grade] spondylolisthesis.",
      }),
    ]);
    expect(withImpression.sectionsOwned).toEqual(["findings", "impression"]);
  });

  it("carries the baseline supersession contract through to the patch", () => {
    const [patch] = details([
      lsAtom("ls_hardware", "Posterior fusion hardware is present.", {
        baselineReplaces: LS_NORMAL_SENTENCES.noHardware,
      }),
    ]);
    expect(patch.ownership.baselineReplaces).toBe(LS_NORMAL_SENTENCES.noHardware);
  });

  it("shares one bundleId across a tile so apply/remove/undo stay atomic", () => {
    const patches = details([
      lsAtom("ls_disc_narrowing", "Narrowed at L1-L2."),
      lsAtom("ls_osteophytes", "Osteophytes at L1-L2."),
    ]);
    expect(patches.map((p) => p.bundleId)).toEqual(["xlsb-tile-test", "xlsb-tile-test"]);
    expect(patches.map((p) => p.id)).toEqual(["xlsb-tile-test-0", "xlsb-tile-test-1"]);
  });

  it("defaults the anatomical section to the lumbosacral spine", () => {
    const [patch] = details([lsAtom("ls_any", "Statement.")]);
    expect(patch.ownership.anatomicalSection).toBe("lumbosacral spine");
    expect(patch.ownership.conflictGroup).toBe("ls_any");
    expect(patch.source).toBe("structured-template");
    expect(patch.region).toBe("Lumbar Spine");
  });

  it("propagates measurement provenance and severity untouched", () => {
    const [patch] = details([
      lsAtom("ls_listhesis_measurement", "Displacement measures 30%.", {
        level: "L5-S1",
        measurement: "Listhesis translation | 30% | level L5-S1 | view lateral | source derived",
        state: "meyerding II (derived)",
        severity: "moderate",
      }),
    ]);
    expect(patch.measurement).toContain("source derived");
    expect(patch.state).toBe("meyerding II (derived)");
    expect(patch.severity).toBe("moderate");
  });

  it("treats a level-bearing laterality statement as side-capable", () => {
    const [patch] = details([
      lsAtom("ls_facet_arthropathy", "Facet arthropathy is present.", {
        level: "L4-L5",
        laterality: "right",
      }),
    ]);
    expect(patch.supportsLaterality).toBe(true);
    expect(patch.laterality).toBe("right");
    expect(patch.label).toBe("ls_facet_arthropathy (L4-L5) right");
  });
});
