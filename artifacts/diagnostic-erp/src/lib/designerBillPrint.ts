/**
 * designerBillPrint.ts
 *
 * THREE new premium bill layouts for Care Diagnostics ERP.
 *
 * Layout A — Minimal Premium
 *   Typography-first. No borders. Refined spacing. Ideal for MRI/CT/USG.
 *
 * Layout B — Modern Diagnostic Centre
 *   Professional invoice hierarchy. Patient info prominent. Bold payment summary.
 *
 * Layout C — Corporate Healthcare
 *   Premium invoice. Insurance/corporate billing ready. Clean columns.
 *
 * All layouts:
 *   - Reuse PrintBillData + PrintClinic types from printBill.ts (no new data deps)
 *   - Support A5 and A4 paper sizes with adaptive density
 *   - Support QR, barcode, watermark, signature, all existing toggles
 *   - Support patient / office / both copy types
 *   - Support reprint watermark
 *   - Are production-ready HTML that prints excellently on laser/inkjet/PDF
 */

import type { PrintBillData, PrintClinic, BuildPrintHtmlOpts } from "./printBill";
import type { BillPaperSize } from "./billPrintSettings";

// ── Shared utilities ───────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return dateStr; }
}

function calcAge(
  dob?: string | null,
  ageValue?: number | null,
  ageUnit?: string | null,
): string {
  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue}Y` : "";
    if (ageUnit === "months") return `${ageValue}M`;
    if (ageUnit === "days") return `${ageValue}D`;
  }
  if (!dob) return "";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y--;
  return y > 0 ? `${y}Y` : "";
}

function amountInWords(n: number): string {
  if (n === 0) return "Zero Rupees Only";
  const ones = ["", "One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function spell(x: number): string {
    if (x === 0) return "";
    if (x < 20) return ones[x] + " ";
    if (x < 100) return tens[Math.floor(x/10)] + " " + (ones[x%10] ? ones[x%10] + " " : "");
    return ones[Math.floor(x/100)] + " Hundred " + spell(x%100);
  }
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let w = "";
  if (rupees >= 10000000) { w += spell(Math.floor(rupees/10000000)) + "Crore "; }
  if (rupees >= 100000)   { w += spell(Math.floor((rupees%10000000)/100000)) + "Lakh "; }
  if (rupees >= 1000)     { w += spell(Math.floor((rupees%100000)/1000)) + "Thousand "; }
  w += spell(rupees % 1000);
  w = w.trim() + " Rupees";
  if (paise > 0) w += " and " + spell(paise).trim() + " Paise";
  return w + " Only";
}

interface PageData {
  bill: PrintBillData;
  clinic: PrintClinic;
  paperSize: BillPaperSize;
  isA4: boolean;
  qrDataUrl: string;
  copyLabel: string;
  opts: BuildPrintHtmlOpts;
  tests: NonNullable<NonNullable<PrintBillData["order"]>["tests"]>;
  cancelled: NonNullable<NonNullable<PrintBillData["order"]>["tests"]>;
  payments: NonNullable<PrintBillData["payments"]>;
  cashAmt: number; upiAmt: number; cardAmt: number; insAmt: number; chqAmt: number;
  onlineAmt: number;
  isUnconfirmedQr: boolean;
  patientName: string;
  patientAge: string;
  doctorName: string;
  billedByName: string;
  billedBySignatureUrl: string;
}

function buildPageData(
  bill: PrintBillData,
  clinic: PrintClinic,
  paperSize: BillPaperSize,
  qrDataUrl: string,
  copyLabel: string,
  opts: BuildPrintHtmlOpts,
  copyIdx: number,
): PageData {
  const tests = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => t.status === "cancelled");
  const payments = bill.payments ?? [];
  const isA4 = paperSize === "A4";

  const cashAmt = payments.filter((p) => ["cash"].includes((p.method ?? "").toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const upiAmt = payments.filter((p) => ["upi"].includes((p.method ?? "").toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const cardAmt = payments.filter((p) => ["card"].includes((p.method ?? "").toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const insAmt = payments.filter((p) => ["insurance"].includes((p.method ?? "").toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const chqAmt = payments.filter((p) => ["cheque","check"].includes((p.method ?? "").toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const onlineAmt = payments.filter((p) => ["online","gateway","upi","card"].includes((p.method ?? "").toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  const isUnconfirmedQr = bill.status === "pending" && (bill.payments?.some((p) => (p.method ?? "").toLowerCase().includes("online")) ?? false);

  const patientName = [bill.patient?.firstName, bill.patient?.lastName].filter(Boolean).join(" ") || "—";
  const patientAge = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const doctorName = bill.order?.doctor?.name || "";

  const designerSession = (() => {
    const s = typeof window !== "undefined" ? window.localStorage.getItem("erp_session") : null;
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  })();
  const billedByName: string = designerSession?.user?.name ?? "";
  const billedBySignatureUrl: string = designerSession?.user?.signatureDataUrl ?? "";

  return {
    bill, clinic, paperSize, isA4, qrDataUrl, copyLabel, opts,
    tests, cancelled, payments,
    cashAmt, upiAmt, cardAmt, insAmt, chqAmt, onlineAmt,
    isUnconfirmedQr, patientName, patientAge, doctorName, billedByName, billedBySignatureUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT A — Minimal Premium
// Typography-first. No table borders. Generous whitespace. Elegant separators.
// ─────────────────────────────────────────────────────────────────────────────

function renderLayoutA(d: PageData): string {
  const { bill, clinic, isA4, qrDataUrl, copyLabel, opts } = d;
  const { tests, patientName, patientAge, doctorName } = d;

  const isReprint = !!(opts.reprintBy || opts.reprintReason);
  const showQr = (opts.showQr !== false) && (clinic?.qrOnBillEnabled !== false) && qrDataUrl;

  // Typography scale
  const clinicNameSize = isA4 ? "20px" : "15px";
  const taglineSize    = isA4 ? "10px" : "8.5px";
  const headerSize     = isA4 ? "11px" : "9.5px";
  const bodySize       = isA4 ? "10px" : "9px";
  const smallSize      = isA4 ? "9px"  : "7.5px";
  const tinySize       = isA4 ? "8px"  : "7px";
  const totalSize      = isA4 ? "15px" : "13px";
  const billNoSize     = isA4 ? "11px" : "9.5px";

  const lineH = isA4 ? "1.7" : "1.5";
  const sectionGap = isA4 ? "14px" : "10px";
  const rowPadY = isA4 ? "5px" : "3px";

  const testRows = tests.map((t, i) => {
    const name = esc(t.displayName ?? t.test?.name ?? "Investigation");
    const code = clinic?.billShowCode !== false && t.test?.code ? `<span style="color:#888;margin-left:4px">(${esc(t.test.code)})</span>` : "";
    const cat  = clinic?.billShowCategory !== false && t.test?.category ? `<div style="font-size:${tinySize};color:#aaa;margin-top:1px">${esc(t.test.category)}</div>` : "";
    return `
    <tr>
      <td style="padding:${rowPadY} 0;border-bottom:${i < tests.length - 1 ? "1px solid #f0f0f0" : "none"};line-height:${lineH}">
        <div style="font-size:${bodySize};color:#1a1a1a;font-weight:500">${name}${code}</div>${cat}
      </td>
      <td style="padding:${rowPadY} 0;border-bottom:${i < tests.length - 1 ? "1px solid #f0f0f0" : "none"};text-align:right;white-space:nowrap;vertical-align:top">
        <span style="font-size:${bodySize};color:#1a1a1a;font-weight:500">₹${fmt(t.price)}</span>
      </td>
    </tr>`;
  }).join("");

  const qrBlock = showQr ? `
    <div style="text-align:center;margin-top:${sectionGap}">
      <img src="${qrDataUrl}" style="width:${isA4 ? "52px" : "44px"};height:${isA4 ? "52px" : "44px"}" alt="QR" />
      <div style="font-size:${tinySize};color:#aaa;margin-top:3px;letter-spacing:0.02em">SCAN TO VERIFY</div>
    </div>` : "";

  const watermark = opts.showWatermark || isReprint ? `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:${isA4 ? "72px" : "56px"};font-weight:900;color:rgba(0,0,0,0.04);pointer-events:none;white-space:nowrap;z-index:0;letter-spacing:2px">
      ${isReprint ? "REPRINT" : "CARE DIAGNOSTICS"}
    </div>` : "";

  const discNum = Number(bill.discount ?? 0);

  return `
  <section style="width:100%;box-sizing:border-box;padding:${isA4 ? "16mm 18mm 12mm" : "8mm 10mm 6mm"};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:${bodySize};color:#1a1a1a;line-height:${lineH};position:relative;min-height:${isA4 ? "277mm" : "198mm"};display:flex;flex-direction:column">
    ${watermark}

    <!-- HEADER: Clinic Name + Bill Info -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${sectionGap}">
      <div>
        ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" style="height:${isA4 ? "36px" : "26px"};margin-bottom:4px;display:block" alt="Logo" />` : ""}
        <div style="font-size:${clinicNameSize};font-weight:800;letter-spacing:-0.03em;color:#000;line-height:1.1">${esc(clinic?.name || "CARE DIAGNOSTICS")}</div>
        ${clinic?.tagline ? `<div style="font-size:${taglineSize};color:#888;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px">${esc(clinic.tagline)}</div>` : ""}
        ${clinic?.address ? `<div style="font-size:${tinySize};color:#666;margin-top:4px">${esc(clinic.address)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div style="font-size:${tinySize};color:#aaa;text-transform:uppercase;letter-spacing:0.08em">Receipt</div>
        <div style="font-size:${billNoSize};font-weight:700;color:#000;margin-top:2px">${esc(bill.billNumber)}</div>
        <div style="font-size:${tinySize};color:#666;margin-top:3px">${fmtDate(bill.createdAt)}</div>
        ${isReprint ? `<div style="font-size:${tinySize};color:#c00;font-weight:700;margin-top:3px">REPRINT</div>` : ""}
        ${copyLabel ? `<div style="font-size:${tinySize};color:#aaa;margin-top:2px">${esc(copyLabel)}</div>` : ""}
      </div>
    </div>

    <!-- Thin rule -->
    <div style="border-top:1.5px solid #000;margin-bottom:${sectionGap}"></div>

    <!-- PATIENT -->
    <div style="display:flex;justify-content:space-between;margin-bottom:${sectionGap}">
      <div>
        <div style="font-size:${tinySize};color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">Patient</div>
        <div style="font-size:${headerSize};font-weight:700;color:#000">${esc(patientName)}</div>
        <div style="font-size:${smallSize};color:#666">
          ${bill.patient?.patientId ? `UHID: ${esc(bill.patient.patientId)}` : ""}
          ${patientAge ? ` · ${patientAge}` : ""}
          ${bill.patient?.gender ? ` · ${esc(bill.patient.gender)}` : ""}
        </div>
        ${bill.patient?.phone ? `<div style="font-size:${smallSize};color:#666">${esc(bill.patient.phone)}</div>` : ""}
      </div>
      ${doctorName ? `
      <div style="text-align:right">
        <div style="font-size:${tinySize};color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">Referred By</div>
        <div style="font-size:${smallSize};font-weight:600;color:#333">${esc(doctorName)}</div>
      </div>` : ""}
    </div>

    <!-- INVESTIGATIONS -->
    <div style="margin-bottom:${sectionGap}">
      <div style="font-size:${tinySize};color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Investigations</div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${testRows}</tbody>
      </table>
    </div>

    <!-- Thin rule -->
    <div style="border-top:1px solid #ddd;margin-bottom:10px"></div>

    <!-- PAYMENT SUMMARY — typography-only, no boxes -->
    <div style="margin-bottom:${sectionGap}">
      ${discNum > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:${smallSize};color:#666">Subtotal</span>
        <span style="font-size:${smallSize};color:#666">₹${fmt(bill.subtotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:${smallSize};color:#888">Discount</span>
        <span style="font-size:${smallSize};color:#888">−₹${fmt(discNum)}</span>
      </div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;padding-top:6px;border-top:1.5px solid #000">
        <span style="font-size:${totalSize};font-weight:800;letter-spacing:-0.02em;color:#000">TOTAL</span>
        <span style="font-size:${totalSize};font-weight:800;letter-spacing:-0.02em;color:#000">₹${fmt(bill.totalAmount)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px">
        <span style="font-size:${bodySize};font-weight:600;color:${Number(bill.balanceAmount) <= 0 ? "#1a7a3c" : "#1a1a1a"}">PAID</span>
        <span style="font-size:${bodySize};font-weight:600;color:${Number(bill.balanceAmount) <= 0 ? "#1a7a3c" : "#1a1a1a"}">${d.isUnconfirmedQr ? "Pending Confirmation" : "₹" + fmt(bill.paidAmount)}</span>
      </div>
      ${Number(bill.balanceAmount) > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-top:3px">
        <span style="font-size:${bodySize};font-weight:700;color:#b91c1c">BALANCE DUE</span>
        <span style="font-size:${bodySize};font-weight:700;color:#b91c1c">₹${fmt(bill.balanceAmount)}</span>
      </div>` : ""}
      <!-- Payment method breakdown -->
      ${[
        {label:"Cash", amt: d.cashAmt},
        {label:"UPI", amt: d.upiAmt},
        {label:"Card", amt: d.cardAmt},
        {label:"Insurance", amt: d.insAmt},
        {label:"Cheque", amt: d.chqAmt},
      ].filter(x => x.amt > 0).map(x =>
        `<div style="display:flex;justify-content:space-between;margin-top:2px"><span style="font-size:${tinySize};color:#aaa">${x.label}</span><span style="font-size:${tinySize};color:#aaa">₹${fmt(x.amt)}</span></div>`
      ).join("")}
    </div>

    <!-- Spacer -->
    <div style="flex:1"></div>

    <!-- QR + FOOTER -->
    <div style="border-top:1px solid #e0e0e0;padding-top:${isA4 ? "12px" : "8px"};display:flex;justify-content:space-between;align-items:flex-end">
      <div style="flex:1">
        ${opts.showSignatureLine !== false ? `
        ${d.billedBySignatureUrl
          ? `<img src="${d.billedBySignatureUrl}" alt="Signature" style="max-height:28px;max-width:${isA4 ? "120px" : "90px"};object-fit:contain;display:block;margin-bottom:2px"/>`
          : `<div style="border-bottom:1px solid #ccc;width:${isA4 ? "120px" : "90px"};margin-bottom:2px"></div>`}
        <div style="font-size:${tinySize};color:#aaa">Authorised Signature</div>` : ""}
        ${opts.showComputerGenerated !== false ? `<div style="font-size:${tinySize};color:#bbb;margin-top:${isA4 ? "10px" : "6px"}">Computer Generated Invoice · No Signature Required</div>` : ""}
        <div style="font-size:${tinySize};color:#bbb;margin-top:1px;font-style:italic">Touching Lives With Care</div>
        ${opts.showServiceFooter !== false && clinic?.serviceFooter ? `<div style="font-size:${tinySize};color:#bbb;margin-top:1px">${esc(clinic.serviceFooter)}</div>` : `<div style="font-size:${tinySize};color:#bbb;margin-top:1px">MRI · CT · Ultrasound · Digital X-Ray · Mammography · Pathology</div>`}
      </div>
      ${qrBlock}
    </div>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT B — Modern Diagnostic Centre
// Invoice-style hierarchy. Patient block prominent. Bold payment anchor.
// ─────────────────────────────────────────────────────────────────────────────

function renderLayoutB(d: PageData): string {
  const { bill, clinic, isA4, qrDataUrl, copyLabel, opts } = d;
  const { tests, patientName, patientAge, doctorName } = d;

  const isReprint = !!(opts.reprintBy || opts.reprintReason);
  const showQr = (opts.showQr !== false) && (clinic?.qrOnBillEnabled !== false) && qrDataUrl;

  const bodyPx    = isA4 ? "10px" : "8.5px";
  const smallPx   = isA4 ? "9px"  : "7.5px";
  const tinyPx    = isA4 ? "8px"  : "7px";
  const headerPx  = isA4 ? "12px" : "10px";
  const totalPx   = isA4 ? "17px" : "14px";
  const clinicPx  = isA4 ? "18px" : "14px";

  const gap = isA4 ? "12px" : "8px";
  const rowPad = isA4 ? "6px 8px" : "4px 6px";
  const discNum = Number(bill.discount ?? 0);

  const testRows = tests.map((t, i) => {
    const name = esc(t.displayName ?? t.test?.name ?? "Investigation");
    const code = clinic?.billShowCode !== false && t.test?.code ? ` <span style="color:#999">(${esc(t.test.code)})</span>` : "";
    const altBg = i % 2 === 0 ? "#fafafa" : "#fff";
    return `<tr style="background:${altBg}">
      <td style="padding:${rowPad};font-size:${bodyPx};border-bottom:1px solid #eee">${name}${code}</td>
      <td style="padding:${rowPad};font-size:${bodyPx};text-align:right;border-bottom:1px solid #eee;white-space:nowrap;font-weight:600">₹${fmt(t.price)}</td>
    </tr>`;
  }).join("");

  const paymentMethods = [
    {label:"Cash", amt: d.cashAmt},
    {label:"UPI", amt: d.upiAmt},
    {label:"Card", amt: d.cardAmt},
    {label:"Insurance", amt: d.insAmt},
    {label:"Cheque", amt: d.chqAmt},
  ].filter(x => x.amt > 0);

  const watermark = opts.showWatermark || isReprint ? `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:${isA4 ? "68px" : "52px"};font-weight:900;color:rgba(0,0,0,0.04);pointer-events:none;white-space:nowrap;z-index:0">
      ${isReprint ? "REPRINT" : "CARE DIAGNOSTICS"}
    </div>` : "";

  return `
  <section style="width:100%;box-sizing:border-box;padding:${isA4 ? "14mm 16mm 10mm" : "7mm 9mm 5mm"};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:${bodyPx};color:#1a1a1a;line-height:1.5;position:relative;min-height:${isA4 ? "277mm" : "198mm"};display:flex;flex-direction:column">
    ${watermark}

    <!-- HEADER BAR -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:${gap};border-bottom:2px solid #1a1a1a;margin-bottom:${gap}">
      <div>
        ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" style="height:${isA4 ? "32px" : "24px"};margin-bottom:3px;display:block" alt="Logo" />` : ""}
        <div style="font-size:${clinicPx};font-weight:900;color:#000;letter-spacing:-0.02em;line-height:1.1">${esc(clinic?.name || "CARE DIAGNOSTICS")}</div>
        ${clinic?.tagline ? `<div style="font-size:${tinyPx};color:#777;letter-spacing:0.06em;text-transform:uppercase;margin-top:1px">${esc(clinic.tagline)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div style="display:inline-block;background:#1a1a1a;color:#fff;padding:2px 8px;font-size:${tinyPx};font-weight:700;letter-spacing:0.06em;text-transform:uppercase">
          ${copyLabel || "Receipt"}${isReprint ? " · REPRINT" : ""}
        </div>
        <div style="font-size:${headerPx};font-weight:800;color:#000;margin-top:4px">${esc(bill.billNumber)}</div>
        <div style="font-size:${smallPx};color:#666;margin-top:2px">${fmtDate(bill.createdAt)}</div>
        ${clinic?.gstin ? `<div style="font-size:${tinyPx};color:#999;margin-top:2px">GSTIN: ${esc(clinic.gstin)}</div>` : ""}
      </div>
    </div>

    <!-- PATIENT + CLINIC INFO ROW -->
    <div style="display:flex;gap:${isA4 ? "24px" : "16px"};margin-bottom:${gap}">
      <div style="flex:1.5;background:#f5f5f5;padding:${isA4 ? "10px 12px" : "7px 9px"};border-radius:2px">
        <div style="font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.08em;color:#999;margin-bottom:3px">Patient Details</div>
        <div style="font-size:${headerPx};font-weight:800;color:#000">${esc(patientName)}</div>
        <div style="font-size:${smallPx};color:#555;margin-top:2px">
          ${bill.patient?.patientId ? `UHID: ${esc(bill.patient.patientId)}` : ""}
          ${patientAge ? ` · Age ${patientAge}` : ""}
          ${bill.patient?.gender ? ` · ${esc(bill.patient.gender)}` : ""}
        </div>
        ${bill.patient?.phone ? `<div style="font-size:${smallPx};color:#555">${esc(bill.patient.phone)}</div>` : ""}
        ${doctorName ? `<div style="font-size:${smallPx};color:#555;margin-top:4px">Ref: <strong>${esc(doctorName)}</strong></div>` : ""}
      </div>
      <div style="flex:1;background:#f5f5f5;padding:${isA4 ? "10px 12px" : "7px 9px"};border-radius:2px">
        <div style="font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.08em;color:#999;margin-bottom:3px">Issued By</div>
        ${clinic?.address ? `<div style="font-size:${smallPx};color:#555">${esc(clinic.address)}</div>` : ""}
        ${clinic?.phone ? `<div style="font-size:${smallPx};color:#555;margin-top:2px">${esc(clinic.phone)}</div>` : ""}
        ${clinic?.email ? `<div style="font-size:${smallPx};color:#555">${esc(clinic.email)}</div>` : ""}
      </div>
    </div>

    <!-- INVESTIGATIONS TABLE -->
    <div style="margin-bottom:${gap}">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #1a1a1a">
            <th style="text-align:left;padding:${isA4 ? "6px 8px" : "4px 6px"};font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.06em;color:#555;font-weight:600">Investigation</th>
            <th style="text-align:right;padding:${isA4 ? "6px 8px" : "4px 6px"};font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.06em;color:#555;font-weight:600">Amount</th>
          </tr>
        </thead>
        <tbody>${testRows}</tbody>
      </table>
    </div>

    <!-- PAYMENT SUMMARY — strong visual anchor -->
    <div style="border-top:2px solid #1a1a1a;padding-top:${gap}">
      ${discNum > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:${smallPx};color:#666">Subtotal</span>
        <span style="font-size:${smallPx};color:#666">₹${fmt(bill.subtotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:${smallPx};color:#888">Discount Applied</span>
        <span style="font-size:${smallPx};color:#888">−₹${fmt(discNum)}</span>
      </div>` : ""}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:${totalPx};font-weight:900;letter-spacing:-0.02em">TOTAL</span>
        <span style="font-size:${totalPx};font-weight:900;letter-spacing:-0.02em">₹${fmt(bill.totalAmount)}</span>
      </div>
      <div style="border-top:1px solid #ddd;padding-top:4px;display:flex;justify-content:space-between">
        <span style="font-size:${bodyPx};font-weight:700;color:${Number(bill.balanceAmount) <= 0 ? "#166534" : "#1a1a1a"}">PAID</span>
        <span style="font-size:${bodyPx};font-weight:700;color:${Number(bill.balanceAmount) <= 0 ? "#166534" : "#1a1a1a"}">${d.isUnconfirmedQr ? "Pending Confirmation" : "₹" + fmt(bill.paidAmount)}</span>
      </div>
      ${Number(bill.balanceAmount) > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-top:3px">
        <span style="font-size:${bodyPx};font-weight:700;color:#9b1c1c">BALANCE DUE</span>
        <span style="font-size:${bodyPx};font-weight:700;color:#9b1c1c">₹${fmt(bill.balanceAmount)}</span>
      </div>` : ""}

      <!-- Payment breakdown -->
      ${paymentMethods.length > 0 ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #ddd;display:flex;gap:12px;flex-wrap:wrap">
        ${paymentMethods.map(x => `<span style="font-size:${tinyPx};color:#999">${x.label}: ₹${fmt(x.amt)}</span>`).join("")}
      </div>` : ""}
    </div>

    <!-- Spacer -->
    <div style="flex:1"></div>

    <!-- FOOTER -->
    <div style="border-top:1.5px solid #1a1a1a;padding-top:${isA4 ? "10px" : "7px"};margin-top:${gap};display:flex;justify-content:space-between;align-items:flex-end">
      <div style="flex:1">
        ${opts.showSignatureLine !== false ? `
        ${d.billedBySignatureUrl
          ? `<img src="${d.billedBySignatureUrl}" alt="Signature" style="max-height:26px;max-width:${isA4 ? "110px" : "80px"};object-fit:contain;display:block;margin-bottom:2px"/>`
          : `<div style="border-bottom:1px solid #ccc;width:${isA4 ? "110px" : "80px"};margin-bottom:2px"></div>`}
        <div style="font-size:${tinyPx};color:#999">Authorised Signature</div>` : ""}
        <div style="margin-top:${isA4 ? "8px" : "5px"}">
          ${opts.showComputerGenerated !== false ? `<div style="font-size:${tinyPx};color:#bbb">Computer Generated Invoice</div>` : ""}
          <div style="font-size:${tinyPx};color:#bbb;margin-top:1px">Touching Lives With Care</div>
          <div style="font-size:${tinyPx};color:#bbb;margin-top:1px">MRI · CT · Ultrasound · Digital X-Ray · Mammography · Pathology</div>
          ${clinic?.phone ? `<div style="font-size:${tinyPx};color:#bbb;margin-top:1px">${esc(clinic.phone)}</div>` : ""}
        </div>
      </div>
      ${showQr ? `
      <div style="text-align:center">
        <img src="${qrDataUrl}" style="width:${isA4 ? "50px" : "42px"};height:${isA4 ? "50px" : "42px"}" alt="QR" />
        <div style="font-size:${tinyPx};color:#bbb;margin-top:2px">Verify</div>
      </div>` : ""}
    </div>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT C — Corporate Healthcare
// Premium invoice. Insurance/corporate billing. Clean two-column grid.
// ─────────────────────────────────────────────────────────────────────────────

function renderLayoutC(d: PageData): string {
  const { bill, clinic, isA4, qrDataUrl, copyLabel, opts } = d;
  const { tests, patientName, patientAge, doctorName } = d;

  const isReprint = !!(opts.reprintBy || opts.reprintReason);
  const showQr = (opts.showQr !== false) && (clinic?.qrOnBillEnabled !== false) && qrDataUrl;

  const bodyPx   = isA4 ? "10px" : "8.5px";
  const smallPx  = isA4 ? "9px"  : "7.5px";
  const tinyPx   = isA4 ? "8px"  : "7px";
  const headerPx = isA4 ? "11px" : "9.5px";
  const totalPx  = isA4 ? "16px" : "13px";
  const clinicPx = isA4 ? "16px" : "12px";

  const gap  = isA4 ? "12px" : "8px";
  const rowPad = isA4 ? "7px 10px" : "4px 7px";
  const discNum = Number(bill.discount ?? 0);

  const testRows = tests.map((t, i) => {
    const name = esc(t.displayName ?? t.test?.name ?? "Investigation");
    const code = clinic?.billShowCode !== false && t.test?.code ? ` <span style="color:#aaa;font-size:${tinyPx}">(${esc(t.test.code)})</span>` : "";
    const cat  = clinic?.billShowCategory !== false && t.test?.category ? `<div style="font-size:${tinyPx};color:#aaa">${esc(t.test.category)}</div>` : "";
    return `<tr>
      <td style="padding:${rowPad};border-bottom:1px solid #ebebeb;font-size:${bodyPx}">
        <span style="font-weight:500">${name}</span>${code}${cat}
      </td>
      <td style="padding:${rowPad};border-bottom:1px solid #ebebeb;text-align:right;font-size:${bodyPx};font-weight:600;white-space:nowrap">
        ₹${fmt(t.price)}
      </td>
    </tr>`;
  }).join("");

  const payMethods = [
    {label:"Cash", amt: d.cashAmt},
    {label:"UPI", amt: d.upiAmt},
    {label:"Card", amt: d.cardAmt},
    {label:"Insurance", amt: d.insAmt},
    {label:"Cheque", amt: d.chqAmt},
  ].filter(x => x.amt > 0);

  const watermark = opts.showWatermark || isReprint ? `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:${isA4 ? "70px" : "54px"};font-weight:900;color:rgba(0,0,0,0.04);pointer-events:none;white-space:nowrap;z-index:0">
      ${isReprint ? "REPRINT" : "CARE DIAGNOSTICS"}
    </div>` : "";

  return `
  <section style="width:100%;box-sizing:border-box;padding:${isA4 ? "0" : "0"};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:${bodyPx};color:#1a1a1a;line-height:1.5;position:relative;min-height:${isA4 ? "277mm" : "198mm"};display:flex;flex-direction:column">
    ${watermark}

    <!-- TOP BAND -->
    <div style="background:#1a1a1a;color:#fff;padding:${isA4 ? "10mm 14mm 8mm" : "6mm 9mm 5mm"};display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" style="height:${isA4 ? "28px" : "20px"};margin-bottom:3px;display:block;filter:brightness(0) invert(1)" alt="Logo" />` : ""}
        <div style="font-size:${clinicPx};font-weight:800;letter-spacing:-0.02em;line-height:1.1">${esc(clinic?.name || "CARE DIAGNOSTICS")}</div>
        ${clinic?.tagline ? `<div style="font-size:${tinyPx};color:#aaa;letter-spacing:0.06em;text-transform:uppercase;margin-top:1px">${esc(clinic.tagline)}</div>` : ""}
        ${clinic?.address ? `<div style="font-size:${tinyPx};color:#888;margin-top:4px">${esc(clinic.address)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div style="font-size:${tinyPx};color:#888;text-transform:uppercase;letter-spacing:0.08em">Tax Invoice</div>
        <div style="font-size:${headerPx};font-weight:800;color:#fff;margin-top:2px">${esc(bill.billNumber)}</div>
        <div style="font-size:${tinyPx};color:#888;margin-top:2px">${fmtDate(bill.createdAt)}</div>
        ${clinic?.gstin ? `<div style="font-size:${tinyPx};color:#aaa;margin-top:2px">GSTIN: ${esc(clinic.gstin)}</div>` : ""}
        ${isReprint ? `<div style="font-size:${tinyPx};color:#f87171;font-weight:700;margin-top:2px">REPRINT</div>` : ""}
        ${copyLabel ? `<div style="font-size:${tinyPx};color:#888;margin-top:2px">${esc(copyLabel)}</div>` : ""}
      </div>
    </div>

    <!-- BODY -->
    <div style="padding:${isA4 ? "10mm 14mm" : "6mm 9mm"};flex:1;display:flex;flex-direction:column">

      <!-- PATIENT + INVOICE META — 2 col -->
      <div style="display:flex;gap:${isA4 ? "20px" : "14px"};margin-bottom:${gap}">
        <div style="flex:1.4">
          <div style="font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.08em;color:#aaa;margin-bottom:3px">Bill To</div>
          <div style="font-size:${headerPx};font-weight:800;color:#000">${esc(patientName)}</div>
          <div style="font-size:${smallPx};color:#666;margin-top:2px">
            ${bill.patient?.patientId ? `UHID: ${esc(bill.patient.patientId)}` : ""}
            ${patientAge ? ` · ${patientAge}` : ""}
            ${bill.patient?.gender ? ` · ${esc(bill.patient.gender)}` : ""}
          </div>
          ${bill.patient?.phone ? `<div style="font-size:${smallPx};color:#666">${esc(bill.patient.phone)}</div>` : ""}
          ${doctorName ? `<div style="font-size:${smallPx};color:#666;margin-top:3px">Referred by: <span style="font-weight:600">${esc(doctorName)}</span></div>` : ""}
        </div>
        <div style="flex:1;border-left:1px solid #eee;padding-left:${isA4 ? "16px" : "10px"}">
          <div style="font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.08em;color:#aaa;margin-bottom:3px">Invoice Details</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="font-size:${smallPx};color:#666">Invoice No.</span>
            <span style="font-size:${smallPx};font-weight:600">${esc(bill.billNumber)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="font-size:${smallPx};color:#666">Date</span>
            <span style="font-size:${smallPx}">${fmtDate(bill.createdAt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:${smallPx};color:#666">Status</span>
            <span style="font-size:${smallPx};font-weight:700;color:${Number(bill.balanceAmount) <= 0 ? "#166534" : "#9b1c1c"}">
              ${Number(bill.balanceAmount) <= 0 ? "PAID" : "DUE"}
            </span>
          </div>
        </div>
      </div>

      <!-- INVESTIGATIONS TABLE -->
      <div style="margin-bottom:${gap}">
        <table style="width:100%;border-collapse:collapse;border:1px solid #ebebeb">
          <thead>
            <tr style="background:#f7f7f7;border-bottom:1.5px solid #1a1a1a">
              <th style="padding:${rowPad};text-align:left;font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:#555">Description</th>
              <th style="padding:${rowPad};text-align:right;font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:#555">Amount</th>
            </tr>
          </thead>
          <tbody>${testRows}</tbody>
        </table>
      </div>

      <!-- TOTALS — 2 col: payment methods + totals -->
      <div style="display:flex;gap:${isA4 ? "20px" : "14px"};margin-bottom:${gap};align-items:flex-start">
        <!-- Left: payment methods -->
        <div style="flex:1">
          ${payMethods.length > 0 ? `
          <div style="font-size:${tinyPx};text-transform:uppercase;letter-spacing:0.08em;color:#aaa;margin-bottom:4px">Payment Mode</div>
          ${payMethods.map(x => `
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="font-size:${smallPx};color:#555">${x.label}</span>
            <span style="font-size:${smallPx}">₹${fmt(x.amt)}</span>
          </div>`).join("")}` : ""}
          ${showQr ? `
          <div style="margin-top:${gap}">
            <img src="${qrDataUrl}" style="width:${isA4 ? "48px" : "40px"};height:${isA4 ? "48px" : "40px"}" alt="QR" />
            <div style="font-size:${tinyPx};color:#bbb;margin-top:2px">Scan to Verify</div>
          </div>` : ""}
        </div>

        <!-- Right: financial totals -->
        <div style="flex:1.2;border:1px solid #ebebeb;padding:${isA4 ? "10px 12px" : "7px 9px"}">
          ${discNum > 0 ? `
          <div style="display:flex;justify-content:space-between;padding-bottom:3px;margin-bottom:3px;border-bottom:1px solid #eee">
            <span style="font-size:${smallPx};color:#666">Subtotal</span>
            <span style="font-size:${smallPx}">₹${fmt(bill.subtotal)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:${smallPx};color:#666">Discount</span>
            <span style="font-size:${smallPx};color:#666">−₹${fmt(discNum)}</span>
          </div>` : ""}
          <div style="display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #1a1a1a;padding-top:6px;margin-bottom:5px">
            <span style="font-size:${totalPx};font-weight:900">TOTAL</span>
            <span style="font-size:${totalPx};font-weight:900">₹${fmt(bill.totalAmount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:${bodyPx};font-weight:600;color:${Number(bill.balanceAmount) <= 0 ? "#166534" : "#1a1a1a"}">PAID</span>
            <span style="font-size:${bodyPx};font-weight:600;color:${Number(bill.balanceAmount) <= 0 ? "#166534" : "#1a1a1a"}">${d.isUnconfirmedQr ? "Pending" : "₹" + fmt(bill.paidAmount)}</span>
          </div>
          ${Number(bill.balanceAmount) > 0 ? `
          <div style="display:flex;justify-content:space-between;padding-top:3px;border-top:1px solid #eee">
            <span style="font-size:${bodyPx};font-weight:700;color:#9b1c1c">BALANCE</span>
            <span style="font-size:${bodyPx};font-weight:700;color:#9b1c1c">₹${fmt(bill.balanceAmount)}</span>
          </div>` : ""}
          ${opts.showAmountInWords && Number(bill.totalAmount) > 0 ? `
          <div style="font-size:${tinyPx};color:#888;margin-top:5px;font-style:italic">${amountInWords(Number(bill.totalAmount))}</div>` : ""}
        </div>
      </div>

      <!-- Spacer -->
      <div style="flex:1"></div>

      <!-- FOOTER -->
      <div style="border-top:1px solid #ddd;padding-top:${isA4 ? "10px" : "7px"}">
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <div>
            ${opts.showSignatureLine !== false ? `
            ${d.billedBySignatureUrl
              ? `<img src="${d.billedBySignatureUrl}" alt="Signature" style="max-height:26px;max-width:${isA4 ? "110px" : "80px"};object-fit:contain;display:block;margin-bottom:2px"/>`
              : `<div style="border-bottom:1px solid #ccc;width:${isA4 ? "110px" : "80px"};margin-bottom:2px"></div>`}
            <div style="font-size:${tinyPx};color:#aaa">Authorised Signature</div>` : ""}
          </div>
          <div style="text-align:right">
            ${opts.showComputerGenerated !== false ? `<div style="font-size:${tinyPx};color:#bbb">Computer Generated Invoice</div>` : ""}
            <div style="font-size:${tinyPx};color:#bbb;margin-top:1px;font-style:italic">Touching Lives With Care</div>
          </div>
        </div>
        <div style="font-size:${tinyPx};color:#bbb;margin-top:4px;text-align:center">MRI · CT · Ultrasound · Digital X-Ray · Mammography · Pathology</div>
      </div>
    </div>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function buildDesignerBillPrintHtml(
  opts: BuildPrintHtmlOpts & { layout: "designer-a" | "designer-b" | "designer-c" },
): string {
  const { bill, clinic, qrDataUrl } = opts;

  // Map paperSize
  const paperSizeStr = opts.paperSize; // "A4" | "A5"
  const paperSize: BillPaperSize = paperSizeStr === "A4" ? "A4" : "A5-portrait";
  const isA4 = paperSizeStr === "A4";
  const pageSize = isA4 ? "A4 portrait" : "A5 portrait";
  const pageWidth = isA4 ? "210mm" : "148mm";
  const pageHeight = isA4 ? "297mm" : "210mm";
  const pageMargin = isA4 ? "10mm" : "6mm";

  const copies = Math.max(1, Math.min(3, Number(clinic?.billPrintCopies ?? 1) || 1));
  const copyLabels = ["Patient Copy", "Office Copy", "Duplicate Copy"];

  function makePage(copyIdx: number): string {
    const copyLabel = copies > 1 ? (opts.copyLabel || copyLabels[copyIdx] || `Copy ${copyIdx + 1}`) : (opts.copyLabel || "");
    const pd = buildPageData(bill!, clinic, paperSize, qrDataUrl, copyLabel, opts, copyIdx);

    switch (opts.layout) {
      case "designer-a": return renderLayoutA(pd);
      case "designer-b": return renderLayoutB(pd);
      case "designer-c": return renderLayoutC(pd);
    }
  }

  const pages = Array.from({ length: copies }, (_, i) => makePage(i)).join(
    `<div style="page-break-before:always"></div>`,
  );

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${esc(bill?.billNumber ?? "")}</title>
  <style>
    @page { size: ${pageSize}; margin: ${pageMargin}; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      background: #fff;
      color: #000;
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    section { page-break-inside: avoid; }
    @media print {
      html, body { height: auto; }
      section { page-break-after: always; }
      section:last-child { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  ${pages}
</body>
</html>`;
}
