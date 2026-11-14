/**
 * The reporting workspace has an "impression style" control (bulleted /
 * numbered / plain) that is persisted through the preferences API and honoured
 * by the HTML preview and the print document. The jsPDF generator ignored it
 * and always numbered, so the downloaded PDF renumbered an impression the
 * radiologist had asked to see bulleted.
 */
import { describe, it, expect } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { buildLivePrintBodyHtml } from "./radiologyReportPrintLiveMerge";
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

/**
 * The impression is authored as free text in a textarea, so the radiologist's own
 * markers ride with it: `1. …`, `- …`, `• …`, `* …`, and blank lines between
 * points. Every surface that draws the impression must therefore strip the typed
 * marker ONCE before adding the document's own — otherwise the paper reads
 * "1. - Hepatic steatosis." while the page the report was approved on reads
 * "1. Hepatic steatosis.", and Word (which is converted from that page) agrees
 * with the page, not the paper.
 *
 * `normalizeImpressionBullet` is that rule and is applied by the print body and
 * the screen preview; the PDF generator had its own, narrower copy that stripped
 * only digits. These tests compare the two surfaces directly rather than
 * asserting each one's rule, so a fourth renderer added later cannot quietly
 * disagree again.
 */
const ITEM_1 = "Hepatic steatosis.";
const ITEM_2 = "Trace free fluid in the pouch of Douglas.";
const STEM_1 = "Hepatic steatosis";
const STEM_2 = "Trace free fluid";

function pdfImpressionText(impression: string, style: "bulleted" | "numbered" | "plain"): string {
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
      reportTitle: "USG ABDOMEN",
      findings: "Unrelated findings sentence.",
      impression,
    },
    { ...DEFAULT_PRINT_SETTINGS, impressionStyle: style },
    clinic,
    { save: false, doc: inst.doc },
  );
  // Draw order, markers left out — how the marker is drawn is the suite above.
  const items = inst.drawnTexts
    .map((t) => t.text)
    .filter((s) => s.includes(STEM_1) || s.includes(STEM_2));
  return style === "plain" ? items.join("") : items.join("\n");
}

function printImpressionText(impression: string, style: "bulleted" | "numbered" | "plain"): string {
  const body = buildLivePrintBodyHtml({
    clinicalHistory: "",
    technique: "",
    rawFindings: "Unrelated findings sentence.",
    findingsMap: {},
    useStructured: false,
    // The same split every caller of this builder performs on the textarea.
    impression: impression.split("\n").filter(Boolean),
    recommendation: "",
    impressionStyle: style,
    headingCase: "all_caps",
  });
  const section = body.slice(body.search(/<div class="section-heading">IMPRESSION<\/div>/i));
  if (style === "plain") {
    return (section.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? "").replace(/<br\/>/g, "\n");
  }
  return [...section.matchAll(/<li>([\s\S]*?)<\/li>/gi)]
    .map((m) => m[1].replace(/<br\/>/g, "\n"))
    .join("\n");
}

describe("one impression bullet rule across the PDF and the print page", () => {
  const STYLES = ["numbered", "bulleted", "plain"] as const;

  it("draws the same sentences for an impression that carries numeric markers (control)", () => {
    // Not the defect: the PDF already stripped `1.` / `2)`. This is the control
    // that makes the next three assertions mean a divergence rather than a
    // harness that simply never matches anything.
    const imp = `1. ${ITEM_1}\n2. ${ITEM_2}`;
    for (const style of STYLES) {
      const expected = style === "plain" ? [ITEM_1, ITEM_2].join("; ") : [ITEM_1, ITEM_2].join("\n");
      expect(pdfImpressionText(imp, style), `${style} pdf`).toBe(expected);
      expect(printImpressionText(imp, style), `${style} print`).toBe(expected);
    }
  });

  it.each(["-", "•", "*"] as const)("does not double the author's %s marker on the PDF", (marker) => {
    const imp = `${marker} ${ITEM_1}\n${marker} ${ITEM_2}`;
    for (const style of STYLES) {
      expect(pdfImpressionText(imp, style), `${style} pdf`).not.toBe("");
      expect(pdfImpressionText(imp, style), `${style} pdf`).toBe(printImpressionText(imp, style));
      expect(pdfImpressionText(imp, style), `${style} pdf`).not.toContain(`${marker} ${STEM_1}`);
    }
  });

  it("does not mistake a measurement for a list marker", () => {
    // An impression line that OPENS with a measurement is ordinary dictation
    // ("2.5 cm hepatomegaly…"). The rule every surface shares needs the marker
    // followed by whitespace, so `\d+[.)]\s+` leaves "2.5" alone. The PDF's own
    // copy used `\s*` and cut "2." off the front, printing "5 cm" — a number
    // that was never measured — while the page and Word kept 2.5 cm.
    const imp = `2.5 cm ${ITEM_1}\n3 x ${ITEM_2}`;
    const expectedItems = [`2.5 cm ${ITEM_1}`, `3 x ${ITEM_2}`];
    for (const style of STYLES) {
      const expected = style === "plain" ? expectedItems.join("; ") : expectedItems.join("\n");
      expect(pdfImpressionText(imp, style), `${style} pdf`).toBe(expected);
      expect(printImpressionText(imp, style), `${style} print`).toBe(expected);
    }
  });

  it("shows the same number of items when a blank line separates two points", () => {
    // The workspace's own line split keeps a whitespace-only line, and the
    // print body filtered for emptiness BEFORE normalizing it — so an
    // Enter-Enter between two points printed an empty numbered row ("2." with
    // nothing beside it, pushing the real second point to "3.") and a stray
    // "; ;" in plain style, while the PDF dropped it.
    const imp = `${ITEM_1}\n   \n${ITEM_2}`;
    for (const style of STYLES) {
      const print = printImpressionText(imp, style);
      expect(print, style).toBe(pdfImpressionText(imp, style));
      expect(print, `${style} must not carry an empty item`).not.toMatch(/^\s*$/m);
      expect(print).not.toContain("; ;");
      expect(print).toContain(ITEM_1);
      expect(print).toContain(ITEM_2);
    }
  });

  it("keeps both clinical sentences and their order whatever the author typed", () => {
    // The strip must never eat a point. Two items in, two items out, in order.
    for (const imp of [`- ${ITEM_1}\n• ${ITEM_2}`, `1. ${ITEM_1}\n* ${ITEM_2}`, `${ITEM_1}\n   \n${ITEM_2}`]) {
      for (const style of STYLES) {
        const pdf = pdfImpressionText(imp, style);
        const i = pdf.indexOf(STEM_1);
        const j = pdf.indexOf(STEM_2);
        expect(i, `item 1 lost: ${style} ${JSON.stringify(imp)}`).toBeGreaterThanOrEqual(0);
        expect(j, `item 2 lost: ${style} ${JSON.stringify(imp)}`).toBeGreaterThanOrEqual(0);
        expect(j > i, `order reversed: ${style} ${JSON.stringify(imp)}`).toBe(true);
      }
    }
  });
});
