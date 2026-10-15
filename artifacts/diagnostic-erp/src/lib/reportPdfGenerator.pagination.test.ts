/**
 * PDF Pagination Regression Tests — Coordinate-Level Verification
 * 
 * These tests verify actual PDF properties with coordinate-level precision:
 * - Text doesn't overlap footer/signature regions
 * - All clinical content is preserved
 * - Page breaks occur at correct positions
 * - No content duplication
 * 
 * Uses custom PDF text extractor that parses jsPDF content streams.
 */
import { describe, it, expect } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { extractTextFromJsPDF, extractAllText, getTextOnPage } from "./testSupport/pdfTextExtractor";

const clinic = {
  name: "TEST DIAGNOSTICS",
  address: "TEST ADDRESS",
  phone: "TEST PHONE",
  email: "test@example.com",
};

describe("PDF pagination — coordinate-level verification", () => {
  it("no findings text overlaps footer region", () => {
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
L5-S1: Disc herniation.`,
      impression: "L5-S1 disc herniation.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const textItems = extractTextFromJsPDF(doc);
    
    // Footer is typically in the bottom 14mm (FOOTER_STACK_MM)
    // Page height for A4 is 297mm, so footer starts at ~283mm
    // In jsPDF units, this is approximately y < 14 (from bottom)
    // But jsPDF uses top-left origin, so footer is at high y values
    // For A4: pageH = 297, footer at y > 283
    
    // Check that clinical findings don't appear in footer region
    const footerRegionY = 280; // Conservative threshold
    const findingsInFooter = textItems.filter(item => 
      item.y > footerRegionY && 
      (item.text.includes("Normal lumbar") || 
       item.text.includes("Disc herniation") ||
       item.text.includes("L5-S1"))
    );
    
    expect(findingsInFooter).toHaveLength(0);
  });

  it("all findings text is present in PDF", () => {
    const findings = `Alignment:
Normal lumbar lordosis.

Vertebral Bodies:
Normal marrow signal throughout.

Disc Levels:
L3-L4: Normal disc height.
L4-L5: Mild disc desiccation.
L5-S1: Disc herniation with canal stenosis.`;

    const report = {
      patientName: "TEST PATIENT BETA",
      age: "65 Y",
      sex: "F",
      uhid: "TEST002",
      accessionNumber: "ACC002",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings,
      impression: "L5-S1 disc herniation.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const allText = extractAllText(doc);
    
    // Verify all key findings are present
    expect(allText).toContain("Normal lumbar lordosis");
    expect(allText).toContain("Normal marrow signal");
    expect(allText).toContain("L3-L4");
    expect(allText).toContain("L4-L5");
    expect(allText).toContain("L5-S1");
    expect(allText).toContain("Disc herniation");
    expect(allText).toContain("canal stenosis");
  });

  it("all impression items are present and numbered", () => {
    const report = {
      patientName: "TEST PATIENT GAMMA",
      age: "45 Y",
      sex: "M",
      uhid: "TEST003",
      accessionNumber: "ACC003",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal brain parenchyma.",
      impression: `1. Mild chronic small-vessel ischemic changes.
2. Generalized cerebral volume loss.
3. No acute intracranial abnormality.`,
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const allText = extractAllText(doc);
    
    // Verify all impression items
    expect(allText).toContain("Mild chronic small-vessel ischemic changes");
    expect(allText).toContain("Generalized cerebral volume loss");
    expect(allText).toContain("No acute intracranial abnormality");
    
    // Verify numbering
    expect(allText).toMatch(/1\./);
    expect(allText).toMatch(/2\./);
    expect(allText).toMatch(/3\./);
  });

  it("measurements survive pagination without duplication", () => {
    const report = {
      patientName: "TEST PATIENT DELTA",
      age: "55 Y",
      sex: "M",
      uhid: "TEST004",
      accessionNumber: "ACC004",
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
    const allText = extractAllText(doc);
    
    // Verify all measurement values present
    expect(allText).toContain("14 mm");
    expect(allText).toContain("13 mm");
    expect(allText).toContain("11 mm");
    expect(allText).toContain("12 mm");
    
    // Verify all levels mentioned
    expect(allText).toContain("C3-C4");
    expect(allText).toContain("C4-C5");
    expect(allText).toContain("C5-C6");
    expect(allText).toContain("C6-C7");
    
    // Check for excessive duplication (each should appear 1-3 times max)
    const c5c6Count = (allText.match(/C5-C6/g) || []).length;
    expect(c5c6Count).toBeGreaterThanOrEqual(1);
    expect(c5c6Count).toBeLessThanOrEqual(4);
  });

  it("anatomical headings remain with their content", () => {
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
Normal marrow signal.

Disc Levels:
L4-L5: Disc bulge.`,
      impression: "L4-L5 disc bulge.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const textItems = extractTextFromJsPDF(doc);
    
    // Find "Alignment:" heading
    const alignmentHeading = textItems.find(item => item.text.includes("Alignment:"));
    expect(alignmentHeading).toBeDefined();
    
    // Find "Normal lumbar lordosis" content
    const alignmentContent = textItems.find(item => item.text.includes("Normal lumbar lordosis"));
    expect(alignmentContent).toBeDefined();
    
    // They should be on the same page and close in y coordinate
    if (alignmentHeading && alignmentContent) {
      expect(alignmentHeading.page).toBe(alignmentContent.page);
      // Content should be below heading (higher y in top-left origin)
      expect(alignmentContent.y).toBeGreaterThan(alignmentHeading.y);
    }
  });

  it("multiple page breaks work correctly", () => {
    // Create a report that will definitely span 3+ pages
    const longFindings = Array(25)
      .fill(null)
      .map((_, i) => `L${i + 1}-L${i + 2}: Disc bulge with mild canal stenosis. Normal marrow signal throughout.`)
      .join("\n\n");

    const report = {
      patientName: "TEST PATIENT ZETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST006",
      accessionNumber: "ACC006",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI TOTAL SPINE",
      findings: longFindings,
      impression: "Multi-level disc disease.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    
    // Should be 3+ pages
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
    
    // Verify content is present on multiple pages
    const page1Text = getTextOnPage(doc, 1);
    const page2Text = getTextOnPage(doc, 2);
    const page3Text = getTextOnPage(doc, 3);
    
    expect(page1Text).toContain("Disc bulge");
    expect(page2Text).toContain("Disc bulge");
    expect(page3Text).toContain("Disc bulge");
  });

  it("continuation pages respect margins", () => {
    const report = {
      patientName: "TEST PATIENT ETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST007",
      accessionNumber: "ACC007",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: Array(15).fill("L4-L5: Disc bulge with canal stenosis.").join("\n\n"),
      impression: "L4-L5 disc bulge.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const textItems = extractTextFromJsPDF(doc);
    
    // Check page 2 text items
    const page2Items = textItems.filter(item => item.page === 2);
    
    if (page2Items.length > 0) {
      // All text on page 2 should be within margins
      // Left margin is typically ~10mm, top margin ~10mm
      const leftMargin = 8; // Conservative
      const topMargin = 8;
      
      const violations = page2Items.filter(item => 
        item.x < leftMargin || item.y < topMargin
      );
      
      expect(violations).toHaveLength(0);
    }
  });

  it("no clinical text is duplicated", () => {
    const report = {
      patientName: "TEST PATIENT THETA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST008",
      accessionNumber: "ACC008",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal brain parenchyma. No mass lesion.",
      impression: "Normal MRI brain.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const allText = extractAllText(doc);
    
    // Count occurrences of key phrases
    const normalBrainCount = (allText.match(/Normal brain parenchyma/g) || []).length;
    const massLesionCount = (allText.match(/No mass lesion/g) || []).length;
    
    // Each should appear exactly once (not duplicated)
    expect(normalBrainCount).toBe(1);
    expect(massLesionCount).toBe(1);
  });
});

describe("PDF pagination — signature and footer protection", () => {
  it("signature is visible when enabled", () => {
    const report = {
      patientName: "TEST PATIENT IOTA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST009",
      accessionNumber: "ACC009",
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
    const allText = extractAllText(doc);
    
    // Verify doctor name is present
    expect(allText).toContain("Dr. Test Radiologist");
    expect(allText).toContain("MD");
  });

  it("patient demographics are preserved", () => {
    const report = {
      patientName: "TEST PATIENT KAPPA",
      age: "50 Y",
      sex: "M",
      uhid: "TEST010",
      accessionNumber: "ACC010",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI BRAIN",
      findings: "Normal study.",
      impression: "Normal.",
    };

    const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, { save: false });
    const allText = extractAllText(doc);
    
    // Verify patient demographics
    expect(allText).toContain("TEST PATIENT KAPPA");
    expect(allText).toContain("TEST010");
    expect(allText).toContain("ACC010");
    expect(allText).toContain("50 Y");
  });
});
