import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx-js-style";
import { loadSummaryPdfOrientation, persistSummaryPdfOrientation, type PaperOrientation } from "@/lib/paperSize";
import type { SimpleLedgerRow } from "@/lib/reconciliationLedger";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Printer, FileText, FileSpreadsheet, FileType, Mail, Loader2,
  CheckCircle2, AlertCircle, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ExportSection = {
  title: string;
  /** [label, value] pairs. Label starting with "──" = section divider row. Empty label = blank row. */
  metrics: [string, string][];
  /** half = left/right column in 2-up grid; full = spans page width. Default: half. */
  layout?: "half" | "full";
};

export type ExportTable = {
  title: string;
  headers: string[];
  rows: (string | number)[][];
};

export type ExportConfig = {
  title: string;
  subtitle: string;
  sections: ExportSection[];
  tables: ExportTable[];
  /** Handwritten-style one-page ledger (optional — enables Simple export buttons). */
  simpleLedger?: SimpleLedgerRow[];
  clinicName?: string;
  logoDataUrl?: string | null;
};

export type ExportMode = "full" | "simple";

/** ASCII-safe INR for PDF/print (jsPDF standard fonts cannot render Rs symbol). */
export function formatExportAmount(n: number): string {
  const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `-Rs.${formatted}` : `Rs.${formatted}`;
}

/** Strip/replace Unicode that breaks jsPDF Helvetica rendering. */
function pdfSafeText(raw: string): string {
  return raw
    .replace(/\u20B9/g, "Rs.")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u2713/g, "OK")
    .replace(/\u2139/g, "i")
    .replace(/\u2192/g, "->")
    .replace(/\u00D7/g, "x");
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Row classification helpers ───────────────────────────────────────────────

function isSectionHeader(label: string) {
  return label.startsWith("──") || label.startsWith("--");
}
function isBlankRow(label: string, value: string) { return label === "" && value === ""; }
function isTotalRow(label: string) {
  const l = label.toLowerCase();
  return l.startsWith("total") || l.startsWith("expected") || l.startsWith("net ") ||
         l.startsWith("collectible") || l === "variance" || l.startsWith("billing cross");
}
function isDeductRow(label: string) {
  const l = label.toLowerCase();
  return l.startsWith("cancelled") || l.startsWith("refund") || l.startsWith("outstanding") ||
         l.startsWith("digital collection") || l.startsWith("cash expenses") || l.startsWith("less:");
}
function isInfoRow(label: string) {
  return label.toLowerCase().includes("discount") && label.toLowerCase().includes("info");
}
function isBalancedRow(label: string, value: string) {
  return label === "Variance" && value.includes("Balanced");
}
function isMismatchRow(label: string, value: string) {
  return label === "Variance" && !value.includes("Balanced");
}

/**
 * One ladder decides what a ledger row *means*, and the PDF, the .doc and the .xlsx all
 * read it from here. They used to each carry their own copy of the same `if` chain, which
 * is how a total could be heavy-ruled on paper and plain in the spreadsheet.
 * Precedence is deliberate: the answer row beats a balanced/mismatch colour, a deduction
 * beats a total, and both beat an info row.
 */
export type LedgerRowKind =
  | "blank" | "divider" | "final" | "balanced" | "mismatch" | "deduct" | "info" | "total" | "plain";

export function classifyLedgerRow(label: string, value: string): LedgerRowKind {
  if (isBlankRow(label, value)) return "blank";
  if (isSectionHeader(label)) return "divider";
  if (label === "Expected Physical Cash") return "final";
  if (isBalancedRow(label, value)) return "balanced";
  if (isMismatchRow(label, value)) return "mismatch";
  if (isDeductRow(label)) return "deduct";
  if (isInfoRow(label)) return "info";
  if (isTotalRow(label)) return "total";
  return "plain";
}

/** The little operator on the left of a ledger row: - for a deduction, = for an answer. */
export function ledgerRowSign(kind: LedgerRowKind): string {
  if (kind === "deduct") return "-";
  if (kind === "total" || kind === "final") return "=";
  if (kind === "info") return "i";
  return "";
}

/** Rule weight for a row: only `total` and `final` separate a formula from its answer. */
export function ledgerRowRule(kind: LedgerRowKind): "none" | "total" | "final" {
  if (kind === "final") return "final";
  if (kind === "total") return "total";
  return "none";
}

/** Compact ledger columns — label + value adjacent inside each box. */
const LEDGER_SIGN_MM = 3.5;
const LEDGER_VALUE_MM = 26;

const SECTION_ACCENT: Record<string, string> = {
  billing: "#0f766e",
  deduction: "#b91c1c",
  collection: "#1d4ed8",
  cash: "#0f172a",
  payment: "#4338ca",
  discount: "#b45309",
  reconciliation: "#334155",
  staff: "#475569",
};

function sectionAccent(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("billing")) return SECTION_ACCENT.billing;
  if (t.includes("deduction")) return SECTION_ACCENT.deduction;
  if (t.includes("collection")) return SECTION_ACCENT.collection;
  if (t.includes("cash")) return SECTION_ACCENT.cash;
  if (t.includes("payment")) return SECTION_ACCENT.payment;
  if (t.includes("discount")) return SECTION_ACCENT.discount;
  if (t.includes("reconciliation")) return SECTION_ACCENT.reconciliation;
  return SECTION_ACCENT.staff;
}

function sectionAccentRgb(title: string): [number, number, number] {
  const hex = sectionAccent(title).replace("#", "");
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function isFullWidthSection(sec: ExportSection): boolean {
  return sec.layout === "full" || /cash reconciliation/i.test(sec.title);
}

/** Word ignores CSS on data-URL images — fixed HTML width/height attributes are required. */
const HTML_LOGO_PX = 32;

function renderLogoImg(dataUrl: string, px = HTML_LOGO_PX): string {
  const src = escHtml(dataUrl);
  return `<img src="${src}" alt="" width="${px}" height="${px}"
    style="display:block;width:${px}px;height:${px}px;max-width:${px}px;max-height:${px}px;object-fit:contain;border:0" />`;
}

function renderReportHeader(config: ExportConfig, ts: string, compact = false): string {
  const logoPx = compact ? 26 : 30;
  const logoCell = config.logoDataUrl
    ? `<td valign="middle" style="width:${logoPx + 6}px;padding:0 0 0 ${compact ? 8 : 10}px;vertical-align:middle">
        ${renderLogoImg(config.logoDataUrl, logoPx)}
      </td>`
    : "";
  const brand = escHtml(config.clinicName ?? "Care Diagnostics ERP");
  const pad = compact ? "4pt 6pt" : "5pt 7pt";
  // Flat navy, not a gradient: Word and every email client drop `linear-gradient`
  // and leave the header unstyled, and the PDF already draws this band flat.
  return `<table cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;border-spacing:0;background:#0f172a;color:#ffffff;margin:0;padding:0">
    <tr>
      ${logoCell}
      <td valign="middle" style="padding:${pad};vertical-align:middle">
        <div style="font-size:${compact ? "10.5pt" : "12pt"};font-weight:700;color:#ffffff;line-height:1.25">${escHtml(config.title)}</div>
        <div style="font-size:${compact ? "6.5pt" : "7.5pt"};font-weight:700;color:#cbd5e1;margin-top:1pt">${escHtml(config.subtitle)}</div>
      </td>
      <td valign="middle" align="right" style="padding:${pad};text-align:right;vertical-align:middle;white-space:nowrap;font-size:6pt;line-height:1.4;color:#e2e8f0">
        <div>${brand}</div>
        <div>${escHtml(ts)}</div>
      </td>
    </tr>
  </table>`;
}

function loadLogoImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function fitLogoMm(naturalW: number, naturalH: number, maxW: number, maxH: number): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0) return { w: maxW, h: maxH };
  const scale = Math.min(maxW / naturalW, maxH / naturalH);
  return { w: naturalW * scale, h: naturalH * scale };
}

const PDF_LOGO_MAX_W_MM = 22;
const PDF_LOGO_MAX_H_MM = 11;

/**
 * px per mm of the size the logo is *drawn* at. The clinic's logo is a 512-1024 px file
 * that lands in a 22 mm box, so embedding it verbatim put ~2 MB of image in a one-page
 * PDF — measured on the operator's own Daily_Financial_Reconciliation_Simple.pdf:
 * 2,000,094 bytes for one page and one image. At ~100 dpi the eye cannot tell, and the
 * file is a fraction of the size.
 */
const PDF_LOGO_PX_PER_MM = 4;
const PDF_LOGO_MAX_PX = 160;

export function logoRasterTargetPx(drawnWmm: number, drawnHmm: number, pxPerMm = PDF_LOGO_PX_PER_MM): { w: number; h: number } {
  const rawW = Math.max(1, Math.round(drawnWmm * pxPerMm));
  const rawH = Math.max(1, Math.round(drawnHmm * pxPerMm));
  const cap = PDF_LOGO_MAX_PX / Math.max(rawW, rawH);
  if (cap >= 1) return { w: rawW, h: rawH };
  return { w: Math.max(1, Math.round(rawW * cap)), h: Math.max(1, Math.round(rawH * cap)) };
}

/** Downscales through a canvas. Returns null when there is no canvas (node), so the caller keeps the original. */
function rasteriseLogo(img: HTMLImageElement, w: number, h: number, format: "PNG" | "JPEG"): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return format === "JPEG" ? canvas.toDataURL("image/jpeg", 0.92) : canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

type PlacedPdfLogo = { url: string; format: "PNG" | "JPEG"; w: number; h: number };

async function preparePdfLogo(dataUrl: string): Promise<PlacedPdfLogo | null> {
  const img = await loadLogoImage(dataUrl);
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const format: "PNG" | "JPEG" = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
  const { w, h } = fitLogoMm(img.naturalWidth, img.naturalHeight, PDF_LOGO_MAX_W_MM, PDF_LOGO_MAX_H_MM);
  const target = logoRasterTargetPx(w, h);
  const needsScale = img.naturalWidth > target.w * 1.25 || img.naturalHeight > target.h * 1.25;
  const small = needsScale ? rasteriseLogo(img, target.w, target.h, format) : null;
  return { url: small ?? dataUrl, format, w, h };
}

function placePdfLogo(doc: jsPDF, logo: PlacedPdfLogo | null, x: number, bandH: number): number {
  if (!logo) return x;
  try {
    doc.addImage(logo.url, logo.format, x, (bandH - logo.h) / 2, logo.w, logo.h);
    return x + logo.w + 3;
  } catch {
    return x;
  }
}

/**
 * A4 header band. The tall one is page 1; the short one is redrawn on every continuation
 * page so a stacked printout never loses which day and which report it is.
 */
function drawPdfBand(
  doc: jsPDF,
  config: ExportConfig,
  ts: string,
  bandH: number,
  logo: PlacedPdfLogo | null,
): void {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_NAVY);
  doc.rect(0, 0, pageW, bandH, "F");
  doc.setFillColor(37, 99, 235);
  doc.rect(0, bandH, pageW, 1.2, "F");

  const titleX = placePdfLogo(doc, logo, PDF_MARGIN, bandH);
  const tall = bandH > 16;
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(tall ? 13.5 : 10);
  doc.text(pdfSafeText(config.title), titleX, tall ? 10 : 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(tall ? 8.5 : 7);
  doc.text(pdfSafeText(config.subtitle), titleX, tall ? 15.5 : 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(tall ? 7.5 : 6.5);
  doc.text(pdfSafeText(config.clinicName ?? "Care Diagnostics ERP"), pageW - PDF_MARGIN, tall ? 9 : 5.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(tall ? 7 : 6.5);
  doc.text(pdfSafeText(ts), pageW - PDF_MARGIN, tall ? 14 : 10, { align: "right" });
}

function drawPdfFooter(doc: jsPDF, ts: string, page: number, total: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const ruleY = pageH - PDF_BOTTOM_BAND + 1.5;
  doc.setDrawColor(...PDF_RULE_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(PDF_MARGIN, ruleY, pageW - PDF_MARGIN, ruleY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_GRY);
  doc.text(pdfSafeText(`Care Diagnostics ERP  |  Confidential  |  ${ts}`), PDF_MARGIN, pageH - 5);
  doc.setFontSize(6.5);
  doc.text(pdfSafeText(`Page ${page} of ${total}`), pageW - PDF_MARGIN, pageH - 5, { align: "right" });
}

/** A row whose first cell is a total label, in any of the detail tables. */
const TABLE_TOTAL_ROW_RE = /^(total|net\b|grand total|expected)/i;

function isTableTotalRow(table: ExportTable, rowIndex: number): boolean {
  if (rowIndex !== table.rows.length - 1) return false;
  return TABLE_TOTAL_ROW_RE.test(String(table.rows[rowIndex]?.[0] ?? "").trim());
}

type SimpleRowLook = {
  bg: string; border: string; labelColor: string; valueColor: string;
  labelWeight: string; valueWeight: string; valueSize: string; detailColor: string;
};

/** pt, not px: the simple ledger is read in Word and on paper, where px is a screen unit. */
function simpleRowStyle(kind: SimpleLedgerRow["kind"]): SimpleRowLook {
  switch (kind) {
    case "meta":
      return { bg: "#f8fafc", border: "0.5pt solid #cbd5e1", labelColor: "#334155", valueColor: "#0f172a",
        labelWeight: "700", valueWeight: "700", valueSize: "7.5pt", detailColor: "#64748b" };
    case "add":
      return { bg: "#ecfdf5", border: "0.5pt solid #86efac", labelColor: "#065f46", valueColor: "#15803d",
        labelWeight: "600", valueWeight: "700", valueSize: "8pt", detailColor: "#047857" };
    case "subtract":
      return { bg: "#fef2f2", border: "0.5pt solid #fecaca", labelColor: "#991b1b", valueColor: "#b91c1c",
        labelWeight: "600", valueWeight: "700", valueSize: "8pt", detailColor: "#b91c1c" };
    case "subtotal":
      return { bg: "#e2e8f0", border: "1.25pt solid #64748b", labelColor: "#0f172a", valueColor: "#0f172a",
        labelWeight: "800", valueWeight: "800", valueSize: "8.5pt", detailColor: "#475569" };
    case "total":
      return { bg: "#0f172a", border: "2pt solid #0f172a", labelColor: "#ffffff", valueColor: "#86efac",
        labelWeight: "800", valueWeight: "800", valueSize: "11pt", detailColor: "#cbd5e1" };
    case "note":
      return { bg: "#fffbeb", border: "0.5pt solid #fde68a", labelColor: "#92400e", valueColor: "#92400e",
        labelWeight: "600", valueWeight: "600", valueSize: "7pt", detailColor: "#b45309" };
    default:
      return { bg: "#ffffff", border: "0.5pt solid #cbd5e1", labelColor: "#1e293b", valueColor: "#0f172a",
        labelWeight: "600", valueWeight: "700", valueSize: "8pt", detailColor: "#64748b" };
  }
}

/**
 * Word, Print and Email share one renderer. Word is the binding constraint: it drops
 * `display:grid`, `linear-gradient`, `border-radius` and `overflow`, flattens every grid
 * cell into a stacked block, and inserts its own paragraph gap between them — that is the
 * blank space between tables in the .doc. Everything here is tables and inline styles, so
 * all three draw the same document, and the gaps below are the only ones any of them see.
 */

/** `tableTag` carries the reset Word needs; per-table styles are added on top of it. */
function tableTag(style = "", width = "100%"): string {
  // `width="460"` is a pixel count, but the CSS property needs a unit — Word reads the
  // attribute and a browser reads the declaration, so both have to be right.
  const css = /^\d+$/.test(width) ? `${width}px` : width;
  return `<table cellpadding="0" cellspacing="0" border="0" width="${width}" `
    + `style="width:${css};border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0;padding:0;${style}">`;
}

function gapRow(pt: number): string {
  return `<tr><td colspan="2" style="height:${pt}pt;line-height:${pt}pt;font-size:1pt;border:0;padding:0;color:#ffffff">&nbsp;</td></tr>`;
}

/** Between top-level tables, where Word collapses a div margin but honours a row height. */
function spacerBlock(pt: number): string {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-spacing:0;margin:0;padding:0">`
    + `<tr><td style="height:${pt}pt;line-height:${pt}pt;font-size:1pt;border:0;padding:0;color:#ffffff">&nbsp;</td></tr></table>`;
}

function renderSimpleLedgerTable(rows: SimpleLedgerRow[]): string {
  const body = rows.map((row) => {
    if (row.kind === "blank") return gapRow(2.5);
    const st = simpleRowStyle(row.kind);
    const detail = row.detail
      ? `<div style="font-size:6pt;color:${st.detailColor};margin-top:0.5pt">${escHtml(pdfSafeText(row.detail))}</div>`
      : "";
    return `<tr>
      <td style="background:${st.bg};border:${st.border};color:${st.labelColor};font-weight:${st.labelWeight};font-size:7.5pt;padding:2.5pt 5pt;vertical-align:middle;width:62%">${escHtml(pdfSafeText(row.label))}${detail}</td>
      <td align="right" style="background:${st.bg};border:${st.border};color:${st.valueColor};font-weight:${st.valueWeight};font-size:${st.valueSize};text-align:right;padding:2.5pt 5pt;white-space:nowrap;vertical-align:middle">${escHtml(pdfSafeText(row.value))}</td>
    </tr>`;
  }).join("");

  return tableTag(`border:1.5pt solid #0f172a;page-break-inside:avoid`, "100%")
    + `<tbody>${body}`
    + `<tr><td colspan="2" style="border:0;padding:3pt 4pt;font-size:6pt;color:#64748b;text-align:center">`
    +   `Bills + Old Dues - (Cancel+Refund+Outstanding) - Digital = Cash in counter</td></tr>`
    + `</tbody></table>`;
}

function renderReportFooter(config: ExportConfig, ts: string): string {
  return tableTag(`border-top:1pt solid #94a3b8`)
    + `<tr><td style="padding:2.5pt 0 0;font-size:6pt;color:#64748b;border:0">Care Diagnostics ERP - Confidential</td>`
    + `<td align="right" style="padding:2.5pt 0 0;font-size:6pt;color:#64748b;text-align:right;border:0">${escHtml(config.clinicName ?? "Care Diagnostics ERP")} | ${escHtml(ts)}</td></tr></table>`;
}

function renderLedgerRow([label, value]: [string, string]): string {
  const safeLabel = escHtml(pdfSafeText(label));
  const safeValue = escHtml(pdfSafeText(value));
  const kind = classifyLedgerRow(label, value);

  if (kind === "blank") return gapRow(2);

  if (kind === "divider") {
    const title = pdfSafeText(label.replace(/^--\s*/, "").replace(/\s*--$/, "").trim());
    return `<tr><td colspan="3" style="background:${sectionAccent(title)};color:#ffffff;font-size:6.5pt;font-weight:700;letter-spacing:.3pt;padding:2pt 5pt;border:0;text-align:left">${escHtml(title.toUpperCase())}</td></tr>`;
  }

  // The rule above a total is what separates the formula from its answer. It is heavier
  // than every hairline around it, and the same weight in the PDF, the .doc and the .xlsx.
  // The answer row is a navy band — what the Simple ledger already does, so both modes
  // agree, and the pink/red tints now mean what they say (only Variance can be one).
  const rule = ledgerRowRule(kind);
  const onNavy = kind === "final";
  const emphasised = rule !== "none";

  const topRule    = rule === "final" ? "1.75pt solid #0f172a" : rule === "total" ? "1pt solid #334155" : "0.5pt solid #cbd5e1";
  const bottomRule = rule === "final" ? "1.75pt solid #0f172a" : "0.5pt solid #e2e8f0";

  const rowBg = onNavy         ? "#0f172a"
              : kind === "balanced" ? "#dcfce7"
              : kind === "mismatch" ? "#fee2e2"
              : kind === "total"    ? "#e2e8f0"
              : kind === "info"     ? "#fef3c7"
              : "#ffffff";

  const sign = ledgerRowSign(kind);
  const signColor = onNavy          ? "#ffffff"
    : kind === "deduct" ? "#b91c1c"
    : kind === "total"  ? "#0f172a"
    : kind === "info"   ? "#b45309"
    : "#64748b";

  const labelColor = onNavy          ? "#ffffff"
    : kind === "info"    ? "#92400e"
    : kind === "deduct"  ? "#991b1b"
    : kind === "total"   ? "#0f172a"
    : "#1f2937";

  const valueColor = onNavy          ? "#86efac"
    : kind === "balanced" ? "#15803d"
    : kind === "mismatch" ? "#b91c1c"
    : kind === "deduct"   ? "#b91c1c"
    : kind === "info"     ? "#92400e"
    : "#111827";

  return `<tr style="background:${rowBg}">
    <td valign="middle" style="width:9pt;background:${rowBg};text-align:center;color:${signColor};font-size:7pt;font-weight:700;padding:1.5pt 1pt;border-top:${topRule};border-bottom:${bottomRule};border-left:0;border-right:0;vertical-align:middle">${sign}</td>
    <td valign="middle" style="background:${rowBg};color:${labelColor};
      font-size:${onNavy ? "8.5pt" : "7.5pt"};font-weight:${emphasised ? "700" : "600"};padding:1.5pt 3pt;vertical-align:middle;line-height:1.25;
      border-top:${topRule};border-bottom:${bottomRule};border-left:0;border-right:0.5pt solid ${onNavy ? "#334155" : "#cbd5e1"}">${safeLabel}</td>
    <td valign="middle" align="right" style="background:${rowBg};font-size:${onNavy ? "9.5pt" : emphasised ? "8.5pt" : "8pt"};font-weight:700;color:${valueColor};
      text-align:right;padding:1.5pt 4pt 1.5pt 3pt;white-space:nowrap;vertical-align:middle;
      border-top:${topRule};border-bottom:${bottomRule};border-left:0;border-right:0">${safeValue}</td>
  </tr>`;
}

function renderSectionBox(sec: ExportSection): string {
  const accent = sectionAccent(sec.title);
  return tableTag(`border:1.25pt solid ${accent};page-break-inside:avoid;background:#ffffff`)
    + `<tbody>`
    + `<tr><td colspan="3" style="background:${accent};color:#ffffff;font-size:7pt;font-weight:700;letter-spacing:.3pt;padding:2.5pt 5pt;border:0;text-align:left">${escHtml(sec.title.toUpperCase())}</td></tr>`
    + sec.metrics.map((m) => renderLedgerRow(m)).join("")
    + `</tbody></table>`;
}

/** Two half-width boxes per row, paired exactly as the PDF pairs them. */
function renderSectionStack(sections: ExportSection[]): string {
  const halfRow = (left: ExportSection, right: ExportSection | null): string =>
      `<tr>`
    + `<td valign="top" width="50%" style="width:50%;padding:0 2pt 0 0;border:0;vertical-align:top">${renderSectionBox(left)}</td>`
    + `<td valign="top" width="50%" style="width:50%;padding:0 0 0 2pt;border:0;vertical-align:top">${right ? renderSectionBox(right) : "&nbsp;"}</td>`
    + `</tr>`;

  const rows: string[] = [];
  let pending: ExportSection | null = null;

  for (const sec of sections) {
    if (isFullWidthSection(sec)) {
      if (pending) { rows.push(halfRow(pending, null)); rows.push(gapRow(4)); pending = null; }
      rows.push(`<tr><td colspan="2" valign="top" style="padding:0;border:0;vertical-align:top">${renderSectionBox(sec)}</td></tr>`);
      rows.push(gapRow(4));
      continue;
    }
    if (!pending) { pending = sec; continue; }
    rows.push(halfRow(pending, sec));
    rows.push(gapRow(4));
    pending = null;
  }
  if (pending) { rows.push(halfRow(pending, null)); }

  return tableTag(`table-layout:fixed`) + `<tbody>${rows.join("")}</tbody></table>`;
}

function renderDataTable(table: ExportTable): string {
  const colCount = table.headers.length;
  const headerCells = table.headers.map((h) =>
    `<th style="padding:2.5pt 3pt;background:#1e293b;color:#ffffff;text-align:left;font-size:6.5pt;font-weight:700;border:0.5pt solid #0f172a;white-space:nowrap">${escHtml(pdfSafeText(h))}</th>`
  ).join("");

  const bodyRows = table.rows.map((row, i) => {
    const cells = row.map((cell, ci) => {
      const raw = pdfSafeText(String(cell));
      const isAmt = /^-?Rs\./.test(raw);
      return `<td valign="top" style="padding:1.5pt 3pt;font-size:7pt;background:${i % 2 === 0 ? "#f8fafc" : "#ffffff"};
        border:0.5pt solid #e2e8f0;text-align:${isAmt ? "right" : "left"};white-space:${isAmt ? "nowrap" : "normal"}">${escHtml(raw)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return tableTag(`border:1.25pt solid #0f172a`)
    + `<thead>`
    + `<tr><td colspan="${colCount}" style="background:#0f172a;color:#ffffff;font-size:7.5pt;font-weight:700;letter-spacing:.3pt;padding:2.5pt 5pt;border:0;text-align:left">${escHtml(pdfSafeText(table.title).toUpperCase())}</td></tr>`
    + `<tr>${headerCells}</tr>`
    + `</thead>`
    + `<tbody>${bodyRows}</tbody></table>`;
}

/** The report content, without any document shell — Print, Word and Email all use this. */
export function bodyHTML(config: ExportConfig, mode: ExportMode = "full"): string {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const header = renderReportHeader(config, ts, mode === "simple");

  if (mode === "simple") {
    return header + spacerBlock(5)
      + tableTag("", "460") + `<tr><td style="padding:0;border:0">` + renderSimpleLedgerTable(config.simpleLedger ?? []) + `</td></tr></table>`
      + spacerBlock(4) + renderReportFooter(config, ts);
  }

  const tables = config.tables.map((t) => renderDataTable(t)).join(spacerBlock(5));
  return header + spacerBlock(5)
    + renderSectionStack(config.sections)
    + spacerBlock(6)
    + tables
    + spacerBlock(4)
    + renderReportFooter(config, ts);
}

export function buildHTML(config: ExportConfig, mode: ExportMode = "full"): string {
  const title = escHtml(config.title) + (mode === "simple" ? " — Simple" : "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; margin: 0; padding: 8pt 10pt; color: #111827; font-size: 7.5pt; background: #fff; }
    table { border-collapse: collapse; }
    @media print {
      body { padding: 0; }
      @page { margin: 6mm 8mm; size: A4 portrait; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${bodyHTML(config, mode)}
</body>
</html>`;
}

/**
 * Word's own document envelope. Without the `WordSection1` page block a .doc opens in
 * Web Layout at the browser's margins, which is what made the exported report look like a
 * web page rather than a document; with it Word paginates A4 in Print Layout and repeats
 * table header rows across pages.
 */
export function buildWordDocument(config: ExportConfig, mode: ExportMode = "full"): string {
  const title = escHtml(config.title) + (mode === "simple" ? " — Simple" : "");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <meta name=ProgId content=Word.Document>
  <meta name=Generator content="Microsoft Word 15">
  <title>${title}</title>
  <!--[if gte mso 9]><xml>
    <o:DocumentSettings><o:RelyOnHTML/></o:DocumentSettings>
    <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
  </xml><![endif]-->
  <style>
    @page WordSection1 { size:595.3pt 841.9pt; margin:34pt 22.7pt 28pt 22.7pt; mso-header-margin:14pt; mso-footer-margin:14pt; }
    div.WordSection1 { page:WordSection1; }
    body, td, th, div, p { font-family:Calibri, Arial, sans-serif; font-size:7.5pt; color:#111827; margin:0; padding:0; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    tr { page-break-inside:avoid; }
  </style>
</head>
<body>
  <div class="WordSection1">
  ${bodyHTML(config, mode)}
  </div>
</body>
</html>`;
}

// ─── Print ────────────────────────────────────────────────────────────────────

function doPrint(config: ExportConfig, mode: ExportMode = "full") {
  const html = buildHTML(config, mode);
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups to use Print."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give browser time to parse CSS before print dialog opens
  setTimeout(() => { w.print(); }, 400);
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

const PDF_NAVY: [number, number, number] = [15, 23, 42];
const PDF_DARK: [number, number, number] = [15, 23, 42];
const PDF_RED:  [number, number, number] = [185, 28, 28];
const PDF_GRN:  [number, number, number] = [21, 128, 61];
const PDF_MINT: [number, number, number] = [134, 239, 172];
const PDF_AMB:  [number, number, number] = [180, 83, 9];
const PDF_GRY:  [number, number, number] = [100, 116, 139];
const PDF_RULE_LIGHT: [number, number, number] = [203, 213, 225];
const PDF_RULE_TOTAL: [number, number, number] = [51, 65, 85];

/** mm. Wider gutters than before so the page reads as a document, not a spreadsheet dump. */
const PDF_MARGIN = 10;
const PDF_GAP = 5;
const PDF_TOP_BAND = 20;
const PDF_BOTTOM_BAND = 14;

/**
 * Rules carry the hierarchy in every output: a hairline is a formula row, a heavy rule
 * above a line means that line is an answer. `totalRuleMm`/`finalRow` are what the PDF
 * draws; the HTML and xlsx renderers use the same two weights (1pt / 1.75pt).
 */
type PdfRowStyle = {
  fillColor?: [number, number, number];
  textColor?: [number, number, number];
  /** The answer column on a navy band reads green, not white — same as the on-screen ledger. */
  valueColor?: [number, number, number];
  fontStyle?: "bold" | "normal";
  fontSize?: number;
  totalRule?: boolean;
  finalRule?: boolean;
};

export function buildSectionTableData(section: ExportSection): { bodyRows: string[][]; rowStyles: PdfRowStyle[] } {
  const bodyRows: string[][] = [];
  const rowStyles: PdfRowStyle[] = [];

  for (const [label, value] of section.metrics) {
    const kind = classifyLedgerRow(label, value);

    if (kind === "blank") {
      bodyRows.push(["", "", ""]);
      rowStyles.push({ fillColor: [255, 255, 255] });
      continue;
    }
    if (kind === "divider") {
      const title = pdfSafeText(label.replace(/^[-\u2013\u2014]+\s*/, "").replace(/\s*[-\u2013\u2014]+$/, "").trim());
      bodyRows.push(["", title, ""]);
      rowStyles.push({ fillColor: sectionAccentRgb(title), textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 });
      continue;
    }

    const onNavy = kind === "final";
    const textCol: [number, number, number] = onNavy          ? [255, 255, 255]
      : kind === "balanced" ? PDF_GRN
      : kind === "mismatch" ? PDF_RED
      : kind === "deduct"   ? PDF_RED
      : kind === "info"     ? PDF_AMB
      : kind === "total"    ? PDF_DARK
      : [55, 65, 81];

    const fillCol: [number, number, number] | undefined = onNavy  ? PDF_NAVY
      : kind === "balanced" ? [220, 252, 231]
      : kind === "mismatch" ? [254, 226, 226]
      : kind === "total"    ? [226, 232, 240]
      : kind === "info"     ? [254, 243, 199]
      : undefined;

    const rule = ledgerRowRule(kind);
    bodyRows.push([ledgerRowSign(kind), pdfSafeText(label), pdfSafeText(value)]);
    rowStyles.push({
      fillColor: fillCol,
      textColor: textCol,
      valueColor: onNavy ? PDF_MINT : undefined,
      fontStyle: rule !== "none" ? "bold" : "normal",
      fontSize: onNavy ? 10.5 : kind === "total" ? 8.5 : 8,
      totalRule: rule === "total",
      finalRule: rule === "final",
    });
  }

  return { bodyRows, rowStyles };
}

function drawPdfSectionBox(
  doc: jsPDF,
  section: ExportSection,
  x: number,
  y: number,
  boxW: number,
): number {
  const accent = sectionAccentRgb(section.title);
  const boxTop = y;
  const headerH = 6.5;

  doc.setFillColor(...accent);
  doc.rect(x, y, boxW, headerH, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(pdfSafeText(section.title.toUpperCase()), x + 2.5, y + 4.4);
  y += headerH;

  // autoTable's `cellWidth` already contains the cell padding, so the three columns must
  // sum to the box width exactly. Subtracting the padding a second time — which is what the
  // old `- 4` did — makes the table wider than its own box and autoTable silently squeezes
  // the label column (it logs "units width could not fit page" once per section).
  const padX = 1.6;
  const labelW = Math.max(24, boxW - LEDGER_SIGN_MM - LEDGER_VALUE_MM);
  const { bodyRows, rowStyles } = buildSectionTableData(section);
  const pagesBefore = doc.getNumberOfPages();

  autoTable(doc, {
    startY: y,
    body: bodyRows,
    theme: "grid",
    tableWidth: boxW,
    styles: {
      fontSize: 8,
      cellPadding: { top: 0.9, bottom: 0.9, left: padX, right: padX },
      overflow: "linebreak",
      valign: "middle",
      lineColor: PDF_RULE_LIGHT,
      lineWidth: 0.12,
    },
    columnStyles: {
      0: { cellWidth: LEDGER_SIGN_MM, halign: "center", fontSize: 7.5, fontStyle: "bold" },
      1: { cellWidth: labelW },
      2: { halign: "right", fontStyle: "bold", cellWidth: LEDGER_VALUE_MM, overflow: "visible" },
    },
    margin: { left: x, right: doc.internal.pageSize.getWidth() - x - boxW, top: PDF_TOP_BAND, bottom: PDF_BOTTOM_BAND },
    didParseCell(data) {
      const rs = rowStyles[data.row.index];
      if (!rs) return;
      if (rs.fillColor) data.cell.styles.fillColor = rs.fillColor;
      if (rs.textColor) data.cell.styles.textColor = rs.textColor;
      if (rs.valueColor && data.column.index === 2) data.cell.styles.textColor = rs.valueColor;
      if (rs.fontStyle) data.cell.styles.fontStyle = rs.fontStyle;
      if (rs.fontSize)  data.cell.styles.fontSize  = rs.fontSize;
      // A total gets a heavy rule across the whole box, so the line between the formula
      // and its answer is impossible to miss at a glance on paper.
      if (rs.finalRule) {
        data.cell.styles.lineWidth = 0.9;
        data.cell.styles.lineColor = PDF_NAVY;
      } else if (rs.totalRule) {
        data.cell.styles.lineWidth = { top: 0.55, bottom: 0.12, left: 0.12, right: 0.12 };
        data.cell.styles.lineColor = PDF_RULE_TOTAL;
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  // Only frame the box if it stayed on one page: a split box's finalY belongs to the last
  // page it touched, and drawing from the original y to it paints a long rectangle across
  // the wrong page.
  if (doc.getNumberOfPages() === pagesBefore) {
    doc.setDrawColor(...accent);
    doc.setLineWidth(0.8);
    doc.rect(x, boxTop, boxW, finalY - boxTop);
  }
  return finalY - boxTop;
}

async function downloadPDF(config: ExportConfig, orientation: PaperOrientation, mode: ExportMode = "full"): Promise<void> {
  if (mode === "simple") {
    await downloadSimplePDF(config, orientation);
    return;
  }
  const doc = await buildSummaryPdf(config, orientation);
  doc.save(sanitizeFilename(config.title) + ".pdf");
}

/**
 * The full report as a jsPDF document, without saving it. Exported so a test can open the
 * real bytes: compression, page count and file size are not things a source-text grep can
 * honestly check, and the clinic's PDFs used to arrive at ~2 MB for a single page.
 */
export async function buildSummaryPdf(config: ExportConfig, orientation: PaperOrientation): Promise<jsPDF> {
  // compress: the page streams are deflated. Without it every page of text is stored raw.
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: config.title,
    subject: config.subtitle,
    author: config.clinicName ?? "Care Diagnostics ERP",
    creator: "Care Diagnostics ERP",
    keywords: "daily summary, cash reconciliation, billing",
  });
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const margin = PDF_MARGIN;
  const gap    = PDF_GAP;
  const ts     = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const fullW  = pageW - margin * 2;
  const halfW  = (fullW - gap) / 2;
  const contentBottom = pageH - PDF_BOTTOM_BAND;
  const contentTop = PDF_TOP_BAND + 2;

  const logo = config.logoDataUrl ? await preparePdfLogo(config.logoDataUrl) : null;
  drawPdfBand(doc, config, ts, PDF_TOP_BAND, logo);

  let y = contentTop;
  let pendingHalf: ExportSection | null = null;

  const newPage = () => {
    doc.addPage();
    y = contentTop;
    pendingHalf = null;
  };
  const ensureSpace = (needed: number) => { if (y + needed > contentBottom) newPage(); };

  for (const section of config.sections) {
    if (isFullWidthSection(section)) {
      // `ensureSpace` can start a new page, and starting one clears the pending half —
      // so the box to draw is captured first. Reading `pendingHalf` after the call is a
      // crash, not a style choice.
      const held = pendingHalf;
      if (held) {
        ensureSpace(40);
        const hPending = drawPdfSectionBox(doc, held, margin, y, halfW);
        y += hPending + gap;
        pendingHalf = null;
      }
      ensureSpace(50);
      const h = drawPdfSectionBox(doc, section, margin, y, fullW);
      y += h + gap;
      continue;
    }

    if (!pendingHalf) {
      pendingHalf = section;
      continue;
    }

    const heldPair = pendingHalf;
    ensureSpace(55);
    const hLeft  = drawPdfSectionBox(doc, heldPair, margin, y, halfW);
    const hRight = drawPdfSectionBox(doc, section, margin + halfW + gap, y, halfW);
    y += Math.max(hLeft, hRight) + gap;
    pendingHalf = null;
  }

  if (pendingHalf) {
    const held = pendingHalf;
    ensureSpace(40);
    const h = drawPdfSectionBox(doc, held, margin, y, halfW);
    y += h + gap;
  }

  const tableW = fullW;
  for (const table of config.tables) {
    if (y > contentBottom - 24) newPage();

    const boxTop = y;
    doc.setFillColor(...PDF_NAVY);
    doc.rect(margin, y, tableW, 6.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafeText(table.title.toUpperCase()), margin + 2.5, y + 4.4);
    y += 6.5;

    const amountCol = (header: string, value: string) =>
      /^-?Rs\./.test(value) || isAmountHeader(header);

    const pagesBeforeTable = doc.getNumberOfPages();

    autoTable(doc, {
      startY: y,
      head: [table.headers.map((h) => pdfSafeText(h))],
      body: table.rows.map((row) => row.map((cell) => pdfSafeText(String(cell)))),
      theme: "grid",
      tableWidth: tableW,
      styles: { fontSize: 7, cellPadding: { top: 1, bottom: 1, left: 1.6, right: 1.6 }, overflow: "linebreak", valign: "middle", lineColor: PDF_RULE_LIGHT, lineWidth: 0.12 },
      headStyles: { fillColor: PDF_NAVY, textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold", cellPadding: { top: 1.2, bottom: 1.2, left: 1.6, right: 1.6 } },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell(data) {
        if (data.section === "head") return;
        const header = table.headers[data.column.index] ?? "";
        const v = String(data.cell.raw ?? "");
        if (amountCol(header, v)) data.cell.styles.halign = "right";
        // Same rule weight as the ledger boxes: a total in a detail table answers the rows
        // above it, so it is separated from them, not merely bold.
        if (isTableTotalRow(table, data.row.index)) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [226, 232, 240];
          data.cell.styles.lineWidth = { top: 0.55, bottom: 0.12, left: 0.12, right: 0.12 };
          data.cell.styles.lineColor = PDF_RULE_TOTAL;
        }
      },
      margin: { left: margin, right: margin, top: PDF_TOP_BAND, bottom: PDF_BOTTOM_BAND },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    if (doc.getNumberOfPages() === pagesBeforeTable) {
      doc.setDrawColor(...PDF_NAVY);
      doc.setLineWidth(0.8);
      doc.rect(margin, boxTop, tableW, y - boxTop);
    }
    y += gap;
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    if (i > 1) drawPdfBand(doc, config, ts, 12, null);
    drawPdfFooter(doc, ts, i, totalPages);
  }

  return doc;
}

async function downloadSimplePDF(config: ExportConfig, orientation: PaperOrientation = "portrait"): Promise<void> {
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `${config.title} (Simple)`,
    subject: config.subtitle,
    author: config.clinicName ?? "Care Diagnostics ERP",
    creator: "Care Diagnostics ERP",
  });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const cardW = Math.min(120, pageW - margin * 2);
  const x = (pageW - cardW) / 2;
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  let y = margin;

  const logo = config.logoDataUrl ? await preparePdfLogo(config.logoDataUrl) : null;
  if (logo) {
    try {
      doc.addImage(logo.url, logo.format, x, y, logo.w, logo.h);
      y += logo.h + 2.5;
    } catch { /* no logo is not a reason to lose the ledger */ }
  }

  doc.setFillColor(...PDF_NAVY);
  doc.rect(x, y, cardW, 15.5, "F");
  doc.setFillColor(37, 99, 235);
  doc.rect(x, y + 15.5, cardW, 1.2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(pdfSafeText(config.title), x + 3, y + 6.5);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(pdfSafeText(config.subtitle), x + 3, y + 12);
  y += 19.5;

  const rows = config.simpleLedger ?? [];
  const bodyRows: string[][] = [];
  const rowStyles: PdfRowStyle[] = [];

  for (const row of rows) {
    if (row.kind === "blank") {
      bodyRows.push(["", ""]);
      rowStyles.push({});
      continue;
    }
    const isTotal = row.kind === "total";
    const isSub = row.kind === "subtotal";
    const isSubtr = row.kind === "subtract";
    const isNote = row.kind === "note";
    const label = row.detail ? `${row.label}\n(${row.detail})` : row.label;
    bodyRows.push([pdfSafeText(label), pdfSafeText(row.value)]);
    rowStyles.push({
      fillColor: isTotal ? PDF_NAVY
        : isSub ? [226, 232, 240]
        : isSubtr ? [254, 226, 226]
        : isNote ? [255, 251, 235]
        : row.kind === "add" ? [220, 252, 231]
        : undefined,
      textColor: isTotal ? [255, 255, 255] : isNote ? PDF_AMB : isSubtr ? PDF_RED : PDF_DARK,
      valueColor: isTotal ? PDF_MINT : undefined,
      fontStyle: isTotal || isSub ? "bold" : "normal",
      fontSize: isTotal ? 11.5 : isSub ? 9.5 : 8.5,
      totalRule: isSub,
      finalRule: isTotal,
    });
  }

  const pagesBeforeCard = doc.getNumberOfPages();
  autoTable(doc, {
    startY: y,
    body: bodyRows,
    theme: "grid",
    tableWidth: cardW,
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2.5, right: 2.5 },
      overflow: "linebreak",
      valign: "middle",
      lineColor: [148, 163, 184],
      lineWidth: 0.15,
    },
    columnStyles: {
      0: { cellWidth: cardW * 0.6 },
      1: { halign: "right", fontStyle: "bold", cellWidth: cardW * 0.4 },
    },
    margin: { left: x, right: pageW - x - cardW, top: 18, bottom: 16 },
    didParseCell(data) {
      const rs = rowStyles[data.row.index];
      if (!rs) return;
      if (rs.fillColor) data.cell.styles.fillColor = rs.fillColor;
      if (rs.textColor) data.cell.styles.textColor = rs.textColor;
      if (rs.fontStyle) data.cell.styles.fontStyle = rs.fontStyle;
      if (rs.fontSize)  data.cell.styles.fontSize  = rs.fontSize;
      if (rs.valueColor && data.column.index === 1) data.cell.styles.textColor = rs.valueColor;
      if (rs.finalRule) {
        data.cell.styles.lineWidth = { top: 1, bottom: 1, left: 0.15, right: 0.15 };
        data.cell.styles.lineColor = PDF_NAVY;
      } else if (rs.totalRule) {
        data.cell.styles.lineWidth = { top: 0.6, bottom: 0.15, left: 0.15, right: 0.15 };
        data.cell.styles.lineColor = PDF_RULE_TOTAL;
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  if (doc.getNumberOfPages() === pagesBeforeCard) {
    doc.setDrawColor(...PDF_NAVY);
    doc.setLineWidth(1);
    doc.rect(x, y, cardW, finalY - y);
  }

  const footY = finalY + 5;
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_GRY);
  doc.setFont("helvetica", "normal");
  doc.text(
    pdfSafeText("Bills + Old Dues - (Cancel+Refund+Outstanding) - Digital = Cash in counter"),
    pageW / 2,
    footY,
    { align: "center" },
  );
  doc.text(pdfSafeText(`${config.clinicName ?? "Care Diagnostics ERP"}  |  ${ts}`), pageW / 2, footY + 4, { align: "center" });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawPdfFooter(doc, ts, i, totalPages);
  }

  doc.save(sanitizeFilename(config.title) + "_Simple.pdf");
}

// ─── Excel ────────────────────────────────────────────────────────────────────

type XlStyle = NonNullable<XLSX.CellObject["s"]>;

/**
 * The writer is `xlsx-js-style`, not SheetJS Community. Community accepts a workbook and
 * silently throws away every `cell.s` — measured on the clinic's own
 * Daily_Financial_Reconciliation_Simple.xlsx: 2 fills, 1 border, 2 cellXfs, which is
 * exactly what a blank file carries. Same API, same cells, through this writer: 4 fills,
 * 6 borders, 8 cellXfs, and the sheet references them by index.
 */
const XL = {
  navy: "0F172A",
  band: "1E293B",
  white: "FFFFFF",
  muted: "64748B",
  alt: "F8FAFC",
  totalFill: "E2E8F0",
  addFill: "DCFCE7",
  subFill: "FEE2E2",
  noteFill: "FEF3C7",
  green: "15803D",
  red: "B91C1C",
  amber: "92400E",
  mint: "86EFAC",
};

/** Indian digit grouping — `##,##0` puts the separator where the clinic's screens do. */
const XL_MONEY = '"₹"##,##0';

const XL_EDGE = {
  hair:   { style: "hair",   color: { rgb: "E2E8F0" } },
  thin:   { style: "thin",   color: { rgb: "CBD5E1" } },
  medium: { style: "medium", color: { rgb: "334155" } },
  thick:  { style: "thick",  color: { rgb: "0F172A" } },
} as const;

const xlFill = (rgb: string) => ({ fgColor: { rgb }, patternType: "solid" as const });

/**
 * A currency string only. A bare digit string is NOT money — bill numbers, token numbers
 * and phone numbers live in these same tables, and turning one into a number drops its
 * leading zeros.
 */
export function parseMoneyCell(raw: unknown): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/[\u2212\u2013]/g, "-")
    .replace(/\u20B9/g, "Rs.");
  const m = s.match(/^(-?)\s*Rs\.\s*(-?[\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[1] === "-" || m[2].startsWith("-") ? -Math.abs(n) : n;
}

export function isAmountHeader(header: string): boolean {
  return /amount|discount|net|cash|gross|refund|due|expense|collected|billed/i.test(header);
}

function xlLedgerStyle(kind: LedgerRowKind): XlStyle {
  const rule = ledgerRowRule(kind);
  const onNavy = kind === "final";
  const textColor = onNavy             ? XL.white
    : kind === "deduct"   ? XL.red
    : kind === "info"     ? XL.amber
    : kind === "balanced" ? XL.green
    : kind === "mismatch" ? XL.red
    : kind === "total"    ? XL.navy
    : "1F2937";
  const fill = onNavy             ? xlFill(XL.navy)
    : kind === "balanced" ? xlFill(XL.addFill)
    : kind === "mismatch" ? xlFill(XL.subFill)
    : kind === "total"    ? xlFill(XL.totalFill)
    : kind === "info"     ? xlFill(XL.noteFill)
    : undefined;
  return {
    font: { bold: rule !== "none", sz: onNavy ? 11.5 : 9.5, color: { rgb: textColor } },
    ...(fill ? { fill } : {}),
    border: {
      top: rule === "final" ? XL_EDGE.thick : rule === "total" ? XL_EDGE.medium : XL_EDGE.hair,
      bottom: rule === "final" ? XL_EDGE.thick : XL_EDGE.hair,
      left: XL_EDGE.hair,
      right: XL_EDGE.hair,
    },
    alignment: { vertical: "center", horizontal: "left", wrapText: false },
  };
}

function xlLedgerValueStyle(kind: LedgerRowKind, money: boolean): XlStyle {
  const base = xlLedgerStyle(kind);
  return {
    ...base,
    font: { ...(base.font ?? {}), bold: true, color: { rgb: kind === "final" ? XL.mint : base.font?.color?.rgb ?? "0F172A" } },
    alignment: { vertical: "center", horizontal: "right" },
    ...(money ? { numFmt: XL_MONEY } : {}),
  };
}

type XlRow = { values: (string | number | null)[]; styles: (XlStyle | null)[]; hpt?: number };

function xlSheet(rows: XlRow[], cols: { wch: number }[], merges: XLSX.Range[] = [], autoFilter?: { ref: string }): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.values));
  rows.forEach((row, r) => {
    row.values.forEach((_, c) => {
      const s = row.styles[c];
      if (!s) return;
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell) cell.s = s;
    });
  });
  ws["!cols"] = cols;
  const heights = rows.map((r) => (r.hpt ? { hpt: r.hpt } : {}));
  if (rows.some((r) => r.hpt)) ws["!rows"] = heights;
  if (merges.length) ws["!merges"] = merges;
  if (autoFilter) ws["!autofilter"] = autoFilter;
  return ws;
}

/** Title / subtitle / generated band, then a spacer. Every sheet opens the same way. */
function xlHeaderRows(title: string, subtitle: string, ts: string, width: number): XlRow[] {
  const titleStyle: XlStyle = {
    font: { bold: true, sz: 14, color: { rgb: XL.white } },
    fill: xlFill(XL.navy),
    alignment: { vertical: "center", horizontal: "left" },
  };
  const subStyle: XlStyle = {
    font: { bold: true, sz: 10, color: { rgb: "CBD5E1" } },
    fill: xlFill(XL.navy),
    alignment: { vertical: "center", horizontal: "left" },
  };
  const metaStyle: XlStyle = {
    font: { sz: 8, italic: true, color: { rgb: XL.muted } },
    alignment: { vertical: "center", horizontal: "left" },
  };
  const band = (text: string, style: XlStyle, hpt: number): XlRow => ({
    values: [text, ...Array(Math.max(0, width - 1)).fill("")],
    styles: Array(width).fill(style),
    hpt,
  });
  return [
    band(title, titleStyle, 24),
    band(subtitle, subStyle, 16),
    band(`Generated ${ts}`, metaStyle, 13),
    { values: Array(width).fill(null), styles: Array(width).fill(null), hpt: 7 },
  ];
}

function xlMergeRange(width: number, row: number): XLSX.Range {
  return { s: { r: row, c: 0 }, e: { r: row, c: Math.max(0, width - 1) } };
}

function xlLedgerRow(label: string, value: string): XlRow {
  const kind = classifyLedgerRow(label, value);
  if (kind === "blank") return { values: [null, null], styles: [null, null], hpt: 6 };
  if (kind === "divider") {
    const title = pdfSafeText(label.replace(/^[-\u2013\u2014]+\s*/, "").replace(/\s*[-\u2013\u2014]+$/, "").trim());
    const style: XlStyle = {
      font: { bold: true, sz: 9, color: { rgb: XL.white } },
      fill: xlFill(sectionAccent(title).replace("#", "").toUpperCase()),
      alignment: { vertical: "center", horizontal: "left" },
    };
    return { values: [title.toUpperCase(), ""], styles: [style, style], hpt: 15 };
  }
  const money = parseMoneyCell(value);
  return {
    values: [pdfSafeText(label), money ?? pdfSafeText(value)],
    styles: [xlLedgerStyle(kind), xlLedgerValueStyle(kind, money !== null)],
    hpt: 14,
  };
}

function xlReconciliationSheet(config: ExportConfig, ts: string): XLSX.WorkSheet {
  const header = xlHeaderRows(config.title, config.subtitle, ts, 2);
  const rows: XlRow[] = [...header];
  const merges: XLSX.Range[] = [];
  header.forEach((_, i) => { if (i < 3) merges.push(xlMergeRange(2, i)); });

  for (const sec of config.sections) {
    const accent = xlFill(sectionAccent(sec.title).replace("#", "").toUpperCase());
    const bandStyle: XlStyle = {
      font: { bold: true, sz: 10, color: { rgb: XL.white } },
      fill: accent,
      alignment: { vertical: "center", horizontal: "left" },
    };
    const bandRow = rows.length;
    rows.push({ values: [pdfSafeText(sec.title.toUpperCase()), ""], styles: [bandStyle, bandStyle], hpt: 17 });
    merges.push(xlMergeRange(2, bandRow));
    for (const [label, value] of sec.metrics) rows.push(xlLedgerRow(label, value));
    rows.push({ values: [null, null], styles: [null, null], hpt: 7 });
  }

  const noteStyle: XlStyle = { font: { sz: 8, italic: true, color: { rgb: XL.muted } } };
  rows.push({ values: ["Care Diagnostics ERP - Confidential", null], styles: [noteStyle, null] });

  return xlSheet(rows, [{ wch: 52 }, { wch: 20 }], merges);
}

function xlTableSheet(table: ExportTable, config: ExportConfig, ts: string): XLSX.WorkSheet {
  const width = Math.max(1, table.headers.length);
  const header = xlHeaderRows(table.title, `${config.subtitle}  |  ${ts}`, ts, width);
  const rows: XlRow[] = [...header];
  const merges: XLSX.Range[] = [];
  header.forEach((_, i) => { if (i < 3) merges.push(xlMergeRange(width, i)); });

  const headStyle: XlStyle = {
    font: { bold: true, sz: 9, color: { rgb: XL.white } },
    fill: xlFill(XL.band),
    border: { top: XL_EDGE.thin, bottom: XL_EDGE.thin, left: XL_EDGE.thin, right: XL_EDGE.thin },
    alignment: { vertical: "center", horizontal: "left", wrapText: true },
  };
  const headerRowIdx = rows.length;
  rows.push({
    values: table.headers.map((h) => pdfSafeText(h)),
    styles: table.headers.map(() => headStyle),
    hpt: 18,
  });

  table.rows.forEach((row, ri) => {
    const isLast = ri === table.rows.length - 1;
    const totalRow = isLast && isTableTotalRow(table, ri);
    const fill = totalRow ? xlFill(XL.totalFill) : ri % 2 === 1 ? xlFill(XL.alt) : undefined;
    const cells = row.map((cell, ci) => {
      const colHeader = table.headers[ci] ?? "";
      const money = parseMoneyCell(cell);
      const numeric = money ?? (isAmountHeader(colHeader) && typeof cell === "number" ? cell : null);
      const rightAligned = numeric !== null || isAmountHeader(colHeader);
      const edge = totalRow
        ? { top: XL_EDGE.medium, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }
        : { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair };
      const style: XlStyle = {
        font: { sz: 9, bold: totalRow, color: { rgb: totalRow ? XL.navy : "1F2937" } },
        ...(fill ? { fill } : {}),
        border: edge,
        alignment: { vertical: "center", horizontal: rightAligned ? "right" : "left" },
        ...(numeric !== null ? { numFmt: XL_MONEY } : {}),
      };
      return { value: numeric ?? pdfSafeText(String(cell ?? "")), style };
    });
    rows.push({ values: cells.map((c) => c.value), styles: cells.map((c) => c.style), hpt: 13 });
  });

  const cols = table.headers.map((h, ci) => {
    const maxLen = Math.max(h.length, ...table.rows.map((r) => String(r[ci] ?? "").length));
    return { wch: Math.min(Math.max(maxLen + 2, 10), 42) };
  });
  const lastRow = rows.length - 1;
  const autoFilter = {
    ref: `${XLSX.utils.encode_cell({ r: headerRowIdx, c: 0 })}:${XLSX.utils.encode_cell({ r: lastRow, c: width - 1 })}`,
  };
  return xlSheet(rows, cols, merges, autoFilter);
}

const XL_SIMPLE_KIND_STYLE: Record<SimpleLedgerRow["kind"], XlStyle> = {
  meta:     { font: { bold: true, sz: 9, color: { rgb: "334155" } }, fill: xlFill("F8FAFC"), border: { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
  add:      { font: { sz: 9.5, color: { rgb: "065F46" } }, fill: xlFill(XL.addFill), border: { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
  subtract: { font: { sz: 9.5, color: { rgb: XL.red } }, fill: xlFill(XL.subFill), border: { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
  subtotal: { font: { bold: true, sz: 10, color: { rgb: XL.navy } }, fill: xlFill(XL.totalFill), border: { top: XL_EDGE.medium, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
  total:    { font: { bold: true, sz: 12, color: { rgb: XL.white } }, fill: xlFill(XL.navy), border: { top: XL_EDGE.thick, bottom: XL_EDGE.thick, left: XL_EDGE.thick, right: XL_EDGE.thick }, alignment: { vertical: "center", horizontal: "left" } },
  note:     { font: { sz: 8.5, italic: true, color: { rgb: XL.amber } }, fill: xlFill(XL.noteFill), border: { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
  line:     { font: { sz: 9.5, color: { rgb: "1F2937" } }, border: { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
  blank:    { font: { sz: 9, color: { rgb: "1F2937" } }, border: { top: XL_EDGE.hair, bottom: XL_EDGE.hair, left: XL_EDGE.hair, right: XL_EDGE.hair }, alignment: { vertical: "center", horizontal: "left" } },
};

function xlSimpleSheet(config: ExportConfig, ts: string): XLSX.WorkSheet {
  const header = xlHeaderRows(config.title, config.subtitle, ts, 2);
  const rows: XlRow[] = [...header];
  const merges: XLSX.Range[] = [];
  header.forEach((_, i) => { if (i < 3) merges.push(xlMergeRange(2, i)); });

  for (const row of config.simpleLedger ?? []) {
    if (row.kind === "blank") { rows.push({ values: [null, null], styles: [null, null], hpt: 6 }); continue; }
    const labelStyle = XL_SIMPLE_KIND_STYLE[row.kind];
    const money = parseMoneyCell(row.value);
    const valueStyle: XlStyle = {
      ...labelStyle,
      font: { ...(labelStyle.font ?? {}), bold: true, color: { rgb: row.kind === "total" ? XL.mint : labelStyle.font?.color?.rgb ?? XL.navy } },
      alignment: { vertical: "center", horizontal: "right" },
      ...(money !== null ? { numFmt: XL_MONEY } : {}),
    };
    const label = row.detail ? `${row.label} (${row.detail})` : row.label;
    rows.push({
      values: [pdfSafeText(label), money ?? pdfSafeText(row.value)],
      styles: [labelStyle, valueStyle],
      hpt: row.kind === "total" ? 21 : row.kind === "subtotal" ? 16 : 14,
    });
  }

  const formulaStyle: XlStyle = { font: { sz: 8, italic: true, color: { rgb: XL.muted } }, alignment: { horizontal: "left" } };
  const noteRow = rows.length;
  rows.push({ values: ["Bills + Old Dues - (Cancel+Refund+Outstanding) - Digital = Cash in counter", null], styles: [formulaStyle, null], hpt: 16 });
  merges.push(xlMergeRange(2, noteRow));

  return xlSheet(rows, [{ wch: 52 }, { wch: 20 }], merges);
}

export function buildExcelWorkbook(config: ExportConfig, mode: ExportMode = "full"): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  if (mode === "simple" && config.simpleLedger?.length) {
    XLSX.utils.book_append_sheet(wb, xlSimpleSheet(config, ts), "Simple Ledger");
    return wb;
  }

  XLSX.utils.book_append_sheet(wb, xlReconciliationSheet(config, ts), "Reconciliation");
  for (const table of config.tables) {
    const name = table.title.substring(0, 31).replace(/[\\/?*[\]:]/g, "_");
    XLSX.utils.book_append_sheet(wb, xlTableSheet(table, config, ts), name);
  }
  return wb;
}

function downloadExcel(config: ExportConfig, mode: ExportMode = "full") {
  const name = sanitizeFilename(config.title) + (mode === "simple" ? "_Simple" : "") + ".xlsx";
  XLSX.writeFile(buildExcelWorkbook(config, mode), name);
}

// ─── Word ─────────────────────────────────────────────────────────────────────

function downloadWord(config: ExportConfig, mode: ExportMode = "full") {
  const html = buildWordDocument(config, mode);
  const blob = new Blob([html], { type: "application/msword; charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = sanitizeFilename(config.title) + (mode === "simple" ? "_Simple" : "") + ".doc";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendSummaryEmail(
  config: ExportConfig,
  to: string,
  endpoint: string,
  mode: ExportMode = "full",
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await api.post<{ ok: boolean; error?: string }>(endpoint, {
      to,
      subject: `${config.title}${mode === "simple" ? " (Simple)" : ""} — ${config.subtitle}`,
      htmlBody: buildHTML(config, mode),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

function sanitizeFilename(s: string) {
  return s.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").substring(0, 60);
}

// ─── Toolbar Component ────────────────────────────────────────────────────────

export function SummaryExportToolbar({
  config,
  emailEndpoint,
  compact = false,
}: {
  config: ExportConfig | null;
  emailEndpoint: string;
  /** compact=true renders smaller buttons for use inside panel headers */
  compact?: boolean;
}) {
  const [pdfBusy,  setPdfBusy]  = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo,  setEmailTo]  = useState("");
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState<{ ok: boolean; error?: string } | null>(null);
  const [pdfOrientation, setPdfOrientation] = useState<PaperOrientation>(
    () => loadSummaryPdfOrientation(),
  );
  const [scope, setScope] = useState<ExportMode>("full");

  if (!config) return null;
  const hasSimple = (config.simpleLedger?.length ?? 0) > 0;
  // A page with no simple ledger has no choice to make, and must never export one.
  const view: ExportMode = hasSimple ? scope : "full";

  function handleSetOrientation(o: PaperOrientation) {
    persistSummaryPdfOrientation(o);
    setPdfOrientation(o);
  }

  async function handlePDF() {
    setPdfBusy(true);
    try { await downloadPDF(config!, pdfOrientation, view); }
    finally { setPdfBusy(false); }
  }

  function openEmail() {
    setEmailTo(""); setResult(null); setEmailOpen(true);
  }

  async function handleSend() {
    const addr = emailTo.trim();
    if (!addr) return;
    setSending(true); setResult(null);
    const r = await sendSummaryEmail(config!, addr, emailEndpoint, view);
    setResult(r); setSending(false);
  }

  const h     = compact ? "h-6"   : "h-8";
  const txSz  = compact ? "text-[10px]" : "text-xs";
  const icSz  = compact ? 11      : 13;
  const px    = compact ? "px-2"  : "px-2.5";

  const pdfBtnClass = compact
    ? `h-full rounded-none ${px} ${txSz} gap-1 text-white bg-blue-600 hover:bg-blue-500 font-semibold`
    : `${h} ${px} ${txSz} gap-1.5 text-white bg-blue-600 hover:bg-blue-500 font-semibold shadow-sm`;

  return (
    <>
      <div className="flex items-center gap-1">

        {/* Primary PDF — always visible */}
        <div className={`flex items-center overflow-hidden rounded-md border ${compact ? "border-slate-600/40 h-6" : "border-blue-700 h-8"}`}>
          <Button variant="ghost" size="sm"
            className={pdfBtnClass}
            onClick={() => void handlePDF()} disabled={pdfBusy}>
            {pdfBusy
              ? <Loader2 size={icSz} className="animate-spin" />
              : <FileText size={icSz} />}
            {view === "simple" && !compact ? "Simple PDF" : "PDF"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button"
                className={`flex items-center justify-center border-l ${compact ? "h-6 w-6 border-slate-600/40 bg-blue-600 text-white hover:bg-blue-500" : "h-8 w-7 border-blue-700 bg-blue-600 text-white hover:bg-blue-500"}`}
                aria-label="More export options">
                <ChevronDown size={compact ? 10 : 12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* One format list, not two. The old menu repeated Print / PDF / Word / Excel
                  under "Simple ledger", so the same four actions appeared eight times and the
                  only difference was which content was bundled with them. */}
              <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                What to export
              </DropdownMenuLabel>
              {hasSimple ? (
                <DropdownMenuRadioGroup value={view} onValueChange={(v) => setScope(v as ExportMode)}>
                  <DropdownMenuRadioItem value="full" className="text-xs">
                    Full report
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="simple" className="text-xs">
                    Simple ledger (one page)
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              ) : (
                <div className="px-2 py-1 text-xs text-muted-foreground">Full report</div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                PDF page
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={pdfOrientation}
                onValueChange={(v) => handleSetOrientation(v as PaperOrientation)}>
                <DropdownMenuRadioItem value="landscape" className="text-xs">
                  Landscape (recommended)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="portrait" className="text-xs">
                  Portrait
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs gap-2" onClick={() => void handlePDF()} disabled={pdfBusy}>
                <FileText size={13} /> Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs gap-2" onClick={() => doPrint(config, view)}>
                <Printer size={13} /> Print
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs gap-2" onClick={() => downloadWord(config, view)}>
                <FileType size={13} /> Word (.doc)
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs gap-2" onClick={() => downloadExcel(config, view)}>
                <FileSpreadsheet size={13} /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs gap-2" onClick={openEmail}>
                <Mail size={13} /> Email
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

      </div>

      {/* Email dialog */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Mail size={15} className="text-primary" /> Send Summary by Email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label htmlFor="export-email-to" className="text-xs font-semibold">
                Recipient Email
              </Label>
              <Input
                id="export-email-to" type="email"
                placeholder="e.g. owner@clinic.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="mt-1.5 h-9"
                onKeyDown={(e) => { if (e.key === "Enter") void handleSend(); }}
                autoFocus
              />
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-muted/20 p-3">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Content:</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                {view === "simple" ? "Simple ledger (one page)" : "Full report"}
              </p>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Subject:</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {config.title} — {config.subtitle}
              </p>
            </div>
            {result && (
              <div className={`flex items-center gap-2 rounded-lg p-2.5 text-xs font-semibold
                ${result.ok
                  ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400"}`}>
                {result.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {result.ok ? "Email sent successfully!" : (result.error ?? "Send failed.")}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 pt-1">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button size="sm"
              onClick={handleSend}
              disabled={sending || !emailTo.trim() || result?.ok === true}>
              {sending
                ? <><Loader2 size={13} className="animate-spin mr-1" /> Sending…</>
                : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
