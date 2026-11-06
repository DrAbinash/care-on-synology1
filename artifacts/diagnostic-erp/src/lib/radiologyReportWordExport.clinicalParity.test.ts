/**
 * P1 — real generated documents, not a text excerpt.
 *
 * The claim this file exists to hold: the signed report's PDF and the signed
 * report's Word file carry the SAME clinical content. Earlier acceptance rounds
 * called that proven by comparing extracted prose, which is exactly the check
 * that passes while a converter drops a whole measurement table — it kept every
 * sentence and lost the numbers, the CRITICAL banner and the table's rows. So
 * this file compares three things: the clinical tokens (both artefacts), the
 * element inventory (banners, tables, rows, cells — counted on each side), and a
 * coverage sweep of the print page's own body text against the Word file.
 *
 * Both artefacts are the real products: the PDF is rendered by `htmlToPdf.ts`,
 * the same headless-Chromium path `GET /api/patient-reports/:id/pdf` serves, and
 * read back with `pdftotext`; the Word file is the archive
 * `exportRadiologyReportToWord()` packs, read back out of `word/document.xml`.
 * The input is a synthetic report that CONTAINS the fragile elements — a critical
 * value, a documented reporting region narrower than the booked examination, a
 * superseded amendment banner, a canal AP table with unmeasured levels and a lab
 * parameter table with flagged results — under both letter-pad templates.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import { chromium } from "playwright";
import { saveAs } from "file-saver";

import { exportRadiologyReportToWord } from "./radiologyReportWordExport";
import { reportedScopeNote } from "@workspace/report-quality";
import { renderHtmlToPdf } from "../../../api-server/src/lib/htmlToPdf";
import {
  renderReportDocument, resolvePresentationTemplate, type ReportDocumentModel,
} from "../../../api-server/src/lib/reportPresentation";
import { resolveArtifactDir } from "../../../../tests/helpers/resolveTestArtifactDir";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve("docx"))("jszip");

function hasChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const BOOKED_TITLE = "MRI WHOLE SPINE";
const SCOPE_NOTE = reportedScopeNote({
  bookedTitle: BOOKED_TITLE,
  records: [{
    fromRegion: "Whole Spine",
    toRegion: "Cervical Spine",
    decidedBy: "abinashsingh@gmail.com",
    at: "2026-10-13T09:40:00.000Z",
  }],
})!;

/** `spinalCanalApTable.ts`'s `renderCanalApTable()` markup, copied from a real
 *  print page fetched off the rig. The em-dash cells are levels the radiologist
 *  never measured, and they must not borrow a neighbour's number. */
const CANAL_TABLE = `<div class="section-heading">CERVICAL CANAL AP DIAMETER AT C2-C3 TO C7-T1 LEVELS</div>
<table style="border-collapse:collapse;margin:0 0 8px;width:auto;">
  <thead><tr><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">LEVEL</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C2-C3</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C3-C4</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C4-C5</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C5-C6</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C6-C7</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C7-T1</th></tr></thead>
  <tbody><tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;">AP (mm)</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">—</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">11.4</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">10.8</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">9.6</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">10.1</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">—</td></tr></tbody>
</table>`;

/** `patient-reports.ts:3693`'s banner, passed through the model's
 *  `safeguardBannerHtml` exactly as the version-resolution layer hands it over. */
const SUPERSEDED_BANNER = `<div class="superseded-banner">SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS<br/>This document is Version 1 of 2 and must not be used for clinical decisions. Latest version: SYNWORD-RPT-0002.</div>`;

const BODY_HTML = `<div class="section-heading">CLINICAL HISTORY</div><p>Neck pain with right upper limb radiculopathy for three months.</p>
<div class="section-heading">TECHNIQUE</div><p>MRI cervical spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W.</p>
<div class="section-heading">FINDINGS</div><p>Normal cervical lordosis is maintained. Loss of disc height and signal at C5-C6 with a posterior central disc bulge.</p>
${CANAL_TABLE}
<div class="section-heading">IMPRESSION</div><p>Borderline cervical canal stenosis at C5-C6 with a posterior central disc bulge. Right C6 nerve root compression.</p>
<div class="section-heading">RECOMMENDATION</div><p>Clinical correlation. Review after six weeks of conservative treatment.</p>`;

/** A signed radiology report carrying every fragile element. Synthetic names
 *  only — nothing here belongs to a real patient or a real radiologist. */
function signedModel(): ReportDocumentModel {
  return {
    reportNumber: "SYNWORD-RPT-0001",
    studyTitle: BOOKED_TITLE,
    typeLabel: "RADIOLOGY",
    statusLabel: "SIGNED",
    clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-000000" },
    patientRows: [
      { label: "Patient", value: "SYNWORD CASE01" },
      { label: "Age / Sex", value: "41y / M" },
      { label: "UHID", value: "SYNP0701" },
      { label: "Accession", value: "SYNRC6701" },
    ],
    isCritical: true,
    criticalNote: "Borderline cervical canal stenosis at C5-C6 (synthetic parity fixture)",
    reportingScopeNote: SCOPE_NOTE,
    safeguardBannerHtml: SUPERSEDED_BANNER,
    parameters: [
      { name: "Serum Calcium", result: "10.9", unit: "mg/dL", refRange: "8.8-10.6", flag: "high" },
      { name: "Vitamin B12", result: "180", unit: "pg/mL", refRange: "200-900", flag: "low" },
    ],
    bodyHtml: BODY_HTML,
    footerNote: "Report issued by authorized radiologist only.",
    stamp: { kind: "verified", label: "SIGNED" },
    signatures: [{
      name: "Dr Synthetic Rao", qualification: "MD (Radiodiagnosis)", role: "Consultant Radiologist",
      registrationNo: "SYN-REG-777", label: "Signed:", whenLabel: " 01/11/2026, 09:40",
    }],
    generatedAtLabel: "01/11/2026, 09:40",
  };
}

/** `<div class="body">` is `model.bodyHtml` and nothing else
 *  (`reportPresentation.ts:718`); its own close tag is found by matching nested
 *  `<div>`s, so the sweep covers the clinical page and not the letter-pad chrome
 *  drawn around it. */
function printBodyHtml(html: string): string {
  const open = html.indexOf('<div class="body">');
  if (open < 0) throw new Error('fixture has no <div class="body"> — the print layout changed');
  const scan = /<div\b[^>]*>|<\/div>/gi;
  scan.lastIndex = open + '<div class="body">'.length;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html)) !== null) {
    if (/^<div\b/i.test(m[0])) depth += 1;
    else if (--depth === 0) return html.slice(open + '<div class="body">'.length, m.index);
  }
  throw new Error('unbalanced <div class="body"> in the fixture');
}

/** Every distinct word the print page draws in the report body. */
function bodyWords(html: string): string[] {
  const text = printBodyHtml(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#39;/g, "'");
  return [...new Set(
    text.split(/\s+/).map((w) => w.replace(/^[\s"'()\[\]]+|[\s"'()\[\],.;:]+$/g, "")).filter((w) => w.length > 1),
  )];
}

/** The Word file's own text and structure, read out of the real archive. */
async function wordArtifact(html: string) {
  vi.mocked(saveAs).mockClear();
  vi.stubGlobal("Image", class {
    naturalWidth = 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  // Header ON: the exporter's own letterhead and demography grid go into
  // word/header1.xml, so word/document.xml counts belong to the report alone.
  await exportRadiologyReportToWord(html, "clinical-parity", { physicalLetterpad: false, keyImages: [] });
  expect(saveAs).toHaveBeenCalledTimes(1);
  const [blob] = vi.mocked(saveAs).mock.calls[0];
  const archive = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
  const xml = await archive.file("word/document.xml")!.async("string");
  const count = (re: RegExp) => (xml.match(re) ?? []).length;
  return {
    xml,
    text: (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join(" "),
    tables: count(/<w:tbl>/g),
    rows: count(/<w:tr\b/g),
    cells: count(/<w:tc>/g),
    // Every bordered paragraph in the body: one per banner box, one per `<hr>`
    // rule the page drew. Expected against the page's own counts, not a constant.
    bordered: count(/<w:pBdr>/g),
  };
}

const CLINICAL_TOKENS = [
  "CRITICAL VALUE", "IMMEDIATE ATTENTION REQUIRED", "Documented reporting region",
  "SUPERSEDED", "must not be used for clinical decisions",
  "CERVICAL CANAL AP DIAMETER", "AP (mm)", "11.4", "10.8", "9.6", "10.1",
  "Serum Calcium", "8.8-10.6", "Vitamin B12", "200-900",
  "posterior central disc bulge", "Right C6 nerve root compression",
];

const HAS_CHROMIUM = hasChromium();

describe("the signed Word file carries what the signed page prints", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(saveAs).mockClear();
  });

  test.each(["care-premium", "care-classic"])("%s — every word of the report body reaches the .docx", async (templateId) => {
    const html = renderReportDocument(signedModel(), resolvePresentationTemplate(templateId));
    // Preconditions: the document under test really carries the fragile elements.
    expect(html).toContain('<div class="critical">');
    expect(html).toContain('<div class="reporting-scope-note">');
    expect(html).toContain('<div class="superseded-banner">');
    expect(html).toContain('<table class="params">');
    expect(printBodyHtml(html)).toContain("11.4");

    const word = await wordArtifact(html);
    const have = new Set(word.text.split(/\s+/).map((w) => w.replace(/^[\s"'()\[\]]+|[\s"'()\[\],.;:]+$/g, "")));
    const missing = bodyWords(html).filter((w) => !have.has(w));
    expect(missing, `words the signed page prints and the Word file drops: ${missing.join(" | ")}`).toEqual([]);
  });

  test.each(["care-premium", "care-classic"])("%s — the element inventory matches, not only the prose", async (templateId) => {
    const html = renderReportDocument(signedModel(), resolvePresentationTemplate(templateId));
    const word = await wordArtifact(html);
    // Three banners, counted on the page, and the same number of boxes in the
    // file — plus one bordered paragraph for every `<hr>` rule the page drew.
    const banners = (html.match(/<div\b[^>]*class="(critical|superseded-banner|version-warning|amended-banner|reporting-scope-note)"/gi) ?? []).length;
    const rules = (html.match(/<hr\b/gi) ?? []).length;
    expect(banners, "banner boxes on the page").toBe(3);
    expect(word.bordered, "bordered paragraphs in the .docx").toBe(banners + rules);
    // Two clinical tables: the canal AP grid (7 header + 7 value cells) and the
    // lab parameters (4 header + 8 value cells). Both counted from the page.
    const paramsTable = (html.match(/<table class="params">([\s\S]*?)<\/table>/i) ?? ["", ""])[1]!;
    const clinicalCells =
      (printBodyHtml(html).match(/<t[hd]\b/gi) ?? []).length + (paramsTable.match(/<t[hd]\b/gi) ?? []).length;
    expect(clinicalCells, "cells the signed page prints").toBe(26);
    expect(word.cells, "cells the Word file draws").toBe(clinicalCells);
    expect(word.tables, "clinical tables in the .docx").toBe(2);
    expect(word.rows, "clinical rows in the .docx").toBe(5);
    for (const needle of CLINICAL_TOKENS) {
      expect(word.text, `the Word file must carry ${needle}`).toContain(needle);
    }
    // An unmeasured level stays unmeasured instead of inventing a number.
    expect(word.text).toContain("—");
  });

  it.skipIf(!HAS_CHROMIUM)("the same signed report's PDF carries the same clinical tokens", async () => {
    // A real Chromium render of the real print HTML, read back with pdftotext —
    // the door `GET /api/patient-reports/:id/pdf` uses. (Chromium is absent only
    // on a machine that never installed Playwright's browser; CI installs both it
    // and poppler-utils, so this leg runs there too.)
    const html = renderReportDocument(signedModel(), resolvePresentationTemplate("care-classic"));
    const pdfPath = join(resolveArtifactDir(), "clinical-parity-signed.pdf");
    writeFileSync(pdfPath, await renderHtmlToPdf(html));
    const pdfText = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
    const normalized = pdfText.toLowerCase().replace(/\s+/g, " ");
    for (const needle of CLINICAL_TOKENS) {
      expect(normalized, `the signed PDF prints ${needle}`).toContain(needle.toLowerCase());
    }
    // And the Word file agrees with that PDF, token for token.
    const word = await wordArtifact(html);
    const wordLower = word.text.toLowerCase().replace(/\s+/g, " ");
    for (const needle of CLINICAL_TOKENS) {
      expect(wordLower, `the PDF has "${needle}" but the Word file does not`).toContain(needle.toLowerCase());
    }
  }, 180_000);
});
