import { describe, expect, it } from "vitest";
import {
  genderToDicomSex,
  isPlausibleDicomSex,
  sanitizeDicomSex,
} from "./dicomSex";

describe("sanitizeDicomSex", () => {
  it("accepts DICOM CS codes only", () => {
    expect(sanitizeDicomSex("M")).toBe("M");
    expect(sanitizeDicomSex("female")).toBe("F");
    expect(sanitizeDicomSex("OTHER")).toBe("O");
  });

  it("rejects patient names and ambiguous strings", () => {
    expect(sanitizeDicomSex("Mohammed Ali")).toBeNull();
    expect(sanitizeDicomSex("Gunja Devi")).toBeNull();
    expect(sanitizeDicomSex("Male Patient")).toBeNull();
    expect(sanitizeDicomSex("")).toBeNull();
  });

  it("genderToDicomSex never uses startsWith on names", () => {
    expect(genderToDicomSex("male")).toBe("M");
    expect(genderToDicomSex("Mohammed")).toBeNull();
    expect(genderToDicomSex("Meena")).toBeNull();
  });

  it("isPlausibleDicomSex guards CS field shape", () => {
    expect(isPlausibleDicomSex("M")).toBe(true);
    expect(isPlausibleDicomSex("B O Gunja")).toBe(false);
  });
});
