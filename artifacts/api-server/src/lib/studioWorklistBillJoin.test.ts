import { describe, expect, it } from "vitest";
import {
  accumulateMatchKey,
  emptyMatchKeyCounters,
  isSingleHitExact,
  parseStudyDate,
  pickSoleUltrasoundTest,
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

const usgTest = (billId: number, over: Partial<Parameters<typeof pickSoleUltrasoundTest>[0][number]> = {}) => ({
  billId,
  department: "USG",
  code: "USG023",
  name: "USG THYROID",
  displayName: null,
  ...over,
});

describe("pickSoleUltrasoundTest — the bill's scan is the study's test", () => {
  it("finds the ultrasound line among unrelated tests", () => {
    const m = pickSoleUltrasoundTest([
      usgTest(7, { billId: 7 }),
      { ...usgTest(7), billId: 7, department: "Pathology", code: "CBC", name: "COMPLETE BLOOD COUNT" },
      { ...usgTest(7), billId: 7, department: "X-Ray", code: "XRAYKUB", name: "X-RAY KUB" },
    ]);
    expect(m.get(7)).toEqual({ testName: "USG THYROID", testCode: "USG023" });
    expect(m.size).toBe(1);
  });

  it("ignores the serial the tests were added in", () => {
    const a = pickSoleUltrasoundTest([
      { ...usgTest(3), department: "Pathology", code: "TSH", name: "THYROID STIMULATING HORMONE" },
      usgTest(3),
    ]);
    const b = pickSoleUltrasoundTest([usgTest(3), { ...usgTest(3), department: "Pathology", code: "TSH", name: "THYROID STIMULATING HORMONE" }]);
    expect(a.get(3)).toEqual(b.get(3));
    expect(a.get(3)?.testCode).toBe("USG023");
  });

  it("refuses a bill carrying two ultrasound tests — nothing can separate them", () => {
    const m = pickSoleUltrasoundTest([
      usgTest(9),
      usgTest(9, { code: "USG024", name: "USG UPPER ABDOMEN" }),
    ]);
    expect(m.has(9)).toBe(false);
  });

  it("refuses a scan billed beside an ultrasound-guided procedure — same department, different study", () => {
    const m = pickSoleUltrasoundTest([
      usgTest(8, { code: "USG W", name: "USG WHOLE ABDOMEN" }),
      usgTest(8, { code: "USGFNAC", name: "USG GUIDED FNAC" }),
    ]);
    expect(m.has(8)).toBe(false);
  });

  it("names a bill whose only ultrasound line is a guided procedure — the Studio owns that mapping", () => {
    const m = pickSoleUltrasoundTest([usgTest(10, { code: "USGFNAC", name: "USG GUIDED FNAC" })]);
    expect(m.get(10)).toEqual({ testName: "USG GUIDED FNAC", testCode: "USGFNAC" });
  });

  it("prefers the bill's own display name over the catalog name", () => {
    const m = pickSoleUltrasoundTest([usgTest(11, { displayName: "  USG Thyroid (Dr Rao)  " })]);
    expect(m.get(11)?.testName).toBe("USG Thyroid (Dr Rao)");
  });

  it("falls back to the catalog name when the override is blank", () => {
    const m = pickSoleUltrasoundTest([usgTest(12, { displayName: "   " })]);
    expect(m.get(12)?.testName).toBe("USG THYROID");
  });

  it("is the only ultrasound department label, matched case-insensitively", () => {
    expect(pickSoleUltrasoundTest([usgTest(13, { department: "usg" })]).get(13)?.testCode).toBe("USG023");
    expect(pickSoleUltrasoundTest([usgTest(14, { department: "Cardiology", code: "ECHO", name: "ECHO" })]).size).toBe(0);
  });

  it("never invents a name from a bill with no ultrasound line", () => {
    expect(pickSoleUltrasoundTest([]).size).toBe(0);
    expect(pickSoleUltrasoundTest([{ ...usgTest(15), department: "MRI" }]).size).toBe(0);
  });
});
