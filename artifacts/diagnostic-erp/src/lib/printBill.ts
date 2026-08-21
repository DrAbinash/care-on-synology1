// Bill receipt printing — HOPE A5 portrait geometry (148×210 mm).
// Visual layout mirrors legacy HOPE OPD A5; CARE owns finance / QR / audit.

import { resolveBillLogoHeightPx } from "./billPrintSettings";

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
  /** Staff who created the bill — used as OPERATOR_ID in the audit / QR hash. */
  createdByName?: string | null;
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
      test?: { code?: string | null; name?: string | null; category?: string | null; duration?: string | null } | null;
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
  showTatOnBill?: boolean;
  // Clinic-wide Billing Print settings blob (JSON of Partial<BillPrintSettings>)
  // from /api/clinic-settings/branding — parse with parseGlobalBillPrintSettings
  // and pass to loadBillPrintSettings so prints honor the admin's paper size.
  billPrintSettingsJson?: string | null;
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
  // Only commit to the (ageValue, ageUnit) path when it will produce a real
  // string — a stored value of 0 (from a blank field on registration) must
  // fall through to dateOfBirth instead of short-circuiting to "".
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

function fmt(n: number | string): string {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Muted uppercase metadata label (PH:, EMAIL:, BILL NO:, REF:). */
function metaLabel(text: string, size: string): string {
  return `<span style="font-size:${size};font-weight:500;color:#64748b;letter-spacing:0.04em;text-transform:uppercase">${esc(text)}</span>`;
}

/** Dark charcoal value next to a metadata label. */
function metaValue(text: string, size: string, weight = 700): string {
  return `<span style="font-size:${size};font-weight:${weight};color:#0f172a">${esc(text)}</span>`;
}

export type BillAuditHashInput = {
  billNumber: string;
  createdAt?: string | Date | null;
  totalAmount: number | string;
  /** Prefer stable creator name (matches bills.created_by_name) over session id. */
  operatorId?: string | number | null;
};

/** Normalize bill number digits the same way the verify endpoint does. */
export function normalizeBillDigits(billNumber: string): string {
  return String(billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
}

/** Canonical payload: BILL_NO-TIMESTAMP-TOTAL-OPERATOR_ID. */
export function buildBillAuditPayload(opts: BillAuditHashInput): string {
  const billNo = normalizeBillDigits(opts.billNumber);
  const ts = (() => {
    const d = opts.createdAt ? new Date(opts.createdAt) : new Date();
    if (isNaN(d.getTime())) return "0";
    return String(Math.floor(d.getTime() / 1000));
  })();
  const total = Number(opts.totalAmount || 0).toFixed(2);
  const op = String(opts.operatorId ?? "0");
  return `${billNo}-${ts}-${total}-${op}`;
}

/** 32-bit FNV-1a → uppercase 8-char hex (must match api-server billAuditHash). */
export function fnv1a32Hex(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

/** FNV-1a hash only — encoded as the QR `?hash=` query parameter. */
export function buildBillAuditHash(opts: BillAuditHashInput): string {
  return fnv1a32Hex(buildBillAuditPayload(opts));
}

/**
 * Lightweight on-page audit token: BILL_NO-TIMESTAMP-TOTAL-OPERATOR_ID-HASH.
 * Deterministic FNV-1a — tamper-evident for manual audit without a crypto lib.
 */
export function buildBillAuditToken(opts: BillAuditHashInput): string {
  const payload = buildBillAuditPayload(opts);
  return `${payload}-${fnv1a32Hex(payload)}`;
}

/**
 * Public bill-verification URL embedded in the printed QR.
 * Format: `{origin}/api/verify/bill/{billNo}?hash={fnv1a}`
 * (on caredeoghar.com this is https://caredeoghar.com/api/verify/bill/…?hash=…).
 */
export function buildBillVerifyUrl(
  opts: BillAuditHashInput & { origin?: string },
): string {
  const origin =
    opts.origin ??
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "");
  const hash = buildBillAuditHash(opts);
  return `${origin}/api/verify/bill/${encodeURIComponent(String(opts.billNumber))}?hash=${encodeURIComponent(hash)}`;
}

import { buildDocumentHtml } from "./documentLayout/buildDocumentHtml";
import { resolveBillPrintPaperFromOpts } from "./documentLayout/billPaper";
import {
  parseGlobalBillPrintSettings,
  resolveBillPrintCopyCount,
} from "./billPrintSettings";
export {
  printViaIframe,
  openBlankPrintWindow,
  writeAndPrint,
} from "./documentLayout/printDelivery";

export type BuildPrintHtmlOpts = {
  bill: PrintBillData;
  clinic: PrintClinic;
  paperSize: "A4" | "A5";
  // A5 sheets can be fed to the printer either way — most B&W desktop/thermal
  // printers used at billing counters default to landscape A5. Optional and
  // defaults to "portrait" so every existing caller keeps its current output
  // unchanged unless it explicitly opts in.
  orientation?: "portrait" | "landscape";
  isBW: boolean;
  qrDataUrl: string;
  reprintBy?: string;
  reprintReason?: string;
  /** Offline / NAS-down receipt — not yet on server; QR verification disabled. */
  provisionalReceipt?: boolean;
  copyLabel?: string;
  showQr?: boolean;
  /** Show test catalog duration as a TAT column (clinic Show TAT on Bill). */
  showTat?: boolean;
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
  // Big "QUEUE TOKEN #NN" box (classic format only) — see BillPrintSettings.
  // Undefined defaults to false (caller opts in explicitly, e.g. Kiosk.tsx).
  showQueueToken?: boolean;
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
  // When true, the footer sits a fixed ~3-4 lines below the content instead
  // of being pushed to the physical bottom of the content box via flex. Use
  // only for tall A4 pages / patient booking slips — on the 148 mm half-sheet
  // pinning the footer fills the receipt instead of leaving blank below.
  // Defaults to false.
  compactFooterGap?: boolean;
  // When true (with paperSize "A5"), the receipt keeps its compact A5 content
  // sizing but is printed on a physical A4 page — the A5-width slip is centred
  // at the top of the sheet. This is for patient-facing copies (online booking
  // receipt): almost every patient prints on A4, so declaring an A5 @page made
  // printers scale/centre awkwardly or leave the content in a narrow, mostly
  // blank band. A4 @page prints predictably on their paper while the slip stays
  // a tidy, cuttable A5 receipt rather than being stretched to fill A4.
  // Defaults to false so Billing Desk's A5 output is unaffected.
  compactOnA4?: boolean;
  /** Exact CSS @page size (from resolveBillPrintPageOpts). */
  pageCssSize?: string;
  // Layout & typography overrides — see BillPrintSettings's matching
  // print*Px/printMarginMm fields. Each is undefined/null-safe: omit or
  // pass null to fall back to the built-in format default for that element.
  // printLogoHeightPx applies to the bill header logo.
  printMarginMm?: number | null;
  printLogoHeightPx?: number | null;
  /** Header layout: "right" (default) = address/phone/website under the invoice
   * title on the right, bigger logo on the left; "left" = address under the clinic name.
   * Bill number lives in the patient meta block (under date/time), not the header. */
  headerLayout?: "left" | "right" | null;
  printTitleFontPx?: number | null;
  printPatientNameFontPx?: number | null;
  printBodyFontPx?: number | null;
  printHeaderFontPx?: number | null;
  printTableFontPx?: number | null;
  printTotalFontPx?: number | null;
  printFooterFontPx?: number | null;
  printTinyFontPx?: number | null;
};

export function buildClassicBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  const {
    bill, clinic, paperSize, orientation = "portrait", isBW, qrDataUrl,
    reprintBy, reprintReason, compactFooterGap = false, compactOnA4 = false,
    pageCssSize, provisionalReceipt = false,
  } = opts;
  const rawBillPrintSettings = parseGlobalBillPrintSettings(clinic?.billPrintSettingsJson);
  const copies = resolveBillPrintCopyCount(clinic, rawBillPrintSettings);
  // HOPE A5 service table is Service | Amount. Category becomes optional group
  // headers (not a column). Code/TAT are not HOPE columns — TAT may annotate
  // the service name when the clinic toggle is on.
  const showCategory = clinic?.billShowCategory !== false;
  const qrEnabled = (opts.showQr !== false) && clinic?.qrOnBillEnabled !== false;
  const showTat = (opts.showTat ?? clinic?.showTatOnBill) === true;
  const isA5 = paperSize === "A5";
  const a4Page = compactOnA4 && isA5;
  const paper = resolveBillPrintPaperFromOpts({
    paperSize,
    orientation,
    pageCssSize,
    compactOnA4: a4Page,
  });
  const isA4Paper = paper === "A4";

  const tests = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") === "cancelled");
  const billDigits = String(bill.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ageStr = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const ageGender = [bill.patient?.gender, ageStr].filter(Boolean).join(" / ");
  const created = bill.createdAt ? new Date(bill.createdAt) : new Date();
  const isCancelled = (bill.status ?? "") === "cancelled";
  const rawDoctor = bill.order?.doctor?.name ?? "";
  const isUnconfirmedQr = (bill.payments ?? []).some((p) => String(p.method).includes("Unconfirmed"));

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

  // HOPE A5 portrait is the default geometry. Half-sheet / A4 compact retain
  // CARE overflow behaviour but share the same visual structure.
  const isHalfSheet = paper === "A5-landscape" || paper === "half-a4";
  const useCompactFooter = isHalfSheet ? false : Boolean(compactFooterGap);
  const defaultMarginMm =
    paper === "A5-portrait" ? 8 :
    paper === "A5-landscape" || paper === "half-a4" ? 4 :
    4;
  const marginMm = opts.printMarginMm ?? defaultMarginMm;
  const logoH = resolveBillLogoHeightPx(opts.printLogoHeightPx, isA4Paper ? 90 : 68);

  const session = (() => {
    try {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem("erp_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const billedByName: string = session?.user?.name ?? "";
  const billedBySignatureUrl: string = session?.user?.signatureDataUrl ?? "";
  // Prefer the bill's stored creator (matches DB verification) over the
  // reprinting user's session — keeps QR hash and printed audit token aligned
  // with /api/verify/bill/:id?hash=…
  const operatorId: string | number =
    (bill.createdByName && String(bill.createdByName).trim()) ||
    billedByName ||
    session?.user?.id ||
    "0";

  const auditToken = buildBillAuditToken({
    billNumber: bill.billNumber,
    createdAt: bill.createdAt,
    totalAmount: bill.totalAmount,
    operatorId,
  });

  const ink = isBW ? "#000" : "#722626";
  const border = isBW ? "#000" : "#722626";
  const patientName = `${bill.patient?.firstName ?? ""} ${bill.patient?.lastName ?? ""}`.trim() || "—";
  const doctorDisplay = rawDoctor
    ? (rawDoctor.match(/^\s*DR\.?\s*/i) ? rawDoctor.trim() : `Dr. ${rawDoctor.trim()}`)
    : "Self";
  const dateTimeStr = `${created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
  const receiptTitle = provisionalReceipt
    ? "Provisional Receipt"
    : isCancelled
      ? "Cancelled Receipt"
      : "Receipt";

  const paymentModeParts: string[] = [];
  if (cashAmt > 0) paymentModeParts.push(`Cash: ₹${fmt(cashAmt)}`);
  if (upiAmt > 0) paymentModeParts.push(`UPI: ₹${fmt(upiAmt)}`);
  if (cardAmt > 0) paymentModeParts.push(`Card: ₹${fmt(cardAmt)}`);
  if (insAmt > 0) paymentModeParts.push(`Insurance: ₹${fmt(insAmt)}`);
  if (chqAmt > 0) paymentModeParts.push(`Cheque: ₹${fmt(chqAmt)}`);
  const paymentModeLine = paymentModeParts.length > 0
    ? paymentModeParts.join(" · ")
    : Number(bill.paidAmount || 0) > 0
      ? "Paid"
      : "—";

  type ServiceRow = { name: string; amount: number; category: string; tat: string };
  const serviceRows: ServiceRow[] = tests.map((t) => {
    const name = t.displayName ?? t.test?.name ?? "Test";
    const tat = (t.test?.duration ?? "").trim();
    const display = showTat && tat ? `${name} (${tat})` : name;
    return {
      name: display,
      amount: Number(t.price || 0),
      category: (t.test?.category || "").trim() || "General",
      tat,
    };
  });

  const renderServiceBody = (): string => {
    if (serviceRows.length === 0) {
      return `<tr><td colspan="2" style="text-align:center;padding:6px;">No services</td></tr>`;
    }
    if (!showCategory) {
      return serviceRows.map((r) => `
        <tr>
          <td>${esc(r.name)}</td>
          <td class="amt">₹${fmt(r.amount)}</td>
        </tr>`).join("");
    }
    const byCat = new Map<string, ServiceRow[]>();
    for (const r of serviceRows) {
      const list = byCat.get(r.category) || [];
      list.push(r);
      byCat.set(r.category, list);
    }
    const parts: string[] = [];
    for (const [cat, rows] of byCat) {
      parts.push(`<tr class="cat-row"><td colspan="2"><b>${esc(cat)}</b></td></tr>`);
      for (const r of rows) {
        parts.push(`
          <tr>
            <td style="padding-left:12px;">${esc(r.name)}</td>
            <td class="amt">₹${fmt(r.amount)}</td>
          </tr>`);
      }
    }
    return parts.join("");
  };

  const cancelledBlock = cancelled.length > 0 ? `
    <div class="cancel-note">
      Cancelled: ${esc(cancelled.map((t) => t.displayName ?? t.test?.name ?? "").filter(Boolean).join(", "))}
    </div>` : "";

  const discountAmt = Number(bill.discount || 0);
  const discountRow = discountAmt > 0 ? `
    <tr>
      <td class="tot-label">Bill Discount:</td>
      <td class="tot-val">₹${fmt(discountAmt)}</td>
    </tr>` : "";

  const balAmt = Number(bill.balanceAmount || 0);
  const balDueBg = isBW ? "#eee" : (isUnconfirmedQr ? "#fef3c7" : balAmt > 0 ? "#fef2f2" : "#f0fdf4");
  const balDueColor = isBW ? "#000" : (isUnconfirmedQr ? "#b45309" : balAmt > 0 ? "#b91c1c" : "#15803d");

  const qrBlock = (qrEnabled && qrDataUrl) ? `
    <div class="qr-wrap">
      <img src="${qrDataUrl}" alt="QR" width="70" height="70" />
      <div class="qr-caption">Scan to verify</div>
      ${isUnconfirmedQr ? `<div class="qr-warn">⚠ Unconfirmed QR</div>` : ""}
      <div class="audit-token" title="Audit token">${esc(auditToken)}</div>
    </div>` : `
    <div class="audit-token" title="Audit token">${esc(auditToken)}</div>`;

  const reprintBanner = (reprintBy || reprintReason) ? `
    <div class="reprint-banner">
      REPRINT${reprintBy ? ` · ${esc(reprintBy)}` : ""}${reprintReason ? ` · ${esc(reprintReason)}` : ""}
      · ${esc(new Date().toLocaleDateString("en-IN"))}
    </div>` : "";

  const provisionalBanner = provisionalReceipt ? `
    <div class="provisional-banner">
      Provisional Receipt — Server Offline · Will Sync Automatically · QR Valid After Sync
    </div>` : "";

  const queueTokenBlock = opts.showQueueToken && bill.tokenNo ? `
    <div class="queue-token">
      <div class="queue-label">QUEUE TOKEN</div>
      <div class="queue-num">#${esc(String(bill.tokenNo))}</div>
    </div>` : "";

  const testTokensBlock = opts.showQueueToken && bill.testTokens && bill.testTokens.length > 0
    ? (() => {
        const seen = new Set<string>();
        const deduped = bill.testTokens.filter((tt) => {
          const key = `${tt.department}::${tt.roomNumber}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return `
    <div class="test-tokens">
      ${deduped.map((tt) => `<div><strong>${esc(tt.department)}</strong>: Token #${esc(String(tt.tokenNo))}${tt.roomNumber ? ` · Room ${esc(tt.roomNumber)}` : ""}</div>`).join("")}
    </div>`;
      })()
    : "";

  const preparedBy = esc(
    (bill.createdByName && String(bill.createdByName).trim()) ||
    billedByName ||
    "Staff",
  );

  const buildOneCopy = (copyIndex: number): string => {
    const copyLabelText =
      opts.copyLabel ??
      (copies > 1
        ? copyIndex === 0
          ? "Patient Copy"
          : "Office Copy"
        : "");
    return `
<div class="receipt-shell hope-bill">
  <div class="receipt-main">
  ${copyLabelText ? `<div class="copy-tag">${esc(copyLabelText)}</div>` : ""}
  ${provisionalBanner}
  ${reprintBanner}

  <table class="hdr-table">
    <tr>
      <td class="logo-cell">
        ${clinic?.logoDataUrl
          ? `<img src="${clinic.logoDataUrl}" alt="" class="logo-img" style="max-height:${logoH}px;max-width:${Math.round(logoH * 1.4)}px" />`
          : `<div class="logo-fallback">${esc((clinic?.name || "C").slice(0, 1))}</div>`}
      </td>
      <td class="hdr-text">
        <div class="clinic-name">${esc(clinic?.name || "Care Diagnostics")}</div>
        ${clinic?.tagline ? `<div class="clinic-line">${esc(clinic.tagline)}</div>` : ""}
        ${clinic?.address ? clinic.address.split(/\s*\n\s*/).filter(Boolean).map((line) => `<div class="clinic-line">${esc(line.trim())}</div>`).join("") : ""}
        ${clinic?.email ? `<div class="clinic-line">${esc(clinic.email)}</div>` : ""}
        ${clinic?.phone ? `<div class="clinic-line">Phone: ${esc(clinic.phone)}</div>` : ""}
        ${clinic?.website ? `<div class="clinic-line">${esc(clinic.website)}</div>` : ""}
        ${clinic?.gstin ? `<div class="clinic-line">GSTIN: ${esc(clinic.gstin)}</div>` : ""}
      </td>
    </tr>
  </table>

  <div class="title-bar">${esc(receiptTitle)}</div>

  <table class="meta-table">
    <tr>
      <td class="meta-label">Date &amp; Time</td>
      <td class="meta-val" data-bill-meta="date">${esc(dateTimeStr)}</td>
      <td class="meta-label">Bill No.</td>
      <td class="meta-val" data-bill-meta="bill-no">${esc(billDigits)}</td>
    </tr>
    <tr>
      <td class="meta-label">UHID</td>
      <td class="meta-val" data-bill-meta="phone-id">${esc(bill.patient?.patientId || "—")}</td>
      <td class="meta-label">Patient</td>
      <td class="meta-val">${esc(patientName)}</td>
    </tr>
    <tr>
      <td class="meta-label">Gender / Age</td>
      <td class="meta-val">${esc(ageGender || "—")}</td>
      <td class="meta-label">Mobile</td>
      <td class="meta-val">${esc(bill.patient?.phone || "—")}</td>
    </tr>
    <tr>
      <td class="meta-label">Ref. By</td>
      <td class="meta-val" colspan="3">${esc(doctorDisplay)}</td>
    </tr>
  </table>

  ${queueTokenBlock}
  ${testTokensBlock}

  <table class="svc-table">
    <thead>
      <tr>
        <th class="svc-name">Service</th>
        <th class="svc-amt">Amount (Rs.)</th>
      </tr>
    </thead>
    <tbody>
      ${renderServiceBody()}
    </tbody>
  </table>
  ${cancelledBlock}

  <table class="financial-block pay-summary">
    <tr>
      <td class="pay-left">
        <div><span class="meta-label">Payment Mode:</span> ${esc(paymentModeLine)}</div>
        ${qrBlock}
      </td>
      <td class="pay-right">
        <table class="totals-grid totals-table">
          <tr>
            <td class="tot-label">Grand Total:</td>
            <td class="tot-val">₹${fmt(bill.subtotal)}</td>
          </tr>
          ${discountRow}
          <tr class="net-row">
            <td class="tot-label">Net Amount:</td>
            <td class="tot-val">₹${fmt(bill.totalAmount)}</td>
          </tr>
          <tr>
            <td class="tot-label">Paid:</td>
            <td class="tot-val">${isUnconfirmedQr ? `${fmt(bill.totalAmount)} (Pending)` : `₹${fmt(bill.paidAmount)}`}</td>
          </tr>
          <tr>
            <td class="tot-label" style="background:${balDueBg};color:${balDueColor}">Balance:</td>
            <td class="tot-val" style="background:${balDueBg};color:${balDueColor}">${isUnconfirmedQr ? "To Be Confirmed" : `₹${fmt(balAmt)}`}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  </div>

  <div class="receipt-footer">
    <div class="footer-note">${esc(clinic?.footerNote || bill.reportCollectionNote || "Thank you for choosing our diagnostic services.")}</div>
    <table class="sign-table">
      <tr>
        <td class="sign-left">
          Prepared By: ${preparedBy}
        </td>
        <td class="sign-right">
          ${billedBySignatureUrl
            ? `<img src="${billedBySignatureUrl}" alt="Signature" class="sign-img" />`
            : `<div class="sign-line"></div>`}
          Authorised Signatory
        </td>
      </tr>
    </table>
  </div>
</div>`;
  };

  const pages = Array.from({ length: Math.max(1, copies) }, (_, i) => buildOneCopy(i));

  const shellMinHeight = useCompactFooter ? "" : "min-height: 100%;";
  const footerMargin = useCompactFooter ? "margin-top: 8px !important;" : "margin-top: auto !important;";

  return buildDocumentHtml({
    title: `Bill ${esc(bill.billNumber)}`,
    paper,
    safePaddingMm: marginMm,
    compactSlipOnA4: a4Page,
    bodyFontSize: "10px",
    extraStyles: `
  body {
    font-family: Verdana, Geneva, sans-serif;
    font-size: 10px;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt {
    display: flex;
    flex-direction: column;
  }
  .receipt-shell {
    width: 100%;
    ${shellMinHeight}
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  .receipt-main {
    width: 100%;
    flex: 0 0 auto;
  }
  .receipt-footer {
    ${footerMargin}
    border-top: 1px solid ${border};
    padding-top: 6px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .copy-tag {
    text-align: right;
    font-size: 9px;
    font-weight: bold;
    color: ${ink};
    margin-bottom: 2px;
  }
  .reprint-banner {
    border: 1px solid ${border};
    background: ${isBW ? "#eee" : "#fff3cd"};
    color: ${isBW ? "#000" : "#856404"};
    font-size: 9px;
    font-weight: bold;
    text-align: center;
    padding: 3px 6px;
    margin-bottom: 4px;
  }
  .provisional-banner {
    background: ${isBW ? "#eee" : "#fef3c7"};
    color: ${isBW ? "#000" : "#92400e"};
    border: 2px solid ${isBW ? "#000" : "#f59e0b"};
    padding: 4px 8px;
    font-size: 9px;
    font-weight: bold;
    text-align: center;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .hdr-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
  }
  .logo-cell {
    width: 72px;
    vertical-align: middle;
    padding-right: 8px;
  }
  .logo-img {
    object-fit: contain;
    display: block;
  }
  .logo-fallback {
    width: 56px;
    height: 56px;
    border: 1px solid ${border};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: bold;
    color: ${ink};
  }
  .hdr-text {
    text-align: center;
    vertical-align: middle;
  }
  .clinic-name {
    font-size: ${isA4Paper ? "20px" : "16px"};
    font-weight: bold;
    color: ${ink};
    line-height: 1.2;
  }
  .clinic-line {
    font-size: 9px;
    line-height: 1.25;
    margin-top: 1px;
  }
  .title-bar {
    border: 1px solid ${border};
    text-align: center;
    font-weight: bold;
    font-size: 12px;
    padding: 3px 0;
    margin: 4px 0 6px;
    color: ${ink};
    letter-spacing: 0.5px;
  }
  .meta-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
    font-size: 10px;
  }
  .meta-table td {
    padding: 2px 4px;
    vertical-align: top;
    border: none;
  }
  .meta-label {
    font-weight: bold;
    color: ${ink};
    white-space: nowrap;
    width: 18%;
  }
  .meta-val {
    width: 32%;
  }
  .queue-token {
    text-align: center;
    border: 2px dashed ${border};
    padding: 4px 8px;
    margin-bottom: 6px;
  }
  .queue-label {
    font-size: 9px;
    font-weight: bold;
    color: ${ink};
  }
  .queue-num {
    font-size: 22px;
    font-weight: 900;
    color: ${ink};
    line-height: 1.1;
  }
  .test-tokens {
    font-size: 9px;
    margin-bottom: 6px;
  }
  .svc-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    font-size: 10px;
  }
  .svc-table th,
  .svc-table td {
    border: 1px solid ${border};
    padding: 3px 5px;
  }
  .svc-table th {
    background: ${isBW ? "#eee" : "#f8f0f0"};
    color: ${ink};
    font-weight: bold;
    text-align: left;
  }
  .svc-name { width: 78%; }
  .svc-amt { width: 22%; text-align: right !important; }
  .amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .cat-row td {
    background: ${isBW ? "#f5f5f5" : "#faf5f5"};
    font-size: 9px;
  }
  .cancel-note {
    font-size: 8px;
    color: ${isBW ? "#333" : "#b91c1c"};
    margin: 2px 0 4px;
  }
  .pay-summary {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  .pay-left {
    width: 48%;
    vertical-align: top;
    padding-right: 8px;
    font-size: 10px;
  }
  .pay-right {
    width: 52%;
    vertical-align: top;
  }
  .totals-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  .totals-table td {
    padding: 2px 4px;
    border: none;
  }
  .tot-label {
    font-weight: bold;
    color: ${ink};
    text-align: right;
    width: 60%;
  }
  .tot-val {
    text-align: right;
    font-weight: bold;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .net-row .tot-label,
  .net-row .tot-val {
    font-size: 11px;
    border-top: 1px solid ${border};
    padding-top: 4px;
  }
  .qr-wrap {
    margin-top: 6px;
  }
  .qr-wrap img {
    width: 70px;
    height: 70px;
    display: block;
  }
  .qr-caption {
    font-size: 8px;
    color: #64748b;
    margin-top: 2px;
  }
  .qr-warn {
    font-size: 8px;
    color: ${isBW ? "#000" : "#b45309"};
    margin-top: 2px;
  }
  .audit-token {
    font-size: 7px;
    color: #94a3b8;
    font-family: ui-monospace, Menlo, monospace;
    margin-top: 3px;
    line-height: 1.2;
    word-break: break-all;
    max-width: 120px;
  }
  .footer-note {
    font-size: 9px;
    text-align: center;
    margin-bottom: 8px;
  }
  .sign-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 10px;
  }
  .sign-left {
    text-align: left;
    vertical-align: bottom;
    width: 50%;
  }
  .sign-right {
    text-align: right;
    vertical-align: bottom;
    width: 50%;
    font-weight: bold;
    color: ${ink};
  }
  .sign-line {
    border-bottom: 1px solid #94a3b8;
    width: 130px;
    height: 28px;
    margin: 0 0 2px auto;
  }
  .sign-img {
    max-height: 32px;
    max-width: 130px;
    object-fit: contain;
    display: block;
    margin: 0 0 2px auto;
  }
  .financial-block, .totals-grid, .receipt-footer, .hope-bill, .pay-summary, .sign-table {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  @media print {
    .financial-block, .totals-grid, .receipt-footer, .hope-bill, .pay-summary, .sign-table {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
  }`,
    pages: pages.map((html) => ({
      html,
      className: "receipt",
    })),
  });
}

// ── Unified bill print renderer ───────────────────────────────────────────
// Single optimized template for all bill printing — HOPE A5 portrait
// geometry with CARE financial / QR / audit fields unchanged.
export function buildBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  return buildClassicBillPrintHtml(opts);
}
