// Bill receipt printing — A5 thermal receipt optimised for Indian diagnostic centres.
// Matches the physical receipt layout from the reference image.

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

/**
 * Lightweight on-page audit token: BILL_NO-TIMESTAMP-TOTAL-OPERATOR_ID.
 * Deterministic FNV-1a hex of that payload — tamper-evident for manual audit
 * without needing a crypto library in the print path.
 */
export function buildBillAuditToken(opts: {
  billNumber: string;
  createdAt?: string | Date | null;
  totalAmount: number | string;
  operatorId?: string | number | null;
}): string {
  const billNo = String(opts.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ts = (() => {
    const d = opts.createdAt ? new Date(opts.createdAt) : new Date();
    if (isNaN(d.getTime())) return "0";
    return String(Math.floor(d.getTime() / 1000));
  })();
  const total = Number(opts.totalAmount || 0).toFixed(2);
  const op = String(opts.operatorId ?? "0");
  const payload = `${billNo}-${ts}-${total}-${op}`;
  // FNV-1a 32-bit → 8-char hex
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hash = (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
  return `${payload}-${hash}`;
}

import { buildDocumentHtml } from "./documentLayout/buildDocumentHtml";
import { resolveBillPrintPaperFromOpts } from "./documentLayout/billPaper";
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
  // of being pushed to the physical bottom of the A5 page via a flex-1
  // spacer. Billing Desk / Bill Detail pass this for short bills (≤4 tests)
  // and kiosk/booking always opt in — avoids a huge blank middle on A5.
  // Defaults to false; classic also auto-compacts when ≤4 active test lines.
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
  /** Header layout: "right" (default) = address/phone/website under Bill No. on the
   * right side, bigger logo on the left; "left" = address under the clinic name. */
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
  const { bill, clinic, paperSize, orientation = "portrait", isBW, qrDataUrl, reprintBy, reprintReason, compactFooterGap = false, compactOnA4 = false, pageCssSize, provisionalReceipt = false } = opts;
  const copies = Math.max(1, Math.min(2, Number(clinic?.billPrintCopies ?? 1) || 1));
  const showCode = clinic?.billShowCode !== false;
  const showCategory = clinic?.billShowCategory !== false;
  const qrEnabled = (opts.showQr !== false) && clinic?.qrOnBillEnabled !== false;
  const showTat = (opts.showTat ?? clinic?.showTatOnBill) === true;
  const isA5 = paperSize === "A5";
  const a4Page = compactOnA4 && isA5;

  const tests = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") === "cancelled");
  const sparseBill = tests.length <= 4;
  const billDigits = String(bill.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ageStr = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const ageGender = [ageStr, bill.patient?.gender].filter(Boolean).join(" / ").toUpperCase();
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

  const statusColor = (semantic: string): string => (isBW ? "#000" : semantic);
  const statusBg = (semantic: string): string => (isBW ? "#eee" : semantic);

  const useCompactFooter = compactFooterGap || sparseBill;
  const marginMm = opts.printMarginMm ?? (isA5 ? 10 : 6);
  const titleSize = `${opts.printTitleFontPx ?? (isA5 ? 19 : 20)}px`;
  const patientNameSize = `${opts.printPatientNameFontPx ?? (isA5 ? 14 : 18)}px`;
  const bodyPx = `${opts.printBodyFontPx ?? (isA5 ? 16 : 15)}px`;
  const headerPx = `${opts.printHeaderFontPx ?? (isA5 ? 13 : 12)}px`;
  const tablePx = `${opts.printTableFontPx ?? 12}px`;
  const totalPx = `${opts.printTotalFontPx ?? 13}px`;
  const footerPx = `${opts.printFooterFontPx ?? 11}px`;
  const tinyPx = `${opts.printTinyFontPx ?? 10}px`;
  const addressRight = (opts.headerLayout ?? "right") === "right";
  const logoH = resolveBillLogoHeightPx(opts.printLogoHeightPx, addressRight ? 140 : 120);
  const logoMaxW = Math.round(logoH * 2.0);
  const logoImgHtml = clinic?.logoDataUrl
    ? `<img src="${clinic.logoDataUrl}" alt="logo" style="max-height:${logoH}px;max-width:${logoMaxW}px;object-fit:contain;display:block;margin-bottom:4px"/>`
    : "";

  const colCount = 3 + (showCode ? 1 : 0) + (showCategory ? 1 : 0) + (showTat ? 1 : 0);

  const testRows = tests.map((t, i) => {
    const code = t.test?.code ?? "";
    const name = t.displayName ?? t.test?.name ?? "";
    const cat = t.test?.category ?? "";
    const tat = (t.test?.duration ?? "").trim();
    const codeFontSize = `${Math.round(parseInt(tablePx, 10) * 0.9)}px`;
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #000;text-align:center;font-size:${tablePx};font-variant-numeric:tabular-nums">${i + 1}</td>
      ${showCode ? `<td style="padding:5px 8px;border:1px solid #000;font-family:ui-monospace,Menlo,monospace;font-size:${codeFontSize}">${esc(code)}</td>` : ""}
      <td style="padding:5px 8px;border:1px solid #000;font-size:${tablePx};font-weight:600;color:#0f172a">${esc(name)}</td>
      ${showCategory ? `<td style="padding:5px 8px;border:1px solid #000;font-size:${tablePx};color:#64748b">${esc(cat)}</td>` : ""}
      ${showTat ? `<td style="padding:5px 8px;border:1px solid #000;font-size:${tablePx};color:#64748b;white-space:nowrap">${esc(tat || "—")}</td>` : ""}
      <td style="padding:5px 8px;border:1px solid #000;text-align:right;font-size:${tablePx};font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums">₹${fmt(t.price)}</td>
    </tr>`;
  }).join("");

  const cancelledRow = cancelled.length === 0 ? "" : `
    <div style="margin-top:4px;font-size:${tinyPx};color:#888">
      <em>Cancelled: ${esc(cancelled.map((t) => t.displayName ?? t.test?.name ?? "").join(", "))}</em>
    </div>`;

  const payRows = (bill.payments ?? []).map((p) => {
    const ref = p.referenceNumber ? ` (${esc(p.referenceNumber)})` : "";
    return `<tr>
      <td style="padding:3px 6px 3px 0;font-size:${tinyPx};text-transform:capitalize;color:#64748b">${esc(p.method)}${ref ? `<span style="color:#94a3b8;font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px">${ref}</span>` : ""}</td>
      <td style="padding:3px 0;text-align:right;font-weight:700;font-size:${tinyPx};font-variant-numeric:tabular-nums;color:#0f172a">₹${fmt(p.amount)}</td>
    </tr>`;
  }).join("");

  const hasPayDetail = (bill.payments ?? []).length > 0;

  const session = (() => {
    try {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem("erp_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const billedByName: string = session?.user?.name ?? "";
  const billedBySignatureUrl: string = session?.user?.signatureDataUrl ?? "";
  const operatorId: string | number = session?.user?.id ?? "0";

  const auditToken = buildBillAuditToken({
    billNumber: bill.billNumber,
    createdAt: bill.createdAt,
    totalAmount: bill.totalAmount,
    operatorId,
  });

  const balAmt = Number(bill.balanceAmount || 0);
  const balDueBg = statusBg(isUnconfirmedQr ? "#fef3c7" : balAmt > 0 ? "#fef2f2" : "#f0fdf4");
  const balDueColor = statusColor(isUnconfirmedQr ? "#b45309" : balAmt > 0 ? "#b91c1c" : "#15803d");

  const contactRow = (content: string) =>
    content ? `<div style="font-size:${headerPx};line-height:1.45;margin-top:2px">${content}</div>` : "";
  const contactLine = (label: string, value: string) =>
    `${metaLabel(label, headerPx)} ${metaValue(value, headerPx, 600)}`;

  const addressLinesHtml = (align: "left" | "right") => {
    if (!clinic?.address) return "";
    return clinic.address
      .split(/\s*\n\s*/)
      .filter(Boolean)
      .map((line) => `<div style="font-size:${headerPx};font-weight:600;color:#0f172a;line-height:1.45;margin-top:2px;text-align:${align}">${esc(line.trim())}</div>`)
      .join("");
  };

  const contactBlockHtml = (align: "left" | "right") => {
    const rows: string[] = [];
    if (clinic?.phone) rows.push(contactRow(contactLine("PH:", clinic.phone)));
    if (clinic?.email) rows.push(contactRow(contactLine("EMAIL:", clinic.email)));
    if (clinic?.website) rows.push(contactRow(contactLine("WEB:", clinic.website)));
    if (clinic?.gstin) rows.push(contactRow(contactLine("GSTIN:", clinic.gstin)));
    if (rows.length === 0) return "";
    return `<div style="text-align:${align}">${rows.join("")}</div>`;
  };

  const finRow = (
    label: string,
    value: string,
    rowOpts: { bold?: boolean; borderTop?: string; bg?: string; color?: string } = {},
  ) => `
    <tr>
      <td style="padding:5px 8px;${rowOpts.borderTop ? `border-top:${rowOpts.borderTop};` : ""}${rowOpts.bg ? `background:${rowOpts.bg};` : ""}${rowOpts.bold ? "font-weight:800;" : "font-weight:500;"}color:${rowOpts.color ?? "#334155"};text-transform:uppercase;letter-spacing:0.03em;font-size:${totalPx}">${esc(label)}</td>
      <td style="padding:5px 8px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;${rowOpts.borderTop ? `border-top:${rowOpts.borderTop};` : ""}${rowOpts.bg ? `background:${rowOpts.bg};` : ""}${rowOpts.bold ? "font-weight:800;" : "font-weight:700;"};color:${rowOpts.color ?? "#0f172a"};font-size:${totalPx}">${value}</td>
    </tr>`;

  const page = (_copyIdx: number) => `
      <table style="width:100%;border-collapse:collapse;margin-bottom:5px">
        <tr>
          <td style="vertical-align:top;padding:0;width:${addressRight ? "50%" : "62%"}">
            ${logoImgHtml}
            ${clinic?.name ? `<div style="font-size:${titleSize};font-weight:800;line-height:1.15;color:#0f172a;margin-bottom:2px">${esc(clinic.name)}</div>` : ""}
            <div style="font-size:${bodyPx};color:#334155;font-weight:700;line-height:1.2">${esc(clinic?.tagline || "DIAGNOSTIC & PATHOLOGY SERVICES")}</div>
            ${!addressRight ? addressLinesHtml("left") : ""}
            ${!addressRight ? contactBlockHtml("left") : ""}
          </td>
          <td style="vertical-align:top;text-align:right;padding:0;width:${addressRight ? "50%" : "38%"}">
            <div style="font-size:${titleSize};font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#0f172a">${isCancelled ? "CANCELLED" : isUnconfirmedQr ? "AWAITING PAYMENT" : "INVOICE"}</div>
            <div style="margin-top:6px;white-space:nowrap">
              ${metaLabel("BILL NO:", headerPx)} ${metaValue(billDigits, titleSize, 800)}
            </div>
            ${addressRight ? addressLinesHtml("right") : ""}
            ${addressRight ? contactBlockHtml("right") : ""}
          </td>
        </tr>
      </table>

      <div style="border-top:2px solid #000;border-bottom:2px solid #000;padding:2px 0;margin-bottom:5px"></div>

      ${provisionalReceipt ? `<div style="display:block;background:#fef3c7;color:#92400e;border:2px solid #f59e0b;border-radius:4px;padding:4px 8px;font-size:${tinyPx};font-weight:800;letter-spacing:0.03em;margin-bottom:8px;text-align:center;text-transform:uppercase">Provisional Receipt — Server Offline · Will Sync Automatically · QR Valid After Sync</div>` : ""}
      ${reprintBy || reprintReason ? `<div style="display:inline-block;background:#f3f4f6;color:#4b5563;border:1px solid #d1d5db;border-radius:3px;padding:2px 8px;font-size:${tinyPx};font-weight:600;letter-spacing:0.02em;margin-bottom:8px">REPRINT${reprintBy ? ` &nbsp;&middot;&nbsp; ${esc(reprintBy)}` : ""}${reprintReason ? ` &nbsp;&middot;&nbsp; ${esc(reprintReason)}` : ""} &nbsp;&middot;&nbsp; ${esc(new Date().toLocaleDateString("en-IN"))}</div>` : ""}

      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;table-layout:fixed">
        <colgroup><col style="width:62%"/><col style="width:38%"/></colgroup>
        <tr>
          <td style="vertical-align:top;padding:0;padding-right:8px;overflow-wrap:anywhere;word-break:break-word">
            <div style="font-size:${patientNameSize};font-weight:800;line-height:1.25;color:#0f172a">${esc(`${bill.patient?.firstName ?? ""} ${bill.patient?.lastName ?? ""}`.trim().toUpperCase())}${ageGender ? ` <span style="font-weight:600;color:#475569">${esc(ageGender)}</span>` : ""}</div>
            <div style="font-size:${patientNameSize};margin-top:3px;line-height:1.3">
              ${metaLabel("REF:", patientNameSize)} ${metaValue(rawDoctor ? (rawDoctor.match(/^\s*DR\.?\s*/i) ? rawDoctor.trim().toUpperCase() : "DR. " + rawDoctor.trim().toUpperCase()) : "SELF / WALK-IN", patientNameSize, 700)}
            </div>
          </td>
          <td style="vertical-align:top;text-align:right;padding:0;font-size:${patientNameSize};line-height:1.35;white-space:nowrap">
            <div style="font-weight:800;color:#0f172a">${created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} &nbsp;${created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase()}</div>
            <div style="margin-top:2px">${metaLabel("PH", tinyPx)} ${metaValue(bill.patient?.phone ?? "", tinyPx, 600)} · ${metaLabel("ID", tinyPx)} ${metaValue(bill.patient?.patientId ?? "", tinyPx, 600)}</div>
          </td>
        </tr>
      </table>

      <div style="border-bottom:1px solid #000;margin-bottom:6px"></div>

      ${opts.showQueueToken && bill.tokenNo ? `
      <div style="text-align:center;background:#eff6ff;border:2px dashed #0c4a6e;border-radius:6px;padding:4px 8px;margin-bottom:6px;page-break-inside:avoid">
        <div style="font-size:${tinyPx};font-weight:800;color:#0c4a6e;letter-spacing:0.5px">QUEUE TOKEN</div>
        <div style="font-size:${parseInt(titleSize, 10) + 10}px;font-weight:900;color:#0c4a6e;line-height:1.1">#${esc(String(bill.tokenNo))}</div>
      </div>` : ""}
      ${opts.showQueueToken && bill.testTokens && bill.testTokens.length > 0 ? (() => {
        const seen = new Set<string>();
        const deduped = bill.testTokens.filter((tt) => {
          const key = `${tt.department}::${tt.roomNumber}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return `
      <div style="font-size:${tinyPx};margin-bottom:6px">
        ${deduped.map((tt) => `<div><strong>${esc(tt.department)}</strong>: Token #${esc(String(tt.tokenNo))}${tt.roomNumber ? ` &middot; Room ${esc(tt.roomNumber)}` : ""}</div>`).join("")}
      </div>`;
      })() : ""}

      <table class="test-table" style="width:100%;border-collapse:collapse;font-size:${tablePx};margin-bottom:5px">
        <thead>
          <tr>
            <th style="padding:5px 8px;border:1px solid #000;background:#f0f0f0;text-align:center;font-weight:800;letter-spacing:0.03em">#</th>
            ${showCode ? `<th style="padding:5px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800;letter-spacing:0.03em">CODE</th>` : ""}
            <th style="padding:5px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800;letter-spacing:0.03em">TEST NAME</th>
            ${showCategory ? `<th style="padding:5px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800;letter-spacing:0.03em">CATEGORY</th>` : ""}
            ${showTat ? `<th style="padding:5px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800;letter-spacing:0.03em">TAT</th>` : ""}
            <th style="padding:5px 8px;border:1px solid #000;background:#f0f0f0;text-align:right;font-weight:800;letter-spacing:0.03em">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${testRows || `<tr><td colspan="${colCount}" style="padding:8px;text-align:center;color:#888;border:1px solid #000">No tests on this bill</td></tr>`}
        </tbody>
      </table>
      ${cancelledRow}

      <table class="financial-block" style="width:100%;border-collapse:separate;border-spacing:0;margin-top:5px;table-layout:fixed;page-break-inside:avoid;break-inside:avoid">
        <colgroup>
          <col style="width:${qrEnabled && qrDataUrl ? "18%" : "0"}"/>
          <col style="width:${qrEnabled && qrDataUrl ? "42%" : "58%"}"/>
          <col style="width:40%"/>
        </colgroup>
        <tbody>
          <tr>
            <td style="vertical-align:bottom;padding:0">
              ${qrEnabled && qrDataUrl ? `
              <img src="${qrDataUrl}" alt="QR" style="width:70px;height:70px;display:block"/>
              <div style="font-size:${tinyPx};color:#64748b;margin-top:2px;font-weight:500">Scan to verify</div>
              <div style="font-size:7px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;margin-top:3px;line-height:1.2;word-break:break-all;max-width:90px" title="Audit token">${esc(auditToken)}</div>` : ""}
            </td>
            <td style="vertical-align:top;padding:0 8px 0 0;font-size:${tinyPx}">
              ${hasPayDetail ? `<div style="font-weight:700;color:#64748b;border-bottom:1px solid #cbd5e1;padding-bottom:2px;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.4px;font-size:${Math.round(parseInt(tinyPx, 10) * 1.15)}px">PAYMENT DETAILS</div>
                <table style="width:100%;border-collapse:collapse"><tbody>${payRows}</tbody></table>` : ""}
              ${!(qrEnabled && qrDataUrl) ? `<div style="font-size:7px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;margin-top:6px;line-height:1.2;word-break:break-all" title="Audit token">${esc(auditToken)}</div>` : ""}
            </td>
            <td style="vertical-align:top;padding:0">
              <table class="totals-grid" style="width:100%;border-collapse:collapse;font-size:${totalPx};table-layout:fixed">
                <colgroup><col style="width:55%"/><col style="width:45%"/></colgroup>
                <tbody>
                  ${finRow("Subtotal", `₹${fmt(bill.subtotal)}`)}
                  ${Number(bill.discount) > 0 ? finRow("Discount", `₹${fmt(bill.discount)}`) : ""}
                  ${finRow("Total", `₹${fmt(bill.totalAmount)}`, { bold: true, borderTop: "2px solid #000" })}
                  ${finRow("Paid", isUnconfirmedQr ? `${fmt(bill.totalAmount)} (Pending)` : `₹${fmt(bill.paidAmount)}`, { bold: true, borderTop: "1px solid #cbd5e1", color: statusColor(isUnconfirmedQr ? "#b45309" : "#15803d") })}
                  ${finRow("Balance Due", isUnconfirmedQr ? "To Be Confirmed" : `₹${fmt(balAmt)}`, { bold: true, borderTop: "2px solid #000", bg: balDueBg, color: balDueColor })}
                  ${cashAmt > 0 ? finRow("Cash", `₹${fmt(cashAmt)}`) : ""}
                  ${upiAmt > 0 ? finRow("UPI", `₹${fmt(upiAmt)}`) : ""}
                  ${cardAmt > 0 ? finRow("Card", `₹${fmt(cardAmt)}`) : ""}
                  ${insAmt > 0 ? finRow("Insurance", `₹${fmt(insAmt)}`) : ""}
                  ${chqAmt > 0 ? finRow("Cheque", `₹${fmt(chqAmt)}`) : ""}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      ${useCompactFooter ? `<div style="height:${Math.round(parseInt(footerPx, 10) * 1.4 * 2)}px"></div>` : `<div style="height:4px"></div>`}

      <div class="receipt-footer" style="margin-top:4px;border-top:2px solid #000;padding-top:6px;text-align:center;page-break-inside:avoid;break-inside:avoid">
        <div style="font-size:${footerPx};font-weight:700;color:#0f172a;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.02em;line-height:1.3">${esc(clinic?.footerNote || bill.reportCollectionNote || "Thank you for choosing our diagnostic services. Please collect your report within 7 days.")}</div>
        <div style="font-size:${tinyPx};color:#64748b;margin-bottom:6px;font-weight:500;letter-spacing:0.02em">THIS IS A COMPUTER-GENERATED INVOICE. NO SIGNATURE REQUIRED.</div>

        <table style="width:100%;border-collapse:collapse;page-break-inside:avoid;break-inside:avoid">
          <tr>
            <td style="text-align:left;padding:0;vertical-align:bottom;width:50%">
              ${billedBySignatureUrl
                ? `<img src="${billedBySignatureUrl}" alt="Signature" style="max-height:32px;max-width:130px;object-fit:contain;display:block;margin-bottom:2px"/>`
                : `<div style="border-bottom:1px solid #94a3b8;width:130px;margin-bottom:2px;height:28px"></div>`}
              <div style="font-size:${tinyPx};color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:0.03em">Authorised Signature</div>
            </td>
            <td style="text-align:right;padding:0;vertical-align:bottom;width:50%;font-size:${tinyPx}">
              ${billedByName ? `<div>${metaLabel("Billed by:", tinyPx)} ${metaValue(billedByName, tinyPx, 600)}</div>` : ""}
            </td>
          </tr>
        </table>
      </div>`;

  const pages = Array.from({ length: copies }).map((_, i) => page(i));

  const paper = resolveBillPrintPaperFromOpts({
    paperSize,
    orientation,
    pageCssSize,
    compactOnA4: a4Page,
  });

  return buildDocumentHtml({
    title: `Bill ${esc(bill.billNumber)}`,
    paper,
    safePaddingMm: marginMm,
    compactSlipOnA4: a4Page,
    bodyFontSize: bodyPx,
    extraStyles: `
  table { width: 100%; }
  .test-table tbody tr:nth-child(even) td { background: #f8fafc; }
  .financial-block, .totals-grid, .receipt-footer {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .totals-grid td:last-child {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  @media print {
    .financial-block, .totals-grid, .receipt-footer {
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
// Single optimized template for all bill printing — the Classic layout,
// tuned for A5 landscape on Epson L130 and similar ink tank printers.
export function buildBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  return buildClassicBillPrintHtml(opts);
}
