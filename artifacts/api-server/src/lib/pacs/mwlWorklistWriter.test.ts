import { describe, expect, test } from "vitest";
import {
  formatMwlPersonName,
  formatMwlPatientAge,
  mwlStudyInstanceUid,
  mwlSeriesInstanceUid,
  mwlSopInstanceUid,
  assertValidMwlDump,
  buildMwlDumpText,
} from "./mwlWorklistWriter";

describe("MWL UIDs (Orthanc housekeeper requires non-empty Study/Series/SOP UIDs)", () => {
  test("generates stable numeric UIDs from accession", () => {
    const a = mwlStudyInstanceUid("ACC-2026-001");
    const b = mwlStudyInstanceUid("ACC-2026-001");
    expect(a).toBe(b);
    expect(a).toMatch(/^1\.2\.840\.9999\.113\.1\.\d+$/);
    expect(mwlSeriesInstanceUid("ACC-2026-001")).toMatch(/^1\.2\.840\.9999\.113\.2\.\d+$/);
    expect(mwlSopInstanceUid("ACC-2026-001")).toMatch(/^1\.2\.840\.9999\.113\.3\.\d+$/);
  });

  test("different accessions produce different study UIDs", () => {
    expect(mwlStudyInstanceUid("A1")).not.toBe(mwlStudyInstanceUid("A2"));
  });

  test("assertValidMwlDump rejects empty StudyInstanceUID", () => {
    const bad = [
      "(0008,0016) UI [1.2.840.10008.5.1.4.31]",
      "(0008,0018) UI [1.2.3]",
      "(0020,000D) UI []",
      "(0020,000E) UI [1.2.4]",
      "(0040,0100) SQ",
    ].join("\n");
    expect(() => assertValidMwlDump(bad)).toThrow(/empty|Study|invalid/i);
  });

  test("assertValidMwlDump rejects non-numeric UID", () => {
    const bad = [
      "(0008,0016) UI [1.2.840.10008.5.1.4.31]",
      "(0008,0018) UI [1.2.3]",
      "(0020,000D) UI [1.2.840.care.bad]",
      "(0020,000E) UI [1.2.4]",
      "(0040,0100) SQ",
    ].join("\n");
    expect(() => assertValidMwlDump(bad)).toThrow(/invalid DICOM UID/i);
  });

  test("generated UIDs are numeric and <= 64 chars", () => {
    for (const acc of ["A", "ACC-2026-001", "x".repeat(80)]) {
      for (const uid of [mwlStudyInstanceUid(acc), mwlSeriesInstanceUid(acc), mwlSopInstanceUid(acc)]) {
        expect(uid.length).toBeLessThanOrEqual(64);
        expect(uid).toMatch(/^[0-9]+(\.[0-9]+)+$/);
      }
    }
  });

  test("assertValidMwlDump accepts a well-formed dump skeleton", () => {
    const study = mwlStudyInstanceUid("ACC1");
    const series = mwlSeriesInstanceUid("ACC1");
    const sop = mwlSopInstanceUid("ACC1");
    const good = [
      `(0008,0016) UI [1.2.840.10008.5.1.4.31]`,
      `(0008,0018) UI [${sop}]`,
      `(0020,000D) UI [${study}]`,
      `(0020,000E) UI [${series}]`,
      `(0040,0100) SQ`,
    ].join("\n");
    expect(() => assertValidMwlDump(good)).not.toThrow();
  });

  test("live crash-class dump (empty Study/Series/SOP) is refused", () => {
    const crashClass = [
      "(0008,0016) UI [1.2.840.10008.5.1.4.31]",
      "(0008,0018) UI []",
      "(0008,0050) SH [ACC-20260811-CR-005]",
      "(0020,000D) UI []",
      "(0020,000E) UI []",
      "(0040,0100) SQ",
    ].join("\n");
    expect(() => assertValidMwlDump(crashClass)).toThrow(/UID|empty|invalid/i);
  });

  test("rebuild of ACC-20260811-CR-005 emits non-empty Study/Series/SOP UIDs", () => {
    const dump = buildMwlDumpText({
      accessionNumber: "ACC-20260811-CR-005",
      patientName: "Test Patient",
      modality: "CR",
      scheduledDate: "20260811",
    });
    expect(() => assertValidMwlDump(dump)).not.toThrow();
    expect(dump).toMatch(/\(0020,000D\) UI \[1\.2\.840\.9999\.113\.1\.\d+\]/);
    expect(dump).toMatch(/\(0020,000E\) UI \[1\.2\.840\.9999\.113\.2\.\d+\]/);
    expect(dump).toMatch(/\(0008,0018\) UI \[1\.2\.840\.9999\.113\.3\.\d+\]/);
    expect(dump).not.toMatch(/\(0020,000D\) UI \[\s*\]/);
    expect(dump).not.toMatch(/\(0020,000E\) UI \[\s*\]/);
    expect(dump).not.toMatch(/\(0008,0018\) UI \[\s*\]/);
    // Unconfigured station AE must not invent literal ANY (Orthanc string match).
    expect(dump).toMatch(/\(0040,0001\) AE \[\]/);
    expect(dump).not.toMatch(/\(0040,0001\) AE \[ANY\]/);
  });
});

describe("formatMwlPersonName (ERP → modality PN)", () => {
  // Consoles paint component 0 verbatim, so the wire value must already be in
  // bill-desk order. Family^Given made the GE Voluson show "FAMILY GIVEN".
  test("keeps bill-desk display order, no caret reordering", () => {
    expect(formatMwlPersonName("GIVEN FAMILY")).toBe("GIVEN FAMILY");
    expect(formatMwlPersonName("Rita Kumar Sharma")).toBe("Rita Kumar Sharma");
  });

  test("flips a caret PN stored as Family^Given into display order", () => {
    expect(formatMwlPersonName("FAMILY^GIVEN^^^MD")).toBe("Given Family, MD");
  });

  test("anonymous fallback", () => {
    expect(formatMwlPersonName("")).toBe("ANONYMOUS");
    expect(formatMwlPersonName(null)).toBe("ANONYMOUS");
  });
});

describe("formatMwlPatientAge (0010,1010, VR AS)", () => {
  test("ERP age strings become 3-digit + unit codes", () => {
    expect(formatMwlPatientAge("26 years", null)).toBe("026Y");
    expect(formatMwlPatientAge("8 months", null)).toBe("008M");
    expect(formatMwlPatientAge("20 days", null)).toBe("020D");
    expect(formatMwlPatientAge("45", null)).toBe("045Y");
  });

  test("falls back to date of birth when the stored age is unusable", () => {
    const now = new Date(2026, 10, 4); // 2026-11-04
    expect(formatMwlPatientAge("0 years", "19980615", now)).toBe("028Y");
    expect(formatMwlPatientAge(null, "20260901", now)).toBe("002M");
  });

  test("never invents an age", () => {
    expect(formatMwlPatientAge(null, null)).toBe("");
    expect(formatMwlPatientAge("not an age", "garbage")).toBe("");
    expect(formatMwlPatientAge("0 years", null)).toBe("");
  });
});

describe("buildMwlDumpText — what the modality console shows", () => {
  const base = {
    accessionNumber: "ACC-20261104-US-001",
    patientId: "P-0000001",
    patientName: "GIVEN FAMILY",
    patientSex: "F",
    patientDob: "20000101",
    modality: "US",
    studyDescription: "USG WHOLE ABDOMEN",
    scheduledDate: "20261104",
    scheduledTime: "100000",
    stationAeTitle: "Voluson",
  };

  test("patient name reaches the console in bill-desk order", () => {
    const dump = buildMwlDumpText(base);
    expect(dump).toContain("(0010,0010) PN [GIVEN FAMILY]");
    expect(dump).not.toMatch(/\(0010,0010\) PN \[FAMILY\^GIVEN\]/);
  });

  test("age comes from the stored value, else from date of birth, else not at all", () => {
    expect(buildMwlDumpText({ ...base, patientAge: "8 months" })).toContain("(0010,1010) AS [008M]");
    // base has dob 20000101 and no stored age → derived, not invented
    expect(buildMwlDumpText(base)).toMatch(/\(0010,1010\) AS \[\d{3}Y\]/);
    const noAge = { ...base, patientAge: null, patientDob: null };
    expect(buildMwlDumpText(noAge)).not.toMatch(/\(0010,1010\)/);
  });

  test("referring doctor is sent when known, blank when not — never ANONYMOUS", () => {
    expect(buildMwlDumpText({ ...base, referringDoctor: "Dr. Sanjay Kumar, MD" }))
      .toContain("(0008,0090) PN [Dr. Sanjay Kumar, MD]");
    const none = buildMwlDumpText(base);
    expect(none).toContain("(0008,0090) PN []");
    expect(none).not.toContain("(0008,0090) PN [ANONYMOUS]");
  });

  test("dump stays valid for Orthanc's worklist housekeeper", () => {
    expect(() => assertValidMwlDump(buildMwlDumpText({ ...base, patientAge: "8 months" }))).not.toThrow();
  });
});
