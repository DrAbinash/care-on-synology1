/**
 * statementExport.ts — generic financial-statement export to PDF and Word.
 *
 * Reuses the same libraries the rest of the app already exports with
 * (jspdf + jspdf-autotable for PDF, docx + file-saver for Word — see
 * exportReport.ts). Unlike exportReport.ts, which is shaped for the referral
 * commission report, this operates on a neutral "document = ordered sheets;
 * sheet = header + one bordered table + footer" model, so the SAME row data
 * that renders on screen produces the printed/exported statement.
 *
 * Each sheet renders on its own page (PDF: addPage; Word: page break), so the
 * Balance Sheet, Statement of Profit & Loss and Trial Balance each land on a
 * separate sheet.
 */

import { saveAs } from "file-saver";

export interface StmtCell {
  text: string;
  align?: "left" | "center" | "right";
  colspan?: number;
  /** Small parenthetical detail appended after the label (e.g. ledger names). */
  small?: string;
}
export interface StmtRow {
  cells: StmtCell[];
  bold?: boolean;
  /** Light grey background — used for the EQUITY/ASSETS side banners. */
  shaded?: boolean;
  /** On-screen only: a single top rule (sub-totals). Ignored by PDF/Word (grid). */
  topBorder?: boolean;
  /** On-screen only: a heavy top+bottom rule (grand totals). Ignored by PDF/Word. */
  strongBorder?: boolean;
}
export interface StmtColumn {
  header: string;
  align?: "left" | "center" | "right";
  /** Column width as a percentage of the table (shared by PDF + Word). */
  widthPct: number;
}
export interface StmtSheet {
  title: string;
  /** Company header lines; first line is rendered bold/larger. */
  headerLines: string[];
  /** e.g. "In ₹" — right-aligned under the column headers. */
  noteLine?: string;
  columns: StmtColumn[];
  rows: StmtRow[];
  footerLeft?: string[];
  footerRight?: string[];
}
export interface StmtDoc {
  fileBaseName: string;
  sheets: StmtSheet[];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function exportStatementsPDF(model: StmtDoc): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const usableW = pageW - 24; // 12mm margins each side

  // jsPDF's built-in "times" font uses WinAnsi encoding, which has no glyph for
  // the Indian Rupee sign (U+20B9) — it would render as garbage. We don't embed
  // a Unicode TTF, so substitute "Rs." in the PDF path only (HTML and Word keep
  // the ₹ symbol, which they render correctly).
  const san = (s: string) => s.replace(/₹/g, "Rs.");

  model.sheets.forEach((sheet, si) => {
    if (si > 0) doc.addPage();
    let y = 16;

    // Company header
    sheet.headerLines.forEach((ln, i) => {
      doc.setFont("times", i === 0 ? "bold" : "normal");
      doc.setFontSize(i === 0 ? 14 : 10);
      doc.text(san(ln), pageW / 2, y, { align: "center" });
      y += i === 0 ? 6 : 4.4;
    });
    y += 2;

    // Statement title
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text(san(sheet.title), pageW / 2, y, { align: "center" });
    y += 5;

    if (sheet.noteLine) {
      doc.setFont("times", "italic");
      doc.setFontSize(9);
      doc.text(san(sheet.noteLine), pageW - 12, y, { align: "right" });
      y += 2;
    }

    const body = sheet.rows.map((r) =>
      r.cells.map((c) => ({
        content: san(c.text + (c.small ? `  (${c.small})` : "")),
        colSpan: c.colspan ?? 1,
        styles: {
          halign: c.align ?? "left",
          fontStyle: (r.bold ? "bold" : "normal") as "bold" | "normal",
          fillColor: r.shaded ? hexToRgb("F0F0F0") : ([255, 255, 255] as [number, number, number]),
        },
      })),
    );

    autoTable(doc, {
      startY: y,
      head: [sheet.columns.map((c) => ({ content: san(c.header), styles: { halign: c.align ?? "left" } }))],
      body,
      theme: "grid",
      styles: { font: "times", fontSize: 9, cellPadding: 1.4, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
      headStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0], fontStyle: "bold", lineColor: [0, 0, 0], lineWidth: 0.1 },
      columnStyles: Object.fromEntries(
        sheet.columns.map((c, i) => [i, { halign: c.align ?? "left", cellWidth: (usableW * c.widthPct) / 100 }]),
      ),
      margin: { left: 12, right: 12 },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // Footer (signature block)
    const footTop = y;
    if (sheet.footerLeft?.length) {
      doc.setFont("times", "normal");
      doc.setFontSize(9);
      let fy = footTop;
      sheet.footerLeft.forEach((ln) => { doc.text(san(ln), 14, fy); fy += 5; });
    }
    if (sheet.footerRight?.length) {
      doc.setFont("times", "normal");
      doc.setFontSize(9);
      let fy = footTop;
      sheet.footerRight.forEach((ln) => { doc.text(san(ln), pageW - 14, fy, { align: "right" }); fy += 5; });
    }
  });

  doc.save(`${model.fileBaseName}.pdf`);
}

// ── Word ──────────────────────────────────────────────────────────────────────

export async function exportStatementsWord(model: StmtDoc): Promise<void> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell,
    TextRun, AlignmentType, WidthType, BorderStyle, ShadingType, PageBreak,
  } = await import("docx");

  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const cellBorders = { top: border, bottom: border, left: border, right: border };

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  model.sheets.forEach((sheet, si) => {
    if (si > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Company header
    sheet.headerLines.forEach((ln, i) =>
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: ln, bold: i === 0, size: i === 0 ? 28 : 20 })],
      })),
    );
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: sheet.title.toUpperCase(), bold: true, size: 24 })],
    }));
    if (sheet.noteLine) {
      children.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: sheet.noteLine, italics: true, size: 18 })],
      }));
    }

    const headRow = new TableRow({
      tableHeader: true,
      children: sheet.columns.map((c) => new TableCell({
        width: { size: c.widthPct, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
        borders: cellBorders,
        children: [new Paragraph({ alignment: alignOf(AlignmentType, c.align), children: [new TextRun({ text: c.header, bold: true, size: 20 })] })],
      })),
    });

    const dataRows = sheet.rows.map((r) => new TableRow({
      children: r.cells.map((c) => new TableCell({
        columnSpan: c.colspan ?? 1,
        shading: r.shaded ? { type: ShadingType.CLEAR, fill: "F0F0F0" } : undefined,
        borders: cellBorders,
        children: [new Paragraph({
          alignment: alignOf(AlignmentType, c.align),
          children: [
            new TextRun({ text: c.text, bold: r.bold, size: 20 }),
            ...(c.small ? [new TextRun({ text: `  (${c.small})`, size: 14, color: "555555" })] : []),
          ],
        })],
      })),
    }));

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headRow, ...dataRows],
    }));

    // Footer (signature block) — two columns via a borderless table.
    if (sheet.footerLeft?.length || sheet.footerRight?.length) {
      children.push(new Paragraph({ text: "", spacing: { before: 200 } }));
      const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const nb = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [new TableRow({
          children: [
            new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: nb, children: (sheet.footerLeft ?? []).map((ln) => new Paragraph({ children: [new TextRun({ text: ln, size: 18 })] })) }),
            new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: nb, children: (sheet.footerRight ?? []).map((ln) => new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: ln, size: 18 })] })) }),
          ],
        })],
      }));
    }
  });

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${model.fileBaseName}.docx`);
}

function alignOf(
  AlignmentType: typeof import("docx").AlignmentType,
  a?: "left" | "center" | "right",
): (typeof import("docx").AlignmentType)[keyof typeof import("docx").AlignmentType] {
  return a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
}
