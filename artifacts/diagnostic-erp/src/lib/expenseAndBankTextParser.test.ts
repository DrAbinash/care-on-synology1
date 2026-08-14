import { describe, expect, it } from "vitest";
import { parseBankStatementText } from "./bankStatementTextParser";
import { parseExpenseBillText } from "./expenseBillTextParser";

describe("parseBankStatementText", () => {
  it("parses comma rows with dates", () => {
    const rows = parseBankStatementText("Date,Desc,Dr,Cr,Bal\n01-08-2026,UPI rent,12000,0,88000");
    expect(rows).toHaveLength(1);
    expect(rows[0].debit).toBe(12000);
    expect(rows[0].date).toBe("2026-08-01");
  });
});

describe("parseExpenseBillText", () => {
  it("pulls a total from invoice-like OCR text", () => {
    const parsed = parseExpenseBillText("ABC Medicals\nInvoice No: 12\nDate: 01-08-2026\nGrand Total 1500.00\nGST 180.00");
    expect(parsed.amount).toBeGreaterThan(0);
    expect(parsed.ocrProvider).toBe("tesseract");
  });
});
