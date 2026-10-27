import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fail on any unexpected database access, including during sign-time capture.
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => { throw new Error("Identity loader tests must not contact a database"); }),
  },
}));
vi.mock("./radiologyIdentity", async (importOriginal) => ({
  ...await importOriginal<typeof import("./radiologyIdentity")>(),
  resolveWorklistFromStudyRef: vi.fn(),
  loadBilledStudy: vi.fn(),
}));

import { db } from "@workspace/db";
import { loadBilledStudy, resolveWorklistFromStudyRef } from "./radiologyIdentity";
import {
  captureReportIdentity,
  effectiveReportIdentity,
  EMPTY_STUDY_IDENTITY,
  loadReportStudyIdentityForReport,
  type PatientIdentityFacts,
} from "./reportStudyIdentity";

const resolveWorklist = vi.mocked(resolveWorklistFromStudyRef, { partial: true });
const loadBilled = vi.mocked(loadBilledStudy, { partial: true });
const report = { type: "radiology", studyId: 41, patientId: 77 };
const worklist = {
  id: 41,
  studyId: 72,
  patientId: 77,
  accessionNumber: "ACC-CURRENT-WORKLIST",
  studyDate: "",
  referringDoctor: "",
};
const currentStudy = {
  id: 72,
  patientId: 77,
  accessionNumber: "ACC-CURRENT-BILLED",
  studyDate: "2026-10-20",
  referringDoctor: "Dr Current Referrer",
};
// Same patient, different examination: patient checks alone cannot reject it.
const unrelatedStudy = {
  id: 41,
  patientId: 77,
  accessionNumber: "ACC-OLD-BILLED",
  studyDate: "2024-02-03",
  referringDoctor: "Dr Old Referrer",
};
const patient: PatientIdentityFacts = {
  name: "Synthetic Patient",
  uhid: "SYNTHETIC-77",
  sex: "F",
  dateOfBirth: "1980-01-01",
  ageValue: null,
  ageUnit: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  resolveWorklist.mockResolvedValue({ ...worklist });
  loadBilled.mockImplementation(async (id) => {
    if (id === 72) return { ...currentStudy };
    if (id === 41) return { ...unrelatedStudy };
    throw new Error(`Unexpected billed-study lookup: ${id}`);
  });
});
afterEach(() => {
  expect(db.select).not.toHaveBeenCalled();
});

describe("report study identity loader — linked study, not a same-number collision", () => {
  it("reportRef 41 uses worklist 41's billed study 72 for the current date and referrer", async () => {
    const verdict = await loadReportStudyIdentityForReport(report);

    expect(verdict.study).toMatchObject({
      status: "resolved",
      identity: {
        accessionNumber: worklist.accessionNumber,
        studyDate: currentStudy.studyDate,
        referringDoctor: currentStudy.referringDoctor,
      },
      sources: ["worklist", "billed-study"],
    });
    expect(verdict.accession).toEqual({
      status: "resolved", accession: worklist.accessionNumber, source: "worklist",
    });
    expect(resolveWorklist).toHaveBeenCalledExactlyOnceWith(41);
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(72);
    expect(loadBilled).not.toHaveBeenCalledWith(41);
  });

  it("captures the current linked date and referrer in the frozen signing identity", async () => {
    // Both captureReportIdentity and its render/study loaders remain real.
    const frozen = await captureReportIdentity(report, patient);

    expect(frozen).toMatchObject({
      patientName: patient.name,
      uhid: patient.uhid,
      ageAtExamination: "46 Yrs",
      study: {
        accessionNumber: worklist.accessionNumber,
        studyDate: currentStudy.studyDate,
        referringDoctor: currentStudy.referringDoctor,
      },
      capturedAt: expect.any(String),
    });
    const rendered = effectiveReportIdentity(frozen, {
      patientName: "Changed master", uhid: "", sex: "", ageAtExamination: "",
      study: { ...EMPTY_STUDY_IDENTITY },
    });
    expect(rendered).toMatchObject({ source: "frozen", study: frozen.study });
    expect(resolveWorklist).toHaveBeenCalledExactlyOnceWith(41);
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(72);
  });

  it.each([null, undefined, 0, -1, NaN, Infinity])(
    "does not fall back to billed 41 when the worklist link is %s",
    async (studyId) => {
      resolveWorklist.mockResolvedValue({ ...worklist, studyId });
      const verdict = await loadReportStudyIdentityForReport(report);

      expect(verdict.study).toMatchObject({
        status: "resolved",
        identity: { accessionNumber: worklist.accessionNumber, studyDate: "", referringDoctor: "" },
        sources: ["worklist"],
      });
      expect(resolveWorklist).toHaveBeenCalledExactlyOnceWith(41);
      expect(loadBilled).not.toHaveBeenCalled();
    },
  );

  it("does not fall back to billed 41 when linked billed 72 is missing", async () => {
    loadBilled.mockImplementation(async (id) => id === 72 ? null : { ...unrelatedStudy });
    const verdict = await loadReportStudyIdentityForReport(report);

    expect(verdict.study).toMatchObject({
      status: "resolved", identity: { studyDate: "", referringDoctor: "" }, sources: ["worklist"],
    });
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(72);
  });

  it("keeps worklist fields ahead of linked billed-study gap filling", async () => {
    resolveWorklist.mockResolvedValue({ ...worklist, studyDate: "20261021", referringDoctor: "Dr Worklist" });
    const verdict = await loadReportStudyIdentityForReport(report);

    expect(verdict.study).toMatchObject({
      status: "resolved", identity: { studyDate: "2026-10-21", referringDoctor: "Dr Worklist" },
    });
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(72);
  });

  it("retains the legacy billed-reference lookup only when no worklist resolves", async () => {
    resolveWorklist.mockResolvedValue(null);
    const verdict = await loadReportStudyIdentityForReport(report);

    expect(verdict.study).toMatchObject({
      status: "resolved",
      identity: {
        accessionNumber: unrelatedStudy.accessionNumber,
        studyDate: unrelatedStudy.studyDate,
        referringDoctor: unrelatedStudy.referringDoctor,
      },
      sources: ["billed-study"],
    });
    expect(verdict.accession).toEqual({
      status: "resolved", accession: unrelatedStudy.accessionNumber, source: "billed-study",
    });
    expect(resolveWorklist).toHaveBeenCalledExactlyOnceWith(41);
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(41);
  });

  it("still rejects a linked billed study belonging to another patient", async () => {
    loadBilled.mockResolvedValue({ ...currentStudy, patientId: 900 });
    const verdict = await loadReportStudyIdentityForReport(report);

    expect(verdict.study).toMatchObject({
      status: "resolved",
      identity: { accessionNumber: worklist.accessionNumber, studyDate: "", referringDoctor: "" },
      sources: ["worklist"],
    });
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(72);
  });

  it("rejects both foreign candidates without trying a same-patient billed 41", async () => {
    resolveWorklist.mockResolvedValue({ ...worklist, patientId: 900 });
    loadBilled.mockImplementation(async (id) => id === 72
      ? { ...currentStudy, patientId: 900 }
      : { ...unrelatedStudy });
    const verdict = await loadReportStudyIdentityForReport(report);

    for (const result of [verdict.accession, verdict.study]) {
      expect(result).toMatchObject({
        status: "absent",
        rejected: [
          { source: "worklist", why: "belongs to patient 900, not 77" },
          { source: "billed-study", why: "belongs to patient 900, not 77" },
        ],
      });
    }
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(72);
  });

  it("still rejects a foreign legacy billed reference when no worklist exists", async () => {
    resolveWorklist.mockResolvedValue(null);
    loadBilled.mockResolvedValue({ ...unrelatedStudy, patientId: 900 });
    const verdict = await loadReportStudyIdentityForReport(report);

    expect(verdict.accession).toMatchObject({ status: "absent", reason: "patient-mismatch" });
    expect(verdict.study).toMatchObject({
      status: "absent", rejected: [{ source: "billed-study", why: "belongs to patient 900, not 77" }],
    });
    expect(loadBilled).toHaveBeenCalledExactlyOnceWith(41);
  });

  it("still refuses a report with no patient to verify", async () => {
    const verdict = await loadReportStudyIdentityForReport({ ...report, patientId: null });
    expect(verdict.accession).toMatchObject({ status: "absent", reason: "patient-mismatch" });
    expect(verdict.study).toMatchObject({ status: "absent", reason: "patient-mismatch" });
  });

  it.each(["pathology", null, undefined])("does no loads for non-radiology type %s", async (type) => {
    const verdict = await loadReportStudyIdentityForReport({ ...report, type });
    expect(verdict.accession).toMatchObject({ status: "absent", reason: "not-radiology" });
    expect(verdict.study).toMatchObject({ status: "absent", reason: "not-radiology" });
    expect(resolveWorklist).not.toHaveBeenCalled();
    expect(loadBilled).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 0, -1, NaN, Infinity])("does no loads for invalid study reference %s", async (studyId) => {
    const verdict = await loadReportStudyIdentityForReport({ ...report, studyId });
    expect(verdict.accession).toMatchObject({ status: "absent", reason: "no-study-reference" });
    expect(verdict.study).toMatchObject({ status: "absent", reason: "no-study-reference" });
    expect(resolveWorklist).not.toHaveBeenCalled();
    expect(loadBilled).not.toHaveBeenCalled();
  });
});
