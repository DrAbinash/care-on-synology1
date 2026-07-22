import { describe, it, expect } from "vitest";
import { compareMeasurements, comparisonPhrase, type MeasurementPoint } from "./usgStructuredComparison";

const m = (key: string, value: string, over: Partial<MeasurementPoint> = {}): MeasurementPoint => ({
  key, label: key, value, ...over,
});

describe("P4.2 usgStructuredComparison — directions", () => {
  it("increased / decreased with percent and absolute change", () => {
    const rows = compareMeasurements([m("size", "12 mm")], [m("size", "10 mm")], { intervalDays: 30 });
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("increased");
    expect(rows[0].absoluteChange).toBe(2);
    expect(rows[0].percentChange).toBe(20);
    expect(rows[0].intervalDays).toBe(30);
  });

  it("unchanged within tolerance", () => {
    const rows = compareMeasurements([m("size", "10.2 mm")], [m("size", "10 mm")], { unchangedTolerancePct: 5 });
    expect(rows[0].direction).toBe("unchanged");
  });

  it("new (no prior) and resolved (no current)", () => {
    const newRows = compareMeasurements([m("nodule", "5 mm")], []);
    expect(newRows[0].direction).toBe("new");
    const resolvedRows = compareMeasurements([], [m("nodule", "5 mm")]);
    expect(resolvedRows[0].direction).toBe("resolved");
  });

  it("non-numeric values are not_comparable", () => {
    const rows = compareMeasurements([m("echo", "heterogeneous")], [m("echo", "homogeneous")]);
    expect(rows[0].direction).toBe("not_comparable");
    expect(rows[0].note).toMatch(/non-numeric/i);
  });
});

describe("P4.2 usgStructuredComparison — unit alignment", () => {
  it("aligns prior cm to current mm before comparing", () => {
    const rows = compareMeasurements([m("size", "12 mm")], [m("size", "1 cm", { unit: "cm" })], {});
    // 1 cm = 10 mm → increased by 2 mm.
    expect(rows[0].direction).toBe("increased");
    expect(rows[0].absoluteChange).toBe(2);
  });

  it("flags non-convertible units honestly instead of guessing", () => {
    const rows = compareMeasurements(
      [m("flow", "30 cm/s", { unit: "cm/s" })],
      [m("flow", "20 mmhg", { unit: "mmhg" })],
      {},
    );
    // Still reports a raw delta but must carry a caveat note.
    expect(rows[0].note).toMatch(/units differ/i);
  });
});

describe("P4.2 usgStructuredComparison — no autonomous progression", () => {
  it("phrases never assert clinical worsening/improvement", () => {
    const rows = compareMeasurements([m("size", "20 mm")], [m("size", "10 mm")]);
    const phrase = comparisonPhrase(rows[0]);
    expect(phrase).not.toMatch(/worse|progress|response|malignan/i);
    expect(phrase).toMatch(/increased/);
  });
});
