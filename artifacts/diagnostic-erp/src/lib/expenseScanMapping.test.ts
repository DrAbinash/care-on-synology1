import { describe, expect, it } from "vitest";
import { mapExpenseCategory, mapExpensePaymentMode } from "./expenseScanMapping";

describe("mapExpenseCategory", () => {
  it("maps Gemini bill labels onto ledger slugs", () => {
    expect(mapExpenseCategory("Office Supplies")).toBe("supplies");
    expect(mapExpenseCategory("Medical Supplies")).toBe("supplies");
    expect(mapExpenseCategory("Rent")).toBe("rent");
    expect(mapExpenseCategory("Professional Fees")).toBe("miscellaneous");
  });

  it("keeps ledger slugs and unknown values as miscellaneous", () => {
    expect(mapExpenseCategory("utilities")).toBe("utilities");
    expect(mapExpenseCategory("")).toBe("miscellaneous");
    expect(mapExpenseCategory("Stationery")).toBe("miscellaneous");
  });
});

describe("mapExpensePaymentMode", () => {
  it("maps NEFT / other onto bank-transfer", () => {
    expect(mapExpensePaymentMode("NEFT")).toBe("bank-transfer");
    expect(mapExpensePaymentMode("other")).toBe("bank-transfer");
    expect(mapExpensePaymentMode("bank transfer")).toBe("bank-transfer");
  });

  it("keeps cash/upi/card/cheque", () => {
    expect(mapExpensePaymentMode("UPI")).toBe("upi");
    expect(mapExpensePaymentMode("cheque")).toBe("cheque");
    expect(mapExpensePaymentMode("")).toBe("cash");
  });
});
