import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { loadSummaryPdfOrientation, persistSummaryPdfOrientation, type PaperOrientation } from "@/lib/paperSize";
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

// ─── Row classification helpers ───────────────────────────────────────────────

function isSectionHeader(label: string) { return label.startsWith("──"); }
function isBlankRow(label: string, value: string) { return label === "" && value === ""; }
function isTotalRow(label: string) {
  const l = label.toLowerCase();
  return l.startsWith("total") || l.startsWith("expected") || l.startsWith("net ") ||
         l.startsWith("collectible") || l === "variance";
}
function isDeductRow(label: string) {
  const l = label.toLowerCase();
  return l.startsWith("cancelled") || l.startsWith("refund") || l.startsWith("outstanding") ||
         l.startsWith("digital collection") || l.startsWith("cash expenses");
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

// ─── Smart HTML builder (Print / Word / Email) ────────────────────────────────

function buildHTML(config: ExportConfig): string {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  // Build the reconciliation section rows
  const renderSection = (sec: ExportSection): string => {
    const rows = sec.metrics.map(([label, value]) => {
      if (isBlankRow(label, value)) {
        return `<tr><td colspan="3" style="height:4px;padding:0;border:none"></td></tr>`;
      }
      if (isSectionHeader(label)) {
        const title = label.replace(/^──\s*/, "").replace(/\s*──+$/, "").trim();
        const bg = title.includes("BILLING") ? "#0f766e"
                 : title.includes("DEDUCTION") ? "#991b1b"
                 : title.includes("COLLECTION") ? "#1d4ed8"
                 : title.includes("CASH") ? "#1e293b"
                 : "#374151";
        return `<tr>
          <td colspan="3" style="background:${bg};color:#fff;font-size:9px;font-weight:700;
            letter-spacing:.08em;text-transform:uppercase;padding:4px 10px 4px 8px;border:none">
            ${title}
          </td>
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

      const labelStyle = `font-size:${finalRow ? "11" : "10"}px;
        color:${info ? "#92400e" : deduct ? "#991b1b" : total || finalRow ? "#0f172a" : "#374151"};
        font-weight:${total || finalRow ? "700" : "400"};
        padding:${finalRow ? "6" : "3"}px 8px 3px ${finalRow ? "8" : "12"}px`;

      const sign = deduct ? "−" : total || finalRow ? "=" : info ? "ℹ" : "";
      const signColor = deduct ? "#991b1b" : total ? "#0f172a" : info ? "#d97706" : "#94a3b8";

      const valueColor = finalRow
        ? (balanced ? "#166534" : mismatch ? "#991b1b" : "#0f172a")
        : balanced ? "#166534"
        : mismatch ? "#991b1b"
        : deduct    ? "#991b1b"
        : info      ? "#92400e"
        : "#111827";

      const valueStyle = `font-size:${finalRow ? "13" : "10"}px;font-weight:${total || finalRow ? "700" : "500"};
        color:${valueColor};text-align:right;font-family:monospace;
        padding:${finalRow ? "6" : "3"}px 10px 3px 8px;white-space:nowrap`;

      return `<tr style="background:${rowBg};border-bottom:${total || finalRow ? "1px solid #e2e8f0" : "none"}">
        <td style="width:18px;text-align:center;color:${signColor};font-size:10px;font-weight:700;padding:3px 2px 3px 8px;border:none">
          ${sign}
        </td>
        <td style="${labelStyle}">${label}</td>
        <td style="${valueStyle}">${value}</td>
      </tr>`;
    }).join("");

    return `
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:4px;
          border-bottom:2px solid #1e40af;padding-bottom:3px">${sec.title}</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  };

  const sectionsHTML = config.sections.map(renderSection).join("");

  // Data tables
  const tablesHTML = config.tables.map((t) => {
    const headerCells = t.headers.map((h) =>
      `<th style="padding:5px 8px;background:#1e40af;color:white;text-align:left;
        font-size:9px;font-weight:600;white-space:nowrap">${h}</th>`
    ).join("");

    const bodyRows = t.rows.map((row, i) => {
      const cells = row.map((cell, ci) => {
        const isAmt = typeof cell === "string" && cell.includes("₹");
        return `<td style="padding:3px 8px;font-size:9px;border-bottom:1px solid #f1f5f9;
          text-align:${isAmt ? "right" : "left"};font-family:${isAmt ? "monospace" : "inherit"}">${cell}</td>`;
      }).join("");
      return `<tr style="background:${i % 2 === 0 ? "#f8fafc" : "white"}">${cells}</tr>`;
    }).join("");

    return `
      <div style="margin-bottom:18px;page-break-inside:avoid">
        <div style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:4px;
          border-bottom:2px solid #1e40af;padding-bottom:3px">${t.title}</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${config.title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      margin: 0; padding: 20px; color: #111827; font-size: 11px;
      background: #fff;
    }
    @media print {
      body { padding: 0; }
      @page { margin: 10mm 12mm; size: A4 portrait; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      div[style*="page-break-inside:avoid"] { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e3a8a,#1e40af);color:white;
    padding:14px 18px;border-radius:6px 6px 0 0;margin-bottom:0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:16px;font-weight:800;letter-spacing:-.02em">${config.title}</div>
        <div style="font-size:11px;opacity:.85;margin-top:3px">${config.subtitle}</div>
      </div>
      <div style="text-align:right;opacity:.75;font-size:9px">
        <div>Care Diagnostics ERP</div>
        <div style="margin-top:2px">${ts}</div>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div style="background:white;border:1px solid #e2e8f0;border-top:none;
    padding:16px 18px;border-radius:0 0 6px 6px;margin-bottom:16px">
    ${sectionsHTML}
  </div>

  <!-- Tables -->
  ${tablesHTML}

  <!-- Footer -->
  <div style="margin-top:16px;padding-top:8px;border-top:1px solid #e5e7eb;
    font-size:8px;color:#9ca3af;display:flex;justify-content:space-between">
    <span>Care Diagnostics ERP — Confidential</span>
    <span>${ts}</span>
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
const PDF_BLUE: [number, number, number] = [30, 64, 175];
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
  const margin = 12;
  const ts     = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  // ── Cover header bar ─────────────────────────────────────────────────────
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, pageW, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(config.title, margin, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(config.subtitle, margin, 19);
  doc.setFontSize(7);
  doc.text(ts, pageW - margin, 12, { align: "right" });
  doc.text("Care Diagnostics ERP", pageW - margin, 18, { align: "right" });

  let y = 30;

  // ── Reconciliation sections ───────────────────────────────────────────────
  for (const section of config.sections) {
    if (y > pageH - 30) { doc.addPage(); y = margin; }

    // Section title
    doc.setTextColor(...PDF_BLUE);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(section.title, margin, y);
    // Underline
    doc.setDrawColor(...PDF_BLUE);
    doc.setLineWidth(0.3);
    doc.line(margin, y + 0.8, pageW - margin, y + 0.8);
    y += 5;

    // Build body rows with visual styling
    const bodyRows: string[][] = [];
    const rowStyles: Array<{
      fillColor?: [number,number,number];
      textColor?: [number,number,number];
      fontStyle?: "bold" | "normal";
      fontSize?: number;
    }> = [];

    for (const [label, value] of section.metrics) {
      if (isBlankRow(label, value)) {
        bodyRows.push(["", "", ""]);
        rowStyles.push({ fillColor: [255, 255, 255] as [number,number,number] });
        continue;
      }
      if (isSectionHeader(label)) {
        const title = label.replace(/^──\s*/, "").replace(/\s*──+$/, "").trim();
        const bg = sectionBgFor(title);
        bodyRows.push(["", title, ""]);
        rowStyles.push({ fillColor: bg, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 });
        continue;
      }

      const balanced  = isBalancedRow(label, value);
      const mismatch  = isMismatchRow(label, value);
      const totalRow  = isTotalRow(label);
      const deductRow = isDeductRow(label);
      const infoRow   = isInfoRow(label);
      const finalRow  = label === "Expected Physical Cash";

      const sign = deductRow ? "−" : (totalRow || finalRow) ? "=" : infoRow ? "ℹ" : "";
      const textCol: [number,number,number] = finalRow
        ? (balanced ? PDF_GRN : mismatch ? PDF_RED : PDF_DARK)
        : balanced ? PDF_GRN
        : mismatch ? PDF_RED
        : deductRow ? PDF_RED
        : infoRow   ? PDF_AMB
        : totalRow  ? PDF_DARK
        : PDF_GRY;

      const fillCol: [number,number,number] | undefined = finalRow
        ? (balanced ? [240, 253, 244] : [254, 242, 242]) as [number,number,number]
        : balanced  ? [240, 253, 244] as [number,number,number]
        : mismatch  ? [254, 242, 242] as [number,number,number]
        : totalRow  ? [241, 245, 249] as [number,number,number]
        : infoRow   ? [255, 251, 235] as [number,number,number]
        : undefined;

      bodyRows.push([sign, label, value]);
      rowStyles.push({
        fillColor: fillCol,
        textColor: textCol,
        fontStyle: (totalRow || finalRow) ? "bold" : "normal",
        fontSize: finalRow ? 10 : 8,
      });
    }

    autoTable(doc, {
      startY: y,
      body: bodyRows,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 6, halign: "center", fontSize: 7 },
        1: { cellWidth: orientation === "landscape" ? 180 : 120 },
        2: { halign: "right", fontStyle: "bold", cellWidth: 35 },
      },
      margin: { left: margin, right: margin },
      didParseCell(data) {
        const rs = rowStyles[data.row.index];
        if (!rs) return;
        if (rs.fillColor) data.cell.styles.fillColor = rs.fillColor;
        if (rs.textColor) data.cell.styles.textColor = rs.textColor;
        if (rs.fontStyle) data.cell.styles.fontStyle = rs.fontStyle;
        if (rs.fontSize)  data.cell.styles.fontSize  = rs.fontSize;
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Data tables ───────────────────────────────────────────────────────────
  for (const table of config.tables) {
    if (y > pageH - 40) { doc.addPage(); y = margin; }

    doc.setTextColor(...PDF_BLUE);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(table.title, margin, y);
    doc.setDrawColor(...PDF_BLUE);
    doc.setLineWidth(0.3);
    doc.line(margin, y + 0.8, pageW - margin, y + 0.8);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [table.headers],
      body: table.rows.map((row) => row.map(String)),
      theme: "striped",
      styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: PDF_BLUE, textColor: [255, 255, 255] as [number,number,number], fontSize: 7 },
      // Right-align any column whose header or value looks like currency
      didParseCell(data) {
        const v = String(data.cell.raw ?? "");
        if (v.includes("₹") || v.startsWith("−₹") || v.startsWith("+₹")) {
          data.cell.styles.halign = "right";
          data.cell.styles.font   = "courier";
        }
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Page footers ─────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF_GRY);
    doc.text(
      `Care Diagnostics ERP  •  Confidential  •  ${ts}  •  Page ${i} of ${totalPages}`,
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
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        to,
        subject: `${config.title} — ${config.subtitle}`,
        htmlBody: buildHTML(config),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `Server error ${res.status}` };
    }
    return res.json() as Promise<{ ok: boolean; error?: string }>;
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
