/**
 * modernLandscapeBillPrint.ts
 *
 * "Claude Quality" bill format purpose-built for the primary workflow:
 * A5 landscape on an Epson ink printer. Design principles applied here:
 *
 *   - Two-column body: tests left (~62%), totals sidebar right (~38%).
 *     Landscape has width to spare — the sidebar means the totals stay
 *     next to the tests instead of below them, and short bills don't have
 *     an ocean of empty space in the middle.
 *   - Restrained accent color (#1e3a5f "Care Navy") on section rules and
 *     the balance-due callout — Epson ink is cheap enough for one accent
 *     but a fully-tinted page wastes ink. Backgrounds stay white; only
 *     borders and one status pill use color.
 *   - No grid lines on the test table. Alternating pale row shading
 *     (#f8fafc) does the job at 1/10th the visual noise.
 *   - Real typography: tabular-nums for every rupee amount so the columns
 *     line up perfectly; a proper type scale (11/13/16/22px) instead of
 *     "everything is bold and 12px"; system font first, Arial fallback.
 *   - Print-safe: fixed 8mm page margin (inside Epson's typical 3mm
 *     unprintable zone), `page-break-inside:avoid` on the totals card,
 *     `-webkit-print-color-adjust:exact` so accent colors survive the
 *     driver's default "grayscale text" behavior.
 *
 * Shape-compatible with buildClassicBillPrintHtml: same BuildPrintHtmlOpts
 * input, same string output (a full <html> document with @page + <body>),
 * so the caller (buildBillPrintHtml wrapper) can dispatch either one via
 * `opts.format` without any other change.
 */

import type { BuildPrintHtmlOpts } from "./printBill";

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcAge(dob?: string | null, ageValue?: number | null, ageUnit?: string | null): string {
  // Only commit to the (ageValue, ageUnit) path when it will produce a real
  // string — a stored value of 0 (from a blank field on registration) must
  // fall through to dateOfBirth instead of short-circuiting to "".
  if (ageValue != null && ageValue > 0 && ageUnit) {
    if (ageUnit === "years")  return `${ageValue} Y`;
    if (ageUnit === "months") return `${ageValue} M`;
    if (ageUnit === "days")   return `${ageValue} D`;
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

export function buildModernLandscapeBillPrintHtml(opts: BuildPrintHtmlOpts): string {
  const { bill, clinic, paperSize, orientation = "landscape", isBW, qrDataUrl, reprintBy, reprintReason } = opts;
  const copies    = Math.max(1, Math.min(2, Number(clinic?.billPrintCopies ?? 1) || 1));
  const showCode  = clinic?.billShowCode  !== false;
  const showCat   = clinic?.billShowCategory !== false;
  const qrEnabled = clinic?.qrOnBillEnabled !== false;
  const isA5      = paperSize === "A5";

  const tests     = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled");
  const cancelled = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") === "cancelled");
  const billDigits = String(bill.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
  const ageStr    = calcAge(bill.patient?.dateOfBirth, bill.patient?.ageValue, bill.patient?.ageUnit);
  const ageGender = [ageStr, bill.patient?.gender].filter(Boolean).join(" · ");
  const created   = bill.createdAt ? new Date(bill.createdAt) : new Date();
  const dateStr   = created.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const isCancelled     = (bill.status ?? "") === "cancelled";
  const isUnconfirmedQr = (bill.payments ?? []).some((p) => String(p.method).includes("Unconfirmed"));
  const rawDoctor = bill.order?.doctor?.name ?? "";

  // Payment aggregation — only render the modes that actually paid.
  const payByMode: Record<string, number> = {};
  for (const p of bill.payments ?? []) {
    const k = String(p.method).toLowerCase().trim();
    payByMode[k] = (payByMode[k] || 0) + Number(p.amount || 0);
  }
  const cashAmt = payByMode["cash"] || 0;
  const upiAmt  = payByMode["upi"]  || 0;
  const cardAmt = payByMode["card"] || 0;
  const insAmt  = payByMode["insurance"] || 0;
  const chqAmt  = payByMode["cheque"] || 0;
  const paidAmt = Number(bill.paidAmount || 0);
  const balAmt  = Number(bill.balanceAmount || 0);

  // ── Color palette ──
  // Single accent (Care Navy). On B&W printers we collapse it to black so
  // the layout doesn't lose its structural rules to grayscaling. Never rely
  // on background color to convey information — everything readable in ink
  // remains readable if the color print fails.
  const accent  = isBW ? "#000" : "#1e3a5f";
  const accent2 = isBW ? "#000" : "#0b1e35"; // darker, for BALANCE DUE
  const bad     = isBW ? "#000" : "#b91c1c";
  const good    = isBW ? "#000" : "#15803d";
  const balColor = balAmt > 0 ? bad : good;
  const balBg    = isBW ? "#eee" : (balAmt > 0 ? "#fef2f2" : "#f0fdf4");

  // ── Font sizes (overridable via the same admin sliders as classic) ──
  const marginMm = opts.printMarginMm ?? 8;
  const pageMargin = `${marginMm}mm`;

  // Content-area height for the flex layout that pushes the footer to the
  // bottom of the A5 landscape page (148mm tall) minus top+bottom margin.
  const pageHeightMm = isA5 ? (orientation === "landscape" ? 148 : 210) : 297;
  const contentMinH  = `${pageHeightMm - marginMm * 2}mm`;

  const titleSize  = `${opts.printTitleFontPx        ?? 22}px`; // "INVOICE / RECEIPT" + clinic name
  const patientSz  = `${opts.printPatientNameFontPx  ?? 15}px`; // patient row headline
  const bodyPx     = `${opts.printBodyFontPx         ?? 12}px`; // section text baseline
  const headerPx   = `${opts.printHeaderFontPx       ?? 11}px`; // clinic address / contacts
  const tablePx    = `${opts.printTableFontPx        ?? 12}px`; // test rows
  const totalPx    = `${opts.printTotalFontPx        ?? 13}px`; // totals sidebar rows
  const footerPx   = `${opts.printFooterFontPx       ?? 11}px`; // footer thank-you line
  const tinyPx     = `${opts.printTinyFontPx         ?? 10}px`; // signature caption / disclaimer

  const logoImg = clinic?.logoDataUrl
    ? `<img src="${clinic.logoDataUrl}" alt="" style="height:44px;max-width:120px;object-fit:contain;display:block"/>`
    : "";

  const billedByName = (bill as { billedByStaffName?: string | null } | undefined)?.billedByStaffName ?? "";
  const billedBySigUrl = (bill as { billedByStaffSignatureUrl?: string | null } | undefined)?.billedByStaffSignatureUrl ?? "";

  // ── Test rows ──
  const testRow = (t: typeof tests[number], i: number) => {
    const name = t.displayName ?? t.test?.name ?? "—";
    const code = t.test?.code ?? "";
    const cat  = t.test?.category ?? "";
    return `<tr>
      <td style="padding:4px 6px;text-align:right;color:#64748b;font-variant-numeric:tabular-nums;width:22px">${i + 1}</td>
      ${showCode ? `<td style="padding:4px 6px;font-family:ui-monospace,Menlo,monospace;font-size:${Math.max(9, parseInt(tablePx, 10) - 1)}px;color:#334155;white-space:nowrap">${esc(code)}</td>` : ""}
      <td style="padding:4px 6px;color:#0f172a">
        ${esc(name)}
        ${showCat && cat ? `<span style="color:#94a3b8;font-size:${tinyPx};margin-left:6px">${esc(cat)}</span>` : ""}
      </td>
      <td style="padding:4px 6px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:#0f172a;white-space:nowrap">₹${fmt(t.price)}</td>
    </tr>`;
  };

  const cancelledFooter = cancelled.length
    ? `<div style="margin-top:4px;font-size:${tinyPx};color:#94a3b8">Cancelled: ${cancelled.map((t) => esc(t.displayName ?? t.test?.name ?? "—")).join(", ")}</div>`
    : "";

  const totalsRow = (label: string, value: string, bold = false, opts2: { color?: string; borderTop?: boolean } = {}) => `
    <tr>
      <td style="padding:3px 0;color:${opts2.color ?? "#334155"};font-size:${totalPx};${opts2.borderTop ? "border-top:1px solid #e2e8f0;padding-top:6px;" : ""}${bold ? "font-weight:700;" : ""}">${esc(label)}</td>
      <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums;color:${opts2.color ?? "#0f172a"};font-size:${totalPx};${opts2.borderTop ? "border-top:1px solid #e2e8f0;padding-top:6px;" : ""}${bold ? "font-weight:700;" : ""}">${value}</td>
    </tr>`;

  const paidRows: string[] = [];
  if (cashAmt > 0) paidRows.push(totalsRow("· Cash", `₹${fmt(cashAmt)}`));
  if (upiAmt  > 0) paidRows.push(totalsRow("· UPI",  `₹${fmt(upiAmt)}`));
  if (cardAmt > 0) paidRows.push(totalsRow("· Card", `₹${fmt(cardAmt)}`));
  if (insAmt  > 0) paidRows.push(totalsRow("· Insurance", `₹${fmt(insAmt)}`));
  if (chqAmt  > 0) paidRows.push(totalsRow("· Cheque", `₹${fmt(chqAmt)}`));

  // ── Page (rendered once per copy) ──
  const page = (copyIdx: number, copyLabel?: string) => `
    <section class="receipt" style="${copyIdx > 0 ? "page-break-before:always;" : ""}display:flex;flex-direction:column;min-height:${contentMinH}">

      ${(isCancelled || isUnconfirmedQr) ? `
        <div style="position:absolute;top:${marginMm + 2}mm;left:50%;transform:translateX(-50%) rotate(-8deg);border:2px solid ${bad};color:${bad};padding:2px 12px;font-weight:800;letter-spacing:2px;font-size:20px;opacity:0.35;pointer-events:none;text-transform:uppercase">
          ${isCancelled ? "CANCELLED" : "Awaiting Payment"}
        </div>` : ""}

      <!-- HEADER: logo + clinic (left), INVOICE + bill# + date (right) -->
      <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:6px;border-bottom:1.5px solid ${accent}">
        <div style="display:flex;gap:10px;align-items:center;min-width:0;flex:1">
          ${logoImg}
          <div style="min-width:0">
            <div style="font-size:${titleSize};font-weight:800;color:${accent};line-height:1.1;letter-spacing:0.3px">${esc(clinic?.name ?? "")}</div>
            <div style="font-size:${bodyPx};color:#334155;line-height:1.25;margin-top:1px">${esc(clinic?.tagline ?? "")}</div>
            <div style="font-size:${headerPx};color:#64748b;line-height:1.35;margin-top:2px">${esc(clinic?.address ?? "")}</div>
            <div style="font-size:${headerPx};color:#64748b;line-height:1.35">
              ${clinic?.phone ? `☏ ${esc(clinic.phone)}` : ""}
              ${clinic?.email ? ` &nbsp;·&nbsp; ✉ ${esc(clinic.email)}` : ""}
              ${clinic?.website ? ` &nbsp;·&nbsp; ${esc(clinic.website)}` : ""}
            </div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:${titleSize};font-weight:800;color:${accent};letter-spacing:1px;line-height:1;text-transform:uppercase">Invoice</div>
          <div style="font-size:${bodyPx};color:#64748b;margin-top:2px">Bill No.</div>
          <div style="font-size:${patientSz};font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;line-height:1.1">${esc(billDigits)}</div>
          <div style="font-size:${headerPx};color:#334155;margin-top:2px">${esc(dateStr)}</div>
          ${copyLabel ? `<div style="font-size:${tinyPx};color:${accent};margin-top:2px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">${esc(copyLabel)} COPY</div>` : ""}
          ${(reprintBy || reprintReason) ? `<div style="display:inline-block;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;border-radius:3px;padding:1px 6px;font-size:${tinyPx};font-weight:600;margin-top:3px">REPRINT${reprintReason ? ` · ${esc(reprintReason)}` : ""}</div>` : ""}
        </div>
      </header>

      <!-- PATIENT + REFERRING DOCTOR -->
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">
        <div style="min-width:0;flex:1">
          <div style="font-size:${tinyPx};color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:1px">Patient</div>
          <div style="font-size:${patientSz};font-weight:700;color:#0f172a;line-height:1.15">
            ${esc(`${bill.patient?.firstName ?? ""} ${bill.patient?.lastName ?? ""}`.trim().toUpperCase() || "—")}
            ${ageGender ? `<span style="font-weight:500;color:#475569;font-size:${bodyPx};margin-left:6px">· ${esc(ageGender)}</span>` : ""}
          </div>
          <div style="font-size:${headerPx};color:#64748b;margin-top:1px">
            ID: <span style="color:#334155;font-family:ui-monospace,Menlo,monospace">${esc(bill.patient?.patientId ?? "—")}</span>
            ${bill.patient?.phone ? ` &nbsp;·&nbsp; ☏ ${esc(bill.patient.phone)}` : ""}
          </div>
        </div>
        ${rawDoctor ? `
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:${tinyPx};color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:1px">Referred by</div>
            <div style="font-size:${patientSz};font-weight:600;color:#0f172a;line-height:1.15">${esc(rawDoctor)}</div>
          </div>` : ""}
      </div>

      <!-- BODY: tests (left) + totals sidebar (right) -->
      <div style="display:flex;gap:12px;flex:1;min-height:0;padding-top:6px">

        <!-- LEFT: tests -->
        <div style="flex:1;min-width:0;display:flex;flex-direction:column">
          <table style="width:100%;border-collapse:collapse;font-size:${tablePx}">
            <thead>
              <tr style="border-bottom:1.5px solid ${accent}">
                <th style="padding:3px 6px;text-align:right;color:${accent};font-weight:700;font-size:${tinyPx};letter-spacing:0.5px;width:22px">#</th>
                ${showCode ? `<th style="padding:3px 6px;text-align:left;color:${accent};font-weight:700;font-size:${tinyPx};letter-spacing:0.5px">CODE</th>` : ""}
                <th style="padding:3px 6px;text-align:left;color:${accent};font-weight:700;font-size:${tinyPx};letter-spacing:0.5px">TEST NAME</th>
                <th style="padding:3px 6px;text-align:right;color:${accent};font-weight:700;font-size:${tinyPx};letter-spacing:0.5px">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${tests.map(testRow).join("")}
            </tbody>
          </table>
          ${cancelledFooter}

          ${bill.testTokens && bill.testTokens.length ? `
            <div style="margin-top:6px;font-size:${tinyPx};color:#64748b;line-height:1.5">
              ${bill.testTokens.map((t) => `<span style="display:inline-block;background:#f1f5f9;color:#334155;border-radius:3px;padding:1px 6px;margin-right:4px">${esc(t.department)}: Token #${esc(String(t.tokenNo))} · ${esc(t.roomNumber)}</span>`).join("")}
            </div>` : ""}
        </div>

        <!-- RIGHT: totals sidebar (fixed width ~72mm for landscape) -->
        <aside style="width:70mm;flex-shrink:0;display:flex;flex-direction:column;gap:6px">
          <div style="page-break-inside:avoid">
            <table style="width:100%;border-collapse:collapse">
              ${totalsRow("Subtotal", `₹${fmt(bill.subtotal)}`)}
              ${Number(bill.discount) > 0 ? totalsRow("Discount", `− ₹${fmt(bill.discount)}`, false, { color: "#64748b" }) : ""}
              ${totalsRow("Total",   `₹${fmt(bill.totalAmount)}`, true, { borderTop: true })}
              ${totalsRow("Paid",    `₹${fmt(paidAmt)}`)}
              ${paidRows.join("")}
            </table>

            <!-- BALANCE DUE — the one visually-loud element -->
            <div style="margin-top:6px;padding:8px 10px;background:${balBg};border:1.5px solid ${balColor};border-radius:6px;display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:${totalPx};font-weight:700;color:${balColor};letter-spacing:0.5px;text-transform:uppercase">Balance Due</span>
              <span style="font-size:${parseInt(totalPx, 10) + 6}px;font-weight:800;color:${balColor};font-variant-numeric:tabular-nums">
                ${isUnconfirmedQr ? "Pending" : `₹${fmt(balAmt)}`}
              </span>
            </div>
          </div>

          ${qrEnabled && qrDataUrl ? `
            <div style="margin-top:auto;display:flex;gap:8px;align-items:center;padding-top:4px">
              <img src="${qrDataUrl}" alt="Verify" style="width:56px;height:56px;display:block;border:1px solid #e2e8f0;padding:2px;background:#fff"/>
              <div style="font-size:${tinyPx};color:#64748b;line-height:1.3">
                <div style="color:${accent};font-weight:700;letter-spacing:0.3px;text-transform:uppercase">Scan to verify</div>
                <div>Confirms this bill was issued by ${esc(clinic?.name ?? "the clinic")} and hasn't been altered.</div>
              </div>
            </div>` : ""}
        </aside>
      </div>

      <!-- FOOTER -->
      <footer style="margin-top:6px;padding-top:6px;border-top:1px solid ${accent};display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
        <div style="min-width:0;flex-shrink:0">
          ${billedBySigUrl
            ? `<img src="${billedBySigUrl}" alt="" style="max-height:26px;max-width:120px;object-fit:contain;display:block;margin-bottom:1px"/>`
            : `<div style="border-bottom:1px solid #94a3b8;width:120px;height:22px"></div>`}
          <div style="font-size:${tinyPx};color:#64748b;margin-top:1px">
            Authorised Signature${billedByName ? ` · Billed by ${esc(billedByName)}` : ""}
          </div>
        </div>
        <div style="text-align:right;flex:1;min-width:0">
          <div style="font-size:${footerPx};font-weight:600;color:#0f172a;line-height:1.3">
            ${esc(clinic?.footerNote || bill.reportCollectionNote || "Thank you for choosing our diagnostic services.")}
          </div>
          <div style="font-size:${tinyPx};color:#94a3b8;line-height:1.3;margin-top:1px">
            Computer-generated invoice · no signature required · ${esc(dateStr)}
          </div>
        </div>
      </footer>
    </section>`;

  const pageLabels: string[] = copies === 2
    ? [(opts.copyLabel === "office" ? "OFFICE" : "PATIENT"), "OFFICE"]
    : [opts.copyLabel === "office" ? "OFFICE" : (opts.copyLabel === "patient" ? "PATIENT" : "")];

  const pagesHtml = Array.from({ length: copies }).map((_, i) => page(i, pageLabels[i])).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(bill.billNumber)}</title>
<style>
  /* Physical page — landscape by default, respect the caller's request. */
  @page { size: ${isA5 ? "A5" : "A4"} ${orientation}; margin: ${pageMargin}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: #fff; color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: ${bodyPx};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt {
    width: 100%;
    position: relative;
    padding: 0;
    box-sizing: border-box;
  }
  .receipt table tbody tr:nth-child(even) td { background: #f8fafc; }
  /* Keep the totals card together on paper. */
  aside > div:first-child { page-break-inside: avoid; break-inside: avoid; }
</style></head><body>${pagesHtml}</body></html>`;
}
