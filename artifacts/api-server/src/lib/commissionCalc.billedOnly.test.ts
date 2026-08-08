import { describe, expect, test } from "vitest";
import {
  indexCommissionBillsByOrderId,
  isCommissionBillEligible,
  pickCommissionBill,
} from "./commissionCalc";

describe("commission billed-only eligibility", () => {
  test("unbilled orders are not commission-eligible", () => {
    expect(isCommissionBillEligible(null)).toBe(false);
    expect(isCommissionBillEligible(undefined)).toBe(false);
  });

  test("cancelled bills are not commission-eligible", () => {
    expect(isCommissionBillEligible({ status: "cancelled" })).toBe(false);
  });

  test("active / paid / unpaid billed orders are eligible for commission rows", () => {
    expect(isCommissionBillEligible({ status: "unpaid" })).toBe(true);
    expect(isCommissionBillEligible({ status: "partial" })).toBe(true);
    expect(isCommissionBillEligible({ status: "paid" })).toBe(true);
    expect(isCommissionBillEligible({ status: null })).toBe(true);
  });

  test("pickCommissionBill prefers a non-cancelled bill over a cancelled one", () => {
    const picked = pickCommissionBill([
      { status: "cancelled", id: 1 },
      { status: "paid", id: 2 },
    ]);
    expect(picked).toEqual({ status: "paid", id: 2 });
  });

  test("pickCommissionBill returns null when every bill is cancelled", () => {
    expect(pickCommissionBill([{ status: "cancelled" }, { status: "cancelled" }])).toBeNull();
    expect(pickCommissionBill([])).toBeNull();
  });

  test("indexCommissionBillsByOrderId drops unbilled and cancelled-only orders", () => {
    const map = indexCommissionBillsByOrderId([
      { orderId: 10, status: "paid", billNumber: "B1" },
      { orderId: 11, status: "cancelled", billNumber: "B2" },
      { orderId: 12, status: "cancelled", billNumber: "B3a" },
      { orderId: 12, status: "unpaid", billNumber: "B3b" },
      { orderId: null, status: "paid", billNumber: "orphan" },
    ]);
    expect([...map.keys()].sort()).toEqual([10, 12]);
    expect(map.get(10)?.billNumber).toBe("B1");
    expect(map.get(12)?.billNumber).toBe("B3b");
    expect(map.has(11)).toBe(false);
  });
});
