import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  orderTestsTable,
  patientReportsTable,
  patientsTable,
  paymentsTable,
  testsTable,
} from "@workspace/db/schema";
import { desc, eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

const money = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

router.get("/:patientId/timeline", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    res.status(400).json({ error: "Invalid patient id" });
    return;
  }

  const [patient] = await db
    .select({
      id: patientsTable.id,
      patientId: patientsTable.patientId,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      gender: patientsTable.gender,
      phone: patientsTable.phone,
      createdAt: patientsTable.createdAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const [orders, bills, reports] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        status: ordersTable.status,
        totalAmount: ordersTable.totalAmount,
        collectedAt: ordersTable.collectedAt,
        completedAt: ordersTable.completedAt,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(eq(ordersTable.patientId, patientId))
      .orderBy(desc(ordersTable.createdAt))
      .limit(25),
    db
      .select({
        id: billsTable.id,
        billNumber: billsTable.billNumber,
        status: billsTable.status,
        totalAmount: billsTable.totalAmount,
        paidAmount: billsTable.paidAmount,
        balanceAmount: billsTable.balanceAmount,
        createdAt: billsTable.createdAt,
      })
      .from(billsTable)
      .where(eq(billsTable.patientId, patientId))
      .orderBy(desc(billsTable.createdAt))
      .limit(25),
    db
      .select({
        id: patientReportsTable.id,
        reportNumber: patientReportsTable.reportNumber,
        type: patientReportsTable.type,
        title: patientReportsTable.title,
        status: patientReportsTable.status,
        isCritical: patientReportsTable.isCritical,
        signedAt: patientReportsTable.signedAt,
        verifiedAt: patientReportsTable.verifiedAt,
        deliveredAt: patientReportsTable.deliveredAt,
        createdAt: patientReportsTable.createdAt,
      })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.patientId, patientId))
      .orderBy(desc(patientReportsTable.createdAt))
      .limit(25),
  ]);

  const orderIds = orders.map((o) => o.id);
  const [orderTests, payments] = await Promise.all([
    orders.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: orderTestsTable.id,
          orderId: orderTestsTable.orderId,
          status: orderTestsTable.status,
          displayName: orderTestsTable.displayName,
          testName: testsTable.name,
          department: testsTable.department,
        })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(inArray(orderTestsTable.orderId, orderIds)),
    bills.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: paymentsTable.id,
          billId: paymentsTable.billId,
          amount: paymentsTable.amount,
          method: paymentsTable.method,
          settlementStatus: paymentsTable.settlementStatus,
          createdAt: paymentsTable.createdAt,
        })
        .from(paymentsTable)
        .innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
        .where(eq(billsTable.patientId, patientId))
        .orderBy(desc(paymentsTable.createdAt))
        .limit(50),
  ]);

  const testsByOrder = new Map<number, typeof orderTests>();
  for (const t of orderTests) {
    const arr = testsByOrder.get(t.orderId) ?? [];
    arr.push(t);
    testsByOrder.set(t.orderId, arr);
  }

  const paymentsByBill = new Map<number, typeof payments>();
  for (const p of payments) {
    const arr = paymentsByBill.get(p.billId) ?? [];
    arr.push(p);
    paymentsByBill.set(p.billId, arr);
  }

  const events = [
    ...orders.map((o) => ({
      id: `order-${o.id}`,
      type: "order",
      at: iso(o.createdAt),
      title: `Order ${o.orderNumber}`,
      status: o.status,
      amount: money(o.totalAmount),
      href: `/orders/${o.id}`,
      detail: `${testsByOrder.get(o.id)?.length ?? 0} test(s)`,
      tests: (testsByOrder.get(o.id) ?? []).map((t) => ({
        id: t.id,
        name: t.displayName || t.testName || "Test",
        department: t.department,
        status: t.status,
      })),
      milestones: { collectedAt: iso(o.collectedAt), completedAt: iso(o.completedAt) },
    })),
    ...bills.map((b) => ({
      id: `bill-${b.id}`,
      type: "bill",
      at: iso(b.createdAt),
      title: `Bill ${b.billNumber}`,
      status: b.status,
      amount: money(b.totalAmount),
      href: `/billing/${b.id}`,
      detail: `Paid ${money(b.paidAmount).toLocaleString("en-IN")} / Due ${money(b.balanceAmount).toLocaleString("en-IN")}`,
      payments: (paymentsByBill.get(b.id) ?? []).map((p) => ({
        id: p.id,
        amount: money(p.amount),
        method: p.method,
        settlementStatus: p.settlementStatus,
        at: iso(p.createdAt),
      })),
    })),
    ...reports.map((r) => ({
      id: `report-${r.id}`,
      type: "report",
      at: iso(r.verifiedAt ?? r.signedAt ?? r.createdAt),
      title: r.title || `Report ${r.reportNumber}`,
      status: r.status,
      href: `/reports`,
      detail: `${r.type}${r.isCritical ? " · critical" : ""}`,
      milestones: { signedAt: iso(r.signedAt), verifiedAt: iso(r.verifiedAt), deliveredAt: iso(r.deliveredAt) },
    })),
  ].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

  res.json({
    patient: {
      ...patient,
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      createdAt: iso(patient.createdAt),
    },
    counts: { orders: orders.length, bills: bills.length, reports: reports.length, payments: payments.length },
    events,
  });
});

export default router;
