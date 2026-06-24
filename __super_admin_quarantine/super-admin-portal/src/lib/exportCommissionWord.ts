/**
 * Commission report Word (.docx) export for the Super Admin Portal.
 * Handles all three report modes: standard, doctor-test, and consolidated.
 */

import { saveAs } from "file-saver";
import type { CommissionDoctorEntry, CommissionTestGroupRow } from "@workspace/api-client-react";

const INR = (n: number) =>
  "Rs." + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ALPHA = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z"];

export type CommissionWordMeta = {
  title: string;
  from: string;
  to: string;
  doctorFilter: string;
  generatedAt: string;
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number };
};

export type CommissionWordMode = "standard" | "doctor-test" | "consolidated";

export async function exportCommissionWord(
  report: CommissionDoctorEntry[],
  meta: CommissionWordMeta,
  mode: CommissionWordMode,
  showPercentFixed: boolean,
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

  // ── Grand summary table ──────────────────────────────────────────────────
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
            makeCell(String(g.doctors),  { align: AlignmentType.CENTER }),
            makeCell(String(g.orders),   { align: AlignmentType.CENTER }),
            makeCell(INR(g.revenue),     { align: AlignmentType.RIGHT }),
            makeCell(INR(g.commission),  { bold: true, color: "B45309", align: AlignmentType.RIGHT }),
          ],
        }),
      ],
    }),
    new Paragraph({ text: "" }),
  );

  // ── Body: mode-specific ──────────────────────────────────────────────────
  if (mode === "consolidated") {
    const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);

    const rows = [
      new TableRow({
        tableHeader: true,
        children: [
          makeCell("#",                     { bold: true, bg: HEADER_BG }),
          makeCell("Referral Doctor Name",  { bold: true, bg: HEADER_BG }),
          makeCell("Commission Amount",     { bold: true, bg: HEADER_BG, align: AlignmentType.RIGHT }),
        ],
      }),
      ...report.map((e, i) =>
        new TableRow({
          children: [
            makeCell(`${ALPHA[i]?.toUpperCase() ?? String(i + 1)})`),
            makeCell(e.doctor.name),
            makeCell(INR(e.totalCommission), { align: AlignmentType.RIGHT }),
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

  } else if (mode === "doctor-test") {
    const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);

    const dataRows: InstanceType<typeof TableRow>[] = [];
    for (const e of report) {
      const testRows: CommissionTestGroupRow[] = Array.isArray(e.grouped) ? e.grouped : [];
      for (const row of testRows) {
        dataRows.push(new TableRow({
          children: [
            makeCell(e.doctor.name),
            makeCell(row.testName),
            makeCell(String(row.count), { align: AlignmentType.CENTER }),
            makeCell(INR(row.commission), { align: AlignmentType.RIGHT }),
          ],
        }));
      }
      dataRows.push(new TableRow({
        children: [
          makeCell("", { bg: AMBER_BG }),
          makeCell(`${e.doctor.name} – Total`, { bold: true, bg: AMBER_BG }),
          makeCell("", { bg: AMBER_BG }),
          makeCell(INR(e.totalCommission), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
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

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        makeCell("Doctor Name",   { bold: true, bg: HEADER_BG }),
        makeCell("Test Name",     { bold: true, bg: HEADER_BG }),
        makeCell("No. of Tests",  { bold: true, bg: HEADER_BG, align: AlignmentType.CENTER }),
        makeCell("Total Amount",  { bold: true, bg: HEADER_BG, align: AlignmentType.RIGHT }),
      ],
    });

    children.push(
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
    );

  } else {
    // ── Standard: per-doctor sections ───────────────────────────────────────
    for (const [idx, section] of report.entries()) {
      const label = `${ALPHA[idx]?.toUpperCase() ?? String(idx + 1)})`;
      const testRows: CommissionTestGroupRow[] = Array.isArray(section.grouped) ? section.grouped : [];

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${label} ${section.doctor.name}`, bold: true, size: 24 }),
            new TextRun({
              text: `  —  ${section.doctor.specialization}  ·  ${section.orderCount} orders  ·  ${section.testCount} tests  ·  Eff. Rate: ${section.effectiveRate}%`,
              size: 18, color: "666666",
            }),
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

      const tableRows: InstanceType<typeof TableRow>[] = [
        new TableRow({ tableHeader: true, children: headerCols }),
        ...testRows.map(r => {
          const rateLabel = r.ruleType === "percentage"
            ? `${r.ruleValue}%`
            : INR(r.ruleValue);
          return new TableRow({
            children: showPercentFixed
              ? [
                  makeCell(r.testName),
                  makeCell(String(r.count), { align: AlignmentType.CENTER }),
                  makeCell(rateLabel,       { align: AlignmentType.CENTER }),
                  makeCell(INR(r.commission), { align: AlignmentType.RIGHT }),
                ]
              : [
                  makeCell(r.testName),
                  makeCell(String(r.count),   { align: AlignmentType.CENTER }),
                  makeCell(INR(r.commission), { align: AlignmentType.RIGHT }),
                ],
          });
        }),
        new TableRow({
          children: showPercentFixed
            ? [
                makeCell("", { bg: AMBER_BG }),
                makeCell("", { bg: AMBER_BG }),
                makeCell("Total \u2192", { bold: true, bg: AMBER_BG, align: AlignmentType.RIGHT }),
                makeCell(INR(section.totalCommission), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
              ]
            : [
                makeCell("", { bg: AMBER_BG }),
                makeCell("Total \u2192", { bold: true, bg: AMBER_BG, align: AlignmentType.RIGHT }),
                makeCell(INR(section.totalCommission), { bold: true, bg: AMBER_BG, color: "B45309", align: AlignmentType.RIGHT }),
              ],
        }),
      ];

      children.push(
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }),
        new Paragraph({ text: "" }),
      );
    }

    // Grand total row when multiple doctors
    if (report.length > 1) {
      const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
      const cols = showPercentFixed ? 4 : 3;
      const grandCells: InstanceType<typeof TableCell>[] = [];
      for (let i = 0; i < cols - 2; i++) {
        grandCells.push(makeCell("", { bg: AMBER_BG }));
      }
      grandCells.push(
        makeCell(`Grand Total — ${g.doctors} doctor${g.doctors !== 1 ? "s" : ""}  ·  ${g.orders} orders`, { bold: true, bg: AMBER_BG }),
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
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  const safeName = meta.title.replace(/\s+/g, "_");
  saveAs(blob, `${safeName}_${meta.from}_to_${meta.to}.docx`);
}
