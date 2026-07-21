import { describe, it, expect } from "vitest";
import { ellipsoidVolumeMl, ellipsoidVolumeMlFromMm, ELLIPSOID_FACTOR } from "./volume";

describe("ellipsoid volume — the single canonical formula", () => {
  it("factor is the prolate-ellipsoid constant", () => {
    expect(ELLIPSOID_FACTOR).toBe(0.523);
  });

  it("34 × 31 × 24 mm → ~13.2 cc (NOT 35 cc)", () => {
    expect(ellipsoidVolumeMlFromMm(34, 31, 24)).toBeCloseTo(13.23, 2);
  });

  it("accepts dimensions in cm and converts centrally", () => {
    // 3.4 × 3.1 × 2.4 cm is the same organ as 34 × 31 × 24 mm.
    expect(ellipsoidVolumeMl(3.4, 3.1, 2.4, "cm")).toBeCloseTo(13.23, 2);
    expect(ellipsoidVolumeMl(34, 31, 24, "mm")).toBeCloseTo(13.23, 2);
  });

  it("returns null on any missing or non-positive dimension", () => {
    expect(ellipsoidVolumeMlFromMm(null, 31, 24)).toBeNull();
    expect(ellipsoidVolumeMlFromMm(34, 0, 24)).toBeNull();
    expect(ellipsoidVolumeMlFromMm(34, 31, -1)).toBeNull();
    expect(ellipsoidVolumeMl(3.4, 3.1, null, "cm")).toBeNull();
  });

  it("frontend (mm) and server (mm) inputs agree exactly", () => {
    const a = ellipsoidVolumeMlFromMm(50, 45, 40);
    const b = ellipsoidVolumeMl(5, 4.5, 4, "cm");
    expect(a).toEqual(b);
  });
});
