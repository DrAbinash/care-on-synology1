/**
 * Expense Entry V2 — service-level integration tests (real DB).
 * BILL VALUE ≠ MONEY PAID.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { expensePaymentsTable, expensesTable, vouchersTable } from "@workspace/db/schema";
import { eq, like, or } from "drizzle-orm";
import { isCashPaymentMode } from "./expensePayables";
import {
  createExpenseV2,
  findDuplicateExpenses,
  hashReceiptImage,
  listPaymentsForExpense,
  recordExpensePayment,
  sumActivePayments,
  voidExpense,
} from "./expenseV2Service";

const hasDb = Boolean(process.env.DATABASE_URL);
const MARKER = `v2-exp-${Date.now().toString(36)}`;

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
    .from(expensesTable)
    .where(like(expensesTable.description, `%${MARKER}%`));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  for (const id of ids) {
    await db.delete(expensePaymentsTable).where(eq(expensePaymentsTable.expenseId, id));
  }
  for (const r of rows) {
    await db
      .delete(vouchersTable)
      .where(or(like(vouchersTable.reference, `%${r.expenseId}%`), like(vouchersTable.narration, `%${r.expenseId}%`)))
      .catch(() => undefined);
  }
  for (const id of ids) {
    await db.delete(expensesTable).where(eq(expensesTable.id, id));
  }
}

describe.skipIf(!hasDb)("expenseV2Service — bill ≠ paid", () => {
  beforeAll(async () => {
    await cleanup();
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("legacy fully-paid create (amount only → PAID + one payment)", async () => {
    const result = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} legacy paid`,
      amount: 1500,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "Shop",
      approvedBy: "Tester",
      createdBy: "Tester",
    });
    expect(result.money.billAmount).toBe(1500);
    expect(result.money.totalPaid).toBe(1500);
    expect(result.money.balanceDue).toBe(0);
    expect(result.money.paymentStatus).toBe("PAID");
    expect(result.payment).not.toBeNull();
    expect(Number(result.payment!.amount)).toBe(1500);
  });

  it("due bill and part-paid bill", async () => {
    const due = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} due bill`,
      billAmount: 50000,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    expect(due.money).toMatchObject({
      billAmount: 50000,
      totalPaid: 0,
      balanceDue: 50000,
      paymentStatus: "DUE",
    });
    expect(due.payment).toBeNull();

    const part = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} part paid`,
      billAmount: 50000,
      initialPaymentAmount: 20000,
      expenseDate: "2026-09-12",
      paymentMode: "upi",
      vendorNameSnapshot: "ABC Medical",
      invoiceNumber: `INV-${MARKER}-1`,
      createdBy: "Tester",
    });
    expect(part.money).toMatchObject({
      billAmount: 50000,
      totalPaid: 20000,
      balanceDue: 30000,
      paymentStatus: "PART_PAID",
    });
  });

  it("later payments, full settlement, overpayment rejected", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} settle lifecycle`,
      billAmount: 50000,
      initialPaymentAmount: 20000,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });

    const p2 = await recordExpensePayment({
      expensePk: expense.id,
      amount: 10000,
      paymentDate: "2026-09-13",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    expect(p2.money).toMatchObject({
      totalPaid: 30000,
      balanceDue: 20000,
      paymentStatus: "PART_PAID",
    });

    await expect(
      recordExpensePayment({
        expensePk: expense.id,
        amount: 25000,
        paymentDate: "2026-09-14",
        paymentMode: "cash",
        createdBy: "Tester",
      }),
    ).rejects.toMatchObject({ status: 400 });

    const p3 = await recordExpensePayment({
      expensePk: expense.id,
      amount: 20000,
      paymentDate: "2026-09-14",
      paymentMode: "upi",
      createdBy: "Tester",
    });
    expect(p3.money).toMatchObject({
      totalPaid: 50000,
      balanceDue: 0,
      paymentStatus: "PAID",
    });

    const payments = await listPaymentsForExpense(expense.id);
    expect(payments.filter((p) => !p.reversedAt)).toHaveLength(3);
  });

  it("cash mode helpers and unpaid bill cash impact 0", async () => {
    expect(isCashPaymentMode("cash")).toBe(true);
    expect(isCashPaymentMode("upi")).toBe(false);

    const unpaid = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} unpaid cash impact`,
      billAmount: 50000,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      createdBy: "Tester",
    });
    expect(await sumActivePayments(unpaid.expense.id)).toBe(0);
  });

  it("duplicate invoice + image hash warnings", async () => {
    const receipt = "data:image/png;base64," + Buffer.alloc(64, 7).toString("base64");
    const hash = hashReceiptImage(receipt);
    expect(hash).toBeTruthy();

    await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} dup base`,
      billAmount: 18500,
      initialPaymentAmount: 18500,
      expenseDate: "2026-09-12",
      vendorNameSnapshot: "Dup Vendor",
      invoiceNumber: `DUP-${MARKER}`,
      receiptImageUrl: receipt,
      createdBy: "Tester",
    });

    const dupes = await findDuplicateExpenses({
      vendorName: "Dup Vendor",
      invoiceNumber: `DUP-${MARKER}`,
      billAmount: 18500,
      expenseDate: "2026-09-12",
      receiptImageHash: hash,
    });
    expect(dupes.strong.length).toBeGreaterThan(0);
  });

  it("void soft-deletes and blocks further payments", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} to void`,
      billAmount: 1000,
      initialPaymentAmount: 1000,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });

    const voided = await voidExpense({
      expensePk: expense.id,
      reason: "test void reason",
      voidedBy: "Tester",
    });
    expect(voided?.paymentStatus).toBe("VOID");
    expect(voided?.voidReason).toBe("test void reason");

    await expect(
      recordExpensePayment({
        expensePk: expense.id,
        amount: 100,
        paymentDate: "2026-09-12",
        createdBy: "Tester",
      }),
    ).rejects.toMatchObject({ status: 400 });

    const [still] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
    expect(still.paymentStatus).toBe("VOID");
  });
});

describe("expensePayables cash helper (no DB)", () => {
  it("treats blank mode as cash (legacy default)", () => {
    expect(isCashPaymentMode("")).toBe(true);
    expect(isCashPaymentMode("CASH")).toBe(true);
    expect(isCashPaymentMode("Bank Transfer")).toBe(false);
  });
});
