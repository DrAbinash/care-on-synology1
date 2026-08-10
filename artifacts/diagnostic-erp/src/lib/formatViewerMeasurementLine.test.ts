import { describe, expect, it } from "vitest";
import { formatViewerMeasurementLabel, formatViewerMeasurementLine } from "./formatViewerMeasurementLine";

describe("formatViewerMeasurementLine", () => {
  it("uses slice context instead of bare linear type", () => {
    const line = formatViewerMeasurementLine({
      measurementType: "linear",
      value: "7",
      unit: "mm",
      sliceNumber: 12,
      measurementId: null,
    });
    expect(line).toContain("Slice 12");
    expect(line).not.toMatch(/^linear:/i);
    expect(line).toBe("Slice 12 — Linear measurement: 7 mm");
  });

  it("uses registry display name when measurementId is set", () => {
    const line = formatViewerMeasurementLine({
      measurementId: "CBD",
      measurementType: "linear",
      value: "7",
      unit: "mm",
      sliceNumber: null,
    });
    expect(line).toContain("Common Bile Duct");
  });
});
