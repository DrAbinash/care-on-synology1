/**
 * Cancelled bills are terminal for normal money mutation.
 *
 * Guards:
 *   - POST /api/payments → 409, status stays cancelled, balance 0
 *   - PUT /api/bills/:id discount → 409
 *
 * Gateway settleBill coverage lives in gateway-webhooks.settle.test.ts
 * (production ICICI webhook handler).
 *
 * Bills are seeded via Drizzle (not billing/save) so tests do not depend on
 * next_order_number_seq omitted by local db:push.
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
  usersTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("Cancelled bill terminal-state invariant", () => {
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

  async function insertBill(opts: {
    paidAmount?: number;
    status?: "pending" | "partial" | "paid";
  } = {}) {
    seq += 1;
    const price = fx.testPrice;
    const paid = opts.paidAmount ?? 0;
    const status =
      opts.status ??
      (paid <= 0 ? "pending" : paid >= price ? "paid" : "partial");
    const [order] = await db
      .insert(ordersTable)
      .values({
        patientId: fx.patientId,
        orderNumber: `ORD-TERM-${fx.marker}-${seq}`,
        status: "pending",
        totalAmount: String(price),
      })
      .returning();
    await db.insert(orderTestsTable).values({
      orderId: order.id,
      testId: fx.testId,
      price: String(price),
      status: "active",
    });
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BILL-TERM-${fx.marker}-${seq}`,
        orderId: order.id,
        patientId: fx.patientId,
        subtotal: String(price),
        discount: "0",
        taxAmount: "0",
        totalAmount: String(price),
        paidAmount: String(paid),
        refundAmount: "0",
        balanceAmount: String(Math.max(0, price - paid)),
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
    return bill;
  }

  async function cancelBill(billId: number, body: Record<string, unknown> = {}) {
    const res = await request(app)
      .post(`/api/bills/${billId}/cancel`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        reason: "terminal-state test cancel",
        performedBy: fx.marker,
        ...body,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    return res.body;
  }

  test("1) unpaid → cancel → payment rejected; bill stays cancelled with balance 0", async () => {
    const bill = await insertBill();
    await cancelBill(bill.id);

    const pay = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ billId: bill.id, amount: fx.testPrice, method: "cash" });

    expect(pay.status).toBe(409);
    expect(String(pay.body.error)).toMatch(/cancelled/i);

    const [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row.status).toBe("cancelled");
    expect(Number(row.balanceAmount)).toBe(0);
    expect(Number(row.paidAmount)).toBe(0);

    const pays = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id));
    expect(pays.filter((p) => Number(p.amount) > 0)).toHaveLength(0);
  });

  test("2) partial → cancel with autoRefund → further payment rejected; stays cancelled", async () => {
    const half = Math.floor(fx.testPrice / 2);
    const bill = await insertBill({ paidAmount: half, status: "partial" });
    await cancelBill(bill.id, { autoRefund: { method: "cash" } });

    const pay = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ billId: bill.id, amount: Math.max(1, fx.testPrice - half), method: "cash" });

    expect(pay.status).toBe(409);
    const [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row.status).toBe("cancelled");
    expect(Number(row.balanceAmount)).toBe(0);
  });

  test("4) cancelled unpaid → discount PUT rejected; status cancelled, balance 0", async () => {
    const bill = await insertBill();
    await cancelBill(bill.id);

    const res = await request(app)
      .put(`/api/bills/${bill.id}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ discount: 10, reason: "should fail", editedBy: "vitest" });

    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/cancelled/i);

    const [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row.status).toBe("cancelled");
    expect(Number(row.balanceAmount)).toBe(0);
    expect(Number(row.discount)).toBe(0);
  });

  test("5a) normal pending → paid still works", async () => {
    const bill = await insertBill();
    const pay = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ billId: bill.id, amount: fx.testPrice, method: "cash" });
    expect(pay.status).toBe(201);
    const [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row.status).toBe("paid");
  });

  test("5b) normal pending → partial → paid still works", async () => {
    const bill = await insertBill();
    const half = Math.floor(fx.testPrice / 2);
    const rest = fx.testPrice - half;
    const p1 = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ billId: bill.id, amount: half, method: "cash" });
    expect(p1.status).toBe(201);
    let [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row.status).toBe("partial");

    const p2 = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ billId: bill.id, amount: rest, method: "cash" });
    expect(p2.status).toBe(201);
    [row] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(row.status).toBe("paid");
  });

  test("5c) dedicated cancel still works on unpaid bill", async () => {
    const bill = await insertBill();
    const res = await cancelBill(bill.id);
    expect(res.status).toBe("cancelled");
    expect(Number(res.balanceAmount)).toBe(0);
  });
});
