/**
 * X-ray LS flexion / extension workflow (spec §9; library §10). The two
 * properties that matter: the panel is closed unless both positions were
 * obtained, and CARE holds no instability threshold — a large measured change is
 * reported as a measurement, and only the radiologist's selection produces the
 * word "unstable".
 */
import { describe, expect, it } from "vitest";
import {
  LS_DYNAMIC_INTERPRETATION_OPTIONS,
  buildLsDynamicAtoms,
  derivedAngulationChangeDeg,
  derivedTranslationChangeMm,
  formatLsDynamicProvenance,
  lsDynamicEntryBlockers,
  lsDynamicHasContent,
  lsDynamicSentence,
  maxAngulationChangeDeg,
  maxTranslationChangeMm,
  type LsDynamicEntry,
} from "./xrayLsDynamic";
import { parseXrayLsViews } from "./xrayLsViews";
import { type LsNumbering } from "./xrayLsNumbering";

const BOTH_POSITIONS = parseXrayLsViews(
  [
    "AP lumbar radiograph.",
    "Lateral lumbar radiograph.",
    "Flexion view.",
    "Extension view.",
    "The L5-S1 junction is adequately visualized.",
  ].join(" "),
);

const NEUTRAL_ONLY = parseXrayLsViews(
  "AP and lateral views of the lumbar spine (with flexion-extension views where indicated).",
);

const entry: LsDynamicEntry = {
  level: "L4-L5",
  neutralTranslationMm: 2,
  flexionTranslationMm: 5,
  extensionTranslationMm: 3,
  neutralAngulationDeg: 4,
  flexionAngulationDeg: 12,
  extensionAngulationDeg: 6,
  interpretation: "instability",
  source: "viewer-caliper",
};

const LSTV_6: LsNumbering = {
  basis: "lstv",
  lumbarTypeCount: 6,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

describe("derived changes", () => {
  it("compute from the neutral value, position by position", () => {
    expect(derivedTranslationChangeMm(entry, "flexion")).toBe(3);
    expect(derivedTranslationChangeMm(entry, "extension")).toBe(1);
    expect(derivedAngulationChangeDeg(entry, "flexion")).toBe(8);
    expect(maxTranslationChangeMm(entry)).toBe(3);
    expect(maxAngulationChangeDeg(entry)).toBe(8);
  });

  it("need both sides of the subtraction", () => {
    expect(derivedTranslationChangeMm({ level: "L4-L5", flexionTranslationMm: 5 }, "flexion")).toBeNull();
    expect(
      derivedTranslationChangeMm({ level: "L4-L5", neutralTranslationMm: 2, extensionTranslationMm: null }, "extension"),
    ).toBeNull();
    expect(maxTranslationChangeMm({ level: "L4-L5", neutralTranslationMm: 2 })).toBeNull();
  });

  it("recognize an empty entry", () => {
    expect(lsDynamicHasContent({ level: "L4-L5" })).toBe(false);
    expect(lsDynamicHasContent({ level: "L4-L5", neutralTranslationMm: 0 })).toBe(true);
  });
});

describe("flexion / extension gating (spec §9)", () => {
  it("closes the whole panel on neutral films", () => {
    const built = buildLsDynamicAtoms({ ctx: NEUTRAL_ONLY, entries: [entry] });
    expect(built.blockedReason).toContain("No flexion or extension views are recorded");
    expect(built.observations).toEqual([]);
    expect(built.rejected).toHaveLength(1);
    expect(built.rejected[0].reasons.join(" ")).toContain("Neutral films cannot demonstrate instability");
  });

  it("refuses a one-sided comparison", () => {
    const flexOnly = parseXrayLsViews("AP and lateral views. Flexion view.");
    expect(lsDynamicEntryBlockers(entry, flexOnly).join(" ")).toContain("the extension view was not performed");
  });

  it("requires the lumbosacral junction to be covered before measuring motion there", () => {
    const noJunction = parseXrayLsViews("Flexion view. Extension view.");
    expect(
      lsDynamicEntryBlockers({ ...entry, level: "L5-S1" }, noJunction).join(" "),
    ).toContain("coverage of the lumbosacral junction is not recorded");
  });

  it("refuses an entry with no measurement at all", () => {
    expect(lsDynamicEntryBlockers({ level: "L4-L5", interpretation: null }, BOTH_POSITIONS).join(" ")).toContain(
      "Enter at least one measured translation or angulation value.",
    );
  });

  it("refuses a positional value that has no neutral comparison", () => {
    const reasons = lsDynamicEntryBlockers(
      { level: "L3-L4", flexionTranslationMm: 6 },
      BOTH_POSITIONS,
    ).join(" ");
    expect(reasons).toContain("add the neutral measurement");
  });

  it("blocks a segment the recorded numbering cannot produce", () => {
    expect(
      lsDynamicEntryBlockers({ ...entry, level: "L6" }, BOTH_POSITIONS, LSTV_6).join(" "),
    ).toContain("cannot be produced by the recorded numbering basis");
  });

  it("requires a named segment", () => {
    expect(lsDynamicEntryBlockers({ ...entry, level: null }, BOTH_POSITIONS).join(" ")).toContain(
      "Name the segment the measurements belong to",
    );
  });
});

describe("instability remains a radiologist selection", () => {
  it("refuses the interpretation without a measured change", () => {
    const reasons = lsDynamicEntryBlockers(
      { level: "L4-L5", neutralTranslationMm: 2, interpretation: "instability" },
      BOTH_POSITIONS,
    ).join(" ");
    expect(reasons).toContain("no change in translation or angulation has been measured");
  });

  it("applies the motion-limitation gate as well", () => {
    expect(
      lsDynamicEntryBlockers(
        { level: "L4-L5", neutralTranslationMm: 2, flexionTranslationMm: 2, interpretation: "motion-limitation" },
        NEUTRAL_ONLY,
      ).join(" "),
    ).toContain("both positions were not obtained");
  });

  it("never produces the word unstable from a number alone", () => {
    // A deliberately large change with no interpretation selected: the report
    // states millimetres and degrees, and adds no diagnosis.
    const large: LsDynamicEntry = {
      level: "L4-L5",
      neutralTranslationMm: 1,
      flexionTranslationMm: 13,
      extensionTranslationMm: 11,
      interpretation: "none",
    };
    const sentence = lsDynamicSentence(large);
    expect(maxTranslationChangeMm(large)).toBe(12);
    expect(sentence).toContain("a maximum change of 12 mm from neutral");
    expect(sentence.toLowerCase()).not.toContain("instab");
    expect(lsDynamicEntryBlockers(large, BOTH_POSITIONS)).toEqual([]);
  });

  it("writes the instability statement only as a selected interpretation", () => {
    const sentence = lsDynamicSentence(entry);
    expect(sentence).toContain("The reporting radiologist interprets L4-L5 as dynamically unstable.");
    expect(lsDynamicSentence({ ...entry, interpretation: null })).not.toContain("unstable");
    expect(LS_DYNAMIC_INTERPRETATION_OPTIONS.map((o) => o.value)).toEqual([
      "none",
      "instability",
      "motion-limitation",
    ]);
  });
});

describe("dynamic atoms and provenance", () => {
  it("record the source values, the derived change and the interpretation", () => {
    const built = buildLsDynamicAtoms({ ctx: BOTH_POSITIONS, entries: [entry] });
    expect(built.rejected).toEqual([]);
    const [patch] = built.observations;
    expect(patch.concept).toBe("ls_dynamic_assessment");
    expect(patch.level).toBe("L4-L5");
    expect(patch.bundleId).toBe("xlsb-dynamic-ls");
    expect(patch.findingsText).toContain(
      "Translation at L4-L5 measures neutral 2 mm, flexion 5 mm, extension 3 mm, a maximum change of 3 mm from neutral.",
    );
    expect(patch.findingsText).toContain("Segmental angulation at L4-L5 measures neutral 4 degrees");
    expect(patch.measurement).toContain("view flexion + extension");
    expect(patch.measurement).toContain("source viewer-caliper");
    expect(patch.measurement).toContain("interpretation instability (radiologist-selected)");
    expect(patch.incoming.impression).toContain("as selected by the reporting radiologist");
    expect(patch.severity).toBe("high");
  });

  it("give each entry its own conflict group so both can coexist", () => {
    const built = buildLsDynamicAtoms({
      ctx: BOTH_POSITIONS,
      entries: [entry, { ...entry, level: "L3-L4", interpretation: null }],
    });
    expect(built.observations).toHaveLength(2);
    expect(built.observations[0].ownership.conflictGroup).toBe("ls_dynamic_assessment_0");
    expect(built.observations[1].ownership.conflictGroup).toBe("ls_dynamic_assessment_1");
    expect(built.observations[1].severity).toBeUndefined();
    expect(built.observations[1].incoming.impression).toBeUndefined();
  });

  it("keep an unanchored entry's provenance readable", () => {
    const raw = formatLsDynamicProvenance(entry);
    expect(raw).toContain("level L4-L5");
    expect(raw).toContain("derived from neutral/flexion/extension translation (2, 5, 3 mm)");
    expect(raw).toContain("derived from neutral/flexion/extension angulation (4, 12, 6 degrees)");
    expect(formatLsDynamicProvenance({ level: "L2-L3", neutralTranslationMm: 1 })).toContain(
      "source manual-entry",
    );
  });

  it("append a free-text note with its own full stop", () => {
    expect(lsDynamicSentence({ ...entry, note: "Limited by pain at end range" })).toContain(
      "Limited by pain at end range.",
    );
  });
});
