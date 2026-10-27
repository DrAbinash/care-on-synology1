import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import {
  buildExcelWorkbook,
  isAmountHeader,
  parseMoneyCell,
  type ExportConfig,
} from "@/components/SummaryExport";

/** Walk the zip central directory and return every entry as text. */
function zipEntries(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  for (;;) {
    const idx = buf.indexOf("PK\u0001\u0002", i, "latin1");
    if (idx < 0) break;
    const method = buf.readUInt16LE(idx + 10);
    const compSize = buf.readUInt32LE(idx + 20);
    const nameLen = buf.readUInt16LE(idx + 28);
    const localOff = buf.readUInt32LE(idx + 42);
    const name = buf.toString("latin1", idx + 46, idx + 46 + nameLen);
    const ln = buf.readUInt16LE(localOff + 26);
    const el = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + ln + el;
    const raw = buf.subarray(start, start + compSize);
    out[name] = (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
    i = idx + 46 + nameLen;
  }
  return out;
}

const config: ExportConfig = {
  title: "Daily Financial Reconciliation",
  subtitle: "Today - All Staff",
  clinicName: "Care Diagnostics",
  logoDataUrl: null,
  sections: [
    {
      title: "Billing",
      metrics: [
        ["Total Bills Generated (after discount)", "Rs.1,20,000"],
        ["Walk-in bills", "Rs.90,000"],
        ["Staff on duty", "6"],
        ["", ""],
        ["Variance", "Balanced (0)"],
        ["Expected Physical Cash", "Rs.1,13,000"],
      ],
    },
    {
      title: "Deductions",
      metrics: [["Cancelled / refunded bills", "-Rs.5,000"], ["Total Deductions", "Rs.7,000"]],
    },
  ],
  tables: [
    {
      title: "Payments collected by me",
      headers: ["Bill #", "Patient", "Method", "Amount"],
      rows: [
        ["0042", "Asha R", "Cash", "Rs.1,500"],
        ["VB-0043", "Bilu S", "UPI", "Rs.2,200"],
        ["Total", "", "", "Rs.3,700"],
      ],
    },
  ],
  simpleLedger: [
    { label: "Date / Period", value: "08 Oct 2026", kind: "meta" },
    { label: "Total Bills Generated", value: "Rs.1,20,000", kind: "line" },
    { label: "", value: "", kind: "blank" },
    { label: "Old dues collected", value: "Rs.2,000", kind: "add" },
    { label: "Cancelled", value: "-Rs.5,000", kind: "subtract" },
    { label: "Cash in counter", value: "Rs.1,13,000", kind: "total", detail: "expected" },
  ],
};

function writeBook(mode: "full" | "simple") {
  const wb = buildExcelWorkbook(config, mode);
  return zipEntries(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as unknown as Buffer);
}

describe("the .xlsx actually carries formatting", () => {
  // SheetJS Community accepts `cell.s` and throws it away. The operator's own export was
  // measured at 2 fills / 1 border / 2 cellXfs, which is what a blank workbook carries, so
  // these thresholds are the difference between styled and decorative.
  it("writes fills, border weights and a rupee number format", () => {
    const files = writeBook("full");
    const styles = files["xl/styles.xml"];
    expect(styles).toBeDefined();
    expect((styles.match(/<fill>/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(styles).toContain('patternType="solid"');
    expect(styles).toContain('fgColor rgb="FF0F172A"');
    expect((styles.match(/<border>/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(styles).toContain('style="medium"');
    expect(styles).toContain('style="thick"');
    expect(styles).toMatch(/numFmt numFmtId="1[0-9]+" formatCode="&quot;₹&quot;##,##0"/);
    expect((styles.match(/<xf /g) ?? []).length).toBeGreaterThan(6);
  });

  it("the sheets reference those styles instead of the default", () => {
    const files = writeBook("full");
    const sheets = Object.entries(files).filter(([n]) => n.startsWith("xl/worksheets/"));
    expect(sheets.length).toBe(2);
    const styleIdx = sheets.flatMap(([, xml]) => (xml.match(/s="[0-9]+"/g) ?? [])).map((s) => Number(s.replace(/\D/g, "")));
    expect(styleIdx.length).toBeGreaterThan(20);
    expect(Math.max(...styleIdx)).toBeGreaterThan(3);
  });

  it("money is a number Excel can total, in lakh grouping", () => {
    const files = writeBook("full");
    const all = Object.values(files).join("");
    expect(all).toContain("<v>120000</v>");
    expect(all).toContain("<v>-5000</v>");
    // The currency *text* must be gone from the amount cells: a total that Excel cannot add
    // up is the difference between a report and a picture of one.
    expect(all).not.toContain("<v>Rs.1,20,000</v>");
  });

  it("a digit-only bill number is still text, so its leading zero survives", () => {
    const files = writeBook("full");
    const all = Object.values(files).join("");
    expect(all).toMatch(/t="str"><v>0042<\/v>/);
    expect(all).not.toContain("<v>42</v>");
  });

  it("gives each table a filter row, merged titles and real column widths", () => {
    const files = writeBook("full");
    const table = files["xl/worksheets/sheet2.xml"];
    expect(table).toMatch(/<autoFilter ref="A[0-9]+:D[0-9]+"/);
    expect(table).toMatch(/<col min="1" max="1" width="[0-9.]+"/);
    expect(table).toContain("<mergeCell ref=");
    expect(table).toMatch(/<row [^>]*ht="/);
  });

  it("colour-codes the one-page ledger by what each row means", () => {
    const files = writeBook("simple");
    const styles = files["xl/styles.xml"];
    expect(styles).toContain('fgColor rgb="FFDCFCE7"');
    expect(styles).toContain('fgColor rgb="FFFEE2E2"');
    expect(styles).toContain('fgColor rgb="FF0F172A"');
    expect(files["xl/worksheets/sheet1.xml"]).toContain("<v>113000</v>");
    expect(Object.values(files).join("")).toContain("Bills + Old Dues");
  });
});

describe("money detection is exact, because it changes the stored type", () => {
  it("reads every shape the screens produce", () => {
    expect(parseMoneyCell("Rs.1,20,000")).toBe(120000);
    expect(parseMoneyCell("-Rs.5,000")).toBe(-5000);
    expect(parseMoneyCell("₹1,234")).toBe(1234);
    expect(parseMoneyCell("Rs. 999")).toBe(999);
    expect(parseMoneyCell("−Rs.500")).toBe(-500);
    expect(parseMoneyCell("Rs.12.50")).toBe(12.5);
  });

  it("refuses anything that is not a currency string", () => {
    for (const raw of ["1234", "0042", "Balanced (0)", "6 bills", "Paid", "", "Cash", "Dr. Rao", "N/A", 42, null, undefined]) {
      expect(parseMoneyCell(raw)).toBe(null);
    }
  });

  it("recognises the amount columns by header", () => {
    for (const h of ["Amount", "Net Cash", "Gross Billed", "Refund", "Due", "Expense", "Collected", "Discount"]) {
      expect(isAmountHeader(h)).toBe(true);
    }
    for (const h of ["Bill #", "Patient", "Doctor", "Method", "Status", "Token", "Phone"]) {
      expect(isAmountHeader(h)).toBe(false);
    }
  });
});
