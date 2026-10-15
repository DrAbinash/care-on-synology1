/**
 * PDF Pagination Regression Tests — Instrumented jsPDF Approach
 * 
 * Uses instrumented jsPDF to record all text draw operations with coordinates.
 * This is more reliable than parsing PDF binary output.
 * 
 * Tests verify:
 * - No clinical text overlaps footer/signature regions
 * - All content is preserved
 * - Headings stay with their content
 * - Page breaks work correctly
 */
import { describe, it, expect } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { createInstrumentedPdf, getTextOnPage, getAllText, findText, type InstrumentedDoc } from "./testSupport/instrumentedPdf";

const clinic = {
  name: "TEST DIAGNOSTICS",
  address: "TEST ADDRESS",
  phone: "TEST PHONE",
  email: "test@example.com",
};

/**
 * Calculate the body region bottom boundary from settings.
 * This is where content must stop to avoid overlapping footer/signature.
 */
function getContentBottom(settings: typeof DEFAULT_PRINT_SETTINGS): number {
  const pageH = settings.paperSize === "A4" ? 297 : settings.paperSize === "Letter" ? 279 : 210;
  const SIG_RESERVE_MM = settings.signature.enabled ? 12 : 0;
  const FOOTER_STACK_MM = 14;
  return pageH - FOOTER_STACK_MM - SIG_RESERVE_MM;
}

describe("PDF pagination — instrumented coordinate verification", () => {
  it("no clinical text overlaps footer region (CASE-2A regression)", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const report = {
      patientName: "TEST PATIENT ALPHA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST001",
      accessionNumber: "ACC001",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: `Alignment:
Normal lumbar lordosis.

Vertebral Bodies:
Normal marrow signal.

Disc Levels:
L3-L4: Normal.
L4-L5: Mild bulge.
L5-S1: Disc herniation with canal stenosis.`,
      impression: "L5-S1 disc herniation.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    
    const contentBottom = getContentBottom(DEFAULT_PRINT_SETTINGS);
    
    // Check that no clinical findings text appears below contentBottom
    const clinicalTextInFooter = drawnTexts.filter(t => 
      t.y > contentBottom &&
      (t.text.includes("Normal lumbar") || 
       t.text.includes("Disc herniation") ||
       t.text.includes("L5-S1") ||
       t.text.includes("canal stenosis"))
    );
    
    expect(clinicalTextInFooter).toHaveLength(0);
  });

  it("no clinical text overlaps footer region (CASE-2B regression)", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const report = {
      patientName: "TEST PATIENT BETA",
      age: "65 Y",
      sex: "F",
      uhid: "TEST002",
      accessionNumber: "ACC002",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: `Alignment:
Loss of normal lumbar lordosis.

Vertebral Bodies:
Modic changes at L5-S1.

Disc Levels:
L4-L5: Disc desiccation.
L5-S1: Large disc herniation with severe canal stenosis.`,
      measurements: [
        { label: "L5-S1 Canal AP", value: "8 mm" },
      ],
      impression: "L5-S1 large disc herniation with severe canal stenosis.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    
    const contentBottom = getContentBottom(DEFAULT_PRINT_SETTINGS);
    
    // Check that no clinical text appears below contentBottom
    const clinicalTextInFooter = drawnTexts.filter(t => 
      t.y > contentBottom &&
      (t.text.includes("Loss of normal") || 
       t.text.includes("disc herniation") ||
       t.text.includes("canal stenosis") ||
       t.text.includes("Modic changes"))
    );
    
    expect(clinicalTextInFooter).toHaveLength(0);
  });

  it("all clinical content stays within body region", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const report = {
      patientName: "TEST PATIENT GAMMA",
      age: "45 Y",
      sex: "M",
      uhid: "TEST003",
      accessionNumber: "ACC003",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      clinicalHistory: "Headache, rule out intracranial pathology.",
      technique: "Multiplanar MRI without contrast.",
      findings: "Normal brain parenchyma. No mass lesion.",
      impression: "Normal MRI brain.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    
    const contentBottom = getContentBottom(DEFAULT_PRINT_SETTINGS);
    
    // All clinical text should be above contentBottom
    const clinicalKeywords = ["Headache", "Multiplanar", "Normal brain", "No mass lesion", "Normal MRI"];
    
    for (const keyword of clinicalKeywords) {
      const matches = findText({ doc, drawnTexts }, keyword);
      for (const match of matches) {
        expect(match.y).toBeLessThanOrEqual(contentBottom);
      }
    }
  });

  it("all findings text is preserved", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const findings = `Alignment:
Normal lumbar lordosis.

Vertebral Bodies:
Normal marrow signal throughout.

Disc Levels:
L3-L4: Normal disc height.
L4-L5: Mild disc desiccation.
L5-S1: Disc herniation with canal stenosis.`;

    const report = {
      patientName: "TEST PATIENT DELTA",
      age: "55 Y",
      sex: "M",
      uhid: "TEST004",
      accessionNumber: "ACC004",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings,
      impression: "L5-S1 disc herniation.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    const allText = getAllText({ doc, drawnTexts });
    
    // Verify all key findings are present
    expect(allText).toContain("Normal lumbar lordosis");
    expect(allText).toContain("Normal marrow signal");
    expect(allText).toContain("L3-L4");
    expect(allText).toContain("L4-L5");
    expect(allText).toContain("L5-S1");
    expect(allText).toContain("Disc herniation");
    expect(allText).toContain("canal stenosis");
  });

  it("anatomical headings remain with their content", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const report = {
      patientName: "TEST PATIENT EPSILON",
      age: "40 Y",
      sex: "F",
      uhid: "TEST005",
      accessionNumber: "ACC005",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: `Alignment:
Normal lumbar lordosis.

Vertebral Bodies:
Normal marrow signal.`,
      impression: "Normal study.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    
    // Find "Alignment:" heading
    const alignmentHeading = drawnTexts.find(t => t.text.includes("Alignment:"));
    expect(alignmentHeading).toBeDefined();
    
    // Find "Normal lumbar lordosis" content
    const alignmentContent = drawnTexts.find(t => t.text.includes("Normal lumbar lordosis"));
    expect(alignmentContent).toBeDefined();
    
    // They should be on the same page and content should be below heading
    if (alignmentHeading && alignmentContent) {
      expect(alignmentHeading.page).toBe(alignmentContent.page);
      expect(alignmentContent.y).toBeGreaterThan(alignmentHeading.y);
    }
  });

  it("measurements are preserved without duplication", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const report = {
      patientName: "TEST PATIENT ZETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST006",
      accessionNumber: "ACC006",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI CERVICAL SPINE",
      findings: "C5-C6: Disc bulge.",
      measurements: [
        { label: "C5-C6 Canal AP", value: "11 mm" },
      ],
      impression: "C5-C6 disc bulge.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    const allText = getAllText({ doc, drawnTexts });
    
    // Verify measurement is present
    expect(allText).toContain("11 mm");
    expect(allText).toContain("C5-C6");
    
    // Check for excessive duplication
    const c5c6Count = (allText.match(/C5-C6/g) || []).length;
    expect(c5c6Count).toBeGreaterThanOrEqual(1);
    expect(c5c6Count).toBeLessThanOrEqual(3);
  });

  it("all impression items are present", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const report = {
      patientName: "TEST PATIENT ETA",
      age: "65 Y",
      sex: "F",
      uhid: "TEST007",
      accessionNumber: "ACC007",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal brain.",
      impression: `1. Mild small-vessel changes.
2. No acute abnormality.`,
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    const allText = getAllText({ doc, drawnTexts });
    
    expect(allText).toContain("Mild small-vessel changes");
    expect(allText).toContain("No acute abnormality");
  });

  it("multiple page breaks work correctly", () => {
    const { doc, drawnTexts } = createInstrumentedPdf({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });

    const longFindings = Array(20)
      .fill(null)
      .map((_, i) => `L${i + 1}-L${i + 2}: Disc bulge.`)
      .join("\n\n");

    const report = {
      patientName: "TEST PATIENT THETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST008",
      accessionNumber: "ACC008",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI TOTAL SPINE",
      findings: longFindings,
      impression: "Multi-level disc disease.",
    };

    generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false, doc });
    
    // Should be 2+ pages
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    
    // Verify content is on multiple pages
    const page1Texts = getTextOnPage({ doc, drawnTexts }, 1);
    const page2Texts = getTextOnPage({ doc, drawnTexts }, 2);
    
    expect(page1Texts.length).toBeGreaterThan(0);
    expect(page2Texts.length).toBeGreaterThan(0);
  });
});
