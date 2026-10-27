import { inflateRawSync, inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSectionTableData,
  buildSimplePdf,
  buildSummaryPdf,
  logoRasterTargetPx,
  type ExportConfig,
} from "@/components/SummaryExport";

const config: ExportConfig = {
  title: "Daily Financial Reconciliation",
  subtitle: "Today - All Staff",
  clinicName: "Care Diagnostics",
  logoDataUrl: null,
  sections: Array.from({ length: 6 }, (_, i) => ({
    title: i === 2 ? "Cash Reconciliation" : `Section ${i}`,
    layout: i === 2 ? ("full" as const) : ("half" as const),
    metrics: Array.from({ length: 12 }, (_, j) =>
      j === 10 ? ["Total Deductions", `Rs.${900 + j}`]
        : j === 11 ? ["Expected Physical Cash", `Rs.${1000 + j}`]
          : [`Line ${j}`, `Rs.${1000 + j}`] as [string, string]),
  })),
  tables: [
    {
      title: "Payments collected by me",
      headers: ["Bill #", "Patient", "Doctor", "Method", "Amount"],
      rows: [
        ...Array.from({ length: 30 }, (_, j) => [`VB-${j}`, "Patient Name", "Dr Who", "Cash", `Rs.${500 + j}`]),
        ["Total", "", "", "", "Rs.16,000"],
      ],
    },
  ],
};

/** jsPDF writes compressed page streams; inflate every stream so the page content is readable. */
function inflateStreams(doc: { output: (t: string) => unknown }): { buf: Buffer; text: string } {
  const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
  const raw = buf.toString("latin1");
  const parts: string[] = [];
  let i = 0;
  for (;;) {
    const start = raw.indexOf("stream", i);
    if (start < 0) break;
    const from = raw[start + 6] === "\r" ? start + 8 : start + 7;
    const end = raw.indexOf("endstream", from);
    if (end < 0) break;
    const bytes = buf.subarray(from, end);
    try {
      parts.push(inflateSync(bytes).toString("latin1"));
    } catch {
      try { parts.push(inflateRawSync(bytes).toString("latin1")); } catch { /* image or uncompressed */ }
    }
    i = end + 9;
  }
  return { buf, text: parts.join("\n") };
}

function pageText(doc: { output: (t: string) => unknown }): string {
  const { buf, text } = inflateStreams(doc);
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(text.length).toBeGreaterThan(2000);
  expect(buf.byteLength).toBeLessThan(text.length);
  return text;
}

describe("the PDF is a compressed document, not a dump", () => {
  it("deflates its content, so a page of text is not a megabyte", async () => {
    const doc = await buildSummaryPdf(config, "landscape");
    const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
    expect(buf.toString("latin1")).toContain("/FlateDecode");
    // Measured 2026-10-09: 11.5 KB for this 3-page fixture. The operator's own one-page
    // Simple PDF was 2,000,094 bytes with zero compressed streams.
    expect(buf.byteLength).toBeLessThan(40_000);
  });

  it("draws a running head and a numbered footer on every page", async () => {
    const doc = await buildSummaryPdf(config, "portrait");
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    const text = pageText(doc);
    expect(text).toContain("(Daily Financial Reconciliation)");
    for (let p = 1; p <= pages; p++) {
      expect(text).toContain(`(Page ${p} of ${pages})`);
    }
    // The title appears once for page 1's tall band and again for each continuation band.
    expect(text.split("(Daily Financial Reconciliation)").length - 1).toBeGreaterThanOrEqual(pages);
  });

  it("rules a total heavier than the formula above it", async () => {
    const doc = await buildSummaryPdf(config, "landscape");
    const text = pageText(doc);
    // The document is drawn in mm but jsPDF writes stroke widths in points, so the
    // comparison has to be converted back: 0.12 / 0.55 / 0.9 mm are the three weights the
    // renderer defines, and a report where every rule is one hairline cannot pass this.
    const widthsMm = strokeWidthsMm(text);
    expect(widthsMm.includes(0.12)).toBe(true);
    expect(widthsMm.includes(0.55)).toBe(true);
    expect(widthsMm.includes(0.9)).toBe(true);
    expect(Math.max(...widthsMm)).toBe(0.9);
  });
});

describe("the ledger rows the PDF draws", () => {
  it("marks the two answer kinds with the heavy rule and a bigger size", () => {
    const { rowStyles } = buildSectionTableData({
      title: "Cash Reconciliation",
      metrics: [
        ["Total Bills Generated (after discount)", "Rs.1,20,000"],
        ["Cancelled / refunded bills", "-Rs.5,000"],
        ["Variance", "Balanced (0)"],
        ["Expected Physical Cash", "Rs.1,13,000"],
        ["Walk-in bills", "Rs.90,000"],
      ],
    });
    expect(rowStyles.map((r) => [r.finalRule ?? false, r.totalRule ?? false, r.fontSize])).toEqual([
      [false, true, 8.5],
      [false, false, 8],
      [false, false, 8],
      [true, false, 10.5],
      [false, false, 8],
    ]);
  });

  it("paints the answer row navy with a green total, never pink", () => {
    const { bodyRows, rowStyles } = buildSectionTableData({
      title: "Cash Reconciliation",
      metrics: [["Expected Physical Cash", "Rs.1,13,000"], ["Variance", "Short by 40"]],
    });
    expect(rowStyles[0].fillColor).toEqual([15, 23, 42]);
    expect(rowStyles[0].textColor).toEqual([255, 255, 255]);
    expect(rowStyles[0].valueColor).toEqual([134, 239, 172]);
    expect(bodyRows[0][0]).toBe("=");
    expect(rowStyles[1].fillColor).toEqual([254, 226, 226]);
  });

  it("keeps the sign column honest", () => {
    const { bodyRows } = buildSectionTableData({
      title: "Billing",
      metrics: [["Cancelled bills", "-Rs.5"], ["Total Bills", "Rs.5"], ["Discount info", "Rs.1"], ["Walk-in", "Rs.2"]],
    });
    expect(bodyRows.map((r) => r[0])).toEqual(["-", "=", "i", ""]);
  });
});

describe("the logo cannot bloat the page again", () => {
  it("rasterises to the size it is drawn at", () => {
    expect(logoRasterTargetPx(22, 11)).toEqual({ w: 88, h: 44 });
    expect(logoRasterTargetPx(11, 11)).toEqual({ w: 44, h: 44 });
    expect(logoRasterTargetPx(300, 150)).toEqual({ w: 160, h: 80 });
  });

  it("embeds the downscaled image, not the file the settings page sent", () => {
    const src = readFileSync(resolve(import.meta.dirname, "SummaryExport.tsx"), "utf8");
    expect(src).toContain("doc.addImage(logo.url");
    expect(src).not.toMatch(/addImage\(\s*(smallDataUrl|config\.logoDataUrl)\s*,/);
    expect((src.match(/compress: true/g) ?? []).length).toBe(2);
  });
});

const PT_PER_MM = 2.8346456692913388;

/** The one page the counter prints at the end of a shift. */
const simpleConfig: ExportConfig = {
  title: "Daily Financial Reconciliation",
  subtitle: "Today - All Staff",
  clinicName: "Care Diagnostics",
  logoDataUrl: null,
  sections: [],
  tables: [],
  simpleLedger: [
    { label: "Date / Period", value: "Today", kind: "meta" },
    { label: "Total Bills Generated (after discount)", value: "Rs.1,20,000", kind: "line" },
    { label: "+ Old Dues Collected", value: "Rs.2,000", kind: "add" },
    { label: "TOTAL", value: "Rs.1,22,000", kind: "subtotal" },
    {
      label: "− Cancels / Refunds / Outstanding",
      value: "Rs.7,000",
      kind: "subtract",
      detail: "Cancel Rs.1,000 + Refund Rs.4,000 + Dues Rs.2,000",
    },
    { label: "COLLECTIBLE", value: "Rs.1,15,000", kind: "subtotal" },
    { label: "− UPI / Digital (net)", value: "Rs.40,000", kind: "subtract" },
    { label: "CASH IN COUNTER", value: "Rs.73,000", kind: "total" },
    { label: "Variance", value: "Rs.2,000 mismatch", kind: "note" },
  ],
};

function strokeWidthsMm(text: string): number[] {
  return [...new Set([...text.matchAll(/([0-9.]+)\s+w\b/g)].map((m) => Math.round((Number(m[1]) / PT_PER_MM) * 100) / 100))];
}

function strokeCountsMm(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of text.matchAll(/([0-9.]+)\s+w\b/g)) {
    const mm = Math.round((Number(m[1]) / PT_PER_MM) * 100) / 100;
    out.set(mm, (out.get(mm) ?? 0) + 1);
  }
  return out;
}

function paintsColor(text: string, rgb: [number, number, number]): boolean {
  return [...text.matchAll(/([0-9.]+) ([0-9.]+) ([0-9.]+) rg/g)].some((m) =>
    rgb.every((c, i) => Math.abs(Number(m[i + 1]) - c / 255) < 0.01),
  );
}

describe("the Simple one-page ledger PDF", () => {
  it("is compressed, so the shift handover is not two megabytes", async () => {
    const doc = await buildSimplePdf(simpleConfig, "portrait");
    const { buf, text } = inflateStreams(doc);
    expect(doc.getNumberOfPages()).toBe(1);
    expect(buf.toString("latin1")).toContain("/FlateDecode");
    // Measured 2026-10-09 on the operator's own Daily_Financial_Reconciliation_Simple (4).pdf:
    // 2,000,094 bytes for one page, with no compressed stream in it at all.
    expect(buf.byteLength).toBeLessThan(40_000);
    expect(text.length).toBeGreaterThan(buf.byteLength);
  });

  it("keeps the orientation the toolbar remembered", async () => {
    const portrait = await buildSimplePdf(simpleConfig, "portrait");
    const landscape = await buildSimplePdf(simpleConfig, "landscape");
    expect(portrait.internal.pageSize.getHeight()).toBeGreaterThan(portrait.internal.pageSize.getWidth());
    expect(landscape.internal.pageSize.getWidth()).toBeGreaterThan(landscape.internal.pageSize.getHeight());
  });

  it("stands the final answer out from the subtotals", async () => {
    const text = inflateStreams(await buildSimplePdf(simpleConfig, "portrait")).text;
    const widths = strokeWidthsMm(text);
    expect(widths).toContain(0.15);
    expect(widths).toContain(0.6);
    expect(widths).toContain(1);
    expect(Math.max(...widths)).toBe(1);
    // The heaviest stroke has to be the answer row's own box, not just the rectangle drawn
    // around the card: two cells ruled top and bottom put it well past the single card edge.
    const counts = strokeCountsMm(text);
    expect(counts.get(0.15)).toBeGreaterThan(20);
    expect(counts.get(0.6) ?? 0).toBeGreaterThanOrEqual(2);
    expect(counts.get(1) ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("paints CASH IN COUNTER navy with a green figure, and the deduction in red", async () => {
    const text = inflateStreams(await buildSimplePdf(simpleConfig, "portrait")).text;
    expect(paintsColor(text, [15, 23, 42])).toBe(true);
    expect(paintsColor(text, [134, 239, 172])).toBe(true);
    expect(paintsColor(text, [254, 226, 226])).toBe(true);
    expect(paintsColor(text, [185, 28, 28])).toBe(true);
  });

  it("writes the identity the cashier is argued with, and numbers the page", async () => {
    const doc = await buildSimplePdf(simpleConfig, "portrait");
    // PDF string literals escape ( and ), which is syntax rather than content.
    const text = inflateStreams(doc).text.replace(/\\/g, "");
    expect(text).toContain("Bills + Old Dues - (Cancel+Refund+Outstanding) - Digital = Cash in counter");
    expect(text).toContain("(Page 1 of 1)");
  });
});
