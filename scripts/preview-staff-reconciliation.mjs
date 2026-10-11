#!/usr/bin/env node
/**
 * Render the two staff reconciliation slips from the clinic's printed pair and
 * measure them, without a server, a database or a deploy.
 *
 *   node scripts/preview-staff-reconciliation.mjs
 *
 * Writes tmp/staff-recon-preview/: one PNG + one PDF + one JSON measurement per
 * case. Geometry comes from the repo's own buildStaffDayCloseSlipHtml, run in
 * real Chromium under print media — not from reading the template.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tmp", "staff-recon-preview");
mkdirSync(outDir, { recursive: true });

const slipTs = path.join(
  root,
  "artifacts",
  "diagnostic-erp",
  "src",
  "lib",
  "staffDayCloseSlip.ts",
);

// Strip types with the installed esbuild, then import the real module.
const require_ = createRequire(import.meta.url);
const esbuildDir = path.join(
  root,
  "node_modules",
  ".pnpm",
  "esbuild@0.27.3",
  "node_modules",
  "esbuild",
);
const esbuild = require_(esbuildDir);
const source = readFileSync(slipTs, "utf8");
const js = await esbuild.transform(source, { loader: "ts", format: "esm" });
const shim = path.join(outDir, "_slip.mjs");
writeFileSync(shim, js.code);
const { buildStaffDayCloseSlipHtml } = await import(pathToFileURL(shim).href);

// IST is +05:30, so 3:38 pm IST = 10:08 UTC and 3:28 pm IST = 09:58 UTC.
const cases = [
  {
    key: "suraj-234",
    label: "Closure #234 — SURAJ JHA (1-day window, dues collected)",
    closure: {
      id: 234,
      userName: "SURAJ JHA",
      closureDate: "2026-10-11",
      closedAt: "2026-10-11T10:08:00.000Z",
      coveredFromTs: "2026-10-10T10:08:00.000Z",
      coveredToTs: "2026-10-11T10:08:00.000Z",
      expectedCash: "106350",
      expectedUpi: "90100",
      expectedCard: "0",
      expectedCheque: "0",
      expectedOther: "0",
      totalBilled: "189950",
      totalDue: "6500",
      actualCash: "106350",
      actualUpi: "90100",
      actualCard: "0",
      actualCheque: "0",
      actualOther: "0",
      totalActual: "196450",
      variance: "0",
      drawerStatus: "balanced",
      denominations: null,
      denominationTotal: null,
      printActivity: {
        dueReceived: 13700,
        cancelledBillsAmount: 0,
        refundsAmount: 700,
        discountsGiven: 400,
        discountBills: [],
        billEdits: [],
        voucherEdits: [],
        expenseDetails: [],
        totalExpenses: 0,
        cashExpenses: 0,
        digitalExpenses: 0,
      },
    },
  },
  {
    key: "vijay-233",
    label: "Closure #233 — VIJAY YADAV (3-day window, no dues collected)",
    closure: {
      id: 233,
      userName: "VIJAY YADAV",
      closureDate: "2026-10-11",
      closedAt: "2026-10-11T09:58:00.000Z",
      coveredFromTs: "2026-10-08T09:58:00.000Z",
      coveredToTs: "2026-10-11T09:58:00.000Z",
      expectedCash: "70150",
      expectedUpi: "53525",
      expectedCard: "0",
      expectedCheque: "0",
      expectedOther: "0",
      totalBilled: "125675",
      totalDue: "0",
      actualCash: "70150",
      actualUpi: "53525",
      actualCard: "0",
      actualCheque: "0",
      actualOther: "0",
      totalActual: "123675",
      variance: "0",
      drawerStatus: "balanced",
      denominations: null,
      denominationTotal: null,
      printActivity: {
        dueReceived: 0,
        cancelledBillsAmount: 0,
        refundsAmount: 2000,
        discountsGiven: 2325,
        discountBills: [],
        billEdits: [],
        voucherEdits: [],
        expenseDetails: [],
        totalExpenses: 0,
        cashExpenses: 0,
        digitalExpenses: 0,
      },
    },
  },
];

const MM = 96 / 25.4; // CSS px per millimetre
const A5_W = Math.round(148 * MM);
const A5_H = Math.round(210 * MM);

const playwright = require_(path.join(root, "node_modules", "playwright"));

// A synthetic CARE-style wordmark PNG, rasterised by Chromium itself so the
// logo box is measured with a real decodable image rather than a 1x1 stub.
async function makeLogo(browser) {
  const p = await browser.newPage();
  await p.setContent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
       <circle cx="90" cy="90" r="82" fill="none" stroke="#0f766e" stroke-width="10"/>
       <text x="90" y="112" font-family="Arial" font-size="52" font-weight="900"
             fill="#0f766e" text-anchor="middle">CARE</text>
     </svg>`,
    { waitUntil: "networkidle" },
  );
  const buf = await p.locator("svg").screenshot({ type: "png" });
  await p.close();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const variants = [
  { tag: "with-logo", clinic: (logo) => ({ name: "Care Diagnostics", logoDataUrl: logo }) },
  { tag: "no-logo", clinic: () => ({ name: "Care Diagnostics" }) },
  { tag: "broken-logo", clinic: () => ({ name: "Care Diagnostics", logoDataUrl: "data:image/png;base64,AAAA" }) },
];

const report = [];

const browser = await playwright.chromium.launch();
const logo = await makeLogo(browser);

for (const c of cases) {
  for (const v of variants) {
    const html = buildStaffDayCloseSlipHtml(
      c.closure,
      v.clinic(logo),
      c.closure.userName,
    );
    const file = `${c.key}__${v.tag}.html`;
    writeFileSync(path.join(outDir, file), html);

    const page = await browser.newPage({
      viewport: { width: A5_W, height: A5_H },
      deviceScaleFactor: 2,
    });
    await page.goto(pathToFileURL(path.join(outDir, file)).href, {
      waitUntil: "networkidle",
    });
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(150);

    const m = await page.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          x: +b.x.toFixed(1),
          y: +b.y.toFixed(1),
          w: +b.width.toFixed(1),
          h: +b.height.toFixed(1),
        };
      };
      const img = document.querySelector("img.logo");
      return {
        top: r(".top"),
        logo: r("img.logo") || r(".logo-ph"),
        logoKind: img ? "img" : document.querySelector(".logo-ph") ? "placeholder" : "none",
        logoNatural: img ? { nw: img.naturalWidth, nh: img.naturalHeight, complete: img.complete } : null,
        h1: r(".brand h1"),
        slip: r(".slip"),
        formulaNote: r(".cols .note"),
        formulaNoteText: document.querySelector(".cols .note")?.textContent?.trim() ?? null,
        docHeight: document.documentElement.scrollHeight,
        bodyHeight: document.body.scrollHeight,
      };
    });

    const pdf = await page.pdf({
      width: "148mm",
      height: "210mm",
      printBackground: true,
      margin: { top: "6mm", bottom: "6mm", left: "6mm", right: "6mm" },
    });
    const shot = await page.screenshot({ fullPage: true, type: "png" });

    const base = `${c.key}__${v.tag}`;
    writeFileSync(path.join(outDir, `${base}.pdf`), pdf);
    writeFileSync(path.join(outDir, `${base}.png`), shot);

    // Count PDF pages by scanning for /Type /Page (not /Pages).
    const pdfStr = pdf.toString("latin1");
    const pageCount = (pdfStr.match(/\/Type\s*\/Page[^s]/g) || []).length;

    report.push({
      case: c.key,
      variant: v.tag,
      logoKind: m.logoKind,
      logoNatural: m.logoNatural,
      topRowHeight: m.top?.h ?? null,
      h1TopY: m.h1?.y ?? null,
      slipHeight: m.slip?.h ?? null,
      docHeight: m.docHeight,
      a5ContentHeightPx: A5_H - Math.round(12 * MM),
      overflowsA5: (m.slip?.h ?? 0) > A5_H - Math.round(12 * MM),
      pdfPages: pageCount,
      formulaNotePresent: m.formulaNote !== null,
      formulaNoteHeight: m.formulaNote?.h ?? null,
      pdfBytes: pdf.length,
    });
    await page.close();
  }
}
await browser.close();

writeFileSync(
  path.join(outDir, "measurements.json"),
  JSON.stringify({ cases: cases.map((c) => ({ key: c.key, label: c.label })), report }, null, 2),
);

console.log(`\nRendered ${report.length} variants into ${outDir}\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("case", 14) + pad("variant", 14) + pad("logo", 13) + pad("topH", 7) +
  pad("h1Y", 7) + pad("slipH", 8) + pad("docH", 7) + pad("overA5", 9) +
  pad("pages", 7) + pad("note", 7) + "noteH",
);
for (const r of report) {
  console.log(
    pad(r.case, 14) + pad(r.variant, 14) + pad(r.logoKind, 13) + pad(r.topRowHeight, 7) +
    pad(r.h1TopY, 7) + pad(r.slipHeight, 8) + pad(r.docHeight, 7) +
    pad(r.overflowsA5 ? "YES" : "no", 9) + pad(r.pdfPages, 7) +
    pad(r.formulaNotePresent ? "yes" : "no", 7) + (r.formulaNoteHeight ?? "-"),
  );
}
console.log("\nOpen tmp/staff-recon-preview/index.html to compare the renders.\n");

const idx = report
  .map(
    (r) =>
      `<h3>${r.case} · ${r.variant} · logo=${r.logoKind} · note=${r.formulaNotePresent ? "shown" : "hidden"}</h3>
       <img src="${r.case}__${r.variant}.png" />`,
  )
  .join("\n");
writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html><meta charset=utf-8><title>Staff reconciliation renders</title>
<body style="font-family:Arial;background:#eee;margin:0;padding:16px">
<h2>Staff reconciliation — measured renders (no server, no DB, no deploy)</h2>
${idx}</body>`,
);
