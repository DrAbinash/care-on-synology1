import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseMeasurement,
  toMm,
  ellipsoidVolumeMl,
  isAffirmative,
  renderParams,
  generateUsgFinding,
  effectiveFindingText,
  initialFindingValues,
  unansweredRequiredParams,
  type UsgFindingDef,
} from "./usgFindingBuilder";
import { USG_FINDING_DEFS } from "./usgOrganLibrary";

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

/**
 * Laterality is never pre-answered (audit finding C).
 *
 * "Renal calculus" shipped with `default: "Right"` on a REQUIRED side parameter,
 * and `initialFindingValues` fell through to `options[0]` — which is also
 * "Right" — for the three kidney findings that only declared the default. Opening
 * the builder, typing a size and pressing Add therefore wrote "… in the RIGHT
 * kidney" for a patient whose stone had never been laterised by anyone. The
 * fallback looked like a clinical decision the clinic had made; it was list
 * order.
 *
 * Two rules, deliberately different:
 *   - a REQUIRED select with no authored default starts blank. List order is not
 *     an answer, and the Add button refuses until it is one.
 *   - an authored `default` still wins, required or not. "Lower calyx", "Single"
 *     and "Mild" are clinic decisions; making the radiologist re-type them per
 *     finding would cost clicks without costing a false statement — unlike a
 *     side. The catalogue-wide tests below pin that no laterality parameter may
 *     carry one.
 */
describe("a required select is not answered on the radiologist's behalf", () => {
  const d: UsgFindingDef = {
    id: "d", organ: "kidney", organLabel: "Kidney", findingType: "T", lateralityParam: "side",
    params: [
      { key: "side", label: "Side", type: "select", options: ["Right", "Left", "Bilateral"], required: true },
      { key: "grade", label: "Grade", type: "select", options: ["Mild", "Severe"], default: "Mild", required: true },
      { key: "twinkle", label: "Twinkle", type: "select", options: ["Present", "Absent"] },
      { key: "size", label: "Size", type: "number", unit: "mm", required: true },
    ],
    findingText: "{side} {grade} {twinkle} {size}.", impressionText: "",
  };

  it("starts a required select with no authored default unanswered", () => {
    expect(initialFindingValues(d).side).toBe("");
  });
  it("keeps an authored default on a required select — that is a clinic decision, not list order", () => {
    expect(initialFindingValues(d).grade).toBe("Mild");
  });
  it("still pre-fills an optional select, and leaves a required number blank", () => {
    const v = initialFindingValues(d);
    expect(v.twinkle).toBe("Present");
    expect(v.size).toBe("");
  });

  it("unansweredRequiredParams names exactly the blanks that are required", () => {
    expect(unansweredRequiredParams(d, initialFindingValues(d)).map((p) => p.key))
      .toEqual(["side", "size"]);
    expect(unansweredRequiredParams(d, { side: "Left", grade: "Mild", size: "5 mm", twinkle: "" }))
      .toEqual([]);
    // A field that was filled and then erased is owed again, not "answered".
    expect(unansweredRequiredParams(d, { side: "  ", grade: "Mild", size: "5 mm" }).map((p) => p.key))
      .toEqual(["side"]);
  });

  it("the shipped renal calculus builder opens with no side chosen", () => {
    const calculus = USG_FINDING_DEFS.find((x) => x.id === "renal_calculus")!;
    const values = initialFindingValues(calculus);
    expect(values.side).toBe("");
    expect(generateUsgFinding(calculus, values).object.laterality).toBeNull();
    expect(unansweredRequiredParams(calculus, values).map((p) => p.key)).toContain("side");
    // Answering it is all that was needed — the prose is otherwise complete.
    const answered = generateUsgFinding(calculus, { ...values, side: "Left", size: "5" });
    expect(answered.object.laterality).toBe("Left");
    expect(answered.object.findingText).toContain("of the left kidney");
  });

  it("no finding in the whole ultrasound catalogue defaults a laterality", () => {
    const offenders = USG_FINDING_DEFS.flatMap((def) => def.params
      .filter((p) => (def.lateralityParam ? p.key === def.lateralityParam : p.key === "side") && p.default != null)
      .map((p) => `${def.id}.${p.key} = "${p.default}"`));
    expect(offenders).toEqual([]);
  });

  it("every laterality parameter demands an answer before the finding can be added", () => {
    const notRequired = USG_FINDING_DEFS.flatMap((def) => def.params
      .filter((p) => def.lateralityParam && p.key === def.lateralityParam && !p.required)
      .map((p) => `${def.id}.${p.key}`));
    expect(notRequired).toEqual([]);
  });
});

describe("the builder UI refuses instead of writing an unanswered field", () => {
  // Source pin, in this repo's documented no-DOM-harness idiom: the fault is that
  // a click reached the report while a clinical field was blank, which is a
  // property of which handler the button runs and of what it is gated by.
  const src = readFileSync(
    resolve(__dirname, "../components/radiology/usg/DynamicFindingBuilder.tsx"),
    "utf8",
  );

  it("disables Add on the same predicate that computes the pending fields", () => {
    expect(src).toContain("unansweredRequiredParams(def, values)");
    expect(src).toMatch(/disabled=\{pending\.length > 0\}/);
    expect(src).toMatch(/data-testid="usg-finding-add"/);
  });

  it("shows a required select as unanswered rather than as its first option", () => {
    expect(src).toMatch(/param\.required && !\(param\.options \?\? \[\]\)\.includes\(""\)/);
    expect(src).toMatch(/<option value="" data-testid="usg-required-select-unanswered">/);
  });

  it("tells the radiologist which field is still owed", () => {
    expect(src).toMatch(/pending\.map\(\(p\) => p\.label\)\.join\(", "\)/);
    expect(src).toMatch(/data-testid="usg-finding-builder-pending"/);
  });
});
