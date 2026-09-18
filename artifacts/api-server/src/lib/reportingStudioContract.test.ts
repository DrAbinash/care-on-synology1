/**
 * Unit tests for Reporting Studio outgoing contract + sentinel detector.
 */
import { describe, expect, test } from "vitest";
import {
  validateStudioWorklistRow,
  detectSentinels,
  isPlaceholderDob,
  accumulateSentinels,
  emptySentinelCounters,
  buildRowsByModality,
} from "./reportingStudioContract";

const goodRow = {
  worklistId: "42",
  accessionNumber: "ACC-1",
  patientName: "Test Patient",
  patientAge: "40",
  patientGender: "F",
  referringDoctor: "Dr. Referrer",
  testName: "MRI Brain",
  modality: "MR",
  studyDate: "2026-08-29T00:00:00.000Z",
  studyInstanceUid: "1.2.3",
  billingStatus: "PAID" as const,
  status: "STUDY_RECEIVED",
};

describe("validateStudioWorklistRow", () => {
  test("accepts a well-formed studio row", () => {
    const result = validateStudioWorklistRow(goodRow);
    expect(result.ok).toBe(true);
  });

  test("contract validation catches a malformed row (blank patientName)", () => {
    const result = validateStudioWorklistRow({ ...goodRow, patientName: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.field === "patientName")).toBe(true);
    expect(result.issues[0]?.worklistId).toBe("42");
  });

  test("rejects missing modality", () => {
    const result = validateStudioWorklistRow({ ...goodRow, modality: "" });
    expect(result.ok).toBe(false);
  });
});

describe("detectSentinels", () => {
  test("flags age 126 and ages >110", () => {
    expect(detectSentinels({
      patientAge: "40",
      sourceAge: "126",
      accessionNumber: "A",
      referringDoctor: "Dr X",
    }).ageSuspicious).toBe(true);

    expect(detectSentinels({
      patientAge: "126",
      accessionNumber: "A",
      referringDoctor: "Dr X",
    }).ageSuspicious).toBe(true);

    expect(detectSentinels({
      patientAge: "130",
      accessionNumber: "A",
      referringDoctor: "Dr X",
    }).ageSuspicious).toBe(true);

    expect(detectSentinels({
      patientAge: "40",
      sourceAge: "54",
      accessionNumber: "A",
      referringDoctor: "Dr X",
    }).ageSuspicious).toBe(false);
  });

  test("flags 1900-01-01 placeholder DOB", () => {
    expect(isPlaceholderDob("1900-01-01")).toBe(true);
    expect(isPlaceholderDob("1985-01-01")).toBe(true);
    expect(isPlaceholderDob("1985-06-15")).toBe(false);
    expect(detectSentinels({
      patientAge: "40",
      patientDob: "1900-01-01",
      accessionNumber: "A",
      referringDoctor: "Dr X",
    }).placeholderDob).toBe(true);
  });

  test("flags blank accession and blank referring doctor after fallback", () => {
    expect(detectSentinels({
      patientAge: "40",
      accessionNumber: "",
      referringDoctor: "Self/Walk-in",
      referringDoctorWasBlank: true,
    })).toEqual({
      ageSuspicious: false,
      placeholderDob: false,
      blankAccession: true,
      blankReferringDoctor: true,
    });
  });

  test("accumulateSentinels rolls up counters", () => {
    let c = emptySentinelCounters();
    c = accumulateSentinels(c, {
      ageSuspicious: true,
      placeholderDob: true,
      blankAccession: false,
      blankReferringDoctor: false,
    });
    c = accumulateSentinels(c, {
      ageSuspicious: true,
      placeholderDob: false,
      blankAccession: true,
      blankReferringDoctor: false,
    });
    expect(c).toEqual({
      ageSuspicious: 2,
      placeholderDob: 1,
      blankAccession: 1,
      blankReferringDoctor: 0,
    });
  });
});

describe("buildRowsByModality", () => {
  test("counts modalities", () => {
    expect(buildRowsByModality([
      { modality: "MR" },
      { modality: "MR" },
      { modality: "US" },
      { modality: null },
    ])).toEqual({ MR: 2, US: 1, UNKNOWN: 1 });
  });
});
