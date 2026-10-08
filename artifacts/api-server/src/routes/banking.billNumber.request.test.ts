/**
 * Request-level: /api/banking/fraud/alerts and /api/banking/refunds must name the
 * bill they point at, and must not lose a column while doing it.
 *
 * Two things here cannot be proven by reading the route:
 *  1. the hand-written `bills.id = COALESCE(alert.bill_id, payment.bill_id)` join —
 *     an alert often names only the payment it flagged, so the bill has to be read
 *     through that payment, and a join written wrong returns NULL silently instead
 *     of erroring;
 *  2. `db.select()` became `db.select({ ...getTableColumns(fraudAlertsTable), … })`
 *     to add the number. If the spread were missed, every other column of the alert
 *     would vanish from the response and the Banking UI would render an empty table.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  usersTable,
  patientsTable,
  ordersTable,
  billsTable,
  paymentsTable,
  fraudAlertsTable,
  refundRequestsTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

describe.skipIf(!hasDatabaseUrl())("banking alerts and refund requests name their bill", () => {
  let app: Express;
  const marker = `vitest-bank-${randomUUID().slice(0, 8)}`;
  let staffName = "";
  let token = "";
  let patientId = 0;
  let orderId = 0;
  let billId = 0;
  let paymentId = 0;
  let alertByBill = 0;
  let alertByPayment = 0;
  let alertOrphan = 0;
  let refundRequestId = 0;
  const billNumber = `BILL-${marker}`;

  beforeAll(async () => {
    app = await createTestApp();
    staffName = `Bank Teller ${marker}`;

    const [staff] = await db
      .insert(usersTable)
      .values({
        name: staffName,
        email: `bank-${marker}@vitest.invalid`,
        username: `bank-${marker}`,
        role: "admin",
        permissions: JSON.stringify(["/banking", "/reports", "/dashboard"]),
        pin: "4444",
        isActive: true,
      })
      .returning();
    token = `vitest-token-bank-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: staff.id,
      subjectName: staff.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `VB-${marker}`,
        firstName: "Vitest",
        lastName: `Bank ${marker}`,
        dateOfBirth: "1990-01-01",
        gender: "male",
        phone: "9000000003",
      })
      .returning();
    patientId = patient.id;

    // billsTable.orderId is NOT NULL — the bill has to hang off a real order.
    const [order] = await db
      .insert(ordersTable)
      .values({
        orderNumber: `VB-${marker}`,
        patientId,
        status: "completed",
        totalAmount: "1500",
      })
      .returning();
    orderId = order.id;

    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber,
        orderId,
        patientId,
        subtotal: "1500",
        discount: "0",
        taxAmount: "0",
        totalAmount: "1500",
        paidAmount: "1500",
        refundAmount: "0",
        balanceAmount: "0",
        status: "paid",
        createdByName: staffName,
      })
      .returning();
    billId = bill.id;

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        billId,
        amount: "1500",
        method: "upi",
        notes: `gateway collection ${marker}`,
        recordedByName: staffName,
      })
      .returning();
    paymentId = payment.id;

    const [a1] = await db
      .insert(fraudAlertsTable)
      .values({
        alertType: "collection_mismatch",
        severity: "high",
        status: "open",
        billId,
        title: `By bill ${marker}`,
        description: `alert naming the bill ${marker}`,
        affectedAmount: "1500",
      })
      .returning();
    alertByBill = a1.id;

    // The shape a grep cannot see: no bill id at all, only the payment.
    const [a2] = await db
      .insert(fraudAlertsTable)
      .values({
        alertType: "duplicate_utr",
        severity: "critical",
        status: "open",
        paymentId,
        title: `By payment ${marker}`,
        description: `alert naming only the payment ${marker}`,
        affectedAmount: "1500",
      })
      .returning();
    alertByPayment = a2.id;

    const [a3] = await db
      .insert(fraudAlertsTable)
      .values({
        alertType: "unusual_timing",
        severity: "low",
        status: "open",
        title: `No bill ${marker}`,
        description: `alert tied to no bill and no payment ${marker}`,
      })
      .returning();
    alertOrphan = a3.id;

    const [rr] = await db
      .insert(refundRequestsTable)
      .values({
        billId,
        paymentId,
        amount: "400",
        reason: `partial refund requested ${marker}`,
        requestedBy: staffName,
      })
      .returning();
    refundRequestId = rr.id;
  }, 120_000);

  afterAll(async () => {
    for (const id of [alertByBill, alertByPayment, alertOrphan]) {
      if (id) await db.delete(fraudAlertsTable).where(eq(fraudAlertsTable.id, id)).catch(() => {});
    }
    if (refundRequestId) {
      await db.delete(refundRequestsTable).where(eq(refundRequestsTable.id, refundRequestId)).catch(() => {});
    }
    if (paymentId) await db.delete(paymentsTable).where(eq(paymentsTable.id, paymentId)).catch(() => {});
    if (billId) await db.delete(billsTable).where(eq(billsTable.id, billId)).catch(() => {});
    if (orderId) await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.email, `%${marker}@vitest.invalid`)).catch(() => {});
  }, 60_000);

  test("an alert resolves its bill whether it names the bill or only the payment", async () => {
    const res = await request(app)
      .get("/api/banking/fraud/alerts?limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const byId = new Map((res.body as any[]).map((a) => [a.id, a]));

    expect(byId.get(alertByBill)?.billNumber).toBe(billNumber);
    expect(byId.get(alertByPayment)?.billNumber).toBe(billNumber);
    // Nothing to invent a number from: NULL, not the row id dressed up as one.
    expect(byId.get(alertOrphan)?.billNumber).toBeNull();
  });

  test("the explicit column list kept every column the screen reads", async () => {
    const res = await request(app)
      .get("/api/banking/fraud/alerts?limit=200")
      .set("Authorization", `Bearer ${token}`);
    const alert = (res.body as any[]).find((a) => a.id === alertByPayment);
    expect(alert).toBeTruthy();
    for (const column of [
      "id", "alertType", "severity", "status", "billId", "paymentId",
      "title", "description", "affectedAmount", "createdAt",
    ]) {
      expect(alert, `${column} must still be in the response`).toHaveProperty(column);
    }
    expect(alert.alertType).toBe("duplicate_utr");
    expect(alert.description).toContain(marker);
  });

  test("a requested refund names the bill it is against", async () => {
    const res = await request(app)
      .get("/api/banking/refunds?limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const rr = (res.body as any[]).find((r) => r.id === refundRequestId);
    expect(rr).toBeTruthy();
    expect(rr.billNumber).toBe(billNumber);
    expect(rr.reason).toBe(`partial refund requested ${marker}`);
  });
});
