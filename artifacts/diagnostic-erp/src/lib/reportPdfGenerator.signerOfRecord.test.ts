/**
 * PP-5B on the second PDF door — the workspace rail's "Download PDF", drawn by
 * `reportPdfGenerator.ts` in the browser, not by the server's print document.
 *
 * Until now this door took the signer from `radiology_print_settings` in
 * localStorage: the name, the designation and the handwritten image were this
 * station's private print configuration, and nothing consulted the report row
 * the document came from. Two stations with different settings therefore
 * printed different authors for one signed study, and an authorized report
 * printed nothing at all on a station that had switched its signature block off
 * — while an unauthorized draft printed a full name and designation as though
 * someone had signed it.
 *
 * Assertions read the produced PDF's own text operators (`( … ) Tj`) and count
 * its image XObjects, the way `reportPdfGenerator.reportingScope.test.ts` does,
 * so the contract is proven on the file the clinic actually gets.
 */
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";

import {
  DEFAULT_PRINT_SETTINGS,
  generateReportPDF,
  type PrintSettings,
  type ReportData,
  type ReportSignerOfRecord,
} from "./reportPdfGenerator";

/** A name that exists only in this file's localStorage stand-in. */
const BROWSER_SIGNER = "Dr. Browser Station";
type ImageCall = Parameters<jsPDF["addImage"]>;
/** A name that exists only in the report row the export was called with. */
const RECORDED_SIGNER = "Dr. Ananya Menon";
const RECORDED_QUALIFICATION = "MD (Radiodiagnosis)";
/** jsPDF accepts a real PNG; this is a 1×1 transparent pixel, synthetic. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** A different picture, belonging to the station rather than to any report. */
const STATION_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const BROWSER_SETTINGS: PrintSettings = {
  ...DEFAULT_PRINT_SETTINGS,
  show: { ...DEFAULT_PRINT_SETTINGS.show, keyImages: false },
  signature: {
    ...DEFAULT_PRINT_SETTINGS.signature,
    name: BROWSER_SIGNER,
    qualification: "MD (Browser Default)",
    registrationNo: "BROWSER-9",
    imageDataUrl: null,
    // The station's own toggles, to prove they do not decide what a RECORD says.
    showQualification: true,
    showRegistrationNo: true,
  },
};

/** The record's facts, as `recordedSignerForReport()` hands them over. */
function record(over: Partial<ReportSignerOfRecord> = {}): ReportSignerOfRecord {
  return {
    name: RECORDED_SIGNER,
    qualification: RECORDED_QUALIFICATION,
    registrationNo: "REC-4402",
    imageDataUrl: null,
    ...over,
  };
}

function render(
  report: Partial<ReportData>,
  settings: PrintSettings = BROWSER_SETTINGS,
  doctorsCatalog: Array<{ name: string; degree?: string | null }> = [],
): { pdf: string; images: unknown[] } {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const images: unknown[] = [];
  const originalAddImage = doc.addImage.bind(doc);
  // jsPDF types `addImage` as overloads, so the wrapper takes the derived
  // parameter tuple rather than an untyped array (TS2556).
  doc.addImage = ((...call: ImageCall): jsPDF => {
    images.push(call[0]);
    return originalAddImage(...call);
  }) as typeof doc.addImage;
  generateReportPDF(
    {
      patientName: "SYNTHETIC PATIENT",
      age: "41 Y",
      sex: "M",
      studyDate: "20261020",
      referringDoctor: "Dr Referring",
      accessionNumber: "SYN-SI-ACC-0001",
      uhid: "SYN-SI-UHID-0001",
      modality: "MRI",
      bodyPart: "MRI BRAIN",
      findings: "No acute intracranial abnormality.",
      impression: "Normal MRI brain.",
      ...report,
    },
    settings,
    null,
    { save: false, doctorsCatalog, doc },
  );
  return { pdf: Buffer.from(doc.output("arraybuffer")).toString("latin1"), images };
}

function pdfBytes(
  report: Partial<ReportData>,
  settings: PrintSettings = BROWSER_SETTINGS,
  doctorsCatalog: Array<{ name: string; degree?: string | null }> = [],
): string {
  return render(report, settings, doctorsCatalog).pdf;
}

function drawn(pdf: string): Array<{ x: number; y: number; text: string }> {
  const items: Array<{ x: number; y: number; text: string }> = [];
  for (const block of pdf.split(/\bBT\b/).slice(1)) {
    const body = block.split(/\bET\b/)[0];
    for (const m of body.matchAll(/([\d.-]+) ([\d.-]+) Td\s*\(((?:[^()]|\([^)]*\))*)\) Tj/g)) {
      items.push({ x: Number(m[1]), y: Number(m[2]), text: m[3]!.replace(/\\([()])/g, "$1") });
    }
  }
  return items;
}

const joinedText = (pdf: string) => drawn(pdf).map((d) => d.text).join(" ").replace(/\s+/g, " ");

/**
 * The letter-pad header embeds the clinic logo, which is one image XObject on
 * every page. Only with the header off does a picture mean one thing: the
 * signature. This station also has a handwriting image of its own configured,
 * so "no picture drawn" cannot be satisfied by drawing that one instead.
 */
const NO_HEADER: PrintSettings = {
  ...BROWSER_SETTINGS,
  header: { ...BROWSER_SETTINGS.header, enabled: false },
  signature: { ...BROWSER_SETTINGS.signature, imageDataUrl: STATION_PNG },
};
const imageXObjects = (pdf: string) => (pdf.match(/\/Subtype\s*\/Image/g) ?? []).length;

describe("Download PDF — the signer comes from the report's record, not the browser", () => {
  it("P1 a signed report prints the recorded name, not this station's configured name", () => {
    const pdf = pdfBytes({ signerOfRecord: record() });
    const text = joinedText(pdf);
    expect(text).toContain(RECORDED_SIGNER);
    expect(text).not.toContain(BROWSER_SIGNER);
    expect(text).not.toContain("MD (Browser Default)");
    expect(text).toContain(RECORDED_QUALIFICATION);
  });

  it("P2 the recorded block's own registration number prints even though the record name is in the Doctors list", () => {
    // The catalogue lookup is a name match. For the recorded signer it must not
    // run: a Doctors row that calls the same person something else cannot
    // rewrite the qualification the signature block holds.
    const pdf = pdfBytes({ signerOfRecord: record() }, BROWSER_SETTINGS, [
      { name: RECORDED_SIGNER, degree: "DNB (Anaesthesiology)" },
    ]);
    const text = joinedText(pdf);
    expect(text).toContain(RECORDED_QUALIFICATION);
    expect(text).not.toContain("DNB (Anaesthesiology)");
    expect(text).toContain("Reg. No: REC-4402");
  });

  it("P3 a block with no image prints name and designation and invents no signature", () => {
    const { pdf, images } = render({ signerOfRecord: record({ imageDataUrl: null }) }, NO_HEADER);
    const text = joinedText(pdf);
    expect(text).toContain(RECORDED_SIGNER);
    expect(text).toContain(RECORDED_QUALIFICATION);
    expect(text).not.toContain("NOT SIGNED");
    // Header and key images are off, so anything drawn here would be a
    // signature: the record has no picture, and the door invents none — it does
    // not reach past the record for this station's own handwriting.
    expect(images).toEqual([]);
    expect(imageXObjects(pdf)).toBe(0);
  });

  it("P4 a block WITH an image draws that picture and nothing else", () => {
    const { pdf, images } = render(
      { signerOfRecord: record({ imageDataUrl: SIGNATURE_PNG }) },
      NO_HEADER,
    );
    expect(images).toEqual([SIGNATURE_PNG]);
    expect(imageXObjects(pdf)).toBeGreaterThan(0);
    // The picture rides on the words, it does not replace them.
    const text = joinedText(pdf);
    expect(text).toContain(RECORDED_SIGNER);
    expect(text).toContain(RECORDED_QUALIFICATION);
  });

  it("P5 a document with no authorization on record prints no person and says NOT SIGNED", () => {
    const { pdf, images } = render({ signerOfRecord: null, unsigned: true }, NO_HEADER);
    const text = joinedText(pdf);
    expect(text).toContain("NOT SIGNED");
    expect(text).not.toContain(BROWSER_SIGNER);
    expect(text).not.toContain("MD (Browser Default)");
    expect(text).not.toContain("Reg. No: BROWSER-9");
    expect(images).toEqual([]);
  });

  it("P6 a station that switched its signature block off still prints the record", () => {
    // `signature.enabled` is a preference about this printer's chrome. It cannot
    // suppress who a signed report was authorized under.
    const off: PrintSettings = {
      ...BROWSER_SETTINGS,
      signature: { ...BROWSER_SETTINGS.signature, enabled: false },
    };
    const text = joinedText(pdfBytes({ signerOfRecord: record() }, off));
    expect(text).toContain(RECORDED_SIGNER);
    expect(text).not.toContain("NOT SIGNED");
  });

  it("P7 a page with no report row behind it keeps this station's configured signer", () => {
    // The other generators (USG, Echo, Fetal, legacy pages) call this door with
    // neither field set. They must draw exactly what they drew before.
    const before = pdfBytes({});
    const text = joinedText(before);
    expect(text).toContain(BROWSER_SIGNER);
    expect(text).toContain("MD (Browser Default)");
    expect(text).not.toContain("NOT SIGNED");
    // The catalogue name-match still serves that path, which is what it has
    // always done: nothing here widens or narrows it.
    const enriched = pdfBytes({}, BROWSER_SETTINGS, [{ name: BROWSER_SIGNER, degree: "MD (Pathology)" }]);
    expect(joinedText(enriched)).toContain("MD (Pathology)");
    // …including the handwriting this station configured for itself, which is
    // what a block with no report row behind it is for.
    expect(render({}, NO_HEADER).images).toEqual([STATION_PNG]);
  });
});
