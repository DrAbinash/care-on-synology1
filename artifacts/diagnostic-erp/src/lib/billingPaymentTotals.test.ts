import { describe, expect, it } from "vitest";
import { confirmedPaymentTotal, onlinePaymentTotal } from "./billingPaymentTotals";

describe("billingPaymentTotals", () => {
  it("excludes online from confirmed paid total", () => {
    const rows = [
      { mode: "cash", amount: 200 },
      { mode: "online", amount: 800 },
    ];
    expect(confirmedPaymentTotal(rows)).toBe(200);
    expect(onlinePaymentTotal(rows)).toBe(800);
  });

  it("treats method alias the same as mode", () => {
    expect(confirmedPaymentTotal([{ method: "upi", amount: "150" }])).toBe(150);
    expect(onlinePaymentTotal([{ method: "online", amount: "99.5" }])).toBe(99.5);
  });

  it("full online split is entirely unconfirmed", () => {
    const rows = [{ mode: "online", amount: 1000 }];
    expect(confirmedPaymentTotal(rows)).toBe(0);
    expect(onlinePaymentTotal(rows)).toBe(1000);
  });
});
