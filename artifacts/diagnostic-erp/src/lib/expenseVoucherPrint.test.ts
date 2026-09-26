import { describe, expect, it } from "vitest";
import {
  amountInIndianRupeesWords,
  buildExpenseVoucherHtml,
  resolveExpenseVoucherPaper,
} from "./expenseVoucherPrint";
import type { ExpensePaymentRow, ExpenseV2 } from "@/components/expenses/expenseTypes";

describe("amountInIndianRupeesWords", () => {
  it("formats common voucher amounts", () => {
    expect(amountInIndianRupeesWords(700)).toBe("Rupees Seven Hundred Only");
    expect(amountInIndianRupeesWords(2100)).toBe("Rupees Two Thousand One Hundred Only");
    expect(amountInIndianRupeesWords(1050)).toBe("Rupees One Thousand Fifty Only");
    expect(amountInIndianRupeesWords(0)).toBe("Rupees Zero Only");
    expect(amountInIndianRupeesWords(20_000)).toBe("Rupees Twenty Thousand Only");
  });
});

describe("expense voucher A5 bill-desk paper", () => {
  it("follows clinic bill format onto A5 (not A4) for short vouchers", () => {
    const classic = resolveExpenseVoucherPaper({
      name: "Care Diagnostics",
      billPrintSettingsJson: JSON.stringify({ defaultFormat: "classic" }),
    });
    expect(classic.paper).toBe("A5-landscape");
    expect(classic.pageOpts.paperSize).toBe("A5");

    const hope = resolveExpenseVoucherPaper({
      name: "Care Diagnostics",
      billPrintSettingsJson: JSON.stringify({ defaultFormat: "hope-a5" }),
    });
    expect(hope.paper).toBe("A5-portrait");
  });
});

describe("buildExpenseVoucherHtml", () => {
  const base: ExpenseV2 = {
    id: 1,
    expenseId: "EXP-TEST-RAJU",
    category: "maintenance",
    description: "Electrical repair – MRI room",
    amount: 700,
    billAmount: 700,
    expenseDate: "2026-09-26",
    paymentMode: "cash",
    paymentStatus: "PAID",
    accountingStatus: "POSTED",
    paidTo: "RAJU ELECTRICIAN",
    vendorNameSnapshot: "RAJU ELECTRICIAN",
    approvedBy: "Dr Abinash Kumar",
    metaJson: JSON.stringify({
      workType: "Electrical",
      labourBasis: "per_day",
      days: 1,
      ratePerDay: 700,
      labourAmount: 700,
    }),
    voucherId: 99,
  };

  const pay: ExpensePaymentRow = {
    id: 1,
    paymentPublicId: "EP-1",
    paymentDate: "2026-09-26",
    amount: 700,
    paymentMode: "cash",
  };

  it("renders A5 voucher with acknowledgement and no fabricated accounting", () => {
    const html = buildExpenseVoucherHtml({
      expense: base,
      payments: [pay],
      clinic: {
        name: "Care Diagnostics",
        billPrintSettingsJson: JSON.stringify({ defaultFormat: "classic" }),
      },
    });
    expect(html).toContain("Expense / Payment Voucher");
    expect(html).toContain("RAJU ELECTRICIAN");
    expect(html).toContain("Rupees Seven Hundred Only");
    expect(html).toContain("Payment Acknowledgement");
    expect(html).toContain("@page { size: A5 landscape");
    expect(html).toContain("does not create accounting entries");
    expect(html).not.toContain("awaiting approval");
  });

  it("shows part-paid bill/paid/due distinctly", () => {
    const html = buildExpenseVoucherHtml({
      expense: {
        ...base,
        expenseId: "EXP-PART",
        billAmount: 50000,
        amount: 50000,
        paymentStatus: "PART_PAID",
        totalPaid: 20000,
        balanceDue: 30000,
        paidTo: "GANESHAS INFOTECH",
        vendorNameSnapshot: "GANESHAS INFOTECH",
        invoiceNumber: "GI/2026/123",
        metaJson: null,
      },
      payments: [{ ...pay, amount: 20000, paymentMode: "upi", referenceNumber: "UTR1" }],
      clinic: { name: "Care Diagnostics", billPrintSettingsJson: "{}" },
    });
    expect(html).toMatch(/50,000/);
    expect(html).toMatch(/20,000/);
    expect(html).toMatch(/30,000/);
    expect(html).toContain("PART PAID");
    expect(html).toContain("GI/2026/123");
  });
});
