/**
 * Request-level: POST /api/bills/:id/swap-test on a single-item bill.
 *
 * Clinic case: unpaid USG Abdomen ₹1500 → X-Ray ₹1000 must NOT invent a
 * cash refund for the ₹500 price drop. Paid bills only refund excess paid
 * over the new total.
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
  testsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("POST /api/bills/:id/swap-test — single-item", () => {
  let app: Express;
  let fx: BillingFixture;
  let cheapTestId: number;
  let expensiveTestId: number;
  let seq = 0;
  const extraTestIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    fx = await seedBillingFixture();

    const [expensive] = await db
      .insert(testsTable)
      .values({
        name: `USG Abdomen ${fx.marker}`,
        code: `USG${fx.marker.slice(-4).toUpperCase()}`,
        price: "1500.00",
        category: "Radiology",
        duration: "same day",
        isActive: true,
      })
      .returning();
    const [cheap] = await db
      .insert(testsTable)
      .values({
        name: `X-Ray Chest ${fx.marker}`,
        code: `XR${fx.marker.slice(-4).toUpperCase()}`,
        price: "1000.00",
        category: "Radiology",
        duration: "same day",
        isActive: true,
      })
      .returning();
    expensiveTestId = expensive.id;
    cheapTestId = cheap.id;
    extraTestIds.push(expensive.id, cheap.id);
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
    for (const id of extraTestIds) {
      await db.delete(testsTable).where(eq(testsTable.id, id)).catch(() => {});
    }
  }, 60_000);

  async function insertSingleItemBill(opts: {
    testId: number;
    price: number;
    paid?: number;
  }) {
    seq += 1;
    const price = opts.price;
    const paid = opts.paid ?? 0;
    const balance = Math.max(0, price - paid);
    const status = paid <= 0 ? "pending" : paid >= price ? "paid" : "partial";

    const [order] = await db
      .insert(ordersTable)
      .values({
        patientId: fx.patientId,
        orderNumber: `ORD-SWAP-${fx.marker}-${seq}`,
        status: "pending",
        totalAmount: String(price),
      })
      .returning();
    const [ot] = await db
      .insert(orderTestsTable)
      .values({
        orderId: order.id,
        testId: opts.testId,
        price: String(price),
        status: "active",
      })
      .returning();
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BILL-SWAP-${fx.marker}-${seq}`,
        orderId: order.id,
        patientId: fx.patientId,
        subtotal: String(price),
        discount: "0",
        taxAmount: "0",
        totalAmount: String(price),
        paidAmount: String(paid),
        refundAmount: "0",
        balanceAmount: String(balance),
        status,
        originalTotal: String(price),
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
    return { bill, orderTestId: ot.id };
  }

  test("CASE 1: unpaid ₹1500 → ₹1000 swap — no cash refund, balance due ₹1000", async () => {
    const { bill, orderTestId } = await insertSingleItemBill({
      testId: expensiveTestId,
      price: 1500,
      paid: 0,
    });

    const res = await request(app)
      .post(`/api/bills/${bill.id}/swap-test`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        orderTestId,
        newTestId: cheapTestId,
        reason: "Patient wants X-Ray instead of USG",
        performedBy: fx.marker,
      });

    expect(res.status).toBe(200);
    expect(Number(res.body.totalAmount)).toBe(1000);
    expect(Number(res.body.paidAmount)).toBe(0);
    expect(Number(res.body.refundAmount ?? 0)).toBe(0);
    expect(Number(res.body.balanceAmount)).toBe(1000);
    expect(res.body.status).toBe("pending");

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    expect(payments).toHaveLength(0);

    const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, bill.id));
    expect(audits.some((a) => a.changeType === "test_swapped")).toBe(true);
    expect(audits.every((a) => a.changeType !== "refund_processed")).toBe(true);

    const [ot] = await db.select().from(orderTestsTable).where(eq(orderTestsTable.id, orderTestId));
    expect(ot!.testId).toBe(cheapTestId);
    expect(Number(ot!.price)).toBe(1000);
    expect(ot!.status).toBe("active");
  });

  test("CASE 2: fully paid ₹1500 → ₹1000 swap — refund excess ₹500 only", async () => {
    const { bill, orderTestId } = await insertSingleItemBill({
      testId: expensiveTestId,
      price: 1500,
      paid: 1500,
    });

    const res = await request(app)
      .post(`/api/bills/${bill.id}/swap-test`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        orderTestId,
        newTestId: cheapTestId,
        reason: "Wrong modality booked",
        performedBy: fx.marker,
      });

    expect(res.status).toBe(200);
    expect(Number(res.body.totalAmount)).toBe(1000);
    expect(Number(res.body.paidAmount)).toBe(1000);
    expect(Number(res.body.refundAmount ?? 0)).toBe(500);
    expect(Number(res.body.balanceAmount)).toBe(0);
    expect(res.body.status).toBe("paid");

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    const refunds = payments.filter((p) => Number(p.amount) < 0);
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0]!.amount)).toBe(-500);

    const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, bill.id));
    expect(audits.some((a) => a.changeType === "test_swapped")).toBe(true);
    expect(audits.some((a) => a.changeType === "refund_processed")).toBe(true);
  });

  test("CASE 3: unpaid ₹1000 → ₹1500 swap — balance due rises, no auto cash collect", async () => {
    const { bill, orderTestId } = await insertSingleItemBill({
      testId: cheapTestId,
      price: 1000,
      paid: 0,
    });

    const res = await request(app)
      .post(`/api/bills/${bill.id}/swap-test`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        orderTestId,
        newTestId: expensiveTestId,
        reason: "Upgrade to USG",
        performedBy: fx.marker,
      });

    expect(res.status).toBe(200);
    expect(Number(res.body.totalAmount)).toBe(1500);
    expect(Number(res.body.paidAmount)).toBe(0);
    expect(Number(res.body.refundAmount ?? 0)).toBe(0);
    expect(Number(res.body.balanceAmount)).toBe(1500);

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    expect(payments).toHaveLength(0);
  });
});
