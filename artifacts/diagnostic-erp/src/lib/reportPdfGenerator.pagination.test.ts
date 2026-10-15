/**
 * PDF pagination regression tests.
 *
 * The renderer is instrumented (see ./testSupport/instrumentedPdf), so every
 * `doc.text` call is recorded with the page it landed on and its mm
 * coordinates. Assertions are made against those recorded positions — what the
 * printer actually does — rather than against a parse of the PDF bytes.
 *
 * The reserved-region check classifies every draw below the body boundary as
 * chrome or clinical, instead of looking for a few hand-picked phrases. Prose
 * is drawn word-by-word, so a phrase like "Normal lumbar" never appears in a
 * single draw and a phrase-matching test passes no matter where the text lands.
 * Tokens survive that; phrases do not.
 */
import { describe, it, expect } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { DEFAULT_CARE_LETTERPAD } from "./careLetterpadChrome";
import {
  createInstrumentedPdf,
  getAllText,
  getTextOnPage,
  type DrawnText,
  type InstrumentedDoc,
} from "./testSupport/instrumentedPdf";

const clinic = {
  name: "TEST DIAGNOSTICS",
  address: "TEST ADDRESS",
  phone: "TEST PHONE",
  email: "test@example.com",
};

type Report = Parameters<typeof generateReportPDF>[0];

const PAGE_HEIGHT_MM: Record<string, number> = { A4: 297, Letter: 279, A5: 210 };

/**
 * Bottom of the region clinical text may occupy, derived from the same settings
 * the generator lays out with: the footer stack plus the signature reserve.
 */
function contentBottomFor(settings: typeof DEFAULT_PRINT_SETTINGS): number {
  const pageH = PAGE_HEIGHT_MM[settings.paperSize] ?? 297;
  const signatureReserve = settings.signature.enabled ? 12 : 0;
  const footerStack = 14;
  return pageH - footerStack - signatureReserve;
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

/** Section captions and the letter pad's own words — never clinical content. */
const SECTION_LABELS = [
  "FINDINGS", "IMPRESSION", "CLINICAL HISTORY", "HISTORY", "TECHNIQUE",
  "COMPARISON", "MEASUREMENTS", "RECOMMENDATION", "KEY IMAGES", "NAME",
  "AGE", "SEX", "REFD", "DATE", "UHID", "ACCESSION", "REPORT", "PAGE",
].join(" ");

/**
 * Every word the letter pad, header, footer, signature block and patient box
 * draw for their own purposes. Subtracting it from the report's clinical words
 * leaves only tokens that can prove a clinical line was placed somewhere.
 */
function chromeTokens(): Set<string> {
  const s = DEFAULT_PRINT_SETTINGS;
  const chrome = [
    s.header.title,
    s.footer.servicesBar,
    s.footer.disclaimer,
    s.signature.name,
    s.signature.qualification,
    s.signature.registrationNo,
    s.watermark,
    DEFAULT_CARE_LETTERPAD.servicesRow1,
    DEFAULT_CARE_LETTERPAD.servicesRow2,
    DEFAULT_CARE_LETTERPAD.disclaimer,
    DEFAULT_CARE_LETTERPAD.credentials,
    SECTION_LABELS,
    clinic.name, clinic.address, clinic.phone, clinic.email,
  ].join(" ");
  return new Set(tokensOf(chrome));
}

/** Words taken from the report's clinical fields only. */
function clinicalTokensOf(report: Report): Set<string> {
  const parts = [
    report.findings,
    report.impression,
    report.clinicalHistory,
    report.technique,
    report.comparison,
    report.recommendation,
    ...(report.measurements ?? []).flatMap((m) => [m.label, m.value]),
  ];
  const words = new Set(tokensOf(parts.map((p) => String(p ?? "")).join(" ")));
  for (const chrome of chromeTokens()) words.delete(chrome);
  return words;
}

interface RenderResult extends InstrumentedDoc {
  pageCount: number;
  contentBottom: number;
  clinical: Set<string>;
  /** Clinical words that were actually placed on some page. */
  renderedClinical: string[];
}

function render(report: Report): RenderResult {
  const instrumented = createInstrumentedPdf({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
  });
  generateReportPDF(report, DEFAULT_PRINT_SETTINGS, clinic, {
    save: false,
    doc: instrumented.doc,
  });

  const clinical = clinicalTokensOf(report);
  const placed = new Set(instrumented.drawnTexts.flatMap((t) => tokensOf(t.text)));
  return {
    ...instrumented,
    pageCount: instrumented.doc.getNumberOfPages(),
    contentBottom: contentBottomFor(DEFAULT_PRINT_SETTINGS),
    clinical,
    renderedClinical: [...clinical].filter((w) => placed.has(w)),
  };
}

/**
 * No clinical word may be drawn inside the reserved signature/footer band, on
 * any page. Guarded against passing vacuously: it first proves the clinical
 * words really were drawn, so the scan below the boundary had something to find.
 */
function expectClinicalTextAboveReservedRegion(result: RenderResult): void {
  expect(result.clinical.size).toBeGreaterThan(8);
  expect(result.renderedClinical.length).toBeGreaterThan(result.clinical.size * 0.8);

  const violations = result.drawnTexts
    .filter((t) => t.y > result.contentBottom)
    .filter((t) => tokensOf(t.text).some((w) => result.clinical.has(w)))
    .map((t) => `page ${t.page} y=${t.y.toFixed(1)}mm "${t.text.trim()}"`);

  expect(violations).toEqual([]);
}

describe("PDF pagination — reserved signature and footer region", () => {
  it("keeps every clinical word out of the footer band (CASE-2A regression)", () => {
    expectClinicalTextAboveReservedRegion(render({
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
    }));
  });

  it("keeps every clinical word out of the footer band (CASE-2B regression)", () => {
    expectClinicalTextAboveReservedRegion(render({
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
      measurements: [{ label: "L5-S1 Canal AP", value: "8 mm" }],
      impression: "L5-S1 large disc herniation with severe canal stenosis.",
    }));
  });

  it("keeps a long report out of the footer band on every page it spills onto", () => {
    const result = render(longSpineReport());

    expect(result.pageCount).toBeGreaterThanOrEqual(2);
    expectClinicalTextAboveReservedRegion(result);

    // Nothing at all may be drawn off the physical page.
    const offPage = result.drawnTexts
      .filter((t) => t.y > PAGE_HEIGHT_MM.A4 - 2 || t.y < 0)
      .map((t) => `page ${t.page} y=${t.y.toFixed(1)}mm "${t.text.trim()}"`);
    expect(offPage).toEqual([]);
  });
});

describe("PDF pagination — content preservation", () => {
  it("draws every findings phrase, and the measurement table only once", () => {
    const result = render({
      patientName: "TEST PATIENT DELTA",
      age: "55 Y",
      sex: "M",
      uhid: "TEST004",
      accessionNumber: "ACC004",
      studyDate: "20261016",
      referringDoctor: "Dr. Test Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: `Alignment:
Normal lumbar lordosis.

Vertebral Bodies:
Normal marrow signal throughout.

Disc Levels:
L3-L4: Normal disc height.
L4-L5: Mild disc desiccation.
L5-S1: Disc herniation with canal stenosis.`,
      measurements: [{ label: "L5-S1 Canal AP", value: "11 mm" }],
      impression: "L5-S1 disc herniation.",
    });

    const allText = getAllText(result);
    for (const phrase of [
      "Normal lumbar lordosis",
      "Normal marrow signal throughout",
      "Mild disc desiccation",
      "Disc herniation with canal stenosis",
    ]) {
      expect(allText, `missing findings phrase "${phrase}"`).toContain(phrase);
    }

    // jspdf-autotable draws each cell through doc.text, so a table rendered
    // twice shows up here as a second copy of its own header and value.
    expect(result.drawnTexts.filter((t) => t.text.includes("Canal AP"))).toHaveLength(1);
    expect(result.drawnTexts.filter((t) => t.text.includes("11 mm"))).toHaveLength(1);
  });

  it("draws every numbered impression item", () => {
    const result = render({
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
    });

    const allText = getAllText(result);
    expect(allText).toContain("Mild small-vessel changes");
    expect(allText).toContain("No acute abnormality");
  });
});

describe("PDF pagination — headings and page breaks", () => {
  it("keeps an anatomical heading on the same page as its first finding", () => {
    const result = render({
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
    });

    // parseFindingsDocument strips a heading's trailing colon before drawing it.
    const heading = result.drawnTexts.find((t) => t.text.trim() === "Alignment");
    expect(heading, 'heading "Alignment" was never drawn').toBeDefined();

    const finding = result.drawnTexts.find((t) => tokensOf(t.text).includes("lordosis"));
    expect(finding, "the heading's first finding was never drawn").toBeDefined();

    expect(heading!.page).toBe(finding!.page);
    expect(finding!.y).toBeGreaterThan(heading!.y);
    // Orphan control: the finding follows its heading, it is not a page later.
    expect(finding!.y - heading!.y).toBeLessThan(20);
  });

  it("resumes at the top of the page after a break instead of at a stale y", () => {
    const report = longSpineReport();
    const result = render(report);
    expect(result.pageCount).toBeGreaterThanOrEqual(2);

    const isClinical = (t: DrawnText) => tokensOf(t.text).some((w) => result.clinical.has(w));

    for (let page = 2; page <= result.pageCount; page++) {
      const onPage = getTextOnPage(result, page).filter(isClinical);
      expect(onPage.length, `page ${page} carries no clinical text`).toBeGreaterThan(0);

      const top = Math.min(...onPage.map((t) => t.y));
      // A cursor the page break failed to reset would keep drawing near the
      // bottom of the new page, so content must restart in the upper half.
      expect(top, `page ${page} restarts at y=${top.toFixed(1)}mm`).toBeLessThan(PAGE_HEIGHT_MM.A4 / 2);

      const bottom = Math.max(...onPage.map((t) => t.y));
      expect(bottom, `page ${page} runs to y=${bottom.toFixed(1)}mm`).toBeLessThanOrEqual(result.contentBottom);
    }
  });
});

/** A report long enough to spill across several pages — one line per level. */
function longSpineReport(): Report {
  const levels = Array.from(
    { length: 100 },
    (_, i) => `L${i + 1}-L${i + 2}: Disc bulge with mild canal narrowing.`,
  );
  return {
    patientName: "TEST PATIENT THETA",
    age: "50 Y",
    sex: "M",
    uhid: "TEST008",
    accessionNumber: "ACC008",
    studyDate: "20261016",
    referringDoctor: "Dr. Test Referrer",
    reportTitle: "MRI TOTAL SPINE",
    clinicalHistory: "Chronic axial back pain radiating to both lower limbs.",
    technique: "Multiplanar multisequence MRI of the whole spine without contrast.",
    findings: `Alignment:
Loss of normal lumbar lordosis.

Disc Levels:
${levels.join("\n")}`,
    impression: "Multi-level disc disease with mild canal narrowing.",
  };
}
