import { describe, it, expect } from "vitest";
import {
  parseMeasurement,
  toMm,
  ellipsoidVolumeMl,
  isAffirmative,
  renderParams,
  generateUsgFinding,
  effectiveFindingText,
  initialFindingValues,
  type UsgFindingDef,
} from "./usgFindingBuilder";

describe("parseMeasurement — numeric parameter parsing", () => {
  it("parses a bare number with the default unit", () => {
    const p = parseMeasurement("5.5", { defaultUnit: "mm", normalizeTo: "mm" });
    expect(p.value).toBe(5.5);
    expect(p.unit).toBe("mm");
    expect(p.normalized).toBe(5.5);
    expect(p.display).toBe("5.5 mm");
  });

  it("honours an embedded unit over the default", () => {
    const p = parseMeasurement("3 cm", { defaultUnit: "mm", normalizeTo: "mm" });
    expect(p.value).toBe(3);
    expect(p.unit).toBe("cm");
    expect(p.normalized).toBe(30); // 3 cm → 30 mm
    expect(p.display).toBe("3 cm");
  });

  it("returns empty (null) for blank or garbage input, never throws", () => {
    for (const bad of ["", "   ", "abc", null, undefined, "5x5"]) {
      const p = parseMeasurement(bad as string, { defaultUnit: "mm" });
      expect(p.value).toBeNull();
      expect(p.display).toBe("");
    }
  });

  it("tidies trailing zeros in the display", () => {
    expect(parseMeasurement("3.0", { defaultUnit: "cm" }).display).toBe("3 cm");
    expect(parseMeasurement("3.50", { defaultUnit: "cm" }).display).toBe("3.5 cm");
  });
});

describe("mm/cm conversion", () => {
  it("cm→mm and mm→cm via normalizeTo", () => {
    expect(parseMeasurement("3.4 cm", { normalizeTo: "mm" }).normalized).toBe(34);
    expect(parseMeasurement("34 mm", { normalizeTo: "cm" }).normalized).toBe(3.4);
  });
  it("toMm converts a parsed length", () => {
    expect(toMm(parseMeasurement("2 cm"))).toBe(20);
    expect(toMm(parseMeasurement("7 mm"))).toBe(7);
  });
});

describe("ellipsoidVolumeMl — the single frontend volume source", () => {
  it("computes 0.523·L·W·H (mm) → mL, rounded to 2dp", () => {
    // 34 × 31 × 24 mm → 13.23 mL (the spec's ~13.2 cc, NOT 35 cc)
    expect(ellipsoidVolumeMl(34, 31, 24)).toBeCloseTo(13.23, 2);
  });
  it("returns null on any missing or non-positive dimension", () => {
    expect(ellipsoidVolumeMl(null, 31, 24)).toBeNull();
    expect(ellipsoidVolumeMl(34, 0, 24)).toBeNull();
    expect(ellipsoidVolumeMl(34, 31, -1)).toBeNull();
  });
});

describe("isAffirmative", () => {
  it("recognises affirmative answers", () => {
    for (const v of ["Yes", "present", "Positive", "true", "y"]) expect(isAffirmative(v)).toBe(true);
    for (const v of ["Absent", "no", "Negative", "", "Not assessed"]) expect(isAffirmative(v)).toBe(false);
  });
});

describe("renderParams — type-aware value rendering", () => {
  const def = {
    params: [
      { key: "n", label: "n", type: "number" as const, unit: "mm", normalizeTo: "mm" },
      { key: "yn", label: "yn", type: "yesno" as const, presentText: "shadowing" },
      { key: "ms", label: "ms", type: "multiselect" as const },
      { key: "s", label: "s", type: "select" as const, options: ["A", "B"] },
    ],
  };
  it("renders number, yesno, multiselect and select correctly", () => {
    const { render, units } = renderParams(def.params, { n: "5", yn: "Present", ms: "A,B,C", s: "B" });
    expect(render.n).toBe("5 mm");
    expect(units.n).toBe("mm");
    expect(render.yn).toBe("shadowing");
    expect(render.ms).toBe("A, B and C");
    expect(render.s).toBe("B");
  });
  it("renders an absent yesno as empty (drops its optional clause)", () => {
    const { render } = renderParams(def.params, { yn: "Absent" });
    expect(render.yn).toBe("");
  });
});

describe("optional-clause grammar (delegated to the shared engine)", () => {
  const def: UsgFindingDef = {
    id: "t", organ: "x", organLabel: "X", findingType: "T",
    params: [
      { key: "size", label: "size", type: "number", unit: "mm", normalizeTo: "mm" },
      { key: "shadow", label: "shadow", type: "yesno", presentText: "showing shadowing" },
    ],
    findingText: "A lesion measuring {size}[, {shadow}].",
    impressionText: "Lesion.",
  };
  it("keeps the clause when the value is present", () => {
    expect(generateUsgFinding(def, { size: "5", shadow: "Present" }).object.findingText)
      .toBe("A lesion measuring 5 mm, showing shadowing.");
  });
  it("drops the clause when the value is absent", () => {
    expect(generateUsgFinding(def, { size: "5", shadow: "Absent" }).object.findingText)
      .toBe("A lesion measuring 5 mm.");
  });
});

describe("Finding Object + radiologist edit precedence", () => {
  const def: UsgFindingDef = {
    id: "t", organ: "x", organLabel: "X", findingType: "T",
    params: [{ key: "size", label: "size", type: "number", unit: "mm", normalizeTo: "mm" }],
    findingText: "Lesion {size}.", impressionText: "Lesion.",
  };
  it("captures raw parameters, units, source and timestamps in the object", () => {
    const { object } = generateUsgFinding(def, { size: "9" }, {
      sourceType: "measurement", sourceMeasurementRef: "SR#3", author: "Dr X", timestamp: "2026-01-01T00:00:00Z",
    });
    expect(object.parameters).toEqual({ size: "9" });
    expect(object.units.size).toBe("mm");
    expect(object.sourceType).toBe("measurement");
    expect(object.sourceMeasurementRef).toBe("SR#3");
    expect(object.author).toBe("Dr X");
    expect(object.findingText).toBe("Lesion 9 mm.");
  });
  it("effectiveFindingText prefers the radiologist edit over generated text", () => {
    const { object } = generateUsgFinding(def, { size: "9" }, { editedText: "Custom prose." });
    expect(effectiveFindingText(object)).toBe("Custom prose.");
  });
  it("initialFindingValues uses default → first option", () => {
    const d: UsgFindingDef = {
      id: "d", organ: "x", organLabel: "X", findingType: "T",
      params: [
        { key: "a", label: "a", type: "select", options: ["P", "Q"], default: "Q" },
        { key: "b", label: "b", type: "select", options: ["R", "S"] },
      ],
      findingText: "", impressionText: "",
    };
    expect(initialFindingValues(d)).toEqual({ a: "Q", b: "R" });
  });
});
