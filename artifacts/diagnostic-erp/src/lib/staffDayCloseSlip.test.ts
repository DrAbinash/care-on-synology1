import { describe, expect, test } from "vitest";
import { buildStaffDayCloseSlipHtml, type StaffSlipClosure } from "./staffDayCloseSlip";

const sample: StaffSlipClosure = {
  id: 42,
  userName: "Alice",
  closureDate: "2026-08-21",
  closedAt: "2026-08-21T12:00:00.000Z",
  coveredFromTs: "2026-08-21T04:00:00.000Z",
  coveredToTs: "2026-08-21T12:00:00.000Z",
  expectedCash: "158850",
  expectedUpi: "67000",
  expectedCard: "0",
  expectedCheque: "0",
  expectedOther: "0",
  totalExpected: "225850",
  totalBilled: "226700",
  totalDue: "0",
  billsCount: 3,
  paymentsCount: 4,
  actualCash: "158850",
  actualUpi: "67000",
  actualCard: "0",
  actualCheque: "0",
  actualOther: "0",
  totalActual: "225850",
  variance: "0",
  varianceNote: "",
  notes: "Handover OK",
  drawerStatus: "balanced",
  denominations: { d500: 100, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, coins: 0 },
  denominationTotal: "50000",
  printActivity: {
    dueReceived: 0,
    cancelledBillsAmount: 0,
    refundsAmount: 0,
    discountsGiven: 850,
    discountBills: [{
      billId: 1,
      billNumber: "B-1",
      patientName: "Pat",
      totalAmount: 900,
      discountGiven: 850,
      grossAmount: 1750,
      discountReason: "Staff",
      discountReasonNote: null,
    }],
    billEdits: [{ id: 9, billId: 1, billNumber: "B-1", changeType: "amount", reason: "correction", oldValue: "1000", newValue: "900", createdAt: "2026-08-21T10:00:00.000Z" }],
    voucherEdits: [],
    expenseDetails: [
      { id: 5, amount: 100, category: "Newspaper", description: "", paymentMode: "cash" },
      { id: 6, amount: 50, category: "Tea", description: "", paymentMode: "cash" },
    ],
    totalExpenses: 150,
    cashExpenses: 150,
    digitalExpenses: 0,
  },
};

describe("buildStaffDayCloseSlipHtml", () => {
  test("A5 compact slip: large logo, formula lines always shown, footer edits/discounts", () => {
    const html = buildStaffDayCloseSlipHtml(
      sample,
      { name: "Care Diagnostics", logoDataUrl: "data:image/png;base64,abc" },
      "Alice",
    );
    expect(html).toContain("@page { size: 148mm 210mm");
    expect(html).toContain("width: 90px");
    expect(html).toContain("Staff Reconciliation");
    expect(html).toContain("CARE DIAGNOSTICS");
    expect(html).toContain("Total Bill Gen");
    expect(html).toContain("Dues Collected");
    expect(html).toContain("Cancelled bills");
    expect(html).toContain("Outstanding");
    expect(html).toContain("Refunds");
    expect(html).toContain("Expense");
    expect(html).toContain("Expected");
    expect(html).toContain("500 × 100");
    expect(html).not.toContain("200 ×");
    expect(html).toContain("UPI");
    expect(html).toContain("CASH");
    expect(html).toContain("BILLS EDITED/MODIFIED → 1");
    expect(html).toContain("DISCOUNTS GIVEN → Rs.");
    expect(html).toContain("Newspaper");
    expect(html).toContain("Tea");
    expect(html).not.toContain("Test Wise Collection");
    expect(html).not.toContain("Method Reconciliation");
  });

  test("Suraj handwritten arithmetic: 247775 + 29700 − 550 − 4700 = 272225", () => {
    const html = buildStaffDayCloseSlipHtml(
      {
        ...sample,
        userName: "SURAJ JHA",
        totalBilled: 247775,
        totalDue: 4700,
        expectedUpi: 99075,
        expectedCash: 173150,
        printActivity: {
          ...sample.printActivity!,
          dueReceived: 29700,
          cancelledBillsAmount: 0,
          refundsAmount: 550,
          discountsGiven: 2375,
          totalExpenses: 0,
          expenseDetails: [],
          billEdits: [],
        },
      },
      { name: "Care Diagnostics" },
      "SURAJ JHA",
    );
    expect(html).toContain("2,47,775.00");
    expect(html).toContain("29,700.00");
    expect(html).toContain("2,77,475.00");
    expect(html).toContain("550.00");
    expect(html).toContain("4,700.00");
    expect(html).toContain("2,72,225.00");
    expect(html).toContain("99,075.00");
    expect(html).toContain("1,73,150.00");
    expect(html).toContain("DISCOUNTS GIVEN → Rs. 2,375.00");
    expect(html).toContain("line emphasize");
    // The explanatory formula box used to print only when dues were non-zero,
    // which made two slips from one system read as two different reports.
    expect(html).not.toContain("Expected = Bill Gen");
  });

  test("a dues slip and a no-dues slip carry the same rows in the same order", () => {
    const branding = { name: "Care Diagnostics", logoDataUrl: "data:image/png;base64,abc" };
    const withDues = buildStaffDayCloseSlipHtml(
      { ...sample, userName: "SURAJ JHA", printActivity: { ...sample.printActivity!, dueReceived: 13700 } },
      branding,
      "SURAJ JHA",
    );
    const noDues = buildStaffDayCloseSlipHtml(
      { ...sample, userName: "VIJAY YADAV", printActivity: { ...sample.printActivity!, dueReceived: 0 } },
      branding,
      "VIJAY YADAV",
    );
    const rows = (html: string) =>
      [...html.matchAll(/<span class="lbl">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(rows(withDues)).toEqual(rows(noDues));
    expect(withDues).not.toContain("Expected = Bill Gen");
    expect(noDues).not.toContain("Expected = Bill Gen");
  });

  test("missing branding prints no letterhead and no placeholder box", () => {
    const html = buildStaffDayCloseSlipHtml(sample, { name: "Care Diagnostics" }, "Alice");
    expect(html).not.toContain("logo-ph");
    expect(html).not.toContain("LOGO");
    expect(html).not.toContain("<img");
    expect(html).toContain("CARE DIAGNOSTICS");
  });

  test("header is held clear of the printer's non-printable top band", () => {
    const html = buildStaffDayCloseSlipHtml(sample, {}, "Alice");
    expect(html).toContain("margin: 12mm 6mm 6mm");
    expect(html).toContain("padding-top: 3mm");
  });

  test("24-Sep Suraj-style bridge: Bill Gen 132900 + Dues 3000 = Expected 135900", () => {
    const html = buildStaffDayCloseSlipHtml(
      {
        ...sample,
        userName: "SURAJ JHA",
        totalBilled: 132900,
        totalDue: 0,
        expectedUpi: 57500,
        expectedCash: 78400,
        totalExpected: 135900,
        totalActual: 135900,
        variance: 0,
        printActivity: {
          ...sample.printActivity!,
          dueReceived: 3000,
          cancelledBillsAmount: 0,
          refundsAmount: 0,
          discountsGiven: 2450,
          totalExpenses: 0,
          expenseDetails: [],
          billEdits: [],
        },
      },
      { name: "Care Diagnostics" },
      "SURAJ JHA",
    );
    expect(html).toContain("1,32,900.00");
    expect(html).toContain("3,000.00");
    expect(html).toContain("1,35,900.00");
    expect(html).toContain("57,500.00");
    expect(html).toContain("78,400.00");
    expect(html).toContain("line emphasize");
  });
});

/**
 * The paper the cashier signs is the record. On 2026-10-13 two things went wrong
 * on it at once: a drawer nobody counted printed "Balanced — no variance", because
 * that line branched on the number and not on the status; and a window that opened
 * on the 6th and closed on the 7th printed the start DATE plus the end TIME — and
 * the end time is the same instant already printed as the header — so Vijay read
 * one slip as a reconciliation "of the 7th and the 6th".
 */
describe("staff slip honesty: verification and window", () => {
  const branding = { name: "Care Diagnostics" };

  const windowLine = (html: string) =>
    html.match(/<div class="window">([^<]*)<\/div>/)?.[1] ?? "";
  const headerLine = (html: string) =>
    html.match(/<div class="when">([^<]*)<\/div>/)?.[1] ?? "";

  test("an un-counted drawer does not print Balanced", () => {
    const html = buildStaffDayCloseSlipHtml(
      { ...sample, drawerStatus: "not_physically_verified" },
      branding,
      "Alice",
    );
    expect(html).toContain("Not Physically Verified — the cash was not counted");
    expect(html).not.toContain("Balanced — no variance");
    // The footer carries the human words, never the snake_case column value.
    expect(html).not.toContain("not_physically_verified");
  });

  test("a counted drawer still prints Balanced", () => {
    const html = buildStaffDayCloseSlipHtml(sample, branding, "Alice");
    expect(html).toContain("Balanced — no variance");
    expect(html).not.toContain("Not Physically Verified");
  });

  test("a mismatch prints the variance whatever was asserted about the count", () => {
    const html = buildStaffDayCloseSlipHtml(
      { ...sample, drawerStatus: "mismatch", variance: "-500", totalActual: "225350" },
      branding,
      "Alice",
    );
    expect(html).toContain("Variance short: 500.00");
    expect(html).not.toContain("Balanced");
  });

  test("the window prints as one span, with both dates and both times", () => {
    const html = buildStaffDayCloseSlipHtml(sample, branding, "Alice");
    const line = windowLine(html);
    expect(line).toMatch(/^Reconciles /);
    expect(line).toContain("→");
    // Two endpoints, each a full date+time — not a date on one end and a bare
    // time on the other.
    expect((line.match(/21 Aug 2026/g) ?? []).length).toBe(2);
    expect((line.match(/am|pm/g) ?? []).length).toBe(2);
  });

  test("a carry-forward window reads as one window, not as two reports", () => {
    // The live case: closed on the 13th for a window that opened on the 6th.
    const html = buildStaffDayCloseSlipHtml(
      {
        ...sample,
        userName: "VIJAY YADAV",
        closureDate: "2026-10-13",
        closedAt: "2026-10-13T13:00:00.000Z",
        coveredFromTs: "2026-10-06T06:30:00.000Z",
        coveredToTs: "2026-10-13T13:00:00.000Z",
      },
      branding,
      "VIJAY YADAV",
    );
    const line = windowLine(html);
    expect(line).toContain("06 Oct 2026");
    expect(line).toContain("13 Oct 2026");
    expect(line.indexOf("06 Oct 2026")).toBeLessThan(line.indexOf("13 Oct 2026"));
    // The header is the close instant and nothing else: no second date appended
    // to it that could be mistaken for a second reconciliation.
    expect(headerLine(html)).toContain("13 Oct 2026");
    expect(headerLine(html)).not.toContain("06 Oct 2026");
    expect(headerLine(html)).not.toContain("→");
  });

  test("a first close says it covers everything to date", () => {
    const html = buildStaffDayCloseSlipHtml(
      { ...sample, coveredFromTs: null },
      branding,
      "Alice",
    );
    expect(windowLine(html)).toMatch(/First close/i);
    expect(windowLine(html)).toContain("→");
    // Never a bare dash where a boundary should be.
    expect(windowLine(html)).not.toMatch(/—\s*→/);
  });
});
