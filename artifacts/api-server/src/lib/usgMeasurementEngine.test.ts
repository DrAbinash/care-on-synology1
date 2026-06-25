import { describe, it, expect } from "vitest";
import { parseDimension, parseTripleDimensions, normalizeAndCalculate } from "./usgMeasurementEngine";

describe("USG Measurement Engine Normalization", () => {
  it("should parse raw dimensions into millimeters", () => {
    expect(parseDimension("7.5 cm")).toBe(75);
    expect(parseDimension("82 mm")).toBe(82);
    expect(parseDimension("10 ml")).toBe(10);
    expect(parseDimension("3.5")).toBe(3.5);
    expect(parseDimension(null)).toBeNull();
  });

  it("should parse triple dimensions", () => {
    expect(parseTripleDimensions("10.8 x 4.5 x 3.2 cm")).toEqual({ l: 108, w: 45, h: 32 });
    expect(parseTripleDimensions("108 x 45 x 32 mm")).toEqual({ l: 108, w: 45, h: 32 });
    expect(parseTripleDimensions("10.8*4.5*3.2 cm")).toEqual({ l: 108, w: 45, h: 32 });
    expect(parseTripleDimensions("108*45*32 mm")).toEqual({ l: 108, w: 45, h: 32 });
  });

  it("should normalize and calculate kidney, prostate, and gestational age", () => {
    const mockMeasurement = {
      rightKidney: "10.8 x 4.5 x 3.2 cm",
      leftKidney: "108 x 45 x 32 mm",
      prostateVolume: "4.0 x 3.0 x 3.0 cm",
      bpd: "82 mm",
      fl: "62 mm",
      crl: "50 mm",
    };

    const result = normalizeAndCalculate(mockMeasurement);

    expect(result.normalizedFields.rightKidneyLengthMm).toBe(108);
    expect(result.normalizedFields.leftKidneyLengthMm).toBe(108);
    expect(result.normalizedFields.prostateLengthMm).toBe(40);
    expect(result.normalizedFields.bpdMm).toBe(82);
    expect(result.normalizedFields.flMm).toBe(62);
    expect(result.normalizedFields.crlMm).toBe(50);

    // Volumes
    expect(result.calculations.rightKidneyVolumeMl).toBe(81.34);
    expect(result.calculations.leftKidneyVolumeMl).toBe(81.34);
    expect(result.calculations.prostateVolumeMl).toBe(18.83);

    // GAs
    expect(result.calculations.gestationalAgeByFl).toBe(87.3);
    expect(result.calculations.estimatedGaWeeks).toBe(46.9);
  });
});
