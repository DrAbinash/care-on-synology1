import { Router } from "express";
import { db } from "@workspace/db";
import {
  billsTable,
  paymentsTable,
  patientsTable,
  orderTestsTable,
  testsTable,
} from "@workspace/db/schema";
import { and, desc, eq, gte, ilike, lt, ne, or, sql } from "drizzle-orm";
import { todayIST } from "../lib/istDate";

/**
 * Mobile Bill Desk — READ-ONLY billing views for the diagno-booking-mobile
 * staff app.
 *
 * Deliberately its own router (never touching the frozen bills.ts) and its own
 * dedicated permission: mounted in index.ts behind
 *   requireStaffAuth + requireStaffPermission("/mobile-bill-desk")
 * so admins grant mobile billing visibility per staff member from
 * Settings → Users, independent of the desktop /billing permission.
 *
 * Every endpoint is a SELECT-only projection; no mutation of any financial
 * table happens here (see FINANCIAL_FREEZE_RULEBOOK.md).
 */

const mobileBillDeskRouter = Router();

function dayBoundsIST(dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T00:00:00+05:30`),
    end: new Date(`${dateStr}T23:59:59.999+05:30`),
  };
}

function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

const patientName = sql<string>`trim(${patientsTable.firstName} || ' ' || ${patientsTable.lastName})`;

// ── GET /api/mobile-bill-desk/summary?date=YYYY-MM-DD ────────────────────────
// Clinic-wide day snapshot: bill counts + totals + collections by method.
mobileBillDeskRouter.get("/summary", async (req, res) => {
  const date = typeof req.query.date === "string" && isValidDateStr(req.query.date)
    ? req.query.date
    : todayIST();
  const { start, end } = dayBoundsIST(date);

  const billWindow = and(gte(billsTable.createdAt, start), lt(billsTable.createdAt, end));
  const paymentWindow = and(gte(paymentsTable.createdAt, start), lt(paymentsTable.createdAt, end));

  const [[billAgg], byMethodRows] = await Promise.all([
    db
      .select({
        billCount: sql<number>`count(*)`,
        gross: sql<string>`coalesce(sum(${billsTable.totalAmount}), 0)`,
        paid: sql<string>`coalesce(sum(${billsTable.paidAmount}), 0)`,
        balance: sql<string>`coalesce(sum(${billsTable.balanceAmount}), 0)`,
        cancelled: sql<number>`count(*) filter (where ${billsTable.status} = 'cancelled')`,
      })
      .from(billsTable)
      .where(billWindow),
    db
      .select({
        method: paymentsTable.method,
        total: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(paymentsTable)
      .where(paymentWindow)
      .groupBy(paymentsTable.method)
      .orderBy(sql`sum(${paymentsTable.amount}) desc`),
  ]);

  const byMethod = byMethodRows.map((r) => ({
    method: r.method,
    total: Number(r.total ?? 0),
    count: Number(r.count),
  }));

  return res.json({
    date,
    billCount: Number(billAgg?.billCount ?? 0),
    cancelledCount: Number(billAgg?.cancelled ?? 0),
    grossBilled: Number(billAgg?.gross ?? 0),
    collected: Number(billAgg?.paid ?? 0),
    outstanding: Number(billAgg?.balance ?? 0),
    collectedToday: byMethod.reduce((s, m) => s + m.total, 0),
    byMethod,
  });
});

// ── GET /api/mobile-bill-desk/bills?date=&q=&page=&limit= ────────────────────
// Compact list. With q (≥2 chars) searches bill number / patient name / phone
// across all dates; otherwise lists the given day's bills (default today).
mobileBillDeskRouter.get("/bills", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  const conditions = [];
  if (q.length >= 2) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(billsTable.billNumber, like),
        ilike(patientsTable.phone, like),
        ilike(sql`${patientsTable.firstName} || ' ' || ${patientsTable.lastName}`, like),
      ),
    );
  } else {
    const date = typeof req.query.date === "string" && isValidDateStr(req.query.date)
      ? req.query.date
      : todayIST();
    const { start, end } = dayBoundsIST(date);
    conditions.push(gte(billsTable.createdAt, start), lt(billsTable.createdAt, end));
  }

  const where = and(...conditions);

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: billsTable.id,
        billNumber: billsTable.billNumber,
        patientName,
        phone: patientsTable.phone,
        totalAmount: billsTable.totalAmount,
        paidAmount: billsTable.paidAmount,
        balanceAmount: billsTable.balanceAmount,
        status: billsTable.status,
        createdByName: billsTable.createdByName,
        createdAt: billsTable.createdAt,
      })
      .from(billsTable)
      .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .where(where)
      .orderBy(desc(billsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: sql<number>`count(*)` })
      .from(billsTable)
      .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .where(where),
  ]);

  return res.json({
    bills: rows.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      balanceAmount: Number(r.balanceAmount),
    })),
    total: Number(countRow?.total ?? 0),
    page,
    limit,
  });
});

// ── GET /api/mobile-bill-desk/bills/:id ──────────────────────────────────────
// Single-bill detail: amounts, patient, line items, payment history.
mobileBillDeskRouter.get("/bills/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id));
  if (!bill) return res.status(404).json({ error: "Bill not found" });

  const [[patient], items, payments] = await Promise.all([
    db
      .select({ name: patientName, phone: patientsTable.phone })
      .from(patientsTable)
      .where(eq(patientsTable.id, bill.patientId)),
    // Cancelled tests are excluded from bill.subtotal/totalAmount (bills.ts
    // recalculates from active tests only on cancel/swap) — excluded here
    // too, so the line items staff sees always sum to the Subtotal shown
    // right below them instead of overstating it by the cancelled price.
    db
      .select({
        name: sql<string>`coalesce(${orderTestsTable.displayName}, ${testsTable.name}, 'Item')`,
        price: orderTestsTable.price,
      })
      .from(orderTestsTable)
      .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
      .where(and(eq(orderTestsTable.orderId, bill.orderId), ne(orderTestsTable.status, "cancelled"))),
    db
      .select({
        id: paymentsTable.id,
        amount: paymentsTable.amount,
        method: paymentsTable.method,
        referenceNumber: paymentsTable.referenceNumber,
        recordedByName: paymentsTable.recordedByName,
        createdAt: paymentsTable.createdAt,
      })
      .from(paymentsTable)
      .where(eq(paymentsTable.billId, id))
      .orderBy(desc(paymentsTable.createdAt)),
  ]);

  return res.json({
    id: bill.id,
    billNumber: bill.billNumber,
    status: bill.status,
    createdAt: bill.createdAt,
    createdByName: bill.createdByName,
    subtotal: Number(bill.subtotal),
    discount: Number(bill.discount),
    taxAmount: Number(bill.taxAmount),
    totalAmount: Number(bill.totalAmount),
    paidAmount: Number(bill.paidAmount),
    balanceAmount: Number(bill.balanceAmount),
    refundAmount: Number(bill.refundAmount),
    cancelledAt: bill.cancelledAt,
    cancellationReason: bill.cancellationReason,
    patient: patient ? { name: patient.name, phone: patient.phone } : null,
    items: items.map((i) => ({ name: i.name, price: Number(i.price) })),
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  });
});

export { mobileBillDeskRouter };
