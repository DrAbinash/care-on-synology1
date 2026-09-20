import { describe, expect, it } from "vitest";
import {
  accumulateMatchKey,
  emptyMatchKeyCounters,
  isSingleHitExact,
  parseStudyDate,
  referringDoctorFromBillDesk,
  sanitizePatientAge,
  sanitizePatientSex,
} from "./studioWorklistBillJoin";

describe("referringDoctorFromBillDesk", () => {
  it("returns verbatim trimmed doctor name", () => {
    expect(referringDoctorFromBillDesk("  Dr. Rao  ")).toBe("Dr. Rao");
  });

  it("returns empty string when blank — never Self/Walk-in", () => {
    expect(referringDoctorFromBillDesk("")).toBe("");
    expect(referringDoctorFromBillDesk(null)).toBe("");
    expect(referringDoctorFromBillDesk(undefined)).toBe("");
    expect(referringDoctorFromBillDesk("")).not.toBe("Self/Walk-in");
  });
});

describe("sanitizePatientAge", () => {
  it("uses bill-desk age_value within 0..110", () => {
    expect(sanitizePatientAge({ ageValue: 40, ageUnit: "years" })).toBe("40");
    expect(sanitizePatientAge({ ageValue: 6, ageUnit: "months" })).toBe("6M");
  });

  it("rejects >110 and <0 (never emit 126)", () => {
    expect(sanitizePatientAge({ ageValue: 126 })).toBe("");
    expect(sanitizePatientAge({ ageValue: -1 })).toBe("");
    expect(sanitizePatientAge({ ageValue: 111 })).toBe("");
  });

  it("derives age from DOB and rejects impossible years", () => {
    expect(sanitizePatientAge({ dateOfBirth: "1985-06-15" })).toMatch(/^\d{1,3}$/);
    expect(sanitizePatientAge({ dateOfBirth: "1900-01-01" })).toBe(""); // would be >110
  });
});

describe("sanitizePatientSex", () => {
  it("returns trimmed sex from patient row", () => {
    expect(sanitizePatientSex(" female ")).toBe("female");
    expect(sanitizePatientSex(null)).toBe("");
  });
});

describe("parseStudyDate / isSingleHitExact", () => {
  it("parses YYYYMMDD and ISO dates", () => {
    expect(parseStudyDate("20260920")?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(parseStudyDate("2026-09-20")?.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("refuses multi-hit and name-only matches", () => {
    expect(isSingleHitExact({ candidateCount: 1, nameOnly: false })).toBe(true);
    expect(isSingleHitExact({ candidateCount: 2, nameOnly: false })).toBe(false);
    expect(isSingleHitExact({ candidateCount: 1, nameOnly: true })).toBe(false);
  });
});

describe("match key counters", () => {
  it("accumulates join keys for meta.matchedBy", () => {
    let c = emptyMatchKeyCounters();
    c = accumulateMatchKey(c, "billNumber");
    c = accumulateMatchKey(c, "singleHit");
    c = accumulateMatchKey(c, null);
    expect(c).toEqual({
      billNumber: 1,
      accessionNumber: 0,
      worklistId: 0,
      singleHit: 1,
      unmatched: 1,
    });
  });
});
