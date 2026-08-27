import { describe, expect, test } from "vitest";
import {
  formatDicomPersonNameForDisplay,
  nameComparisonKeys,
  nameTokensForMatch,
  accessionLooksLikeReferringDoctor,
  reconcileAccessionVsReferringDoctor,
  formatReferringDoctorDisplay,
} from "./dicomNameNormalize";
import { calculateMatchScore, nameSimilarity } from "./matchingEngine";

describe("formatDicomPersonNameForDisplay", () => {
  test("reorders DICOM Last^First and keeps degree", () => {
    expect(formatDicomPersonNameForDisplay("SINGH^ABINASH^^^MD")).toBe("Abinash Singh, MD");
  });

  test("strips carets without inventing order when already spaced", () => {
    expect(formatDicomPersonNameForDisplay("Dr. John Smith MD")).toBe("John Smith, MD");
  });
});

describe("nameSimilarity / matching", () => {
  test("MRI LAST FIRST matches ERP First Last", () => {
    expect(nameSimilarity("SHARMA RITA", "Rita Sharma")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("SINGH^ABINASH^^^MD", "Abinash Singh")).toBeGreaterThanOrEqual(0.85);
  });

  test("degrees and Dr. do not cause mismatch", () => {
    expect(nameSimilarity("DR SMITH^JOHN^^MD", "Dr. John Smith")).toBeGreaterThanOrEqual(0.85);
    expect(nameTokensForMatch("Dr. John Smith, MBBS")).toEqual(["john", "smith"]);
  });

  test("token keys cover reverse order", () => {
    const a = nameComparisonKeys("Rita Sharma");
    const b = nameComparisonKeys("SHARMA RITA");
    expect(a.some((k) => b.includes(k))).toBe(true);
  });

  test("accession + cleaned name yields GREEN not NAME_MISMATCH RED", () => {
    const result = calculateMatchScore(
      {
        patientName: "KUMAR^RAVI^^^",
        modality: "MR",
        accessionNumber: "ACC-2026-001",
        referringDoctor: "SINGH^ABINASH^^^MD",
      },
      {
        id: 1,
        patientId: 10,
        patientName: "Ravi Kumar",
        modality: "MRI",
        accessionNumber: "ACC-2026-001",
        testName: "MRI Brain",
        referringDoctor: "Dr. Abinash Singh",
      },
    );
    expect(result.warnings.some((w) => w.startsWith("NAME_MISMATCH"))).toBe(false);
    expect(result.points).toBeGreaterThanOrEqual(75);
    expect(result.score).toBe("GREEN");
    expect(result.reasons.some((r) => r.includes("Referring doctor"))).toBe(true);
  });

  test("exact accession makes NAME_MISMATCH non-critical (work-id link)", () => {
    const result = calculateMatchScore(
      {
        patientName: "COMPLETELY DIFFERENT PERSON",
        modality: "MR",
        accessionNumber: "ACC-2026-999",
      },
      {
        id: 2,
        patientId: 11,
        patientName: "Ravi Kumar",
        modality: "MRI",
        accessionNumber: "ACC-2026-999",
        testName: "MRI Brain",
        patientUHID: "UHID1",
        studyDate: "2026-07-31",
      },
    );
    // Accession (+50) + modality (+10) + … — name warning may exist but score not forced RED.
    expect(result.warnings.some((w) => w.startsWith("NAME_MISMATCH"))).toBe(true);
    expect(result.score).not.toBe("RED");
  });
});

describe("accessionLooksLikeReferringDoctor / reconcileAccessionVsReferringDoctor", () => {
  test("MRI billed doctor name in Acc No. is not a real accession", () => {
    expect(accessionLooksLikeReferringDoctor("DR.SANJAY KUMAR")).toBe(true);
    expect(accessionLooksLikeReferringDoctor("DR.A.K.SINGH MCH")).toBe(true);
    expect(accessionLooksLikeReferringDoctor("Dr Sanjay Kumar MD")).toBe(true);
    expect(accessionLooksLikeReferringDoctor("ACC-20260813-MR-001")).toBe(false);
    expect(accessionLooksLikeReferringDoctor("CT20260813001")).toBe(false);
  });

  test("moves doctor-like accession into REF. BY and hides fake ACC", () => {
    const r = reconcileAccessionVsReferringDoctor({
      accessionNumber: "DR.SANJAY KUMAR",
      referringDoctor: "",
    });
    expect(r.accessionNumber).toBe("");
    expect(r.referringDoctor).toMatch(/Sanjay Kumar/i);
    expect(r.referringDoctor).toMatch(/^Dr\./);
  });

  test("keeps a real accession and formats an existing referring doctor with degree", () => {
    const r = reconcileAccessionVsReferringDoctor({
      accessionNumber: "ACC-20260813-MR-001",
      referringDoctor: "SANJAY KUMAR MD",
    });
    expect(r.accessionNumber).toBe("ACC-20260813-MR-001");
    expect(r.referringDoctor).toContain("MD");
  });

  test("formatReferringDoctorDisplay prefixes Dr. and keeps degree", () => {
    expect(formatReferringDoctorDisplay("Sanjay Kumar MD")).toMatch(/Dr\.\s.*MD/);
  });

  test("blanks junk SELF / walk-in referring doctors", () => {
    expect(formatReferringDoctorDisplay("DR. SELF ONLINE")).toBe("");
    expect(formatReferringDoctorDisplay("DR. SELF WB")).toBe("");
    expect(formatReferringDoctorDisplay("SELF")).toBe("");
    expect(formatReferringDoctorDisplay("walk-in")).toBe("");
    const r = reconcileAccessionVsReferringDoctor({
      accessionNumber: "ACC-1",
      referringDoctor: "DR. SELF WB",
    });
    expect(r.referringDoctor).toBe("");
    expect(r.accessionNumber).toBe("ACC-1");
  });
});
