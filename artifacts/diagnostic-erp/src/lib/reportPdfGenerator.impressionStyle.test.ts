/**
 * The reporting workspace has an "impression style" control (bulleted /
 * numbered / plain) that is persisted through the preferences API and honoured
 * by the HTML preview and the print document. The jsPDF generator ignored it
 * and always numbered, so the downloaded PDF renumbered an impression the
 * radiologist had asked to see bulleted.
 */
import { describe, it, expect } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { createInstrumentedPdf, type InstrumentedDoc } from "./testSupport/instrumentedPdf";

const clinic = { name: "TEST DIAGNOSTICS", address: "TEST ADDRESS", phone: "TEST PHONE", email: "t@e.com" };

const IMPRESSION = "1. L4-L5 diffuse disc bulge.\n2. L5-S1 posterior disc protrusion.";

function render(style?: "bulleted" | "numbered" | "plain"): InstrumentedDoc {
  const inst = createInstrumentedPdf({ unit: "mm", format: "a4", orientation: "portrait" });
  generateReportPDF(
    {
      patientName: "TEST PATIENT",
      age: "50 Y",
      sex: "M",
      uhid: "T1",
      accessionNumber: "ACC-T1",
      studyDate: "20261016",
      referringDoctor: "Dr Referrer",
      reportTitle: "MRI LUMBAR SPINE",
      findings: "L4-L5: Disc bulge.",
      impression: IMPRESSION,
    },
    style === undefined
      ? DEFAULT_PRINT_SETTINGS
      : { ...DEFAULT_PRINT_SETTINGS, impressionStyle: style },
    clinic,
    { save: false, doc: inst.doc },
  );
  return inst;
}

const markers = (r: InstrumentedDoc) =>
  r.drawnTexts.map((t) => t.text).filter((s) => /^(\d+\.\s|•\s|•$)/.test(s));

describe("impression style reaches the PDF generator", () => {
  it("numbers when the style is numbered", () => {
    const m = markers(render("numbered"));
    expect(m.filter((s) => s.startsWith("1."))).toHaveLength(1);
    expect(m.filter((s) => s.startsWith("2."))).toHaveLength(1);
    expect(m.filter((s) => s.startsWith("•"))).toHaveLength(0);
  });

  it("bullets when the style is bulleted, and does not number", () => {
    const r = render("bulleted");
    const m = markers(r);
    expect(m.filter((s) => s.startsWith("•")).length).toBeGreaterThanOrEqual(2);
    expect(m.filter((s) => /^\d+\./.test(s))).toHaveLength(0);
  });

  it("draws neither marker when the style is plain", () => {
    expect(markers(render("plain"))).toHaveLength(0);
  });

  it("keeps every clinical item and its order in all three styles", () => {
    for (const style of ["numbered", "bulleted", "plain"] as const) {
      const r = render(style);
      // In `plain` both items share one drawn paragraph, so compare positions in
      // the rendered stream rather than expecting two separate draws.
      const stream = r.drawnTexts
        .filter((t) => t.text.includes("L4-L5 diffuse disc bulge") || t.text.includes("L5-S1 posterior disc protrusion"))
        .map((t) => t.text)
        .join(" | ");
      const i = stream.indexOf("L4-L5 diffuse disc bulge");
      const j = stream.indexOf("L5-S1 posterior disc protrusion");
      expect(i, `item 1 missing in ${style}`).toBeGreaterThanOrEqual(0);
      expect(j, `item 2 missing in ${style}`).toBeGreaterThanOrEqual(0);
      expect(j > i, `order reversed in ${style}: ${stream}`).toBe(true);
      const pages = new Set(
        r.drawnTexts
          .filter((t) => t.text.includes("disc bulge") || t.text.includes("disc protrusion"))
          .map((t) => t.page),
      );
      expect(pages.size, `impression split across pages in ${style}`).toBe(1);
    }
  });

  it("defaults to numbered when a caller passes no style", () => {
    const m = markers(render());
    expect(m.filter((s) => s.startsWith("1."))).toHaveLength(1);
    expect(m.filter((s) => s.startsWith("2."))).toHaveLength(1);
  });
});
