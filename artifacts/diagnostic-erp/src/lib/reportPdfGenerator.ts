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
import {
  resolveCareLetterpadChrome,
  parseMeasurementMm,
  parseMeasurementPt,
  type CareLetterpadChrome,
} from "./careLetterpadChrome";

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
    showAccession: boolean;
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
  fontSize: "small",
  fontFamily: "helvetica",
  margins: { top: 8, bottom: 30, left: 14, right: 14 },
  header: {
    enabled: true,
    title: "CARE DIAGNOSTICS",
    logo: null,
    showDate: true,
    showAccession: false,
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
  /** Optional array of key-image data URLs (base64 JPEG/PNG) */
  keyImages?: string[];
  reportTitle?: string;
  printedBy?: string;
};

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

function formatReportDateShort(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}`;
  }
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}/${d.getFullYear()}`;
    }
  } catch { /* fall through */ }
  return raw;
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
): number {
  doc.setFont(font, "normal");
  doc.setFontSize(size);
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(text, maxW) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}

/** Findings may contain "LABEL: body" lines — bold the label like the letter pad. */
function drawFindingsBlock(
  doc: jsPDF,
  findings: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
): number {
  const paragraphs = findings.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    const m = para.match(/^([A-Z][A-Z0-9 /&().-]{1,48}):\s*([\s\S]*)$/);
    if (m) {
      const label = `${m[1]}:`;
      const rest = m[2].trim();
      doc.setFont(font, "bold");
      doc.setFontSize(bodySize);
      doc.setTextColor(0, 0, 0);
      doc.text(label, x, y);
      const labelW = doc.getTextWidth(label) + 1.2;
      doc.setFont(font, "normal");
      if (rest) {
        const lines = doc.splitTextToSize(rest, Math.max(20, maxW - labelW)) as string[];
        doc.text(lines[0] ?? "", x + labelW, y);
        y += lineH;
        for (let i = 1; i < lines.length; i++) {
          doc.text(lines[i], x, y);
          y += lineH;
        }
      } else {
        y += lineH;
      }
    } else {
      y = drawWrappedBody(doc, para, x, y, maxW, font, bodySize, lineH);
    }
    y += lineH * 0.35;
  }
  return y;
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
): number {
  const rawLines = impression.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const items = rawLines.map((l, i) => {
    if (/^\d+[.)]\s*/.test(l)) return l.replace(/^\d+[.)]\s*/, "");
    return l;
  });
  items.forEach((item, i) => {
    const prefix = `${i + 1}. `;
    doc.setFont(font, "normal");
    doc.setFontSize(bodySize);
    const lines = doc.splitTextToSize(item, maxW - doc.getTextWidth(prefix)) as string[];
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

/** Key images beside report text (letter-pad side rail) — square ports, no stretch. */
function drawSideRailKeyImages(
  doc: jsPDF,
  images: string[],
  railX: number,
  railW: number,
  startY: number,
  contentBottom: number,
  font: string,
  headingSize: number,
): number {
  if (images.length === 0 || railW <= 8) return startY;
  const gap = 1.4;
  const headingH = 5;
  const avail = Math.max(20, contentBottom - startY - headingH);
  // Square cells sized to rail width; cap so they fit on page 1 with the report.
  const square = Math.min(railW - 0.5, 32);
  const maxCells = Math.max(1, Math.floor((avail + gap) / (square + gap)));
  const shown = images.slice(0, Math.min(images.length, maxCells));
  let imgY = startY;
  doc.setFont(font, "bold");
  doc.setFontSize(headingSize - 0.5);
  doc.setTextColor(0, 0, 0);
  doc.text("KEY IMAGES", railX, imgY);
  imgY += headingH;
  for (const img of shown) {
    if (!img) continue;
    try {
      const ext = img.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
      // Square black port; letterbox the frame (contain) so MRI slices are not
      // horizontally stretched to fill the rail width.
      doc.setFillColor(0, 0, 0);
      doc.rect(railX, imgY, square, square, "F");
      const props = doc.getImageProperties(img);
      const iw = Math.max(1, props.width);
      const ih = Math.max(1, props.height);
      const scale = Math.min(square / iw, square / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const ox = railX + (square - dw) / 2;
      const oy = imgY + (square - dh) / 2;
      doc.addImage(img, ext, ox, oy, dw, dh);
      imgY += square + gap;
    } catch { /* skip broken image */ }
  }
  return imgY;
}

export function generateReportPDF(
  report: ReportData,
  settings: PrintSettings,
  clinic: PrintClinic,
  opts?: { save?: boolean; letterhead?: CareLetterpadChrome },
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
        doc.addImage(CARE_LETTERHEAD_LOGO_DATA_URL, "PNG", leftX, cursor, logoW, logoH, undefined, "NONE");
        headerBottom = cursor + logoH;
        logoDrawn = true;
      } catch {
        logoDrawn = false;
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
      const rightEdge = pageW - m.right;
      const name = (report.patientName || "").trim().toUpperCase();
      const refBy = (report.referringDoctor || "").trim().toUpperCase();
      const ageSex = ageSexLine(report.age, report.sex).toUpperCase();
      const dateStr = formatReportDateShort(report.studyDate);

      if (name) {
        doc.setFont(font, "bold");
        doc.text("NAME:", leftX, cursor);
        doc.setFont(font, "normal");
        doc.text(name, leftX + doc.getTextWidth("NAME: ") + 1, cursor, {
          maxWidth: Math.max(40, rightEdge - leftX - 55),
        });
      }

      if (ageSex) {
        doc.setFont(font, "bold");
        const label = "AGE/SEX: ";
        const full = `${label}${ageSex}`;
        doc.text(full, rightEdge, cursor, { align: "right" });
      }
      if (name || ageSex) cursor += lineH + 0.8;

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
      if (refBy || (settings.header.showDate !== false && dateStr)) cursor += lineH + 0.8;
      cursor += 1.5;

      doc.setDrawColor(0);
      doc.setLineWidth(0.55);
      doc.line(m.left, cursor, pageW - m.right, cursor);
      doc.setLineWidth(0.25);
      doc.line(m.left, cursor + 1.1, pageW - m.right, cursor + 1.1);
      cursor += 5;
    }
    return cursor;
  };

  y = drawLetterPadChrome();

  // ── STUDY TITLE (centered, underlined) ──
  const title = (report.reportTitle || "Radiology Report").trim().toUpperCase();
  doc.setFont(font, "bold");
  doc.setFontSize(fs.title);
  doc.setTextColor(0, 0, 0);
  doc.text(title, pageW / 2, y, { align: "center" });
  const titleW = doc.getTextWidth(title);
  doc.setLineWidth(0.45);
  doc.line(pageW / 2 - titleW / 2, y + 0.9, pageW / 2 + titleW / 2, y + 0.9);
  y += lineH + 2.5;

  const contentBottom = pageH - m.bottom - 18;

  const keyImageList = (report.keyImages ?? []).filter(Boolean);
  const sideRail =
    keyImageList.length > 0 && settings.show.keyImages;
  const textW = sideRail ? contentW * 0.62 : contentW;
  const railW = sideRail ? contentW - textW - 3 : 0;
  const railX = pageW - m.right - railW;
  let railStartY = 0;
  let railBottomY = 0;

  const ensureSpace = (needed: number) => {
    if (y + needed > contentBottom) {
      doc.addPage();
      y = drawLetterPadChrome();
    }
  };

  for (const section of settings.layout) {
    if (!settings.show[section]) continue;
    if (section === "patientBox") continue; // already drawn above title

    switch (section) {
      case "clinicalHistory": {
        if (!report.clinicalHistory?.trim()) break;
        ensureSpace(12);
        y = drawSectionHeading(doc, "CLINICAL HISTORY:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, report.clinicalHistory.trim(), m.left, y, textW, font, fs.body, lineH);
        y += lineH * 0.55;
        break;
      }
      case "technique": {
        if (!report.technique?.trim()) break;
        ensureSpace(12);
        y = drawSectionHeading(doc, "TECHNIQUE:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, report.technique.trim(), m.left, y, textW, font, fs.body, lineH);
        y += lineH * 0.55;
        break;
      }
      case "comparison": {
        if (!report.comparison?.trim()) break;
        ensureSpace(12);
        y = drawSectionHeading(doc, "COMPARISON:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, report.comparison.trim(), m.left, y, textW, font, fs.body, lineH);
        y += lineH * 0.55;
        break;
      }
      case "measurements": {
        if (!report.measurements || report.measurements.length === 0) break;
        ensureSpace(28);
        y = drawSectionHeading(doc, "MEASUREMENTS:", m.left, y, font, fs.heading);
        autoTable(doc, {
          startY: y,
          head: [["Measurement", "Value"]],
          body: report.measurements.map((row) => [row.label, row.value]),
          styles: { fontSize: fs.body - 0.5, font, cellPadding: 1.1 },
          headStyles: { fillColor: [241, 245, 249], textColor: [0, 0, 0], fontStyle: "bold" },
          margin: { left: m.left, right: m.right },
          tableWidth: "auto",
        });
        y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20) + 3;
        break;
      }
      case "findings": {
        if (!report.findings?.trim()) break;
        ensureSpace(16);
        if (sideRail && railStartY === 0) railStartY = y;
        y = drawSectionHeading(doc, "FINDINGS:", m.left, y, font, fs.heading);
        y = drawFindingsBlock(doc, report.findings.trim(), m.left, y, textW, font, fs.body, lineH);
        y += lineH * 0.4;
        break;
      }
      case "keyImages": {
        // Side rail drawn once after the body loop (aligned with findings).
        break;
      }
      case "impression": {
        if (!report.impression?.trim()) break;
        ensureSpace(14);
        y = drawSectionHeading(doc, "IMPRESSION:", m.left, y, font, fs.heading);
        y = drawNumberedImpression(doc, report.impression.trim(), m.left, y, textW, font, fs.body, lineH);
        y += lineH * 0.4;
        break;
      }
      case "recommendation": {
        if (!report.recommendation?.trim()) break;
        ensureSpace(12);
        y = drawSectionHeading(doc, "RECOMMENDATION:", m.left, y, font, fs.heading);
        y = drawWrappedBody(doc, report.recommendation.trim(), m.left, y, textW, font, fs.body, lineH);
        y += lineH * 0.4;
        break;
      }
    }
  }

  if (sideRail) {
    const railTop = railStartY > 0 ? railStartY : y;
    railBottomY = drawSideRailKeyImages(
      doc, keyImageList, railX, railW, railTop, contentBottom, font, fs.heading,
    );
    y = Math.max(y, railBottomY);
  }

  // ── SIGNATURE (right, doctor name in red) — sits under report body, not
  // forced to the page foot (that left a large empty dead zone on short reports).
  if (settings.signature.enabled) {
    const sig = settings.signature;
    ensureSpace(28);
    y += 10;
    const sigRight = pageW - m.right;

    if (sig.imageDataUrl) {
      try {
        doc.addImage(sig.imageDataUrl, "PNG", sigRight - 54, y, 36, 14);
        y += 12;
      } catch { /* skip */ }
    } else {
      y += 6;
    }

    doc.setFont(font, "bold");
    doc.setFontSize(fs.body + 0.5);
    doc.setTextColor(185, 28, 28);
    doc.text(sig.name, sigRight, y, { align: "right" });
    y += lineH;

    doc.setTextColor(20, 20, 20);
    doc.setFont(font, "normal");
    doc.setFontSize(fs.body - 0.5);
    const details: string[] = [];
    if (sig.showQualification && sig.qualification) details.push(sig.qualification);
    if (sig.showRegistrationNo && sig.registrationNo) details.push(`Reg. No: ${sig.registrationNo}`);
    if (details.length) {
      doc.text(details.join(", "), sigRight, y, { align: "right" });
      y += lineH;
    }
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
    const barY = pageH - m.bottom + 1;
    if (settings.footer.enabled && serviceLines.length > 0) {
      doc.setFillColor(15, 45, 110);
      doc.rect(0, barY, pageW, barH, "F");
      doc.setFont(font, "bold");
      doc.setFontSize(5.4);
      doc.setTextColor(255, 255, 255);
      const rowGap = serviceLines.length > 1 ? 3.6 : 0;
      const startY = barY + (serviceLines.length > 1 ? 3.6 : 4.5);
      serviceLines.forEach((line, idx) => {
        doc.text(line, pageW / 2, startY + idx * rowGap, { align: "center", maxWidth: pageW - 6 });
      });
    }
    if (settings.footer.enabled && (pad.disclaimer || settings.footer.disclaimer)) {
      doc.setFont(font, "normal");
      doc.setFontSize(fs.disclaimer - 0.3);
      doc.setTextColor(30, 30, 30);
      const discY = barY + barH + 3.0;
      const discLines = doc.splitTextToSize(pad.disclaimer || settings.footer.disclaimer, contentW) as string[];
      doc.text(discLines, pageW / 2, discY, { align: "center" });
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
