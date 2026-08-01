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

import { type BillFormat, type BillPaperSize } from "./billPrintSettings";
import { buildPremiumBillPrintHtml } from "./premiumBillPrint";
import { buildDesignerBillPrintHtml } from "./designerBillPrint";
import { buildModernLandscapeBillPrintHtml } from "./modernLandscapeBillPrint";

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
  // Layout & typography overrides (Classic format only) — see
  // BillPrintSettings's matching print*Px/printMarginMm fields. Each is
  // undefined/null-safe: omit or pass null to fall back to the built-in
  // A5/A4-tuned default for that element.
  printMarginMm?: number | null;
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
  const { bill, clinic, paperSize, orientation = "portrait", isBW, qrDataUrl, reprintBy, reprintReason, compactFooterGap = false, compactOnA4 = false, pageCssSize } = opts;
  const copies = Math.max(1, Math.min(2, Number(clinic?.billPrintCopies ?? 1) || 1));
  const showCode = clinic?.billShowCode !== false;
  const showCategory = clinic?.billShowCategory !== false;
  const qrEnabled = clinic?.qrOnBillEnabled !== false;
  const isA5 = paperSize === "A5";
  // Compact A5 slip printed on a physical A4 sheet (patient copies). Content
  // sizing stays A5; only the physical page and the slip's max width change.
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
  // Separate helper for BACKGROUND fills using the same semantic colors —
  // must NEVER resolve to the same "#000" as statusColor's text color, or
  // B&W mode would render black text on a black background (invisible).
  // Falls back to a neutral light gray callout instead.
  const statusBg = (semantic: string): string => (isBW ? "#eee" : semantic);

  // ── Sizing tuned for A5 thermal receipt, admin-overridable per-field via
  // Settings → Billing Print → Layout & Typography (BillPrintSettings'
  // print*Px/printMarginMm). null/undefined = built-in tuned default, which
  // still varies by A5 vs A4 paper size; a non-null override applies fixed
  // regardless of paper size. ──
  const useCompactFooter = compactFooterGap || sparseBill;
  const marginMm = opts.printMarginMm ?? (isA5 ? 8 : 8);
  const pageMargin = `${marginMm}mm`;
  // Content-area height = page height minus top+bottom margin. Must track
  // `orientation` AND the actual configured margin — since A5 landscape's
  // page height (148mm) is far shorter than portrait's (210mm), and a
  // larger admin-configured margin shrinks the usable area further. Using a
  // stale/mismatched min-height here overflows the printable area and
  // forces the browser into "shrink to fit" (blurs the receipt) or spills
  // content onto a silent extra page — see the max-height-free single-
  // source-of-truth note below on why this is inline-only, never duplicated
  // in the <style> block.
  const receiptMinHeight = `${(isA5 ? (orientation === "landscape" ? 148 : 210) : 297) - marginMm * 2}mm`;
  // Title ("INVOICE/RECEIPT") is the page's real anchor and must read as the
  // largest header element; clinic contact info (headerPx) is secondary and
  // was previously LARGER than the title, inverting the hierarchy.
  const titleSize = `${opts.printTitleFontPx ?? (isA5 ? 19 : 20)}px`;
  const patientNameSize = `${opts.printPatientNameFontPx ?? (isA5 ? 14 : 18)}px`;    // compact patient / ref / date block
  const bodyPx = `${opts.printBodyFontPx ?? (isA5 ? 16 : 15)}px`;                     // tagline under logo
  const headerPx = `${opts.printHeaderFontPx ?? (isA5 ? 13 : 12)}px`;                 // clinic address / phone / email (caption weight)
  const tablePx = `${opts.printTableFontPx ?? 12}px`;
  const totalPx = `${opts.printTotalFontPx ?? 13}px`;
  const footerPx = `${opts.printFooterFontPx ?? 11}px`;
  const tinyPx = `${opts.printTinyFontPx ?? 10}px`;

  const colCount = 3 + (showCode ? 1 : 0) + (showCategory ? 1 : 0);

  // ── Test rows ──
  const testRows = tests.map((t, i) => {
    const code = t.test?.code ?? "";
    const name = t.displayName ?? t.test?.name ?? "";
    const cat = t.test?.category ?? "";
    const codeFontSize = `${Math.round(parseInt(tablePx, 10) * 0.9)}px`;
    return `<tr>
      <td style="padding:6px 8px;border:1px solid #000;font-size:${tablePx};text-align:center">${i + 1}</td>
      ${showCode ? `<td style="padding:6px 8px;border:1px solid #000;font-family:monospace;font-size:${codeFontSize}">${esc(code)}</td>` : ""}
      <td style="padding:6px 8px;border:1px solid #000;font-size:${tablePx}">${esc(name)}</td>
      ${showCategory ? `<td style="padding:6px 8px;border:1px solid #000;font-size:${tablePx};color:#555">${esc(cat)}</td>` : ""}
      <td style="padding:6px 8px;border:1px solid #000;text-align:right;font-weight:700;font-size:${tablePx}">₹${fmt(t.price)}</td>
    </tr>`;
  }).join("");

  const cancelledRow = cancelled.length === 0 ? "" : `
    <div style="margin-top:4px;font-size:${tinyPx};color:#888">
      <em>Cancelled: ${esc(cancelled.map((t) => t.displayName ?? t.test?.name ?? "").join(", "))}</em>
    </div>`;

  // ── Payment detail rows ──
  const payRows = (bill.payments ?? []).map((p) => {
    const ref = p.referenceNumber ? ` (${esc(p.referenceNumber)})` : "";
    return `<tr>
      <td style="padding:3px 6px 3px 0;font-size:${tinyPx};text-transform:capitalize">${esc(p.method)}${ref ? `<span style="color:#888;font-size:${Math.round(parseInt(tinyPx, 10) * 0.85)}px">${ref}</span>` : ""}</td>
      <td style="padding:3px 0;text-align:right;font-weight:600;font-size:${tinyPx}">₹${fmt(p.amount)}</td>
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
    <section class="receipt" style="${copyIdx > 0 ? "page-break-before:always;" : ""}${isA5 && !useCompactFooter ? `display:flex;flex-direction:column;min-height:${receiptMinHeight};` : ""}">

      <!-- HEADER: logo + tagline left, clinic info right, vertically centered
           against each other so the shorter block doesn't visually float. -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        <tr>
          <td style="vertical-align:middle;padding:0;width:45%">
            ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" alt="logo" style="max-height:100px;max-width:210px;object-fit:contain;display:block;margin-bottom:3px"/>` : ""}
            <div style="font-size:${bodyPx};color:#333;font-weight:700;line-height:1.2">${esc(clinic?.tagline || "DIAGNOSTIC & PATHOLOGY SERVICES")}</div>
          </td>
          <td style="vertical-align:middle;text-align:right;padding:0;font-size:${headerPx};line-height:1.45;color:#555;font-weight:600">
            ${clinic?.address ? `<div>${esc(clinic.address.replace(/\s*\n\s*/g, ", ").trim())}</div>` : ""}
            <div>PH: ${esc(clinic?.phone ?? "")}</div>
            <div>EMAIL: ${esc(clinic?.email ?? "")}</div>
            ${clinic?.website ? `<div>${esc(clinic.website)}</div>` : ""}
            ${clinic?.gstin ? `<div style="margin-top:1px;font-weight:800">GSTIN: ${esc(clinic.gstin)}</div>` : ""}
          </td>
        </tr>
      </table>

      <!-- TITLE LINE with bill number on the right -->
      <div style="border-top:2px solid #000;border-bottom:2px solid #000;padding:4px 0;margin-bottom:8px">
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

      <!-- Reprint marker — a flat, muted badge (not a rotated/dashed
           "stamp") stating who reprinted this copy and why, placed under
           the bill number rather than crowding the logo/header. -->
      ${reprintBy || reprintReason ? `<div style="display:inline-block;background:#f3f4f6;color:#4b5563;border:1px solid #d1d5db;border-radius:3px;padding:2px 8px;font-size:${tinyPx};font-weight:600;letter-spacing:0.02em;margin-bottom:8px">REPRINT${reprintBy ? ` &nbsp;&middot;&nbsp; ${esc(reprintBy)}` : ""}${reprintReason ? ` &nbsp;&middot;&nbsp; ${esc(reprintReason)}` : ""} &nbsp;&middot;&nbsp; ${esc(new Date().toLocaleDateString("en-IN"))}</div>` : ""}

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

      <!-- QUEUE TOKEN(S) — shown when this bill produced a daily queue token
           (self-registration via kiosk / online booking, or a walk-in bill
           routed through a department queue). Gated on showQueueToken so
           billing-counter receipts don't show a redundant big token box on
           top of the per-test department token list below. -->
      ${opts.showQueueToken && bill.tokenNo ? `
      <div style="text-align:center;background:#eff6ff;border:2px dashed #0c4a6e;border-radius:6px;padding:4px 8px;margin-bottom:6px">
        <div style="font-size:${tinyPx};font-weight:800;color:#0c4a6e;letter-spacing:0.5px">QUEUE TOKEN</div>
        <div style="font-size:${parseInt(titleSize, 10) + 10}px;font-weight:900;color:#0c4a6e;line-height:1.1">#${esc(String(bill.tokenNo))}</div>
      </div>` : ""}
      ${bill.testTokens && bill.testTokens.length > 0 ? `
      <div style="font-size:${tinyPx};margin-bottom:6px">
        ${bill.testTokens.map((tt) => `<div><strong>${esc(tt.department)}</strong>: Token #${esc(String(tt.tokenNo))}${tt.roomNumber ? ` &middot; Room ${esc(tt.roomNumber)}` : ""}</div>`).join("")}
      </div>` : ""}

      <!-- TEST TABLE with borders -->
      <table class="test-table" style="width:100%;border-collapse:collapse;font-size:${tablePx};margin-bottom:8px">
        <thead>
          <tr>
            <th style="padding:6px 8px;border:1px solid #000;background:#f0f0f0;text-align:center;font-weight:800">#</th>
            ${showCode ? `<th style="padding:6px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800">CODE</th>` : ""}
            <th style="padding:6px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800">TEST NAME</th>
            ${showCategory ? `<th style="padding:6px 8px;border:1px solid #000;background:#f0f0f0;text-align:left;font-weight:800">CATEGORY</th>` : ""}
            <th style="padding:6px 8px;border:1px solid #000;background:#f0f0f0;text-align:right;font-weight:800">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${testRows || `<tr><td colspan="${colCount}" style="padding:8px;text-align:center;color:#888;border:1px solid #000">No tests on this bill</td></tr>`}
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
              ${qrEnabled && qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" style="width:70px;height:70px;display:block"/><div style="font-size:${tinyPx};color:#555;margin-top:1px">Scan to verify</div>` : ""}
            </td>
            <!-- Payment details (middle, if present) -->
            <td style="vertical-align:top;padding:0 8px 0 0;font-size:${tinyPx}">
              ${hasPayDetail ? `<div style="font-weight:800;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.3px;font-size:${Math.round(parseInt(tinyPx, 10) * 1.3)}px">PAYMENT DETAILS</div>
                <table style="width:100%;border-collapse:collapse"><tbody>${payRows}</tbody></table>` : ""}
            </td>
            <!-- Totals -->
            <td style="vertical-align:top;padding:0">
              <table style="width:100%;border-collapse:collapse;font-size:${totalPx};table-layout:fixed">
                <colgroup><col style="width:58%"/><col style="width:42%"/></colgroup>
                <tbody>
                  <tr><td style="padding:4px 6px">SUBTOTAL</td><td style="padding:4px 6px;text-align:right;white-space:nowrap">₹${fmt(bill.subtotal)}</td></tr>
                  ${Number(bill.discount) > 0 ? `<tr><td style="padding:4px 6px">DISCOUNT</td><td style="padding:4px 6px;text-align:right;white-space:nowrap">₹${fmt(bill.discount)}</td></tr>` : ""}
                  <tr>
                    <td style="padding:4px 6px;border-top:2px solid #000;font-weight:900">TOTAL</td>
                    <td style="padding:4px 6px;border-top:2px solid #000;text-align:right;font-weight:900;white-space:nowrap">₹${fmt(bill.totalAmount)}</td>
                  </tr>
                  <tr><td style="padding:4px 6px;border-top:1px solid #000;font-weight:800">PAID</td><td style="padding:4px 6px;border-top:1px solid #000;text-align:right;font-weight:800;white-space:nowrap;color:${statusColor(isUnconfirmedQr ? "#b45309" : "#15803d")}">${isUnconfirmedQr ? `${fmt(bill.totalAmount)} (To Be Confirmed)` : `₹${fmt(bill.paidAmount)}`}</td></tr>
                  <tr>
                    <!-- BALANCE DUE on a single horizontal row (label left,
                         amount right) matching the TOTAL and PAID rows above.
                         Kept at the same font size as TOTAL and right-aligned
                         within the fixed 42% column, so the amount renders
                         exactly like TOTAL's does and can't overflow/clip the
                         printable page — the failure the previous stacked
                         layout guarded against was specifically an oversized
                         (+7px) amount in that narrow column. The colored
                         background now carries the emphasis instead of size.
                         The amount cell is allowed to wrap so the longer
                         "To Be Confirmed" string also can't be clipped. -->
                    <td style="padding:6px;border-top:2px solid #000;font-weight:900;white-space:nowrap;background:${statusBg(isUnconfirmedQr ? "#fef3c7" : Number(bill.balanceAmount) > 0 ? "#fee2e2" : "#dcfce7")}">BALANCE DUE</td>
                    <td style="padding:6px;border-top:2px solid #000;text-align:right;font-weight:900;white-space:${isUnconfirmedQr ? "normal" : "nowrap"};background:${statusBg(isUnconfirmedQr ? "#fef3c7" : Number(bill.balanceAmount) > 0 ? "#fee2e2" : "#dcfce7")};color:${statusColor(isUnconfirmedQr ? "#b45309" : Number(bill.balanceAmount) > 0 ? "#b91c1c" : "#15803d")}">${isUnconfirmedQr ? "To Be Confirmed" : `₹${fmt(bill.balanceAmount)}`}</td>
                  </tr>
                  ${cashAmt > 0 ? `<tr><td style="padding:3px 6px;color:#555;font-size:${tinyPx}">Cash</td><td style="padding:3px 6px;text-align:right;white-space:nowrap;color:#555;font-size:${tinyPx}">₹${fmt(cashAmt)}</td></tr>` : ""}
                  ${upiAmt > 0 ? `<tr><td style="padding:3px 6px;color:#555;font-size:${tinyPx}">UPI</td><td style="padding:3px 6px;text-align:right;white-space:nowrap;color:#555;font-size:${tinyPx}">₹${fmt(upiAmt)}</td></tr>` : ""}
                  ${cardAmt > 0 ? `<tr><td style="padding:3px 6px;color:#555;font-size:${tinyPx}">Card</td><td style="padding:3px 6px;text-align:right;white-space:nowrap;color:#555;font-size:${tinyPx}">₹${fmt(cardAmt)}</td></tr>` : ""}
                  ${insAmt > 0 ? `<tr><td style="padding:3px 6px;color:#555;font-size:${tinyPx}">Insurance</td><td style="padding:3px 6px;text-align:right;white-space:nowrap;color:#555;font-size:${tinyPx}">₹${fmt(insAmt)}</td></tr>` : ""}
                  ${chqAmt > 0 ? `<tr><td style="padding:3px 6px;color:#555;font-size:${tinyPx}">Cheque</td><td style="padding:3px 6px;text-align:right;white-space:nowrap;color:#555;font-size:${tinyPx}">₹${fmt(chqAmt)}</td></tr>` : ""}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Spacer: pushes footer to the bottom of the physical A5 page (Billing
           Desk's fixed-length receipt sheet), or — when compactFooterGap is
           set — just a fixed ~3-4 line gap so a short receipt (1-2 tests,
           typical of online booking / kiosk) doesn't leave a huge blank
           middle before the footer. -->
      ${isA5 ? (useCompactFooter ? `<div style="height:${Math.round(parseInt(footerPx, 10) * 1.4 * 3.5)}px"></div>` : '<div style="flex:1"></div>') : ""}

      <!-- FOOTER -->
      <div style="margin-top:4px;border-top:2px solid #000;padding-top:6px;text-align:center;page-break-inside:avoid">
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
  @page { size: ${a4Page ? "A4 portrait" : (pageCssSize ?? `${isA5 ? "A5" : "A4"} ${isA5 ? orientation : "portrait"}`)}; margin: ${pageMargin}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: ${bodyPx}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt { width: 100%; max-width: 100%; padding: 1mm 0; box-sizing: border-box;${a4Page ? " max-width: 148mm; margin-left: auto; margin-right: auto;" : ""} }
  @media print {
    html, body { width: 100%; }
    .receipt { width: 100% !important; max-width: 100% !important; }
  }
  table { width: 100%; }
  .test-table tbody tr:nth-child(even) td { background: #f7f7f7; }
</style></head><body>${pages}</body></html>`;
}

// ── Wrapper that dispatches to a specific format renderer ─────────────────
// Backward compatible: if `format` is not specified, uses classic (the
// original behavior). "modern-landscape" is the recommended A5-landscape
// format for Epson/ink printers — see modernLandscapeBillPrint.ts.
export function buildBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  const { format = "classic" } = opts;

  // ── Modern A5-Landscape (recommended for ink printers) ──
  if (format === "modern-landscape") {
    return buildModernLandscapeBillPrintHtml(opts);
  }

  // ── Designer layouts A / B / C ──
  if (format === "designer-a" || format === "designer-b" || format === "designer-c") {
    return buildDesignerBillPrintHtml({ ...opts, layout: format });
  }
  if (format === "premium-a5") {
    // Map old paperSize to new BillPaperSize, honoring landscape when requested.
    const paperSize: BillPaperSize =
      opts.paperSize === "A5" ? (opts.orientation === "landscape" ? "A5-landscape" : "A5-portrait") : "A4";
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
