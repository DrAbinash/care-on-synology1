import { describe, expect, it } from "vitest";
import { formatAge, formatAgeForPrint } from "./age";

// Regression: RITIK KUMAR, 26 y/o, was printed as "MALE" only — the age
// was dropped. Root cause: legacy walk-in registrations stored
// ageValue=0 (from Number("") on an empty age input) with a real
// dateOfBirth, and the helper short-circuited to "" on ageValue=0
// instead of falling through to dateOfBirth. Both helpers must:
//   - fall through to dateOfBirth when ageValue is 0/null
//   - honour a real dateOfBirth without any ageValue at all
describe("age helpers — ageValue=0 must fall through to dateOfBirth", () => {
  const twentySixYearsAgo = `${new Date().getFullYear() - 26}-01-01`;

  it("formatAge falls through to dob when ageValue is 0", () => {
    expect(formatAge({ dateOfBirth: twentySixYearsAgo, ageValue: 0, ageUnit: "years" }))
      .toBe("26 Yrs");
  });

  it("formatAgeForPrint falls through to dob when ageValue is 0", () => {
    expect(formatAgeForPrint({ dateOfBirth: twentySixYearsAgo, ageValue: 0, ageUnit: "years" }))
      .toBe("26 Yrs");
  });

  it("formatAgeForPrint still honours a valid ageValue over dob", () => {
    expect(formatAgeForPrint({ dateOfBirth: twentySixYearsAgo, ageValue: 26, ageUnit: "years" }))
      .toBe("26 Yrs");
  });

  it("formatAgeForPrint returns '' when nothing is known", () => {
    expect(formatAgeForPrint({ dateOfBirth: "", ageValue: 0, ageUnit: "years" }))
      .toBe("");
    expect(formatAgeForPrint({ dateOfBirth: null, ageValue: null, ageUnit: null }))
      .toBe("");
  });

  it("sentinel DOB 1900-01-01 does not render as ~126 Yrs", () => {
    expect(formatAge({ dateOfBirth: "1900-01-01" })).toBe("");
    expect(formatAgeForPrint({ dateOfBirth: "1900-01-01" })).toBe("");
    expect(formatAge({ dateOfBirth: "1900-01-01T00:00:00.000Z", ageValue: 126, ageUnit: "years" })).toBe("");
  });

  it("months / days age values still render at their own units", () => {
    expect(formatAgeForPrint({ dateOfBirth: "", ageValue: 8, ageUnit: "months" }))
      .toBe("8 Mo");
    expect(formatAgeForPrint({ dateOfBirth: "", ageValue: 10, ageUnit: "days" }))
      .toBe("10 D");
  });
});
