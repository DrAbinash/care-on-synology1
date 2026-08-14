import { describe, expect, it } from "vitest";
import { parseBankCsvOrText, normalizeDate } from "./localDocumentOcr";

describe("parseBankCsvOrText", () => {
  it("parses Indian CSV-style rows", () => {
    const text = [
      "Date,Narration,Debit,Credit,Balance",
      "12-08-2026,NEFT SALARY CARE,0,50000,150000",
      "13-08-2026,UPI RENT,25000,0,125000",
    ].join("\n");
    const rows = parseBankCsvOrText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].credit).toBe(50000);
    expect(rows[1].debit).toBe(25000);
    expect(rows[0].date).toBe("2026-08-12");
  });
});

describe("normalizeDate", () => {
  it("converts DMY to ISO", () => {
    expect(normalizeDate("14/08/26")).toBe("2026-08-14");
  });
});
