// Premium A5 Bill Print Template — V2 Professional Polish
// Modern, clean, black-and-white, professional diagnostic-center receipt.
// Optimized for 1-2 test radiology bills. Fills A5 naturally.
// Print-safe: only black ink, no background colors, no color text.

import { type PrintBillData, type PrintClinic } from "./printBill";
import { type BillPaperSize, getPaperSizeCss } from "./billPrintSettings";

export type BuildPremiumBillOpts = {
  bill: PrintBillData;
  clinic: PrintClinic;
  paperSize: BillPaperSize;
  isBW: boolean;
  qrDataUrl: string;
  reprintBy?: string;
  reprintReason?: string;
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

function numberToWords(num: number): string {
  const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const n = Math.round(num);
  if (n === 0) return "Zero Rupees Only";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rem = n % 100;
  let parts: string[] = [];
  if (crore > 0) parts.push(`${ones[crore]} Crore`);
  if (lakh > 0) parts.push(`${ones[lakh]} Lakh`);
  if (thousand > 0) parts.push(`${ones[thousand]} Thousand`);
  if (hundred > 0) parts.push(`${ones[hundred]} Hundred`);
  if (rem > 0) {
    if (rem < 10) parts.push(ones[rem]);
    else if (rem < 20) parts.push(teens[rem - 10]);
    else parts.push(`${tens[Math.floor(rem / 10)]}${rem % 10 > 0 ? " " + ones[rem % 10] : ""}`);
  }
  return `${parts.join(" ")} Rupees Only`;
}

export function buildPremiumBillPrintHtml(opts: BuildPremiumBillOpts): string {
  const {
    bill, clinic, paperSize, isBW, qrDataUrl,
    reprintBy, reprintReason, copyLabel,
    showQr = true, showAmountInWords = false, showSignatureLine = true,
    showComputerGenerated = true, showReportMessage = true,
    showServiceFooter = true, showBrandingFooter = true,
    showBarcode = false, showWatermark = false,
    showPatientInstructions = false, showSystemInfo = false,
    // V3 toggles
    showReceiptThankYou = false,
    showReceiptCollection = false,
    showReceiptQrMessage = false,
    showReceiptPromotional = false,
    showVerifiedBadge = false,
    showFollowUpMessage = false,
    showPatientSince = false,
    showPromotionalFooter = false,
    // V3 additional footer messages
    showWorkingHours = false,
    showHomeCollection = false,
    showEmergency = false,
    showReferralProgram = false,
    showHealthPackages = false,
    showAccreditation = false,
    showWhatsAppBooking = false,
    showCustomFooterMessage = false,
    barcodeDataUrl,
    customFooter,
    reportCollectionNote,
  } = opts;

  const tests = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") === "cancelled");
  const billDigits = String(bill.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ageStr = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const ageGender = [ageStr, bill.patient?.gender].filter(Boolean).join(" / ").toUpperCase();
  const created = bill.createdAt ? new Date(bill.createdAt) : new Date();
  const isCancelled = (bill.status ?? "") === "cancelled";
  const rawDoctor = bill.order?.doctor?.name ?? "";
  const isUnconfirmedQr = (bill.payments ?? []).some((p) => String(p.method).includes("Unconfirmed"));
  const testCount = tests.length;
  // V3: Patient since date (from patient.createdAt; not on PrintBillData so we approximate)
  const patientCreatedDate = bill.createdAt ? new Date(bill.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short" }) : "";

  // ── Density: sparse = 1-2, normal = 3-5, compact = 6+ ──
  const isSparse = testCount <= 2;
  const isCompact = testCount > 5;
  const densityClass = isSparse ? "premium-sparse-mode" : isCompact ? "compact-mode" : "normal-mode";

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
  const bankAmt = payByMode["bank transfer"] || 0;

  // On a B&W printer, force the "unconfirmed" orange status to black instead
  // of grayscaling the whole page — a page-wide filter would also desaturate
  // the clinic logo, which should always print in its native color.
  const statusColor = (semantic: string): string => (isBW ? "#000" : semantic);

  // ── Sizing tuned for A5 ──
  const basePx = isSparse ? "14px" : isCompact ? "11px" : "13px";
  const headerPx = isSparse ? "11px" : isCompact ? "10px" : "11px";
  const clinicNamePx = isSparse ? "17px" : isCompact ? "14px" : "16px";
  const titlePx = isSparse ? "15px" : isCompact ? "13px" : "14px";
  const patientPx = isSparse ? "13px" : isCompact ? "11px" : "12px";
  const patientNamePx = isSparse ? "18px" : isCompact ? "13px" : "15px";
  const tablePx = isSparse ? "13px" : isCompact ? "10px" : "11px";
  const totalPx = isSparse ? "14px" : isCompact ? "11px" : "12px";
  const bigTotalPx = isSparse ? "16px" : isCompact ? "13px" : "14px";
  const footerPx = isSparse ? "13px" : isCompact ? "10px" : "11px";
  const tinyPx = isSparse ? "11px" : isCompact ? "9px" : "10px";
  const qrSize = isSparse ? "95px" : isCompact ? "55px" : "72px";
  const pageMargin = "10mm";
  const pageMarginBottom = "10mm";
  const sectionGap = isSparse ? "14px" : isCompact ? "4px" : "6px";
  const tableCellPad = isSparse ? "6px 8px" : isCompact ? "3px 5px" : "4px 6px";
  const paymentBoxPad = isSparse ? "8px 0" : "4px 0";
  const sparseGap = isSparse ? "10px" : "0"; // extra gap between major sections in sparse mode

  const isA5 = paperSize === "A5-portrait" || paperSize === "A5-landscape";
  const paperSizeCss = getPaperSizeCss(paperSize);
  const pageSizeStr = paperSizeCss.pageSize;

  // ── Billed-by name, their uploaded signature, & system info ──
  const premiumSession = (() => {
    try {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem("erp_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const billedByName: string = premiumSession?.user?.name ?? "";
  const billedBySignatureUrl: string = premiumSession?.user?.signatureDataUrl ?? "";

  const now = new Date();
  const nowDateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const nowTimeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  const showCode = clinic?.billShowCode !== false;
  const showCategory = clinic?.billShowCategory !== false;
  const colCount = 3 + (showCode ? 1 : 0) + (showCategory ? 1 : 0);

  // ── Test rows ──
  const testRows = tests.map((t, i) => {
    const code = t.test?.code ?? "";
    const name = t.displayName ?? t.test?.name ?? "";
    const cat = t.test?.category ?? "";
    const codeFont = `font-size:${Math.round(parseInt(tablePx, 10) * 0.9)}px`;
    return `<tr>
      <td style="padding:${tableCellPad};border:1px solid #000;font-size:${tablePx};text-align:center;font-weight:700">${i + 1}</td>
      ${showCode ? `<td style="padding:${tableCellPad};border:1px solid #000;font-family:monospace;${codeFont};white-space:nowrap">${esc(code)}</td>` : ""}
      <td style="padding:${tableCellPad};border:1px solid #000;font-size:${tablePx};font-weight:600;word-wrap:break-word;word-break:break-word;overflow-wrap:anywhere">${esc(name)}</td>
      ${showCategory ? `<td style="padding:${tableCellPad};border:1px solid #000;font-size:${tablePx};white-space:nowrap">${esc(cat)}</td>` : ""}
      <td style="padding:${tableCellPad};border:1px solid #000;text-align:right;font-weight:700;font-size:${tablePx}">₹${fmt(t.price)}</td>
    </tr>`;
  }).join("");

  const cancelledRow = cancelled.length === 0 ? "" : `
    <div style="margin-top:4px;font-size:${tinyPx};color:#000">
      <em>Cancelled: ${esc(cancelled.map((t) => t.displayName ?? t.test?.name ?? "").join(", "))}</em>
    </div>`;

  // ── Payment rows ──
  const payRows = (bill.payments ?? []).map((p) => {
    const ref = p.referenceNumber ? ` (${esc(p.referenceNumber)})` : "";
    const dt = p.createdAt ? new Date(p.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "";
    return `<tr>
      <td style="padding:2px 0;font-size:${tinyPx};text-transform:capitalize">${esc(p.method)}${ref ? `<span style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px">${ref}</span>` : ""}</td>
      <td style="padding:2px 0;text-align:right;font-weight:700;font-size:${tinyPx}">₹${fmt(p.amount)}</td>
      ${dt ? `<td style="padding:2px 0;text-align:right;font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px">${esc(dt)}</td>` : ""}
    </tr>`;
  }).join("");

  const hasPayDetail = (bill.payments ?? []).length > 0;
  const balanceDue = Number(bill.balanceAmount);
  const hasDue = balanceDue > 0;

  const balanceRow = isUnconfirmedQr
    ? `<tr>
      <td style="padding:4px 6px;border-top:2px solid #000;font-weight:900;font-size:${bigTotalPx};white-space:nowrap;color:${statusColor("orange")}">DUE</td>
      <td style="padding:4px 6px;border-top:2px solid #000;text-align:right;font-weight:900;font-size:${bigTotalPx};white-space:nowrap;color:${statusColor("orange")}">To Be Confirmed</td>
    </tr>`
    : hasDue
    ? `<tr>
      <td style="padding:4px 6px;border-top:2px solid #000;font-weight:900;font-size:${bigTotalPx};white-space:nowrap">DUE</td>
      <td style="padding:4px 6px;border-top:2px solid #000;text-align:right;font-weight:900;font-size:${bigTotalPx};white-space:nowrap">₹${fmt(bill.balanceAmount)}</td>
    </tr>`
    : `<tr>
      <td style="padding:4px 6px;border-top:2px solid #000;font-weight:900;font-size:${bigTotalPx};white-space:nowrap">DUE</td>
      <td style="padding:4px 6px;border-top:2px solid #000;text-align:right;font-weight:900;font-size:${bigTotalPx};white-space:nowrap">₹0.00</td>
    </tr>`;

  // ── Payment mode breakdown rows ──
  const modeBreakdownRows = [
    cashAmt > 0 ? `<tr><td style="padding:2px 4px;font-size:${tinyPx}">Cash</td><td style="padding:2px 4px;text-align:right;font-size:${tinyPx}">₹${fmt(cashAmt)}</td></tr>` : "",
    upiAmt > 0 ? `<tr><td style="padding:2px 4px;font-size:${tinyPx}">UPI</td><td style="padding:2px 4px;text-align:right;font-size:${tinyPx}">₹${fmt(upiAmt)}</td></tr>` : "",
    cardAmt > 0 ? `<tr><td style="padding:2px 4px;font-size:${tinyPx}">Card</td><td style="padding:2px 4px;text-align:right;font-size:${tinyPx}">₹${fmt(cardAmt)}</td></tr>` : "",
    insAmt > 0 ? `<tr><td style="padding:2px 4px;font-size:${tinyPx}">Insurance</td><td style="padding:2px 4px;text-align:right;font-size:${tinyPx}">₹${fmt(insAmt)}</td></tr>` : "",
    chqAmt > 0 ? `<tr><td style="padding:2px 4px;font-size:${tinyPx}">Cheque</td><td style="padding:2px 4px;text-align:right;font-size:${tinyPx}">₹${fmt(chqAmt)}</td></tr>` : "",
    bankAmt > 0 ? `<tr><td style="padding:2px 4px;font-size:${tinyPx}">Bank Transfer</td><td style="padding:2px 4px;text-align:right;font-size:${tinyPx}">₹${fmt(bankAmt)}</td></tr>` : "",
  ].filter(Boolean).join("");

  const amountInWords = showAmountInWords ? `<div style="font-size:${tinyPx};font-style:italic;margin:3px 0 6px">${esc(numberToWords(Number(bill.totalAmount)))}</div>` : "";

  // ── Service footer (V3: from clinic settings JSON) ──
  let parsedServices: string[] = [];
  try {
    if (clinic?.serviceFooter) parsedServices = JSON.parse(clinic.serviceFooter);
  } catch { /* ignore */ }
  const serviceFooter = showServiceFooter
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;letter-spacing:0.3px;font-weight:700">${parsedServices.length > 0 ? esc(parsedServices.join(" · ").toUpperCase()) : "MRI · CT SCAN · ULTRASOUND · DIGITAL X-RAY · MAMMOGRAPHY · PATHOLOGY"}</div>`
    : "";

  // ── V3 receipt messages (clinic-driven) ──
  const receiptThankYou = showReceiptThankYou && clinic?.receiptThankYouMessage
    ? `<div style="font-size:${Math.round(parseInt(footerPx, 10) * 1.1)}px;font-weight:900;text-align:center;letter-spacing:0.8px;text-transform:uppercase">${esc(clinic.receiptThankYouMessage)}</div>`
    : "";

  const receiptCollection = showReceiptCollection && clinic?.receiptCollectionMessage
    ? `<div style="font-size:${tinyPx};text-align:center;margin:3px 0;font-weight:600">${esc(clinic.receiptCollectionMessage)}</div>`
    : "";

  const receiptQrMessage = showReceiptQrMessage && clinic?.receiptQrMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.receiptQrMessage)}</div>`
    : "";

  const receiptPromotional = showReceiptPromotional && clinic?.receiptPromotionalMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:700;letter-spacing:0.5px">${esc(clinic.receiptPromotionalMessage)}</div>`
    : "";

  const followUpMessage = showFollowUpMessage && clinic?.followUpMessage
    ? `<div style="font-size:${tinyPx};text-align:center;margin:3px 0;font-weight:600;font-style:italic">${esc(clinic.followUpMessage)}</div>`
    : "";

  // ── V3 Verified Badge ──
  const verifiedBadge = showVerifiedBadge
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">VERIFIED RECEIPT ✔</div>`
    : "";

  // ── V3 Patient Since ──
  const patientSinceLine = showPatientSince
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">Valued Patient Since ${esc(patientCreatedDate)}</div>`
    : "";

  // ── V3 Promotional Footer ──
  const promotionalFooter = showPromotionalFooter && clinic?.promotionalTitle
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 1.05)}px;text-align:center;margin:4px 0;font-weight:800;letter-spacing:0.5px;text-transform:uppercase">${esc(clinic.promotionalTitle)}</div>
       ${clinic.promotionalDescription ? `<div style="font-size:${tinyPx};text-align:center;margin:2px 0;font-weight:600">${esc(clinic.promotionalDescription)}</div>` : ""}`
    : "";

  // ── V3 Additional footer messages ──
  const workingHoursMsg = showWorkingHours && clinic?.workingHoursMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.workingHoursMessage)}</div>`
    : "";
  const homeCollectionMsg = showHomeCollection && clinic?.homeCollectionMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.homeCollectionMessage)}</div>`
    : "";
  const emergencyMsg = showEmergency && clinic?.emergencyMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">${esc(clinic.emergencyMessage)}</div>`
    : "";
  const referralMsg = showReferralProgram && clinic?.referralProgramMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.referralProgramMessage)}</div>`
    : "";
  const healthPackagesMsg = showHealthPackages && clinic?.healthPackagesMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.healthPackagesMessage)}</div>`
    : "";
  const accreditationMsg = showAccreditation && clinic?.accreditationMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:700">${esc(clinic.accreditationMessage)}</div>`
    : "";
  const whatsAppMsg = showWhatsAppBooking && clinic?.whatsAppBookingMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.whatsAppBookingMessage)}</div>`
    : "";
  const customFooterMsg = showCustomFooterMessage && clinic?.customFooterMessage
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;text-align:center;margin:2px 0;font-weight:600">${esc(clinic.customFooterMessage)}</div>`
    : "";

  // ── Legacy report message (kept for backward compat) ──
  const reportMessage = showReportMessage
    ? `<div style="font-size:${tinyPx};text-align:center;margin:3px 0;font-weight:600">${esc(clinic?.receiptCollectionMessage || "Please collect report within 7 days or download online using QR verification.")}</div>`
    : "";

  // ── Legacy footer branding (kept for backward compat) ──
  const footerBranding = showBrandingFooter
    ? `<div style="font-size:${Math.round(parseInt(footerPx, 10) * 1.1)}px;font-weight:900;text-align:center;letter-spacing:0.8px;text-transform:uppercase">${esc(clinic?.receiptThankYouMessage || "Thank You for Choosing Care Diagnostics")}</div>`
    : "";

  const customFooterLine = customFooter
    ? `<div style="font-size:${footerPx};font-weight:700;text-align:center;margin:3px 0">${esc(customFooter)}</div>`
    : reportCollectionNote
    ? `<div style="font-size:${footerPx};font-weight:700;text-align:center;margin:3px 0">${esc(reportCollectionNote)}</div>`
    : "";

  const signatureLine = showSignatureLine
    ? `${billedBySignatureUrl
        ? `<img src="${billedBySignatureUrl}" alt="Signature" style="max-height:32px;max-width:130px;object-fit:contain;display:block;margin-bottom:2px"/>`
        : `<div style="border-bottom:1px solid #000;width:130px;margin-bottom:2px"></div>`}<div style="font-size:${tinyPx};font-weight:600">Authorised Signature</div>`
    : "";

  const computerGenerated = showComputerGenerated
    ? `<div style="font-size:${tinyPx};text-align:center;font-weight:600">COMPUTER GENERATED INVOICE. NO SIGNATURE REQUIRED.</div>`
    : "";

  // ── QR block ──
  const qrBlock = showQr && qrDataUrl
    ? `<div style="text-align:center">
      <div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">SCAN TO VERIFY</div>
      <img src="${qrDataUrl}" alt="QR" style="width:${qrSize};height:${qrSize};display:block;margin:0 auto;border:1px solid #000;padding:2px;background:#fff"/>
      <div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.95)}px;font-weight:700;margin-top:3px;text-transform:uppercase">Verify Receipt</div>
      <div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px;margin-top:1px">Download Report · View Bill Details</div>
      <div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px;margin-top:2px;font-weight:600">Receipt Verification Available Online</div>
    </div>`
    : "";

  // ── Barcode block ──
  const barcodeBlock = showBarcode && barcodeDataUrl
    ? `<div style="text-align:center;margin-top:4px">
      <img src="${barcodeDataUrl}" alt="Barcode" style="max-width:120px;height:24px;display:block;margin:0 auto"/>
      <div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px;font-family:monospace;margin-top:1px;font-weight:600">${esc(billDigits)}</div>
    </div>`
    : "";

  // ── Patient instructions ──
  const patientInstructions = showPatientInstructions
    ? `<div style="font-size:${tinyPx};text-align:center;margin:4px 0;font-weight:600">
      Please preserve this receipt for future reference. Collect reports within 7 days. Scan QR code to download available reports.
    </div>`
    : "";

  // ── System info ──
  const systemInfo = showSystemInfo
    ? `<div style="font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px;text-align:center;margin:2px 0">
      <span style="font-weight:700">Generated On:</span> ${esc(nowDateStr)} ${esc(nowTimeStr)} &nbsp;|&nbsp;
      <span style="font-weight:700">Printed By:</span> ${esc(billedByName || "System")}
    </div>`
    : "";

  // ── Watermark ──
  const watermarkStyle = showWatermark
    ? `<div style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;opacity:0.06;font-size:56px;font-weight:900;text-transform:uppercase;letter-spacing:10px;color:#000;text-align:center;display:flex;align-items:center;justify-content:center;transform:rotate(-25deg)">${esc(clinic?.name || "Care Diagnostics")}</div>`
    : "";

  const copyLabelDiv = copyLabel ? `<div style="text-align:right;font-size:${tinyPx};font-weight:800;border:1px dashed #000;display:inline-block;padding:2px 6px;float:right">${esc(copyLabel)}</div>` : "";

  const reprintNotice = reprintBy || reprintReason
    ? `<div style="text-align:center;font-size:${tinyPx};border:1px dashed #000;padding:2px 4px;margin-bottom:6px;text-transform:uppercase;font-weight:700">DUPLICATE / RE-PRINT${reprintBy ? ` · BY ${esc(reprintBy)}` : ""}${reprintReason ? ` · ${esc(reprintReason)}` : ""}</div>`
    : "";

  // ── Copy type detection ──
  const copyType = copyLabel?.toLowerCase().includes("patient") ? "patient" : copyLabel?.toLowerCase().includes("office") ? "office" : "other";

  // ── Audit info visibility (Patient Copy hides audit info by default — setting defaults OFF) ──
  const showAuditInfo = copyType !== "patient" || clinic?.showAuditInfoOnPatientCopy === true;

  // ── Dynamic footer sizing based on density ──
  const footerSpacing = isSparse ? "12px 0 8px" : isCompact ? "3px 0 2px" : "6px 0 4px";
  const footerBorderTop = isSparse ? "1.5px" : "1px";
  const footerTaglineSize = isSparse ? "12px" : isCompact ? "9px" : "10px";
  const footerTaglineMargin = isSparse ? "6px" : isCompact ? "2px" : "4px";
  const footerServiceMargin = isSparse ? "6px" : isCompact ? "2px" : "4px";
  const footerBrandingMargin = isSparse ? "8px" : isCompact ? "2px" : "4px";
  const footerGeneratedMargin = isSparse ? "6px" : isCompact ? "2px" : "4px";
  const footerSystemMargin = isSparse ? "4px" : isCompact ? "1px" : "2px";

  // ── Main HTML ──
  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Bill ${esc(bill.billNumber)}</title>
<style>
  @page { size: ${pageSizeStr}; margin: ${pageMargin} ${pageMargin} ${pageMarginBottom} ${pageMargin}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #fff; color: #000;
    font-family: Arial, Helvetica, sans-serif;
    font-size: ${basePx};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .receipt {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    width: 100%;
    padding: 2mm 3mm;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
  }
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .main-content.premium-sparse-mode {
    gap: 10px;
    justify-content: space-between;
  }
  .main-content.normal-mode {
    gap: 6px;
    justify-content: flex-start;
  }
  .main-content.compact-mode {
    gap: 4px;
    justify-content: flex-start;
  }
  .footer-panel {
    margin-top: auto;
    padding-bottom: 4mm;
  }
  .no-break { page-break-inside: avoid; }
  .receipt table tr { page-break-inside: avoid; }
  .page-break { page-break-before: always; }
  .header-repeat { display: none; }
  @media print {
    html, body { margin: 0; padding: 0; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .receipt { margin: 0; }
    .receipt * { color: #000 !important; border-color: #000 !important; background: transparent !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .receipt *::before, .receipt *::after { background: transparent !important; border-color: #000 !important; }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  ${watermarkStyle}
  <div class="receipt ${densityClass}">
    ${reprintNotice}
    ${copyLabelDiv ? `<div style="margin-bottom:4px;overflow:hidden">${copyLabelDiv}</div>` : ""}

    <div class="main-content ${densityClass}">
    <!-- HEADER — compact single-row, 20-25% less height -->
    <div class="header-block no-break" style="padding: 2px 0 4px; border-bottom: 2px solid #000;">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="vertical-align:top;padding:0;width:50%">
            ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" alt="logo" style="max-height:${isSparse ? "44px" : "36px"};max-width:120px;object-fit:contain;display:block;margin-bottom:1px"/>` : ""}
            <div style="font-size:${clinicNamePx};font-weight:900;color:#000;letter-spacing:0.5px;text-transform:uppercase;line-height:1.1">${esc(clinic?.name || "Care Diagnostics")}</div>
            <div style="font-size:${basePx};color:#000;font-weight:700;line-height:1.2;letter-spacing:0.3px">${esc(clinic?.tagline || "Touching Lives With Care")}</div>
          </td>
          <td style="vertical-align:top;text-align:right;padding:0;font-size:${headerPx};line-height:1.35;color:#000;font-weight:700">
            ${clinic?.address ? `<div>${esc(clinic.address.replace(/\s*\n\s*/g, ", ").trim())}</div>` : ""}
            ${clinic?.phone ? `<div>PH: ${esc(clinic.phone)}</div>` : ""}
            ${clinic?.email ? `<div>${esc(clinic.email)}</div>` : ""}
            ${clinic?.website ? `<div>${esc(clinic.website)}</div>` : ""}
            ${clinic?.gstin ? `<div style="margin-top:1px;font-weight:800">GSTIN: ${esc(clinic.gstin)}</div>` : ""}
          </td>
        </tr>
      </table>
    </div>

    <!-- TITLE + BILL NO -->
    <div class="title-block no-break" style="border-bottom: 1px solid #000; padding: ${isSparse ? "5px 0" : "3px 0"}; margin-bottom: ${sectionGap};">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:0;vertical-align:middle">
            <div style="font-size:${titlePx};font-weight:800;letter-spacing:1.2px;text-transform:uppercase">${isCancelled ? "CANCELLED" : isUnconfirmedQr ? "Confirmed on confirmation of Payment" : "INVOICE / RECEIPT"}</div>
          </td>
          <td style="padding:0;vertical-align:middle;text-align:right;white-space:nowrap">
            <div style="font-size:${titlePx};font-weight:800">BILL NO: ${esc(billDigits)}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- PATIENT INFO CARD — strong bordered box, name most prominent -->
    <div class="patient-block no-break" style="margin-bottom: ${sectionGap}; border: 1.5px solid #000; padding: ${isSparse ? "8px 10px" : "5px 8px"};">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="vertical-align:top;padding:0;width:55%">
            <div style="font-size:${patientNamePx};font-weight:900;line-height:1.2;text-transform:uppercase;color:#000">${esc(`${bill.patient?.firstName ?? ""} ${bill.patient?.lastName ?? ""}`.trim())}</div>
            <div style="font-size:${patientPx};font-weight:700;margin-top:4px">${esc(ageGender)}</div>
            <div style="font-size:${patientPx};font-weight:700;margin-top:2px">PH: ${esc(bill.patient?.phone ?? "")}</div>
            <div style="font-size:${patientPx};font-weight:700;margin-top:2px">
              REF: <strong>${rawDoctor ? esc(rawDoctor.match(/^\s*DR\.?\s*/i) ? rawDoctor.trim().toUpperCase() : "DR. " + rawDoctor.trim().toUpperCase()) : "SELF / WALK-IN"}</strong>
            </div>
          </td>
          <td style="vertical-align:top;text-align:right;padding:0;font-size:${patientPx};line-height:1.5;color:#000">
            <div style="font-weight:800">${created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} &nbsp;${created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase()}</div>
            <div style="margin-top:3px;font-weight:700">ID: ${esc(bill.patient?.patientId ?? "")}</div>
            <div style="margin-top:2px;font-weight:700">BILL: ${esc(billDigits)}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- TEST TABLE -->
    <div class="test-table no-break" style="margin-bottom: ${sectionGap};">
      <table style="width:100%;border-collapse:collapse;font-size:${tablePx}">
        <thead>
          <tr>
            <th style="padding:${tableCellPad};border:1px solid #000;text-align:center;font-weight:800">#</th>
            ${showCode ? `<th style="padding:${tableCellPad};border:1px solid #000;text-align:left;font-weight:800">CODE</th>` : ""}
            <th style="padding:${tableCellPad};border:1px solid #000;text-align:left;font-weight:800">TEST NAME</th>
            ${showCategory ? `<th style="padding:${tableCellPad};border:1px solid #000;text-align:left;font-weight:800">CATEGORY</th>` : ""}
            <th style="padding:${tableCellPad};border:1px solid #000;text-align:right;font-weight:800">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${testRows || `<tr><td colspan="${colCount}" style="padding:8px;text-align:center;border:1px solid #000">No tests on this bill</td></tr>`}
        </tbody>
      </table>
      ${cancelledRow}
    </div>

    ${amountInWords}

    <!-- PAYMENT + SUMMARY — three-column layout: QR | Details | Summary Box -->
    <div class="payment-section no-break" style="padding: ${paymentBoxPad}; margin-bottom: ${sectionGap};">
      <table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed">
        <colgroup>
          <col style="width:${qrBlock ? (isSparse ? "105px" : "80px") : "0"}"/>
          <col/>
          <col style="width:${isA5 ? (isSparse ? "155px" : "160px") : "220px"}"/>
        </colgroup>
        <tbody>
          <tr>
            <td style="vertical-align:top;padding:0">
              <div>${qrBlock}${barcodeBlock}</div>
            </td>
            <td style="vertical-align:top;padding:0 8px 0 0;font-size:${tinyPx}">
              ${hasPayDetail ? `<div style="font-weight:800;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px;font-size:${Math.round(parseInt(tinyPx, 10) * 1.1)}px">PAYMENT DETAILS</div>
                <table style="width:100%;border-collapse:collapse"><tbody>${payRows}</tbody></table>
                ${modeBreakdownRows ? `<div style="font-weight:700;border-top:1px solid #000;margin-top:3px;padding-top:3px;font-size:${Math.round(parseInt(tinyPx, 10) * 1.05)}px">TOTAL PAID</div><table style="width:100%;border-collapse:collapse"><tbody>${modeBreakdownRows}</tbody></table>` : ""}` : ""}
            </td>
            <td style="vertical-align:top;padding:0">
              <div style="border:1.5px solid #000;padding:4px 6px;">
                <table style="width:100%;border-collapse:collapse;font-size:${totalPx};table-layout:fixed">
                  <tbody>
                    <tr><td style="padding:3px 4px">SUBTOTAL</td><td style="padding:3px 4px;text-align:right;white-space:nowrap">₹${fmt(bill.subtotal)}</td></tr>
                    ${Number(bill.discount) > 0 ? `<tr><td style="padding:3px 4px">DISCOUNT</td><td style="padding:3px 4px;text-align:right;white-space:nowrap">₹${fmt(bill.discount)}</td></tr>` : ""}
                    <tr>
                      <td style="padding:4px 4px;border-top:2px solid #000;font-weight:900;font-size:${bigTotalPx}">TOTAL</td>
                      <td style="padding:4px 4px;border-top:2px solid #000;text-align:right;font-weight:900;font-size:${bigTotalPx};white-space:nowrap">₹${fmt(bill.totalAmount)}</td>
                    </tr>
                    <tr><td style="padding:3px 4px;border-top:1px solid #000;font-weight:800">PAID</td><td style="padding:3px 4px;border-top:1px solid #000;text-align:right;font-weight:800;white-space:nowrap;color:${isUnconfirmedQr ? statusColor("orange") : "inherit"}">${isUnconfirmedQr ? `₹${fmt(bill.totalAmount)} (To Be Confirmed)` : `₹${fmt(bill.paidAmount)}`}</td></tr>
                    ${balanceRow}
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- PATIENT INSTRUCTIONS (optional) -->
    ${patientInstructions}
  </div>

  <!-- FOOTER PANEL — pinned to bottom via margin-top:auto -->
  <div class="footer-panel no-break" style="padding: ${footerSpacing}; border-top: ${footerBorderTop} solid #000;">
    <!-- V3 receipt messages (priority: thank-you → collection → verified → QR msg → promotional msg → follow-up → patient since) -->
    ${receiptThankYou ? `<div style="margin-bottom:${footerBrandingMargin}">${receiptThankYou}</div>` : ""}
    ${receiptCollection ? `<div style="margin-top:${footerGeneratedMargin}">${receiptCollection}</div>` : ""}
    ${verifiedBadge ? `<div style="margin-top:${footerGeneratedMargin}">${verifiedBadge}</div>` : ""}
    ${receiptQrMessage ? `<div style="margin-top:${footerGeneratedMargin}">${receiptQrMessage}</div>` : ""}
    ${receiptPromotional ? `<div style="margin-top:${footerGeneratedMargin}">${receiptPromotional}</div>` : ""}
    ${followUpMessage ? `<div style="margin-top:${footerGeneratedMargin}">${followUpMessage}</div>` : ""}
    ${patientSinceLine ? `<div style="margin-top:${footerGeneratedMargin}">${patientSinceLine}</div>` : ""}
    ${promotionalFooter ? `<div style="margin-top:${footerGeneratedMargin}">${promotionalFooter}</div>` : ""}
    <!-- V3 Additional footer messages -->
    ${workingHoursMsg ? `<div style="margin-top:${footerGeneratedMargin}">${workingHoursMsg}</div>` : ""}
    ${homeCollectionMsg ? `<div style="margin-top:${footerGeneratedMargin}">${homeCollectionMsg}</div>` : ""}
    ${emergencyMsg ? `<div style="margin-top:${footerGeneratedMargin}">${emergencyMsg}</div>` : ""}
    ${referralMsg ? `<div style="margin-top:${footerGeneratedMargin}">${referralMsg}</div>` : ""}
    ${healthPackagesMsg ? `<div style="margin-top:${footerGeneratedMargin}">${healthPackagesMsg}</div>` : ""}
    ${accreditationMsg ? `<div style="margin-top:${footerGeneratedMargin}">${accreditationMsg}</div>` : ""}
    ${whatsAppMsg ? `<div style="margin-top:${footerGeneratedMargin}">${whatsAppMsg}</div>` : ""}
    ${customFooterMsg ? `<div style="margin-top:${footerGeneratedMargin}">${customFooterMsg}</div>` : ""}
    <!-- Legacy fallback blocks -->
    ${footerBranding ? `<div style="margin-bottom:${footerBrandingMargin}">${footerBranding}</div>` : ""}
    ${customFooterLine}
    ${serviceFooter ? `<div style="margin-top:${footerServiceMargin}">${serviceFooter}</div>` : ""}
    ${showBrandingFooter ? `<div style="font-size:${footerTaglineSize};font-weight:700;text-align:center;letter-spacing:0.5px;text-transform:uppercase;margin-top:${footerTaglineMargin}">Touching Lives With Care</div>` : ""}
    ${reportMessage ? `<div style="margin-top:${footerGeneratedMargin}">${reportMessage}</div>` : ""}
    ${computerGenerated ? `<div style="margin-top:${footerGeneratedMargin}">${computerGenerated}</div>` : ""}
    ${(showAuditInfo && systemInfo) ? `<div style="margin-top:${footerSystemMargin}">${systemInfo}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:6px">
      <tr>
        <td style="text-align:left;padding:0;vertical-align:bottom">
          ${signatureLine}
        </td>
        <td style="text-align:right;padding:0;vertical-align:bottom;font-size:${tinyPx}">
          ${billedByName ? `<div style="font-weight:700">Billed By: ${esc(billedByName)}</div>` : ""}
          ${showAuditInfo ? `<div style="margin-top:1px">${esc(nowDateStr)} ${esc(nowTimeStr)}</div>` : ""}
        </td>
      </tr>
    </table>
  </div>
</div>
</html>
`;

  return html;
}
