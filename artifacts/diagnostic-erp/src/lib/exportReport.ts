/**
 * Report export utilities — PDF, Excel, Word
 * Supports the Referral Commission Report format (per-doctor test tables).
 */

import { saveAs } from "file-saver";
import { loadReportOrientation, type PaperOrientation } from "@/lib/paperSize";

// ─── Shared Types ─────────────────────────────────────────────────────────────
export type ExportTestRow = {
  testName: string;
  count: number;
  rateLabel: string; // e.g. "10%" or "₹50.00"
  commission: number;
};

export type ExportDoctorSection = {
  label: string;        // "a)", "b)"…
  doctorName: string;
  specialization: string;
  orderCount: number;
  testCount: number;
  effectiveRate: number;
  totalRevenue: number;
  totalCommission: number;
  rows: ExportTestRow[];
};

export type ReportMeta = {
  title: string;
  subtitle?: string;
  from: string;
  to: string;
  doctorFilter: string; // "All Doctors" or specific name
  generatedAt: string;
  grandTotal?: {
    doctors: number;
    orders: number;
    revenue: number;
    commission: number;
  };
};

const INR = (n: number) =>
  "Rs." + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── PDF Export ──────────────────────────────────────────────────────────────
export async function exportPDF(
  sections: ExportDoctorSection[],
  meta: ReportMeta,
  orientation?: PaperOrientation,
  showPercentFixed: boolean = true,
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const resolvedOrientation: PaperOrientation = orientation ?? loadReportOrientation();
  const doc = new jsPDF({ orientation: resolvedOrientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  // Header
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(meta.title.toUpperCase(), pageW / 2, y, { align: "center" });
  y += 7;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Date Range: ${meta.from}  to  ${meta.to}`, 14, y);
  doc.text(`Doctor: ${meta.doctorFilter}`, pageW / 2, y, { align: "center" });
  doc.text(`Generated: ${meta.generatedAt}`, pageW - 14, y, { align: "right" });
  y += 10;
  doc.setTextColor(0);

  // Grand summary row
  if (meta.grandTotal) {
    const g = meta.grandTotal;
    doc.setFillColor(255, 251, 235);
    doc.setDrawColor(217, 119, 6);
    doc.roundedRect(14, y, pageW - 28, 10, 2, 2, "FD");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const summaryText = `Doctors: ${g.doctors}   Orders: ${g.orders}   Revenue: ${INR(g.revenue)}   Commission: ${INR(g.commission)}`;
    doc.text(summaryText, pageW / 2, y + 6.5, { align: "center" });
    y += 14;
  }

  // Per-doctor sections
  for (const section of sections) {
    // Section header
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${section.label} ${section.doctorName}`, 14, y);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(
      `${section.specialization}  ·  ${section.orderCount} orders  ·  ${section.testCount} tests  ·  Eff. Rate: ${section.effectiveRate}%`,
      14, y + 5,
    );
    doc.setTextColor(0);
    y += 9;

    // Table
    const pdfHead = showPercentFixed
      ? [["Test Name", "No of Tests", "% / Fixed", "Total Amount"]]
      : [["Test Name", "No of Tests", "Total Amount"]];
    const pdfBody = showPercentFixed
      ? [
          ...section.rows.map(r => [r.testName, String(r.count), r.rateLabel, INR(r.commission)]),
          ["", "", "Total →", INR(section.totalCommission)],
        ]
      : [
          ...section.rows.map(r => [r.testName, String(r.count), INR(r.commission)]),
          ["", "Total →", INR(section.totalCommission)],
        ];
    const pdfColStyles: Record<number, object> = showPercentFixed
      ? {
          0: { cellWidth: "auto" },
          1: { halign: "center", cellWidth: 28 },
          2: { halign: "center", cellWidth: 28 },
          3: { halign: "right", cellWidth: 36 },
        }
      : {
          0: { cellWidth: "auto" },
          1: { halign: "center", cellWidth: 28 },
          2: { halign: "right", cellWidth: 36 },
        };
    const totalColIndex = showPercentFixed ? 3 : 2;
    autoTable(doc, {
      startY: y,
      head: pdfHead,
      body: pdfBody,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
      columnStyles: pdfColStyles,
      bodyStyles: { textColor: [30, 30, 30] },
      willDrawCell: (data) => {
        if (data.row.index === section.rows.length) {
          doc.setFillColor(255, 251, 235);
          doc.setFont("helvetica", "bold");
          if (data.column.index === totalColIndex) doc.setTextColor(180, 83, 9);
        }
      },
      margin: { left: 14, right: 14 },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    if (y > 260) { doc.addPage(); y = 20; }
  }

  doc.save(`${meta.title.replace(/\s+/g, "_")}_${meta.from}_to_${meta.to}.pdf`);
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

type RCell = {
  value?: string | number | null;
  type?: typeof String | typeof Number;
  fontWeight?: "bold";
  color?: string;
  backgroundColor?: string;
  align?: "left" | "center" | "right";
  span?: number;
} | null;

export async function exportExcel(
  sections: ExportDoctorSection[],
  meta: ReportMeta,
  showPercentFixed: boolean = true,
): Promise<void> {
  const writeXlsxFile = (await import("write-excel-file/browser")).default as unknown as (
    sheets: Array<{ data: RCell[][]; sheet?: string; columns?: { width: number }[] }>
  ) => { toBlob: () => Promise<Blob> };

  const HEADER_BG = "#F3F4F6";
  const AMBER_BG  = "#FEF3C7";

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const summaryData: RCell[][] = [];

  summaryData.push([{ value: meta.title, fontWeight: "bold", span: 7 }]);
  summaryData.push([{ value: `Date Range: ${meta.from} to ${meta.to}`, span: 7 }]);
  summaryData.push([{ value: `Doctor: ${meta.doctorFilter}`, span: 7 }]);
  summaryData.push([{ value: `Generated: ${meta.generatedAt}`, span: 7 }]);
  summaryData.push([null]);

  if (meta.grandTotal) {
    const g = meta.grandTotal;
    summaryData.push([
      { value: "Doctors with Referrals", fontWeight: "bold", backgroundColor: AMBER_BG },
      { value: "Total Orders",           fontWeight: "bold", backgroundColor: AMBER_BG },
      { value: "Total Revenue",          fontWeight: "bold", backgroundColor: AMBER_BG },
      { value: "Commission Payable",     fontWeight: "bold", backgroundColor: AMBER_BG },
      null, null, null,
    ]);
    summaryData.push([
      { value: g.doctors, align: "center" },
      { value: g.orders,  align: "center" },
      { value: g.revenue  },
      { value: g.commission, fontWeight: "bold", color: "#B45309" },
      null, null, null,
    ]);
    summaryData.push([null]);
  }

  summaryData.push([
    { value: "Doctor",           fontWeight: "bold", backgroundColor: HEADER_BG },
    { value: "Specialization",   fontWeight: "bold", backgroundColor: HEADER_BG },
    { value: "Orders",           fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
    { value: "Tests",            fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
    { value: "Total Revenue",    fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
    { value: "Total Commission", fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
    { value: "Eff. Rate %",      fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
  ]);
  for (const s of sections) {
    summaryData.push([
      { value: s.doctorName,       type: String },
      { value: s.specialization,   type: String },
      { value: s.orderCount,       align: "center" },
      { value: s.testCount,        align: "center" },
      { value: s.totalRevenue,     align: "right"  },
      { value: s.totalCommission,  align: "right"  },
      { value: s.effectiveRate,    align: "center" },
    ]);
  }

  // ── Detailed Report sheet ──────────────────────────────────────────────────
  const detailData: RCell[][] = [];

  detailData.push([{ value: meta.title, fontWeight: "bold", span: 4 }]);
  detailData.push([{ value: `Date Range: ${meta.from} to ${meta.to}` }, null, null, { value: `Doctor: ${meta.doctorFilter}` }]);
  detailData.push([null]);

  for (const s of sections) {
    detailData.push([
      { value: `${s.label} ${s.doctorName}`, fontWeight: "bold" },
      { value: s.specialization, type: String },
      { value: `${s.orderCount} orders`, type: String },
      { value: `Eff. Rate: ${s.effectiveRate}%`, type: String },
    ]);
    if (showPercentFixed) {
      detailData.push([
        { value: "Test Name",            fontWeight: "bold", backgroundColor: HEADER_BG },
        { value: "No of Tests",          fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
        { value: "% / Fixed",            fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
        { value: "Total Amount (Rs.)",   fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
      ]);
      for (const r of s.rows) {
        detailData.push([
          { value: r.testName, type: String },
          { value: r.count,    align: "center" },
          { value: r.rateLabel, type: String, align: "center" },
          { value: r.commission, align: "right" },
        ]);
      }
      detailData.push([
        null, null,
        { value: "Total \u2192", fontWeight: "bold", backgroundColor: AMBER_BG, align: "right" },
        { value: s.totalCommission, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
      ]);
    } else {
      detailData.push([
        { value: "Test Name",            fontWeight: "bold", backgroundColor: HEADER_BG },
        { value: "No of Tests",          fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
        { value: "Total Amount (Rs.)",   fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
        null,
      ]);
      for (const r of s.rows) {
        detailData.push([
          { value: r.testName, type: String },
          { value: r.count,    align: "center" },
          { value: r.commission, align: "right" },
          null,
        ]);
      }
      detailData.push([
        null,
        { value: "Total \u2192", fontWeight: "bold", backgroundColor: AMBER_BG, align: "right" },
        { value: s.totalCommission, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
        null,
      ]);
    }
    detailData.push([null]);
  }

  const detailColumns = showPercentFixed
    ? [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 18 }]
    : [{ width: 30 }, { width: 14 }, { width: 18 }, { width: 0 }];

  const blob = await writeXlsxFile([
    { data: summaryData, sheet: "Summary",         columns: [{ width: 28 }, { width: 20 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 18 }, { width: 12 }] },
    { data: detailData,  sheet: "Detailed Report", columns: detailColumns },
  ]).toBlob();

  saveAs(
    blob,
    `${meta.title.replace(/\s+/g, "_")}_${meta.from}_to_${meta.to}.xlsx`,
  );
}

// ─── Word Export ──────────────────────────────────────────────────────────────

export type WordExportMode = "standard" | "doctor-test" | "consolidated";

const ALPHA = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z"];

export async function exportWord(
  sections: ExportDoctorSection[],
  meta: ReportMeta,
  mode: WordExportMode = "standard",
  showPercentFixed: boolean = true,
): Promise<void> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell,
    TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
    ShadingType,
  } = await import("docx");

  const AMBER_BG = "FEF3C7";
  const HEADER_BG = "F3F4F6";

  const cellBorder = {
    top:    { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
    left:   { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
    right:  { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
  };

  const makeCell = (
    text: string,
    opts: {
      bold?: boolean;
      bg?: string;
      align?: typeof AlignmentType[keyof typeof AlignmentType];
      color?: string;
    } = {},
  ) =>
    new TableCell({
      shading: opts.bg ? { type: ShadingType.CLEAR, fill: opts.bg } : undefined,
      borders: cellBorder,
      children: [new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? "1A1A1A", size: 20 })],
      })],
    });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      text: meta.title.toUpperCase(),
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Date Range: ${meta.from}  to  ${meta.to}`, size: 18, color: "555555" }),
        new TextRun({ text: `   |   Doctor: ${meta.doctorFilter}`, size: 18, color: "555555" }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${meta.generatedAt}`, size: 16, color: "888888", italics: true })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "" }),
  ];

  // Grand total summary table
  if (meta.grandTotal) {
    const g = meta.grandTotal;
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              makeCell("Doctors with Referrals", { bold: true, bg: AMBER_BG }),
              makeCell("Total Orders",           { bold: true, bg: AMBER_BG }),
              makeCell("Total Revenue",          { bold: true, bg: AMBER_BG }),
              makeCell("Commission Payable",     { bold: true, bg: AMBER_BG }),
            ],
          }),
          new TableRow({
            children: [
              makeCell(String(g.doctors), { align: AlignmentType.CENTER }),
              makeCell(String(g.orders),  { align: AlignmentType.CENTER }),
              makeCell(INR(g.revenue),    { align: AlignmentType.RIGHT }),
              makeCell(INR(g.commission), { bold: true, color: "B45309", align: AlignmentType.RIGHT }),
            ],
          }),
        ],
      }),
      new Paragraph({ text: "" }),
    );
  }

  // ── Consolidated mode: one row per doctor, grand total ────────────────────
  if (mode === "consolidated") {
    const grandComm = sections.reduce((s, sec) => s + sec.totalCommission, 0);

    const rows: InstanceType<typeof TableRow>[] = [
      new TableRow({
        tableHeader: true,
        children: [
          makeCell("#",                    { bold: true, bg: HEADER_BG }),
          makeCell("Referral Doctor Name", { bold: true, bg: HEADER_BG }),
          makeCell("Commission Amount",    { bold: true, bg: HEADER_BG, align: AlignmentType.RIGHT }),
        ],
      }),
      ...sections.map((sec, i) =>
        new TableRow({
          children: [
            makeCell(`${(ALPHA[i] ?? String(i + 1)).toUpperCase()})`),
            makeCell(sec.doctorName),
            makeCell(INR(sec.totalCommission), { align: AlignmentType.RIGHT }),
          ],
        }),
      ),
      new TableRow({
        children: [
          makeCell("",            { bg: AMBER_BG }),
          makeCell("Grand Total", { bold: true, bg: AMBER_BG }),
          makeCell(INR(grandComm), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
        ],
      }),
    ];

    children.push(
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    );

  // ── Doctor-test mode: flat table with subtotal per doctor ─────────────────
  } else if (mode === "doctor-test") {
    const grandComm = sections.reduce((s, sec) => s + sec.totalCommission, 0);

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        makeCell("Doctor Name",  { bold: true, bg: HEADER_BG }),
        makeCell("Test Name",    { bold: true, bg: HEADER_BG }),
        makeCell("No. of Tests", { bold: true, bg: HEADER_BG, align: AlignmentType.CENTER }),
        makeCell("Total Amount", { bold: true, bg: HEADER_BG, align: AlignmentType.RIGHT }),
      ],
    });

    const dataRows: InstanceType<typeof TableRow>[] = [];
    for (const sec of sections) {
      for (const row of sec.rows) {
        dataRows.push(new TableRow({
          children: [
            makeCell(sec.doctorName),
            makeCell(row.testName),
            makeCell(String(row.count), { align: AlignmentType.CENTER }),
            makeCell(INR(row.commission), { align: AlignmentType.RIGHT }),
          ],
        }));
      }
      dataRows.push(new TableRow({
        children: [
          makeCell("",                            { bg: AMBER_BG }),
          makeCell(`${sec.doctorName} – Total`,   { bold: true, bg: AMBER_BG }),
          makeCell("",                            { bg: AMBER_BG }),
          makeCell(INR(sec.totalCommission),      { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
        ],
      }));
    }

    dataRows.push(new TableRow({
      children: [
        makeCell("",            { bg: AMBER_BG }),
        makeCell("Grand Total", { bold: true, bg: AMBER_BG }),
        makeCell("",            { bg: AMBER_BG }),
        makeCell(INR(grandComm), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
      ],
    }));

    children.push(
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
    );

  // ── Standard mode: per-doctor sections ───────────────────────────────────
  } else {
    for (const section of sections) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${section.label} ${section.doctorName}`, bold: true, size: 24 }),
            new TextRun({ text: `  —  ${section.specialization}  ·  ${section.orderCount} orders  ·  Eff. Rate: ${section.effectiveRate}%`, size: 18, color: "666666" }),
          ],
          spacing: { before: 200 },
        }),
      );

      const headerCols = showPercentFixed
        ? [
            makeCell("Test Name",    { bold: true, bg: HEADER_BG }),
            makeCell("No of Tests",  { bold: true, bg: HEADER_BG, align: AlignmentType.CENTER }),
            makeCell("% / Fixed",    { bold: true, bg: HEADER_BG, align: AlignmentType.CENTER }),
            makeCell("Total Amount", { bold: true, bg: HEADER_BG, align: AlignmentType.RIGHT }),
          ]
        : [
            makeCell("Test Name",    { bold: true, bg: HEADER_BG }),
            makeCell("No of Tests",  { bold: true, bg: HEADER_BG, align: AlignmentType.CENTER }),
            makeCell("Total Amount", { bold: true, bg: HEADER_BG, align: AlignmentType.RIGHT }),
          ];

      const tableRows = [
        // Header
        new TableRow({ tableHeader: true, children: headerCols }),
        // Data rows
        ...section.rows.map(r =>
          new TableRow({
            children: showPercentFixed
              ? [
                  makeCell(r.testName),
                  makeCell(String(r.count),   { align: AlignmentType.CENTER }),
                  makeCell(r.rateLabel,       { align: AlignmentType.CENTER }),
                  makeCell(INR(r.commission), { align: AlignmentType.RIGHT }),
                ]
              : [
                  makeCell(r.testName),
                  makeCell(String(r.count),   { align: AlignmentType.CENTER }),
                  makeCell(INR(r.commission), { align: AlignmentType.RIGHT }),
                ],
          }),
        ),
        // Total row
        new TableRow({
          children: showPercentFixed
            ? [
                makeCell("",          { bg: AMBER_BG }),
                makeCell("",          { bg: AMBER_BG }),
                makeCell("Total \u2192", { bold: true, bg: AMBER_BG, align: AlignmentType.RIGHT }),
                makeCell(INR(section.totalCommission), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
              ]
            : [
                makeCell("",          { bg: AMBER_BG }),
                makeCell("Total \u2192", { bold: true, bg: AMBER_BG, align: AlignmentType.RIGHT }),
                makeCell(INR(section.totalCommission), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
              ],
        }),
      ];

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
        }),
        new Paragraph({ text: "" }),
      );
    }

    // Grand total row when multiple doctors
    if (sections.length > 1 && meta.grandTotal) {
      const g = meta.grandTotal;
      const grandComm = sections.reduce((s, sec) => s + sec.totalCommission, 0);
      const cols = showPercentFixed ? 4 : 3;
      const grandCells: InstanceType<typeof TableCell>[] = [];
      for (let i = 0; i < cols - 2; i++) {
        grandCells.push(makeCell("", { bg: AMBER_BG }));
      }
      grandCells.push(
        makeCell(
          `Grand Total — ${g.doctors} doctor${g.doctors !== 1 ? "s" : ""}  ·  ${g.orders} orders`,
          { bold: true, bg: AMBER_BG },
        ),
        makeCell(INR(grandComm), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: grandCells })],
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${meta.title.replace(/\s+/g, "_")}_${meta.from}_to_${meta.to}.docx`);
}
