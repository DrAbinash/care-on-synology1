/**
 * Unified Radiology Report PDF Generator — Care Diagnostics letter-pad layout.
 *
 * Matches the clinic's pre-printed letterhead style: logo + CARE DIAGNOSTICS
 * header, two-column patient block (no "Patient Demographics" label), centered
 * underlined study title, bold/underlined section headings, right-aligned
 * signature (doctor name in red), blue services bar, and medico-legal disclaimer.
 *
 * Fonts stay slightly smaller than typical Word output so a full MRI report
 * fits one A4 page while keeping readable line spacing.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { CARE_LETTERHEAD_LOGO_DATA_URL, CARE_LETTERHEAD_LOGO_SIZE } from "./careLetterheadLogo";
import { parseFindingsDocument } from "./findingsDocument";
import { isAbnormalFindingsLine } from "./abnormalEmphasis";
import {
  resolveCareLetterpadChrome,
  parseMeasurementMm,
  parseMeasurementPt,
  type CareLetterpadChrome,
} from "./careLetterpadChrome";
import { resolveDoctorDegreeFromCatalog } from "./reportDemography";

export type PrintSettings = {
  paperSize: "A4" | "A5" | "Letter";
  orientation: "portrait" | "landscape";
  fontSize: "small" | "medium" | "large";
  fontFamily: "helvetica" | "times";
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  header: {
    enabled: boolean;
    title: string;
    logo: string | null;
    showDate: boolean;
  };
  footer: {
    enabled: boolean;
    disclaimer: string;
    showPageNumber: boolean;
    /** Dark blue services strip under the signature (letter-pad style). */
    servicesBar: string;
  };
  watermark: string;
  watermarkOpacity: number;
  layout: Array<"patientBox" | "clinicalHistory" | "technique" | "comparison" | "measurements" | "findings" | "keyImages" | "impression" | "recommendation">;
  show: {
    patientBox: boolean;
    clinicalHistory: boolean;
    technique: boolean;
    comparison: boolean;
    measurements: boolean;
    findings: boolean;
    keyImages: boolean;
    impression: boolean;
    recommendation: boolean;
  };
  signature: {
    enabled: boolean;
    name: string;
    qualification: string;
    registrationNo: string;
    imageDataUrl: string | null;
    showQualification: boolean;
    showRegistrationNo: boolean;
  };
};

const DEFAULT_SERVICES_ROW1 =
  "MULTI SLICE CT SCAN  |  3D/4D ULTRA SOUND  |  COLOUR DOPPLER  |  MAMMOGRAPHY  |  ECHO  |  DIGITAL X-RAY  |  ECG/EEG";
const DEFAULT_SERVICES_ROW2 =
  "PATHOLAB  |  OPG  |  TMT  |  NCV/EMG  |  ELASTOGRAPHY/FIBROSCAN  |  UPPER GI ENDOSCOPY  |  HSG  |  BARIUM STUDY  |  TVS";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperSize: "A4",
  orientation: "portrait",
  fontSize: "medium",
  fontFamily: "helvetica",
  // Tight letter-pad margins — blue services bar + disclaimer sit near the page edge.
  margins: { top: 4, bottom: 14, left: 8, right: 8 },
  header: {
    enabled: true,
    title: "CARE DIAGNOSTICS",
    logo: null,
    showDate: true,
  },
  footer: {
    enabled: true,
    disclaimer:
      "Radiological diagnosis is not always conclusive & often vary with clinical course of the disease or response to treatment. This report is not for medico-legal purpose.",
    showPageNumber: false,
    servicesBar: `${DEFAULT_SERVICES_ROW1}\n${DEFAULT_SERVICES_ROW2}`,
  },
  watermark: "",
  watermarkOpacity: 0.1,
  layout: ["patientBox", "clinicalHistory", "technique", "comparison", "measurements", "findings", "impression", "recommendation", "keyImages"],
  show: {
    patientBox: true,
    clinicalHistory: true,
    technique: true,
    comparison: true,
    measurements: true,
    findings: true,
    keyImages: false,
    impression: true,
    recommendation: true,
  },
  signature: {
    enabled: true,
    name: "Dr. Sugandha Priyadarshini",
    qualification: "MD (Radiodiagnosis & Medical Imaging)",
    registrationNo: "",
    imageDataUrl: null,
    showQualification: true,
    showRegistrationNo: false,
  },
};

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem("radiology_print_settings");
    if (!raw) return { ...DEFAULT_PRINT_SETTINGS, footer: { ...DEFAULT_PRINT_SETTINGS.footer }, header: { ...DEFAULT_PRINT_SETTINGS.header }, show: { ...DEFAULT_PRINT_SETTINGS.show }, signature: { ...DEFAULT_PRINT_SETTINGS.signature }, margins: { ...DEFAULT_PRINT_SETTINGS.margins } };
    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    const signature = { ...DEFAULT_PRINT_SETTINGS.signature, ...(parsed.signature ?? {}) };
    if (/abinash/i.test(signature.name)) {
      signature.name = DEFAULT_PRINT_SETTINGS.signature.name;
      signature.qualification = DEFAULT_PRINT_SETTINGS.signature.qualification;
    }
    return {
      ...DEFAULT_PRINT_SETTINGS,
      ...parsed,
      margins: { ...DEFAULT_PRINT_SETTINGS.margins, ...(parsed.margins ?? {}) },
      header: { ...DEFAULT_PRINT_SETTINGS.header, ...(parsed.header ?? {}) },
      footer: { ...DEFAULT_PRINT_SETTINGS.footer, ...(parsed.footer ?? {}) },
      show: { ...DEFAULT_PRINT_SETTINGS.show, ...(parsed.show ?? {}) },
      signature,
      layout: parsed.layout ?? DEFAULT_PRINT_SETTINGS.layout,
    };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  localStorage.setItem("radiology_print_settings", JSON.stringify(settings));
}

export type PrintClinic = {
  name?: string | null;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoDataUrl?: string | null;
} | null;

export type ReportData = {
  patientName?: string;
  age?: string;
  sex?: string;
  accessionNumber?: string;
  /** The patient's UHID / master index number, when the record has one. */
  uhid?: string;
  studyDate?: string;
  referringDoctor?: string;
  modality?: string;
  bodyPart?: string;
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  recommendation?: string;
  technique?: string;
  comparison?: string;
  measurements?: Array<{ label: string; value: string }>;
  /**
   * Key images for the rail. A bare data URL is still accepted because that is
   * what the non-radiology pages have always passed; the reporting workspace
   * passes the stored record, whose caption is the radiologist's own words.
   */
  keyImages?: Array<string | ReportKeyImage>;
  reportTitle?: string;
  /**
   * The region this report documents, when the radiologist recorded a different
   * one (ADR-004). Produced by `reportedScopeNote()` in `@workspace/report-quality`
   * — the same function the server's print document uses, so the paper and the
   * PDF cannot state different anatomy for one study. Absent unless a transition
   * was recorded, and the booked title above it is never changed by it.
   */
  reportingScopeNote?: string;
  printedBy?: string;
};

/** One frozen key image as the rail needs it: pixels, plus a caption if one exists. */
export interface ReportKeyImage {
  src: string;
  caption?: string | null;
  /**
   * The stored attachment's own identity. Only a cell whose pixels could not be
   * read needs it, but then it is the whole point: the warning has to name which
   * attachment is missing, and an image silently absent from a signed-looking PDF
   * names nothing at all.
   */
  attachmentId?: number | null;
  sopInstanceUid?: string | null;
}

/**
 * 1×1 slate-grey pixel, drawn at the port's size where a key image exists in the
 * record but its bytes could not be read. The alternative — skipping the cell — is
 * what made a 14-image study export 5 images with no trace of the other 9.
 */
const KEY_IMAGE_PLACEHOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN49OIDAAVqAru/zcVKAAAAAElFTkSuQmCC";

interface KeyImageCell {
  src: string;
  caption: string;
  attachmentId: number | null;
  sopInstanceUid: string | null;
  /** True when the record holds an attachment but no readable pixels. */
  unreadable: boolean;
}

function normalizeKeyImages(list: ReportData["keyImages"]): KeyImageCell[] {
  // An attachment with no pixels is KEPT: it is drawn as a placeholder and named
  // in the integrity line. Dropping it here was one of the two ways the Download
  // PDF lost images without saying so.
  return (list ?? []).map((img) => {
    const rec = typeof img === "string" ? { src: img } : img;
    return {
      src: rec.src ?? "",
      caption: (typeof img === "string" ? "" : img.caption ?? "").trim(),
      attachmentId: typeof img === "string" ? null : img.attachmentId ?? null,
      sopInstanceUid: typeof img === "string" ? null : img.sopInstanceUid ?? null,
      unreadable: !rec.src,
    };
  });
}

/** Slightly compact sizes so a full MRI report fits one A4 page with air between lines. */
const FONT_SIZES = {
  small: { body: 8.5, heading: 9.5, title: 11.5, patient: 9, header: 16, footer: 7, disclaimer: 6.5, line: 3.6 },
  medium: { body: 9.5, heading: 10.5, title: 12.5, patient: 9.5, header: 17, footer: 7.5, disclaimer: 7, line: 4.0 },
  large: { body: 10.5, heading: 11.5, title: 13.5, patient: 10.5, header: 18, footer: 8, disclaimer: 7.5, line: 4.4 },
};

const CARE_LETTER_COLORS: Array<[number, number, number]> = [
  [220, 38, 38],   // C — red (brand bubble letter)
  [22, 163, 74],   // A — green
  [37, 99, 235],   // R — blue
  [249, 115, 22],  // E — orange
];

/**
 * Read the three shapes a study date arrives in: `2026-10-04` from the ERP,
 * `20261004` from DICOM, and `04/10/2026` typed into the Demography card at the top
 * of the Reporting Workspace — which is a free-text field, and DD/MM/YYYY is how
 * every report he reads displays the date. Returns null for anything that would
 * have to be guessed, including a date that does not exist on the calendar.
 */
function readStudyDate(raw: string): { y: number; m: number; d: number } | null {
  const typed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (typed) return asRealDate(Number(typed[3]), Number(typed[2]), Number(typed[1]));
  // Slashed and not DD/MM/YYYY: refuse rather than pick an order.
  if (raw.includes("/")) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) return asRealDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  if (/[\s,-]/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
    }
  }
  return null;
}

/** Year/month/day as written, or null when no such day exists. */
function asRealDate(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
  // A study date outside this window is a misread, not history.
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m, d };
}

/**
 * The DATE line of the letter-pad header, DD/MM/YYYY.
 *
 * The signed document renders its own copy server-side
 * (`reportPresentation.formatReportDateShort`) and the two must agree —
 * `reportStudyDate.test.ts` runs both over the same inputs, so an edit on one side
 * fails on the other. Exported for that test and for nothing else.
 */
export function formatReportDateShort(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const read = readStudyDate(trimmed);
  if (!read) return trimmed;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(read.d)}/${pad(read.m)}/${read.y}`;
}

function ageSexLine(age?: string, sex?: string): string {
  const a = (age || "").trim();
  const s = (sex || "").trim().toUpperCase();
  if (a && s) return `${a} / ${s}`;
  return a || s || "";
}

function drawSectionHeading(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  font: string,
  size: number,
): number {
  doc.setFont(font, "bold");
  doc.setFontSize(size);
  doc.setTextColor(0, 0, 0);
  doc.text(text, x, y);
  const w = doc.getTextWidth(text);
  doc.setDrawColor(0);
  doc.setLineWidth(0.35);
  doc.line(x, y + 0.7, x + w, y + 0.7);
  return y + size * 0.42 + 1.2;
}

function drawWrappedBody(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  size: number,
  lineH: number,
  contentBottom?: number,
  ensureSpace?: (needed: number) => number,
): number {
  doc.setFont(font, "normal");
  doc.setFontSize(size);
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(text, maxW) as string[];
  for (const line of lines) {
    // If pagination parameters provided, check space before each line
    if (contentBottom !== undefined && ensureSpace) {
      y = ensureSpace(lineH);  // CRITICAL: Use returned y after potential page break
    }
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}

/** Findings may contain "LABEL: body" lines — bold the label like the letter pad.
 *  Also supports **bold** markdown spans and preserves s/o style slashes.
 *
 *  Headings authored on their own line ("Alignment:") and `|`-delimited tables
 *  (per-level canal diameters) come from the same document model the print and
 *  preview surfaces read, so the downloaded PDF shows the same structure the
 *  radiologist saw on screen instead of a wall of text.
 *
 *  Block-aware pagination: each logical block (heading, table, or paragraph)
 *  is checked against contentBottom before rendering. If insufficient space
 *  remains, a page break is triggered so blocks never overlap the signature
 *  or footer. */
function drawFindingsBlock(
  doc: jsPDF,
  findings: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
  contentBottom: number,
  ensureSpace: (needed: number) => number,
): number {
  const normalized = normalizeReportPlainText(findings);
  const blocks = parseFindingsDocument(normalized);
  
  // Professional radiology report spacing:
  // - 6-8 pt (2.1-2.8mm) before anatomical subheadings
  // - 4-6 pt (1.4-2.1mm) between independent observations
  // - Keep headings with their associated content
  const HEADING_SPACE_BEFORE = lineH * 0.7;  // ~2.8mm for medium (6-8pt target)
  const PARA_SPACE_AFTER = lineH * 0.5;      // ~2.0mm for medium (4-6pt target)
  
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : null;
    
    if (block.kind === "heading") {
      // Add spacing before heading (except for first block)
      if (i > 0) {
        y += HEADING_SPACE_BEFORE;
      }
      // Reserve space for heading + at least one paragraph line to avoid orphaned headings
      // If next block is a paragraph, reserve space for heading + first few lines
      let reserveHeight = lineH * 1.2;  // heading itself
      if (nextBlock && nextBlock.kind === "para") {
        // Estimate first paragraph height (at least 2 lines)
        reserveHeight += lineH * 2.5;
      }
      y = ensureSpace(reserveHeight);  // CRITICAL: Use returned y after potential page break
      
      doc.setFont(font, "bold");
      doc.setFontSize(bodySize);
      doc.setTextColor(30, 27, 75);
      doc.text(block.text, x, y);
      y += lineH;
      y += lineH * 0.25;  // Small space after heading before content
      continue;
    }
    if (block.kind === "table") {
      // Estimate table height: header row + data rows + padding
      const tableHeight = (block.rows.length + 1) * lineH * 1.5 + lineH * 0.35;
      y = ensureSpace(tableHeight);  // CRITICAL: Use returned y after potential page break
      y = drawFindingsTable(doc, block.header, block.rows, x, y, maxW, font, bodySize, lineH);
      y += PARA_SPACE_AFTER;
      continue;
    }
    // For paragraphs, estimate height based on text length and available width
    const paragraphs = block.text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const para = paragraphs[pIdx];
      // Estimate lines needed for this paragraph
      const approxCharsPerLine = maxW / (bodySize * 0.35);
      const estLines = Math.max(1, Math.ceil(para.length / approxCharsPerLine));
      const paraHeight = estLines * lineH + PARA_SPACE_AFTER;
      y = ensureSpace(paraHeight);  // CRITICAL: Use returned y after potential page break

      // The PDF half of the editor's colour: a line that asserts pathology is
      // drawn bold, a normal one is not, on every surface the report reaches.
      const emphatic = isAbnormalFindingsLine(para);
      const m = para.match(/^([A-Z][A-Z0-9 /&().-]{1,48}):\s*([\s\S]*)$/);
      if (m) {
        const label = `${m[1]}:`;
        const rest = m[2].trim();
        doc.setFont(font, "bold");
        doc.setFontSize(bodySize);
        doc.setTextColor(0, 0, 0);
        doc.text(label, x, y);
        const labelW = doc.getTextWidth(label) + 1.2;
        if (rest) {
          y = drawInlineMarkdown(doc, rest, x + labelW, y, Math.max(20, maxW - labelW), font, bodySize, lineH, x, emphatic);
        } else {
          y += lineH;
        }
      } else {
        y = drawInlineMarkdown(doc, para, x, y, maxW, font, bodySize, lineH, x, emphatic);
      }
      // Add spacing after paragraph (professional radiology spacing)
      y += PARA_SPACE_AFTER;
    }
  }
  return y;
}

/** Same table engine the MEASUREMENTS section already uses, so a canal
 *  diameter table looks like the rest of the letter-pad output and paginates
 *  on its own instead of running off the page. */
function drawFindingsTable(
  doc: jsPDF,
  header: string[],
  rows: string[][],
  x: number,
  y: number,
  maxW: number,
  font: string,
  size: number,
  lineH: number,
): number {
  autoTable(doc, {
    startY: y,
    head: [header],
    body: rows,
    styles: { fontSize: size - 0.5, font, cellPadding: 1.1 },
    headStyles: { fillColor: [241, 245, 249], textColor: [0, 0, 0], fontStyle: "bold" },
    margin: { left: x, right: Math.max(4, doc.internal.pageSize.getWidth() - x - maxW) },
  });
  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return typeof finalY === "number" && Number.isFinite(finalY) ? finalY + lineH * 0.4 : y + lineH * (rows.length + 1);
}

/**
 * Collapse text that was stored with a space between every letter
 * ("A d e t a i l e d" → "Adetailed"). Multi-space gaps are treated as
 * word boundaries so "A d e t a i l e d   c o n t r a s t" → "Adetailed contrast".
 * Processes each line independently so a normal first sentence does not block
 * collapse of a letter-spaced second sentence.
 */
export function collapseSpacedOutLetters(raw: string): string {
  return String(raw ?? "")
    .split("\n")
    .map((line) =>
      line
        .split(/ {2,}/)
        .map((chunk) => {
          const t = chunk.trim();
          if (!t) return "";
          const m = /^(?:[A-Za-z0-9]\s)+[A-Za-z0-9]([.,;:!?]*)$/.exec(t);
          if (m) {
            const punct = m[1] ?? "";
            return t.slice(0, t.length - punct.length).replace(/\s+/g, "") + punct;
          }
          return chunk;
        })
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}

/** Normalize unicode slash lookalikes so "s/o" stays "s/o". */
export function normalizeReportPlainText(raw: string): string {
  // Collapse letter-spaced runs BEFORE squeezing multi-spaces — multi-space is
  // the word boundary in "A d e t a i l e d   c o n t r a s t".
  return collapseSpacedOutLetters(
    String(raw ?? "")
      .normalize("NFKC")
      .replace(/[\u2215\u2044\uFF0F]/g, "/") // ∕ ⁄ ／ → /
      .replace(/\u00A0/g, " "),
  ).replace(/[ \t]{2,}/g, " ").trim();
}

export type InlineSeg = { text: string; bold: boolean };

/** `**bold**` / `__bold__` spans, with `baseBold` for a whole line the report
 *  wants emphasised (an abnormal findings line — the PDF half of the colour the
 *  editor shows). Explicit markdown still wins inside it. */
export function parseInlineMarkdown(text: string, baseBold = false): InlineSeg[] {
  const segs: InlineSeg[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), bold: baseBold });
    segs.push({ text: m[1] ?? m[2] ?? "", bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), bold: baseBold });
  if (segs.length === 0) segs.push({ text, bold: baseBold });
  return segs.filter((s) => s.text.length > 0);
}

/** Draw a line with optional **bold** spans; wraps at maxW, continuing at indentX. */
function drawInlineMarkdown(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
  indentX: number,
  baseBold = false,
): number {
  const segs = parseInlineMarkdown(text, baseBold);
  let cx = x;
  let lineStartX = x;
  const lineMax = (start: number) => start === indentX ? maxW + (x - indentX) : maxW;

  const emitWord = (word: string, bold: boolean) => {
    doc.setFont(font, bold ? "bold" : "normal");
    doc.setFontSize(bodySize);
    doc.setTextColor(0, 0, 0);
    const w = doc.getTextWidth(word);
    const avail = lineMax(lineStartX) - (cx - lineStartX);
    if (cx > lineStartX && w > avail + 0.01) {
      y += lineH;
      cx = indentX;
      lineStartX = indentX;
    }
    doc.text(word, cx, y);
    cx += w;
  };

  for (const seg of segs) {
    const parts = seg.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        doc.setFont(font, seg.bold ? "bold" : "normal");
        const sw = doc.getTextWidth(part);
        if (cx - lineStartX + sw > lineMax(lineStartX) && cx > lineStartX) {
          y += lineH;
          cx = indentX;
          lineStartX = indentX;
        } else {
          doc.text(part, cx, y);
          cx += sw;
        }
      } else {
        emitWord(part, seg.bold);
      }
    }
  }
  return y + lineH;
}

function drawNumberedImpression(
  doc: jsPDF,
  impression: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
  contentBottom?: number,
  ensureSpace?: (needed: number) => number,
): number {
  const rawLines = impression.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const items = rawLines.map((l, i) => {
    if (/^\d+[.)]\s*/.test(l)) return l.replace(/^\d+[.)]\s*/, "");
    return l;
  });
  items.forEach((item, i) => {
    const prefix = `${i + 1}. `;
    // The impression is the clinical bottom line of the report, so it is set in
    // bold on the letter pad as well as on screen and in Word.
    doc.setFont(font, "bold");
    doc.setFontSize(bodySize);
    const lines = doc.splitTextToSize(item, maxW - doc.getTextWidth(prefix)) as string[];
    // Check space before each impression item
    if (contentBottom !== undefined && ensureSpace) {
      const itemHeight = lines.length * lineH + lineH * 0.25;
      y = ensureSpace(itemHeight);  // CRITICAL: Use returned y after potential page break
    }
    doc.text(prefix, x, y);
    doc.text(lines[0] ?? "", x + doc.getTextWidth(prefix), y);
    y += lineH;
    for (let j = 1; j < lines.length; j++) {
      doc.text(lines[j], x + doc.getTextWidth(prefix), y);
      y += lineH;
    }
    y += lineH * 0.25;
  });
  return y;
}

/** Shared metrics for every key-image surface: the rail and the continuation grid. */
const KEY_IMAGE = {
  framePad: 2.5,
  gap: 1.4,
  headingH: 5,
  square: 32,
  capSize: 5,
  capPad: 0.6,
  capLineH: 5 * 0.3528 * 1.25, // pt -> mm, with leading
};

/** The caption wrapped to the port's width — empty for an image nobody captioned. */
function keyImageCaptionLines(doc: jsPDF, caption: string, square: number, font: string): string[] {
  if (!caption) return [];
  doc.setFont(font, "normal");
  doc.setFontSize(KEY_IMAGE.capSize);
  return doc.splitTextToSize(caption, square - 1) as string[];
}

function keyImageCellHeight(doc: jsPDF, cell: KeyImageCell, square: number, font: string): number {
  const lines = keyImageCaptionLines(doc, cell.caption, square, font);
  return square + (lines.length ? lines.length * KEY_IMAGE.capLineH + KEY_IMAGE.capPad : 0);
}

/**
 * One key image: black square port, pixels letterboxed inside it so the study's
 * own aspect ratio survives, and the radiologist's caption directly beneath.
 * Returns the height consumed, excluding the gap to the next cell.
 *
 * `frame` is the navy panel the page-1 rail sits in — on the rail the caption is
 * white on navy, in the flow it is black on the page, so the ink is chosen here
 * rather than by the caller.
 */
function drawKeyImageCell(
  doc: jsPDF,
  cell: KeyImageCell,
  x: number,
  yTop: number,
  square: number,
  font: string,
  opts: { frame: boolean; ordinal: number },
): number {
  const ink: [number, number, number] = opts.frame ? [255, 255, 255] : [17, 17, 17];
  doc.setFillColor(0, 0, 0);
  doc.rect(x, yTop, square, square, "F");
  const pixels = cell.src || KEY_IMAGE_PLACEHOLDER;
  try {
    const ext = pixels.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    const props = doc.getImageProperties(pixels);
    const iw = Math.max(1, props.width);
    const ih = Math.max(1, props.height);
    const scale = Math.min(square / iw, square / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    // Center DICOM pixels inside the square port (equal letterbox if needed).
    doc.addImage(pixels, ext, x + (square - dw) / 2, yTop + (square - dh) / 2, dw, dh);
  } catch {
    // The bytes themselves refused to decode. The cell still occupies its place,
    // and the label inside it names it, so a corrupt attachment cannot vanish.
    try {
      doc.addImage(KEY_IMAGE_PLACEHOLDER, "PNG", x, yTop, square, square);
    } catch { /* nothing more can be drawn here */ }
    cell.unreadable = true;
    cell.src = "";
  }
  // One label per failed cell, drawn here and nowhere else — a second string at
  // this coordinate would overprint it into an unreadable smear.
  if (!cell.src && cell.unreadable) {
    doc.setFont(font, "bold");
    doc.setFontSize(KEY_IMAGE.capSize);
    doc.setTextColor(...ink);
    doc.text(`KEY IMAGE #${opts.ordinal} COULD NOT BE READ`, x + 1.5, yTop + square / 2, {
      maxWidth: square - 3,
    });
  }
  let y = yTop + square;
  const lines = keyImageCaptionLines(doc, cell.caption, square, font);
  if (lines.length) {
    doc.setFont(font, "normal");
    doc.setFontSize(KEY_IMAGE.capSize);
    doc.setTextColor(...ink);
    doc.text(lines, x + 0.3, y + KEY_IMAGE.capLineH * 0.85, { maxWidth: square - 1 });
    y += lines.length * KEY_IMAGE.capLineH + KEY_IMAGE.capPad;
  }
  return y - yTop;
}

/**
 * Key images beside report text — extreme-right rail, square ports, equal frame
 * pad. Only the cells that fit on page 1 belong here; the caller receives the
 * count it drew and continues the rest below the report body. Returning that
 * number is the whole point: silently stopping at the page edge is what lost the
 * attachments the clinic had selected.
 */
function drawSideRailKeyImages(
  doc: jsPDF,
  images: KeyImageCell[],
  railX: number,
  railW: number,
  startY: number,
  contentBottom: number,
  font: string,
  headingSize: number,
): { bottomY: number; drawn: number } {
  if (images.length === 0 || railW <= 8) return { bottomY: startY, drawn: 0 };
  const framePad = KEY_IMAGE.framePad;
  const gap = KEY_IMAGE.gap;
  const headingH = KEY_IMAGE.headingH;
  const innerW = Math.max(10, railW - 2 * framePad);
  const avail = Math.max(20, contentBottom - startY - headingH - 2 * framePad);
  // Cap square for page fit, then shrink the navy panel to that square so
  // left/right framePad stay equal (no leftover blue band on the right).
  const square = Math.min(innerW, KEY_IMAGE.square);

  // A caption belongs BELOW its square, so it costs height that a uniform cell
  // count cannot see. Measured first, then the fit decision uses each real cell
  // height: a report with no captions occupies exactly the space it did before.
  const heights = images.map((cell) => keyImageCellHeight(doc, cell, square, font));

  const picked: number[] = [];
  let used = 0;
  for (let i = 0; i < images.length; i++) {
    const add = heights[i] + (picked.length ? gap : 0);
    if (used + add > avail && picked.length > 0) break;
    if (picked.length === 0 && add > avail) break;
    picked.push(i);
    used += add;
  }
  if (picked.length === 0) return { bottomY: startY, drawn: 0 };
  const stackH = headingH + used;
  const frameH = stackH + 2 * framePad;
  const panelW = square + 2 * framePad;
  const panelX = railX + Math.max(0, railW - panelW);

  doc.setFillColor(15, 23, 42); // #0f172a
  doc.roundedRect(panelX, startY, panelW, frameH, 1.2, 1.2, "F");
  doc.setDrawColor(59, 130, 246); // #3b82f6 accent edge
  doc.setLineWidth(0.35);
  doc.roundedRect(panelX, startY, panelW, frameH, 1.2, 1.2, "S");

  let imgY = startY + framePad;
  const imgX = panelX + framePad;
  doc.setFont(font, "bold");
  doc.setFontSize(headingSize - 0.5);
  doc.setTextColor(255, 255, 255);
  doc.text("KEY IMAGES", imgX, imgY + 3.2);
  imgY += headingH;
  for (const i of picked) {
    imgY += drawKeyImageCell(doc, images[i], imgX, imgY, square, font, {
      frame: true,
      ordinal: i + 1,
    }) + gap;
  }
  return { bottomY: startY + frameH, drawn: picked.length };
}

/**
 * The images that did not fit beside page 1's body, continued below the report in
 * rows of up to three, adding pages as needed. Same ports, same caption rule,
 * same order — so the attachment the radiologist put third is still third, and
 * the count on the page equals the count in the record.
 */
function drawContinuedKeyImages(
  doc: jsPDF,
  images: KeyImageCell[],
  ctx: {
    left: number;
    contentW: number;
    contentBottom: number;
    font: string;
    headingSize: number;
    firstOrdinal: number;
    /**
     * Returns the y this row must start at: the caller's flow position, or the top
     * of a fresh page when the row would otherwise run past the footer reserve.
     * The cursor is passed in rather than read from the closure because the grid
     * keeps its own y while it lays rows out.
     */
    ensureRoom: (needed: number, at: number) => number;
    /** Where the page-1 rail ends, so a full-width row cannot run under it. */
    railBottomY: number;
    onPage: () => number;
  },
  startY: number,
): { y: number; drawn: number } {
  if (images.length === 0) return { y: startY, drawn: 0 };
  const { framePad, gap, square: maxSquare, headingH } = KEY_IMAGE;
  const cols = Math.max(1, Math.min(3, Math.floor((ctx.contentW + gap) / (maxSquare + gap))));
  const square = Math.min(maxSquare, (ctx.contentW - (cols - 1) * gap) / cols);
  let y = startY;
  if (ctx.onPage() === 1) y = Math.max(y, ctx.railBottomY + 2);

  const rowHeight = (row: number[]) =>
    Math.max(...row.map((i) => keyImageCellHeight(doc, images[i], square, ctx.font)));

  let drawn = 0;
  for (let start = 0; start < images.length; start += cols) {
    const row = images.map((_, i) => i).slice(start, start + cols);
    const need = headingH + rowHeight(row) + framePad * 2;
    y = ctx.ensureRoom(start === 0 ? need + gap : need, y);
    if (start === 0) {
      doc.setFont(ctx.font, "bold");
      doc.setFontSize(ctx.headingSize);
      doc.setTextColor(17, 17, 17);
      doc.text("KEY IMAGES (CONTINUED)", ctx.left, y + headingH * 0.7);
      y += headingH;
    }
    let tallest = 0;
    row.forEach((i, col) => {
      const x = ctx.left + col * (square + gap);
      tallest = Math.max(
        tallest,
        drawKeyImageCell(doc, images[i], x, y + framePad, square, ctx.font, {
          frame: false,
          ordinal: ctx.firstOrdinal + i,
        }),
      );
      drawn += 1;
    });
    y += framePad + tallest + gap;
  }
  return { y, drawn };
}

export function generateReportPDF(
  report: ReportData,
  settings: PrintSettings,
  clinic: PrintClinic,
  opts?: {
    save?: boolean;
    letterhead?: CareLetterpadChrome;
    /** Settings → Doctors rows — used to resolve signature degree by name. */
    doctorsCatalog?: Array<{ name: string; degree?: string | null }>;
  },
): jsPDF {
  const fmt = settings.paperSize;
  const sizes: Record<string, number[]> = {
    A4: [210, 297],
    A5: [148, 210],
    Letter: [216, 279],
  };
  const [w, h] = sizes[fmt] ?? sizes.A4;
  const isLand = settings.orientation === "landscape";
  const doc = new jsPDF({
    unit: "mm",
    format: fmt.toLowerCase(),
    orientation: isLand ? "landscape" : "portrait",
  });

  const pageW = isLand ? h : w;
  const pageH = isLand ? w : h;
  const m = settings.margins;
  const contentW = pageW - m.left - m.right;
  const fs = FONT_SIZES[settings.fontSize];
  const font = settings.fontFamily;
  const lineH = fs.line;
  doc.setFont(font);

  let y = m.top;

  const pad = resolveCareLetterpadChrome(opts?.letterhead);
  const addrPt = parseMeasurementPt(pad.addressFontSize) ?? 7.2;
  const logoMm = parseMeasurementMm(pad.logoHeight) ?? 22;

  const drawLetterPadChrome = (): number => {
    let cursor = m.top;
    if (settings.header.enabled) {
      const leftX = m.left;
      const rightX = pageW - m.right;
      let headerBottom = cursor;
      let logoDrawn = false;
      let logoH = logoMm;

      try {
        const aspect = CARE_LETTERHEAD_LOGO_SIZE.width / CARE_LETTERHEAD_LOGO_SIZE.height;
        logoH = logoMm;
        const logoW = Math.min(contentW * 0.52, logoH * aspect);
        // Prefer FAST compression — NONE can fail to embed on some jsPDF builds.
        doc.addImage(CARE_LETTERHEAD_LOGO_DATA_URL, "PNG", leftX, cursor, logoW, logoH, undefined, "FAST");
        headerBottom = cursor + logoH;
        logoDrawn = true;
      } catch {
        try {
          const aspect = CARE_LETTERHEAD_LOGO_SIZE.width / CARE_LETTERHEAD_LOGO_SIZE.height;
          logoH = logoMm;
          const logoW = Math.min(contentW * 0.52, logoH * aspect);
          doc.addImage(CARE_LETTERHEAD_LOGO_DATA_URL, "PNG", leftX, cursor, logoW, logoH);
          headerBottom = cursor + logoH;
          logoDrawn = true;
        } catch {
          logoDrawn = false;
        }
      }

      if (!logoDrawn) {
        doc.setFont(font, "bold");
        doc.setFontSize(18);
        const care = "CARE";
        let cx = leftX;
        const careY = cursor + 8;
        for (let i = 0; i < care.length; i++) {
          doc.setTextColor(...CARE_LETTER_COLORS[i]!);
          const ch = care[i]!;
          doc.text(ch, cx, careY);
          cx += doc.getTextWidth(ch);
        }
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 70);
        doc.text("DIAGNOSTICS", leftX, careY + 5.5);
        headerBottom = careY + 8;
      }

      doc.setFont(font, "normal");
      doc.setFontSize(addrPt);
      doc.setTextColor(20, 20, 20);
      const addrLines = [pad.addressLine1, pad.addressLine2];
      let ay = cursor + 4;
      for (const line of addrLines) {
        doc.text(line, rightX, ay, { align: "right" });
        ay += 3.1;
      }
      const phones = `Phone: ${pad.phones}`;
      const email = `Email: ${pad.email}`;
      const website = pad.website;
      doc.setFontSize(addrPt);
      doc.text(phones, rightX, ay, { align: "right" });
      ay += 3.1;
      doc.text(email, rightX, ay, { align: "right" });
      ay += 3.1;
      doc.text(website, rightX, ay, { align: "right" });
      headerBottom = Math.max(headerBottom, ay);
      doc.setDrawColor(20);
      doc.setLineWidth(0.35);
      doc.line(leftX, headerBottom + 2, rightX, headerBottom + 2);
      cursor = headerBottom + 5.5;
    } else {
      cursor += 2;
    }

    if (settings.show.patientBox) {
      doc.setFontSize(fs.patient);
      doc.setTextColor(0, 0, 0);
      const leftX = m.left;
      const rightEdge = pageW - m.right; // extreme right — same edge as contact / key-image rail
      const name = (report.patientName || "").trim().toUpperCase();
      const refBy = (report.referringDoctor || "").trim().toUpperCase();
      const ageSex = ageSexLine(report.age, report.sex).toUpperCase();
      const dateStr = formatReportDateShort(report.studyDate);

      if (name) {
        doc.setFont(font, "bold");
        doc.text("NAME:", leftX, cursor);
        // Patient name always bold (clinic letter-pad convention).
        doc.setFont(font, "bold");
        doc.text(name, leftX + doc.getTextWidth("NAME: ") + 1, cursor, {
          maxWidth: Math.max(40, rightEdge - leftX - 55),
        });
      }

      if (ageSex) {
        doc.setFont(font, "bold");
        const full = `AGE/SEX: ${ageSex}`;
        doc.text(full, rightEdge, cursor, { align: "right" });
      }
      if (name || ageSex) cursor += lineH + 0.5;

      if (refBy) {
        doc.setFont(font, "bold");
        doc.text("REFD. BY:", leftX, cursor);
        doc.setFont(font, "bold");
        doc.text(refBy, leftX + doc.getTextWidth("REFD. BY: ") + 1, cursor, {
          maxWidth: Math.max(40, rightEdge - leftX - 45),
        });
      }

      if (settings.header.showDate !== false && dateStr) {
        doc.setFont(font, "bold");
        const full = `DATE: ${dateStr}`;
        doc.text(full, rightEdge, cursor, { align: "right" });
      }
      if (refBy || (settings.header.showDate !== false && dateStr)) cursor += lineH + 0.4;

      // The two identifiers that tie this sheet back to the study — a report with
      // no accession on it cannot be traced to the PACS study it describes. Only
      // a row the data can fill is drawn, so a study with neither prints no
      // labels rather than "ACCESSION:" followed by nothing. Nothing gates them by
      // setting: `header.showAccession` was a switch no code ever read, and a
      // traceability line is not a cosmetic option.
      const uhid = (report.uhid || "").trim();
      const accession = (report.accessionNumber || "").trim();
      if (uhid || accession) {
        doc.setFont(font, "bold");
        if (uhid) doc.text(`UHID: ${uhid.toUpperCase()}`, leftX, cursor, {
          maxWidth: Math.max(40, rightEdge - leftX - 55),
        });
        if (accession) {
          const full = `ACCESSION: ${accession.toUpperCase()}`;
          doc.text(full, rightEdge, cursor, { align: "right" });
        }
        cursor += lineH + 0.4;
      }
      // Tight gap between the last demography row and the double rule under it.
      cursor += 0.6;

      doc.setDrawColor(0);
      doc.setLineWidth(0.55);
      doc.line(m.left, cursor, pageW - m.right, cursor);
      doc.setLineWidth(0.25);
      doc.line(m.left, cursor + 1.1, pageW - m.right, cursor + 1.1);
      // Clear space under the double rule so the study title baseline cannot
      // collide with the rules (title ink sits above the y baseline).
      cursor += 7.2;
    }
    return cursor;
  };

  y = drawLetterPadChrome();

  // Key-image rail starts just under AGE/SEX/DATE (demography), right column.
  // Capture before the study title so images hug the demography block.
  const demographyBottomY = y;
  const keyImageList = normalizeKeyImages(report.keyImages);
  const sideRail =
    keyImageList.length > 0 && settings.show.keyImages;
  const framePadMm = 2.5;
  const railImgW = 38;
  const railW = sideRail ? railImgW + 2 * framePadMm : 0;
  const railGap = 4;
  // Study title uses full width; body text narrows when a rail is present.
  const textW = sideRail ? Math.max(90, contentW - railW - railGap) : contentW;
  const railX = pageW - m.right - railW;
  let railBottomY = 0;

  // ── STUDY TITLE (centered, underlined) — left of rail when images exist ──
  const title = (report.reportTitle || "Radiology Report").trim().toUpperCase();
  doc.setFont(font, "bold");
  doc.setFontSize(fs.title);
  doc.setTextColor(0, 0, 0);
  // Title baseline after demography gap; center in the text column (not under rail).
  const titleCenterX = sideRail ? m.left + textW / 2 : pageW / 2;
  doc.text(title, titleCenterX, y, { align: "center", maxWidth: textW });
  const titleW = Math.min(doc.getTextWidth(title), textW);
  doc.setLineWidth(0.45);
  doc.line(titleCenterX - titleW / 2, y + 0.9, titleCenterX + titleW / 2, y + 0.9);
  y += lineH + 3.2;

  // ── DOCUMENTED REPORTING REGION, under the booked heading ──
  // Printed only when a region transition is on the record; a report nobody has
  // re-regioned exports exactly the bytes it always did.
  const scopeNote = (report.reportingScopeNote ?? "").trim();
  if (scopeNote) {
    doc.setFont(font, "italic");
    doc.setFontSize(fs.body - 1);
    doc.setTextColor(90, 90, 90);
    const scopeLines = doc.splitTextToSize(scopeNote, textW) as string[];
    doc.text(scopeLines, titleCenterX, y, { align: "center" });
    y += scopeLines.length * lineH * 0.7 + 1.2;
    doc.setFont(font, "normal");
    doc.setTextColor(0, 0, 0);
  }

  // Reserve a strip above the services bar for name + degree so signature
  // never orphans alone onto page 2 and never overlaps the KEY IMAGES rail.
  const SIG_RESERVE_MM = settings.signature.enabled ? 12 : 0;
  // Services bar is parked near the page edge (barH 10 + discPad 4).
  const FOOTER_STACK_MM = 14;
  const contentBottom = pageH - FOOTER_STACK_MM - SIG_RESERVE_MM;

  // Draw KEY IMAGES on page 1 immediately (below demography / beside title+body).
  // Pixels that will not decode are found here, before anything is drawn, so the
  // integrity line at the top of the page can name every attachment that failed
  // rather than only the ones the loop happened to trip over.
  let railDrawn = 0;
  if (sideRail) {
    for (const cell of keyImageList) {
      if (!cell.src) continue;
      try {
        doc.getImageProperties(cell.src);
      } catch {
        cell.unreadable = true;
        cell.src = "";
      }
    }
    const unreadable = keyImageList.filter((c) => c.unreadable).length;
    if (unreadable > 0) {
      const which = keyImageList
        .map((c, i) => ({ c, ordinal: i + 1 }))
        .filter(({ c }) => c.unreadable)
        .map(({ c, ordinal }) =>
          `#${ordinal}${c.attachmentId != null ? ` (attachment ${c.attachmentId})` : ""}` +
          `${c.sopInstanceUid ? ` SOP ${c.sopInstanceUid}` : ""}`)
        .join("; ");
      doc.setFont(font, "bold");
      doc.setFontSize(fs.body - 0.5);
      doc.setTextColor(185, 28, 28);
      // Whether anyone captioned the failed attachments is a fact about the stored
      // rows, not a guess: a caption entered for an unreadable image is still
      // printed, so the line must not claim the opposite of what the page shows.
      const captioned = keyImageList.some((c) => c.unreadable && c.caption !== "");
      const warn =
        `INTEGRITY: ${unreadable} of ${keyImageList.length} key images could not be read ` +
        `and are shown as placeholders — ${which}.` +
        (captioned ? " Their captions are printed as entered." : " No caption has been written for them.");
      const warnLines = doc.splitTextToSize(warn, textW) as string[];
      doc.text(warnLines, m.left, y + lineH * 0.8);
      y += warnLines.length * lineH * 0.8 + lineH * 0.4;
      doc.setTextColor(0, 0, 0);
    }
    const rail = drawSideRailKeyImages(
      doc, keyImageList, railX, railW, demographyBottomY, contentBottom, font, fs.heading,
    );
    railBottomY = rail.bottomY;
    railDrawn = rail.drawn;
    // Body continues on page 1; the rail must not move the text cursor.
  }

  /** Page index (1-based) where the report body last drew — signature stays here. */
  let bodyPage = 1;

  const ensureSpace = (needed: number): number => {
    if (y + needed > contentBottom) {
      doc.addPage();
      y = drawLetterPadChrome();
      bodyPage = doc.getNumberOfPages();
    }
    return y;
  };
  /** Narrow beside rail on page 1; full width after page break. */
  const colW = () => (sideRail && bodyPage === 1 ? textW : contentW);

  for (const section of settings.layout) {
    if (!settings.show[section]) continue;
    if (section === "patientBox") continue; // already drawn above title

    switch (section) {
      case "clinicalHistory": {
        if (!report.clinicalHistory?.trim()) break;
        y = ensureSpace(12);
        y = drawSectionHeading(doc, "CLINICAL HISTORY:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, normalizeReportPlainText(report.clinicalHistory.trim()), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
        y += lineH * 0.55;
        break;
      }
      case "technique": {
        if (!report.technique?.trim()) break;
        y = ensureSpace(12);
        y = drawSectionHeading(doc, "TECHNIQUE:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, normalizeReportPlainText(report.technique.trim()), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
        y += lineH * 0.55;
        break;
      }
      case "comparison": {
        if (!report.comparison?.trim()) break;
        y = ensureSpace(12);
        y = drawSectionHeading(doc, "COMPARISON:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, normalizeReportPlainText(report.comparison.trim()), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
        y += lineH * 0.55;
        break;
      }
      case "measurements": {
        if (!report.measurements || report.measurements.length === 0) break;
        y = ensureSpace(28);
        y = drawSectionHeading(doc, "MEASUREMENTS:", m.left, y, font, fs.heading);
        autoTable(doc, {
          startY: y,
          head: [["Measurement", "Value"]],
          body: report.measurements.map((row) => [row.label, row.value]),
          styles: { fontSize: fs.body - 0.5, font, cellPadding: 1.1 },
          headStyles: { fillColor: [241, 245, 249], textColor: [0, 0, 0], fontStyle: "bold" },
          margin: {
            left: m.left,
            right: m.right + (sideRail && bodyPage === 1 ? railW + railGap : 0),
          },
          tableWidth: "auto",
        });
        y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20) + 3;
        break;
      }
      case "findings": {
        if (!report.findings?.trim()) break;
        y = ensureSpace(16);
        y = drawSectionHeading(doc, "FINDINGS:", m.left, y, font, fs.heading);
        y = drawFindingsBlock(doc, report.findings.trim(), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
        y += lineH * 0.4;
        break;
      }
      case "keyImages": {
        // Side rail already drew what fitted beside page 1's body. Everything the
        // radiologist selected beyond that continues here, in order, adding pages
        // as needed — this used to be a no-op, which is how a 14-image study
        // exported 5 images with nothing on the page to say so.
        if (!sideRail) break;
        const rest = keyImageList.slice(railDrawn);
        if (rest.length === 0) break;
        y = drawContinuedKeyImages(doc, rest, {
          left: m.left,
          contentW,
          contentBottom,
          font,
          headingSize: fs.heading,
          firstOrdinal: railDrawn + 1,
          railBottomY,
          onPage: () => bodyPage,
          ensureRoom: (needed, at) => {
            if (at + needed > contentBottom) {
              doc.addPage();
              y = drawLetterPadChrome();
              bodyPage = doc.getNumberOfPages();
              return y;
            }
            return at;
          },
        }, y).y;
        break;
      }
      case "impression": {
        if (!report.impression?.trim()) break;
        y = ensureSpace(14);
        y = drawSectionHeading(doc, "IMPRESSION:", m.left, y, font, fs.heading);
        y = drawNumberedImpression(doc, normalizeReportPlainText(report.impression.trim()), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
        y += lineH * 0.4;
        break;
      }
      case "recommendation": {
        if (!report.recommendation?.trim()) break;
        y = ensureSpace(12);
        y = drawSectionHeading(doc, "RECOMMENDATION:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, normalizeReportPlainText(report.recommendation.trim()), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
        y += lineH * 0.4;
        break;
      }
    }
  }

  // Do not re-draw the rail or push body Y from railBottomY — that parked
  // images/impression overlaps onto page 2 in long reports.

  // ── SIGNATURE — flush right, immediately above the blue services bar.
  // Never flow under mid-page content beside the KEY IMAGES rail (that overlaps
  // the image stack). Never call ensureSpace here: that orphaned name/degree
  // onto a blank page 2.
  if (settings.signature.enabled) {
    const sig = { ...settings.signature };
    // Prefer Settings → Doctors.degree when the signing name uniquely matches.
    const catalogDegree = resolveDoctorDegreeFromCatalog(sig.name, opts?.doctorsCatalog);
    if (catalogDegree) sig.qualification = catalogDegree;
    else if (!sig.qualification?.trim() && pad.credentials) sig.qualification = pad.credentials;

    doc.setPage(bodyPage);
    // Blue bar sits near the page bottom; signature stays just above it.
    const barH = 10;
    const discPad = 4; // mm reserved under the bar for the disclaimer line
    const footerTop = pageH - barH - discPad;
    const hasDetails =
      (sig.showQualification && !!sig.qualification) ||
      (sig.showRegistrationNo && !!sig.registrationNo);
    // Name + optional degree baselines; last line sits ~1.0mm above the blue bar.
    const GAP_ABOVE_BAR_MM = 1.0;
    const textBlockH = lineH + (hasDetails ? lineH : 0);
    const imageH = sig.imageDataUrl ? 12 : 0;
    let sigY = footerTop - GAP_ABOVE_BAR_MM - textBlockH - imageH;
    const sigRight = pageW - m.right;

    if (sig.imageDataUrl) {
      try {
        doc.addImage(sig.imageDataUrl, "PNG", sigRight - 54, sigY, 36, 14);
        sigY += 12;
      } catch { /* skip */ }
    }

    doc.setFont(font, "bold");
    doc.setFontSize(fs.body + 0.5);
    doc.setTextColor(185, 28, 28);
    doc.text(sig.name, sigRight, sigY, { align: "right" });
    sigY += lineH;

    doc.setTextColor(20, 20, 20);
    doc.setFont(font, "normal");
    doc.setFontSize(fs.body - 0.5);
    const details: string[] = [];
    if (sig.showQualification && sig.qualification) details.push(sig.qualification);
    if (sig.showRegistrationNo && sig.registrationNo) details.push(`Reg. No: ${sig.registrationNo}`);
    if (details.length) {
      doc.text(details.join(", "), sigRight, sigY, { align: "right" });
      sigY += lineH;
    }
    y = Math.max(y, sigY);
  }

  // ── SERVICES BAR + DISCLAIMER (every page) — letter-pad two-row navy strip ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const serviceLines = (pad.servicesRow1 && pad.servicesRow2
      ? `${pad.servicesRow1}\n${pad.servicesRow2}`
      : settings.footer.servicesBar || "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const barH = serviceLines.length > 1 ? 10 : 7;
    const discPad = 4;
    // Park the navy strip near the physical page bottom (signature rides above it).
    const barY = pageH - barH - discPad;
    if (settings.footer.enabled && serviceLines.length > 0) {
      // Same bar height; larger bold white type for print clarity on the navy strip.
      doc.setFillColor(10, 50, 130); // richer navy — prints clearer than near-black blue
      doc.rect(0, barY, pageW, barH, "F");
      doc.setFont(font, "bold");
      doc.setFontSize(serviceLines.length > 1 ? 7.0 : 7.5);
      doc.setTextColor(255, 255, 255);
      const rowGap = serviceLines.length > 1 ? 3.8 : 0;
      // Vertically center the two rows inside the fixed bar height.
      const startY = barY + (serviceLines.length > 1 ? 3.8 : 4.6);
      serviceLines.forEach((line, idx) => {
        doc.text(line, pageW / 2, startY + idx * rowGap, { align: "center", maxWidth: pageW - 5 });
      });
    }
    if (settings.footer.enabled && (pad.disclaimer || settings.footer.disclaimer)) {
      doc.setFont(font, "normal");
      doc.setFontSize(fs.disclaimer - 0.5);
      doc.setTextColor(30, 30, 30);
      const discY = barY + barH + 2.0;
      const discLines = doc.splitTextToSize(pad.disclaimer || settings.footer.disclaimer, contentW) as string[];
      doc.text(discLines.slice(0, 2), pageW / 2, discY, { align: "center" });
    }
    if (settings.footer.enabled && settings.footer.showPageNumber) {
      doc.setFont(font, "normal");
      doc.setFontSize(fs.disclaimer);
      doc.setTextColor(80, 80, 80);
      doc.text(`Page ${i} of ${pageCount}`, pageW - m.right, pageH - 3, { align: "right" });
    }
  }

  // ── WATERMARK ──
  if (settings.watermark) {
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(40);
      doc.setTextColor(200, 200, 200);
      doc.setFont(font, "bold");
      doc.text(settings.watermark, pageW / 2, pageH / 2, { align: "center", angle: 45 });
      doc.setTextColor(0, 0, 0);
    }
  }

  const filename = (report.accessionNumber || report.patientName || "report")
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .toLowerCase();
  if (opts?.save !== false) {
    doc.save(`${filename}.pdf`);
  }
  return doc;
}
