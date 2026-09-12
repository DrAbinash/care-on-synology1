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
  vouchersTable,
} from "@workspace/db/schema";
import {
  assertPaymentAllowed,
  derivePaymentStatus,
  roundMoney,
  summarizeExpenseMoney,
  isCashPaymentMode,
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
  // Lock counter and advance past any existing EXP-*-NNNN ids (avoids collisions
  // when the counter drifts after manual inserts / partial migrations).
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM expense_counter FOR UPDATE`);
    const [counter] = await tx.select().from(expenseCounterTable).limit(1);
    const maxExisting = await tx
      .select({
        max: sql<string>`COALESCE(MAX(NULLIF(regexp_replace(${expensesTable.expenseId}, '^EXP-[0-9]+-', ''), '')::int), 0)`,
      })
      .from(expensesTable);
    const floor = Number(maxExisting[0]?.max ?? 0);
    const seq = Math.max((counter?.counter ?? 0) + 1, floor + 1);
    if (counter) {
      await tx.update(expenseCounterTable).set({ counter: seq }).where(eq(expenseCounterTable.id, counter.id));
    } else {
      await tx.insert(expenseCounterTable).values({ counter: seq });
    }
    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
    return `EXP-${yymm}-${String(seq).padStart(4, "0")}`;
  });
}

async function nextPaymentPublicId(): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM expense_payment_counter FOR UPDATE`);
    const [counter] = await tx.select().from(expensePaymentCounterTable).limit(1);
    const maxExisting = await tx
      .select({
        max: sql<string>`COALESCE(MAX(NULLIF(regexp_replace(${expensePaymentsTable.paymentPublicId}, '^EXPAY-[0-9]+-', ''), '')::int), 0)`,
      })
      .from(expensePaymentsTable);
    const floor = Number(maxExisting[0]?.max ?? 0);
    const seq = Math.max((counter?.counter ?? 0) + 1, floor + 1);
    if (counter) {
      await tx
        .update(expensePaymentCounterTable)
        .set({ counter: seq })
        .where(eq(expensePaymentCounterTable.id, counter.id));
    } else {
      await tx.insert(expensePaymentCounterTable).values({ counter: seq });
    }
    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
    return `EXPAY-${yymm}-${String(seq).padStart(4, "0")}`;
  });
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
  const paymentPublicId = initialPayment > 0 ? await nextPaymentPublicId() : null;

  // Atomic bill header + initial payment — accounting may stay PENDING and retry later.
  const { expense, paymentRow } = await db.transaction(async (tx) => {
    const [expense] = await tx
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
    if (initialPayment > 0 && paymentPublicId) {
      const [pay] = await tx
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
    return { expense, paymentRow };
  });

  try {
    await postAccounting({
      expense,
      payment: paymentRow,
      performedBy: input.approvedBy ?? input.createdBy ?? null,
    });
  } catch (err) {
    await db
      .update(expensesTable)
      .set({ accountingStatus: "FAILED", accountingError: err instanceof Error ? err.message : String(err) })
      .where(eq(expensesTable.id, expense.id));
  }

  const [fresh] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  const totalPaid = await sumActivePayments(expense.id);
  const [freshPay] = paymentRow
    ? await db.select().from(expensePaymentsTable).where(eq(expensePaymentsTable.id, paymentRow.id))
    : [null];
  return { expense: fresh!, payment: freshPay ?? paymentRow, money: moneyFieldsForExpense(fresh!, totalPaid) };
}

async function postAccounting(opts: {
  expense: typeof expensesTable.$inferSelect;
  payment: typeof expensePaymentsTable.$inferSelect | null;
  performedBy?: string | null;
}) {
  const { payment, performedBy } = opts;
  // Always re-read expense so concurrent callers see linked accrual/voucher ids.
  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, opts.expense.id));
  if (!expense) return;
  const billAmount = roundMoney(Number(expense.billAmount ?? expense.amount));
  const paid = payment ? roundMoney(Number(payment.amount)) : 0;

  if (paid > 0 && Math.abs(paid - billAmount) < 0.001) {
    // Fully paid single-shot: one PV (Expense Dr / Cash Cr). Idempotent via expensePaymentId.
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
          voucherId: voucherId ?? payment.voucherId ?? null,
          accountingStatus: voucherId || payment.voucherId ? "POSTED" : "FAILED",
          accountingError: voucherId || payment.voucherId ? null : "Payment voucher was not created",
        })
        .where(eq(expensePaymentsTable.id, payment.id));
    }
    await db
      .update(expensesTable)
      .set({
        voucherId: voucherId ?? expense.voucherId,
        accountingStatus: voucherId || expense.voucherId ? "POSTED" : "FAILED",
        accountingError: voucherId || expense.voucherId ? null : "Payment voucher was not created",
      })
      .where(eq(expensesTable.id, expense.id));
    return;
  }

  // Accrual JV — idempotent by reference=expenseId inside autoVoucherForExpenseAccrual.
  let accrualId = expense.accrualVoucherId;
  if (!accrualId) {
    accrualId = await autoVoucherForExpenseAccrual({
      expenseId: expense.expenseId,
      amount: billAmount,
      category: expense.category,
      description: expense.description,
      vendorName: expense.vendorNameSnapshot || expense.paidTo || "Supplier",
      performedBy: performedBy ?? null,
    });
    if (accrualId) {
      await db
        .update(expensesTable)
        .set({ accrualVoucherId: accrualId })
        .where(eq(expensesTable.id, expense.id));
    }
  }

  let paymentVoucherId: number | null = payment?.voucherId ?? null;
  if (payment && paid > 0 && !paymentVoucherId) {
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

  const ok = Boolean(accrualId) && (paid <= 0 || Boolean(paymentVoucherId) || Boolean(payment?.voucherId));
  await db
    .update(expensesTable)
    .set({
      accrualVoucherId: accrualId ?? expense.accrualVoucherId,
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
  const paymentPublicId = await nextPaymentPublicId();
  const paymentMode = (opts.paymentMode || expense.paymentMode || "cash").trim() || "cash";

  // Option B: commit payment row as PENDING inside the lock, then post accounting
  // after commit (idempotent via expensePaymentId / accrual reference).
  const { pay, nextPaid, nextStatus } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM expenses WHERE id = ${expense.id} FOR UPDATE`);

    // Re-read under lock — do not trust pre-lock accrualVoucherId / paymentStatus.
    const [locked] = await tx.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
    if (!locked) throw httpError(404, "Expense not found");
    if (locked.paymentStatus === "VOID") throw httpError(400, "Cannot record payment on a voided expense");

    const [sumRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${expensePaymentsTable.amount}), 0)` })
      .from(expensePaymentsTable)
      .where(and(eq(expensePaymentsTable.expenseId, expense.id), isNull(expensePaymentsTable.reversedAt)));
    const alreadyPaid = roundMoney(Number(sumRow?.total ?? 0));
    const check = assertPaymentAllowed({
      billAmount: roundMoney(Number(locked.billAmount ?? locked.amount)),
      alreadyPaid,
      newPayment: opts.amount,
    });
    if (!check.ok) throw httpError(400, check.error);

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
      .set({ paymentStatus: check.nextStatus, paymentMode, accountingStatus: "PENDING" })
      .where(eq(expensesTable.id, expense.id));

    return { pay, nextPaid: check.nextPaid, nextStatus: check.nextStatus };
  });

  // Post accounting AFTER the payment transaction commits (idempotent retries).
  const [freshExpense] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  try {
    await postAccounting({
      expense: freshExpense!,
      payment: pay,
      performedBy: opts.createdBy ?? null,
    });
  } catch {
    /* postAccounting records FAILED */
  }

  const [fresh] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  const [freshPay] = await db.select().from(expensePaymentsTable).where(eq(expensePaymentsTable.id, pay.id));
  return { expense: fresh!, payment: freshPay!, money: moneyFieldsForExpense(fresh!, nextPaid) };
}

export async function voidExpense(opts: { expensePk: number; reason: string; voidedBy: string }) {
  const reason = opts.reason.trim();
  if (reason.length < 3) throw httpError(400, "Void reason is required");
  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, opts.expensePk));
  if (!expense) throw httpError(404, "Expense not found");
  if (expense.paymentStatus === "VOID") throw httpError(400, "Expense is already voided");

  const payments = await listPaymentsForExpense(expense.id);

  // Deduplicate voucher IDs — fully-paid bills store the same PV on both
  // expense.voucherId and expense_payments.voucherId. Reverse each original AT MOST ONCE.
  const voucherIdsToReverse = new Set<number>();
  for (const p of payments.filter((x) => !x.reversedAt)) {
    if (p.voucherId != null) voucherIdsToReverse.add(p.voucherId);
  }
  if (expense.accrualVoucherId != null) voucherIdsToReverse.add(expense.accrualVoucherId);
  if (expense.voucherId != null) voucherIdsToReverse.add(expense.voucherId);

  for (const voucherId of voucherIdsToReverse) {
    await reverseVoucherById({
      voucherId,
      reference: expense.expenseId,
      performedBy: opts.voidedBy,
      reason: `Void expense ${expense.expenseId}: ${reason}`,
    });
  }

  for (const p of payments.filter((x) => !x.reversedAt)) {
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
  const enriched = await enrichExpenseList(rows as Array<Record<string, unknown> & { id: number }>);

  const ids = enriched.map((r) => r.id as number).filter((n) => n > 0);
  let cashPaid = 0;
  let digitalPaid = 0;
  if (ids.length) {
    const payRows = await db
      .select({
        paymentMode: expensePaymentsTable.paymentMode,
        amount: expensePaymentsTable.amount,
      })
      .from(expensePaymentsTable)
      .where(and(inArray(expensePaymentsTable.expenseId, ids), isNull(expensePaymentsTable.reversedAt)));
    for (const p of payRows) {
      const amt = roundMoney(Number(p.amount));
      if (isCashPaymentMode(p.paymentMode)) cashPaid = roundMoney(cashPaid + amt);
      else digitalPaid = roundMoney(digitalPaid + amt);
    }
  }

  return {
    items: enriched,
    summary: {
      bills: enriched.length,
      booked: roundMoney(enriched.reduce((s, r) => s + Number(r.billAmount ?? 0), 0)),
      paid: roundMoney(enriched.reduce((s, r) => s + Number(r.totalPaid ?? 0), 0)),
      outstanding: roundMoney(enriched.reduce((s, r) => s + Number(r.balanceDue ?? 0), 0)),
      cashPaid,
      digitalPaid,
    },
  };
}

/**
 * Idempotent accounting retry for FAILED / PENDING expenses.
 * Reconciles historical vouchers (reference = expenseId) before creating anything new.
 */
export async function retryExpenseAccounting(opts: {
  expensePk: number;
  performedBy?: string | null;
}) {
  const [expense0] = await db.select().from(expensesTable).where(eq(expensesTable.id, opts.expensePk));
  if (!expense0) throw httpError(404, "Expense not found");
  if (expense0.paymentStatus === "VOID") throw httpError(400, "Cannot retry accounting on a voided expense");

  // Historical reconciliation: link existing vouchers by reference before posting.
  await reconcileHistoricalVouchers(expense0.id);

  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, opts.expensePk));
  if (!expense) throw httpError(404, "Expense not found");

  const payments = await listPaymentsForExpense(expense.id);
  const active = payments.filter((p) => !p.reversedAt);
  const needsWork =
    expense.accountingStatus === "FAILED" ||
    expense.accountingStatus === "PENDING" ||
    expense.accountingStatus === "PARTIAL" ||
    active.some((p) => p.accountingStatus === "FAILED" || p.accountingStatus === "PENDING" || !p.voucherId);
  if (!needsWork && expense.accountingStatus === "POSTED") {
    return { expense, payments: active, skipped: true as const };
  }

  // Ensure accrual exists for unpaid / part-paid bills (idempotent).
  if (!expense.accrualVoucherId) {
    const billAmount = roundMoney(Number(expense.billAmount ?? expense.amount));
    const fullyPaidSingle =
      active.length === 1 && Math.abs(Number(active[0]!.amount) - billAmount) < 0.001;
    if (!fullyPaidSingle) {
      try {
        await postAccounting({ expense, payment: null, performedBy: opts.performedBy ?? null });
      } catch {
        /* postAccounting sets FAILED */
      }
    }
  }

  const [freshExpense] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  for (const pay of active.filter((p) => !p.voucherId || p.accountingStatus === "FAILED" || p.accountingStatus === "PENDING")) {
    // Skip creating a new PV if a historical voucher already covers this fully-paid legacy bill.
    if (!pay.voucherId && freshExpense?.voucherId && active.length === 1) {
      await db
        .update(expensePaymentsTable)
        .set({
          voucherId: freshExpense.voucherId,
          accountingStatus: "POSTED",
          accountingError: null,
        })
        .where(eq(expensePaymentsTable.id, pay.id));
      continue;
    }
    try {
      await postAccounting({
        expense: freshExpense!,
        payment: pay,
        performedBy: opts.performedBy ?? null,
      });
    } catch {
      /* status updated inside postAccounting */
    }
  }

  const [finalExpense] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  const finalPayments = await listPaymentsForExpense(expense.id);
  const allPosted =
    finalExpense &&
    (finalExpense.accountingStatus === "POSTED" || finalExpense.accountingStatus === "REVERSED") &&
    finalPayments.filter((p) => !p.reversedAt).every((p) => p.voucherId && p.accountingStatus === "POSTED");
  if (finalExpense && allPosted && finalExpense.accountingStatus !== "POSTED") {
    await db
      .update(expensesTable)
      .set({ accountingStatus: "POSTED", accountingError: null })
      .where(eq(expensesTable.id, expense.id));
  }
  const [done] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));
  return { expense: done!, payments: finalPayments.filter((p) => !p.reversedAt), skipped: false as const };
}

/** Link legacy vouchers (reference = expenseId) onto expense / payment rows without creating duplicates. */
async function reconcileHistoricalVouchers(expensePk: number): Promise<void> {
  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, expensePk));
  if (!expense) return;

  const historical = await db
    .select()
    .from(vouchersTable)
    .where(eq(vouchersTable.reference, expense.expenseId));

  const journals = historical.filter((v) => v.type === "journal");
  const payments = historical.filter((v) => v.type === "payment");

  if (!expense.accrualVoucherId && journals.length > 0) {
    // Prefer the earliest non-reversal accrual (particular not starting with Reversal).
    const accrual = journals.find((v) => !/^reversal/i.test(v.particular ?? "")) ?? journals[0]!;
    await db
      .update(expensesTable)
      .set({ accrualVoucherId: accrual.id })
      .where(eq(expensesTable.id, expense.id));
  }

  if (!expense.voucherId && payments.length > 0) {
    const pv = payments.find((v) => !/^reversal/i.test(v.particular ?? "")) ?? payments[0]!;
    await db
      .update(expensesTable)
      .set({
        voucherId: pv.id,
        accountingStatus: expense.accountingStatus === "PENDING" || expense.accountingStatus === "FAILED"
          ? "POSTED"
          : expense.accountingStatus,
        accountingError: null,
      })
      .where(eq(expensesTable.id, expense.id));

    // Attach to the sole active legacy payment row when present and unlinked.
    const pays = await listPaymentsForExpense(expense.id);
    const active = pays.filter((p) => !p.reversedAt && !p.voucherId);
    if (active.length === 1) {
      await db
        .update(expensePaymentsTable)
        .set({
          voucherId: pv.id,
          accountingStatus: "POSTED",
          accountingError: null,
        })
        .where(eq(expensePaymentsTable.id, active[0]!.id));
      // Also stamp expensePaymentId on the historical voucher when missing.
      if (pv.expensePaymentId == null) {
        await db
          .update(vouchersTable)
          .set({ expensePaymentId: active[0]!.id })
          .where(eq(vouchersTable.id, pv.id));
      }
    }
  }
}

