/**
 * Request-level: POST /api/bills/:id/waive-due converts unpaid balance to
 * discount without touching payments / refundAmount / cash.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  orderTestsTable,
  paymentsTable,
  billAuditsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("POST /api/bills/:id/waive-due", () => {
  let app: Express;
  let fx: BillingFixture;
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp();
    fx = await seedBillingFixture();
    await db
      .update(usersTable)
      .set({
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/payments"]),
        maxDiscount: "100",
      })
      .where(eq(usersTable.id, fx.userId));
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  }, 60_000);

  async function insertPartialBill(opts?: {
    subtotal?: number;
    paid?: number;
    refund?: number;
    discount?: number;
    status?: string;
  }) {
    seq += 1;
    const subtotal = opts?.subtotal ?? 18500;
    const paid = opts?.paid ?? 15000;
    const refund = opts?.refund ?? 0;
    const discount = opts?.discount ?? 0;
    const total = subtotal - discount;
    const balance = Math.max(0, total - paid - refund);
    const status =
      opts?.status ??
      (balance <= 0 ? "paid" : paid > 0 ? "partial" : "pending");

    const [order] = await db
      .insert(ordersTable)
      .values({
        patientId: fx.patientId,
        orderNumber: `ORD-WAIVE-${fx.marker}-${seq}`,
        status: "pending",
        totalAmount: String(subtotal),
      })
      .returning();
    await db.insert(orderTestsTable).values({
      orderId: order.id,
      testId: fx.testId,
      price: String(subtotal),
      status: "active",
    });
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BILL-WAIVE-${fx.marker}-${seq}`,
        orderId: order.id,
        patientId: fx.patientId,
        subtotal: String(subtotal),
        discount: String(discount),
        taxAmount: "0",
        totalAmount: String(total),
        paidAmount: String(paid),
        refundAmount: String(refund),
        balanceAmount: String(balance),
        status,
        originalTotal: String(subtotal),
        createdByName: fx.marker,
      })
      .returning();
    if (paid > 0) {
      await db.insert(paymentsTable).values({
        billId: bill.id,
        amount: String(paid),
        method: "cash",
        recordedByName: fx.marker,
      });
    }
    return bill;
  }

  test("CASE 1: waive unpaid ₹3500 → discount, paid unchanged, refund 0, PAID", async () => {
    const bill = await insertPartialBill();
    const res = await request(app)
      .post(`/api/bills/${bill.id}/waive-due`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "LESS BY SIR" });
    expect(res.status).toBe(200);
    expect(Number(res.body.discount)).toBe(3500);
    expect(Number(res.body.totalAmount)).toBe(15000);
    expect(Number(res.body.paidAmount)).toBe(15000);
    expect(Number(res.body.refundAmount ?? 0)).toBe(0);
    expect(Number(res.body.balanceAmount)).toBe(0);
    expect(res.body.status).toBe("paid");

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    expect(payments.every((p) => Number(p.amount) >= 0)).toBe(true);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]!.amount)).toBe(15000);

    const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, bill.id));
    expect(audits.some((a) => a.changeType === "balance_waived")).toBe(true);
    expect(audits.every((a) => a.changeType !== "refund_processed")).toBe(true);

    const [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row!.discountReason).toMatch(/LESS BY SIR/);
    expect(Number(row!.refundAmount)).toBe(0);
    expect(Number(row!.paidAmount)).toBe(15000);
  });

  test("CASE 2: no outstanding balance → 409", async () => {
    const bill = await insertPartialBill({ paid: 18500 });
    const res = await request(app)
      .post(`/api/bills/${bill.id}/waive-due`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "LESS BY SIR" });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/no outstanding balance/i);
  });

  test("CASE 3: already refunded bill → 409 and refund fields intact", async () => {
    const bill = await insertPartialBill({ paid: 11500, refund: 3500 });
    const before = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    const res = await request(app)
      .post(`/api/bills/${bill.id}/waive-due`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "LESS BY SIR" });
    expect(res.status).toBe(409);
    const [after] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(Number(after!.refundAmount)).toBe(Number(before[0]!.refundAmount));
    expect(Number(after!.paidAmount)).toBe(Number(before[0]!.paidAmount));
    expect(Number(after!.discount)).toBe(Number(before[0]!.discount));
  });

  test("CASE 4: repeated waive does not double-waive", async () => {
    const bill = await insertPartialBill();
    const first = await request(app)
      .post(`/api/bills/${bill.id}/waive-due`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "LESS BY SIR" });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/bills/${bill.id}/waive-due`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "LESS BY SIR again" });
    expect(second.status).toBe(409);
    const [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(Number(row!.discount)).toBe(3500);
    expect(Number(row!.refundAmount)).toBe(0);
  });

  test("CASE 5: real refund endpoint still creates negative payment + refundAmount", async () => {
    // /billing alone grants all billing subpermissions (see requireStaffSubPermission).
    const bill = await insertPartialBill({ paid: 18500 });
    const res = await request(app)
      .post(`/api/bills/${bill.id}/refund`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ amount: 500, reason: "patient returned", method: "cash", performedBy: "Vitest" });
    expect(res.status).toBe(200);
    expect(Number(res.body.refundAmount)).toBe(500);
    expect(Number(res.body.paidAmount)).toBe(18000);
    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    expect(payments.some((p) => Number(p.amount) < 0)).toBe(true);
    const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, bill.id));
    expect(audits.some((a) => a.changeType === "refund_processed")).toBe(true);
  });

  test("CASE 6/7: waiver does not increase refundAmount (day-close cash invariant)", async () => {
    const bill = await insertPartialBill();
    const res = await request(app)
      .post(`/api/bills/${bill.id}/waive-due`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ reason: "LESS BY SIR" });
    expect(res.status).toBe(200);
    expect(Number(res.body.refundAmount ?? 0)).toBe(0);
    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    const cashDelta = payments.reduce((s, p) => s + Number(p.amount), 0);
    expect(cashDelta).toBe(15000);
    const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, bill.id));
    expect(audits.some((a) => a.changeType === "balance_waived")).toBe(true);
    expect(audits.every((a) => a.changeType !== "refund_processed")).toBe(true);
  });
});
