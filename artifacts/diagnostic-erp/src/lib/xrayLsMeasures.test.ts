/**
 * X-ray LS measurement model (spec §8, §11, §16; library §8, §10, §11, §12).
 * Every test here is about provenance: a number must be traceable to the view,
 * the level, the source values it was computed from, and — where the radiologist
 * overrode a derived figure — that override must be explicit.
 */
import { describe, expect, it } from "vitest";
import {
  buildLsMeasureAtoms,
  formatLsMeasurement,
  heightLossPercentFromHeights,
  lsMeasurementBlockers,
  lsMeasurementSentence,
  lsMeasurementViewHint,
  meyerdingLabel,
  parseLsMeasurement,
  slipPercentFromTranslation,
  type LsMeasurement,
} from "./xrayLsMeasures";
import { parseXrayLsViews } from "./xrayLsViews";
import { UNSET_LS_NUMBERING, type LsNumbering } from "./xrayLsNumbering";

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

const LIVE_PROTOCOL =
  "AP and lateral views of the lumbar spine (with flexion-extension views where indicated).";

const STANDARD_5: LsNumbering = {
  basis: "standard",
  lumbarTypeCount: 5,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const LSTV_6: LsNumbering = {
  basis: "lstv",
  lumbarTypeCount: 6,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const listhesis: LsMeasurement = {
  kind: "listhesis_translation",
  level: "L5-S1",
  upperLevel: "L5",
  lowerLevel: "S1",
  translationMm: 4.5,
  bodyApWidthMm: 15,
  view: "lateral",
  source: "viewer-caliper",
  direction: "anterolisthesis",
};

describe("derivations", () => {
  it("computes slip percentage only from a translation and a body diameter", () => {
    expect(slipPercentFromTranslation(4.5, 15)).toBe(30);
    expect(slipPercentFromTranslation(7.5, 15)).toBe(50);
    // Impossible or missing inputs return null, never a guessed fraction.
    expect(slipPercentFromTranslation(20, 15)).toBeNull();
    expect(slipPercentFromTranslation(4, 0)).toBeNull();
    expect(slipPercentFromTranslation(null, 15)).toBeNull();
    expect(slipPercentFromTranslation(0, 15)).toBeNull();
  });

  it("computes height loss only against a supplied reference", () => {
    expect(heightLossPercentFromHeights(18, 26)).toBe(30.8);
    expect(heightLossPercentFromHeights(26, 26)).toBeNull();
    expect(heightLossPercentFromHeights(28, 26)).toBeNull(); // no negative fracture
    expect(heightLossPercentFromHeights(18, null)).toBeNull();
  });

  it("grades a valid slip and refuses to grade without one", () => {
    // MEYERDING_GRADES bands, shared with the MRI reporters: I <25, II 25-50,
    // III 50-75, IV >75.
    expect(meyerdingLabel("II")).toBe("Meyerding grade II");
    expect(meyerdingLabel(null)).toBeNull();
    const built = buildLsMeasureAtoms({ measurements: [listhesis] }, parseXrayLsViews(FULL_SERIES));
    expect(built.observations[0].state).toBe("meyerding II (derived)");
    expect(built.observations[0].findingsText).toContain("Meyerding grade II derived from the measured slip.");
  });
});

describe("measurement sentences", () => {
  it("state the value, the level, the view and the source numbers", () => {
    const sentence = lsMeasurementSentence({
      ...listhesis,
      slipPercent: slipPercentFromTranslation(4.5, 15),
      source: "derived",
    });
    expect(sentence).toContain("Anterior displacement of L5 over S1 at L5-S1 on the lateral view");
    expect(sentence).toContain("measures 30% of the vertebral body width");
    expect(sentence).toContain("(4.5 mm against a vertebral body AP diameter of 15 mm)");
    expect(sentence).toContain("Meyerding grade II derived from the measured slip.");
  });

  it("never assign a grade to an unmeasured displacement", () => {
    const sentence = lsMeasurementSentence({
      kind: "listhesis_translation",
      level: "L4-L5",
      slipPercent: 0,
      mm: 2,
      view: "lateral",
      source: "manual-entry",
    });
    // A translation in millimetres is reportable; a percentage of an unmeasured
    // body diameter is not, and neither is a grade.
    expect(sentence).toContain("measures 2 mm.");
    expect(sentence).toContain(
      "No grade is assigned without a valid slip percentage of the measured vertebral body AP diameter.",
    );
    expect(sentence).not.toContain("Meyerding");
  });

  it("quote the measured and reference heights for a compression fracture", () => {
    expect(
      lsMeasurementSentence({
        kind: "vertebral_height_loss",
        level: "L1",
        measuredHeightMm: 18,
        referenceHeightMm: 26,
        heightLossPercent: 30.8,
        view: "lateral",
        source: "derived",
      }),
    ).toBe(
      "Loss of height of L1 on the lateral view is approximately 30.8% of the vertebral body height (measured 18 mm against a reference height of 26 mm).",
    );
  });

  it("name the Cobb end vertebrae, because the angle has no meaning without them", () => {
    expect(
      lsMeasurementSentence({
        kind: "cobb_angle",
        level: "L1-L5",
        upperLevel: "T12",
        lowerLevel: "L5",
        degrees: 34,
        view: "ap",
        source: "viewer-caliper",
      }),
    ).toBe("Cobb angle measured between T12 and L5 is 34 degrees on the AP view.");
  });

  it("mark an explicit override in the prose", () => {
    const sentence = lsMeasurementSentence({
      kind: "segmental_angulation",
      level: "L3-L4",
      degrees: 11,
      view: "flexion",
      source: "manual-entry",
      manualOverride: true,
    });
    expect(sentence).toContain("The value is a radiologist override of the derived figure.");
  });
});

describe("blockers", () => {
  const ctx = parseXrayLsViews(FULL_SERIES);

  it("require a level and the view the number was taken on", () => {
    expect(
      lsMeasurementBlockers({ ...listhesis, level: null, view: null }, ctx),
    ).toContain("A lumbosacral measurement must name a thoracolumbosacral level (T12-S1).");
    expect(lsMeasurementBlockers({ ...listhesis, view: "flexion" }, parseXrayLsViews(LIVE_PROTOCOL))).toEqual(
      expect.arrayContaining([
        "Flexion not recorded as performed, so the measurement cannot be supported.",
      ]),
    );
  });

  it("require a value: nothing is estimated on the radiologist's behalf", () => {
    expect(
      lsMeasurementBlockers(
        { kind: "listhesis_translation", level: "L4-L5", view: "lateral", source: "manual-entry" },
        ctx,
      ).join(" "),
    ).toContain("Enter a measured value");
  });

  it("refuse an L5-S1 measurement on a film that does not cover the junction", () => {
    const reasons = lsMeasurementBlockers(listhesis, parseXrayLsViews(LIVE_PROTOCOL)).join(" ");
    expect(reasons).toContain("coverage of the lumbosacral junction is not recorded");
  });

  it("refuse a dynamic-position measurement when only one position exists", () => {
    const reasons = lsMeasurementBlockers(
      { ...listhesis, view: "extension" },
      parseXrayLsViews("AP and lateral views of the lumbar spine. Extension view."),
    ).join(" ");
    expect(reasons).toContain("Dynamic translation requires both positions; the flexion view was not performed");
  });

  it("require Cobb end vertebrae in an upward-to-downward span", () => {
    const missing = lsMeasurementBlockers(
      { kind: "cobb_angle", level: "L3", degrees: 30, view: "ap", source: "viewer-caliper" },
      ctx,
    ).join(" ");
    expect(missing).toContain("must name the upper and lower end vertebrae");
    expect(
      lsMeasurementBlockers(
        {
          kind: "cobb_angle",
          level: "L5",
          upperLevel: "L5",
          lowerLevel: "T12",
          degrees: 30,
          view: "ap",
          source: "viewer-caliper",
        },
        ctx,
      ).join(" "),
    ).toContain("is not an upward-to-downward span");
  });

  it("reject a slip percentage that cannot exist", () => {
    expect(
      lsMeasurementBlockers({ ...listhesis, slipPercent: 140 }, ctx).join(" "),
    ).toContain('"140%" is not a possible slip percentage');
  });

  it("measure height loss on a body, not on a disc level", () => {
    expect(
      lsMeasurementBlockers(
        {
          kind: "vertebral_height_loss",
          level: "L1-L2",
          heightLossPercent: 20,
          view: "lateral",
          source: "manual-entry",
        },
        ctx,
      ).join(" "),
    ).toContain("Height loss is measured on a vertebral body, not on a disc level.");
  });

  it("block a level the recorded numbering cannot produce", () => {
    // The designated-L5 scheme labels the extra body S1, so an L6 measurement has
    // no level to attach to until the numbering is re-anchored.
    const reasons = lsMeasurementBlockers(
      {
        kind: "vertebral_height_loss",
        level: "L6",
        heightLossPercent: 25,
        view: "lateral",
        source: "manual-entry",
      },
      ctx,
      LSTV_6,
    ).join(" ");
    expect(reasons).toContain("cannot be produced by the recorded numbering basis");
  });

  it("check nothing extra when the numbering is unestablished", () => {
    // UNSET produces no label set, so the level check stays silent and the
    // numbering module is the one that raises the alarm.
    expect(
      lsMeasurementBlockers(
        { kind: "cobb_angle", level: "L1", upperLevel: "T12", lowerLevel: "L5", degrees: 12, view: "ap", source: "viewer-caliper" },
        ctx,
        UNSET_LS_NUMBERING,
      ),
    ).toEqual([]);
  });
});

describe("provenance round-trip", () => {
  it("survives format and parse with every source value intact", () => {
    const measurement: LsMeasurement = { ...listhesis, slipPercent: 30, source: "derived", derivedFrom: "translation 4.5 mm / body AP 15 mm" };
    const raw = formatLsMeasurement(measurement);
    expect(raw).toContain("Listhesis translation | 30%");
    expect(raw).toContain("level L5-S1");
    expect(raw).toContain("view lateral");
    expect(raw).toContain("source derived");
    expect(raw).toContain("direction anterolisthesis");
    expect(raw).toContain("sources translation 4.5 mm, body AP 15 mm");
    const parsed = parseLsMeasurement(raw);
    expect(parsed?.level).toBe("L5-S1");
    expect(parsed?.view).toBe("lateral");
    expect(parsed?.source).toBe("derived");
    expect(parsed?.direction).toBe("anterolisthesis");
    expect(parsed?.derivedFrom).toBe("translation 4.5 mm / body AP 15 mm");
    expect(parsed?.manualOverride).toBe(false);
    expect(parseLsMeasurement("")).toBeNull();
  });

  it("records an override rather than hiding it", () => {
    const parsed = parseLsMeasurement(
      formatLsMeasurement({ ...listhesis, slipPercent: 20, manualOverride: true, source: "manual-entry" }),
    );
    expect(parsed?.manualOverride).toBe(true);
  });

  it("carries the Cobb span", () => {
    const parsed = parseLsMeasurement(
      formatLsMeasurement({
        kind: "cobb_angle",
        level: "L3",
        upperLevel: "T12",
        lowerLevel: "L5",
        degrees: 28,
        view: "ap",
        source: "viewer-caliper",
      }),
    );
    expect(parsed?.span).toBe("T12 to L5");
  });
});

describe("measure atoms", () => {
  it("derive the percentage from the entered source values", () => {
    const built = buildLsMeasureAtoms({ measurements: [listhesis] }, parseXrayLsViews(FULL_SERIES));
    expect(built.rejected).toEqual([]);
    expect(built.observations[0].concept).toBe("ls_listhesis_measurement");
    expect(built.observations[0].findingsText).toContain("measures 30% of the vertebral body width");
    expect(built.observations[0].measurement).toContain("source derived");
    expect(built.observations[0].bundleId).toBe("xlsb-measures-ls");
  });

  it("stay metadata: no impression line, so interpretation remains human", () => {
    const built = buildLsMeasureAtoms({ measurements: [listhesis] }, parseXrayLsViews(FULL_SERIES));
    expect(built.observations[0].sectionsOwned).toEqual(["findings"]);
    expect(built.observations[0].incoming.impression).toBeUndefined();
  });

  it("return unsupported measurements as rejections with reasons", () => {
    const built = buildLsMeasureAtoms(
      { measurements: [listhesis, { ...listhesis, level: "T9", view: "ap" }] },
      parseXrayLsViews(LIVE_PROTOCOL),
    );
    expect(built.observations).toEqual([]);
    expect(built.rejected).toHaveLength(2);
    expect(built.rejected[0].reasons.join(" ")).toContain("lumbosacral junction");
  });

  it("tell the canvas which view is still missing", () => {
    const ctx = parseXrayLsViews(LIVE_PROTOCOL);
    expect(lsMeasurementViewHint({ ...listhesis, view: "flexion" }, ctx)).toBe(
      "Record the flexion view first.",
    );
    expect(lsMeasurementViewHint(listhesis, ctx)).toBe("");
    expect(lsMeasurementViewHint({ ...listhesis, view: null }, ctx)).toBe(
      "Choose the view this measurement was taken on.",
    );
  });
});
