import { describe, expect, test } from "vitest";

import {
  buildBillsRegisterExport,
  type BillsRegisterRow,
  type BillsRegisterTotals,
} from "./billsRegisterExport";

/**
 * The reason this file exists: the Dues page ships a "Due Payments Report" built
 * from the 50 rows it happens to have in memory while quoting the server's
 * full-set totals, so the document understates money. The register below must
 * never do that quietly — either every matching bill is in it, or it says so.
 */

const totals = (over: Partial<BillsRegisterTotals> = {}): BillsRegisterTotals => ({
  totalAmount: 400000,
  paidAmount: 350000,
  balanceAmount: 50000,
  refundAmount: 5000,
  matchedRows: 2,
  ...over,
});

const bill = (over: Partial<BillsRegisterRow> = {}): BillsRegisterRow => ({
  billNumber: "2026110001",
  status: "paid",
  createdAt: "2026-11-04T09:30:00.000Z",
  totalAmount: 2000,
  paidAmount: 2000,
  balanceAmount: 0,
  discount: 0,
  createdByName: "Front Desk One",
  patient: { firstName: "Anita", lastName: "Verma", patientId: "UH-0001" },
  order: { orderNumber: "ORD-1001", doctor: { name: "Dr. Rao" }, testNames: ["CBC", "LFT"] },
  ...over,
});

const cfg = (rows: BillsRegisterRow[], t: BillsRegisterTotals) =>
  buildBillsRegisterExport(rows, t, { rangeLabel: "1 Nov 2026 – 30 Nov 2026" });

const metricLabels = (c: ReturnType<typeof cfg>) =>
  c.sections.flatMap((s) => s.metrics.map(([label]) => label));
const findMetric = (c: ReturnType<typeof cfg>, label: string) =>
  c.sections.flatMap((s) => s.metrics).find(([l]) => l === label)?.[1];

describe("Bill Collection Register export", () => {
  test("a complete filter yields a clean document: every row, no partial flags", () => {
    const c = cfg([bill(), bill({ billNumber: "2026110002" })], totals());
    expect(c.subtitle).not.toContain("PARTIAL");
    expect(metricLabels(c)).not.toContain("INCOMPLETE");
    expect(c.tables[0]!.rows).toHaveLength(2);
    expect(findMetric(c, "Bills in this document")).toBe("2");
  });

  test("a capped fetch is labelled PARTIAL and names both counts instead of silently shortening", () => {
    const c = cfg([bill()], totals({ matchedRows: 3627 }));
    expect(c.subtitle).toContain("PARTIAL");
    expect(c.subtitle).toContain("1 of 3,627");
    const warning = findMetric(c, "INCOMPLETE");
    expect(warning).toContain("3,627");
    expect(warning).toContain("narrow the date range");
    // The rows table still only has the one row that was actually fetched.
    expect(c.tables[0]!.rows).toHaveLength(1);
  });

  test("money figures come from the server's full-set totals, not from the fetched rows", () => {
    // One ₹2,000 row against clinic-wide totals of ₹4 lakh: a document that
    // summed the rows would print 2,000 and the owner would read it as the day's
    // collection. The totals must survive the truncation.
    const c = cfg([bill()], totals({ matchedRows: 3627 }));
    expect(findMetric(c, "Total Billed")).toBe("Rs.4,00,000");
    expect(findMetric(c, "Collected")).toBe("Rs.3,50,000");
    expect(findMetric(c, "Balance Outstanding")).toBe("Rs.50,000");
  });

  test("refunds, discounts and cancelled value are derived from the rows", () => {
    // refundAmount arrives from the API as a numeric STRING ("1500.00"), so a
    // naive `+` would concatenate rather than add.
    const c = cfg(
      [
        bill({ refundAmount: "1500.00" as unknown as number, discount: 200 }),
        bill({ billNumber: "2026110002", refundAmount: 500, discount: 300 }),
        bill({ billNumber: "2026110003", status: "cancelled", totalAmount: 5000 }),
      ],
      totals({ matchedRows: 3 }),
    );
    expect(findMetric(c, "Refunds Against Bills")).toBe("Rs.2,000");
    expect(findMetric(c, "Discounts Given")).toBe("Rs.500");
    expect(findMetric(c, "Cancelled Bills (value, not collectible)")).toBe("Rs.5,000");
  });

  test("no rupee sign reaches the document — jsPDF's Helvetica fonts cannot render it", () => {
    const c = cfg([bill(), bill({ status: "cancelled", balanceAmount: -250 })], totals());
    const serialized = JSON.stringify(c);
    expect(serialized).not.toContain("₹");
    expect(serialized).toContain("Rs.");
  });

  test("absent patient / order / referral render as an em dash, never as 'undefined'", () => {
    const c = cfg([bill({ patient: null, order: null, createdByName: null })], totals());
    const row = c.tables[0]!.rows[0]!;
    expect(row).not.toContain("undefined");
    expect(row[2]).toBe("—"); // Patient
    expect(row[3]).toBe("—"); // UHID
    expect(row[4]).toBe("—"); // Order
    expect(row[5]).toBe("—"); // Referral Doctor
    expect(row[7]).toBe("—"); // Billed By
  });

  test("the register carries the columns a collections document is audited on", () => {
    const c = cfg([bill()], totals());
    expect(c.tables[0]!.headers).toEqual([
      "Bill No", "Date", "Patient", "UHID", "Order", "Referral Doctor",
      "Tests", "Billed By", "Status", "Billed", "Paid", "Balance",
    ]);
    const row = c.tables[0]!.rows[0]!;
    expect(row[0]).toBe("2026110001");
    expect(row[3]).toBe("UH-0001");
    expect(row[5]).toBe("Dr. Rao");
    expect(row[6]).toBe("CBC, LFT");
    expect(row[11]).toBe("Rs.0");
  });

  test("every active filter is recorded in the document, and unset ones are not", () => {
    const full = buildBillsRegisterExport([bill()], totals(), {
      rangeLabel: "Today",
      status: "paid",
      createdBy: "Front Desk One",
      referralDoctor: "Dr. Rao",
      test: "CBC",
      search: "anita",
    });
    expect(findMetric(full, "Status filter")).toBe("paid");
    expect(findMetric(full, "Billed by")).toBe("Front Desk One");
    expect(findMetric(full, "Referral filter")).toBe("Dr. Rao");
    expect(findMetric(full, "Test filter")).toBe("CBC");
    expect(findMetric(full, "Search")).toContain("anita");

    const bare = cfg([bill()], totals());
    expect(metricLabels(bare)).not.toContain("Billed by");
    expect(metricLabels(bare)).not.toContain("Referral filter");
    expect(metricLabels(bare)).not.toContain("Test filter");
    expect(metricLabels(bare)).not.toContain("Search");
    expect(findMetric(bare, "Status filter")).toBe("All statuses");
  });

  test("an empty filter result still produces a valid, zeroed document", () => {
    const c = cfg([], totals({ totalAmount: 0, paidAmount: 0, balanceAmount: 0, refundAmount: 0, matchedRows: 0 }));
    expect(c.tables[0]!.rows).toHaveLength(0);
    expect(c.subtitle).not.toContain("PARTIAL");
    expect(findMetric(c, "Bills in this document")).toBe("0");
    expect(findMetric(c, "Balance Outstanding")).toBe("Rs.0");
  });
});
