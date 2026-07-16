import { describe, it, expect } from "vitest";
import { ULTRASOUND_MODALITY_ALIASES, normalizeModality, isUltrasoundModality, isObstetricUsgStudy } from "./usgModality";

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

describe("isObstetricUsgStudy — PCPNDT safety guard classification (PR B follow-up)", () => {
  it("returns false for any non-ultrasound modality, regardless of description", () => {
    expect(isObstetricUsgStudy("MR", "MRI Obstetric Pelvimetry")).toBe(false);
    expect(isObstetricUsgStudy("CT", "CT Pregnancy")).toBe(false);
    expect(isObstetricUsgStudy(null, "Obstetric Growth Scan")).toBe(false);
    expect(isObstetricUsgStudy(undefined, "Fetal Anomaly Scan")).toBe(false);
  });

  it("returns false for non-obstetric ultrasound studies — must never block General USG finalize for these", () => {
    for (const desc of [
      "USG Whole Abdomen", "USG KUB", "USG Thyroid", "USG Breast",
      "USG Scrotum", "USG Carotid Doppler", "TVS", "USG Pelvis", "USG Prostate",
    ]) {
      expect(isObstetricUsgStudy("USG", desc)).toBe(false);
    }
  });

  it("returns true for every obstetric/fetal ultrasound study-description spelling seen in practice", () => {
    for (const desc of [
      "USG Obstetric Growth Scan", "USG Pregnancy", "Fetal Anomaly Scan",
      "USG Early Gestation", "NT Scan", "TIFFA", "Growth Scan", "Anomaly Scan",
      "Obstetric Doppler", "Fetal Well-being Scan",
    ]) {
      expect(isObstetricUsgStudy("USG", desc)).toBe(true);
      expect(isObstetricUsgStudy("Doppler", desc)).toBe(true); // any US-family modality spelling
    }
  });

  it("is case-insensitive", () => {
    expect(isObstetricUsgStudy("usg", "obstetric growth scan")).toBe(true);
    expect(isObstetricUsgStudy("USG", "OBSTETRIC GROWTH SCAN")).toBe(true);
  });

  it("handles a missing/empty study description without throwing, and treats it as non-obstetric", () => {
    expect(isObstetricUsgStudy("USG", null)).toBe(false);
    expect(isObstetricUsgStudy("USG", undefined)).toBe(false);
    expect(isObstetricUsgStudy("USG", "")).toBe(false);
  });
});
