import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/routes/bills.ts"), "utf8");

describe("due waiver accounting contract", () => {
  it("has a dedicated waive-due endpoint and never posts a payment/refund", () => {
    const start = src.indexOf('billsRouter.post("/:id/waive-due"');
    const end = src.indexOf('// Records a refund of `amount`', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = src.slice(start, end);
    expect(region).toContain('changeType: "balance_waived"');
    expect(region).toContain('discount: newDiscount.toFixed(2)');
    expect(region).toContain('status: newStatus');
    expect(region).toContain('.for("update")');
    expect(region).not.toContain('paymentsTable');
    expect(region).not.toContain('refundAmount:');
    expect(region).not.toContain('autoVoucherForPayment');
  });
});
