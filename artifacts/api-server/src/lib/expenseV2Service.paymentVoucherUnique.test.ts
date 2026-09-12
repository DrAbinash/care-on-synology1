/**
 * Expense V2 — DB-level payment↔voucher uniqueness proofs (real PostgreSQL).
 *
 * 1) Concurrent accounting for the SAME expense_payment → exactly one original PV
 * 2) Fully-paid VOID → one reversal, no unique-index failure, reversal leaves
 *    expense_payment_id NULL, accounting nets to zero
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { expensePaymentsTable, expensesTable, vouchersTable } from "@workspace/db/schema";
import { autoVoucherForExpense, autoVoucherForExpensePayment } from "./auto-voucher";
import {
  createExpenseV2,
  listPaymentsForExpense,
  retryExpenseAccounting,
  voidExpense,
} from "./expenseV2Service";

const hasDb = Boolean(process.env.DATABASE_URL);
const MARKER = `v2-epid-uq-${Date.now().toString(36)}`;

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
    .from(expensesTable)
    .where(like(expensesTable.description, `%${MARKER}%`));
  if (!rows.length) return;
  for (const r of rows) {
    await db.delete(expensePaymentsTable).where(eq(expensePaymentsTable.expenseId, r.id));
    await db
      .delete(vouchersTable)
      .where(
        or(
          like(vouchersTable.reference, `%${r.expenseId}%`),
          like(vouchersTable.narration, `%${r.expenseId}%`),
          like(vouchersTable.particular, `%${r.expenseId}%`),
        ),
      )
      .catch(() => undefined);
    await db.delete(expensesTable).where(eq(expensesTable.id, r.id));
  }
}

describe.skipIf(!hasDb)("expense V2 payment voucher unique index", () => {
  beforeAll(async () => {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vouchers_expense_payment_id_uq
        ON vouchers (expense_payment_id)
        WHERE expense_payment_id IS NOT NULL
    `);
    await cleanup();
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("concurrent autoVoucherForExpense for same expense_payment → exactly one original PV", async () => {
    const { expense, payment } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} concurrent full-pay`,
      amount: 8800,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "UQ Vendor",
      createdBy: "UqBot",
      approvedBy: "UqBot",
    });
    expect(payment?.id).toBeTruthy();
    const paymentId = payment!.id;

    // Detach so concurrent creators race the insert path (not the pre-select hit).
    const prior = await db
      .select({ id: vouchersTable.id })
      .from(vouchersTable)
      .where(eq(vouchersTable.expensePaymentId, paymentId));
    for (const v of prior) {
      await db
        .update(vouchersTable)
        .set({ expensePaymentId: null, reference: `${expense.expenseId}-detached-${v.id}` })
        .where(eq(vouchersTable.id, v.id));
    }
    await db
      .update(expensePaymentsTable)
      .set({ voucherId: null, accountingStatus: "PENDING", accountingError: "race reset" })
      .where(eq(expensePaymentsTable.id, paymentId));
    await db
      .update(expensesTable)
      .set({ voucherId: null, accountingStatus: "PENDING", accountingError: "race reset" })
      .where(eq(expensesTable.id, expense.id));

    const attempts = Array.from({ length: 12 }, () =>
      autoVoucherForExpense({
        expenseId: expense.expenseId,
        amount: 8800,
        paymentMode: "cash",
        category: "miscellaneous",
        description: `${MARKER} concurrent full-pay`,
        performedBy: "UqBot",
        expensePaymentId: paymentId,
        returnId: true,
      }),
    );
    const ids = (await Promise.all(attempts)).filter((x): x is number => typeof x === "number");
    expect(ids.length).toBe(12);
    expect(new Set(ids).size).toBe(1);

    const linked = await db
      .select({ id: vouchersTable.id })
      .from(vouchersTable)
      .where(eq(vouchersTable.expensePaymentId, paymentId));
    expect(linked).toHaveLength(1);
    expect(linked[0]!.id).toBe(ids[0]);

    // Application retry must reuse the same voucher — no corruption.
    await retryExpenseAccounting({ expensePk: expense.id, performedBy: "UqBot" });
    const [freshExpense] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
    const pays = await listPaymentsForExpense(expense.id);
    expect(freshExpense.voucherId).toBe(linked[0]!.id);
    expect(pays[0]?.voucherId).toBe(linked[0]!.id);
    expect(freshExpense.accountingStatus).toBe("POSTED");
  }, 60_000);

  it("concurrent autoVoucherForExpensePayment for same expense_payment → exactly one original PV", async () => {
    const { expense, payment } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} concurrent part-pay`,
      billAmount: 50000,
      initialPaymentAmount: 20000,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "UQ Part Vendor",
      createdBy: "UqBot",
    });
    expect(payment?.id).toBeTruthy();
    const paymentId = payment!.id;
    const paymentPublicId = payment!.paymentPublicId;

    const prior = await db
      .select({ id: vouchersTable.id })
      .from(vouchersTable)
      .where(eq(vouchersTable.expensePaymentId, paymentId));
    for (const v of prior) {
      await db
        .update(vouchersTable)
        .set({ expensePaymentId: null, reference: `${paymentPublicId}-detached-${v.id}` })
        .where(eq(vouchersTable.id, v.id));
    }
    await db
      .update(expensePaymentsTable)
      .set({ voucherId: null, accountingStatus: "PENDING" })
      .where(eq(expensePaymentsTable.id, paymentId));

    const attempts = Array.from({ length: 12 }, () =>
      autoVoucherForExpensePayment({
        expenseId: expense.expenseId,
        paymentPublicId,
        amount: 20000,
        paymentMode: "cash",
        vendorName: "UQ Part Vendor",
        description: `${MARKER} concurrent part-pay`,
        performedBy: "UqBot",
        expensePaymentId: paymentId,
      }),
    );
    const ids = (await Promise.all(attempts)).filter((x): x is number => typeof x === "number");
    expect(ids.length).toBe(12);
    expect(new Set(ids).size).toBe(1);

    const linked = await db
      .select({ id: vouchersTable.id })
      .from(vouchersTable)
      .where(eq(vouchersTable.expensePaymentId, paymentId));
    expect(linked).toHaveLength(1);
  }, 60_000);

  it("fully-paid VOID → one reversal with null expense_payment_id, net zero, no unique failure", async () => {
    const { expense, payment } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} void unique`,
      amount: 15000,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "Void Shop",
      createdBy: "UqBot",
      approvedBy: "UqBot",
    });
    expect(payment?.voucherId).toBeTruthy();

    const originals = await db
      .select()
      .from(vouchersTable)
      .where(eq(vouchersTable.expensePaymentId, payment!.id));
    expect(originals).toHaveLength(1);
    expect(originals[0]!.expensePaymentId).toBe(payment!.id);

    await voidExpense({
      expensePk: expense.id,
      reason: "unique-index void proof",
      voidedBy: "UqBot",
    });

    const after = await db
      .select()
      .from(vouchersTable)
      .where(
        or(
          eq(vouchersTable.expensePaymentId, payment!.id),
          eq(vouchersTable.reference, expense.expenseId),
          like(vouchersTable.reference, `${expense.expenseId}%`),
        ),
      );
    const stillOriginal = after.filter((v) => !/^reversal/i.test(v.particular ?? ""));
    const reversals = after.filter((v) => /^reversal/i.test(v.particular ?? ""));
    expect(stillOriginal).toHaveLength(1);
    expect(reversals).toHaveLength(1);

    // Original keeps the idempotency key; reversal must not.
    expect(stillOriginal[0]!.expensePaymentId).toBe(payment!.id);
    expect(reversals[0]!.expensePaymentId).toBeNull();

    expect(Number(reversals[0]!.amount)).toBe(Number(stillOriginal[0]!.amount));
    expect(reversals[0]!.debitAccountId).toBe(stillOriginal[0]!.creditAccountId);
    expect(reversals[0]!.creditAccountId).toBe(stillOriginal[0]!.debitAccountId);

    const linked = await db
      .select({ id: vouchersTable.id })
      .from(vouchersTable)
      .where(eq(vouchersTable.expensePaymentId, payment!.id));
    expect(linked).toHaveLength(1);
  }, 60_000);
});
