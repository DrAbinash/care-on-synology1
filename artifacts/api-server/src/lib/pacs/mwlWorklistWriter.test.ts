import { describe, expect, test } from "vitest";
import {
  formatMwlPersonName,
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
  });
});

describe("formatMwlPersonName (ERP → modality PN)", () => {
  test("converts Given Family to Family^Given", () => {
    expect(formatMwlPersonName("Abinash Singh")).toBe("Singh^Abinash");
    expect(formatMwlPersonName("Rita Kumar Sharma")).toBe("Sharma^Rita Kumar");
  });

  test("leaves existing caret PN alone", () => {
    expect(formatMwlPersonName("SINGH^ABINASH^^^MD")).toBe("SINGH^ABINASH^^^MD");
  });

  test("anonymous fallback", () => {
    expect(formatMwlPersonName("")).toBe("ANONYMOUS");
    expect(formatMwlPersonName(null)).toBe("ANONYMOUS");
  });
});
