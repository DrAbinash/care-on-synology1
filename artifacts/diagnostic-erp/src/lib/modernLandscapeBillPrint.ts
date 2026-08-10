/**
 * modernLandscapeBillPrint.ts
 *
 * "Modern — A5 Landscape" bill format optimized for Epson L130 ink tank printers.
 * A5 landscape = 210mm × 148mm (half of A4 cut lengthwise).
 *
 * Key design decisions for Epson L130:
 * - 10mm top margin to clear the printer's unprintable top band (~3-4mm) plus header breathing room
 * - Full-width header with logo/clinic left, INVOICE/Bill No right
 * - Prominent Bill No. on one line with the number (14px bold)
 * - 65/35 split for tests table vs totals sidebar — gives tests room to breathe
 * - Tabular-nums for all amounts so columns align perfectly
 * - No background colors except the balance-due callout (saves ink on ink tank)
 */

import type { BuildPrintHtmlOpts } from "./printBill";
import { resolveBillLogoHeightPx } from "./billPrintSettings";
import { buildDocumentHtml } from "./documentLayout/buildDocumentHtml";
import { resolveBillPrintPaperFromOpts } from "./documentLayout/billPaper";

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcAge(dob?: string | null, ageValue?: number | null, ageUnit?: string | null): string {
  if (ageValue != null && ageValue > 0 && ageUnit) {
    if (ageUnit === "years") return `${ageValue} Y`;
    if (ageUnit === "months") return `${ageValue} M`;
    if (ageUnit === "days") return `${ageValue} D`;
  }
  if (!dob) return "";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y--;
  return y > 0 ? `${y} Y` : "";
}

function sessionField(key: "name" | "signatureDataUrl"): string {
  try {
    if (typeof window === "undefined") return "";
    const raw = window.localStorage.getItem("erp_session");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (key === "name") return String(parsed.user?.name ?? "");
    return String(parsed.user?.signatureDataUrl ?? "");
  } catch {
    return "";
  }
}

export function buildModernLandscapeBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  const { bill, clinic, isBW, qrDataUrl, reprintBy, reprintReason, provisionalReceipt = false } = opts;
  const copies = Math.max(1, Math.min(2, Number(clinic?.billPrintCopies ?? 1) || 1));
  const showCode = clinic?.billShowCode !== false;
  const showCat = clinic?.billShowCategory !== false;
  const qrEnabled = clinic?.qrOnBillEnabled !== false && (opts.showQr ?? true);
  const showTat = (opts.showTat ?? clinic?.showTatOnBill) === true;

  const tests = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") === "cancelled");
  const billDigits = String(bill.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ageStr = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const ageGender = [ageStr, bill.patient?.gender].filter(Boolean).join(" / ").toUpperCase();
  const created = bill.createdAt ? new Date(bill.createdAt) : new Date();
  const dateStr = created.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const isCancelled = (bill.status ?? "") === "cancelled";
  const isUnconfirmedQr = (bill.payments ?? []).some((p) => String(p.method).includes("Unconfirmed"));
  const rawDoctor = bill.order?.doctor?.name ?? "";

  // Aggregate payments by mode
  const payByMode: Record<string, number> = {};
  for (const p of bill.payments ?? []) {
    const k = String(p.method).toLowerCase().trim();
    payByMode[k] = (payByMode[k] || 0) + Number(p.amount || 0);
  }
  const cashAmt = payByMode["cash"] || 0;
  const upiAmt = payByMode["upi"] || 0;
  const cardAmt = payByMode["card"] || 0;
  const insAmt = payByMode["insurance"] || 0;
  const chqAmt = payByMode["cheque"] || 0;
  const paidAmt = Number(bill.paidAmount || 0);
  const balAmt = Number(bill.balanceAmount || 0);

  // Colors — minimal for ink tank efficiency
  const accent = isBW ? "#000" : "#1e3a5f";
  const bad = isBW ? "#000" : "#b91c1c";
  const good = isBW ? "#000" : "#15803d";
  const balColor = balAmt > 0 ? bad : good;
  const balBg = isBW ? "#eee" : balAmt > 0 ? "#fef2f2" : "#f0fdf4";

  // Font sizes — tuned for A5 landscape readability at arm's length
  const titleSize = `${opts.printTitleFontPx ?? 18}px`;
  const billNoSize = `${Math.max(14, (opts.printTitleFontPx ?? 18) - 4)}px`;
  const patientSz = `${opts.printPatientNameFontPx ?? 14}px`;
  const bodyPx = `${opts.printBodyFontPx ?? 11}px`;
  const headerPx = `${opts.printHeaderFontPx ?? 10}px`;
  const tablePx = `${opts.printTableFontPx ?? 11}px`;
  const totalPx = `${opts.printTotalFontPx ?? 12}px`;
  const footerPx = `${opts.printFooterFontPx ?? 10}px`;
  const tinyPx = `${opts.printTinyFontPx ?? 9}px`;

  const logoH = resolveBillLogoHeightPx(opts.printLogoHeightPx, 50);
  const logoMaxW = Math.round(logoH * 2.2);
  const logoImg = clinic?.logoDataUrl
    ? `<img src="${clinic.logoDataUrl}" alt="" style="height:${logoH}px;max-width:${logoMaxW}px;object-fit:contain;display:block"/>`
    : "";

  const billedByName = sessionField("name");
  const billedBySigUrl = sessionField("signatureDataUrl");

  const testRow = (t: (typeof tests)[number], i: number) => {
    const name = t.displayName ?? t.test?.name ?? "—";
    const code = t.test?.code ?? "";
    const cat = t.test?.category ?? "";
    const tat = (t.test?.duration ?? "").trim();
    return `<tr>
      <td style="padding:3px 4px;text-align:center;color:#64748b;font-variant-numeric:tabular-nums;width:5%">${i + 1}</td>
      ${showCode ? `<td style="padding:3px 4px;font-family:ui-monospace,Menlo,monospace;font-size:${Math.max(9, parseInt(tablePx, 10) - 1)}px;color:#334155;white-space:nowrap;width:11%">${esc(code)}</td>` : ""}
      <td style="padding:3px 4px;color:#0f172a">${esc(name)}${showCat && cat ? `<span style="color:#94a3b8;font-size:${tinyPx};margin-left:4px">${esc(cat)}</span>` : ""}</td>
      ${showTat ? `<td style="padding:3px 4px;color:#64748b;font-size:${tinyPx};white-space:nowrap;width:10%">${esc(tat || "—")}</td>` : ""}
      <td style="padding:3px 4px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:#0f172a;white-space:nowrap;width:16%">₹${fmt(t.price)}</td>
    </tr>`;
  };

  const cancelledFooter = cancelled.length
    ? `<div style="margin-top:3px;font-size:${tinyPx};color:#94a3b8">Cancelled: ${cancelled.map((t) => esc(t.displayName ?? t.test?.name ?? "—")).join(", ")}</div>`
    : "";

  const totalsRow = (
    label: string,
    value: string,
    bold = false,
    rowOpts: { color?: string; borderTop?: boolean } = {},
  ) => `
    <tr>
      <td style="padding:2px 0;color:${rowOpts.color ?? "#334155"};font-size:${totalPx};${rowOpts.borderTop ? "border-top:1px solid #cbd5e1;padding-top:4px;" : ""}${bold ? "font-weight:700;" : ""}">${esc(label)}</td>
      <td style="padding:2px 0;text-align:right;font-variant-numeric:tabular-nums;color:${rowOpts.color ?? "#0f172a"};font-size:${totalPx};${rowOpts.borderTop ? "border-top:1px solid #cbd5e1;padding-top:4px;" : ""}${bold ? "font-weight:700;" : ""}">${value}</td>
    </tr>`;

  const paidRows: string[] = [];
  if (cashAmt > 0) paidRows.push(totalsRow("Cash", `₹${fmt(cashAmt)}`));
  if (upiAmt > 0) paidRows.push(totalsRow("UPI", `₹${fmt(upiAmt)}`));
  if (cardAmt > 0) paidRows.push(totalsRow("Card", `₹${fmt(cardAmt)}`));
  if (insAmt > 0) paidRows.push(totalsRow("Insurance", `₹${fmt(insAmt)}`));
  if (chqAmt > 0) paidRows.push(totalsRow("Cheque", `₹${fmt(chqAmt)}`));

  const queueTokenBlock =
    opts.showQueueToken && bill.tokenNo
      ? `<div style="text-align:center;background:#eff6ff;border:2px dashed #0c4a6e;border-radius:4px;padding:3px 6px;margin-bottom:4px">
        <div style="font-size:${tinyPx};font-weight:800;color:#0c4a6e">QUEUE TOKEN</div>
        <div style="font-size:${parseInt(titleSize, 10) + 6}px;font-weight:900;color:#0c4a6e">#${esc(String(bill.tokenNo))}</div>
      </div>`
      : "";

  const page = (copyLabel?: string) => `
      ${(isCancelled || isUnconfirmedQr)
        ? `<div style="position:absolute;top:4mm;left:50%;transform:translateX(-50%) rotate(-8deg);border:2px solid ${bad};color:${bad};padding:2px 10px;font-weight:800;letter-spacing:1.5px;font-size:18px;opacity:0.3;pointer-events:none;text-transform:uppercase">
          ${isCancelled ? "CANCELLED" : "Awaiting Payment"}
        </div>`
        : ""}

      ${provisionalReceipt ? `<div style="background:#fef3c7;color:#92400e;border:2px solid #f59e0b;border-radius:4px;padding:3px 6px;font-size:${tinyPx};font-weight:800;margin-bottom:4px;text-align:center;text-transform:uppercase">Provisional — Offline · Sync Pending · QR After Sync</div>` : ""}

      <!-- HEADER: Full-width flex with logo/clinic left, invoice/bill# right -->
      <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;padding-bottom:4mm;border-bottom:2px solid ${accent}">
        <div style="flex:1;min-width:0">
          ${logoImg}
          <div style="font-size:${titleSize};font-weight:800;color:${accent};line-height:1.2;margin-top:${logoImg ? "2px" : "0"}">${esc(clinic?.name ?? "")}</div>
          ${clinic?.tagline ? `<div style="font-size:${bodyPx};color:#334155;line-height:1.2;margin-top:1px">${esc(clinic.tagline)}</div>` : ""}
          ${clinic?.address ? `<div style="font-size:${headerPx};color:#64748b;line-height:1.3;margin-top:2px">${esc(clinic.address)}</div>` : ""}
          <div style="font-size:${headerPx};color:#64748b;line-height:1.3;margin-top:1px">
            ${clinic?.phone ? `Ph: ${esc(clinic.phone)}` : ""}
            ${clinic?.email ? `${clinic?.phone ? " · " : ""}${esc(clinic.email)}` : ""}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;min-width:70mm">
          <div style="font-size:${titleSize};font-weight:800;color:${accent};letter-spacing:1px;text-transform:uppercase;line-height:1">Invoice</div>
          <div style="margin-top:3px;padding:2px 6px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:3px;display:inline-block">
            <span style="font-size:${bodyPx};color:#64748b;font-weight:600">Bill No.</span>
            <span style="font-size:${billNoSize};font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;margin-left:4px">${esc(billDigits)}</span>
          </div>
          <div style="font-size:${headerPx};color:#334155;margin-top:2px">${esc(dateStr)}</div>
          ${copyLabel ? `<div style="font-size:${tinyPx};color:${accent};margin-top:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${esc(copyLabel)}</div>` : ""}
          ${reprintBy || reprintReason ? `<div style="display:inline-block;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;border-radius:3px;padding:1px 5px;font-size:${tinyPx};font-weight:600;margin-top:2px">REPRINT${reprintBy ? ` · ${esc(reprintBy)}` : ""}${reprintReason ? ` · ${esc(reprintReason)}` : ""}</div>` : ""}
        </div>
      </header>

      <!-- PATIENT + REFERRER ROW -->
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6mm;padding:3mm 0;border-bottom:1px solid #e2e8f0">
        <div style="min-width:0;flex:1">
          <div style="font-size:${patientSz};font-weight:700;line-height:1.15">
            ${esc(`${bill.patient?.firstName ?? ""} ${bill.patient?.lastName ?? ""}`.trim().toUpperCase() || "—")}
            ${ageGender ? `<span style="font-weight:500;color:#475569;font-size:${bodyPx};margin-left:4px">· ${esc(ageGender)}</span>` : ""}
          </div>
          <div style="font-size:${headerPx};color:#64748b;margin-top:1px">
            ID: <span style="font-family:ui-monospace,Menlo,monospace;font-weight:600">${esc(bill.patient?.patientId ?? "—")}</span>
            ${bill.patient?.phone ? ` · Ph: ${esc(bill.patient.phone)}` : ""}
          </div>
        </div>
        ${rawDoctor
          ? `<div style="text-align:right;flex-shrink:0">
          <div style="font-size:${tinyPx};color:#94a3b8;text-transform:uppercase;margin-bottom:1px">Referred by</div>
          <div style="font-size:${patientSz};font-weight:600">${esc(rawDoctor)}</div>
        </div>`
          : ""}
      </div>

      ${queueTokenBlock}

      <!-- MAIN CONTENT: Tests table (65%) + Totals sidebar (35%) -->
      <div style="display:flex;gap:6mm;padding-top:3mm;align-items:flex-start">
        <!-- Tests Table -->
        <div style="flex:1;min-width:0">
          <table style="width:100%;border-collapse:collapse;font-size:${tablePx}">
            <thead>
              <tr style="border-bottom:1.5px solid ${accent}">
                <th style="padding:3px 4px;text-align:center;color:${accent};font-weight:700;font-size:${tinyPx};width:5%">#</th>
                ${showCode ? `<th style="padding:3px 4px;text-align:left;color:${accent};font-weight:700;font-size:${tinyPx};width:11%">CODE</th>` : ""}
                <th style="padding:3px 4px;text-align:left;color:${accent};font-weight:700;font-size:${tinyPx}">TEST NAME</th>
                ${showTat ? `<th style="padding:3px 4px;text-align:left;color:${accent};font-weight:700;font-size:${tinyPx};width:10%">TAT</th>` : ""}
                <th style="padding:3px 4px;text-align:right;color:${accent};font-weight:700;font-size:${tinyPx};width:16%">AMOUNT</th>
              </tr>
            </thead>
            <tbody>${tests.map(testRow).join("")}</tbody>
          </table>
          ${cancelledFooter}
          ${bill.testTokens?.length
            ? `<div style="margin-top:3px;font-size:${tinyPx};color:#64748b">
              ${bill.testTokens.map((t) => `<span style="display:inline-block;background:#f1f5f9;border-radius:3px;padding:1px 5px;margin-right:3px">${esc(t.department)}: #${esc(String(t.tokenNo))}${t.roomNumber ? ` · ${esc(t.roomNumber)}` : ""}</span>`).join("")}
            </div>`
            : ""}
        </div>

        <!-- Totals + QR Sidebar -->
        <aside style="width:32%;flex-shrink:0;display:flex;flex-direction:column;gap:3mm">
          <div style="page-break-inside:avoid">
            <table style="width:100%;border-collapse:collapse">
              ${totalsRow("Subtotal", `₹${fmt(bill.subtotal)}`)}
              ${Number(bill.discount) > 0 ? totalsRow("Discount", `− ₹${fmt(bill.discount)}`, false, { color: "#64748b" }) : ""}
              ${totalsRow("Total", `₹${fmt(bill.totalAmount)}`, true, { borderTop: true })}
              ${totalsRow("Paid", `₹${fmt(paidAmt)}`)}
              ${paidRows.join("")}
            </table>
            <div style="margin-top:3px;padding:4px 8px;background:${balBg};border:2px solid ${balColor};border-radius:4px;display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:${totalPx};font-weight:700;color:${balColor};text-transform:uppercase">Balance Due</span>
              <span style="font-size:${parseInt(totalPx, 10) + 4}px;font-weight:800;color:${balColor};font-variant-numeric:tabular-nums">
                ${isUnconfirmedQr ? "Pending" : `₹${fmt(balAmt)}`}
              </span>
            </div>
          </div>
          ${qrEnabled && qrDataUrl
            ? `<div style="display:flex;gap:4px;align-items:center;padding-top:2px">
              <img src="${qrDataUrl}" alt="Verify" style="width:48px;height:48px;border:1px solid #e2e8f0;padding:1px;background:#fff"/>
              <div style="font-size:${tinyPx};color:#64748b;line-height:1.25">
                <div style="color:${accent};font-weight:700;text-transform:uppercase">Scan to verify</div>
              </div>
            </div>`
            : ""}
        </aside>
      </div>

      <!-- FOOTER -->
      <footer style="margin-top:auto;padding-top:3mm;border-top:1px solid ${accent};display:flex;justify-content:space-between;align-items:flex-end;gap:6mm">
        <div style="flex-shrink:0">
          ${opts.showSignatureLine !== false
            ? billedBySigUrl
              ? `<img src="${billedBySigUrl}" alt="" style="max-height:24px;max-width:100px;object-fit:contain;display:block"/>`
              : `<div style="border-bottom:1px solid #94a3b8;width:100px;height:20px"></div>`
            : ""}
          <div style="font-size:${tinyPx};color:#64748b;margin-top:1px">
            Authorised Signature${billedByName ? ` · ${esc(billedByName)}` : ""}
          </div>
        </div>
        <div style="text-align:right;flex:1;min-width:0">
          <div style="font-size:${footerPx};font-weight:600;line-height:1.25">
            ${esc(clinic?.footerNote || bill.reportCollectionNote || "Thank you for choosing our diagnostic services.")}
          </div>
          ${opts.showComputerGenerated !== false
            ? `<div style="font-size:${tinyPx};color:#94a3b8;margin-top:1px">Computer-generated · No signature required</div>`
            : ""}
        </div>
      </footer>`;

  const pageLabels: string[] =
    copies === 2
      ? [opts.copyLabel === "office" ? "OFFICE COPY" : "PATIENT COPY", "OFFICE COPY"]
      : [opts.copyLabel === "office" ? "OFFICE COPY" : opts.copyLabel === "patient" ? "PATIENT COPY" : ""];

  const paper = resolveBillPrintPaperFromOpts(opts);
  // Epson L130 needs ~10mm top margin to clear its unprintable band and give
  // the header breathing room on A5 landscape (210×148mm).
  const marginMm = opts.printMarginMm ?? 10;

  return buildDocumentHtml({
    title: `Bill ${esc(bill.billNumber)}`,
    paper,
    safePaddingMm: marginMm,
    bodyFontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    bodyFontSize: bodyPx,
    bodyColor: "#0f172a",
    extraStyles: `
  .care-doc-page table tbody tr:nth-child(even) td { background: #f8fafc; }
  .care-doc-page { display: flex; flex-direction: column; }
  .care-doc-page > header { flex-shrink: 0; }
  .care-doc-page > div { flex-shrink: 0; }
  .care-doc-page > footer { flex-shrink: 0; margin-top: auto; }`,
    pages: Array.from({ length: copies }).map((_, i) => ({
      html: page(pageLabels[i] || undefined),
      className: "receipt",
    })),
  });
}
