import { describe, it, expect } from "vitest";
import { ULTRASOUND_MODALITY_ALIASES, normalizeModality, isUltrasoundModality } from "./usgModality";

// R2.0 Canonical Ultrasound Integration — RadiologyWorklist.tsx's modality
// filter previously compared entry.modality to the "US" filter chip with
// exact string equality, so any non-"US" PACS spelling ("USG", "Doppler",
// "OB US", ...) silently fell out of the "US" bucket. These pure functions
// carry the normalization logic the worklist page's filter now uses.

describe("ULTRASOUND_MODALITY_ALIASES — alias list coverage", () => {
  it.each([
    "US", "USG", "US-DOPPLER", "USDOPPLER", "DOPPLER", "OB US", "OB-US",
    "OBUS", "FETAL US", "FETAL-US", "4D US", "3D US", "US/DOPPLER",
    "COLOR DOPPLER", "ULTRASOUND",
  ])("%s is a listed alias", (alias) => {
    expect(ULTRASOUND_MODALITY_ALIASES).toContain(alias);
  });
});

describe("normalizeModality — ultrasound/Doppler variants fold into US", () => {
  it.each([
    "US", "usg", "Usg", "US-Doppler", "USDOPPLER", "doppler",
    "OB US", "ob-us", "OBUS", "Fetal US", "fetal-us", "4D US", "3d us",
    "US/Doppler", "Color Doppler", "ultrasound",
  ])("%j normalizes to \"US\"", (raw) => {
    expect(normalizeModality(raw)).toBe("US");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(normalizeModality("  USG  ")).toBe("US");
  });

  it("matches free-text values that start with US followed by a non-letter (e.g. study descriptions leaking into modality)", () => {
    expect(normalizeModality("US Abdomen")).toBe("US");
    expect(normalizeModality("US-Pelvis")).toBe("US");
    expect(normalizeModality("US.Renal")).toBe("US");
  });

  it("matches substrings ULTRASOUND / DOPPLER / USG embedded in longer strings", () => {
    expect(normalizeModality("WHOLE ABDOMEN ULTRASOUND")).toBe("US");
    expect(normalizeModality("RENAL DOPPLER STUDY")).toBe("US");
    expect(normalizeModality("USG WHOLE ABDOMEN")).toBe("US");
  });
});

describe("normalizeModality — non-ultrasound values pass through unchanged (trimmed + uppercased)", () => {
  it.each([
    ["CT", "CT"],
    ["ct", "CT"],
    ["MR", "MR"],
    ["MRI", "MRI"],
    ["CR", "CR"],
    ["MG", "MG"],
    ["BMD", "BMD"],
    ["OT", "OT"],
    ["  CT  ", "CT"],
  ])("%j stays %j — not an ultrasound variant", (raw, expected) => {
    expect(normalizeModality(raw)).toBe(expected);
  });

  it("does NOT match \"US\" as a false-positive substring of an unrelated word (e.g. USER, BUS, CAMPUS)", () => {
    expect(normalizeModality("USER")).toBe("USER");
    expect(normalizeModality("BUS")).toBe("BUS");
    expect(normalizeModality("CAMPUS")).toBe("CAMPUS");
  });

  it("handles null/undefined/empty input without throwing", () => {
    expect(normalizeModality(null)).toBe("");
    expect(normalizeModality(undefined)).toBe("");
    expect(normalizeModality("")).toBe("");
    expect(normalizeModality("   ")).toBe("");
  });
});

describe("isUltrasoundModality", () => {
  it("returns true for ultrasound/Doppler variants", () => {
    expect(isUltrasoundModality("USG")).toBe(true);
    expect(isUltrasoundModality("Doppler")).toBe(true);
    expect(isUltrasoundModality("OB US")).toBe(true);
  });

  it("returns false for non-ultrasound modalities and false-positive substrings", () => {
    expect(isUltrasoundModality("CT")).toBe(false);
    expect(isUltrasoundModality("MRI")).toBe(false);
    expect(isUltrasoundModality("USER")).toBe(false);
    expect(isUltrasoundModality(null)).toBe(false);
  });
});
