/**
 * Regression: nextPaymentPublicId / nextExpenseId must ignore noncanonical
 * historical IDs (EXPAY-LEGACY-*, EXP-LEGACY-*, malformed text).
 *
 * NAS production had EXPAY-LEGACY-1..5 from backfill; the old
 * regexp_replace(... )::int cast crashed POST /api/expenses with HTTP 500.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { expensePaymentsTable, expensesTable, vouchersTable } from "@workspace/db/schema";
import {
  createExpenseV2,
  listPaymentsForExpense,
  recordExpensePayment,
  voidExpense,
} from "./expenseV2Service";

const hasDb = Boolean(process.env.DATABASE_URL);
const MARKER = `v2-idgen-${Date.now().toString(36)}`;

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
    .from(expensesTable)
    .where(like(expensesTable.description, `%${MARKER}%`));
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
  // Also remove any directly-seeded noncanonical expense ids used by this suite.
  await db.delete(expensesTable).where(eq(expensesTable.expenseId, "EXP-LEGACY-1")).catch(() => undefined);
}

/** Seed a payment_public_id without going through the generator. */
async function seedPaymentRow(opts: {
  expensePk: number;
  paymentPublicId: string;
  amount?: string;
}): Promise<void> {
  await db.insert(expensePaymentsTable).values({
    expenseId: opts.expensePk,
    paymentPublicId: opts.paymentPublicId,
    paymentDate: "2026-09-01",
    amount: opts.amount ?? "1.00",
    paymentMode: "cash",
    createdBy: "IdGenSeed",
    accountingStatus: "PENDING",
    isLegacyBackfill: "true",
  });
}

function seqFromExpay(id: string): number {
  const m = /^EXPAY-\d+-(\d+)$/.exec(id);
  if (!m) throw new Error(`not canonical: ${id}`);
  return Number(m[1]);
}

describe.skipIf(!hasDb)("expense V2 ID generators — legacy-safe", () => {
  beforeAll(async () => {
    await cleanup();
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("EXPAY-LEGACY-* rows are preserved and do not block new payment ID generation", async () => {
    const host = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} legacy host`,
      billAmount: 1000,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "Legacy Host",
      createdBy: "IdGenBot",
    });

    for (const id of ["EXPAY-LEGACY-1", "EXPAY-LEGACY-2", "EXPAY-LEGACY-5"]) {
      await seedPaymentRow({ expensePk: host.expense.id, paymentPublicId: id });
    }

    const created = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} after legacy`,
      amount: 2500,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      paidTo: "After Legacy",
      createdBy: "IdGenBot",
      approvedBy: "IdGenBot",
    });
    expect(created.payment?.paymentPublicId).toMatch(/^EXPAY-\d+-\d+$/);
    expect(created.payment!.paymentPublicId.startsWith("EXPAY-LEGACY")).toBe(false);

    const still = await db
      .select({ paymentPublicId: expensePaymentsTable.paymentPublicId })
      .from(expensePaymentsTable)
      .where(
        sql`${expensePaymentsTable.paymentPublicId} IN ('EXPAY-LEGACY-1','EXPAY-LEGACY-2','EXPAY-LEGACY-5')`,
      );
    expect(still.map((r) => r.paymentPublicId).sort()).toEqual([
      "EXPAY-LEGACY-1",
      "EXPAY-LEGACY-2",
      "EXPAY-LEGACY-5",
    ]);
  }, 60_000);

  it("canonical EXPAY-2609-0042 advances the sequence past 42", async () => {
    const host = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} canonical floor host`,
      billAmount: 500,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      createdBy: "IdGenBot",
    });
    await seedPaymentRow({
      expensePk: host.expense.id,
      paymentPublicId: "EXPAY-2609-0042",
    });

    const created = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} after canonical 42`,
      amount: 100,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "IdGenBot",
      approvedBy: "IdGenBot",
    });
    expect(seqFromExpay(created.payment!.paymentPublicId)).toBeGreaterThan(42);
  }, 60_000);

  it("mixed legacy + malformed + canonical: ignores noncanonical, advances from canonical", async () => {
    const host = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} mixed host`,
      billAmount: 800,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      createdBy: "IdGenBot",
    });

    for (const id of [
      "EXPAY-LEGACY-99",
      "EXPAY-NOT-A-NUMBER",
      "EXPAY-2609-0007",
      "GARBAGE-PAYMENT-ID",
      "EXPAY--001",
    ]) {
      await seedPaymentRow({ expensePk: host.expense.id, paymentPublicId: id });
    }

    const created = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} after mixed`,
      amount: 50,
      expenseDate: "2026-09-12",
      paymentMode: "upi",
      createdBy: "IdGenBot",
      approvedBy: "IdGenBot",
    });
    const id = created.payment!.paymentPublicId;
    expect(id).toMatch(/^EXPAY-\d+-\d+$/);
    expect(seqFromExpay(id)).toBeGreaterThanOrEqual(8);

    await expect(
      seedPaymentRow({ expensePk: host.expense.id, paymentPublicId: id }),
    ).rejects.toThrow();

    const preserved = await db
      .select({ paymentPublicId: expensePaymentsTable.paymentPublicId })
      .from(expensePaymentsTable)
      .where(
        sql`${expensePaymentsTable.paymentPublicId} IN (
          'EXPAY-LEGACY-99','EXPAY-NOT-A-NUMBER','GARBAGE-PAYMENT-ID','EXPAY-2609-0007'
        )`,
      );
    expect(preserved.map((r) => r.paymentPublicId).sort()).toEqual([
      "EXPAY-2609-0007",
      "EXPAY-LEGACY-99",
      "EXPAY-NOT-A-NUMBER",
      "GARBAGE-PAYMENT-ID",
    ]);
  }, 60_000);

  it("EXP-LEGACY-* expense ids do not block nextExpenseId()", async () => {
    await db.insert(expensesTable).values({
      expenseId: "EXP-LEGACY-1",
      category: "miscellaneous",
      description: `${MARKER} legacy expense id`,
      amount: "10.00",
      billAmount: "10.00",
      expenseDate: "2026-01-01",
      paymentMode: "cash",
      paymentStatus: "DUE",
      accountingStatus: "PENDING",
      createdBy: "IdGenSeed",
    });

    const created = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} after legacy expense id`,
      billAmount: 75,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      createdBy: "IdGenBot",
    });
    expect(created.expense.expenseId).toMatch(/^EXP-\d+-\d+$/);
    expect(created.expense.expenseId.startsWith("EXP-LEGACY")).toBe(false);

    const [legacy] = await db
      .select({ expenseId: expensesTable.expenseId })
      .from(expensesTable)
      .where(eq(expensesTable.expenseId, "EXP-LEGACY-1"));
    expect(legacy?.expenseId).toBe("EXP-LEGACY-1");
  }, 60_000);

  it("recordExpensePayment succeeds when LEGACY payment ids exist", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} record-pay host`,
      billAmount: 9000,
      initialPaymentAmount: 1000,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "IdGenBot",
    });
    await seedPaymentRow({
      expensePk: expense.id,
      paymentPublicId: "EXPAY-LEGACY-3",
      amount: "1.00",
    });

    const pay = await recordExpensePayment({
      expensePk: expense.id,
      amount: 500,
      paymentDate: "2026-09-13",
      paymentMode: "cash",
      createdBy: "IdGenBot",
    });
    expect(pay.payment.paymentPublicId).toMatch(/^EXPAY-\d+-\d+$/);

    const pays = await listPaymentsForExpense(expense.id);
    expect(pays.some((p) => p.paymentPublicId === "EXPAY-LEGACY-3")).toBe(true);
  }, 60_000);

  it("fully-paid VOID still posts one reversal with null expense_payment_id", async () => {
    const { expense, payment } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} void`,
      amount: 3333,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "IdGenBot",
      approvedBy: "IdGenBot",
    });
    expect(payment?.voucherId).toBeTruthy();

    await voidExpense({
      expensePk: expense.id,
      reason: "idgen void regression",
      voidedBy: "IdGenBot",
    });

    const vouchers = await db
      .select()
      .from(vouchersTable)
      .where(
        or(
          eq(vouchersTable.expensePaymentId, payment!.id),
          eq(vouchersTable.reference, expense.expenseId),
        ),
      );
    const originals = vouchers.filter((v) => !/^reversal/i.test(v.particular ?? ""));
    const reversals = vouchers.filter((v) => /^reversal/i.test(v.particular ?? ""));
    expect(originals).toHaveLength(1);
    expect(reversals).toHaveLength(1);
    expect(originals[0]!.expensePaymentId).toBe(payment!.id);
    expect(reversals[0]!.expensePaymentId).toBeNull();
  }, 60_000);
});
