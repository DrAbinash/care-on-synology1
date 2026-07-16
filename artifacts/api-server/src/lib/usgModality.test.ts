import { describe, it, expect } from "vitest";
import { isUltrasoundModality, isObstetricUsgStudy } from "./usgModality";

// PCPNDT server-side finalize guard (routes/patient-reports.ts,
// routes/internal-radiology.ts) — this classifier must agree with the
// frontend's identical helper (artifacts/diagnostic-erp/src/lib/
// usgModality.test.ts) since both gate the same real-world action.

describe("isUltrasoundModality (backend mirror)", () => {
  it("returns true for ultrasound/Doppler variants and false otherwise", () => {
    expect(isUltrasoundModality("USG")).toBe(true);
    expect(isUltrasoundModality("Doppler")).toBe(true);
    expect(isUltrasoundModality("OB US")).toBe(true);
    expect(isUltrasoundModality("MRI")).toBe(false);
    expect(isUltrasoundModality("CT")).toBe(false);
    expect(isUltrasoundModality(null)).toBe(false);
  });
});

describe("isObstetricUsgStudy — PCPNDT server-side guard classification", () => {
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
      expect(isObstetricUsgStudy("Doppler", desc)).toBe(true);
    }
  });

  it("is case-insensitive and null/undefined/empty-description-safe", () => {
    expect(isObstetricUsgStudy("usg", "obstetric growth scan")).toBe(true);
    expect(isObstetricUsgStudy("USG", null)).toBe(false);
    expect(isObstetricUsgStudy("USG", undefined)).toBe(false);
    expect(isObstetricUsgStudy("USG", "")).toBe(false);
  });
});
