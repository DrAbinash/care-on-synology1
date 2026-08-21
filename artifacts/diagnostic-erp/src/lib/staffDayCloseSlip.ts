/**
 * Staff / My Day Close print slip — accounts reconciliation + denomination
 * + discounts / bill edits / voucher mods / expenses for the close window.
 * Deliberately omits test-wise collection (admin all-staff slip only).
 */

export type StaffSlipClinic = { name?: string; dayCloseAutoPrint?: boolean };

export type StaffPrintActivity = {
  discountsGiven: number;
  discountBills: Array<{
    billId: number;
    billNumber: string;
    patientName: string;
    totalAmount: number;
    discountGiven: number;
    grossAmount: number;
    discountReason: string | null;
    discountReasonNote: string | null;
  }>;
  billEdits: Array<{
    id: number;
    billId: number;
    billNumber: string;
    changeType: string;
    reason: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
  voucherEdits: Array<{
    id: number;
    voucherId: number;
    voucherNumber: string;
    changeType: string;
    reason: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
  expenseDetails: Array<{
    id: number;
    amount: number;
    category: string;
    description: string;
    paymentMode: string;
  }>;
  totalExpenses: number;
  cashExpenses: number;
  digitalExpenses: number;
};

export type StaffSlipClosure = {
  id: number;
  userName?: string;
  closureDate: string;
  closedAt: string;
  coveredFromTs: string | null;
  coveredToTs?: string | null;
  expectedCash: string | number;
  expectedUpi: string | number;
  expectedCard: string | number;
  expectedCheque: string | number;
  expectedOther: string | number;
  totalExpected: string | number;
  totalBilled: string | number;
  totalDue: string | number;
  billsCount: number;
  paymentsCount: number;
  actualCash: string | number;
  actualUpi: string | number;
  actualCard: string | number;
  actualCheque: string | number;
  actualOther: string | number;
  totalActual: string | number;
  variance: string | number;
  varianceNote?: string | null;
  notes?: string | null;
  drawerStatus?: string;
  denominations?: null | {
    d500: number; d200: number; d100: number;
    d50: number; d20: number; d10: number; coins: number;
  };
  denominationTotal?: string | number | null;
  printActivity?: StaffPrintActivity | null;
};

const DENOM_ROWS = [
  { key: "d500" as const, label: "₹500", value: 500 },
  { key: "d200" as const, label: "₹200", value: 200 },
  { key: "d100" as const, label: "₹100", value: 100 },
  { key: "d50" as const, label: "₹50", value: 50 },
  { key: "d20" as const, label: "₹20", value: 20 },
  { key: "d10" as const, label: "₹10", value: 10 },
  { key: "coins" as const, label: "Coins / <₹10", value: 1 },
];

function n(v: unknown): number {
  return Number(v ?? 0) || 0;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inr(v: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtIst(iso: string | null | undefined): string {
  if (!iso) return "Beginning of records";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function emptyActivity(): StaffPrintActivity {
  return {
    discountsGiven: 0,
    discountBills: [],
    billEdits: [],
    voucherEdits: [],
    expenseDetails: [],
    totalExpenses: 0,
    cashExpenses: 0,
    digitalExpenses: 0,
  };
}

export function buildStaffDayCloseSlipHtml(
  c: StaffSlipClosure,
  clinic: StaffSlipClinic,
  staffLabel?: string,
): string {
  const activity = c.printActivity ?? emptyActivity();
  const who = staffLabel || c.userName || "Staff";
  const expectedCash = n(c.expectedCash);
  const actualCash = n(c.actualCash);
  const expectedDigital =
    n(c.expectedUpi) + n(c.expectedCard) + n(c.expectedCheque) + n(c.expectedOther);
  const actualDigital =
    n(c.actualUpi) + n(c.actualCard) + n(c.actualCheque) + n(c.actualOther);
  const variance = n(c.variance);
  const varianceLabel =
    variance === 0
      ? `<span style="color:#166534">Balanced</span>`
      : `<span style="color:#991b1b">${esc(variance < 0 ? "−" : "+")}${esc(inr(Math.abs(variance)))}</span>`;

  const methodRows = (
    [
      ["Cash", n(c.expectedCash), n(c.actualCash)],
      ["UPI", n(c.expectedUpi), n(c.actualUpi)],
      ["Card", n(c.expectedCard), n(c.actualCard)],
      ["Cheque", n(c.expectedCheque), n(c.actualCheque)],
      ["Other", n(c.expectedOther), n(c.actualOther)],
    ] as const
  )
    .map(([label, e, a]) => {
      const d = a - e;
      const dLabel = d === 0 ? "—" : inr(d);
      const color = d === 0 ? "" : d < 0 ? "color:#991b1b" : "color:#b45309";
      return `<tr><td>${esc(label)}</td><td>${esc(inr(e))}</td><td>${esc(inr(a))}</td><td style="${color}">${esc(dLabel)}</td></tr>`;
    })
    .join("");

  const denoms = c.denominations;
  const denomRows = denoms
    ? DENOM_ROWS.filter(({ key }) => n(denoms[key]) > 0)
        .map(({ key, label, value }) => {
          const count = n(denoms[key]);
          const line = key === "coins" ? count : count * value;
          return `<tr><td>${esc(label)}</td><td>${count}</td><td>${esc(inr(line))}</td></tr>`;
        })
        .join("")
    : "";

  const discountRows = activity.discountBills
    .map(
      (b) =>
        `<tr><td>${esc(b.billNumber)}</td><td>${esc(b.patientName)}</td><td>${esc(inr(b.grossAmount))}</td><td>${esc(inr(b.discountGiven))}</td><td>${esc(b.discountReason || "—")}${b.discountReasonNote ? ` <span style="color:#64748b">(${esc(b.discountReasonNote)})</span>` : ""}</td></tr>`,
    )
    .join("");

  const editRows = activity.billEdits
    .map(
      (e) =>
        `<tr><td>${esc(e.billNumber)}</td><td>${esc(e.changeType)}</td><td>${esc(e.reason)}</td><td style="font-size:10px">${esc(e.oldValue ?? "—")} → ${esc(e.newValue ?? "—")}</td></tr>`,
    )
    .join("");

  const voucherRows = activity.voucherEdits
    .map(
      (e) =>
        `<tr><td>${esc(e.voucherNumber)}</td><td>${esc(e.changeType)}</td><td>${esc(e.reason)}</td><td style="font-size:10px">${esc(e.oldValue ?? "—")} → ${esc(e.newValue ?? "—")}</td></tr>`,
    )
    .join("");

  const expenseRows = activity.expenseDetails
    .map(
      (e) =>
        `<tr><td>${esc(e.category)}</td><td>${esc(e.description || "—")}</td><td>${esc(e.paymentMode)}</td><td>${esc(inr(e.amount))}</td></tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Staff Day Close ${esc(c.closureDate)} — ${esc(who)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: Arial, sans-serif; color:#1a1a2e; margin:0; padding:0; font-size:12px; }
    .header { text-align:center; padding:8px 0; border-bottom:3px solid #1e3a5f; margin-bottom:12px; }
    .header h1 { font-size:20px; margin:0; color:#1e3a5f; }
    .header .subtitle { font-size:12px; color:#64748b; margin-top:2px; }
    .section-title { background:#1e3a5f; color:#fff; font-size:12px; font-weight:700; padding:6px 10px; margin:16px 0 0; border-radius:4px 4px 0 0; }
    .table { width:100%; border-collapse:collapse; }
    .table th { background:#f1f5f9; padding:6px 8px; text-align:left; font-size:11px; font-weight:700; border-bottom:2px solid #e2e8f0; }
    .table td { padding:6px 8px; border-bottom:1px solid #f1f5f9; }
    .table td:last-child, .table th:last-child { text-align:right; }
    .two-col { display:flex; gap:16px; margin-top:8px; }
    .col { flex:1; }
    .col-table { width:100%; border-collapse:collapse; }
    .col-table th { background:#f1f5f9; padding:5px 8px; text-align:left; font-size:11px; font-weight:700; border-bottom:2px solid #e2e8f0; }
    .col-table td { padding:5px 8px; border-bottom:1px solid #f1f5f9; }
    .col-table td:last-child { text-align:right; font-weight:600; }
    .grand-row td { border-top:2px solid #1e3a5f; padding-top:6px; font-weight:700; font-size:13px; }
    .note { margin-top:8px; padding:6px; background:#fef9e7; border:1px dashed #d97706; font-size:11px; border-radius:4px; }
    .footer { margin-top:12px; text-align:center; font-size:10px; color:#666; padding-top:8px; border-top:1px solid #eee; }
    .muted { color:#888; text-align:center; padding:8px; }
  </style></head><body>

  <div class="header">
    <h1>${esc(clinic?.name || "Diagnostic Centre")}</h1>
    <div class="subtitle">Staff Day Close Reconciliation &middot; ${esc(c.closureDate)}</div>
    <div class="subtitle">${esc(who)} &middot; ${esc(fmtIst(c.coveredFromTs))} &rarr; ${esc(fmtIst(c.coveredToTs ?? c.closedAt))}</div>
  </div>

  <div class="two-col">
    <div class="col">
      <div class="section-title">Accounts Summary</div>
      <table class="col-table">
        <tbody>
          <tr><td>Bills Created</td><td>${c.billsCount}</td></tr>
          <tr><td>Payments</td><td>${c.paymentsCount}</td></tr>
          <tr><td>Total Billed</td><td>${esc(inr(n(c.totalBilled)))}</td></tr>
          <tr><td>Outstanding</td><td>${esc(inr(n(c.totalDue)))}</td></tr>
          <tr><td>Discounts Given</td><td>${esc(inr(activity.discountsGiven))}</td></tr>
          <tr><td>Total Expenses</td><td>${esc(inr(activity.totalExpenses))}</td></tr>
          <tr class="grand-row"><td>Expected Collected</td><td>${esc(inr(n(c.totalExpected)))}</td></tr>
          <tr><td>Actual Counted</td><td>${esc(inr(n(c.totalActual)))}</td></tr>
          <tr><td>Variance</td><td>${varianceLabel}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="col">
      <div class="section-title">Cash Reconciliation</div>
      <table class="col-table">
        <tbody>
          <tr><td>Expected Cash</td><td>${esc(inr(expectedCash))}</td></tr>
          <tr><td>Actual Cash</td><td>${esc(inr(actualCash))}</td></tr>
          <tr><td>Cash Variance</td><td style="color:${actualCash - expectedCash === 0 ? "#166534" : "#991b1b"}">${esc(inr(actualCash - expectedCash))}</td></tr>
          <tr><td>Expected Digital</td><td>${esc(inr(expectedDigital))}</td></tr>
          <tr><td>Actual Digital</td><td>${esc(inr(actualDigital))}</td></tr>
          <tr class="grand-row"><td>Total Actual</td><td>${esc(inr(n(c.totalActual)))}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="section-title">Method Reconciliation</div>
  <table class="table">
    <thead><tr><th>Method</th><th>Expected</th><th>Actual</th><th>Diff</th></tr></thead>
    <tbody>
      ${methodRows}
      <tr class="grand-row"><td>Total</td><td>${esc(inr(n(c.totalExpected)))}</td><td>${esc(inr(n(c.totalActual)))}</td><td>${varianceLabel}</td></tr>
    </tbody>
  </table>

  <div class="section-title">Denomination Count</div>
  <table class="table">
    <thead><tr><th>Denomination</th><th>Count</th><th>Amount</th></tr></thead>
    <tbody>
      ${denomRows || `<tr><td colspan="3" class="muted">No denomination count recorded</td></tr>`}
      ${denomRows ? `<tr class="grand-row"><td colspan="2">Denomination Total</td><td>${esc(inr(n(c.denominationTotal)))}</td></tr>` : ""}
    </tbody>
  </table>

  <div class="section-title">Discounts</div>
  <table class="table">
    <thead><tr><th>Bill #</th><th>Patient</th><th>Gross</th><th>Discount</th><th>Reason</th></tr></thead>
    <tbody>
      ${discountRows || `<tr><td colspan="5" class="muted">No discounts in this window</td></tr>`}
      ${discountRows ? `<tr class="grand-row"><td colspan="3">Total Discounts</td><td>${esc(inr(activity.discountsGiven))}</td><td></td></tr>` : ""}
    </tbody>
  </table>

  <div class="section-title">Bill Edits / Modifications</div>
  <table class="table">
    <thead><tr><th>Bill #</th><th>Type</th><th>Reason</th><th>Change</th></tr></thead>
    <tbody>
      ${editRows || `<tr><td colspan="4" class="muted">No bill edits in this window</td></tr>`}
    </tbody>
  </table>

  <div class="section-title">Voucher Modifications</div>
  <table class="table">
    <thead><tr><th>Voucher #</th><th>Type</th><th>Reason</th><th>Change</th></tr></thead>
    <tbody>
      ${voucherRows || `<tr><td colspan="4" class="muted">No voucher modifications in this window</td></tr>`}
    </tbody>
  </table>

  <div class="section-title">Expenses</div>
  <table class="table">
    <thead><tr><th>Category</th><th>Description</th><th>Mode</th><th>Amount</th></tr></thead>
    <tbody>
      ${expenseRows || `<tr><td colspan="4" class="muted">No expenses in this window</td></tr>`}
      ${expenseRows ? `<tr class="grand-row"><td colspan="3">Total (Cash ${esc(inr(activity.cashExpenses))} / Digital ${esc(inr(activity.digitalExpenses))})</td><td>${esc(inr(activity.totalExpenses))}</td></tr>` : ""}
    </tbody>
  </table>

  ${c.varianceNote ? `<div class="note"><strong>Variance Note:</strong> ${esc(c.varianceNote)}</div>` : ""}
  ${c.notes ? `<div class="note"><strong>Handover Notes:</strong> ${esc(c.notes)}</div>` : ""}
  <div class="footer">Printed ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST &middot; Staff Closure #${c.id}${c.drawerStatus ? ` &middot; ${esc(c.drawerStatus)}` : ""}</div>
</body></html>`;
}

export function openStaffDayClosePrint(
  c: StaffSlipClosure,
  clinic: StaffSlipClinic,
  staffLabel?: string,
): Window | null {
  const html = buildStaffDayCloseSlipHtml(c, clinic, staffLabel);
  const w = window.open("", "_blank", "width=900,height=800");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups to print the day-close slip.");
    return null;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return w;
}

export function autoPrintStaffDayClose(
  c: StaffSlipClosure,
  clinic: StaffSlipClinic,
  staffLabel?: string,
): void {
  const w = openStaffDayClosePrint(c, clinic, staffLabel);
  if (!w) return;
  w.onload = () => {
    w.focus();
    w.print();
    setTimeout(() => w.close(), 800);
  };
}
