/**
 * The identity block must be read by a stable field identifier, not by the words
 * a template happens to print.
 *
 * Two consumers in this codebase look a demographic row up by its DISPLAY LABEL:
 *
 *   • `reportPresentation.rowByLabel` — which label list a row matches decides
 *     whether the value reaches the letter-pad or stacked header at all;
 *   • `signedReportContentGuard.SCAFFOLD_LABELS` — which labels are stripped
 *     decides whether a line counts as something the radiologist AUTHORED.
 *
 * Neither has a compile-time link to the producers. `patient-reports.ts` and
 * `radiology-report-generator.ts` build `{label, value}` arrays by hand, so
 * rewording one label silently changes behaviour in a place nobody edited.
 *
 * This file covers the FIRST consumer only, because that is the one this change
 * corrects. The second is a real, separately measured defect — `ACCESSION_ROW_LABEL`
 * is `"Accession No."` and `SCAFFOLD_LABELS` lists `"accession no"` and
 * `"accession number"`, so the trailing-period spelling the producer actually
 * emits is not stripped and a body whose only line is the accession row
 * classifies as authored content — but fixing it makes the signature gate
 * stricter, which is an independent change and belongs in its own PR.
 *
 * The correction here is additive: a row may carry a stable `key`, `rowByLabel`
 * prefers it and still falls back to every label it accepts today, so no
 * existing producer changes meaning. These tests were written before it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => { throw new Error("the identity row contract must stay database-free"); },
  },
}));

import {
  renderReportDocument,
  resolvePresentationTemplate,
  type RenderableTemplate,
  type ReportDocumentModel,
  type ReportPatientRow,
} from "./reportPresentation";
import { ACCESSION_ROW_LABEL } from "./reportStudyIdentity";

/** A row as it will be produced once the contract exists — extra props are
 *  assignable to `ReportPatientRow[]`, so this compiles before and after. */
type KeyedRow = ReportPatientRow & { key?: string };

const EXAM_DATE = "2025-01-10";
const REPORT_DATE = "2025-01-12";
const UHID = "PV-UHID-0001";
const ACCESSION = "ACC-20261012-MR-007";
const REFERRER = "Dr S. Mehta";
const PATIENT = "Sunita Sharma";

const premium = resolvePresentationTemplate("care-premium");
const SHAPES: { name: string; template: RenderableTemplate }[] = [
  { name: "letter-pad", template: resolvePresentationTemplate("care-classic") },
  {
    name: "stacked",
    template: { ...premium, id: "clinic-stacked", letterhead: { kind: "clinic" }, layout: { ...premium.layout, patientBlockStyle: "stacked" } },
  },
  {
    name: "table",
    template: { ...premium, id: "clinic-table", letterhead: { kind: "clinic" }, layout: { ...premium.layout, patientBlockStyle: "table" } },
  },
];

const visibleText = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");

/**
 * The demography block and nothing else, so an assertion about the identity
 * header cannot be satisfied by the same string appearing in the footer, the
 * signature line or the clinical body.
 *
 * Depth-walked rather than regex-sliced: the stacked block nests one `div` per
 * line, so a non-greedy `<div…>[\s\S]*?</div>` stops at the patient-name div and
 * silently reports that the block printed nothing but the name.
 */
function demographyBlock(html: string): string {
  const tableStart = /<table[^>]*class="[^"]*(?:letterpad-demo|patient-table)[^"]*"/i.exec(html);
  if (tableStart) {
    const end = html.indexOf("</table>", tableStart.index);
    if (end > 0) return html.slice(tableStart.index, end + 8);
  }
  const divStart = /<div[^>]*class="[^"]*patient-stacked[^"]*"/i.exec(html);
  if (divStart) {
    let i = divStart.index;
    let depth = 0;
    const tag = /<div\b|<\/div>/gi;
    tag.lastIndex = i;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(html)) !== null) {
      depth += m[0].toLowerCase() === "<div" ? 1 : -1;
      i = m.index + m[0].length;
      if (depth === 0) return html.slice(divStart.index, i);
    }
  }
  return html;
}

/**
 * The date a block prints, normalised to ISO. The three blocks are allowed to
 * present one value differently — the letter-pad reformats to DD/MM/YYYY and the
 * other two pass the stored value through — but they are not allowed to print
 * different DAYS, which is what Tests B and I are about.
 */
function printedDateIso(blockText: string): string {
  const slashed = /(?:^|[^0-9])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![0-9])/.exec(blockText);
  if (slashed) return `${slashed[3]}-${slashed[2]!.padStart(2, "0")}-${slashed[1]!.padStart(2, "0")}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(blockText);
  if (iso) return iso[0]!;
  return "";
}

function modelWith(rows: KeyedRow[]): ReportDocumentModel {
  return {
    reportNumber: "RPT-20261012-001",
    studyTitle: "MRI BRAIN (PLAIN)",
    typeLabel: "RADIOLOGY",
    statusLabel: "VERIFIED",
    clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-1234" },
    patientRows: rows,
    bodyHtml: "<p>FINDINGS: synthetic findings, no clinical content.</p>",
    stamp: { kind: "verified", label: "VERIFIED" },
    signatures: [],
    footerNote: "Not valid for medicolegal use without seal",
    generatedAtLabel: `${REPORT_DATE}, 3:00 pm`,
  };
}

/** The identity set both report builders emit, keyed and labelled canonically. */
const CANONICAL_ROWS: KeyedRow[] = [
  { key: "patientName", label: "Patient", value: PATIENT },
  { key: "ageSex", label: "Age / Sex", value: "45y / F" },
  { key: "uhid", label: "UHID", value: UHID },
  { key: "studyDate", label: "Study Date", value: EXAM_DATE },
  { key: "referringDoctor", label: "Referring Doctor", value: REFERRER },
  { key: "accessionNumber", label: ACCESSION_ROW_LABEL, value: ACCESSION },
  { key: "testName", label: "Test", value: "MRI BRAIN (PLAIN)" },
  { key: "modality", label: "Modality", value: "MR" },
];

const REWORDED: Record<string, string> = {
  studyDate: "Examination Date",
  referringDoctor: "Referred By",
  uhid: "Patient Index No.",
  accessionNumber: "Study Accession",
};
const rewordedRows = (rows: KeyedRow[] = CANONICAL_ROWS): KeyedRow[] =>
  rows.map((r) => (r.key && REWORDED[r.key] ? { ...r, label: REWORDED[r.key]! } : r));

describe("the identity block survives a label change", () => {
  for (const shape of SHAPES) {
    // The `table` block prints every row it is handed, so it is already immune
    // to a reworded label; the two label-dependent blocks are red today. Naming
    // an already-green arm "RED" would misreport the evidence.
    const red = shape.name === "table" ? "" : "RED: ";

    it(`${red}${shape.name} still prints the examination date when the label is reworded`, () => {
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(rewordedRows()), shape.template)));
      // Today the lookup is `rowByLabel(rows, "study date", "date")`, so a row
      // labelled "Examination Date" matches nothing and the date is dropped from
      // the printed header — the exact silent loss the contract exists to stop.
      expect(printedDateIso(text)).toBe(EXAM_DATE);
    });

    it(`${red}${shape.name} still prints the referrer when the label is reworded`, () => {
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(rewordedRows()), shape.template)));
      expect(text).toContain(REFERRER);
    });

    it(`${red}${shape.name} still prints the UHID when the label is reworded`, () => {
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(rewordedRows()), shape.template)));
      expect(text).toContain(UHID);
    });

    it(`${red}${shape.name} still prints the accession when the label is reworded`, () => {
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(rewordedRows()), shape.template)));
      expect(text).toContain(ACCESSION);
    });

    it(`${shape.name}: today's labels keep working, so the change is additive`, () => {
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(CANONICAL_ROWS), shape.template)));
      expect(printedDateIso(text)).toBe(EXAM_DATE);
      expect(text).toContain(UHID);
      expect(text).toContain(PATIENT);
      expect(text).toContain(REFERRER);
      expect(text).toContain(ACCESSION);
    });
  }
});

describe("the three header shapes print one identity", () => {
  it("every shape agrees on the examination DAY, however each presents it", () => {
    const days = SHAPES.map((shape) => {
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(CANONICAL_ROWS), shape.template)));
      return { name: shape.name, day: printedDateIso(text) };
    });
    for (const d of days) expect(d, `${d.name} must name the examination date`).toEqual({ name: d.name, day: EXAM_DATE });
    expect(new Set(days.map((d) => d.day)).size).toBe(1);
  });

  it("RED: every shape agrees on the identity values, whichever labels arrive", () => {
    for (const shape of SHAPES) {
      const canonical = visibleText(demographyBlock(renderReportDocument(modelWith(CANONICAL_ROWS), shape.template)));
      const reworded = visibleText(demographyBlock(renderReportDocument(modelWith(rewordedRows()), shape.template)));
      for (const value of [PATIENT, UHID, REFERRER, ACCESSION]) {
        expect(canonical, `${shape.name}/canonical`).toContain(value);
        expect(reworded, `${shape.name}/reworded`).toContain(value);
      }
      expect(printedDateIso(reworded)).toBe(printedDateIso(canonical));
    }
  });
});

describe("the examination date is never the report date", () => {
  for (const shape of SHAPES) {
    it(`${shape.name}: a separate report-date row does not displace the study date`, () => {
      const rows: KeyedRow[] = [
        ...CANONICAL_ROWS,
        { key: "reportDate", label: "Report Date", value: REPORT_DATE },
        { key: "signedAt", label: "Signed", value: REPORT_DATE },
      ];
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(rows), shape.template)));
      expect(printedDateIso(text)).toBe(EXAM_DATE);
    });
  }

  // Only the two label-dependent blocks are in scope here. The `table` block
  // prints every row it is handed, label and all, so a row labelled "Date"
  // carrying `createdAt` is a PRODUCER defect on that shape, not a renderer
  // defect — and the producer is what the request-level suite measures end to
  // end. Asking the table block to hide a row it was given would be a layout
  // change this PR is not allowed to make.
  for (const shape of SHAPES.filter((s) => s.name !== "table")) {
    it(`RED: ${shape.name}: a bare "Date" row is not read as the examination date`, () => {
      // This is precisely what the signed builder emits today: one row labelled
      // "Date" whose value is `patient_reports.createdAt`, which
      // `rowByLabel(rows, "study date", "date")` then prints in the DATE slot.
      const rows: KeyedRow[] = [
        { key: "patientName", label: "Patient", value: PATIENT },
        { key: "reportDate", label: "Date", value: REPORT_DATE },
      ];
      const text = visibleText(demographyBlock(renderReportDocument(modelWith(rows), shape.template)));
      expect(printedDateIso(text)).not.toBe(REPORT_DATE);
    });
  }
});
