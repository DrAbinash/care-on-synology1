/**
 * E2E Acceptance Test — Phase 7: Generate 10 test PDFs
 * 
 * This test generates PDFs for all 10 synthetic test cases using the
 * existing CARE PDF generator, then validates basic structure.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "node:path";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { readFileSync } from "fs";

// Load test cases
const manifestPath = join(__dirname, "../../../radiology-e2e-acceptance/manifests/test-cases-v2.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// Output directory
const reportsDir = join(__dirname, "../../../radiology-e2e-acceptance/reports-v2");
mkdirSync(reportsDir, { recursive: true });

// Clinic info (synthetic)
const clinic = {
  name: "CARE DIAGNOSTICS (TEST)",
  address: "TEST ADDRESS — NOT FOR CLINICAL USE",
  phone: "TEST PHONE",
  email: "test@example.com",
};

// Print settings with watermark
const settings = {
  ...DEFAULT_PRINT_SETTINGS,
  watermark: "SYNTHETIC TEST REPORT — NOT FOR CLINICAL USE",
  watermarkOpacity: 0.15,
  show: {
    ...DEFAULT_PRINT_SETTINGS.show,
    keyImages: false, // No actual images in this test
  },
};

describe("E2E acceptance — Phase 7: PDF generation (CORRECTED FORMAT)", () => {
  it("generates 4 corrected test PDFs with structured findings", () => {
    expect(manifest.cases.length).toBeGreaterThanOrEqual(4);

    const results: Array<{
      id: string;
      exam: string;
      polarity: string;
      pages: number;
      sizeBytes: number;
      path: string;
    }> = [];

    for (const testCase of manifest.cases) {
      // Build ReportData from test case
      const reportData = {
        patientName: testCase.patient.name,
        age: String(testCase.patient.age),
        sex: testCase.patient.sex,
        accessionNumber: testCase.patient.accession,
        uhid: testCase.patient.uhid,
        studyDate: new Date().toISOString().split("T")[0],
        referringDoctor: "TEST REFERRING DOCTOR",
        modality: testCase.study.modality,
        bodyPart: testCase.study.bodyPart,
        clinicalHistory: testCase.clinicalIndication,
        technique: testCase.technique,
        findings: testCase.findings,
        impression: testCase.impression,
        recommendation: testCase.recommendation || "",
        comparison: "",
        measurements: testCase.measurements.map((m: any) => ({
          label: `${m.level} Canal AP`,
          // One decimal throughout: a bare 14 next to 15.2 reads as a different
          // precision of the same caliper measurement.
          value: `${Number(m.canalAP).toFixed(1)} ${m.unit}`,
        })),
        keyImages: [], // No actual images
        reportTitle: testCase.exam,
        reportingScopeNote: testCase.screeningLimitation || "",
        printedBy: "E2E ACCEPTANCE TEST",
      };

      const pdf = generateReportPDF(reportData, settings, clinic, { save: false });
      const pdfBytes = Buffer.from(pdf.output("arraybuffer"));
      const pdfPath = join(reportsDir, `${testCase.id}.pdf`);
      writeFileSync(pdfPath, pdfBytes);

      results.push({
        id: testCase.id,
        exam: testCase.exam,
        polarity: testCase.polarity,
        pages: pdf.getNumberOfPages(),
        sizeBytes: pdfBytes.length,
        path: pdfPath,
      });

      // Basic validation
      expect(existsSync(pdfPath)).toBe(true);
      expect(pdfBytes.length).toBeGreaterThan(10_000); // At least 10KB
      expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    }

    // Log summary
    console.log("\n=== PDF Generation Summary ===");
    console.table(
      results.map((r) => ({
        ID: r.id,
        Exam: r.exam,
        Polarity: r.polarity,
        Pages: r.pages,
        "Size (KB)": (r.sizeBytes / 1024).toFixed(1),
      }))
    );

    // Verify all were generated
    expect(results.length).toBeGreaterThanOrEqual(4);
  });
});
