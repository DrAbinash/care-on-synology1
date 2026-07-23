import { describe, expect, test } from "vitest";
import { mergePriorStudies, pickBestReport, type PriorReportRow, type PriorStudyRow } from "./priorStudies";

function study(overrides: Partial<PriorStudyRow> & { id: number }): PriorStudyRow {
  return {
    accessionNumber: `ACC-${overrides.id}`,
    modality: "MR",
    bodyPart: "SPINE",
    studyDate: "2026-06-01",
    status: "reported_final",
    testName: "MRI Lumbar Spine",
    testCode: "MRI-LS",
    finalReport: "Final report text",
    finalReportedBy: "Dr. Sugandha",
    finalReportedAt: new Date("2026-06-01T10:00:00Z"),
    prelimReport: null,
    prelimReportedBy: null,
    prelimReportedAt: null,
    studyDescription: "MRI LS Spine",
    ...overrides,
  };
}

function report(overrides: Partial<PriorReportRow> & { id: number; studyId: number | null }): PriorReportRow {
  return {
    status: "verified",
    impression: "No significant abnormality.",
    body: "Report body",
    createdAt: new Date("2026-06-01T11:00:00Z"),
    ...overrides,
  };
}

describe("pickBestReport — signed reports preferred per study", () => {
  test("prefers a signed (verified) report over a newer draft", () => {
    const reports = [
      report({ id: 1, studyId: 5, status: "verified", createdAt: new Date("2026-01-01") }),
      report({ id: 2, studyId: 5, status: "draft", createdAt: new Date("2026-06-01") }),
    ];
    expect(pickBestReport(5, reports)?.id).toBe(1);
  });

  test("delivered also counts as signed", () => {
    const reports = [
      report({ id: 1, studyId: 5, status: "draft" }),
      report({ id: 2, studyId: 5, status: "delivered" }),
    ];
    expect(pickBestReport(5, reports)?.id).toBe(2);
  });

  test("among equally-signed reports, the most recent wins", () => {
    const reports = [
      report({ id: 1, studyId: 5, status: "verified", createdAt: new Date("2026-01-01") }),
      report({ id: 2, studyId: 5, status: "verified", createdAt: new Date("2026-06-01") }),
    ];
    expect(pickBestReport(5, reports)?.id).toBe(2);
  });

  test("never matches another study's report (patient/study isolation at merge level)", () => {
    const reports = [report({ id: 1, studyId: 99 }), report({ id: 2, studyId: null })];
    expect(pickBestReport(5, reports)).toBeNull();
  });
});

describe("mergePriorStudies — panel response shape", () => {
  test("maps study + best report into the PriorStudySummary shape the panels consume", () => {
    const merged = mergePriorStudies(
      [study({ id: 5 })],
      [report({ id: 31, studyId: 5, impression: "Stable disc bulge.", status: "verified" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 5,
      accessionNumber: "ACC-5",
      modality: "MR",
      bodyPart: "SPINE",
      studyDate: "2026-06-01",
      testName: "MRI Lumbar Spine",
      testCode: "MRI-LS",
      impression: "Stable disc bulge.",
      finalReport: "Final report text",
      reportedBy: "Dr. Sugandha",
      status: "reported_final",
      reportId: 31,
      reportStatus: "verified",
    });
    expect(merged[0].reportedAt).toBe("2026-06-01T10:00:00.000Z");
  });

  test("falls back to prelim text and prelim reporter when no final report exists", () => {
    const merged = mergePriorStudies(
      [study({
        id: 6, status: "reported_preliminary",
        finalReport: null, finalReportedBy: null, finalReportedAt: null,
        prelimReport: "Prelim text", prelimReportedBy: "Dr. P", prelimReportedAt: new Date("2026-05-01T09:00:00Z"),
      })],
      [],
    );
    expect(merged[0].finalReport).toBe("Prelim text");
    expect(merged[0].reportedBy).toBe("Dr. P");
    expect(merged[0].reportId).toBeNull();
  });

  test("falls back to the linked report body when the study rows carry no text", () => {
    const merged = mergePriorStudies(
      [study({ id: 7, finalReport: null, prelimReport: null })],
      [report({ id: 40, studyId: 7, body: "Signed report body" })],
    );
    expect(merged[0].finalReport).toBe("Signed report body");
  });

  test("testName falls back to studyDescription, then modality, so the dropdown is never blank", () => {
    const a = mergePriorStudies([study({ id: 8, testName: null })], [])[0];
    expect(a.testName).toBe("MRI LS Spine");
    const b = mergePriorStudies([study({ id: 9, testName: null, studyDescription: null })], [])[0];
    expect(b.testName).toBe("MR");
  });

  test("empty input produces an empty list (clean no-priors state)", () => {
    expect(mergePriorStudies([], [])).toEqual([]);
  });
});
