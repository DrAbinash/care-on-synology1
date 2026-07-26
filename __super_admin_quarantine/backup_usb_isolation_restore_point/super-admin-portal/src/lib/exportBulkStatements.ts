/**
 * Bulk commission statements — one file covering a whole payout run.
 *
 * The per-doctor statement answers "what do I owe Dr X". A settlement run needs
 * "print the lot, hand them out, get them signed", which previously meant
 * opening each doctor's ledger and exporting one at a time.
 *
 * Three formats, because they are used for different things:
 *   PDF   — the thing you print and get signed. Identical layout to the single
 *           statement, one doctor per page (it calls the same renderer).
 *   Word  — the same content, editable, for when a doctor needs a note added or
 *           the clinic wants it on their own letterhead.
 *   Excel — a Summary sheet (one row per doctor, totals at the bottom) plus a
 *           Ledger sheet with every entry tagged by doctor, for reconciling
 *           against the bank or reworking the numbers.
 */

import { saveAs } from "file-saver";
import { loadReportOrientation, type PaperOrientation } from "@/lib/paperSize";
import {
  loadPdfLibs,
  renderStatementPage,
  type StatementDetail,
  type StatementMeta,
} from "@/lib/exportDoctorStatementPdf";

const INR = (n: number) =>
  "Rs." + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type BulkStatementMeta = StatementMeta & {
  /** Period label used in the file name and the cover page. */
  from: string | null;
  to: string | null;
};

const periodLabel = (m: BulkStatementMeta) => `${m.from || "Beginning"} to ${m.to || "Present"}`;
const fileStem = (m: BulkStatementMeta) =>
  `Commission_Statements_${(m.from || "start").replace(/[^0-9a-z]/gi, "")}_to_${(m.to || "present").replace(/[^0-9a-z]/gi, "")}`;

/** Figures the cover page and the Excel summary both report. */
function totalsOf(details: StatementDetail[]) {
  return details.reduce(
    (acc, d) => ({
      revenue: acc.revenue + (d.summary.totalRevenue ?? 0),
      earned: acc.earned + (d.summary.totalEarned ?? 0),
      held: acc.held + (d.summary.totalHeld ?? 0),
      paid: acc.paid + (d.summary.totalPaid ?? 0),
      clawback: acc.clawback + (d.summary.totalClawback ?? 0),
      outstanding: acc.outstanding + (d.summary.outstanding ?? 0),
    }),
    { revenue: 0, earned: 0, held: 0, paid: 0, clawback: 0, outstanding: 0 },
  );
}

// ── PDF ───────────────────────────────────────────────────────────────────────
export async function exportBulkStatementsPdf(details: StatementDetail[], meta: BulkStatementMeta): Promise<void> {
  if (details.length === 0) throw new Error("No doctors selected");
  const { jsPDF, autoTable } = await loadPdfLibs();
  const orientation: PaperOrientation = meta.orientation ?? loadReportOrientation();
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const t = totalsOf(details);

  // Cover page: what this run settles, before the individual statements.
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text((meta.clinicName || "Commission Statements").toUpperCase(), pageW / 2, 22, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  doc.text(`Payout run — ${periodLabel(meta)}`, pageW / 2, 29, { align: "center" });
  doc.text(`Generated: ${meta.generatedAt}`, pageW / 2, 34, { align: "center" });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 42,
    head: [["#", "Doctor", "Earned", "On hold", "Paid", "Outstanding"]],
    body: details.map((d, i) => [
      String(i + 1),
      d.doctor.name,
      INR(d.summary.totalEarned),
      INR(d.summary.totalHeld ?? 0),
      INR(d.summary.totalPaid),
      INR(d.summary.outstanding),
    ]),
    foot: [[
      "", `TOTAL — ${details.length} doctor${details.length === 1 ? "" : "s"}`,
      INR(t.earned), INR(t.held), INR(t.paid), INR(t.outstanding),
    ]],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [254, 243, 199], textColor: [180, 83, 9], fontStyle: "bold", fontSize: 9.5 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: "auto" },
      2: { halign: "right", cellWidth: 28 },
      3: { halign: "right", cellWidth: 26 },
      4: { halign: "right", cellWidth: 28 },
      5: { halign: "right", cellWidth: 30 },
    },
    margin: { left: 14, right: 14 },
  });

  // One statement per page, drawn by the same renderer the single export uses.
  for (const d of details) {
    doc.addPage();
    renderStatementPage(doc, autoTable, d, meta);
  }

  doc.save(`${fileStem(meta)}.pdf`);
}

// ── Word ──────────────────────────────────────────────────────────────────────
export async function exportBulkStatementsWord(details: StatementDetail[], meta: BulkStatementMeta): Promise<void> {
  if (details.length === 0) throw new Error("No doctors selected");
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    HeadingLevel, AlignmentType, WidthType, BorderStyle, PageBreak,
  } = await import("docx");

  const t = totalsOf(details);
  const cell = (text: string, opts?: { bold?: boolean; right?: boolean; width?: number }): any =>
    new TableCell({
      width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      children: [new Paragraph({
        alignment: opts?.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts?.bold, size: 18 })],
      })],
    });
  // docx is dynamically imported, so its classes are values here, not types.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = (cells: string[], opts?: { bold?: boolean; rightFrom?: number }): any =>
    new TableRow({
      children: cells.map((c, i) => cell(c, { bold: opts?.bold, right: opts?.rightFrom !== undefined && i >= opts.rightFrom })),
    });
  const table = (rows: any[]): any =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E8E8E8" },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E8E8E8" },
      },
    });

  const children: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: (meta.clinicName || "Commission Statements").toUpperCase(), bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Payout run — ${periodLabel(meta)}`, size: 20, color: "666666" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Generated: ${meta.generatedAt}`, size: 18, color: "888888" })],
    }),
    new Paragraph({ text: "" }),
    table([
      row(["#", "Doctor", "Earned", "On hold", "Paid", "Outstanding"], { bold: true, rightFrom: 2 }),
      ...details.map((d, i) => row([
        String(i + 1), d.doctor.name,
        INR(d.summary.totalEarned), INR(d.summary.totalHeld ?? 0),
        INR(d.summary.totalPaid), INR(d.summary.outstanding),
      ], { rightFrom: 2 })),
      row(["", `TOTAL — ${details.length} doctor${details.length === 1 ? "" : "s"}`,
           INR(t.earned), INR(t.held), INR(t.paid), INR(t.outstanding)], { bold: true, rightFrom: 2 }),
    ]),
  ];

  for (const d of details) {
    const s = d.summary;
    const held = s.totalHeld ?? 0;
    const clawback = s.totalClawback ?? 0;
    const heldOrders = (d.earnedOrders ?? []).filter(o => o.held);
    const clawbacks = d.clawbacks ?? [];

    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `Dr. ${d.doctor.name}`, bold: true })],
    }));
    const contact = [d.doctor.specialization, d.doctor.phone, d.doctor.email].filter(Boolean).join("  ·  ");
    if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact, size: 18, color: "777777" })] }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `Statement period: ${d.window.from || "Beginning"} to ${d.window.to || "Present"}`, size: 18, color: "777777" })],
    }));
    children.push(new Paragraph({ text: "" }));

    children.push(new Paragraph({ children: [new TextRun({ text: "Summary of Account", bold: true, size: 20 })] }));
    children.push(table([
      row(["Total business referred (revenue)", INR(s.totalRevenue)], { rightFrom: 1 }),
      row(["Commission earned — eligible", INR(s.totalEarned)], { rightFrom: 1 }),
      ...(held > 0.005 ? [row(["Commission on hold — not payable yet", INR(held)], { rightFrom: 1 })] : []),
      ...(clawback > 0.005 ? [row(["Reversed after eligibility (clawback)", "-" + INR(clawback)], { rightFrom: 1 })] : []),
      row(["Paid to date", INR(s.totalPaid)], { rightFrom: 1 }),
      row(["Net payable (outstanding)", INR(s.outstanding)], { bold: true, rightFrom: 1 }),
    ]));
    children.push(new Paragraph({ text: "" }));

    children.push(new Paragraph({ children: [new TextRun({ text: "Ledger", bold: true, size: 20 })] }));
    children.push(table([
      row(["Date", "Particular", "Earned", "Paid", "Balance"], { bold: true, rightFrom: 2 }),
      ...(d.ledger.length
        ? d.ledger.map(e => row([
            e.date, e.particular,
            e.credit ? INR(e.credit) : "", e.debit ? INR(e.debit) : "", INR(e.balance),
          ], { rightFrom: 2 }))
        : [row(["", "No entries in this period", "", "", ""])]),
      ...(d.ledger.length
        ? [row(["", "Window totals", INR(s.totalEarned), INR(s.totalPaid), INR(s.dueWindow)], { bold: true, rightFrom: 2 })]
        : []),
    ]));

    if (heldOrders.length) {
      children.push(new Paragraph({ text: "" }));
      children.push(new Paragraph({ children: [new TextRun({ text: `On Hold — not payable yet (${heldOrders.length})`, bold: true, size: 20, color: "B91C1C" })] }));
      children.push(table([
        row(["Order", "Reason for Hold", "Commission"], { bold: true, rightFrom: 2 }),
        ...heldOrders.map(o => row([o.orderNumber, o.holdReason ?? "On hold", INR(o.commission)], { rightFrom: 2 })),
      ]));
    }
    if (clawbacks.length) {
      children.push(new Paragraph({ text: "" }));
      children.push(new Paragraph({ children: [new TextRun({ text: `Reversed after eligibility (${clawbacks.length})`, bold: true, size: 20, color: "B45309" })] }));
      children.push(table([
        row(["Order", "Reason", "Amount"], { bold: true, rightFrom: 2 }),
        ...clawbacks.map(c => row([`#${c.orderId}`, c.reason, "-" + INR(c.amount)], { rightFrom: 2 })),
      ]));
    }

    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({
      children: [new TextRun({
        text: "Held commission is calculated but excluded from the payable total until its eligibility condition is met. This statement is system-generated.",
        italics: true, size: 15, color: "888888",
      })],
    }));
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Received by (Doctor): ______________________          Authorised signatory: ______________________", size: 18 })] }));
  }

  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  saveAs(blob, `${fileStem(meta)}.docx`);
}

// ── Excel ─────────────────────────────────────────────────────────────────────
export async function exportBulkStatementsExcel(details: StatementDetail[], meta: BulkStatementMeta): Promise<void> {
  if (details.length === 0) throw new Error("No doctors selected");
  // Same call shape as exportCommissionExcel — sheets in, blob out, saveAs.
  const writeXlsxFile = (await import("write-excel-file/browser")).default as unknown as (
    sheets: Array<{ data: unknown[][]; sheet?: string; columns?: { width: number }[] }>
  ) => { toBlob: () => Promise<Blob> };

  const t = totalsOf(details);
  const H = (value: string) => ({ value, fontWeight: "bold" as const, backgroundColor: "#F3F4F6" });
  const S = (value: string) => ({ value, type: String });
  const N = (value: number) => ({ value: Math.round((value ?? 0) * 100) / 100, type: Number, format: "#,##0.00" });
  const B = (value: string) => ({ value, type: String, fontWeight: "bold" as const });
  const BN = (value: number) => ({ value: Math.round((value ?? 0) * 100) / 100, type: Number, format: "#,##0.00", fontWeight: "bold" as const });

  // Sheet 1 — one row per doctor, the settlement run at a glance.
  const summary: unknown[][] = [
    [{ value: `Commission statements — ${periodLabel(meta)}`, type: String, fontWeight: "bold" as const }],
    [{ value: `Generated ${meta.generatedAt}`, type: String }],
    [],
    [],
    [H("Doctor"), H("Speciality"), H("Revenue referred"), H("Earned (eligible)"), H("On hold"), H("Paid to date"), H("Outstanding")],
    ...details.map(d => [
      S(d.doctor.name),
      S(d.doctor.specialization ?? ""),
      N(d.summary.totalRevenue),
      N(d.summary.totalEarned),
      N(d.summary.totalHeld ?? 0),
      N(d.summary.totalPaid),
      N(d.summary.outstanding),
    ]),
    [
      B(`TOTAL — ${details.length} doctor${details.length === 1 ? "" : "s"}`), S(""),
      BN(t.revenue), BN(t.earned), BN(t.held), BN(t.paid), BN(t.outstanding),
    ],
  ];

  // Sheet 2 — every ledger line, tagged by doctor, so it can be filtered and
  // reconciled against the bank.
  const ledger: unknown[][] = [
    [H("Doctor"), H("Date"), H("Type"), H("Particular"), H("Earned"), H("Paid"), H("Balance")],
    ...details.flatMap(d => d.ledger.map(e => [
      S(d.doctor.name), S(e.date), S(e.kind), S(e.particular),
      N(e.credit), N(e.debit), N(e.balance),
    ])),
  ];

  // Sheet 3 — only the things a doctor will ask about.
  const exceptions: unknown[][] = [
    [H("Doctor"), H("Kind"), H("Order"), H("Reason"), H("Amount")],
    ...details.flatMap(d => [
      ...(d.earnedOrders ?? []).filter(o => o.held).map(o => [
        S(d.doctor.name), S("On hold"), S(o.orderNumber), S(o.holdReason ?? "On hold"), N(o.commission),
      ]),
      ...(d.clawbacks ?? []).map(c => [
        S(d.doctor.name), S("Reversed"), S(`#${c.orderId}`), S(c.reason), N(-c.amount),
      ]),
    ]),
  ];

  const blob = await writeXlsxFile([
    { data: summary,    sheet: "Summary",         columns: [26, 20, 18, 18, 16, 16, 18].map(width => ({ width })) },
    { data: ledger,     sheet: "Ledger",          columns: [26, 12, 10, 52, 14, 14, 16].map(width => ({ width })) },
    { data: exceptions, sheet: "Held & Reversed", columns: [26, 12, 18, 46, 14].map(width => ({ width })) },
  ]).toBlob();
  saveAs(blob, `${fileStem(meta)}.xlsx`);
}
