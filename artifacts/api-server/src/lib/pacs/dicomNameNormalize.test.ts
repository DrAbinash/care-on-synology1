import { describe, expect, test } from "vitest";
import {
  formatDicomPersonNameForDisplay,
  nameComparisonKeys,
  nameTokensForMatch,
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
});
