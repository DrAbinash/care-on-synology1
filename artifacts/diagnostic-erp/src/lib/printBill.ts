// Bill receipt printing — A5 thermal receipt optimised for Indian diagnostic centres.
// Matches the physical receipt layout from the reference image.

export type PrintBillData = {
  billNumber: string;
  subtotal: number | string;
  discount: number | string;
  taxAmount?: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  balanceAmount: number | string;
  status?: string;
  createdAt?: string;
  patient?: {
    firstName: string;
    lastName: string;
    patientId: string;
    phone?: string | null;
    gender?: string | null;
    dateOfBirth?: string | null;
    ageValue?: number | null;
    ageUnit?: string | null;
  } | null;
  order?: {
    doctor?: { name?: string | null } | null;
    tests?: Array<{
      id?: number;
      price: number | string;
      status?: string | null;
      displayName?: string | null;
      test?: { code?: string | null; name?: string | null; category?: string | null } | null;
    }>;
  } | null;
  payments?: Array<{
    method: string;
    amount: number | string;
    referenceNumber?: string | null;
    createdAt?: string;
  }>;
  testTokens?: Array<{ department: string; roomNumber: string; tokenNo: number }> | null;
  tokenNo?: number | null;
  reportCollectionNote?: string | null;
};

export type PrintClinic = {
  name?: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstin?: string;
  logoDataUrl?: string | null;
  footerNote?: string;
  billPrintCopies?: number;
  billShowCode?: boolean;
  billShowCategory?: boolean;
  qrOnBillEnabled?: boolean;
  // V3: Receipt messages
  receiptThankYouMessage?: string;
  receiptCollectionMessage?: string;
  receiptQrMessage?: string;
  receiptPromotionalMessage?: string;
  // V3: Service footer
  serviceFooter?: string;
  // V3: Follow-up
  showFollowUpMessage?: boolean;
  followUpMessage?: string;
  // V3: Promotional
  showPromotionalFooter?: boolean;
  promotionalTitle?: string;
  promotionalDescription?: string;
  // V3: Identity & security
  showPatientSince?: boolean;
  showVerifiedBadge?: boolean;
  // V3: Print audit
  showAuditInfoOnPatientCopy?: boolean;
  // V3: Additional footer messages
  showWorkingHours?: boolean;
  workingHoursMessage?: string;
  showHomeCollection?: boolean;
  homeCollectionMessage?: string;
  showEmergency?: boolean;
  emergencyMessage?: string;
  showReferralProgram?: boolean;
  referralProgramMessage?: string;
  showHealthPackages?: boolean;
  healthPackagesMessage?: string;
  showAccreditation?: boolean;
  accreditationMessage?: string;
  showWhatsAppBooking?: boolean;
  whatsAppBookingMessage?: string;
  showCustomFooterMessage?: boolean;
  customFooterMessage?: string;
} | undefined | null;

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function calcAge(dob?: string | null, ageValue?: number | null, ageUnit?: string | null): string {
  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue} Y` : "";
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

function fmt(n: number | string): string {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

import { type BillFormat, type BillPaperSize } from "./billPrintSettings";
import { buildPremiumBillPrintHtml } from "./premiumBillPrint";
import { buildDesignerBillPrintHtml } from "./designerBillPrint";

export type BuildPrintHtmlOpts = {
  bill: PrintBillData;
  clinic: PrintClinic;
  paperSize: "A4" | "A5";
  isBW: boolean;
  qrDataUrl: string;
  reprintBy?: string;
  reprintReason?: string;
  // Extended format support (new fields — backward compatible)
  format?: BillFormat;
  copyLabel?: string;
  showQr?: boolean;
  showAmountInWords?: boolean;
  showSignatureLine?: boolean;
  showComputerGenerated?: boolean;
  showReportMessage?: boolean;
  showServiceFooter?: boolean;
  showBrandingFooter?: boolean;
  showBarcode?: boolean;
  showWatermark?: boolean;
  showPatientInstructions?: boolean;
  showSystemInfo?: boolean;
  // V3 toggles
  showReceiptThankYou?: boolean;
  showReceiptCollection?: boolean;
  showReceiptQrMessage?: boolean;
  showReceiptPromotional?: boolean;
  showVerifiedBadge?: boolean;
  showFollowUpMessage?: boolean;
  showPatientSince?: boolean;
  showPromotionalFooter?: boolean;
  showAuditInfoOnPatientCopy?: boolean;
  // V3 additional footer messages
  showWorkingHours?: boolean;
  showHomeCollection?: boolean;
  showEmergency?: boolean;
  showReferralProgram?: boolean;
  showHealthPackages?: boolean;
  showAccreditation?: boolean;
  showWhatsAppBooking?: boolean;
  showCustomFooterMessage?: boolean;
  barcodeDataUrl?: string;
  customFooter?: string | null;
  reportCollectionNote?: string | null;
};

export function buildClassicBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  const { bill, clinic, paperSize, isBW, qrDataUrl, reprintBy, reprintReason } = opts;
  const copies = Math.max(1, Math.min(2, Number(clinic?.billPrintCopies ?? 1) || 1));
  const showCode = clinic?.billShowCode !== false;
  const showCategory = clinic?.billShowCategory !== false;
  const qrEnabled = clinic?.qrOnBillEnabled !== false;
  const isA5 = paperSize === "A5";

  const tests = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") === "cancelled");
  const billDigits = String(bill.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ageStr = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const ageGender = [ageStr, bill.patient?.gender].filter(Boolean).join(" / ").toUpperCase();
  const created = bill.createdAt ? new Date(bill.createdAt) : new Date();
  const isCancelled = (bill.status ?? "") === "cancelled";
  const rawDoctor = bill.order?.doctor?.name ?? "";
  const isUnconfirmedQr = (bill.payments ?? []).some((p) => String(p.method).includes("Unconfirmed"));

  // ── Aggregated payment amounts ──
  const payByMode: Record<string, number> = {};
  for (const p of bill.payments ?? []) {
    const m = String(p.method).toLowerCase().trim();
    payByMode[m] = (payByMode[m] || 0) + Number(p.amount || 0);
  }
  const cashAmt = payByMode["cash"] || 0;
  const upiAmt = payByMode["upi"] || 0;
  const cardAmt = payByMode["card"] || 0;
  const insAmt = payByMode["insurance"] || 0;
  const chqAmt = payByMode["cheque"] || 0;

  // On a B&W printer, force the few semantically-colored statuses (paid/
  // balance-due) to black instead of grayscaling the whole page — a
  // page-wide filter would also desaturate the clinic logo, which should
  // always print in its native color regardless of printer mode.
  const statusColor = (semantic: string): string => (isBW ? "#000" : semantic);

  // ── Sizing tuned for A5 thermal receipt ──
  // A5: flex column layout pushes footer to bottom so short bills fill the page
  const pageMargin = isA5 ? "5mm" : "8mm";
  const titleSize = isA5 ? "15px" : "16px";
  const patientNameSize = isA5 ? "14px" : "18px";    // compact patient / ref / date block
  const bodyPx = isA5 ? "14px" : "13px";             // tagline under logo
  const headerPx = isA5 ? "16px" : "14px";           // clinic address / phone / email (prominent)
  const tablePx = isA5 ? "12px" : "12px";
  const totalPx = isA5 ? "13px" : "13px";
  const footerPx = isA5 ? "11px" : "11px";
  const tinyPx = isA5 ? "10px" : "10px";

  const colCount = 3 + (showCode ? 1 : 0) + (showCategory ? 1 : 0);

  // ── Test rows ──
  const testRows = tests.map((t, i) => {
    const code = t.test?.code ?? "";
    const name = t.displayName ?? t.test?.name ?? "";
    const cat = t.test?.category ?? "";
    const codeFontSize = `${Math.round(parseInt(tablePx, 10) * 0.9)}px`;
    return `<tr>
      <td style="padding:4px 5px;border:1px solid #888;font-size:${tablePx};text-align:center">${i + 1}</td>
      ${showCode ? `<td style="padding:4px 5px;border:1px solid #888;font-family:monospace;font-size:${codeFontSize}">${esc(code)}</td>` : ""}
      <td style="padding:4px 5px;border:1px solid #888;font-size:${tablePx}">${esc(name)}</td>
      ${showCategory ? `<td style="padding:4px 5px;border:1px solid #888;font-size:${tablePx};color:#333">${esc(cat)}</td>` : ""}
      <td style="padding:4px 5px;border:1px solid #888;text-align:right;font-weight:700;font-size:${tablePx}">₹${fmt(t.price)}</td>
    </tr>`;
  }).join("");

  const cancelledRow = cancelled.length === 0 ? "" : `
    <div style="margin-top:4px;font-size:${tinyPx};color:#999">
      <em>Cancelled: ${esc(cancelled.map((t) => t.displayName ?? t.test?.name ?? "").join(", "))}</em>
    </div>`;

  // ── Payment detail rows ──
  const payRows = (bill.payments ?? []).map((p) => {
    const ref = p.referenceNumber ? ` (${esc(p.referenceNumber)})` : "";
    return `<tr>
      <td style="padding:1px 0;font-size:${tinyPx};text-transform:capitalize">${esc(p.method)}${ref ? `<span style="color:#777;font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px">${ref}</span>` : ""}</td>
      <td style="padding:1px 0;text-align:right;font-weight:600;font-size:${tinyPx}">₹${fmt(p.amount)}</td>
    </tr>`;
  }).join("");

  const hasPayDetail = (bill.payments ?? []).length > 0;

  // ── Get billed-by name + their uploaded signature from localStorage ──
  const session = (() => {
    try {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem("erp_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const billedByName: string = session?.user?.name ?? "";
  const billedBySignatureUrl: string = session?.user?.signatureDataUrl ?? "";

  const page = (copyIdx: number) => `
    <section class="receipt" style="${copyIdx > 0 ? "page-break-before:always;" : ""}${isA5 ? "display:flex;flex-direction:column;min-height:210mm;" : ""}">

      ${reprintBy || reprintReason ? `<div style="text-align:center;font-size:${tinyPx};color:#a16207;border:1px dashed #d97706;padding:2px 4px;margin-bottom:4px;text-transform:uppercase;font-weight:700">DUPLICATE / RE-PRINT${reprintBy ? ` · BY ${esc(reprintBy)}` : ""}${reprintReason ? ` · ${esc(reprintReason)}` : ""}</div>` : ""}

      <!-- HEADER: logo + tagline left, clinic info right (bold, bigger) -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
        <tr>
          <td style="vertical-align:top;padding:0;width:45%">
            ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" alt="logo" style="max-height:78px;max-width:160px;object-fit:contain;display:block;margin-bottom:3px"/>` : ""}
            <div style="font-size:${bodyPx};color:#333;font-weight:700;line-height:1.2">${esc(clinic?.tagline || "DIAGNOSTIC & PATHOLOGY SERVICES")}</div>
          </td>
          <td style="vertical-align:top;text-align:right;padding:0;font-size:${headerPx};line-height:1.45;color:#000;font-weight:700">
            ${clinic?.address ? `<div>${esc(clinic.address.replace(/\s*\n\s*/g, ", ").trim())}</div>` : ""}
            <div>PH: ${esc(clinic?.phone ?? "")}</div>
            <div>EMAIL: ${esc(clinic?.email ?? "")}</div>
            ${clinic?.website ? `<div>${esc(clinic.website)}</div>` : ""}
            ${clinic?.gstin ? `<div style="margin-top:1px;font-weight:800">GSTIN: ${esc(clinic.gstin)}</div>` : ""}
          </td>
        </tr>
      </table>

      <!-- TITLE LINE with bill number on the right -->
      <div style="border-top:2px solid #000;border-bottom:2px solid #000;padding:4px 0;margin-bottom:6px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:0;vertical-align:middle">
              <div style="font-size:${titleSize};font-weight:800;letter-spacing:1.2px;text-transform:uppercase">${isCancelled ? "CANCELLED" : isUnconfirmedQr ? "Confirmed on confirmation of Payment" : "INVOICE / RECEIPT"}</div>
            </td>
            <td style="padding:0;vertical-align:middle;text-align:right;white-space:nowrap">
              <div style="font-size:${titleSize};font-weight:800">BILL NO: ${esc(billDigits)}</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- PATIENT + DATE (uniform font size) -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
        <tr>
          <td style="vertical-align:top;padding:0">
            <div style="font-size:${patientNameSize};font-weight:900;line-height:1.15">${esc(`${bill.patient?.firstName ?? ""} ${bill.patient?.lastName ?? ""}`.trim().toUpperCase())} ${esc(ageGender)}</div>
            <div style="font-size:${patientNameSize};font-weight:700;margin-top:2px;color:#000">
              REF: <strong>${rawDoctor ? esc(rawDoctor.match(/^\s*DR\.?\s*/i) ? rawDoctor.trim().toUpperCase() : "DR. " + rawDoctor.trim().toUpperCase()) : "SELF / WALK-IN"}</strong>
            </div>
          </td>
          <td style="vertical-align:top;text-align:right;padding:0;font-size:${patientNameSize};line-height:1.35;white-space:nowrap;color:#000">
            <div style="font-weight:800">${created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} &nbsp;${created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase()}</div>
            <div>PH ${esc(bill.patient?.phone ?? "")} · ID ${esc(bill.patient?.patientId ?? "")}</div>
          </td>
        </tr>
      </table>

      <!-- HORIZONTAL RULE -->
      <div style="border-bottom:1px solid #000;margin-bottom:6px"></div>

      <!-- TEST TABLE with borders -->
      <table style="width:100%;border-collapse:collapse;font-size:${tablePx};margin-bottom:6px">
        <thead>
          <tr>
            <th style="padding:4px 5px;border:1px solid #888;text-align:center;font-weight:800">#</th>
            ${showCode ? `<th style="padding:4px 5px;border:1px solid #888;text-align:left;font-weight:800">CODE</th>` : ""}
            <th style="padding:4px 5px;border:1px solid #888;text-align:left;font-weight:800">TEST NAME</th>
            ${showCategory ? `<th style="padding:4px 5px;border:1px solid #888;text-align:left;font-weight:800">CATEGORY</th>` : ""}
            <th style="padding:4px 5px;border:1px solid #888;text-align:right;font-weight:800">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${testRows || `<tr><td colspan="${colCount}" style="padding:8px;text-align:center;color:#999;border:1px solid #888">No tests on this bill</td></tr>`}
        </tbody>
      </table>
      ${cancelledRow}

      <!-- BOTTOM: QR + Payment details left, Totals right -->
      <table style="width:100%;border-collapse:separate;border-spacing:0;margin-top:8px;table-layout:fixed">
        <colgroup>
          <col style="width:${qrEnabled && qrDataUrl ? "90px" : "0"}"/>
          <col/>
          <col style="width:${isA5 ? "170px" : "200px"}"/>
        </colgroup>
        <tbody>
          <tr>
            <!-- QR (left) -->
            <td style="vertical-align:bottom;padding:0">
              ${qrEnabled && qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" style="width:70px;height:70px;display:block"/><div style="font-size:${tinyPx};color:#666;margin-top:1px">Scan to verify</div>` : ""}
            </td>
            <!-- Payment details (middle, if present) -->
            <td style="vertical-align:top;padding:0 8px 0 0;font-size:${tinyPx}">
              ${hasPayDetail ? `<div style="font-weight:800;border-bottom:1px solid #999;padding-bottom:1px;margin-bottom:2px;font-size:${Math.round(parseInt(tinyPx, 10) * 1.1)}px">PAYMENT DETAILS</div>
                <table style="width:100%;border-collapse:collapse"><tbody>${payRows}</tbody></table>` : ""}
            </td>
            <!-- Totals -->
            <td style="vertical-align:top;padding:0">
              <table style="width:100%;border-collapse:collapse;font-size:${totalPx};table-layout:fixed">
                <tbody>
                  <tr><td style="padding:2px 3px">SUBTOTAL</td><td style="padding:2px 3px;text-align:right;white-space:nowrap">₹${fmt(bill.subtotal)}</td></tr>
                  ${Number(bill.discount) > 0 ? `<tr><td style="padding:2px 3px">DISCOUNT</td><td style="padding:2px 3px;text-align:right;white-space:nowrap">₹${fmt(bill.discount)}</td></tr>` : ""}
                  <tr>
                    <td style="padding:3px 3px;border-top:2px solid #000;font-weight:900">TOTAL</td>
                    <td style="padding:3px 3px;border-top:2px solid #000;text-align:right;font-weight:900;white-space:nowrap">₹${fmt(bill.totalAmount)}</td>
                  </tr>
                  <tr><td style="padding:2px 3px;border-top:1px solid #000;font-weight:800">PAID</td><td style="padding:2px 3px;border-top:1px solid #000;text-align:right;font-weight:800;white-space:nowrap;color:${statusColor(isUnconfirmedQr ? "orange" : "green")}">${isUnconfirmedQr ? `${fmt(bill.totalAmount)} (To Be Confirmed)` : `₹${fmt(bill.paidAmount)}`}</td></tr>
                  <tr>
                    <td style="padding:3px 3px;border-top:2px solid #000;font-weight:900;font-size:${parseInt(totalPx, 10) + 2}px">BALANCE DUE</td>
                    <td style="padding:3px 3px;border-top:2px solid #000;text-align:right;font-weight:900;white-space:nowrap;color:${statusColor(isUnconfirmedQr ? "orange" : Number(bill.balanceAmount) > 0 ? "#c62828" : "green")};font-size:${parseInt(totalPx, 10) + 2}px">${isUnconfirmedQr ? "To Be Confirmed" : `₹${fmt(bill.balanceAmount)}`}</td>
                  </tr>
                  ${cashAmt > 0 ? `<tr><td style="padding:1px 3px;color:#444;font-size:${tinyPx}">Cash</td><td style="padding:1px 3px;text-align:right;white-space:nowrap;color:#444;font-size:${tinyPx}">₹${fmt(cashAmt)}</td></tr>` : ""}
                  ${upiAmt > 0 ? `<tr><td style="padding:1px 3px;color:#444;font-size:${tinyPx}">UPI</td><td style="padding:1px 3px;text-align:right;white-space:nowrap;color:#444;font-size:${tinyPx}">₹${fmt(upiAmt)}</td></tr>` : ""}
                  ${cardAmt > 0 ? `<tr><td style="padding:1px 3px;color:#444;font-size:${tinyPx}">Card</td><td style="padding:1px 3px;text-align:right;white-space:nowrap;color:#444;font-size:${tinyPx}">₹${fmt(cardAmt)}</td></tr>` : ""}
                  ${insAmt > 0 ? `<tr><td style="padding:1px 3px;color:#444;font-size:${tinyPx}">Insurance</td><td style="padding:1px 3px;text-align:right;white-space:nowrap;color:#444;font-size:${tinyPx}">₹${fmt(insAmt)}</td></tr>` : ""}
                  ${chqAmt > 0 ? `<tr><td style="padding:1px 3px;color:#444;font-size:${tinyPx}">Cheque</td><td style="padding:1px 3px;text-align:right;white-space:nowrap;color:#444;font-size:${tinyPx}">₹${fmt(chqAmt)}</td></tr>` : ""}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Spacer pushes footer to bottom on A5 -->
      ${isA5 ? '<div style="flex:1"></div>' : ""}

      <!-- FOOTER -->
      <div style="margin-top:4px;border-top:1px solid #000;padding-top:4px;text-align:center;page-break-inside:avoid">
        <div style="font-size:${footerPx};font-weight:700;color:#000;margin-bottom:1px;text-transform:uppercase">${esc(clinic?.footerNote || bill.reportCollectionNote || "Thank you for choosing our diagnostic services. Please collect your report within 7 days.")}</div>
        <div style="font-size:${tinyPx};color:#555;margin-bottom:3px">THIS IS A COMPUTER-GENERATED INVOICE. NO SIGNATURE REQUIRED.</div>

        <!-- Signature line -->
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="text-align:left;padding:0;vertical-align:bottom">
              ${billedBySignatureUrl
                ? `<img src="${billedBySignatureUrl}" alt="Signature" style="max-height:32px;max-width:130px;object-fit:contain;display:block;margin-bottom:1px"/>`
                : `<div style="border-bottom:1px solid #000;width:130px;margin-bottom:1px"></div>`}
              <div style="font-size:${tinyPx};color:#555">Authorised Signature</div>
            </td>
            <td style="text-align:right;padding:0;vertical-align:bottom;font-size:${tinyPx};color:#555">
              ${billedByName ? `<div>Billed by: ${esc(billedByName)}</div>` : ""}
            </td>
          </tr>
        </table>
      </div>
    </section>`;

  const pages = Array.from({ length: copies }).map((_, i) => page(i)).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(bill.billNumber)}</title>
<style>
  @page { size: ${isA5 ? "A5" : "A4"} portrait; margin: ${pageMargin}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: ${bodyPx}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt { width: 100%; padding: 2mm 3mm; box-sizing: border-box; }
  ${isA5 ? ".receipt { min-height: 100vh; display: flex; flex-direction: column; }" : ""}
  table { width: 100%; }
</style></head><body>${pages}</body></html>`;
}

// ── Wrapper that dispatches to classic or premium format ──
// Backward compatible: if format is not specified, uses classic (existing behavior).
export function buildBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  const { format = "classic" } = opts;

  // ── Designer layouts A / B / C ──
  if (format === "designer-a" || format === "designer-b" || format === "designer-c") {
    return buildDesignerBillPrintHtml({ ...opts, layout: format });
  }
  if (format === "premium-a5") {
    // Map old paperSize to new BillPaperSize
    const paperSize: BillPaperSize = opts.paperSize === "A5" ? "A5-portrait" : "A4";
    return buildPremiumBillPrintHtml({
      bill: opts.bill,
      clinic: opts.clinic,
      paperSize,
      isBW: opts.isBW,
      qrDataUrl: opts.qrDataUrl,
      reprintBy: opts.reprintBy,
      reprintReason: opts.reprintReason,
      copyLabel: opts.copyLabel,
      showQr: opts.showQr ?? (opts.clinic?.qrOnBillEnabled !== false),
      showAmountInWords: opts.showAmountInWords ?? false,
      showSignatureLine: opts.showSignatureLine ?? true,
      showComputerGenerated: opts.showComputerGenerated ?? true,
      showReportMessage: opts.showReportMessage ?? true,
      showServiceFooter: opts.showServiceFooter ?? true,
      showBrandingFooter: opts.showBrandingFooter ?? true,
      showBarcode: opts.showBarcode ?? false,
      showWatermark: opts.showWatermark ?? false,
      showPatientInstructions: opts.showPatientInstructions ?? false,
      showSystemInfo: opts.showSystemInfo ?? false,
      // V3 toggles (default OFF, driven by clinic settings)
      showReceiptThankYou: opts.showReceiptThankYou ?? opts.clinic?.receiptThankYouMessage !== undefined,
      showReceiptCollection: opts.showReceiptCollection ?? opts.clinic?.receiptCollectionMessage !== undefined,
      showReceiptQrMessage: opts.showReceiptQrMessage ?? opts.clinic?.receiptQrMessage !== undefined,
      showReceiptPromotional: opts.showReceiptPromotional ?? opts.clinic?.receiptPromotionalMessage !== undefined,
      showVerifiedBadge: opts.showVerifiedBadge ?? opts.clinic?.showVerifiedBadge ?? false,
      showFollowUpMessage: opts.showFollowUpMessage ?? opts.clinic?.showFollowUpMessage ?? false,
      showPatientSince: opts.showPatientSince ?? opts.clinic?.showPatientSince ?? false,
      showPromotionalFooter: opts.showPromotionalFooter ?? opts.clinic?.showPromotionalFooter ?? false,
      showAuditInfoOnPatientCopy: opts.showAuditInfoOnPatientCopy ?? opts.clinic?.showAuditInfoOnPatientCopy ?? false,
      // V3 additional footer messages
      showWorkingHours: opts.showWorkingHours ?? opts.clinic?.showWorkingHours ?? false,
      showHomeCollection: opts.showHomeCollection ?? opts.clinic?.showHomeCollection ?? false,
      showEmergency: opts.showEmergency ?? opts.clinic?.showEmergency ?? false,
      showReferralProgram: opts.showReferralProgram ?? opts.clinic?.showReferralProgram ?? false,
      showHealthPackages: opts.showHealthPackages ?? opts.clinic?.showHealthPackages ?? false,
      showAccreditation: opts.showAccreditation ?? opts.clinic?.showAccreditation ?? false,
      showWhatsAppBooking: opts.showWhatsAppBooking ?? opts.clinic?.showWhatsAppBooking ?? false,
      showCustomFooterMessage: opts.showCustomFooterMessage ?? opts.clinic?.showCustomFooterMessage ?? false,
      barcodeDataUrl: opts.barcodeDataUrl,
      customFooter: opts.customFooter,
      reportCollectionNote: opts.reportCollectionNote,
    });
  }
  // Classic format
  return buildClassicBillPrintHtml(opts);
}

export function printViaIframe(html: string): void {
  const existing = document.getElementById("__bill_print_iframe__");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "__bill_print_iframe__";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* ignore */ }
    setTimeout(() => { try { iframe.remove(); } catch { /* ignore */ } }, 1000);
  };
  iframe.onload = doPrint;
  setTimeout(doPrint, 350);
}

export function openBlankPrintWindow(): Window | null {
  const w = window.open("", "_blank", "width=520,height=720");
  if (!w) return null;
  try {
    w.document.open();
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Preparing receipt…</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#555">Preparing receipt…</body></html>`,
    );
    w.document.close();
  } catch { /* ignore */ }
  return w;
}

export function writeAndPrint(win: Window | null, html: string): void {
  if (!win) {
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) { alert("Pop-up blocked. Please allow pop-ups for this site to print bills."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); setTimeout(() => w.close(), 400); };
    return;
  }
  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch { /* ignore */ }
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try { win.focus(); win.print(); } catch { /* ignore */ }
    setTimeout(() => { try { win.close(); } catch { /* ignore */ } }, 500);
  };
  win.onload = doPrint;
  setTimeout(doPrint, 350);
}
