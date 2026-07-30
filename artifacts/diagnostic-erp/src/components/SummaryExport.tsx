import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { loadSummaryPdfOrientation, persistSummaryPdfOrientation, type PaperOrientation } from "@/lib/paperSize";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Printer, FileText, FileSpreadsheet, FileType, Mail, Loader2,
  CheckCircle2, AlertCircle,
} from "lucide-react";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ExportSection = {
  title: string;
  /** [label, value] pairs. Label starting with "──" = section divider row. Empty label = blank row. */
  metrics: [string, string][];
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
};

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

/** Compact ledger width — label + value adjacent, not stretched across full page. */
const LEDGER_SIGN_MM = 4;
const LEDGER_VALUE_MM = 32;
const LEDGER_LABEL_MM = 76;
const LEDGER_TABLE_MM = LEDGER_SIGN_MM + LEDGER_LABEL_MM + LEDGER_VALUE_MM;

// ─── Smart HTML builder (Print / Word / Email) ────────────────────────────────

function buildHTML(config: ExportConfig): string {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const renderSectionRows = (sec: ExportSection): string => {
    return sec.metrics.map(([label, value]) => {
      const safeLabel = escHtml(pdfSafeText(label));
      const safeValue = escHtml(pdfSafeText(value));

      if (isBlankRow(label, value)) {
        return `<tr><td colspan="3" style="height:2px;padding:0;border:none"></td></tr>`;
      }
      if (isSectionHeader(label)) {
        const title = pdfSafeText(label.replace(/^--\s*/, "").replace(/\s*--$/, "").trim());
        const bg = title.includes("BILLING") ? "#0f766e"
                 : title.includes("DEDUCTION") ? "#991b1b"
                 : title.includes("COLLECTION") ? "#1d4ed8"
                 : title.includes("CASH") ? "#1e293b"
                 : "#475569";
        return `<tr>
          <td colspan="3" style="background:${bg};color:#fff;font-size:8px;font-weight:700;
            text-transform:uppercase;padding:2px 6px;border:none">${escHtml(title)}</td>
        </tr>`;
      }

      const balanced = isBalancedRow(label, value);
      const mismatch = isMismatchRow(label, value);
      const total    = isTotalRow(label);
      const deduct   = isDeductRow(label);
      const info     = isInfoRow(label);
      const finalRow = label === "Expected Physical Cash";

      const rowBg = finalRow ? (balanced ? "#f0fdf4" : "#fef2f2")
                  : balanced ? "#f0fdf4"
                  : mismatch ? "#fef2f2"
                  : total    ? "#f1f5f9"
                  : info     ? "#fffbeb"
                  : "transparent";

      const sign = deduct ? "-" : total || finalRow ? "=" : info ? "i" : "";
      const signColor = deduct ? "#991b1b" : total ? "#0f172a" : info ? "#d97706" : "#94a3b8";

      const valueColor = finalRow
        ? (balanced ? "#166534" : mismatch ? "#991b1b" : "#0f172a")
        : balanced ? "#166534"
        : mismatch ? "#991b1b"
        : deduct    ? "#991b1b"
        : info      ? "#92400e"
        : "#111827";

      const nowrapLabel = !info && safeLabel.length <= 22;

      return `<tr style="background:${rowBg}">
        <td style="width:12px;text-align:center;color:${signColor};font-size:8px;font-weight:700;padding:1px 2px;border:none;vertical-align:top">${sign}</td>
        <td style="font-size:8.5px;color:${info ? "#92400e" : deduct ? "#991b1b" : total || finalRow ? "#0f172a" : "#374151"};
          font-weight:${total || finalRow ? "700" : "400"};padding:1px 6px 1px 4px;vertical-align:top;line-height:1.25;white-space:${nowrapLabel ? "nowrap" : "normal"}">${safeLabel}</td>
        <td style="font-size:${finalRow ? "10.5" : "8.5"}px;font-weight:${total || finalRow ? "700" : "600"};
          color:${valueColor};text-align:right;font-variant-numeric:tabular-nums;padding:1px 4px 1px 0;
          white-space:nowrap;vertical-align:top">${safeValue}</td>
      </tr>`;
    }).join("");
  };

  const renderSectionBox = (sec: ExportSection): string => `
    <div style="display:inline-block;vertical-align:top;width:${LEDGER_TABLE_MM}mm;max-width:100%;border:1px solid #cbd5e1;border-radius:4px;overflow:hidden;margin:0 8px 8px 0;break-inside:avoid">
      <div style="background:#1e293b;color:#fff;padding:4px 8px;font-size:9px;font-weight:700">${escHtml(sec.title)}</div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup>
          <col style="width:${LEDGER_SIGN_MM}mm">
          <col style="width:${LEDGER_LABEL_MM}mm">
          <col style="width:${LEDGER_VALUE_MM}mm">
        </colgroup>
        <tbody>${renderSectionRows(sec)}</tbody>
      </table>
    </div>`;

  const sectionsHTML = `<div style="line-height:0">${config.sections.map(renderSectionBox).join("")}</div>`;

  const tablesHTML = config.tables.map((t) => {
    const colCount = t.headers.length;
    const headerCells = t.headers.map((h) =>
      `<th style="padding:3px 4px;background:#1e293b;color:white;text-align:left;font-size:7px;font-weight:700;white-space:nowrap">${escHtml(pdfSafeText(h))}</th>`
    ).join("");

    const bodyRows = t.rows.map((row, i) => {
      const cells = row.map((cell, ci) => {
        const raw = pdfSafeText(String(cell));
        const isAmt = /^-?Rs\./.test(raw);
        const isNumCol = ci >= colCount - 4 && isAmt;
        return `<td style="padding:2px 4px;font-size:7.5px;border-bottom:1px solid #e2e8f0;
          text-align:${isAmt ? "right" : "left"};font-variant-numeric:${isAmt ? "tabular-nums" : "normal"};
          max-width:${isNumCol ? "72px" : "none"};overflow:hidden;text-overflow:ellipsis;white-space:${isAmt ? "nowrap" : "normal"}">${escHtml(raw)}</td>`;
      }).join("");
      return `<tr style="background:${i % 2 === 0 ? "#f8fafc" : "#fff"}">${cells}</tr>`;
    }).join("");

    return `
      <div style="border:1px solid #cbd5e1;border-radius:4px;overflow:hidden;margin-bottom:8px;break-inside:avoid">
        <div style="background:#1e293b;color:#fff;padding:4px 8px;font-size:9px;font-weight:700">${escHtml(t.title)}</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;table-layout:auto;font-size:7.5px">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escHtml(config.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      margin: 0; padding: 10px 12px; color: #111827; font-size: 9px; background: #fff;
    }
    @media print {
      body { padding: 0; }
      @page { margin: 6mm 8mm; size: A4 portrait; }
      .no-print { display: none !important; }
      div[style*="break-inside:avoid"] { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div style="background:#0f172a;color:white;padding:8px 10px;border-radius:4px 4px 0 0;border:1px solid #0f172a;border-bottom:none">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div style="font-size:14px;font-weight:800">${escHtml(config.title)}</div>
        <div style="font-size:9px;opacity:.9;margin-top:1px;font-weight:600">${escHtml(config.subtitle)}</div>
      </div>
      <div style="text-align:right;opacity:.8;font-size:7.5px;line-height:1.3">
        <div>Care Diagnostics ERP</div>
        <div>${escHtml(ts)}</div>
      </div>
    </div>
  </div>
  <div style="border:1px solid #0f172a;border-top:none;padding:8px;border-radius:0 0 4px 4px;margin-bottom:8px;background:#f8fafc">
    ${sectionsHTML}
  </div>
  ${tablesHTML}
  <div style="margin-top:6px;padding-top:4px;border-top:1px solid #cbd5e1;font-size:7px;color:#94a3b8;display:flex;justify-content:space-between">
    <span>Care Diagnostics ERP - Confidential</span>
    <span>${escHtml(ts)}</span>
  </div>
</body>
</html>`;
}

// ─── Print ────────────────────────────────────────────────────────────────────

function doPrint(config: ExportConfig) {
  const html = buildHTML(config);
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups to use Print."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give browser time to parse CSS before print dialog opens
  setTimeout(() => { w.print(); }, 400);
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

// Colour constants matching the HTML builder
const PDF_NAVY: [number, number, number] = [15, 23, 42];
const PDF_DARK: [number, number, number] = [15, 23, 42];
const PDF_RED:  [number, number, number] = [153, 27, 27];
const PDF_GRN:  [number, number, number] = [22, 101, 52];
const PDF_AMB:  [number, number, number] = [146, 64, 14];
const PDF_GRY:  [number, number, number] = [100, 116, 139];

// Section header background colours
const sectionBg: Record<string, [number, number, number]> = {
  BILLING:     [15, 118, 110],
  DEDUCTION:   [153, 27, 27],
  COLLECTION:  [29, 78, 216],
  CASH:        [30, 41, 59],
};

function sectionBgFor(title: string): [number, number, number] {
  for (const [key, rgb] of Object.entries(sectionBg)) {
    if (title.toUpperCase().includes(key)) return rgb;
  }
  return [55, 65, 81];
}

async function downloadPDF(config: ExportConfig, orientation: PaperOrientation): Promise<void> {
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const margin = 10;
  const ts     = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  doc.setFillColor(...PDF_NAVY);
  doc.rect(0, 0, pageW, 20, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(pdfSafeText(config.title), margin, 10);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.text(pdfSafeText(config.subtitle), margin, 16);
  doc.setFontSize(6.5);
  doc.text(pdfSafeText(ts), pageW - margin, 10, { align: "right" });
  doc.text("Care Diagnostics ERP", pageW - margin, 15, { align: "right" });

  let y = 26;

  for (const section of config.sections) {
    if (y > pageH - 24) { doc.addPage(); y = margin; }

    const boxTop = y;
    doc.setFillColor(...PDF_NAVY);
    doc.rect(margin, y, LEDGER_TABLE_MM, 5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafeText(section.title), margin + 2, y + 3.5);
    y += 5;

    const bodyRows: string[][] = [];
    const rowStyles: Array<{
      fillColor?: [number, number, number];
      textColor?: [number, number, number];
      fontStyle?: "bold" | "normal";
      fontSize?: number;
    }> = [];

    for (const [label, value] of section.metrics) {
      if (isBlankRow(label, value)) {
        bodyRows.push(["", "", ""]);
        rowStyles.push({ fillColor: [255, 255, 255] });
        continue;
      }
      if (isSectionHeader(label)) {
        const title = pdfSafeText(label.replace(/^[-\u2013\u2014]+\s*/, "").replace(/\s*[-\u2013\u2014]+$/, "").trim());
        const bg = sectionBgFor(title);
        bodyRows.push(["", title, ""]);
        rowStyles.push({ fillColor: bg, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 });
        continue;
      }

      const balanced  = isBalancedRow(label, value);
      const mismatch  = isMismatchRow(label, value);
      const totalRow  = isTotalRow(label);
      const deductRow = isDeductRow(label);
      const infoRow   = isInfoRow(label);
      const finalRow  = label === "Expected Physical Cash";

      const sign = deductRow ? "-" : (totalRow || finalRow) ? "=" : infoRow ? "i" : "";
      const textCol: [number, number, number] = finalRow
        ? (balanced ? PDF_GRN : mismatch ? PDF_RED : PDF_DARK)
        : balanced ? PDF_GRN
        : mismatch ? PDF_RED
        : deductRow ? PDF_RED
        : infoRow   ? PDF_AMB
        : totalRow  ? PDF_DARK
        : PDF_GRY;

      const fillCol: [number, number, number] | undefined = finalRow
        ? (balanced ? [240, 253, 244] : [254, 242, 242])
        : balanced  ? [240, 253, 244]
        : mismatch  ? [254, 242, 242]
        : totalRow  ? [241, 245, 249]
        : infoRow   ? [255, 251, 235]
        : undefined;

      bodyRows.push([sign, pdfSafeText(label), pdfSafeText(value)]);
      rowStyles.push({
        fillColor: fillCol,
        textColor: textCol,
        fontStyle: (totalRow || finalRow) ? "bold" : "normal",
        fontSize: finalRow ? 9 : 7.5,
      });
    }

    autoTable(doc, {
      startY: y,
      body: bodyRows,
      theme: "plain",
      tableWidth: LEDGER_TABLE_MM,
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 0.6, bottom: 0.6, left: 1.5, right: 1.5 },
        overflow: "linebreak",
        valign: "middle",
      },
      columnStyles: {
        0: { cellWidth: LEDGER_SIGN_MM, halign: "center", fontSize: 7 },
        1: { cellWidth: LEDGER_LABEL_MM },
        2: { halign: "right", fontStyle: "bold", cellWidth: LEDGER_VALUE_MM, overflow: "visible" },
      },
      margin: { left: margin, right: pageW - margin - LEDGER_TABLE_MM },
      didParseCell(data) {
        const rs = rowStyles[data.row.index];
        if (!rs) return;
        if (rs.fillColor) data.cell.styles.fillColor = rs.fillColor;
        if (rs.textColor) data.cell.styles.textColor = rs.textColor;
        if (rs.fontStyle) data.cell.styles.fontStyle = rs.fontStyle;
        if (rs.fontSize)  data.cell.styles.fontSize  = rs.fontSize;
        if (data.column.index === 2) data.cell.styles.font = "helvetica";
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    doc.setDrawColor(...PDF_NAVY);
    doc.setLineWidth(0.35);
    doc.rect(margin, boxTop, LEDGER_TABLE_MM, y - boxTop);
    y += 4;
  }

  for (const table of config.tables) {
    if (y > pageH - 30) { doc.addPage(); y = margin; }

    const boxTop = y;
    const tableW = Math.min(pageW - margin * 2, orientation === "landscape" ? 260 : LEDGER_TABLE_MM + 40);
    doc.setFillColor(...PDF_NAVY);
    doc.rect(margin, y, tableW, 5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafeText(table.title), margin + 2, y + 3.5);
    y += 5;

    const amountCol = (header: string, value: string) =>
      /^-?Rs\./.test(value) || /amount|discount|net|cash|gross|refund|due|expense|collected|billed/i.test(header);

    autoTable(doc, {
      startY: y,
      head: [table.headers.map((h) => pdfSafeText(h))],
      body: table.rows.map((row) => row.map((cell) => pdfSafeText(String(cell)))),
      theme: "striped",
      tableWidth: tableW,
      styles: { fontSize: 6.5, cellPadding: 1, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: PDF_NAVY, textColor: [255, 255, 255], fontSize: 6.5, fontStyle: "bold" },
      didParseCell(data) {
        if (data.section === "head") return;
        const header = table.headers[data.column.index] ?? "";
        const v = String(data.cell.raw ?? "");
        if (amountCol(header, v)) data.cell.styles.halign = "right";
      },
      margin: { left: margin, right: pageW - margin - tableW },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    doc.setDrawColor(...PDF_NAVY);
    doc.setLineWidth(0.35);
    doc.rect(margin, boxTop, tableW, y - boxTop);
    y += 4;
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(6);
    doc.setTextColor(...PDF_GRY);
    doc.text(
      pdfSafeText(`Care Diagnostics ERP  |  Confidential  |  ${ts}  |  Page ${i} of ${totalPages}`),
      margin,
      pageH - 4,
    );
  }

  doc.save(sanitizeFilename(config.title) + ".pdf");
}

// ─── Excel ────────────────────────────────────────────────────────────────────

function downloadExcel(config: ExportConfig) {
  const wb = XLSX.utils.book_new();

  // Summary sheet — parse section headers and blank rows for visual structure
  const summaryRows: (string | number)[][] = [
    [config.title],
    [config.subtitle],
    [`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`],
    [],
  ];

  for (const sec of config.sections) {
    summaryRows.push([sec.title]);
    for (const [label, value] of sec.metrics) {
      if (isBlankRow(label, value)) { summaryRows.push([]); continue; }
      if (isSectionHeader(label)) {
        summaryRows.push([label.replace(/^──\s*/, "").replace(/\s*──+$/, "").trim()]);
        continue;
      }
      summaryRows.push([label, value]);
    }
    summaryRows.push([]);
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs["!cols"] = [{ wch: 46 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Reconciliation");

  // One sheet per data table
  for (const table of config.tables) {
    const sheetData: (string | number)[][] = [
      [table.title],
      [`${config.subtitle}  •  ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`],
      [],
      table.headers,
      ...table.rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    // Auto-width columns
    const colWidths = table.headers.map((h, ci) => {
      const maxLen = Math.max(
        h.length,
        ...table.rows.map((r) => String(r[ci] ?? "").length),
      );
      return { wch: Math.min(maxLen + 2, 40) };
    });
    ws["!cols"] = colWidths;
    const name = table.title.substring(0, 31).replace(/[\\/?*[\]:]/g, "_");
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  XLSX.writeFile(wb, sanitizeFilename(config.title) + ".xlsx");
}

// ─── Word ─────────────────────────────────────────────────────────────────────

function downloadWord(config: ExportConfig) {
  const html = buildHTML(config);
  const blob = new Blob([html], { type: "application/msword; charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = sanitizeFilename(config.title) + ".doc";
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
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Use the shared authenticated api client — it attaches the staff
    // Bearer token from localStorage. A raw fetch() here only sends cookies,
    // but this app authenticates via Authorization header, so every request
    // through plain fetch() was rejected with 401 regardless of who was
    // logged in (including superadmin).
    return await api.post<{ ok: boolean; error?: string }>(endpoint, {
      to,
      subject: `${config.title} — ${config.subtitle}`,
      htmlBody: buildHTML(config),
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

  if (!config) return null;

  function handleSetOrientation(o: PaperOrientation) {
    persistSummaryPdfOrientation(o);
    setPdfOrientation(o);
  }

  async function handlePDF() {
    setPdfBusy(true);
    try { await downloadPDF(config!, pdfOrientation); }
    finally { setPdfBusy(false); }
  }

  function openEmail() {
    setEmailTo(""); setResult(null); setEmailOpen(true);
  }

  async function handleSend() {
    const addr = emailTo.trim();
    if (!addr) return;
    setSending(true); setResult(null);
    const r = await sendSummaryEmail(config!, addr, emailEndpoint);
    setResult(r); setSending(false);
  }

  const h     = compact ? "h-6"   : "h-8";
  const txSz  = compact ? "text-[10px]" : "text-xs";
  const icSz  = compact ? 11      : 13;
  const px    = compact ? "px-2"  : "px-2.5";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">

        {/* Print */}
        <Button variant="outline" size="sm"
          className={`${h} ${px} ${txSz} gap-1 border-slate-600/40 text-slate-200 bg-slate-700/50 hover:bg-slate-600`}
          onClick={() => doPrint(config)}>
          <Printer size={icSz} /> Print
        </Button>

        {/* PDF + orientation toggle */}
        <div className={`flex items-center rounded-md border border-slate-600/40 overflow-hidden ${h}`}>
          <Button variant="ghost" size="sm"
            className={`h-full rounded-none ${px} ${txSz} gap-1 border-r border-slate-600/40 text-slate-200 hover:bg-slate-600`}
            onClick={handlePDF} disabled={pdfBusy}>
            {pdfBusy
              ? <Loader2 size={icSz} className="animate-spin" />
              : <FileText size={icSz} />}
            PDF
          </Button>
          <button type="button"
            className={`${px} h-full ${txSz} font-medium transition-colors border-r border-slate-600/40
              ${pdfOrientation === "landscape"
                ? "bg-blue-600 text-white"
                : "bg-slate-700/50 text-slate-400 hover:bg-slate-600"}`}
            onClick={() => handleSetOrientation("landscape")} title="Landscape">
            ⟺
          </button>
          <button type="button"
            className={`${px} h-full ${txSz} font-medium transition-colors
              ${pdfOrientation === "portrait"
                ? "bg-blue-600 text-white"
                : "bg-slate-700/50 text-slate-400 hover:bg-slate-600"}`}
            onClick={() => handleSetOrientation("portrait")} title="Portrait">
            ⟟
          </button>
        </div>

        {/* Excel/CSV */}
        <Button variant="outline" size="sm"
          className={`${h} ${px} ${txSz} gap-1 border-slate-600/40 text-slate-200 bg-slate-700/50 hover:bg-slate-600`}
          onClick={() => downloadExcel(config)}>
          <FileSpreadsheet size={icSz} /> Excel
        </Button>

        {/* Word */}
        <Button variant="outline" size="sm"
          className={`${h} ${px} ${txSz} gap-1 border-slate-600/40 text-slate-200 bg-slate-700/50 hover:bg-slate-600`}
          onClick={() => downloadWord(config)}>
          <FileType size={icSz} /> Word
        </Button>

        {/* Email */}
        <Button variant="outline" size="sm"
          className={`${h} ${px} ${txSz} gap-1 border-slate-600/40 text-slate-200 bg-slate-700/50 hover:bg-slate-600`}
          onClick={openEmail}>
          <Mail size={icSz} /> Email
        </Button>

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
