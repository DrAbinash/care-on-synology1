import { inflateRawSync, inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSectionTableData,
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
      j === 11 ? ["Expected Physical Cash", `Rs.${1000 + j}`] : [`Line ${j}`, `Rs.${1000 + j}`] as [string, string]),
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
function pageText(doc: { output: (t: string) => unknown }): string {
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
  const text = parts.join("\n");
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
    const widths = [...text.matchAll(/([0-9.]+)\s+w\b/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(10);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(0.9);
    expect(widths.filter((w) => w >= 0.5).length).toBeGreaterThan(0);
    expect(widths.filter((w) => w <= 0.2).length).toBeGreaterThan(0);
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
