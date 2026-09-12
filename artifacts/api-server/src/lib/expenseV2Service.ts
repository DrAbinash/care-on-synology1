/**
 * Expense Entry V2 service.
 * BILL VALUE ≠ MONEY PAID.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  expenseCategoriesTable,
  expenseCounterTable,
  expensePaymentCounterTable,
  expensePaymentsTable,
  expensesTable,
  vendorsTable,
} from "@workspace/db/schema";
import {
  assertPaymentAllowed,
  derivePaymentStatus,
  roundMoney,
  summarizeExpenseMoney,
} from "./expensePayables";
import {
  autoVoucherForExpense,
  autoVoucherForExpenseAccrual,
  autoVoucherForExpensePayment,
  reverseVoucherById,
} from "./auto-voucher";

export type CreateExpenseV2Input = {
  category: string;
  description: string;
  amount?: number;
  billAmount?: number;
  taxAmount?: number | null;
  /** Defaults to billAmount for legacy creates; pass 0 for a due bill. */
  initialPaymentAmount?: number;
  expenseDate: string;
  paymentMode?: string;
  paidTo?: string | null;
  approvedBy?: string | null;
  createdBy?: string | null;
  notes?: string | null;
  receiptImageUrl?: string | null;
  vendorId?: number | null;
  vendorNameSnapshot?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  departmentId?: number | null;
  categoryId?: number | null;
  subcategoryId?: number | null;
  paidFromAccountId?: number | null;
  referenceNumber?: string | null;
  paymentDate?: string | null;
  ocrMetaJson?: string | null;
};

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function nextExpenseId(): Promise<string> {
  const [counter] = await db.select().from(expenseCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db.update(expenseCounterTable).set({ counter: seq }).where(eq(expenseCounterTable.id, counter.id));
  } else {
    await db.insert(expenseCounterTable).values({ counter: 1 });
  }
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `EXP-${yymm}-${String(seq).padStart(4, "0")}`;
}

async function nextPaymentPublicId(): Promise<string> {
  const [counter] = await db.select().from(expensePaymentCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db
      .update(expensePaymentCounterTable)
      .set({ counter: seq })
      .where(eq(expensePaymentCounterTable.id, counter.id));
  } else {
    await db.insert(expensePaymentCounterTable).values({ counter: 1 });
  }
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `EXPAY-${yymm}-${String(seq).padStart(4, "0")}`;
}

export function hashReceiptImage(dataUrl: string | null | undefined): string | null {
  if (!dataUrl || dataUrl.length < 32) return null;
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return createHash("sha256").update(payload).digest("hex");
}

export async function sumActivePayments(expensePk: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${expensePaymentsTable.amount}), 0)` })
    .from(expensePaymentsTable)
    .where(and(eq(expensePaymentsTable.expenseId, expensePk), isNull(expensePaymentsTable.reversedAt)));
  return roundMoney(Number(row?.total ?? 0));
}

export async function listPaymentsForExpense(expensePk: number) {
  return db
    .select()
    .from(expensePaymentsTable)
    .where(eq(expensePaymentsTable.expenseId, expensePk))
    .orderBy(desc(expensePaymentsTable.paymentDate), desc(expensePaymentsTable.id));
}

export function moneyFieldsForExpense(
  expense: { amount: string | number; billAmount?: string | number | null; paymentStatus?: string | null },
  totalPaid: number,
) {
  return summarizeExpenseMoney({
    billAmount: roundMoney(Number(expense.billAmount ?? expense.amount ?? 0)),
    totalPaid,
    isVoid: expense.paymentStatus === "VOID",
  });
}

async function resolveVendor(
  vendorId: number | null | undefined,
  snapshot: string | null | undefined,
  paidTo: string | null | undefined,
) {
  if (vendorId) {
    const [v] = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (v) return { vendorId: v.id, vendorNameSnapshot: snapshot?.trim() || v.name };
  }
  return { vendorId: vendorId ?? null, vendorNameSnapshot: (snapshot ?? paidTo ?? "").trim() || null };
}

export async function findDuplicateExpenses(opts: {
  vendorId?: number | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  billAmount?: number | null;
  expenseDate?: string | null;
  receiptImageHash?: string | null;
  excludeExpensePk?: number | null;
}) {
  const strong: Array<{ id: number; expenseId: string; reason: string }> = [];
  const soft: Array<{ id: number; expenseId: string; reason: string }> = [];

  if (opts.receiptImageHash) {
    const rows = await db
      .select({
        id: expensesTable.id,
        expenseId: expensesTable.expenseId,
        paymentStatus: expensesTable.paymentStatus,
      })
      .from(expensesTable)
      .where(
        and(
          eq(expensesTable.receiptImageHash, opts.receiptImageHash),
          opts.excludeExpensePk ? sql`${expensesTable.id} <> ${opts.excludeExpensePk}` : undefined,
        ),
      )
      .limit(5);
    for (const r of rows) {
      if (r.paymentStatus === "VOID") continue;
      strong.push({ id: r.id, expenseId: r.expenseId, reason: "Identical receipt image already uploaded" });
    }
  }

  const inv = (opts.invoiceNumber ?? "").trim();
  if (inv && (opts.vendorId || (opts.vendorName ?? "").trim())) {
    const vendorClause = opts.vendorId
      ? eq(expensesTable.vendorId, opts.vendorId)
      : sql`lower(coalesce(${expensesTable.vendorNameSnapshot}, '')) = ${(opts.vendorName ?? "").trim().toLowerCase()}`;
    const rows = await db
      .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
      .from(expensesTable)
      .where(
        and(
          eq(expensesTable.invoiceNumber, inv),
          sql`${expensesTable.paymentStatus} <> 'VOID'`,
          vendorClause,
          opts.excludeExpensePk ? sql`${expensesTable.id} <> ${opts.excludeExpensePk}` : undefined,
        ),
      )
      .limit(5);
    for (const r of rows) {
      strong.push({ id: r.id, expenseId: r.expenseId, reason: `Same vendor + invoice number "${inv}"` });
    }
  }

  if ((opts.vendorId || (opts.vendorName ?? "").trim()) && opts.billAmount && opts.expenseDate) {
    const amt = roundMoney(opts.billAmount);
    const vendorClause = opts.vendorId
      ? eq(expensesTable.vendorId, opts.vendorId)
      : sql`lower(coalesce(${expensesTable.vendorNameSnapshot}, '')) = ${(opts.vendorName ?? "").trim().toLowerCase()}`;
    const rows = await db
      .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
      .from(expensesTable)
      .where(
        and(
          sql`${expensesTable.paymentStatus} <> 'VOID'`,
          vendorClause,
          sql`ABS(COALESCE(${expensesTable.billAmount}, ${expensesTable.amount})::numeric - ${amt}) < 0.02`,
          sql`ABS((${expensesTable.expenseDate})::date - (${opts.expenseDate})::date) <= 3`,
          opts.excludeExpensePk ? sql`${expensesTable.id} <> ${opts.excludeExpensePk}` : undefined,
        ),
      )
      .limit(5);
    for (const r of rows) {
      if (strong.some((s) => s.id === r.id)) continue;
      soft.push({
        id: r.id,
        expenseId: r.expenseId,
        reason: `Same vendor + similar amount near ${opts.expenseDate}`,
      });
    }
  }

  return { strong, soft };
}

export async function createExpenseV2(input: CreateExpenseV2Input) {
  const billAmount = roundMoney(
    Number(input.billAmount != null && Number.isFinite(input.billAmount) ? input.billAmount : input.amount),
  );
  if (!(billAmount > 0)) throw httpError(400, "Bill amount must be greater than zero");

  const initialPayment =
    input.initialPaymentAmount != null && Number.isFinite(input.initialPaymentAmount)
      ? roundMoney(input.initialPaymentAmount)
      : input.billAmount != null
        ? 0
        : billAmount;

  if (initialPayment < 0) throw httpError(400, "Initial payment cannot be negative");
  if (initialPayment - billAmount > 0.001) throw httpError(400, "Initial payment cannot exceed bill amount");

  const paymentStatus = derivePaymentStatus({ billAmount, totalPaid: initialPayment });
  const paymentMode = (input.paymentMode || "cash").trim() || "cash";
  const vendor = await resolveVendor(input.vendorId, input.vendorNameSnapshot, input.paidTo);
  const receiptImageHash = hashReceiptImage(input.receiptImageUrl);
  const expenseId = await nextExpenseId();

  const [expense] = await db
    .insert(expensesTable)
    .values({
      expenseId,
      category: input.category,
      description: input.description,
      amount: String(billAmount),
      billAmount: String(billAmount),
      taxAmount: input.taxAmount != null ? String(roundMoney(input.taxAmount)) : null,
      expenseDate: input.expenseDate,
      paymentMode,
      paidTo: input.paidTo ?? vendor.vendorNameSnapshot,
      approvedBy: input.approvedBy ?? null,
      createdBy: input.createdBy ?? null,
      notes: input.notes ?? null,
      receiptImageUrl: input.receiptImageUrl ?? null,
      receiptImageHash,
      paymentStatus,
      vendorId: vendor.vendorId,
      vendorNameSnapshot: vendor.vendorNameSnapshot,
      invoiceNumber: input.invoiceNumber?.trim() || null,
      invoiceDate: input.invoiceDate || null,
      departmentId: input.departmentId ?? null,
      categoryId: input.categoryId ?? null,
      subcategoryId: input.subcategoryId ?? null,
      accountingStatus: "PENDING",
      ocrMetaJson: input.ocrMetaJson ?? null,
    })
    .returning();

  let paymentRow: typeof expensePaymentsTable.$inferSelect | null = null;
  if (initialPayment > 0) {
    const paymentPublicId = await nextPaymentPublicId();
    const [pay] = await db
      .insert(expensePaymentsTable)
      .values({
        expenseId: expense.id,
        paymentPublicId,
        paymentDate: input.paymentDate || input.expenseDate,
        amount: String(initialPayment),
        paymentMode,
        paidFromAccountId: input.paidFromAccountId ?? null,
        referenceNumber: input.referenceNumber ?? null,
        createdBy: input.createdBy ?? null,
        accountingStatus: "PENDING",
        isLegacyBackfill: "false",
      })
      .returning();
    paymentRow = pay;
  }

  try {
    await postAccounting({ expense, payment: paymentRow, performedBy: input.approvedBy ?? input.createdBy ?? null });
  } catch (err) {
    await db
      .update(expensesTable)
      .set({ accountingStatus: "FAILED", accountingError: err instanceof Error ? err.message : String(err) })
      .where(eq(expensesTable.id, expense.id));
  }

  const [fresh] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  const totalPaid = await sumActivePayments(expense.id);
  return { expense: fresh!, payment: paymentRow, money: moneyFieldsForExpense(fresh!, totalPaid) };
}

async function postAccounting(opts: {
  expense: typeof expensesTable.$inferSelect;
  payment: typeof expensePaymentsTable.$inferSelect | null;
  performedBy?: string | null;
}) {
  const { expense, payment, performedBy } = opts;
  const billAmount = roundMoney(Number(expense.billAmount ?? expense.amount));
  const paid = payment ? roundMoney(Number(payment.amount)) : 0;

  if (paid > 0 && Math.abs(paid - billAmount) < 0.001) {
    const voucherId = await autoVoucherForExpense({
      expenseId: expense.expenseId,
      amount: paid,
      paymentMode: payment!.paymentMode || expense.paymentMode || "cash",
      category: expense.category,
      description: expense.description,
      performedBy: performedBy ?? null,
      paidFromAccountId: payment?.paidFromAccountId ?? null,
      expensePaymentId: payment?.id ?? null,
      returnId: true,
    });
    if (payment) {
      await db
        .update(expensePaymentsTable)
        .set({
          voucherId: voucherId ?? null,
          accountingStatus: voucherId ? "POSTED" : "FAILED",
          accountingError: voucherId ? null : "Payment voucher was not created",
        })
        .where(eq(expensePaymentsTable.id, payment.id));
    }
    await db
      .update(expensesTable)
      .set({
        voucherId: voucherId ?? expense.voucherId,
        accountingStatus: voucherId ? "POSTED" : "FAILED",
        accountingError: voucherId ? null : "Payment voucher was not created",
      })
      .where(eq(expensesTable.id, expense.id));
    return;
  }

  const accrualId = await autoVoucherForExpenseAccrual({
    expenseId: expense.expenseId,
    amount: billAmount,
    category: expense.category,
    description: expense.description,
    vendorName: expense.vendorNameSnapshot || expense.paidTo || "Supplier",
    performedBy: performedBy ?? null,
  });

  let paymentVoucherId: number | null = null;
  if (payment && paid > 0) {
    paymentVoucherId = await autoVoucherForExpensePayment({
      expenseId: expense.expenseId,
      paymentPublicId: payment.paymentPublicId,
      amount: paid,
      paymentMode: payment.paymentMode || "cash",
      vendorName: expense.vendorNameSnapshot || expense.paidTo || "Supplier",
      description: expense.description,
      performedBy: performedBy ?? null,
      paidFromAccountId: payment.paidFromAccountId ?? null,
      expensePaymentId: payment.id,
    });
    await db
      .update(expensePaymentsTable)
      .set({
        voucherId: paymentVoucherId,
        accountingStatus: paymentVoucherId ? "POSTED" : "FAILED",
        accountingError: paymentVoucherId ? null : "Payment voucher was not created",
      })
      .where(eq(expensePaymentsTable.id, payment.id));
  }

  const ok = Boolean(accrualId) && (paid <= 0 || Boolean(paymentVoucherId));
  await db
    .update(expensesTable)
    .set({
      accrualVoucherId: accrualId,
      accountingStatus: ok ? "POSTED" : "FAILED",
      accountingError: ok ? null : "Accrual and/or payment voucher posting failed",
    })
    .where(eq(expensesTable.id, expense.id));
}

export async function recordExpensePayment(opts: {
  expensePk: number;
  amount: number;
  paymentDate: string;
  paymentMode?: string;
  paidFromAccountId?: number | null;
  referenceNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}) {
  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, opts.expensePk));
  if (!expense) throw httpError(404, "Expense not found");
  if (expense.paymentStatus === "VOID") throw httpError(400, "Cannot record payment on a voided expense");

  const billAmount = roundMoney(Number(expense.billAmount ?? expense.amount));

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM expenses WHERE id = ${expense.id} FOR UPDATE`);
    const [sumRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${expensePaymentsTable.amount}), 0)` })
      .from(expensePaymentsTable)
      .where(and(eq(expensePaymentsTable.expenseId, expense.id), isNull(expensePaymentsTable.reversedAt)));
    const alreadyPaid = roundMoney(Number(sumRow?.total ?? 0));
    const check = assertPaymentAllowed({ billAmount, alreadyPaid, newPayment: opts.amount });
    if (!check.ok) throw httpError(400, check.error);

    const paymentPublicId = await nextPaymentPublicId();
    const paymentMode = (opts.paymentMode || expense.paymentMode || "cash").trim() || "cash";
    const [pay] = await tx
      .insert(expensePaymentsTable)
      .values({
        expenseId: expense.id,
        paymentPublicId,
        paymentDate: opts.paymentDate,
        amount: String(roundMoney(opts.amount)),
        paymentMode,
        paidFromAccountId: opts.paidFromAccountId ?? null,
        referenceNumber: opts.referenceNumber ?? null,
        notes: opts.notes ?? null,
        createdBy: opts.createdBy ?? null,
        accountingStatus: "PENDING",
        isLegacyBackfill: "false",
      })
      .returning();

    await tx
      .update(expensesTable)
      .set({ paymentStatus: check.nextStatus, paymentMode })
      .where(eq(expensesTable.id, expense.id));

    let voucherId: number | null = null;
    try {
      if (!expense.accrualVoucherId) {
        const accrualId = await autoVoucherForExpenseAccrual({
          expenseId: expense.expenseId,
          amount: billAmount,
          category: expense.category,
          description: expense.description,
          vendorName: expense.vendorNameSnapshot || expense.paidTo || "Supplier",
          performedBy: opts.createdBy ?? null,
        });
        if (accrualId) {
          await tx
            .update(expensesTable)
            .set({ accrualVoucherId: accrualId })
            .where(eq(expensesTable.id, expense.id));
        }
      }
      voucherId = await autoVoucherForExpensePayment({
        expenseId: expense.expenseId,
        paymentPublicId: pay.paymentPublicId,
        amount: roundMoney(opts.amount),
        paymentMode,
        vendorName: expense.vendorNameSnapshot || expense.paidTo || "Supplier",
        description: expense.description,
        performedBy: opts.createdBy ?? null,
        paidFromAccountId: opts.paidFromAccountId ?? null,
        expensePaymentId: pay.id,
      });
    } catch {
      voucherId = null;
    }

    await tx
      .update(expensePaymentsTable)
      .set({
        voucherId,
        accountingStatus: voucherId ? "POSTED" : "FAILED",
        accountingError: voucherId ? null : "Payment voucher was not created",
      })
      .where(eq(expensePaymentsTable.id, pay.id));
    await tx
      .update(expensesTable)
      .set({ accountingStatus: voucherId ? "POSTED" : "PARTIAL" })
      .where(eq(expensesTable.id, expense.id));

    const [fresh] = await tx.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
    const [freshPay] = await tx.select().from(expensePaymentsTable).where(eq(expensePaymentsTable.id, pay.id));
    return { expense: fresh!, payment: freshPay!, money: moneyFieldsForExpense(fresh!, check.nextPaid) };
  });
}

export async function voidExpense(opts: { expensePk: number; reason: string; voidedBy: string }) {
  const reason = opts.reason.trim();
  if (reason.length < 3) throw httpError(400, "Void reason is required");
  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, opts.expensePk));
  if (!expense) throw httpError(404, "Expense not found");
  if (expense.paymentStatus === "VOID") throw httpError(400, "Expense is already voided");

  const payments = await listPaymentsForExpense(expense.id);
  for (const p of payments.filter((x) => !x.reversedAt)) {
    if (p.voucherId) {
      await reverseVoucherById({
        voucherId: p.voucherId,
        reference: `${expense.expenseId}:${p.paymentPublicId}`,
        performedBy: opts.voidedBy,
        reason: `Void expense ${expense.expenseId}: ${reason}`,
      });
    }
    await db
      .update(expensePaymentsTable)
      .set({
        reversedAt: new Date(),
        reversedBy: opts.voidedBy,
        reversalReason: reason,
        accountingStatus: "REVERSED",
      })
      .where(eq(expensePaymentsTable.id, p.id));
  }

  if (expense.accrualVoucherId) {
    await reverseVoucherById({
      voucherId: expense.accrualVoucherId,
      reference: expense.expenseId,
      performedBy: opts.voidedBy,
      reason: `Void expense accrual ${expense.expenseId}: ${reason}`,
    });
  } else if (expense.voucherId) {
    await reverseVoucherById({
      voucherId: expense.voucherId,
      reference: expense.expenseId,
      performedBy: opts.voidedBy,
      reason: `Void expense ${expense.expenseId}: ${reason}`,
    });
  }

  const [fresh] = await db
    .update(expensesTable)
    .set({
      paymentStatus: "VOID",
      voidReason: reason,
      voidedAt: new Date(),
      voidedBy: opts.voidedBy,
      accountingStatus: "REVERSED",
    })
    .where(eq(expensesTable.id, expense.id))
    .returning();
  return fresh;
}

export async function enrichExpenseList(rows: Array<Record<string, unknown> & { id: number }>) {
  const ids = rows.map((r) => r.id).filter((n) => n > 0);
  if (!ids.length) return [];
  const payRows = await db
    .select({
      expenseId: expensePaymentsTable.expenseId,
      total: sql<string>`COALESCE(SUM(${expensePaymentsTable.amount}), 0)`,
    })
    .from(expensePaymentsTable)
    .where(and(inArray(expensePaymentsTable.expenseId, ids), isNull(expensePaymentsTable.reversedAt)))
    .groupBy(expensePaymentsTable.expenseId);
  const paidMap = new Map(payRows.map((p) => [p.expenseId, roundMoney(Number(p.total))]));

  return rows.map((r) => {
    const money = moneyFieldsForExpense(
      {
        amount: r.amount as string | number,
        billAmount: r.billAmount as string | number | null | undefined,
        paymentStatus: r.paymentStatus as string | null | undefined,
      },
      paidMap.get(r.id) ?? 0,
    );
    return {
      ...r,
      amount: Number(r.amount ?? 0),
      billAmount: money.billAmount,
      totalPaid: money.totalPaid,
      balanceDue: money.balanceDue,
      paymentStatus: (r.paymentStatus as string) || money.paymentStatus,
      receiptImageUrl: undefined,
    };
  });
}

export async function listExpenseCategories() {
  return db
    .select()
    .from(expenseCategoriesTable)
    .where(eq(expenseCategoriesTable.isActive, true))
    .orderBy(expenseCategoriesTable.sortOrder, expenseCategoriesTable.name);
}

export async function listPayables(opts: { from?: string; to?: string } = {}) {
  const conditions = [
    inArray(expensesTable.paymentStatus, ["DUE", "PART_PAID"]),
    opts.from ? sql`${expensesTable.expenseDate} >= ${opts.from}` : undefined,
    opts.to ? sql`${expensesTable.expenseDate} <= ${opts.to}` : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(expensesTable)
    .where(and(...(conditions as Parameters<typeof and>)))
    .orderBy(expensesTable.expenseDate, expensesTable.id);
  return enrichExpenseList(rows as Array<Record<string, unknown> & { id: number }>);
}
