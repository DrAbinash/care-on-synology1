/**
 * The letter-pad PDF now carries the owner's mandatory closing statement — drawn where
 * the server's print document draws it, after every report section and before the
 * signature, so the paper reads it as the document's own sentence and not as advice the
 * radiologist authored.
 *
 * `reportPdfGenerator` also prints echo, fetal, Doppler, lab and legacy documents. The
 * generator prints only what the caller hands it, so a non-radiology document is
 * byte-for-byte what it was before this existed — that is the second case here, and it
 * is the reason the decision lives in `radiologyReportPdfExport.ts` rather than here.
 *
 * Driven through the instrumented renderer (`testSupport/instrumentedPdf`), the same
 * seam `draftPrintSafety.test.ts` uses: it records what was actually drawn, so a field
 * that reached `ReportData` but never reached the page cannot pass.
 */
import { describe, expect, it } from "vitest";
import { RADIOLOGY_CLOSING_STATEMENT } from "@workspace/report-quality";
import { DEFAULT_PRINT_SETTINGS, generateReportPDF, type PrintSettings } from "./reportPdfGenerator";
import { createInstrumentedPdf, getAllText } from "./testSupport/instrumentedPdf";

const SETTINGS: PrintSettings = {
  ...DEFAULT_PRINT_SETTINGS,
  signature: { ...DEFAULT_PRINT_SETTINGS.signature, name: "Dr Synthetic Radiologist" },
};

function render(over: Record<string, unknown>) {
  const inst = createInstrumentedPdf({ unit: "mm", format: "a4", orientation: "portrait" });
  generateReportPDF(
    {
      patientName: "SYNTHETIC PATIENT",
      age: "41 Y",
      sex: "M",
      accessionNumber: "SYN-CLS-0001",
      studyDate: "20261027",
      referringDoctor: "Dr Referring",
      modality: "MRI",
      reportTitle: "MRI LUMBOSACRAL SPINE",
      findings: "Normal lumbar MRI. No disc herniation.",
      impression: "Normal MRI of the lumbar spine.",
      recommendation: "Repeat MRI in six weeks if symptoms persist.",
      ...over,
    },
    SETTINGS,
    null,
    { save: false, doc: inst.doc },
  );
  return { text: getAllText(inst), drawn: inst.drawnTexts.map((t) => String(t.text).trim()) };
}

const count = (hay: string) => hay.split(RADIOLOGY_CLOSING_STATEMENT).length - 1;

describe("the closing statement on the letter-pad PDF", () => {
  it("draws it once, after the radiologist's own recommendation and before the signature", () => {
    const { text } = render({ closingStatement: RADIOLOGY_CLOSING_STATEMENT });
    expect(count(text)).toBe(1);
    // Position is the claim, not just presence: it must not read as his advice.
    const atRecommendation = text.indexOf("RECOMMENDATION:");
    const atAdvice = text.indexOf("Repeat MRI in six weeks if symptoms persist.");
    const atStatement = text.indexOf(RADIOLOGY_CLOSING_STATEMENT);
    const atSignature = text.indexOf("Dr Synthetic Radiologist");
    expect(atRecommendation).toBeGreaterThan(-1);
    expect(atAdvice).toBeGreaterThan(atRecommendation);
    expect(atStatement).toBeGreaterThan(atAdvice);
    expect(atSignature).toBeGreaterThan(atStatement);
  });

  it("draws nothing when the caller is not the radiology door", () => {
    // The LAB / echo / fetal / Doppler documents call this generator directly and pass
    // no statement, exactly as `draftPrintSafety.test.ts` requires of the lab export.
    const { text } = render({ modality: "LAB", reportTitle: "Diagnostic Laboratory Report" });
    expect(text).not.toContain(RADIOLOGY_CLOSING_STATEMENT);
  });

  it("does not duplicate a report whose recommendation already says it", () => {
    // The door sends an empty statement in that case (see E6); the generator trusts its
    // caller, so the pair cannot print the sentence twice even if a body carries it.
    const { text } = render({
      recommendation: RADIOLOGY_CLOSING_STATEMENT,
      closingStatement: "",
    });
    expect(count(text)).toBe(1);
  });
});
