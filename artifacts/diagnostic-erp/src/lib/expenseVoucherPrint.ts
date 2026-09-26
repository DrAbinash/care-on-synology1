/**
 * Expense / Payment Voucher print — reuses Billing Desk paper + delivery.
 * A5 (portrait/landscape) follows clinic billPrintSettingsJson.defaultFormat.
 * Print-only: never creates expenses, payments, or accounting vouchers.
 */

import { buildDocumentHtml } from "@/lib/documentLayout/buildDocumentHtml";
import { resolveBillPrintPaperFromOpts } from "@/lib/documentLayout/billPaper";
import { openBlankPrintWindow, writeAndPrint } from "@/lib/documentLayout/printDelivery";
import {
  loadBillPrintSettings,
  parseGlobalBillPrintSettings,
  resolveBillPrintPageOpts,
  type BillPrintSettings,
} from "@/lib/billPrintSettings";
import {
  billOf,
  dueOf,
  paidOf,
  vendorLabel,
  type ExpensePaymentRow,
  type ExpenseV2,
} from "@/components/expenses/expenseTypes";

/** Clinic branding + bill-print settings blob (same fields Billing Desk branding returns). */
export type ExpenseVoucherClinic = {
  name?: string | null;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  logoDataUrl?: string | null;
  footerNote?: string | null;
  billPrintSettingsJson?: string | null;
};

export type ExpenseWorkMetaPrint = {
  workType?: string | null;
  labourBasis?: string | null;
  days?: number | null;
  ratePerDay?: number | null;
  labourAmount?: number | null;
  materialAmount?: number | null;
};

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] || "";
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ""}`.trim();
}

function threeDigits(n: number): string {
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[h]} Hundred${rest ? ` ${twoDigits(rest)}` : ""}`.trim();
}

/** Indian-system amount in words for voucher acknowledgement (e.g. Rupees Seven Hundred Only). */
export function amountInIndianRupeesWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "Rupees Zero Only";
  const paiseTotal = Math.round(amount * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";

  let n = rupees;
  const crore = Math.floor(n / 1_00_00_000);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  let out = `Rupees ${parts.join(" ").trim() || "Zero"}`;
  if (paise) out += ` and ${twoDigits(paise)} Paise`;
  return `${out} Only`;
}

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const t = Date.parse(d.length <= 10 ? `${d}T00:00:00` : d);
  if (!Number.isFinite(t)) return esc(d);
  return new Date(t).toLocaleDateString("en-IN");
}

function parseMeta(raw?: string | null): ExpenseWorkMetaPrint | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as ExpenseWorkMetaPrint;
  } catch {
    return null;
  }
}

function row(label: string, value: string | null | undefined): string {
  if (value == null || String(value).trim() === "") return "";
  return `<tr><td class="lbl">${esc(label)}</td><td class="val">${esc(value)}</td></tr>`;
}

export function resolveExpenseVoucherPaper(clinic: ExpenseVoucherClinic | null | undefined): {
  paper: ReturnType<typeof resolveBillPrintPaperFromOpts>;
  pageOpts: ReturnType<typeof resolveBillPrintPageOpts>;
  settings: BillPrintSettings;
} {
  const settings = loadBillPrintSettings(
    parseGlobalBillPrintSettings(clinic?.billPrintSettingsJson ?? null),
  );
  // testCount=1 keeps A5 (same short-bill path as Billing Desk).
  const pageOpts = resolveBillPrintPageOpts(settings, 1);
  const paper = resolveBillPrintPaperFromOpts({
    paperSize: pageOpts.paperSize,
    orientation: pageOpts.orientation,
    pageCssSize: pageOpts.pageCssSize,
  });
  return { paper, pageOpts, settings };
}

export function buildExpenseVoucherHtml(opts: {
  expense: ExpenseV2;
  payments: ExpensePaymentRow[];
  clinic: ExpenseVoucherClinic | null | undefined;
  accountName?: string | null;
  subcategoryName?: string | null;
  /** When set, acknowledgement is for this payment only. */
  acknowledgePaymentId?: number | null;
}): string {
  const { expense: exp, payments, clinic, accountName, subcategoryName, acknowledgePaymentId } = opts;
  const { paper, settings } = resolveExpenseVoucherPaper(clinic);
  const meta = parseMeta(exp.metaJson);
  const bill = billOf(exp);
  const paid = paidOf(exp);
  const due = dueOf(exp);
  const activePays = payments.filter((p) => !p.reversedAt);
  const ackPay =
    acknowledgePaymentId != null
      ? activePays.find((p) => p.id === acknowledgePaymentId) ?? null
      : activePays.length === 1
        ? activePays[0]!
        : null;
  const ackAmount = ackPay ? Number(ackPay.amount) : paid;
  const payStatus = (exp.paymentStatus || "—").toUpperCase();
  const acctStatus = (exp.accountingStatus || "—").toUpperCase();
  const orgName = String(clinic?.name || "CARE Diagnostics").trim();
  const printedOn = new Date().toLocaleString("en-IN");
  const isLandscape = paper === "A5-landscape" || paper === "half-a4";
  const tagline = clinic?.tagline ? String(clinic.tagline) : "";
  const address = clinic?.address ? String(clinic.address) : "";
  const phone = clinic?.phone ? String(clinic.phone) : "";
  const email = clinic?.email ? String(clinic.email) : "";
  const footerNote = clinic?.footerNote ? String(clinic.footerNote) : "";

  const labourBasisLabel =
    meta?.labourBasis === "per_day"
      ? "Per Day"
      : meta?.labourBasis === "per_job"
        ? "Per Job"
        : meta?.labourBasis === "contract"
          ? "Contract"
          : meta?.labourBasis || "";

  const metaRows = [
    row("Work Type", meta?.workType),
    row("Labour Basis", labourBasisLabel || null),
    meta?.days != null ? row("Days", String(meta.days)) : "",
    meta?.ratePerDay != null ? row("Rate / Day", inr(Number(meta.ratePerDay))) : "",
    meta?.labourAmount != null ? row("Labour Amount", inr(Number(meta.labourAmount))) : "",
    meta?.materialAmount != null ? row("Material Amount", inr(Number(meta.materialAmount))) : "",
  ].join("");

  const payTable =
    activePays.length > 0
      ? `<table class="pays">
          <thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${activePays
              .map(
                (p) => `<tr>
              <td>${esc(fmtDate(p.paymentDate))}</td>
              <td>${esc((p.paymentMode || "").replace(/-/g, " "))}</td>
              <td>${esc(p.referenceNumber || "—")}</td>
              <td class="num">${esc(inr(Number(p.amount)))}</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <div class="pay-totals">Total Paid: <strong>${esc(inr(paid))}</strong> &nbsp;·&nbsp; Balance Due: <strong>${esc(inr(due))}</strong></div>`
      : `<p class="muted">No payments recorded — balance is fully due.</p>`;

  const logo = clinic?.logoDataUrl
    ? `<img class="logo" src="${clinic.logoDataUrl}" alt="" />`
    : "";

  const ackBlock =
    ackAmount > 0
      ? `<section class="ack">
          <div class="sec-title">Payment Acknowledgement</div>
          <p>I acknowledge receipt of <strong>${esc(inr(ackAmount))}</strong>
          (${esc(amountInIndianRupeesWords(ackAmount))})
          ${ackPay ? ` for payment dated ${esc(fmtDate(ackPay.paymentDate))}` : ""}
          for: <em>${esc(exp.description)}</em>.</p>
          <div class="sig-grid ack-grid">
            <div>Received By<br/><span class="line"></span></div>
            <div>Signature / Thumb<br/><span class="line"></span></div>
            <div>Date<br/><span class="line"></span></div>
            <div>Mobile (optional)<br/><span class="line"></span></div>
          </div>
        </section>`
      : "";

  const body = `
    <header class="hdr">
      <div class="hdr-left">
        ${logo}
        <div>
          <div class="org">${esc(orgName)}</div>
          ${tagline ? `<div class="tag">${esc(tagline)}</div>` : ""}
          ${address ? `<div class="addr">${esc(address)}</div>` : ""}
          <div class="addr">${[phone, email].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
      </div>
      <div class="hdr-right">
        <div class="doc-title">Expense / Payment Voucher</div>
        <div><strong>${esc(exp.expenseId)}</strong></div>
        <div>Date: ${esc(fmtDate(exp.expenseDate))}</div>
        <div class="muted">Printed: ${esc(printedOn)}</div>
      </div>
    </header>

    <table class="meta">
      ${row("Paid To / Vendor", vendorLabel(exp))}
      ${row("Category", exp.category)}
      ${row("Subcategory", subcategoryName)}
      ${row("Description / Purpose", exp.description)}
      ${metaRows}
    </table>

    <section class="fin">
      <div class="sec-title">Financial Details</div>
      <div class="fin-grid">
        <div><span class="lbl">Bill Amount</span><strong>${esc(inr(bill))}</strong></div>
        <div><span class="lbl">Amount Paid</span><strong>${esc(inr(paid))}</strong></div>
        <div><span class="lbl">Balance Due</span><strong>${esc(inr(due))}</strong></div>
      </div>
      <table class="meta tight">
        ${row("Payment Status", payStatus.replace(/_/g, " "))}
        ${row("Payment Mode", (exp.paymentMode || "").replace(/-/g, " ") || null)}
        ${row("Paid From Account", accountName)}
        ${row(
          "Reference / UTR",
          activePays.map((p) => p.referenceNumber).filter(Boolean).join(", ") || null,
        )}
        ${row("Invoice No", exp.invoiceNumber)}
        ${row("Invoice Date", exp.invoiceDate ? fmtDate(exp.invoiceDate) : null)}
        ${row("Accounting Status", acctStatus)}
        ${row(
          "Linked vouchers",
          [exp.voucherId ? `payment #${exp.voucherId}` : null, exp.accrualVoucherId ? `accrual #${exp.accrualVoucherId}` : null]
            .filter(Boolean)
            .join(" · ") || null,
        )}
      </table>
      <div class="words">
        <div class="lbl">Amount Paid in Words</div>
        <div><strong>${esc(inr(ackAmount))}</strong> — ${esc(amountInIndianRupeesWords(ackAmount))}</div>
      </div>
    </section>

    <section class="hist">
      <div class="sec-title">Payment History</div>
      ${payTable}
    </section>

    ${ackBlock}

    <section class="sigs">
      <div class="sig-grid">
        <div>Prepared By<br/><span class="line"></span><div class="hint">${esc(exp.createdBy || "")}</div></div>
        <div>Approved By / Drawer<br/><span class="line"></span><div class="hint">${esc(exp.approvedBy || "")}</div></div>
        <div>Paid By / Cashier<br/><span class="line"></span></div>
        <div>Received By<br/><span class="line"></span></div>
      </div>
    </section>

    <footer class="ft">
      Computer-generated expense voucher. Reprinting does not create accounting entries.
      ${settings.showComputerGenerated !== false ? " Recipient signature required where used as payment acknowledgement." : ""}
      ${footerNote ? ` ${esc(footerNote)}` : ""}
    </footer>
  `;

  const fontPx = isLandscape ? "10px" : "11px";
  return buildDocumentHtml({
    title: `Expense Voucher — ${exp.expenseId}`,
    paper,
    safePaddingMm: isLandscape ? 4 : 6,
    bodyFontFamily: "Arial, Helvetica, sans-serif",
    bodyFontSize: fontPx,
    pages: [{ html: body }],
    extraStyles: `
      .hdr { display:flex; justify-content:space-between; gap:8px; border-bottom:1.5px solid #000; padding-bottom:4px; margin-bottom:6px; }
      .hdr-left { display:flex; gap:6px; align-items:flex-start; min-width:0; flex:1; }
      .logo { height:36px; max-width:72px; object-fit:contain; }
      .org { font-size:13px; font-weight:700; line-height:1.2; }
      .tag, .addr { font-size:8px; color:#333; line-height:1.25; }
      .hdr-right { text-align:right; font-size:9px; line-height:1.3; white-space:nowrap; }
      .doc-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.02em; }
      .sec-title { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; margin:6px 0 3px; border-bottom:1px solid #999; padding-bottom:1px; }
      table.meta { width:100%; border-collapse:collapse; font-size:9px; }
      table.meta td { padding:1px 0; vertical-align:top; }
      table.meta.tight td { padding:0 0; }
      td.lbl { width:32%; color:#444; }
      td.val { font-weight:600; }
      .fin-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:4px; margin:3px 0 4px; }
      .fin-grid > div { border:1px solid #bbb; padding:3px 5px; }
      .fin-grid .lbl { display:block; font-size:8px; color:#555; text-transform:uppercase; }
      .fin-grid strong { font-size:11px; }
      .words { margin-top:3px; font-size:9px; }
      .words .lbl { font-size:8px; color:#555; text-transform:uppercase; }
      table.pays { width:100%; border-collapse:collapse; font-size:8px; }
      table.pays th, table.pays td { border:1px solid #ccc; padding:2px 4px; text-align:left; }
      table.pays th { background:#f0f0f0; font-weight:700; }
      table.pays .num { text-align:right; white-space:nowrap; }
      .pay-totals { font-size:8px; margin-top:2px; text-align:right; }
      .ack { margin-top:4px; border:1px dashed #666; padding:4px 6px; }
      .ack p { margin:2px 0 4px; font-size:9px; }
      .sig-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:6px; font-size:8px; }
      .ack-grid { grid-template-columns:repeat(2,1fr); }
      .line { display:block; border-bottom:1px solid #000; height:16px; margin-top:2px; }
      .hint { font-size:7px; color:#555; margin-top:1px; min-height:10px; }
      .ft { margin-top:6px; font-size:7px; color:#555; border-top:1px solid #ccc; padding-top:3px; }
      .muted { color:#666; font-size:8px; }
    `,
  });
}

/**
 * Opens Billing Desk print delivery (popup → browser print) for an expense voucher.
 * Caller must pass already-loaded expense + payments (GET only). No write APIs.
 */
export function printExpenseVoucher(opts: {
  expense: ExpenseV2;
  payments: ExpensePaymentRow[];
  clinic: ExpenseVoucherClinic | null | undefined;
  accountName?: string | null;
  subcategoryName?: string | null;
  acknowledgePaymentId?: number | null;
}): void {
  const popup = openBlankPrintWindow();
  const html = buildExpenseVoucherHtml(opts);
  writeAndPrint(popup, html);
}
