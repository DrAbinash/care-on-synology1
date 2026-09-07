import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "bills.ts"), "utf8");

describe("due waiver accounting contract", () => {
  it("has a dedicated waive-due endpoint and never posts a payment/refund", () => {
    const start = src.indexOf('billsRouter.post("/:id/waive-due"');
    const end = src.indexOf('billsRouter.post("/:id/refund"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = src.slice(start, end);
    expect(region).toContain("planDueWaiver");
    expect(region).toContain('changeType: "balance_waived"');
    expect(region).toContain("discount: plan.newDiscount.toFixed(2)");
    expect(region).toContain("discountReason:");
    expect(region).toContain("status: plan.newStatus");
    expect(region).toContain('.for("update")');
    expect(region).not.toContain("paymentsTable");
    expect(region).not.toContain("refundAmount:");
    expect(region).not.toContain("autoVoucherForPayment");
    expect(region).not.toContain("paidAmount:");
  });
});
