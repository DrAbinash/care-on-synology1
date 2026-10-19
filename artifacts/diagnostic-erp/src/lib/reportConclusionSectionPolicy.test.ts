/**
 * The approved reporting highway has NO Conclusion section:
 *
 *   DEMOGRAPHY → EXAMINATION → TECHNIQUE → FINDINGS → IMPRESSION →
 *   RECOMMENDATIONS → SAVE / PREVIEW / PRINT / FINALIZE
 *
 * (Owner directive, 2026-10-19: "Remove Conclusion from default flow." The
 * investigation that preceded this test found the flow already compliant — the
 * composer has five fields and no conclusion field, the client PDF and the
 * print document draw `IMPRESSION:`, and legacy reports whose stored body
 * carries a `CONCLUSION:` heading are read back with that section mapped INTO
 * the impression, so historical clinical content is preserved, not deleted.
 * The one residual user-visible "Conclusion" was the Impression editor's
 * placeholder text, fixed with this change.)
 *
 * These tests pin that state so a Conclusion section cannot reappear silently:
 * the printed/PDF report never carries a CONCLUSION heading, and a legacy
 * stored body that has one still reads back with its content intact — the
 * two halves of the owner's requirement, new reports and old.
 */
import { describe, expect, it } from "vitest";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { createInstrumentedPdf } from "./testSupport/instrumentedPdf";
import { parseStoredReportBody } from "./storedReportBody";

const clinic = { name: "TEST DIAGNOSTICS", address: "TEST ADDRESS", phone: "TEST PHONE", email: "t@e.com" };

function renderPdf(): string[] {
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
      impression: "L4-L5 diffuse disc bulge.",
      recommendation: "Clinical correlation.",
    },
    DEFAULT_PRINT_SETTINGS,
    clinic,
    { save: false, doc: inst.doc },
  );
  return inst.drawnTexts.map((t) => t.text.trim().toUpperCase());
}

describe("no Conclusion section in the reporting flow (owner directive 2026-10-19)", () => {
  it("prints IMPRESSION: and never a CONCLUSION heading", () => {
    const headings = renderPdf();
    expect(headings.some((t) => t === "IMPRESSION:")).toBe(true);
    expect(
      headings.filter((t) => t.includes("CONCLUSION")),
      `a CONCLUSION heading reached the printed report: ${headings.filter((t) => t.includes("CONCLUSION")).join(" | ")}`,
    ).toEqual([]);
  });

  it("preserves a legacy stored body whose CONCLUSION section predates the removal", () => {
    // A report signed before this policy carried a "CONCLUSION:" heading. The
    // stored row is trusted clinical content: it must read back complete, with
    // that section's text living in the impression where it always belonged,
    // and nothing dropped or renamed on disk.
    const legacy = `<div class="section-heading">FINDINGS:</div>`
      + `<p>L4-L5 diffuse disc bulge with mild thecal sac indentation.</p>`
      + `<div class="section-heading">CONCLUSION:</div>`
      + `<p>L4-L5 diffuse disc bulge.</p>`;
    const sections = parseStoredReportBody(legacy);
    expect(sections.findings).toContain("L4-L5 diffuse disc bulge with mild thecal sac indentation");
    expect(sections.impression).toBe("L4-L5 diffuse disc bulge.");
    // The full text keeps the impression's words exactly once — no duplication,
    // no loss — and the findings sentence beside them, unchanged.
    expect(sections.fullText).toContain("L4-L5 diffuse disc bulge with mild thecal sac indentation");
    expect(sections.fullText.match(/L4-L5 diffuse disc bulge\./g)?.length).toBe(1);
  });
});
