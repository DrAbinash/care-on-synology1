import { describe, expect, it } from "vitest";
import { unfilledPlaceholders } from "@workspace/report-quality";
import { buildLivePrintBodyHtml, type LivePrintBodyInput } from "./radiologyReportPrintLiveMerge";
import { TECHNIQUE_NOT_RECORDED_TEXT, techniqueSectionText } from "./radiologyReportPreviewHtml";
import { parseReportHtmlToBlocks } from "./radiologyReportWordExport";
import { DEFAULT_PRINT_SETTINGS, generateReportPDF } from "./reportPdfGenerator";

/**
 * The audit item: "A blank Technique removes the section from the document
 * entirely." `radiologyReportPrintLiveMerge.ts` and `reportPdfGenerator.ts` each
 * tested `technique?.trim()` before emitting the heading and its paragraph, so an
 * MRI could be printed, exported and signed with no statement of what was acquired.
 * The recorded text stays verbatim; the absence is now named, on every surface.
 */

const RECORDED = "MRI dorsal spine on 3T. Sagittal T1W, T2W; axial T1W, T2W.";

function bodyInput(over: Partial<LivePrintBodyInput> = {}): LivePrintBodyInput {
  return {
    clinicalHistory: "Back pain.",
    technique: "",
    rawFindings: "Normal study.",
    findingsMap: {},
    useStructured: false,
    impression: [],
    recommendation: "",
    ...over,
  };
}

function printBody(over: Partial<LivePrintBodyInput> = {}): string {
  return buildLivePrintBodyHtml(bodyInput(over));
}

/** The PDF's own text operators — no pdftotext binary needed, same reader the
 *  letter-pad suite uses, so this asserts what the document actually contains. */
function pdfText(report: Parameters<typeof generateReportPDF>[0]): string {
  const doc = generateReportPDF(report, DEFAULT_PRINT_SETTINGS, null, { save: false });
  const pdf = Buffer.from(doc.output("arraybuffer")).toString("latin1");
  return [...pdf.matchAll(/\(((?:[^()]|\([^)]*\))*)\)\s*Tj/g)].map((m) => m[1]).join(" | ");
}

describe("a blank Technique is named on every document surface, never omitted", () => {
  it("prints the section with the named absence when nothing was recorded", () => {
    const html = printBody();
    expect(html).toMatch(/TECHNIQUE/);
    expect(html).toContain(`${TECHNIQUE_NOT_RECORDED_TEXT}.`);
  });

  it("prints the recorded technique verbatim and says nothing about an absence", () => {
    const html = printBody({ technique: RECORDED });
    expect(html).toContain(RECORDED);
    expect(html).not.toContain(TECHNIQUE_NOT_RECORDED_TEXT);
  });

  it("keeps the section in the DOCX, which is built from this same HTML", () => {
    const blocks = parseReportHtmlToBlocks(printBody());
    const text = blocks.map((b) => ("text" in b ? String(b.text ?? "") : JSON.stringify(b))).join(" ");
    expect(text).toContain(TECHNIQUE_NOT_RECORDED_TEXT);
  });

  it("draws TECHNIQUE in the PDF even with an empty field", () => {
    const drawn = pdfText({
      patientName: "CARE QA PATIENT", age: "40 Y", sex: "M", studyDate: "20261107",
      findings: "Normal study.", impression: "Normal study.",
      reportTitle: "MRI DORSAL SPINE", technique: "",
    });
    expect(drawn).toMatch(/TECHNIQUE/);
    expect(drawn).toContain(TECHNIQUE_NOT_RECORDED_TEXT);
  });

  it("names the absence without creating one of the placeholder dialects the sign door reads", () => {
    // A floor sentence that tripped the unresolved-placeholder rule would replace a
    // silent omission with a report that cannot be signed, so this is the constraint
    // that keeps the fix safe: the text must be clean prose.
    for (const text of [techniqueSectionText(""), techniqueSectionText("  ")]) {
      expect(unfilledPlaceholders(text)).toEqual([]);
    }
  });

  it("is one shared sentence, so print and PDF cannot drift", () => {
    expect(techniqueSectionText("  3T protocol  ")).toBe("3T protocol");
    expect(techniqueSectionText(null)).toBe(`${TECHNIQUE_NOT_RECORDED_TEXT}.`);
  });
});
