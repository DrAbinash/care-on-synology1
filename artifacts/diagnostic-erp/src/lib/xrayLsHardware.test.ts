/**
 * X-ray LS post-operative hardware model (spec §15; library §17). The property
 * under test is the graded one: equivocal perihardware lucency must stay
 * descriptive, and only a convincing lucency may be written as concerning for
 * loosening. Breakage and migration are stated as facts and carry the higher
 * severity so the critical workflow can pick them up.
 */
import { describe, expect, it } from "vitest";
import {
  LS_HARDWARE_LUCENCY_OPTIONS,
  buildLsHardwareAtoms,
  composeLsAdjacentSegmentSentence,
  composeLsHardwareSentence,
  lsHardwareContradiction,
  type LsHardwareInput,
} from "./xrayLsHardware";
import { LS_NORMAL_SENTENCES } from "./xrayLsNormalAtoms";
import { parseXrayLsViews } from "./xrayLsViews";
import { type LsNumbering } from "./xrayLsNumbering";

const TECHNIQUE = "AP lumbar radiograph. Lateral lumbar radiograph.";

const base: LsHardwareInput = {
  procedures: ["posteriorFusion", "pedicleScrewsRods"],
  components: ["pedicle screws", "rods"],
  levels: ["L4-L5"],
  continuity: "intact",
  position: "maintained",
  lucency: "absent",
  fusionMassPresent: true,
};

const LSTV_6: LsNumbering = {
  basis: "lstv",
  lumbarTypeCount: 6,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

describe("hardware prose", () => {
  it("names the procedure, the implants and the operated level", () => {
    const sentence = composeLsHardwareSentence(base);
    expect(sentence).toContain(
      "Post-operative changes of posterior fusion and pedicle screws and rods at L4-L5 are noted.",
    );
    expect(sentence).toContain("pedicle screws, rods are identified at L4-L5.");
    expect(sentence).toContain("Fusion mass is suggested at L4-L5.");
    expect(sentence).toContain("Hardware continuity is grossly maintained at L4-L5.");
    expect(sentence).toContain("Hardware position is maintained at L4-L5.");
    expect(sentence).toContain("No convincing perihardware lucency at L4-L5.");
  });

  it("drops an unusable level instead of writing 'at' with nothing after it", () => {
    expect(composeLsHardwareSentence({ ...base, levels: ["sacrum"] })).not.toContain(" at ");
  });

  it("keeps an equivocal observation descriptive (library §17)", () => {
    const sentence = composeLsHardwareSentence({ ...base, lucency: "equivocal" });
    expect(sentence).toContain("Equivocal perihardware lucency at L4-L5");
    expect(sentence).toContain("this is not diagnostic of loosening on plain radiographs");
    expect(sentence).not.toContain("concerning for loosening");

    const continuity = composeLsHardwareSentence({ ...base, continuity: "equivocal" });
    expect(continuity).toContain("Hardware continuity is equivocal at L4-L5");
    expect(continuity).toContain("overlap limits assessment");
  });

  it("reserves the diagnostic wording for a convincing lucency", () => {
    expect(composeLsHardwareSentence({ ...base, lucency: "convincing" })).toContain(
      "Convincing perihardware lucency at L4-L5, concerning for loosening.",
    );
  });

  it("states breakage and migration as facts", () => {
    expect(composeLsHardwareSentence({ ...base, continuity: "broken" })).toContain(
      "Hardware breakage is identified at L4-L5.",
    );
    expect(composeLsHardwareSentence({ ...base, position: "migrated" })).toContain(
      "Hardware migration is identified at L4-L5.",
    );
  });

  it("says what was not assessed rather than implying normality", () => {
    const sentence = composeLsHardwareSentence({
      ...base,
      continuity: "notAssessed",
      position: "notAssessed",
      lucency: "notAssessed",
    });
    expect(sentence).toContain("Hardware continuity is not assessed on these radiographs.");
    expect(sentence).toContain("Hardware position is not assessed on these radiographs.");
    expect(sentence).toContain("Perihardware lucency is not assessed at L4-L5.");
  });

  it("closes a free-text note so the Findings stay readable", () => {
    expect(composeLsHardwareSentence({ ...base, note: "Prior fixation at L4-L5" })).toContain(
      "Prior fixation at L4-L5.",
    );
  });

  it("refuses an adjacent-segment sentence without a level", () => {
    expect(composeLsAdjacentSegmentSentence("L3-L4")).toBe(
      "Adjacent-segment degeneration at L3-L4 with disc-space height loss, marginal osteophytes and endplate sclerosis.",
    );
    expect(composeLsAdjacentSegmentSentence(null)).toBeNull();
    expect(composeLsAdjacentSegmentSentence("below the field of view")).toBeNull();
  });

  it("offers the four lucency grades the library asks for", () => {
    expect(LS_HARDWARE_LUCENCY_OPTIONS.map((o) => o.value)).toEqual([
      "absent",
      "equivocal",
      "convincing",
      "notAssessed",
    ]);
  });
});

describe("hardware consistency", () => {
  it("catches intact continuity paired with migration", () => {
    expect(
      lsHardwareContradiction({ ...base, continuity: "intact", position: "migrated" }).map((w) => w.code),
    ).toContain("hardware-intact-migrated");
  });

  it("catches absent lucency paired with breakage", () => {
    expect(
      lsHardwareContradiction({ ...base, continuity: "broken", lucency: "absent" }).map((w) => w.code),
    ).toContain("hardware-lucency-continuity");
  });

  it("catches a post-operative statement with no substrate", () => {
    expect(
      lsHardwareContradiction({
        procedures: [],
        components: [],
        levels: [],
        continuity: "intact",
        position: "maintained",
        lucency: "absent",
      }).map((w) => w.code),
    ).toContain("hardware-no-substrate");
  });

  it("catches an adjacent level that is not a vertebra", () => {
    const warnings = lsHardwareContradiction({ ...base, adjacentLevel: "somewhere" });
    expect(warnings.map((w) => w.code)).toContain("adjacent-level-unusable");
  });

  it("stays quiet on a coherent record", () => {
    expect(lsHardwareContradiction(base)).toEqual([]);
  });
});

describe("hardware atoms", () => {
  it("supersede the normal no-hardware sentence", () => {
    const built = buildLsHardwareAtoms(base, parseXrayLsViews(TECHNIQUE));
    const [patch] = built.observations;
    expect(patch.concept).toBe("ls_postop_hardware");
    expect(patch.level).toBe("L4-L5");
    expect(patch.bundleId).toBe("xlsb-hardware-ls");
    expect(patch.ownership.baselineReplaces).toBe(LS_NORMAL_SENTENCES.noHardware);
    expect(patch.ownership.anatomicalSection).toBe("hardware");
    expect(patch.incoming.impression).toBe("Post-operative changes as described.");
    expect(patch.severity).toBeUndefined();
  });

  it("raise severity and a complication impression for a hardware failure", () => {
    const built = buildLsHardwareAtoms(
      { ...base, lucency: "convincing" },
      parseXrayLsViews(TECHNIQUE),
    );
    const [patch] = built.observations;
    expect(patch.severity).toBe("high");
    // The finding carries the graded description; the impression says what it
    // means without naming a diagnosis the plain film cannot make.
    expect(patch.findingsText).toContain("concerning for loosening");
    expect(patch.incoming.impression).toContain("Post-operative hardware complication as described");
  });

  it("add an adjacent-segment atom when a level is selected", () => {
    const built = buildLsHardwareAtoms(
      { ...base, adjacentLevel: "L3-L4" },
      parseXrayLsViews(TECHNIQUE),
      { numbering: LSTV_6 },
    );
    expect(built.observations).toHaveLength(2);
    const adjacent = built.observations[1];
    expect(adjacent.concept).toBe("adjacent_segment_degeneration");
    expect(adjacent.level).toBe("L3-L4");
    expect(adjacent.incoming.impression).toBe("Adjacent-segment degeneration at L3-L4.");
  });

  it("warn about a level the recorded numbering cannot produce and keep the atom level-free", () => {
    const built = buildLsHardwareAtoms(
      { ...base, levels: ["L6"] },
      parseXrayLsViews(TECHNIQUE),
      { numbering: LSTV_6 },
    );
    expect(built.warnings.map((w) => w.code)).toContain("hardware-level-outside-numbering");
    expect(built.observations[0].level).toBeUndefined();
  });

  it("omit the adjacent atom when its level is not a vertebra", () => {
    const built = buildLsHardwareAtoms(
      { ...base, adjacentLevel: "upper lumbar" },
      parseXrayLsViews(TECHNIQUE),
    );
    expect(built.observations).toHaveLength(1);
    expect(built.warnings.map((w) => w.code)).toContain("adjacent-level-unusable");
  });

  it("write the region the canvas is bound to", () => {
    const built = buildLsHardwareAtoms(base, parseXrayLsViews(TECHNIQUE), { region: "Lumbosacral Spine" });
    expect(built.observations.every((p) => p.region === "Lumbosacral Spine")).toBe(true);
  });
});
