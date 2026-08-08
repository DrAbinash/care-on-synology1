import { describe, expect, it } from "vitest";
import { isPatientPhoneProvided, patientPhoneMeetsRequirement } from "./patientPhoneRequired";

describe("patientPhoneRequired helpers", () => {
  it("treats blank / whitespace as missing", () => {
    expect(isPatientPhoneProvided("")).toBe(false);
    expect(isPatientPhoneProvided("   ")).toBe(false);
    expect(isPatientPhoneProvided(null)).toBe(false);
    expect(isPatientPhoneProvided("9876543210")).toBe(true);
  });

  it("enforces only when the clinic setting is on", () => {
    expect(patientPhoneMeetsRequirement("", true)).toBe(false);
    expect(patientPhoneMeetsRequirement("", false)).toBe(true);
    expect(patientPhoneMeetsRequirement("9876543210", true)).toBe(true);
  });
});
