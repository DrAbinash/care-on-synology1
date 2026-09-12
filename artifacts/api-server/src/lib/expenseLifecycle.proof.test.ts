import { describe, expect, it } from "vitest";
import {
  createExpenseV2,
  recordExpensePayment,
  listPaymentsForExpense,
  voidExpense,
  findDuplicateExpenses,
  hashReceiptImage,
} from "./expenseV2Service";
import { isCashPaymentMode } from "./expensePayables";

const marker = `life-${Date.now().toString(36)}`;

describe("expense V2 lifecycle proof", () => {
  it("50k bill / 20k + 10k + 20k with correct cash impact", async () => {
    const { expense, money, payment } = await createExpenseV2({
      category: "miscellaneous",
      description: `${marker} 50k supplier bill`,
      billAmount: 50000,
      initialPaymentAmount: 20000,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "ABC Medical Supplies",
      vendorNameSnapshot: "ABC Medical Supplies",
      invoiceNumber: `INV-${marker}`,
      createdBy: "LifecycleBot",
      approvedBy: "LifecycleBot",
    });
    expect(money).toMatchObject({ billAmount: 50000, totalPaid: 20000, balanceDue: 30000, paymentStatus: "PART_PAID" });
    expect(payment).not.toBeNull();

    const p2 = await recordExpensePayment({
      expensePk: expense.id,
      amount: 10000,
      paymentDate: "2026-09-13",
      paymentMode: "upi",
      createdBy: "LifecycleBot",
    });
    expect(p2.money).toMatchObject({ totalPaid: 30000, balanceDue: 20000, paymentStatus: "PART_PAID" });

    const p3 = await recordExpensePayment({
      expensePk: expense.id,
      amount: 20000,
      paymentDate: "2026-09-14",
      paymentMode: "cash",
      createdBy: "LifecycleBot",
    });
    expect(p3.money).toMatchObject({ totalPaid: 50000, balanceDue: 0, paymentStatus: "PAID" });

    const pays = await listPaymentsForExpense(expense.id);
    const active = pays.filter((p) => !p.reversedAt);
    expect(active).toHaveLength(3);
    const cashImpact = active
      .filter((p) => isCashPaymentMode(p.paymentMode))
      .reduce((s, p) => s + Number(p.amount), 0);
    expect(cashImpact).toBe(40000); // 20k + 20k cash; 10k UPI excluded

    console.log(JSON.stringify({
      expenseId: expense.expenseId,
      moneyFinal: p3.money,
      payments: active.map((p) => ({
        id: p.paymentPublicId,
        date: p.paymentDate,
        amount: Number(p.amount),
        mode: p.paymentMode,
        voucherId: p.voucherId,
        accountingStatus: p.accountingStatus,
      })),
      cashImpact,
      accountingStatus: p3.expense.accountingStatus,
    }, null, 2));
  });

  it("duplicate invoice warning + void", async () => {
    const receipt = "data:image/png;base64," + Buffer.alloc(48, 9).toString("base64");
    const hash = hashReceiptImage(receipt);
    const a = await createExpenseV2({
      category: "miscellaneous",
      description: `${marker} dup-a`,
      billAmount: 1111,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      vendorNameSnapshot: "DupCo",
      invoiceNumber: `DUP-${marker}`,
      receiptImageUrl: receipt,
      createdBy: "LifecycleBot",
    });
    const dupes = await findDuplicateExpenses({
      vendorName: "DupCo",
      invoiceNumber: `DUP-${marker}`,
      billAmount: 1111,
      expenseDate: "2026-09-12",
      receiptImageHash: hash!,
    });
    expect(dupes.strong.length).toBeGreaterThan(0);
    const voided = await voidExpense({ expensePk: a.expense.id, reason: "lifecycle void demo", voidedBy: "LifecycleBot" });
    expect(voided.paymentStatus).toBe("VOID");
    console.log(JSON.stringify({ dupes, voidedStatus: voided.paymentStatus, accountingStatus: voided.accountingStatus }, null, 2));
  });
});
