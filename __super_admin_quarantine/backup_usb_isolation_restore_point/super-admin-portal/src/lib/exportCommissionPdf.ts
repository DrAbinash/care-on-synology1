/**
 * Commission report PDF export for the Super Admin Portal.
 * Handles all three report modes: standard, doctor-test, and consolidated.
 */

import type { CommissionDoctorEntry, CommissionTestGroupRow } from "@workspace/api-client-react";
import { loadReportOrientation, type PaperOrientation } from "@/lib/paperSize";

const INR = (n: number) =>
  "Rs." + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Referral discount given up on commission — shown as a negative amount.
const NEGD = (d: number) => (d > 0.005 ? "-" + INR(d) : "-");

const ALPHA = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z"];

// Optional Expected/Discount/Actual breakdown fields. These are attached by the
// Referral Report's export adapter; the Commission Report page omits them and
// passes showBreakdown=false, so its output is unchanged.
export type CommissionTestGroupRowX = CommissionTestGroupRow & { expected?: number; discount?: number };
export type CommissionDoctorEntryX = Omit<CommissionDoctorEntry, "grouped"> & {
  grouped?: CommissionTestGroupRowX[] | null;
  totalExpected?: number;
  totalDiscount?: number;
};

export type CommissionPdfMeta = {
  title: string;
  from: string;
  to: string;
  doctorFilter: string;
  generatedAt: string;
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number; expectedCommission?: number; discount?: number };
};

export type CommissionReportMode = "standard" | "doctor-test" | "consolidated";

export async function exportCommissionPdf(
  report: CommissionDoctorEntryX[],
  meta: CommissionPdfMeta,
  mode: CommissionReportMode,
  showPercentFixed: boolean,
  orientation?: PaperOrientation,
  showBreakdown = false,
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const resolvedOrientation: PaperOrientation = orientation ?? loadReportOrientation();
  const doc = new jsPDF({ orientation: resolvedOrientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  // ── Header ──────────────────────────────────────────────────────────────────
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

  // ── Grand summary banner ─────────────────────────────────────────────────
  const g = meta.grandTotal;
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(217, 119, 6);
  doc.roundedRect(14, y, pageW - 28, 10, 2, 2, "FD");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  const summaryText = `Doctors: ${g.doctors}   Orders: ${g.orders}   Revenue: ${INR(g.revenue)}   Commission: ${INR(g.commission)}`;
  doc.text(summaryText, pageW / 2, y + 6.5, { align: "center" });
  y += 14;

  // ── Body: mode-specific ──────────────────────────────────────────────────
  if (mode === "consolidated") {
    const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
    const grandExp = report.reduce((s, e) => s + (e.totalExpected ?? e.totalCommission), 0);
    const grandDisc = report.reduce((s, e) => s + (e.totalDiscount ?? 0), 0);
    autoTable(doc, {
      startY: y,
      head: showBreakdown
        ? [["#", "Referral Doctor Name", "Expected", "Discount", "Actual"]]
        : [["#", "Referral Doctor Name", "Commission Amount"]],
      body: showBreakdown
        ? [
            ...report.map((e, i) => [
              `${ALPHA[i]?.toUpperCase() ?? String(i + 1)})`,
              e.doctor.name,
              INR(e.totalExpected ?? e.totalCommission),
              NEGD(e.totalDiscount ?? 0),
              INR(e.totalCommission),
            ]),
            ["", "Grand Total", INR(grandExp), NEGD(grandDisc), INR(grandComm)],
          ]
        : [
            ...report.map((e, i) => [
              `${ALPHA[i]?.toUpperCase() ?? String(i + 1)})`,
              e.doctor.name,
              INR(e.totalCommission),
            ]),
            ["", "Grand Total", INR(grandComm)],
          ],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
      columnStyles: showBreakdown
        ? { 0: { cellWidth: 12 }, 1: { cellWidth: "auto" }, 2: { halign: "right", cellWidth: 34 }, 3: { halign: "right", cellWidth: 30 }, 4: { halign: "right", cellWidth: 34 } }
        : { 0: { cellWidth: 16 }, 1: { cellWidth: "auto" }, 2: { halign: "right", cellWidth: 40 } },
      willDrawCell: (data) => {
        if (data.row.index === report.length) {
          doc.setFillColor(254, 243, 199);
          doc.setFont("helvetica", "bold");
          if (data.column.index === (showBreakdown ? 4 : 2)) doc.setTextColor(180, 83, 9);
        }
      },
      margin: { left: 14, right: 14 },
    });

  } else if (mode === "doctor-test") {
    const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
    const bodyRows: string[][] = [];
    for (const e of report) {
      const rows: CommissionTestGroupRowX[] = Array.isArray(e.grouped) ? e.grouped : [];
      for (const row of rows) {
        bodyRows.push([e.doctor.name, row.testName, String(row.count), INR(row.commission)]);
      }
      bodyRows.push(["", `${e.doctor.name} – Total`, "", INR(e.totalCommission)]);
    }
    bodyRows.push(["", "Grand Total", "", INR(grandComm)]);

    autoTable(doc, {
      startY: y,
      head: [["Doctor Name", "Test Name", "No. of Tests", "Total Amount"]],
      body: bodyRows,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 44 },
        1: { cellWidth: "auto" },
        2: { halign: "center", cellWidth: 28 },
        3: { halign: "right", cellWidth: 36 },
      },
      willDrawCell: (data) => {
        const totalRowIndices = new Set<number>();
        let idx = 0;
        for (const e of report) {
          const rows: CommissionTestGroupRowX[] = Array.isArray(e.grouped) ? e.grouped : [];
          idx += rows.length;
          totalRowIndices.add(idx);
          idx += 1;
        }
        totalRowIndices.add(idx); // grand total row
        if (totalRowIndices.has(data.row.index)) {
          doc.setFillColor(255, 251, 235);
          doc.setFont("helvetica", "bold");
          if (data.column.index === 3) doc.setTextColor(180, 83, 9);
        }
      },
      margin: { left: 14, right: 14 },
    });

  } else {
    // ── Standard: per-doctor sections ─────────────────────────────────────
    for (const [idx, section] of report.entries()) {
      const label = `${ALPHA[idx]?.toUpperCase() ?? String(idx + 1)})`;
      const rows: CommissionTestGroupRowX[] = Array.isArray(section.grouped) ? section.grouped : [];

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text(`${label} ${section.doctor.name}`, 14, y);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      doc.text(
        `${section.doctor.specialization}  ·  ${section.orderCount} orders  ·  ${section.testCount} tests  ·  Eff. Rate: ${section.effectiveRate}%`,
        14, y + 5,
      );
      doc.setTextColor(0);
      y += 9;

      const head = showBreakdown
        ? [["Test Name", "No of Tests", "Expected", "Discount", "Actual"]]
        : showPercentFixed
        ? [["Test Name", "No of Tests", "% / Fixed", "Total Amount"]]
        : [["Test Name", "No of Tests", "Total Amount"]];

      const body = [
        ...rows.map(r => {
          const rateLabel = r.ruleType === "percentage"
            ? `${r.ruleValue}%`
            : INR(r.ruleValue);
          const exp = r.expected ?? r.commission;
          return showBreakdown
            ? [r.testName, String(r.count), INR(exp), NEGD(exp - r.commission), INR(r.commission)]
            : showPercentFixed
            ? [r.testName, String(r.count), rateLabel, INR(r.commission)]
            : [r.testName, String(r.count), INR(r.commission)];
        }),
        showBreakdown
          ? ["", "Total \u2192", INR(section.totalExpected ?? section.totalCommission), NEGD(section.totalDiscount ?? 0), INR(section.totalCommission)]
          : showPercentFixed
          ? ["", "", "Total \u2192", INR(section.totalCommission)]
          : ["", "Total \u2192", INR(section.totalCommission)],
      ];

      const colStyles: Record<number, object> = showBreakdown
        ? {
            0: { cellWidth: "auto" },
            1: { halign: "center", cellWidth: 24 },
            2: { halign: "right", cellWidth: 32 },
            3: { halign: "right", cellWidth: 28 },
            4: { halign: "right", cellWidth: 32 },
          }
        : showPercentFixed
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

      autoTable(doc, {
        startY: y,
        head,
        body,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
        columnStyles: colStyles as Parameters<typeof autoTable>[1]["columnStyles"],
        bodyStyles: { textColor: [30, 30, 30] },
        willDrawCell: (data) => {
          if (data.row.index === rows.length) {
            doc.setFillColor(255, 251, 235);
            doc.setFont("helvetica", "bold");
            const lastCol = showBreakdown ? 4 : showPercentFixed ? 3 : 2;
            if (data.column.index === lastCol) doc.setTextColor(180, 83, 9);
          }
        },
        margin: { left: 14, right: 14 },
      });

      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      if (y > 260) { doc.addPage(); y = 20; }
    }

    // Grand total row at the bottom (when multiple doctors)
    if (report.length > 1) {
      const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(217, 119, 6);
      doc.roundedRect(14, y, pageW - 28, 10, 2, 2, "FD");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text(
        `Grand Total — ${g.doctors} doctor${g.doctors !== 1 ? "s" : ""}  ·  ${g.orders} orders`,
        16, y + 6.5,
      );
      doc.setTextColor(180, 83, 9);
      doc.text(INR(grandComm), pageW - 16, y + 6.5, { align: "right" });
      doc.setTextColor(0);
    }
  }

  const safeName = meta.title.replace(/\s+/g, "_");
  doc.save(`${safeName}_${meta.from}_to_${meta.to}.pdf`);
}
