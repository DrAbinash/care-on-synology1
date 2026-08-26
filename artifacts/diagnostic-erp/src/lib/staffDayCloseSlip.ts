/**
 * Staff / My Day Close print slip — compact A5 reconciliation receipt
 * (matches handwritten clinic slip: bold type, two-column summary + denominations).
 */

export type StaffSlipClinic = {
  name?: string;
  logoDataUrl?: string | null;
  dayCloseAutoPrint?: boolean;
};

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
  /** Optional — when supplied, shown on slip; hidden when zero. */
  totalRefunds?: string | number;
  /** Optional — dues collected against older bills in this window; hidden when zero. */
  dueReceived?: string | number;
  denominations?: null | {
    d500: number; d200: number; d100: number;
    d50: number; d20: number; d10: number; coins: number;
  };
  denominationTotal?: string | number | null;
  printActivity?: StaffPrintActivity | null;
};

const DENOM_ROWS = [
  { key: "d500" as const, label: "500", value: 500 },
  { key: "d200" as const, label: "200", value: 200 },
  { key: "d100" as const, label: "100", value: 100 },
  { key: "d50" as const, label: "50", value: 50 },
  { key: "d20" as const, label: "20", value: 20 },
  { key: "d10" as const, label: "10", value: 10 },
  { key: "coins" as const, label: "Coins", value: 1 },
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtIstDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function fmtIstTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
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

function summaryLine(label: string, amount: number, opts?: { strong?: boolean; hideZero?: boolean }): string {
  if (opts?.hideZero && amount === 0) return "";
  const cls = opts?.strong ? "line strong" : "line";
  return `<div class="${cls}"><span class="lbl">${esc(label)}</span><span class="val">${esc(inr(amount))}</span></div>`;
}

function methodLine(label: string, amount: number): string {
  if (amount === 0) return "";
  return `<div class="line method"><span class="lbl">${esc(label)}</span><span class="val">${esc(inr(amount))}</span></div>`;
}

export function buildStaffDayCloseSlipHtml(
  c: StaffSlipClosure,
  clinic: StaffSlipClinic,
  staffLabel?: string,
): string {
  const activity = c.printActivity ?? emptyActivity();
  const who = staffLabel || c.userName || "Staff";
  const clinicName = (clinic?.name || "CARE DIAGNOSTICS").toUpperCase();
  const logoHtml = clinic?.logoDataUrl
    ? `<img class="logo" src="${esc(clinic.logoDataUrl)}" alt="" />`
    : `<div class="logo-ph">LOGO</div>`;

  const totalBilled = n(c.totalBilled);
  const totalDue = n(c.totalDue);
  const totalExpected = n(c.totalExpected);
  const discounts = n(activity.discountsGiven);
  const refunds = n(c.totalRefunds);
  const dueReceived = n(c.dueReceived);
  const variance = n(c.variance);

  const closedAt = c.coveredToTs ?? c.closedAt;
  const headerWhen = `${fmtIstDate(closedAt)} ${fmtIstTime(closedAt)}`.trim();
  const windowFrom = fmtIstDate(c.coveredFromTs);
  const windowTo = fmtIstTime(closedAt);

  const denoms = c.denominations;
  const denomLines = denoms
    ? DENOM_ROWS.filter(({ key }) => n(denoms[key]) > 0)
        .map(({ key, label, value }) => {
          const count = n(denoms[key]);
          const lineTotal = key === "coins" ? count : count * value;
          if (key === "coins") {
            return `<div class="denom">${esc(label)} = ${esc(inr(lineTotal))}</div>`;
          }
          return `<div class="denom">${esc(label)} × ${count} = ${esc(inr(lineTotal))}</div>`;
        })
        .join("")
    : "";

  const denomTotal = n(c.denominationTotal);
  const denomBlock = denomLines
    ? `${denomLines}<div class="denom total">${esc(inr(denomTotal))}</div>`
    : `<div class="denom muted">—</div>`;

  const editCount = activity.billEdits.length + activity.voucherEdits.length;
  const expenseLines = activity.expenseDetails
    .map((e, i) => {
      const label = [e.category, e.description].filter(Boolean).join(" — ") || "Expense";
      return `<div class="expense"><span class="exp-no">${i + 1}.</span> ${esc(label)} <span class="exp-amt">Rs. ${esc(inr(e.amount))}</span></div>`;
    })
    .join("");

  const methodBlock = [
    methodLine("UPI", n(c.expectedUpi)),
    methodLine("CASH", n(c.expectedCash)),
    methodLine("CARD", n(c.expectedCard)),
    methodLine("CHEQUE", n(c.expectedCheque)),
    methodLine("OTHER", n(c.expectedOther)),
  ].join("");

  const varianceHtml =
    variance === 0
      ? `<div class="note ok">Balanced — no variance</div>`
      : `<div class="note warn">Variance ${variance < 0 ? "short" : "surplus"}: ${esc(inr(Math.abs(variance)))}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Staff Reconciliation ${esc(c.closureDate)}</title>
<style>
  @page { size: 148mm 210mm; margin: 6mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    margin: 0;
    padding: 0;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .slip { width: 100%; max-width: 136mm; margin: 0 auto; }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 3px solid #000;
    padding-bottom: 6px;
    margin-bottom: 6px;
  }
  .logo { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
  .logo-ph {
    width: 52px; height: 52px; border: 2px solid #000;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800; flex-shrink: 0;
  }
  .brand { flex: 1; text-align: center; }
  .brand h1 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 0.04em; }
  .brand .sub { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .brand .who { font-size: 14px; font-weight: 800; margin-top: 4px; text-transform: uppercase; }
  .brand .when { font-size: 12px; font-weight: 700; color: #222; }
  .cols {
    display: flex;
    gap: 10px;
    border-bottom: 3px solid #000;
    padding-bottom: 8px;
    margin-bottom: 8px;
  }
  .col { flex: 1; min-width: 0; }
  .col-h {
    font-size: 13px;
    font-weight: 900;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 3px;
    margin-bottom: 5px;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    padding: 2px 0;
    font-size: 14px;
    font-weight: 700;
    border-bottom: 1px solid #ccc;
  }
  .line.strong {
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
    margin-top: 4px;
    padding-top: 4px;
    font-size: 15px;
    font-weight: 900;
  }
  .line.method { font-size: 14px; font-weight: 800; }
  .lbl { flex: 1; }
  .val { white-space: nowrap; font-variant-numeric: tabular-nums; text-align: right; }
  .denom {
    font-size: 14px;
    font-weight: 800;
    padding: 2px 0;
    font-variant-numeric: tabular-nums;
    border-bottom: 1px dashed #999;
  }
  .denom.total {
    border-top: 2px solid #000;
    border-bottom: none;
    margin-top: 4px;
    padding-top: 4px;
    font-size: 16px;
    font-weight: 900;
    text-align: right;
  }
  .denom.muted { color: #666; font-weight: 700; }
  .section {
    margin-top: 8px;
    padding-top: 4px;
    border-top: 2px solid #000;
  }
  .section-h {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .expense {
    font-size: 14px;
    font-weight: 700;
    padding: 2px 0 2px 8px;
  }
  .exp-no { font-weight: 900; }
  .exp-amt { float: right; font-weight: 900; font-variant-numeric: tabular-nums; }
  .exp-total {
    border-top: 2px solid #000;
    margin-top: 4px;
    padding-top: 4px;
    font-size: 15px;
    font-weight: 900;
    text-align: right;
  }
  .note {
    margin-top: 8px;
    padding: 5px 6px;
    border: 2px solid #000;
    font-size: 13px;
    font-weight: 800;
  }
  .note.ok { background: #f0fdf4; }
  .note.warn { background: #fef2f2; }
  .footer {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 2px solid #000;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
  }
</style></head><body>
<div class="slip">
  <div class="top">
    ${logoHtml}
    <div class="brand">
      <h1>${esc(clinicName)}</h1>
      <div class="sub">Staff Reconciliation</div>
      <div class="who">${esc(who)}</div>
      <div class="when">${esc(headerWhen)}${windowFrom !== fmtIstDate(closedAt) ? ` · from ${esc(windowFrom)} ${esc(windowTo)}` : ""}</div>
    </div>
  </div>

  <div class="cols">
    <div class="col">
      <div class="col-h">Summary</div>
      ${summaryLine("Total Bill Generated", totalBilled)}
      ${summaryLine("Outstanding", totalDue, { hideZero: true })}
      ${summaryLine("Due Received", dueReceived, { hideZero: true })}
      ${summaryLine("Discounts", discounts, { hideZero: true })}
      ${summaryLine("REFUNDS", refunds, { hideZero: true })}
      ${summaryLine("Expected", totalExpected, { strong: true })}
      ${methodBlock}
    </div>
    <div class="col">
      <div class="col-h">Cash Count</div>
      ${denomBlock}
    </div>
  </div>

  <div class="section">
    <div class="section-h">Bills Edited / Modified</div>
    <div class="expense">(Total No.) = <strong>${editCount}</strong>${editCount === 0 ? " — none" : ""}</div>
  </div>

  ${activity.expenseDetails.length > 0 ? `
  <div class="section">
    <div class="section-h">Expenses</div>
    ${expenseLines}
    <div class="exp-total">${esc(inr(activity.totalExpenses))}</div>
  </div>` : ""}

  ${varianceHtml}
  ${c.varianceNote ? `<div class="note">${esc(c.varianceNote)}</div>` : ""}
  ${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ""}

  <div class="footer">
    Closure #${c.id}${c.drawerStatus ? ` · ${esc(c.drawerStatus)}` : ""}
    · Printed ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST
  </div>
</div>
</body></html>`;
}

export function openStaffDayClosePrint(
  c: StaffSlipClosure,
  clinic: StaffSlipClinic,
  staffLabel?: string,
): Window | null {
  const html = buildStaffDayCloseSlipHtml(c, clinic, staffLabel);
  const w = window.open("", "_blank", "width=520,height=760");
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
