/**
 * Per-doctor commission statement PDF for the Super Admin Portal.
 *
 * A formal, printable statement of account for a single referral doctor:
 * header, summary of account, the running ledger (earned vs paid), and the
 * On Hold / Reversed sections so the doctor sees exactly why the payable
 * figure is what it is. Read-only — it renders whatever the Doctor Ledger
 * detail endpoint returns and never recomputes balances.
 */

import { loadReportOrientation, type PaperOrientation } from "@/lib/paperSize";

const INR = (n: number) =>
  "Rs." + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The detail endpoint returns a few fields the generated client type does not
// yet carry (held/clawback additions). Describe the shape we actually consume.
export type StatementDetail = {
  doctor: { id: number; name: string; specialization?: string | null; phone?: string | null; email?: string | null };
  window: { from: string | null; to: string | null };
  summary: {
    totalRevenue: number;
    totalEarned: number;
    totalHeld?: number;
    totalPaid: number;
    totalClawback?: number;
    dueWindow: number;
    lifetimeEarned: number;
    lifetimePaid: number;
    outstanding: number;
    orderCount: number;
    heldOrderCount?: number;
    clawbackCount?: number;
    payoutCount: number;
  };
  ledger: ReadonlyArray<{ kind: string; date: string; particular: string; credit: number; debit: number; balance: number }>;
  earnedOrders?: ReadonlyArray<{ orderNumber: string; commission: number; held?: boolean; holdReason?: string | null }>;
  clawbacks?: ReadonlyArray<{ orderId: number; amount: number; reason: string; at: string }>;
};

export type StatementMeta = {
  clinicName?: string;
  generatedAt: string;
  orientation?: PaperOrientation;
};

export async function exportDoctorStatementPdf(detail: StatementDetail, meta: StatementMeta): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const orientation: PaperOrientation = meta.orientation ?? loadReportOrientation();
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  const s = detail.summary;
  const held = s.totalHeld ?? 0;
  const clawback = s.totalClawback ?? 0;
  const fromLabel = detail.window.from || "Beginning";
  const toLabel = detail.window.to || "Present";

  // ── Header ───────────────────────────────────────────────────────────────
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text((meta.clinicName || "Commission Statement").toUpperCase(), pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  doc.text("Referral Commission — Statement of Account", pageW / 2, y, { align: "center" });
  y += 8;
  doc.setDrawColor(210);
  doc.line(14, y, pageW - 14, y);
  y += 8;

  // ── Doctor + period block ─────────────────────────────────────────────────
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Dr. ${detail.doctor.name}`, 14, y);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Statement Period: ${fromLabel}  to  ${toLabel}`, pageW - 14, y, { align: "right" });
  y += 5;
  const contact = [detail.doctor.specialization, detail.doctor.phone, detail.doctor.email].filter(Boolean).join("  ·  ");
  if (contact) { doc.text(contact, 14, y); }
  doc.text(`Generated: ${meta.generatedAt}`, pageW - 14, y, { align: "right" });
  y += 8;
  doc.setTextColor(0);

  // ── Summary of account ────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [["Summary of Account", "Amount"]],
    body: [
      ["Total business referred (revenue)", INR(s.totalRevenue)],
      ["Commission earned — eligible", INR(s.totalEarned)],
      ...(held > 0.005 ? [["Commission on hold — not payable yet", INR(held)]] : []),
      ...(clawback > 0.005 ? [["Reversed after eligibility (clawback)", "-" + INR(clawback)]] : []),
      ["Paid to date", INR(s.totalPaid)],
    ],
    foot: [["Net payable (outstanding)", INR(s.outstanding)]],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [254, 243, 199], textColor: [180, 83, 9], fontStyle: "bold", fontSize: 10 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { halign: "right", cellWidth: 45 } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Ledger entries ────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Ledger", 14, y);
  y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Date", "Particular", "Earned", "Paid", "Balance"]],
    body: detail.ledger.length
      ? detail.ledger.map(e => [
          e.date,
          e.particular,
          e.credit ? INR(e.credit) : "",
          e.debit ? INR(e.debit) : "",
          INR(e.balance),
        ])
      : [["", "No entries in this period", "", "", ""]],
    foot: detail.ledger.length
      ? [["", "Window totals", INR(s.totalEarned), INR(s.totalPaid), INR(s.dueWindow)]]
      : undefined,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [243, 244, 246], textColor: [80, 80, 80], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [249, 250, 251], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: "auto" },
      2: { halign: "right", cellWidth: 28 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 30 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── On Hold section ────────────────────────────────────────────────────────
  const heldOrders = (detail.earnedOrders ?? []).filter(o => o.held);
  if (heldOrders.length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 40, 40);
    doc.text(`On Hold — not payable yet (${heldOrders.length})`, 14, y);
    doc.setTextColor(0);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [["Order", "Reason for Hold", "Commission"]],
      body: heldOrders.map(o => [o.orderNumber, o.holdReason ?? "On hold", INR(o.commission)]),
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { fillColor: [254, 226, 226], textColor: [153, 27, 27], fontStyle: "bold", fontSize: 8 },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: "auto" }, 2: { halign: "right", cellWidth: 32 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Reversed / clawback section ────────────────────────────────────────────
  const clawbacks = detail.clawbacks ?? [];
  if (clawbacks.length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 83, 9);
    doc.text(`Reversed after eligibility (${clawbacks.length})`, 14, y);
    doc.setTextColor(0);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [["Order", "Reason", "Amount"]],
      body: clawbacks.map(c => [`#${c.orderId}`, c.reason, "-" + INR(c.amount)]),
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { fillColor: [254, 243, 199], textColor: [146, 64, 14], fontStyle: "bold", fontSize: 8 },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: "auto" }, 2: { halign: "right", cellWidth: 32 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Footer note + signature line ───────────────────────────────────────────
  if (y > 250) { doc.addPage(); y = 20; }
  y += 6;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(120);
  doc.text(
    "Held commission is calculated but excluded from the payable total until its eligibility condition is met. This statement is system-generated.",
    14, y, { maxWidth: pageW - 28 },
  );
  y += 14;
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.line(14, y, 74, y);
  doc.line(pageW - 74, y, pageW - 14, y);
  y += 4;
  doc.setTextColor(100);
  doc.text("Received by (Doctor)", 14, y);
  doc.text("Authorised signatory", pageW - 74, y);

  const safeName = detail.doctor.name.replace(/[^a-z0-9]+/gi, "_");
  doc.save(`Commission_Statement_${safeName}_${fromLabel}_to_${toLabel}.pdf`);
}
