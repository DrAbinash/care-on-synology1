import { describe, expect, it } from "vitest";
import {
  CERVICAL_ATOM_SOURCE,
  CERVICAL_DEFAULT_REGION,
  applyCervicalTemplate,
  cervicalAtom,
  cervicalAtomsToPatches,
  cervicalBundleId,
  cervicalViewPhrase,
  unfilledCervicalTokens,
} from "./xrayCervicalAtoms";
import type { PendingPathologyPatch } from "./zai-workspace/store";

const onlyPatch = (patches: PendingPathologyPatch[], concept: string): PendingPathologyPatch => {
  const hit = patches.find((p) => p.concept === concept);
  if (!hit) throw new Error(`no patch for ${concept}`);
  return hit;
};

describe("applyCervicalTemplate", () => {
  it("fills each token and keeps an unchosen one visible", () => {
    expect(
      applyCervicalTemplate("Anterolisthesis of [upper] over [lower] at [level].", { level: "c5-6" }),
    ).toBe("Anterolisthesis of C5 over C6 at C5-C6.");
    expect(applyCervicalTemplate("Reduction at [level].", {})).toBe("Reduction at [level].");
    expect(applyCervicalTemplate("[Side] narrowing on the [side] oblique.", { laterality: "left" })).toBe(
      "Left narrowing on the left oblique.",
    );
    expect(applyCervicalTemplate("[Side] narrowing.", {})).toBe("[Side] narrowing.");
    expect(applyCervicalTemplate("[mm] mm at [level].", { mm: "12", level: "C2" })).toBe("12 mm at C2.");
    expect(applyCervicalTemplate("[grade] slip, [pct]%.", { grade: "I", percent: "18" })).toBe(
      "I slip, 18%.",
    );
    expect(applyCervicalTemplate("[deg] degrees of angulation.", { degrees: "9" })).toBe(
      "9 degrees of angulation.",
    );
    expect(applyCervicalTemplate("Disruption of the [line] line.", { line: "spinolaminar" })).toBe(
      "Disruption of the spinolaminar line.",
    );
    expect(applyCervicalTemplate("Seen on the [view] view.", { view: "flexion" })).toBe(
      "Seen on the flexion view.",
    );
  });

  it("uses the display spelling of a level, including C7-T1", () => {
    expect(applyCervicalTemplate("Narrowing at [level].", { level: "C7-D1" })).toBe("Narrowing at C7-T1.");
    expect(unfilledCervicalTokens("Narrowing at [level].")).toEqual(["[level]"]);
    expect(unfilledCervicalTokens("Narrowing at C5-C6.")).toEqual([]);
    expect(unfilledCervicalTokens("Disruption of the [line] line at [level].")).toEqual(["[line]", "[level]"]);
  });

  it("keeps an explicit upper / lower over the derived pair", () => {
    expect(
      applyCervicalTemplate("[upper] over [lower] at [level].", {
        level: "C5-C6",
        upperLevel: "C4",
        lowerLevel: "C5",
      }),
    ).toBe("C4 over C5 at C5-C6.");
  });
});

describe("cervicalAtomsToPatches", () => {
  const atoms = [
    cervicalAtom("cervical_disc_space", "Disc spaces are preserved."),
    cervicalAtom("foraminal_stenosis", "[Side] neural foraminal narrowing at [level].", {
      view: "obliqueRight",
      impression: "Foraminal narrowing at [level].",
      recommendation: "Clinical correlation.",
    }),
  ];

  const withTemplate = (template = { level: "C5-C6", laterality: "right" as const }) =>
    cervicalAtomsToPatches("Cervical Spine", cervicalBundleId("tile", "dg-x"), atoms, template);

  it("writes every atom through the structured-template source in one bundle", () => {
    const patches = withTemplate();
    expect(patches).toHaveLength(2);
    expect(patches.every((p) => p.source === CERVICAL_ATOM_SOURCE)).toBe(true);
    expect(patches.every((p) => p.bundleId === "xccb-tile-dg-x")).toBe(true);
    expect(patches.map((p) => p.id)).toEqual(["xccb-tile-dg-x-0", "xccb-tile-dg-x-1"]);
    expect(patches[0]?.region).toBe("Cervical Spine");
    expect(CERVICAL_DEFAULT_REGION).toBe("Cervical Spine");
  });

  it("normalizes the level into the slot identity and the ownership block", () => {
    const patches = withTemplate({ level: "c6-7", laterality: "right" });
    expect(patches[0]?.level).toBe("C6-C7");
    expect(patches[0]?.ownership.level).toBe("C6-C7");
  });

  it("keeps a non-cervical level verbatim rather than silently dropping it", () => {
    const patches = withTemplate({ level: "L4-L5", laterality: "right" });
    expect(patches[0]?.level).toBe("L4-L5");
  });

  it("records the view on the label and leaves the sentence untouched", () => {
    // Baseline sentences are supersession contracts: splicing a view phrase into
    // the prose would stop the abnormal atom finding the line it replaces.
    const patch = onlyPatch(withTemplate(), "foraminal_stenosis");
    expect(patch.findingsText).toBe("Right neural foraminal narrowing at C5-C6.");
    expect(patch.incoming.findings).toBe(patch.findingsText);
    expect(patch.incoming.impression).toBe("Foraminal narrowing at C5-C6.");
    expect(patch.incoming.recommendation).toBe("Clinical correlation.");
    expect(patch.label).toContain("right oblique view");
    expect(cervicalViewPhrase("obliqueRight")).toBe("right oblique");
    expect(patch.sectionsOwned).toEqual(["findings", "impression"]);
    expect(patch.supportsLaterality).toBe(true);
    expect(patch.ownership.baselineReplaces).toBe("");
  });

  it("keeps a baseline atom marked as baseline for the ledger", () => {
    const baseline = onlyPatch(
      cervicalAtomsToPatches("Cervical Spine", "b", [
        cervicalAtom("cervical_disc_space", "Disc spaces are preserved.", { role: "baseline" }),
      ]),
      "cervical_disc_space",
    );
    expect(baseline.role).toBe("baseline");
    expect(baseline.sectionsOwned).toEqual(["findings"]);
  });
});
