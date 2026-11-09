import { describe, expect, test } from "vitest";
import {
  formatMwlPersonName,
  formatMwlPatientAge,
  mwlStudyInstanceUid,
  mwlSeriesInstanceUid,
  mwlSopInstanceUid,
  assertValidMwlDump,
  buildMwlDumpText,
  mwlAccession,
  DICOM_SH_MAX_BYTES,
} from "./mwlWorklistWriter";
import { normalizeAccessionKey } from "./matchingEngine";

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
    // Capitals on the machine (owner request 7 Nov 2026). The database keeps the
    // case the desk typed; only the wire value is upper-cased, which is why this
    // assertion is about the dump and not about the row.
    expect(buildMwlDumpText({ ...base, referringDoctor: "Dr. Sanjay Kumar, MD" }))
      .toContain("(0008,0090) PN [DR. SANJAY KUMAR, MD]");
    const none = buildMwlDumpText(base);
    expect(none).toContain("(0008,0090) PN []");
    expect(none).not.toContain("(0008,0090) PN [ANONYMOUS]");
  });

  test("the exam name reaches the console in capitals, in every field that carries it", () => {
    const dump = buildMwlDumpText({ ...base, studyDescription: "USG Anomaly Level II" });
    expect(dump).toContain("(0032,1060) LO [USG ANOMALY LEVEL II]");
    expect(dump).toContain("(0040,0007) LO [USG ANOMALY LEVEL II]");
    // The MRI console maps neither description attribute (owner screenshot), so
    // the step comments carry it too.
    expect(dump).toContain("(0040,0010) LO [USG ANOMALY LEVEL II]");
    // And the study-level (0008,1030), which is the one the UIH console actually
    // paints its "Study Description" box from — the three above left it empty.
    expect(dump).toContain("(0008,1030) LO [USG ANOMALY LEVEL II]");
    expect(dump).not.toContain("USG Anomaly Level II");
  });

  test("the scheduled date/time also reach the study-level tags UIH reads", () => {
    const dump = buildMwlDumpText({ ...base, scheduledDate: "20261109", scheduledTime: "143138" });
    // SPS sequence (already sent before this fix).
    expect(dump).toContain("(0040,0002) DA [20261109]");
    expect(dump).toContain("(0040,0003) TM [143138]");
    // Study-level mirror — the console's Study Date/Time read these, not the SPS.
    expect(dump).toContain("(0008,0020) DA [20261109]");
    expect(dump).toContain("(0008,0030) TM [143138]");
  });

  test("no study-level date/time tags when the schedule is unknown", () => {
    const dump = buildMwlDumpText({ ...base, scheduledDate: null, scheduledTime: null });
    expect(dump).not.toContain("(0008,0020) DA [");
    expect(dump).not.toContain("(0008,0030) TM [");
  });

  test("the exam name falls back to the procedure name, still in capitals", () => {
    const dump = buildMwlDumpText({ ...base, studyDescription: null, procedureName: "MRI brain" });
    expect(dump).toContain("(0040,0007) LO [MRI BRAIN]");
  });

  test("dump stays valid for Orthanc's worklist housekeeper", () => {
    expect(() => assertValidMwlDump(buildMwlDumpText({ ...base, patientAge: "8 months" }))).not.toThrow();
  });
});

describe("MWL accession fits the 16 bytes a DICOM SH field holds", () => {
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

  test("no SH value in a real dump exceeds 16 bytes", () => {
    const dump = buildMwlDumpText(base);
    const sh = [...dump.matchAll(/\((\d{4},\d{4})\) SH \[(.*)\]/g)];
    expect(sh.length).toBeGreaterThanOrEqual(3);
    for (const [, tag, value] of sh) {
      expect(Buffer.byteLength(value, "utf8"), `(${tag})`).toBeLessThanOrEqual(DICOM_SH_MAX_BYTES);
    }
  });

  test("dropping the punctuation keeps the SAME match key as the canonical accession", () => {
    const compact = mwlAccession("ACC-20261104-US-001");
    expect(compact).toBe("ACC20261104US001");
    expect(normalizeAccessionKey(compact)).toBe(normalizeAccessionKey("ACC-20261104-US-001"));
  });

  test("every two-letter modality CARE issues keeps prefix, date and sequence", () => {
    for (const mod of ["CR", "US", "MR", "CT", "MG"]) {
      const canonical = `ACC-20261104-${mod}-001`;
      const compact = mwlAccession(canonical);
      expect(Buffer.byteLength(compact, "utf8"), mod).toBeLessThanOrEqual(DICOM_SH_MAX_BYTES);
      expect(normalizeAccessionKey(compact), mod).toBe(normalizeAccessionKey(canonical));
    }
  });

  test("a three-letter modality keeps its tail and stays unique per study", () => {
    const a = mwlAccession("ACC-20261104-BMD-001");
    const b = mwlAccession("ACC-20261104-BMD-002");
    expect(Buffer.byteLength(a, "utf8")).toBe(DICOM_SH_MAX_BYTES);
    expect(a).not.toBe(b);
    expect(a).toContain("20261104");
    expect(a).toContain("001");
  });

  test("two studies on one day never collapse onto one string", () => {
    // This is the regression the live PACS measured: 453 November ultrasound
    // studies onto 5 accessions, because the unit cut the 19 bytes to 16 and
    // what survived was the day.
    const seen = new Set<string>();
    for (let n = 1; n <= 20; n++) {
      const value = mwlAccession(`ACC-20261104-US-${String(n).padStart(3, "0")}`);
      expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(DICOM_SH_MAX_BYTES);
      seen.add(value);
    }
    expect(seen.size).toBe(20);
  });

  test("the canonical string still travels in the comments and the UIDs stay canonical", () => {
    const dump = buildMwlDumpText(base);
    expect(dump).toContain("CARE-ACC:ACC-20261104-US-001");
    expect(dump).toContain(`UI [${mwlStudyInstanceUid("ACC-20261104-US-001")}]`);
    expect(dump).toContain("(0008,0050) SH [ACC20261104US001]");
    expect(dump).not.toContain("(0008,0050) SH [ACC-20261104-US-001]");
  });

  test("an empty accession stays empty rather than becoming a value", () => {
    expect(mwlAccession("")).toBe("");
    expect(mwlAccession(null)).toBe("");
    expect(mwlAccession(undefined)).toBe("");
  });
});
