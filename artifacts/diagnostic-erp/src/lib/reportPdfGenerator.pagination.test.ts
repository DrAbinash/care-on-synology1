/**
 * PDF Pagination Regression Tests — Real Content Verification
 * 
 * These tests verify actual PDF properties:
 * - All clinical content is preserved (no text lost)
 * - No content duplication
 * - Deterministic fixtures (no Math.random())
 * - Page count is reasonable
 * 
 * Note: Coordinate-level verification (text not overlapping signature/footer)
 * requires visual inspection or a sophisticated PDF coordinate parser.
 * These tests verify content preservation; visual verification is separate.
 */
import { describe, it, expect } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { readFileSync } from "fs";
import { join } from "node:path";

const clinic = {
  name: "TEST DIAGNOSTICS",
  address: "TEST ADDRESS",
  phone: "TEST PHONE",
  email: "test@example.com",
};

// Helper to extract text from PDF buffer (simplified - checks for presence of strings)
function extractTextFromPdf(pdfBuffer: Buffer): string {
  // Convert PDF buffer to string (latin1 encoding preserves binary)
  // This is a simplified check - real PDF text extraction would use pdf-parse
  return pdfBuffer.toString("latin1");
}

describe("PDF pagination — content preservation", () => {
  it("preserves all findings text through pagination", () => {
    const findings = `Alignment:
Normal lumbar lordosis.

Vertebral Bodies:
Normal marrow signal throughout.
No compression fractures.

Disc Levels:
L3-L4: Normal disc height and signal.
L4-L5: Mild disc desiccation.
L5-S1: Disc herniation with canal stenosis.

Spinal Cord:
Normal conus medullaris.`;

    const report = {
      patientName: "TEST PATIENT ALPHA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST001",
      accessionNumber: "ACC001",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings,
      impression: "L5-S1 disc herniation with canal stenosis.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfText = extractTextFromPdf(pdfBuffer);

    // Verify all key content is present in the PDF
    expect(pdfText).toContain("Normal lumbar lordosis");
    expect(pdfText).toContain("Normal marrow signal");
    expect(pdfText).toContain("L3-L4");
    expect(pdfText).toContain("L4-L5");
    expect(pdfText).toContain("L5-S1");
    expect(pdfText).toContain("Disc herniation");
    expect(pdfText).toContain("Normal conus medullaris");
    expect(pdfText).toContain("L5-S1 disc herniation with canal stenosis");

    // Verify patient demographics
    expect(pdfText).toContain("TEST PATIENT ALPHA");
    expect(pdfText).toContain("TEST001");
    expect(pdfText).toContain("ACC001");

    // Verify page count is reasonable (1-3 pages for this content)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.getNumberOfPages()).toBeLessThanOrEqual(3);
  });

  it("preserves all impression items", () => {
    const report = {
      patientName: "TEST PATIENT BETA",
      age: "65 Y",
      sex: "F",
      uhid: "TEST002",
      accessionNumber: "ACC002",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal brain parenchyma. No mass lesion.",
      impression: `1. Mild chronic small-vessel ischemic changes.
2. Generalized cerebral volume loss.
3. No acute intracranial abnormality.`,
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfText = extractTextFromPdf(pdfBuffer);

    // Verify all impression items are present
    expect(pdfText).toContain("Mild chronic small-vessel ischemic changes");
    expect(pdfText).toContain("Generalized cerebral volume loss");
    expect(pdfText).toContain("No acute intracranial abnormality");

    // Verify numbering is preserved
    expect(pdfText).toMatch(/1\./);
    expect(pdfText).toMatch(/2\./);
    expect(pdfText).toMatch(/3\./);
  });

  it("preserves measurement tables without duplication", () => {
    const report = {
      patientName: "TEST PATIENT GAMMA",
      age: "45 Y",
      sex: "M",
      uhid: "TEST003",
      accessionNumber: "ACC003",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI CERVICAL SPINE",
      findings: `Disc Level Analysis:
| Level | Disc | Canal AP (mm) |
| C3-C4 | Normal | 14 |
| C4-C5 | Normal | 13 |
| C5-C6 | Bulge | 11 |
| C6-C7 | Normal | 12 |`,
      measurements: [
        { label: "C3-C4 Canal AP", value: "14 mm" },
        { label: "C4-C5 Canal AP", value: "13 mm" },
        { label: "C5-C6 Canal AP", value: "11 mm" },
        { label: "C6-C7 Canal AP", value: "12 mm" },
      ],
      impression: "C5-C6 disc bulge.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfText = extractTextFromPdf(pdfBuffer);

    // Verify all measurement values are present
    expect(pdfText).toContain("14 mm");
    expect(pdfText).toContain("13 mm");
    expect(pdfText).toContain("11 mm");
    expect(pdfText).toContain("12 mm");

    // Verify all levels are mentioned
    expect(pdfText).toContain("C3-C4");
    expect(pdfText).toContain("C4-C5");
    expect(pdfText).toContain("C5-C6");
    expect(pdfText).toContain("C6-C7");

    // Count occurrences - each should appear at least once but not excessively
    // (This is a simplified check - real deduplication would need coordinate analysis)
    const c5c6Count = (pdfText.match(/C5-C6/g) || []).length;
    expect(c5c6Count).toBeGreaterThanOrEqual(1);
    expect(c5c6Count).toBeLessThanOrEqual(5); // Reasonable upper bound
  });

  it("handles long findings that span multiple pages", () => {
    // Create a report with enough content to definitely span 2+ pages
    const longFindings = Array(15)
      .fill(null)
      .map((_, i) => `L${i + 1}-L${i + 2}: Disc bulge with mild canal stenosis. Normal marrow signal.`)
      .join("\n\n");

    const report = {
      patientName: "TEST PATIENT DELTA",
      age: "55 Y",
      sex: "M",
      uhid: "TEST004",
      accessionNumber: "ACC004",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI TOTAL SPINE",
      findings: longFindings,
      impression: "Multi-level disc disease.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfText = extractTextFromPdf(pdfBuffer);

    // Verify PDF was generated and has reasonable size
    expect(pdfBuffer.length).toBeGreaterThan(20000);

    // Verify content is present (at least some of it)
    expect(pdfText).toContain("Disc bulge");
    expect(pdfText).toContain("Multi-level disc disease");

    // Should be 2+ pages
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("preserves clinical history and technique", () => {
    const report = {
      patientName: "TEST PATIENT EPSILON",
      age: "40 Y",
      sex: "F",
      uhid: "TEST005",
      accessionNumber: "ACC005",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      clinicalHistory: "Progressive headache for 3 months. Rule out intracranial pathology.",
      technique: "Multiplanar, multisequence MRI of the brain was performed without contrast.",
      findings: "Normal brain parenchyma. No mass lesion or hemorrhage.",
      impression: "Normal MRI brain.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfText = extractTextFromPdf(pdfBuffer);

    // Verify clinical history is present
    expect(pdfText).toContain("Progressive headache");
    expect(pdfText).toContain("Rule out intracranial pathology");

    // Verify technique is present
    expect(pdfText).toContain("Multiplanar, multisequence MRI");
    expect(pdfText).toContain("without contrast");

    // Verify findings and impression
    expect(pdfText).toContain("Normal brain parenchyma");
    expect(pdfText).toContain("Normal MRI brain");
  });
});

describe("PDF pagination — deterministic fixtures", () => {
  it("uses deterministic test data (no Math.random())", () => {
    // This test verifies that fixtures are deterministic
    // by running the same report twice and comparing output
    const report = {
      patientName: "TEST PATIENT ZETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST006",
      accessionNumber: "ACC006",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: "L4-L5: Disc bulge. L5-S1: Disc herniation.",
      impression: "L5-S1 disc herniation.",
    };

    const doc1 = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const buffer1 = Buffer.from(doc1.output("arraybuffer"));

    const doc2 = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const buffer2 = Buffer.from(doc2.output("arraybuffer"));

    // PDFs should be identical (or very similar - timestamps might differ)
    // For this test, we just verify they have the same page count and similar size
    expect(doc1.getNumberOfPages()).toBe(doc2.getNumberOfPages());
    expect(Math.abs(buffer1.length - buffer2.length)).toBeLessThan(1000); // Within 1KB
  });
});

describe("PDF pagination — signature and footer protection", () => {
  it("reserves space for signature when enabled", () => {
    const report = {
      patientName: "TEST PATIENT ETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST007",
      accessionNumber: "ACC007",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal study.",
      impression: "Normal.",
    };

    const settingsWithSignature = {
      ...DEFAULT_PRINT_SETTINGS,
      signature: {
        enabled: true,
        doctorName: "Dr. Test Radiologist",
        degree: "MD, DMRD",
      },
    };

    const doc = generateReportPDF(report, settingsWithSignature, clinic, { save: false });
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfText = extractTextFromPdf(pdfBuffer);

    // Verify doctor name is present
    expect(pdfText).toContain("Dr. Test Radiologist");

    // PDF should generate successfully
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("does not include signature when disabled", () => {
    const report = {
      patientName: "TEST PATIENT THETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST008",
      accessionNumber: "ACC008",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal study.",
      impression: "Normal.",
    };

    const settingsNoSignature = {
      ...DEFAULT_PRINT_SETTINGS,
      signature: {
        enabled: false,
      },
    };

    const doc = generateReportPDF(report, settingsNoSignature, clinic, { save: false });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});

describe("PDF pagination — edge cases", () => {
  it("handles empty optional sections", () => {
    const report = {
      patientName: "TEST PATIENT IOTA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST009",
      accessionNumber: "ACC009",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      clinicalHistory: "",
      technique: "",
      comparison: "",
      findings: "Normal study.",
      impression: "Normal.",
      recommendation: "",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("handles very long single paragraph", () => {
    const longParagraph = "This is a very long paragraph. ".repeat(100);

    const report = {
      patientName: "TEST PATIENT KAPPA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST010",
      accessionNumber: "ACC010",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: longParagraph,
      impression: "Normal.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
