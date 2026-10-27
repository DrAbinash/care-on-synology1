/**
 * PRIORITY 1 — the workspace's "Download PDF", which is jsPDF output drawn by
 * reportPdfGenerator.ts, not the server's print document. It carries the same
 * booked heading, so it needs the same statement about the region the report
 * documents; a note that appears on the paper but not on the PDF is two
 * surfaces describing one study differently, which is the defect class this
 * whole vertical has been closing.
 *
 * Assertions read the produced PDF's own text operators (`( … ) Tj`), the way
 * `reportPdfGenerator.keyImageCaptions.test.ts` does, so the contract is proven
 * on the file the product actually makes rather than on the code that made it.
 */
import { describe, expect, it } from "vitest";

import { reportedScopeNote } from "@workspace/report-quality";

import { DEFAULT_PRINT_SETTINGS, generateReportPDF, type ReportData } from "./reportPdfGenerator";

const BOOKED_TITLE = "MRI WHOLE SPINE";

const TRANSITIONED = [{
  fromRegion: "Whole Spine",
  toRegion: "Cervical Spine",
  decidedBy: "abinashsingh@gmail.com",
  at: "2026-10-13T09:40:00.000Z",
}];

function pdfBytes(report: Partial<ReportData> = {}): string {
  const doc = generateReportPDF(
    {
      patientName: "SYNTHETIC SPINECASE",
      age: "41 Y",
      sex: "M",
      studyDate: "20261013",
      referringDoctor: "Dr Referring",
      accessionNumber: "SYN-M1-ACC-0001",
      uhid: "SYN-M1-UHID-0001",
      modality: "MRI",
      bodyPart: BOOKED_TITLE,
      clinicalHistory: "Whole-spine MRI screening requested.",
      technique: "Multiplanar multisequence MRI of the cervical spine.",
      findings: "Cervical spine: Alignment is within normal limits.",
      impression: "Normal MRI cervical spine.",
      recommendation: "Clinical correlation.",
      reportTitle: BOOKED_TITLE,
      ...report,
    },
    { ...DEFAULT_PRINT_SETTINGS, show: { ...DEFAULT_PRINT_SETTINGS.show, keyImages: false } },
    null,
    { save: false },
  );
  return Buffer.from(doc.output("arraybuffer")).toString("latin1");
}

/** Every string the PDF drew, with its position; PDF origin is bottom-left. */
function drawn(pdf: string) {
  const items: Array<{ x: number; y: number; text: string }> = [];
  for (const block of pdf.split(/\bBT\b/).slice(1)) {
    const body = block.split(/\bET\b/)[0];
    for (const m of body.matchAll(/([\d.-]+) ([\d.-]+) Td\s*\(((?:[^()]|\([^)]*\))*)\) Tj/g)) {
      items.push({ x: Number(m[1]), y: Number(m[2]), text: m[3]! });
    }
  }
  return items;
}

const firstDrawnWith = (pdf: string, needle: string) =>
  drawn(pdf).find((item) => item.text.includes(needle));

describe("Download PDF — the documented reporting region under the booked heading", () => {
  it("D1 draws the note the shared rule produces, in the PDF's own text", () => {
    const note = reportedScopeNote({ bookedTitle: BOOKED_TITLE, records: TRANSITIONED })!;
    const pdf = pdfBytes({ reportingScopeNote: note });
    const items = drawn(pdf);
    const line = items.find((item) => item.text.startsWith("Documented reporting region"));
    expect(line, `note not drawn; text was: ${items.map((d) => d.text).join(" | ")}`).toBeTruthy();
    // jsPDF wraps the sentence across lines; rejoin the drawn fragments and the
    // whole sentence must be there, in order, with nothing invented.
    const joined = items.map((item) => item.text).join(" ").replace(/\s+/g, " ");
    expect(joined).toContain("Documented reporting region: Cervical Spine");
    expect(joined).toContain("Booked examination: MRI WHOLE SPINE.");
  });

  it("D2 it sits under the heading and above the body, never instead of either", () => {
    const note = reportedScopeNote({ bookedTitle: BOOKED_TITLE, records: TRANSITIONED })!;
    const pdf = pdfBytes({ reportingScopeNote: note });
    // The heading itself: drawn alone, not the examination name repeated in the
    // demography block.
    const title = drawn(pdf).find((item) => item.text === BOOKED_TITLE)!;
    const scope = firstDrawnWith(pdf, "Documented reporting region")!;
    const findings = firstDrawnWith(pdf, "FINDINGS")!;
    expect(findings, `no FINDINGS heading in: ${drawn(pdf).map((d) => d.text).join(" | ")}`).toBeTruthy();
    expect(title.y).toBeGreaterThan(scope.y);
    expect(scope.y).toBeGreaterThan(findings.y);
  });

  it("D3 a report with no recorded transition exports exactly what it did before", () => {
    const plain = pdfBytes();
    expect(plain).not.toContain("Documented reporting region");
    // Passing the null the rule returns for an untouched draft changes nothing.
    expect(reportedScopeNote({ bookedTitle: BOOKED_TITLE, records: [] })).toBeNull();
    const stillPlain = pdfBytes({ reportingScopeNote: reportedScopeNote({ bookedTitle: BOOKED_TITLE, records: [] }) ?? undefined });
    expect(stillPlain).not.toContain("Documented reporting region");
  });

  it("D4 the heading is untouched: the note is additive, never a rename", () => {
    const note = reportedScopeNote({ bookedTitle: BOOKED_TITLE, records: TRANSITIONED })!;
    const pdf = pdfBytes({ reportingScopeNote: note });
    // The heading is still the booked examination, drawn as its own line —
    // the note sits under it and never replaces or renames it.
    expect(drawn(pdf).some((item) => item.text === BOOKED_TITLE)).toBe(true);
    expect(firstDrawnWith(pdf, "Documented reporting region")).toBeTruthy();
  });
});
