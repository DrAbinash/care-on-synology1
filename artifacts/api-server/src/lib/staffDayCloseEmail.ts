import type { StaffPrintActivity } from "./postClosureActivityTypes";

export type StaffDayCloseEmailPayload = {
  clinicName: string;
  staffName: string;
  closureDate: string;
  closedAt: Date;
  coveredFromTs: Date | null;
  coveredToTs: Date;
  totalBilled: number;
  totalDue: number;
  totalExpected: number;
  totalActual: number;
  variance: number;
  expectedCash: number;
  expectedUpi: number;
  expectedCard: number;
  expectedCheque: number;
  expectedOther: number;
  actualCash: number;
  actualUpi: number;
  actualCard: number;
  actualCheque: number;
  actualOther: number;
  denominations?: null | {
    d500: number; d200: number; d100: number;
    d50: number; d20: number; d10: number; coins: number;
  };
  denominationTotal?: number | null;
  varianceNote?: string;
  notes?: string;
  drawerStatus?: string;
  closureId: number;
  printActivity: StaffPrintActivity;
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

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inr(v: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function fmtIst(iso: Date | null | undefined): string {
  if (!iso) return "Beginning of records";
  return iso.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function line(label: string, amount: number, hideZero = false): string {
  if (hideZero && amount === 0) return "";
  return `<tr><td style="padding:8px 10px;border-bottom:2px solid #000;font-weight:700;font-size:15px">${esc(label)}</td><td style="padding:8px 10px;border-bottom:2px solid #000;text-align:right;font-weight:800;font-size:15px;font-variant-numeric:tabular-nums">${esc(inr(amount))}</td></tr>`;
}

function methodRow(label: string, amount: number): string {
  if (amount === 0) return "";
  return `<tr><td style="padding:6px 10px;border-bottom:1px solid #ccc;font-weight:700">${esc(label)}</td><td style="padding:6px 10px;border-bottom:1px solid #ccc;text-align:right;font-weight:800;font-variant-numeric:tabular-nums">${esc(inr(amount))}</td></tr>`;
}

/** HTML email body mirroring the A5 staff reconciliation slip. */
export function buildStaffDayCloseEmailHtml(p: StaffDayCloseEmailPayload): string {
  const activity = p.printActivity;
  const discounts = activity.discountsGiven;
  const editCount = activity.billEdits.length + activity.voucherEdits.length;

  const denomHtml = p.denominations
    ? DENOM_ROWS.filter(({ key }) => (p.denominations![key] ?? 0) > 0)
        .map(({ key, label, value }) => {
          const count = p.denominations![key];
          const total = key === "coins" ? count : count * value;
          const text = key === "coins"
            ? `${label} = ${inr(total)}`
            : `${label} × ${count} = ${inr(total)}`;
          return `<div style="font-weight:800;font-size:14px;padding:4px 0;border-bottom:1px dashed #999">${esc(text)}</div>`;
        })
        .join("")
    : `<div style="color:#666;font-weight:700">No denomination count recorded</div>`;

  const expenseHtml = activity.expenseDetails.length
    ? activity.expenseDetails.map((e, i) => {
        const label = [e.category, e.description].filter(Boolean).join(" — ") || "Expense";
        return `<div style="padding:4px 0;font-weight:700">${i + 1}. ${esc(label)} <span style="float:right;font-weight:900">Rs. ${esc(inr(e.amount))}</span></div>`;
      }).join("")
    : "";

  const varianceColor = p.variance === 0 ? "#166534" : "#991b1b";
  const varianceLabel = p.variance === 0 ? "Balanced" : `${p.variance < 0 ? "Short" : "Surplus"} ${inr(Math.abs(p.variance))}`;

  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#000">
  <div style="border-bottom:4px solid #000;padding-bottom:10px;margin-bottom:12px;text-align:center">
    <h1 style="margin:0;font-size:24px;font-weight:900;letter-spacing:0.04em">${esc(p.clinicName.toUpperCase())}</h1>
    <p style="margin:6px 0 0;font-size:16px;font-weight:800">Staff Reconciliation</p>
    <p style="margin:4px 0 0;font-size:15px;font-weight:800">${esc(p.staffName)}</p>
    <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#333">${esc(fmtIst(p.closedAt))} · Window ${esc(fmtIst(p.coveredFromTs))} → ${esc(fmtIst(p.coveredToTs))}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr>
      <td style="width:50%;vertical-align:top;padding-right:8px">
        <div style="font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:3px solid #000;padding-bottom:4px;margin-bottom:6px">Summary</div>
        <table style="width:100%;border-collapse:collapse">
          ${line("Total Bill Generated", p.totalBilled)}
          ${line("Outstanding", p.totalDue, true)}
          ${line("Discounts", discounts, true)}
          ${line("Expected", p.totalExpected)}
          ${methodRow("UPI", p.expectedUpi)}
          ${methodRow("CASH", p.expectedCash)}
          ${methodRow("CARD", p.expectedCard)}
          ${methodRow("CHEQUE", p.expectedCheque)}
          ${methodRow("OTHER", p.expectedOther)}
        </table>
      </td>
      <td style="width:50%;vertical-align:top;padding-left:8px">
        <div style="font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:3px solid #000;padding-bottom:4px;margin-bottom:6px">Cash Count</div>
        ${denomHtml}
        ${p.denominationTotal != null ? `<div style="margin-top:6px;padding-top:6px;border-top:3px solid #000;text-align:right;font-weight:900;font-size:16px">${esc(inr(p.denominationTotal))}</div>` : ""}
      </td>
    </tr>
  </table>

  <div style="border-top:3px solid #000;padding-top:8px;margin-bottom:10px">
    <div style="font-weight:900;font-size:14px;text-transform:uppercase;margin-bottom:4px">Bills Edited / Modified</div>
    <div style="font-weight:700">(Total No.) = <strong>${editCount}</strong></div>
  </div>

  ${expenseHtml ? `
  <div style="border-top:3px solid #000;padding-top:8px;margin-bottom:10px">
    <div style="font-weight:900;font-size:14px;text-transform:uppercase;margin-bottom:4px">Expenses</div>
    ${expenseHtml}
    <div style="border-top:3px solid #000;margin-top:6px;padding-top:6px;text-align:right;font-weight:900">${esc(inr(activity.totalExpenses))}</div>
  </div>` : ""}

  <div style="border:3px solid #000;padding:10px;margin-top:12px;font-weight:800">
    Counted: ${esc(inr(p.totalActual))} · Expected: ${esc(inr(p.totalExpected))} ·
    <span style="color:${varianceColor}">${esc(varianceLabel)}</span>
  </div>

  ${p.varianceNote ? `<p style="margin:10px 0 0;font-weight:700"><strong>Variance note:</strong> ${esc(p.varianceNote)}</p>` : ""}
  ${p.notes ? `<p style="margin:8px 0 0;font-weight:700"><strong>Handover:</strong> ${esc(p.notes)}</p>` : ""}

  <p style="margin:16px 0 0;font-size:11px;color:#666;text-align:center">
    Closure #${p.closureId}${p.drawerStatus ? ` · ${esc(p.drawerStatus)}` : ""} · Care Diagnostics ERP
  </p>
</div>`;
}
