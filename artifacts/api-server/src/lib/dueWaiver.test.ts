import { describe, expect, it } from "vitest";
import { planDueWaiver } from "./dueWaiver";

const FULL = new Set(["admin", "super_admin", "owner"]);

describe("planDueWaiver — unpaid receivable → discount (never a refund)", () => {
  it("CASE 1: ₹18,500 gross / ₹15,000 paid / ₹3,500 due → waive to PAID", () => {
    const plan = planDueWaiver(
      {
        status: "partial",
        subtotal: 18500,
        taxAmount: 0,
        paidAmount: 15000,
        refundAmount: 0,
        discount: 0,
        totalAmount: 18500,
      },
      { role: "admin", fullAccessRoles: FULL },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.waivedAmount).toBe(3500);
    expect(plan.newDiscount).toBe(3500);
    expect(plan.newTotal).toBe(15000);
    expect(plan.paidAmount).toBe(15000);
    expect(plan.refundAmount).toBe(0);
    expect(plan.newBalance).toBe(0);
    expect(plan.newStatus).toBe("paid");
  });

  it("CASE 2: no outstanding balance → fail safely", () => {
    const plan = planDueWaiver({
      status: "paid",
      subtotal: 15000,
      taxAmount: 0,
      paidAmount: 15000,
      refundAmount: 0,
      discount: 0,
      totalAmount: 15000,
    });
    expect(plan).toEqual({
      ok: false,
      httpStatus: 409,
      error: "This bill has no outstanding balance to waive",
    });
  });

  it("CASE 3: already-refunded bill → blocked (historical refund intact)", () => {
    const plan = planDueWaiver({
      status: "partial",
      subtotal: 18500,
      taxAmount: 0,
      paidAmount: 11500,
      refundAmount: 3500,
      discount: 0,
      totalAmount: 18500,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.httpStatus).toBe(409);
    expect(plan.error).toMatch(/already has refunds/i);
  });

  it("CASE 4: second waive after balance already cleared → fail (no double-waive)", () => {
    const afterFirst = planDueWaiver(
      {
        status: "partial",
        subtotal: 18500,
        taxAmount: 0,
        paidAmount: 15000,
        refundAmount: 0,
        discount: 0,
        totalAmount: 18500,
      },
      { role: "admin", fullAccessRoles: FULL },
    );
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    const second = planDueWaiver({
      status: afterFirst.newStatus,
      subtotal: 18500,
      taxAmount: 0,
      paidAmount: afterFirst.paidAmount,
      refundAmount: afterFirst.refundAmount,
      discount: afterFirst.newDiscount,
      totalAmount: afterFirst.newTotal,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.httpStatus).toBe(409);
  });

  it("CASE 5 semantics: paid/refund amounts never change in a successful plan", () => {
    const plan = planDueWaiver(
      {
        status: "partial",
        subtotal: 1000,
        taxAmount: 0,
        paidAmount: 400,
        refundAmount: 0,
        discount: 0,
        totalAmount: 1000,
      },
      { role: "admin", fullAccessRoles: FULL },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.paidAmount).toBe(400);
    expect(plan.refundAmount).toBe(0);
    expect(plan.newDiscount).toBe(600);
    expect(plan.newTotal).toBe(400);
    expect(plan.newBalance).toBe(0);
  });

  it("enforces staff max-discount when role is not full-access", () => {
    const plan = planDueWaiver(
      {
        status: "partial",
        subtotal: 18500,
        taxAmount: 0,
        paidAmount: 15000,
        refundAmount: 0,
        discount: 0,
        totalAmount: 18500,
      },
      { role: "receptionist", maxDiscountPct: 10, fullAccessRoles: FULL },
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.httpStatus).toBe(403);
    expect(plan.error).toMatch(/maximum allowed discount/i);
  });

  it("blocks cancelled bills", () => {
    const plan = planDueWaiver({
      status: "cancelled",
      subtotal: 18500,
      taxAmount: 0,
      paidAmount: 15000,
      refundAmount: 0,
      discount: 0,
      totalAmount: 18500,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.httpStatus).toBe(409);
  });
});
