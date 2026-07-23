import { Router } from "express";
import { db, paymentsTable, dayClosuresTable, userDayClosuresTable, billsTable, usersTable, expensesTable, orderTestsTable, testsTable } from "@workspace/db";
import { drawerAuditLogTable, patientsTable, doctorsTable, ordersTable } from "@workspace/db/schema";
import { eq, and, gt, lte, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { classifyPaymentMethod, isPhysicalCash } from "../lib/paymentMethodClassifier";
import { lastOverallClosureBoundary } from "../lib/closureBoundary";

// Inline super-admin gate that works on the regular ERP staff session
// (req.staffSession.role === "super_admin"). The site-wide
// `requireSuperAdmin` middleware uses the X-SA-Token header issued by
// the Super Admin Portal — that is not in scope here because the reopen
// button lives inside the regular ERP UI.
function requireSuperAdminStaff(req: StaffAuthRequest, res: Response, next: NextFunction): void {
  if (req.staffSession?.role !== "super_admin") {
    res.status(403).json({ error: "Super-admin role required" });
    return;
  }
  next();
}

function requireOwnerOrAdmin(req: StaffAuthRequest, res: Response, next: NextFunction): void {
  const role = req.staffSession?.role ?? "";
  if (!OWNER_ROLES.has(role)) {
    res.status(403).json({ error: "Owner/admin access required" });
    return;
  }
  next();
}

export const dayCloseRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  return Number(v ?? 0) || 0;
}

// Compute the coverage window for the next close: from the latest existing
// closure's `coveredToTs` (exclusive) up to "now" (inclusive). Returns null
// from when no prior closure exists — the SQL builder uses gt(ts, null) by
// just omitting the lower bound.
// Delegates to the shared helper (../lib/closureBoundary.ts) — also used by
// bills.ts to warn staff refunding against an already-closed period.
const lastClosureBoundary = lastOverallClosureBoundary;

type MethodTotals = { cash: number; upi: number; card: number; cheque: number; other: number; total: number; count: number };

function emptyTotals(): MethodTotals {
  return { cash: 0, upi: 0, card: 0, cheque: 0, other: 0, total: 0, count: 0 };
}

// Delegates to the shared classifier (../lib/paymentMethodClassifier.ts) —
// the single source of truth also used by daily-summary.ts and
// my-daily-summary.ts (Approved Fix #3: no more independently-drifted
// classifiers). Categories not represented by a dedicated day-close column
// ("online", "insurance") fold into "other", same as before — they were
// never counted as cash here. Genuinely UNKNOWN methods are intentionally
// excluded from every bucket (including "other") and are surfaced
// separately via the suspense total — see summarizeWindow().
function bucketMethod(method: string): keyof Omit<MethodTotals, "total" | "count"> {
  const c = classifyPaymentMethod(method);
  if (c.category === "cash") return "cash";
  if (c.category === "upi") return "upi";
  if (c.category === "card") return "card";
  if (c.category === "cheque") return "cheque";
  // online, insurance, and known-but-uncategorized methods → "other" (never cash).
  // "unknown" is handled by the caller before bucketMethod is invoked.
  return "other";
}

type TestSummary = { testId: number; testName: string; category: string; count: number; total: number };

// ── Pure, exported, unit-testable core logic ────────────────────────────────
// Extracted so the critical business rules (cash-only physical drawer, no
// silent unknown→cash/other fallback, cash-expense subtraction) can be
// verified without a database connection. summarizeWindow() below is a thin
// DB-fetching wrapper around these two functions — the arithmetic lives
// here exactly once.

export type PaymentLike = { id: number; amount: string | number; method: string | null; recordedByName?: string | null };
export type ExpenseLike = { amount: string | number; paymentMode: string | null; approvedBy?: string | null };

export type SuspenseItem = { id: number; amount: number; rawMethod: string; recordedByName: string | null };

export interface ClassifiedPayments {
  overall: MethodTotals;
  byStaff: Map<string, MethodTotals & { userId: number | null; userName: string }>;
  suspenseItems: SuspenseItem[];
  totalSuspense: number;
}

/**
 * Classify a window's payment rows into cash/upi/card/cheque/other buckets
 * (overall + per-staff), isolating unrecognized methods into a suspense list
 * instead of ever letting them join a bucket (LOCKED BUSINESS RULE #6).
 * Pure — no DB access, no expense subtraction (see applyCashExpenses below).
 */
export function classifyAndBucketPayments(payRows: PaymentLike[]): ClassifiedPayments {
  const overall = emptyTotals();
  const byStaff = new Map<string, MethodTotals & { userId: number | null; userName: string }>();
  const suspenseItems: SuspenseItem[] = [];

  for (const r of payRows) {
    const amt = n(r.amount);
    const classified = classifyPaymentMethod(r.method);
    if (!classified.isKnown) {
      suspenseItems.push({ id: r.id, amount: amt, rawMethod: r.method ?? "", recordedByName: r.recordedByName ?? null });
      continue;
    }
    const bucket = bucketMethod(r.method ?? "");
    overall[bucket] += amt;
    overall.total += amt;
    overall.count += 1;

    const name = (r.recordedByName ?? "").trim() || "Unassigned";
    if (!byStaff.has(name)) {
      byStaff.set(name, { ...emptyTotals(), userId: null, userName: name });
    }
    const s = byStaff.get(name)!;
    s[bucket] += amt;
    s.total += amt;
    s.count += 1;
  }
  const totalSuspense = suspenseItems.reduce((s, x) => s + x.amount, 0);

  return { overall, byStaff, suspenseItems, totalSuspense };
}

/**
 * Split a window's expense rows into cash vs non-cash, overall and by
 * approver. LOCKED BUSINESS RULE #5: only expenses recorded with
 * payment_mode = "cash" ever reduce physical drawer cash; everything else
 * is informational only. Pure — no DB access.
 */
export function splitCashExpenses(expRows: ExpenseLike[]): {
  cashExpenses: number;
  digitalExpenses: number;
  cashExpensesByApprover: Map<string, number>;
} {
  // Delegates to the shared payment-method classifier's cash check for
  // consistency with payments.method classification (Approved Fix #5),
  // with one explicit difference preserved: expenses.payment_mode is a
  // NOT NULL column with a DEFAULT of 'cash' in the schema, so a missing/
  // blank value here means "cash" (matching the DB default), NOT "unknown"
  // (which is what the classifier would say for an empty payments.method —
  // that field has no such default). Swapping this to the classifier's
  // blanket unknown-handling would silently exclude such an expense from
  // both cash and digital totals, which is not what "expenses.payment_mode
  // defaults to cash" means.
  const isCashExpense = (mode: string | null | undefined) => {
    const trimmed = (mode ?? "").trim();
    if (!trimmed) return true;
    return isPhysicalCash(trimmed);
  };
  const totalExpenses = expRows.reduce((s, e) => s + n(e.amount), 0);
  const cashExpenses = expRows.filter((e) => isCashExpense(e.paymentMode)).reduce((s, e) => s + n(e.amount), 0);
  const digitalExpenses = totalExpenses - cashExpenses;

  const cashExpensesByApprover = new Map<string, number>();
  for (const e of expRows) {
    if (!isCashExpense(e.paymentMode)) continue;
    const approver = (e.approvedBy ?? "").trim();
    if (!approver) continue;
    cashExpensesByApprover.set(approver, (cashExpensesByApprover.get(approver) ?? 0) + n(e.amount));
  }
  return { cashExpenses, digitalExpenses, cashExpensesByApprover };
}

/**
 * CRITICAL FIX (Expected Physical Cash = Cash In − Cash Refunded − Cash
 * Expenses, LOCKED BUSINESS RULE #4): mutates `classified` in place,
 * subtracting cash expenses from the overall cash bucket and from each
 * approving staff member's own cash bucket (Cash Attribution Rule — an
 * expense reduces the physical cash of whoever approved it, not the whole
 * clinic indiscriminately). A staff who approved cash expenses but recorded
 * no payments in this window still gets a byStaff row created, so their
 * liability isn't silently absorbed into the overall total only.
 */
export function applyCashExpenses(classified: ClassifiedPayments, cashExpensesByApprover: Map<string, number>): void {
  const totalCashExpenses = Array.from(cashExpensesByApprover.values()).reduce((s, x) => s + x, 0);
  classified.overall.cash -= totalCashExpenses;
  classified.overall.total -= totalCashExpenses;

  for (const [approver, amt] of cashExpensesByApprover) {
    if (!classified.byStaff.has(approver)) {
      classified.byStaff.set(approver, { ...emptyTotals(), userId: null, userName: approver });
    }
    const s = classified.byStaff.get(approver)!;
    s.cash -= amt;
    s.total -= amt;
  }
}

// Aggregate payments, bills, expenses, and tests in the window (from, to].
async function summarizeWindow(from: Date | null, to: Date) {
  const paymentWhere = from
    ? and(gt(paymentsTable.createdAt, from), lte(paymentsTable.createdAt, to))
    : lte(paymentsTable.createdAt, to);

  const billWhere = from
    ? and(gt(billsTable.createdAt, from), lte(billsTable.createdAt, to))
    : lte(billsTable.createdAt, to);

  const expenseWhere = from
    ? and(gt(expensesTable.createdAt, from), lte(expensesTable.createdAt, to))
    : lte(expensesTable.createdAt, to);

  // Payments
  const payRows = await db
    .select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
      method: paymentsTable.method,
      createdAt: paymentsTable.createdAt,
      recordedByName: paymentsTable.recordedByName,
      billId: paymentsTable.billId,
    })
    .from(paymentsTable)
    .where(paymentWhere);

  // Bills
  const billRows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      refundAmount: billsTable.refundAmount,
      status: billsTable.status,
      orderId: billsTable.orderId,
      patientName: sql<string>`COALESCE(${patientsTable.firstName} || ' ' || COALESCE(${patientsTable.lastName}, ''), 'Unknown')`,
      createdAt: billsTable.createdAt,
    })
    .from(billsTable)
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(billWhere);

  // Expenses
  const expRows = await db
    .select({
      id: expensesTable.id,
      amount: expensesTable.amount,
      category: expensesTable.category,
      description: expensesTable.description,
      createdAt: expensesTable.createdAt,
      paymentMode: expensesTable.paymentMode,
      approvedBy: expensesTable.approvedBy,
    })
    .from(expensesTable)
    .where(expenseWhere);

  // Aggregate payments — delegates to the pure, unit-tested classifier above.
  const classified = classifyAndBucketPayments(payRows);
  const { overall, byStaff, suspenseItems, totalSuspense } = classified;

  // Aggregate bills
  const totalBilled = billRows.reduce((s, b) => s + n(b.totalAmount), 0);
  const totalRefunds = billRows.reduce((s, b) => s + n(b.refundAmount), 0);
  const totalDue = billRows.reduce((s, b) => s + n(b.balanceAmount), 0);
  const billsCount = billRows.length;
  const cancelledBills = billRows.filter((b) => b.status === "cancelled");

  // Aggregate expenses
  const totalExpenses = expRows.reduce((s, e) => s + n(e.amount), 0);
  const expensesByCategory = new Map<string, number>();
  const expenseDetails = expRows.map((e) => ({
    id: e.id,
    amount: n(e.amount),
    category: e.category ?? "General",
    description: e.description ?? "",
  }));
  for (const e of expRows) {
    const cat = e.category ?? "General";
    expensesByCategory.set(cat, (expensesByCategory.get(cat) ?? 0) + n(e.amount));
  }

  // ── CRITICAL FIX: Expected Physical Cash = Cash In − Cash Refunded − Cash
  // Expenses (LOCKED BUSINESS RULE #4). `overall.cash` above was previously
  // only Cash In minus Cash Refunded — it never subtracted cash expenses, so
  // a staff physically counting their drawer would be compared against an
  // inflated "expected" figure. Only expenses recorded with payment_mode =
  // "cash" reduce the drawer; digital/bank expenses must not (LOCKED RULE
  // #5) — they stay informational only via totalExpenses/expensesByCategory.
  const { cashExpenses, digitalExpenses, cashExpensesByApprover } = splitCashExpenses(expRows);
  applyCashExpenses(classified, cashExpensesByApprover);

  // Aggregate test-wise collections
  const testMap = new Map<number, TestSummary>();
  const activeBillIds = billRows.filter((b) => b.status !== "cancelled").map((b) => b.id);
  if (activeBillIds.length > 0) {
    const orderIds = new Set<number>();
    for (const b of billRows) {
      if (b.status !== "cancelled" && b.orderId != null) orderIds.add(b.orderId);
    }
    if (orderIds.size > 0) {
      const testRows = await db
        .select({
          testId: orderTestsTable.testId,
          testName: sql<string>`COALESCE(${orderTestsTable.displayName}, ${testsTable.name}, 'Unknown')`,
          category: sql<string>`COALESCE(${testsTable.category}, 'General')`,
          price: orderTestsTable.price,
        })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(and(
          inArray(orderTestsTable.orderId, Array.from(orderIds)),
          sql`${orderTestsTable.status} != 'cancelled'`,
        ));

      for (const t of testRows) {
        const id = n(t.testId);
        if (!testMap.has(id)) {
          testMap.set(id, { testId: id, testName: t.testName, category: t.category, count: 0, total: 0 });
        }
        const ts = testMap.get(id)!;
        ts.count += 1;
        ts.total += n(t.price);
      }
    }
  }

  return {
    overall,
    byStaff: Array.from(byStaff.values()).sort((a, b) => b.total - a.total),
    billsCount,
    paymentsCount: overall.count,
    totalBilled,
    totalRefunds,
    totalDue,
    cancelledBills,
    totalExpenses,
    cashExpenses,
    digitalExpenses,
    expensesByCategory: Array.from(expensesByCategory.entries()).map(([category, total]) => ({ category, total })),
    expenseDetails,
    testSummary: Array.from(testMap.values()).sort((a, b) => b.total - a.total),
    // Suspense/exception bucket — see LOCKED BUSINESS RULE #6. Already
    // excluded from `overall`/`byStaff` above; exposed here for admin
    // visibility and correction.
    totalSuspense,
    suspenseItems,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Preview what closing the day right now would look like.
dayCloseRouter.get("/preview", requireOwnerOrAdmin, async (_req, res) => {
  const from = await lastClosureBoundary();
  const to = new Date();
  const summary = await summarizeWindow(from, to);
  res.json({
    coveredFromTs: from,
    coveredToTs: to,
    expected: summary.overall,
    byStaff: summary.byStaff,
    billsCount: summary.billsCount,
    paymentsCount: summary.overall.count,
    cashExpenses: summary.cashExpenses,
    digitalExpenses: summary.digitalExpenses,
    // Suspense/exception bucket — unrecognized payment methods, excluded
    // from `expected` above. See LOCKED BUSINESS RULE #6.
    suspenseTotal: summary.totalSuspense,
    suspenseCount: summary.suspenseItems.length,
    suspenseItems: summary.suspenseItems,
  });
});

const CreateBody = z.object({
  actuals: z.object({
    cash: z.coerce.number().min(0).default(0),
    upi: z.coerce.number().min(0).default(0),
    card: z.coerce.number().min(0).default(0),
    cheque: z.coerce.number().min(0).default(0),
    other: z.coerce.number().min(0).default(0),
  }),
  varianceNote: z.string().max(2000).default(""),
});

// Close the day.
dayCloseRouter.post("/", requireOwnerOrAdmin, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.format() });
    return;
  }
  const { actuals, varianceNote } = parsed.data;

  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7390021)`);

    const [last] = await tx
      .select({ coveredToTs: dayClosuresTable.coveredToTs })
      .from(dayClosuresTable)
      .where(eq(dayClosuresTable.status, "closed"))
      .orderBy(desc(dayClosuresTable.coveredToTs))
      .limit(1);
    const from = last?.coveredToTs ? new Date(last.coveredToTs) : null;
    const to = new Date();
    const summary = await summarizeWindow(from, to);

    const totalExpected = summary.overall.total;
    const totalActual = actuals.cash + actuals.upi + actuals.card + actuals.cheque + actuals.other;
    const variance = totalActual - totalExpected;

    const istDateLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(to);
    const session = (req as StaffAuthRequest).staffSession;
    const closedByName = session?.subjectName || "Unknown";

    const [row] = await tx
      .insert(dayClosuresTable)
      .values({
        closureDate: istDateLabel,
        closedAt: to,
        closedByUserId: session?.subjectId ?? null,
        closedByName,
        coveredFromTs: from,
        coveredToTs: to,
        expectedCash: String(summary.overall.cash),
        expectedUpi: String(summary.overall.upi),
        expectedCard: String(summary.overall.card),
        expectedCheque: String(summary.overall.cheque),
        expectedOther: String(summary.overall.other),
        actualCash: String(actuals.cash),
        actualUpi: String(actuals.upi),
        actualCard: String(actuals.card),
        actualCheque: String(actuals.cheque),
        actualOther: String(actuals.other),
        variance: String(variance),
        varianceNote,
        billsCount: summary.billsCount,
        paymentsCount: summary.overall.count,
        totalExpected: String(totalExpected),
        totalActual: String(totalActual),
        staffBreakdown: summary.byStaff,
        totalBilled: String(summary.totalBilled),
        totalRefunds: String(summary.totalRefunds),
        totalExpenses: String(summary.totalExpenses),
        totalDue: String(summary.totalDue),
        testSummary: summary.testSummary,
        expenseDetails: summary.expenseDetails,
        refundDetails: summary.cancelledBills.map((b) => ({
          id: b.id,
          billNumber: b.billNumber ?? String(b.id),
          patientName: b.patientName ?? "Unknown",
          totalAmount: b.totalAmount,
          refundAmount: b.refundAmount,
        })),
        status: "closed",
      })
      .returning();
    return {
      row,
      cashExpenses: summary.cashExpenses,
      digitalExpenses: summary.digitalExpenses,
      suspenseTotal: summary.totalSuspense,
      suspenseItems: summary.suspenseItems,
    };
  });

  req.log?.info({ closureId: inserted.row.id, totalExpected: inserted.row.totalExpected, totalActual: inserted.row.totalActual, variance: inserted.row.variance }, "Day closed");
  if (inserted.suspenseItems.length > 0) {
    req.log?.warn(
      { closureId: inserted.row.id, suspenseCount: inserted.suspenseItems.length, suspenseTotal: inserted.suspenseTotal },
      "Day closed with unrecognized-method payments excluded from totals — needs admin correction",
    );
  }
  res.status(201).json({
    ...inserted.row,
    // Additive, not persisted as separate columns — see LOCKED BUSINESS
    // RULE #4/#5 (cash-expense split of the already-persisted totalExpenses)
    // and RULE #6 (suspense/exception bucket, never folded into any total).
    cashExpenses: inserted.cashExpenses,
    digitalExpenses: inserted.digitalExpenses,
    suspenseTotal: inserted.suspenseTotal,
    suspenseCount: inserted.suspenseItems.length,
    suspenseItems: inserted.suspenseItems,
  });
});

// List all closures, newest first.
dayCloseRouter.get("/", requireOwnerOrAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const rows = await db
    .select()
    .from(dayClosuresTable)
    .orderBy(desc(dayClosuresTable.closedAt))
    .limit(limit);
  res.json(rows);
});

// Single closure detail (enriched with report data if missing from DB).
dayCloseRouter.get("/:id", requireOwnerOrAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(dayClosuresTable).where(eq(dayClosuresTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const existing = row as Record<string, unknown>;
  const hasReport = n(existing.totalBilled) !== 0 || n(existing.totalRefunds) !== 0 || n(existing.totalExpenses) !== 0 || (Array.isArray(existing.testSummary) && (existing.testSummary as unknown[]).length > 0);

  if (hasReport) {
    res.json(row);
    return;
  }

  // Re-compute report data for legacy closures
  const from = row.coveredFromTs ? new Date(row.coveredFromTs) : null;
  const to = new Date(row.coveredToTs);
  const summary = await summarizeWindow(from, to);

  const enriched = {
    ...row,
    totalBilled: String(summary.totalBilled),
    totalRefunds: String(summary.totalRefunds),
    totalExpenses: String(summary.totalExpenses),
    totalDue: String(summary.totalDue),
    testSummary: summary.testSummary,
    expenseDetails: summary.expenseDetails,
    refundDetails: summary.cancelledBills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber ?? String(b.id),
      patientName: b.patientName ?? "Unknown",
      totalAmount: b.totalAmount,
      refundAmount: b.refundAmount,
    })),
  };

  res.json(enriched);
});

// Re-open a closed day. SUPER-ADMIN role (regular ERP staff session) ONLY.
const ReopenBody = z.object({ reason: z.string().min(3).max(2000) });
dayCloseRouter.post("/:id/reopen", requireSuperAdminStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = ReopenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Reason is required (min 3 chars)" });
    return;
  }
  const session = (req as StaffAuthRequest).staffSession;
  const reopenedByName = session?.subjectName || "Super-admin";
  const [updated] = await db
    .update(dayClosuresTable)
    .set({
      status: "reopened",
      reopenedAt: new Date(),
      reopenedByUserId: session?.subjectId ?? null,
      reopenedByName,
      reopenReason: parsed.data.reason,
    })
    .where(and(eq(dayClosuresTable.id, id), eq(dayClosuresTable.status, "closed")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Closure not found or already reopened" });
    return;
  }
  req.log?.warn({ closureId: id, reopenedBy: reopenedByName }, "Day closure RE-OPENED");
  res.json(updated);
});

// ── Per-user helpers ────────────────────────────────────────────────────────

const OWNER_ROLES = new Set(["admin", "super_admin", "owner"]);

// Find the open-window start for a specific user:
// MAX(last overall day close, last user's own close).
/**
 * CARRY-FORWARD RULE (LOCKED BUSINESS RULE #10/#11): the open window for a
 * staff member's next close starts at MAX(last overall day close, last
 * user's own close) — never before either boundary, so a closed day's
 * totals can never silently change, and nothing later requires owner
 * approval to "reopen" — new entries simply belong to the next window by
 * construction. Pure — exported for unit testing without a DB.
 */
export function maxBoundary(t1: Date | null, t2: Date | null): Date | null {
  if (!t1 && !t2) return null;
  if (!t1) return t2;
  if (!t2) return t1;
  return t1 > t2 ? t1 : t2;
}

async function userWindowBoundary(userName: string): Promise<Date | null> {
  const [lastOverall] = await db
    .select({ ts: dayClosuresTable.coveredToTs })
    .from(dayClosuresTable)
    .where(eq(dayClosuresTable.status, "closed"))
    .orderBy(desc(dayClosuresTable.coveredToTs))
    .limit(1);

  const [lastUser] = await db
    .select({ ts: userDayClosuresTable.closedAt })
    .from(userDayClosuresTable)
    .where(eq(userDayClosuresTable.userName, userName))
    .orderBy(desc(userDayClosuresTable.closedAt))
    .limit(1);

  const t1 = lastOverall?.ts ? new Date(lastOverall.ts) : null;
  const t2 = lastUser?.ts    ? new Date(lastUser.ts)    : null;
  return maxBoundary(t1, t2);
}

type UserSummary = {
  totals: MethodTotals;
  billsCount: number;
  totalBilled: number;
  totalDue: number;
  cashExpenses: number;
  suspenseTotal: number;
  suspenseItems: Array<{ amount: number; rawMethod: string }>;
  bills: Array<{
    id: number;
    billNumber: string;
    patientName: string;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    discount: number;
    status: string;
    referringDoctor: string | null;
    createdByName: string;
    createdAt: string;
  }>;
};

async function summarizeUserWindow(
  userName: string,
  from: Date | null,
  to: Date,
): Promise<UserSummary> {
  const pWhere = from
    ? and(eq(paymentsTable.recordedByName, userName), gt(paymentsTable.createdAt, from), lte(paymentsTable.createdAt, to))
    : and(eq(paymentsTable.recordedByName, userName), lte(paymentsTable.createdAt, to));

  const payments = await db
    .select({ id: paymentsTable.id, amount: paymentsTable.amount, method: paymentsTable.method, recordedByName: paymentsTable.recordedByName })
    .from(paymentsTable)
    .where(pWhere);

  // Same pure classifier used by the overall day-close path — single
  // source of truth for bucketing + suspense isolation.
  const classified = classifyAndBucketPayments(payments);
  const totals = classified.overall;
  const suspenseItems = classified.suspenseItems.map((s) => ({ amount: s.amount, rawMethod: s.rawMethod }));
  const suspenseTotal = classified.totalSuspense;

  // Subtract THIS staff's own cash expenses (Cash Attribution Rule: an
  // expense reduces the physical cash of the staff who approved it, same
  // posting-date rule as summarizeWindow — created_at, not expense_date).
  const expWhere = from
    ? and(eq(expensesTable.approvedBy, userName), gt(expensesTable.createdAt, from), lte(expensesTable.createdAt, to))
    : and(eq(expensesTable.approvedBy, userName), lte(expensesTable.createdAt, to));
  const expRows = await db
    .select({ amount: expensesTable.amount, paymentMode: expensesTable.paymentMode })
    .from(expensesTable)
    .where(expWhere);
  // Reduce this cashier's expected physical cash by the cash expenses they
  // approved — exactly once — by delegating to the same tested pure helper the
  // overall path uses (applyCashExpenses). `totals` is `classified.overall`,
  // so mutating `classified` here updates it. This previously inlined the
  // subtraction and applied it TWICE, which understated each cashier's expected
  // drawer cash and could mask a real shortfall as a false surplus.
  const { cashExpenses, cashExpensesByApprover } = splitCashExpenses(expRows);
  applyCashExpenses(classified, cashExpensesByApprover);

  const bWhere = from
    ? and(
        eq(billsTable.createdByName, userName),
        gt(billsTable.createdAt, from),
        lte(billsTable.createdAt, to),
        sql`${billsTable.status} != 'cancelled'`,
      )
    : and(
        eq(billsTable.createdByName, userName),
        lte(billsTable.createdAt, to),
        sql`${billsTable.status} != 'cancelled'`,
      );

  const billRows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      discount: billsTable.discount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      createdByName: billsTable.createdByName,
      patientName: sql<string>`COALESCE(${patientsTable.firstName} || ' ' || COALESCE(${patientsTable.lastName}, ''), 'Unknown')`,
      referringDoctor: doctorsTable.name,
    })
    .from(billsTable)
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(bWhere)
    .orderBy(desc(billsTable.createdAt));

  const bills = billRows.map((b) => ({
    id: b.id,
    billNumber: b.billNumber ?? String(b.id),
    patientName: b.patientName,
    totalAmount: n(b.totalAmount),
    paidAmount: n(b.paidAmount),
    balanceAmount: n(b.balanceAmount),
    discount: n(b.discount),
    status: b.status ?? "pending",
    referringDoctor: b.referringDoctor ?? null,
    createdByName: b.createdByName ?? "",
    createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : "",
  }));

  return {
    totals,
    billsCount:  bills.length,
    totalBilled: bills.reduce((s, b) => s + b.totalAmount, 0),
    totalDue:    bills.reduce((s, b) => s + b.balanceAmount, 0),
    cashExpenses,
    suspenseTotal,
    suspenseItems,
    bills,
  };
}

// ── Per-user routes ──────────────────────────────────────────────────────────

// Preview: current user's open window summary.
dayCloseRouter.get("/my-preview", async (req, res) => {
  const session  = (req as StaffAuthRequest).staffSession;
  const userName = session?.subjectName?.trim() ?? "";
  if (!userName) { res.status(401).json({ error: "Not authenticated" }); return; }

  const from = await userWindowBoundary(userName);
  const to   = new Date();
  const s    = await summarizeUserWindow(userName, from, to);

  res.json({
    userName,
    coveredFromTs: from,
    coveredToTs:   to,
    expected:      s.totals,
    billsCount:    s.billsCount,
    paymentsCount: s.totals.count,
    totalBilled:   s.totalBilled,
    totalDue:      s.totalDue,
    cashExpenses:  s.cashExpenses,
    // Suspense/exception bucket — unrecognized payment methods, excluded
    // from `expected` above. See LOCKED BUSINESS RULE #6.
    suspenseTotal: s.suspenseTotal,
    suspenseCount: s.suspenseItems.length,
    suspenseItems: s.suspenseItems,
    bills:         s.bills,
  });
});

// Drawer status for My Daily Summary card — returns latest close state.
dayCloseRouter.get("/my-drawer-status", async (req, res) => {
  const session  = (req as StaffAuthRequest).staffSession;
  const userName = session?.subjectName?.trim() ?? "";
  if (!userName) { res.status(401).json({ error: "Not authenticated" }); return; }

  // Get the last overall close boundary.
  const lastOverall = await lastClosureBoundary();

  // Get latest user close (if any, after the last overall close).
  const [latestUserClose] = await db
    .select()
    .from(userDayClosuresTable)
    .where(
      lastOverall
        ? and(eq(userDayClosuresTable.userName, userName), gt(userDayClosuresTable.closedAt, lastOverall))
        : eq(userDayClosuresTable.userName, userName),
    )
    .orderBy(desc(userDayClosuresTable.closedAt))
    .limit(1);

  if (!latestUserClose) {
    // No close for this window — compute expected from the open window.
    const from = lastOverall;
    const to   = new Date();
    const s    = await summarizeUserWindow(userName, from, to);
    const expectedDigital = s.totals.upi + s.totals.card + s.totals.cheque + s.totals.other;
    res.json({
      drawerStatus: "open",
      userName,
      coveredFromTs: from,
      coveredToTs: to,
      expectedCash: s.totals.cash,
      countedCash: null,
      cashVariance: null,
      expectedDigital,
      countedDigital: null,
      digitalVariance: null,
      expectedTotal: s.totals.total,
      actualTotal: null,
      totalVariance: null,
      closedAt: null,
      closedBy: null,
      handoverNote: null,
      approvedByName: null,
      approvalNote: null,
      // Suspense/exception bucket — unrecognized payment methods, already
      // excluded from expectedCash/expectedDigital above. LOCKED RULE #6.
      suspenseTotal: s.suspenseTotal,
      suspenseCount: s.suspenseItems.length,
    });
    return;
  }

  const exp    = n(latestUserClose.totalExpected);
  const act    = n(latestUserClose.totalActual);
  const v      = n(latestUserClose.variance);
  const expCash = n(latestUserClose.expectedCash);
  const actCash = n(latestUserClose.actualCash);
  const expDigital = n(latestUserClose.expectedUpi) + n(latestUserClose.expectedCard)
    + n(latestUserClose.expectedCheque) + n(latestUserClose.expectedOther);
  const actDigital = n(latestUserClose.actualUpi) + n(latestUserClose.actualCard)
    + n(latestUserClose.actualCheque) + n(latestUserClose.actualOther);

  res.json({
    drawerStatus:     latestUserClose.drawerStatus,
    userName,
    coveredFromTs:    latestUserClose.coveredFromTs,
    coveredToTs:      latestUserClose.coveredToTs,
    expectedCash:     expCash,
    countedCash:      actCash,
    cashVariance:     actCash - expCash,
    expectedDigital:  expDigital,
    countedDigital:   actDigital,
    digitalVariance:  actDigital - expDigital,
    expectedTotal:    exp,
    actualTotal:      act,
    totalVariance:    v,
    closedAt:         latestUserClose.closedAt,
    closedBy:         latestUserClose.userName,
    handoverNote:     latestUserClose.notes || null,
    approvedByName:   latestUserClose.approvedByName ?? null,
    approvalNote:     latestUserClose.approvalNote ?? null,
    closureId:        latestUserClose.id,
  });
});

// List: current user's past closures.
dayCloseRouter.get("/my-list", async (req, res) => {
  const session  = (req as StaffAuthRequest).staffSession;
  const userName = session?.subjectName?.trim() ?? "";
  if (!userName) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rows = await db
    .select()
    .from(userDayClosuresTable)
    .where(eq(userDayClosuresTable.userName, userName))
    .orderBy(desc(userDayClosuresTable.closedAt))
    .limit(60);

  res.json(rows);
});

const DenominationSchema = z.object({
  d500: z.coerce.number().int().min(0).default(0),
  d200: z.coerce.number().int().min(0).default(0),
  d100: z.coerce.number().int().min(0).default(0),
  d50:  z.coerce.number().int().min(0).default(0),
  d20:  z.coerce.number().int().min(0).default(0),
  d10:  z.coerce.number().int().min(0).default(0),
  coins: z.coerce.number().min(0).default(0),
}).optional();

const UserCloseBody = z.object({
  actuals: z.object({
    cash:   z.coerce.number().min(0).default(0),
    upi:    z.coerce.number().min(0).default(0),
    card:   z.coerce.number().min(0).default(0),
    cheque: z.coerce.number().min(0).default(0),
    other:  z.coerce.number().min(0).default(0),
  }),
  varianceNote: z.string().max(2000).default(""),
  notes:        z.string().max(2000).default(""),
  denominations: DenominationSchema,
});

function calcDenominationTotal(d: { d500:number; d200:number; d100:number; d50:number; d20:number; d10:number; coins:number }): number {
  return d.d500 * 500 + d.d200 * 200 + d.d100 * 100 + d.d50 * 50 + d.d20 * 20 + d.d10 * 10 + d.coins;
}

// Close: record the current user's day close snapshot.
dayCloseRouter.post("/my-close", async (req, res) => {
  const session  = (req as StaffAuthRequest).staffSession;
  const userName = session?.subjectName?.trim() ?? "";
  const userId   = session?.subjectId ?? null;
  const userRole = session?.role ?? "staff";
  if (!userName) { res.status(401).json({ error: "Not authenticated" }); return; }

  const parsed = UserCloseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const { actuals, varianceNote, notes, denominations } = parsed.data;

  const inserted = await db.transaction(async (tx) => {
    // Per-user advisory lock to prevent duplicate concurrent closes.
    const lockId = BigInt(
      Math.abs(userName.split("").reduce((a, c) => ((a * 31 + c.charCodeAt(0)) | 0), 0)),
    );
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);

    const from = await userWindowBoundary(userName);
    const to   = new Date();
    const s    = await summarizeUserWindow(userName, from, to);

    const totalExpected = s.totals.total;
    const totalActual   = actuals.cash + actuals.upi + actuals.card + actuals.cheque + actuals.other;
    const variance      = totalActual - totalExpected;

    const denominationTotal = denominations ? calcDenominationTotal(denominations) : null;

    // Determine drawer status
    const drawerStatus = variance === 0 ? "balanced" : "mismatch";

    const istDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(to);

    const [row] = await tx
      .insert(userDayClosuresTable)
      .values({
        userId,
        userName,
        closureDate:    istDate,
        closedAt:       to,
        coveredFromTs:  from,
        coveredToTs:    to,
        expectedCash:   String(s.totals.cash),
        expectedUpi:    String(s.totals.upi),
        expectedCard:   String(s.totals.card),
        expectedCheque: String(s.totals.cheque),
        expectedOther:  String(s.totals.other),
        totalExpected:  String(totalExpected),
        totalBilled:    String(s.totalBilled),
        totalDue:       String(s.totalDue),
        billsCount:     s.billsCount,
        paymentsCount:  s.totals.count,
        actualCash:     String(actuals.cash),
        actualUpi:      String(actuals.upi),
        actualCard:     String(actuals.card),
        actualCheque:   String(actuals.cheque),
        actualOther:    String(actuals.other),
        totalActual:    String(totalActual),
        variance:       String(variance),
        varianceNote,
        notes,
        denominations:  denominations ?? null,
        denominationTotal: denominationTotal !== null ? String(denominationTotal) : null,
        drawerStatus,
      })
      .returning();

    // Write audit log entry.
    await tx.insert(drawerAuditLogTable).values({
      userClosureId: row.id,
      action:        drawerStatus === "mismatch" ? "mismatch_detected" : "closed",
      userId,
      userName,
      userRole,
      expectedTotal: String(totalExpected),
      actualTotal:   String(totalActual),
      variance:      String(variance),
      reason:        varianceNote || "",
    });

    return { row, suspenseTotal: s.suspenseTotal, suspenseItems: s.suspenseItems };
  });

  req.log?.info({ closureId: inserted.row.id, userName, variance: inserted.row.variance, drawerStatus: inserted.row.drawerStatus }, "User day closed");
  if (inserted.suspenseItems.length > 0) {
    req.log?.warn(
      { closureId: inserted.row.id, userName, suspenseCount: inserted.suspenseItems.length, suspenseTotal: inserted.suspenseTotal },
      "User day closed with unrecognized-method payments excluded from totals — needs admin correction",
    );
  }
  res.status(201).json({
    ...inserted.row,
    suspenseTotal: inserted.suspenseTotal,
    suspenseCount: inserted.suspenseItems.length,
    suspenseItems: inserted.suspenseItems,
  });
});

// ── Admin actions on individual staff drawers ────────────────────────────────

// Enhanced staff-close status with per-row detail for the admin table.
dayCloseRouter.get("/staff-status", async (req, res) => {
  const session = (req as StaffAuthRequest).staffSession;
  if (!session || !OWNER_ROLES.has(session.role)) {
    res.status(403).json({ error: "Owner/admin access required" });
    return;
  }

  const lastOverall = await lastClosureBoundary();

  const activeUsers = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));

  const allUserCloses = await db
    .select()
    .from(userDayClosuresTable)
    .where(
      lastOverall
        ? gt(userDayClosuresTable.closedAt, lastOverall)
        : sql`1=1`,
    )
    .orderBy(desc(userDayClosuresTable.closedAt));

  const closeMap = new Map<string, typeof allUserCloses[number]>();
  for (const c of allUserCloses) {
    if (!closeMap.has(c.userName)) closeMap.set(c.userName, c);
  }

  const users = activeUsers.map((u) => {
    const close = closeMap.get(u.name);
    return {
      userId:           u.id,
      userName:         u.name,
      isClosed:         !!close,
      closedAt:         close?.closedAt ?? null,
      closureId:        close?.id ?? null,
      totalCollected:   n(close?.totalActual),
      totalBilled:      n(close?.totalBilled),
      variance:         n(close?.variance),
      drawerStatus:     close?.drawerStatus ?? "open",
      expectedCash:     n(close?.expectedCash),
      actualCash:       n(close?.actualCash),
      cashVariance:     close ? n(close.actualCash) - n(close.expectedCash) : null,
      expectedDigital:  close ? n(close.expectedUpi) + n(close.expectedCard) + n(close.expectedCheque) + n(close.expectedOther) : null,
      actualDigital:    close ? n(close.actualUpi) + n(close.actualCard) + n(close.actualCheque) + n(close.actualOther) : null,
      digitalVariance:  close
        ? (n(close.actualUpi) + n(close.actualCard) + n(close.actualCheque) + n(close.actualOther))
          - (n(close.expectedUpi) + n(close.expectedCard) + n(close.expectedCheque) + n(close.expectedOther))
        : null,
      approvedByName:   close?.approvedByName ?? null,
      approvedAt:       close?.approvedAt ?? null,
      handoverNote:     close?.notes ?? null,
    };
  });

  res.json({ users, lastOverallClose: lastOverall });
});

// Get full detail for a single user closure (admin).
dayCloseRouter.get("/staff-close-detail/:id", requireOwnerOrAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select()
    .from(userDayClosuresTable)
    .where(eq(userDayClosuresTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Approve a mismatch — admin/owner only.
const ApproveBody = z.object({ note: z.string().min(3).max(2000) });
dayCloseRouter.post("/staff-close/:id/approve-mismatch", requireOwnerOrAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = ApproveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Approval note required (min 3 chars)" }); return; }

  const session       = (req as StaffAuthRequest).staffSession;
  const approverName  = session?.subjectName ?? "Admin";
  const approverRole  = session?.role ?? "admin";
  const approverId    = session?.subjectId ?? null;
  const now           = new Date();

  const [updated] = await db
    .update(userDayClosuresTable)
    .set({
      drawerStatus:   "approved",
      approvedByName: approverName,
      approvedAt:     now,
      approvalNote:   parsed.data.note,
    })
    .where(and(eq(userDayClosuresTable.id, id), eq(userDayClosuresTable.drawerStatus, "mismatch")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Closure not found or not in mismatch state" });
    return;
  }

  await db.insert(drawerAuditLogTable).values({
    userClosureId: id,
    action:       "mismatch_approved",
    userId:       approverId,
    userName:     approverName,
    userRole:     approverRole,
    expectedTotal: updated.totalExpected,
    actualTotal:   updated.totalActual,
    variance:      updated.variance,
    reason:        parsed.data.note,
  });

  req.log?.info({ closureId: id, approvedBy: approverName }, "Drawer mismatch approved");
  res.json(updated);
});

// Reopen an individual staff drawer — SUPER-ADMIN only.
const StaffReopenBody = z.object({ reason: z.string().min(3).max(2000) });
dayCloseRouter.post("/staff-close/:id/reopen", requireSuperAdminStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = StaffReopenBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Reason required (min 3 chars)" }); return; }

  const session    = (req as StaffAuthRequest).staffSession;
  const reopener   = session?.subjectName ?? "Super-admin";
  const reopenerId = session?.subjectId ?? null;
  const now        = new Date();

  // We mark the drawer as "reopened" but do NOT delete the row — audit trail preserved.
  // A new my-close by the same user in the same window will create a NEW row.
  // To reset their window we just update drawerStatus to "reopened".
  const [updated] = await db
    .update(userDayClosuresTable)
    .set({
      drawerStatus:    "reopened",
      reopenedByName:  reopener,
      reopenedAt:      now,
      reopenReason:    parsed.data.reason,
    })
    .where(eq(userDayClosuresTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Closure not found" });
    return;
  }

  await db.insert(drawerAuditLogTable).values({
    userClosureId: id,
    action:       "drawer_reopened",
    userId:       reopenerId,
    userName:     reopener,
    userRole:     "super_admin",
    expectedTotal: updated.totalExpected,
    actualTotal:   updated.totalActual,
    variance:      updated.variance,
    reason:        parsed.data.reason,
  });

  req.log?.warn({ closureId: id, reopenedBy: reopener, targetUser: updated.userName }, "Staff drawer RE-OPENED by super-admin");
  res.json(updated);
});

// ── Post-Closure Activity (no lock — just visibility) ───────────────────────

/**
 * Find bills and payments created by `userName` AFTER their latest drawer
 * close (if any). Billing is never blocked — this data is only used for
 * the "Post-Closure Activity" callout shown to the staff member and admin.
 */
async function postClosureActivity(userName: string) {
  // Find the most recent ACTUAL close for this user (skip reopened rows).
  const [latestClose] = await db
    .select({
      id:        userDayClosuresTable.id,
      closedAt:  userDayClosuresTable.closedAt,
      drawerStatus: userDayClosuresTable.drawerStatus,
    })
    .from(userDayClosuresTable)
    .where(
      and(
        eq(userDayClosuresTable.userName, userName),
        sql`${userDayClosuresTable.drawerStatus} != 'reopened'`
      )
    )
    .orderBy(desc(userDayClosuresTable.closedAt))
    .limit(1);

  if (!latestClose) {
    return { closedAt: null, bills: [], payments: [], billTotal: 0, paymentTotal: 0 };
  }

  const since = new Date(latestClose.closedAt);

  const [bills, payments] = await Promise.all([
    db
      .select({
        id:          billsTable.id,
        billNumber:  billsTable.billNumber,
        totalAmount: billsTable.totalAmount,
        paidAmount:  billsTable.paidAmount,
        status:      billsTable.status,
        createdAt:   billsTable.createdAt,
      })
      .from(billsTable)
      .where(and(
        eq(billsTable.createdByName, userName),
        gt(billsTable.createdAt, since),
        sql`${billsTable.status} != 'cancelled'`,
      ))
      .orderBy(desc(billsTable.createdAt))
      .limit(50),

    db
      .select({
        id:        paymentsTable.id,
        billId:    paymentsTable.billId,
        amount:    paymentsTable.amount,
        method:    paymentsTable.method,
        createdAt: paymentsTable.createdAt,
      })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.recordedByName, userName),
        gt(paymentsTable.createdAt, since),
      ))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(100),
  ]);

  const billTotal    = bills.reduce((s, b) => s + n(b.totalAmount), 0);
  const paymentTotal = payments.reduce((s, p) => s + n(p.amount), 0);

  return {
    closedAt:     latestClose.closedAt,
    closureId:    latestClose.id,
    bills:        bills.map((b) => ({ ...b, totalAmount: n(b.totalAmount), paidAmount: n(b.paidAmount) })),
    payments:     payments.map((p) => ({ ...p, amount: n(p.amount) })),
    billTotal,
    paymentTotal,
  };
}

// GET /api/day-close/my-post-closure-activity — current user
dayCloseRouter.get("/my-post-closure-activity", async (req, res) => {
  const session  = (req as StaffAuthRequest).staffSession;
  const userName = session?.subjectName?.trim() ?? "";
  if (!userName) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json(await postClosureActivity(userName));
});

// GET /api/day-close/staff-post-closure-activity/:userName — admin/owner
dayCloseRouter.get("/staff-post-closure-activity/:userName", requireOwnerOrAdmin, async (req, res) => {
  const userName = decodeURIComponent(String(req.params.userName ?? "")).trim();
  if (!userName) { res.status(400).json({ error: "userName required" }); return; }
  res.json(await postClosureActivity(userName));
});

export default dayCloseRouter;
