/**
 * P0-1 — generic PUT /api/bills/:id must not accept status transitions.
 * Cancellation / payment / refund have dedicated routes with cascade side effects.
 *
 * Bills are inserted via Drizzle (not POST /api/billing/save) so these tests
 * do not depend on SQL helpers like next_order_number_seq that db:push omits.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import {
  seedBillingFixture,
  type BillingFixture,
} from "../testSupport/billingFixtures";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  orderTestsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)(
  "P0-1 PUT /api/bills/:id — no generic status mutation",
  () => {
    let app: Express;
    let fx: BillingFixture;
    let seq = 0;

    beforeAll(async () => {
      app = await createTestApp();
      fx = await seedBillingFixture();
      // Payment collection lives on /api/payments (module permission "/payments").
      // maxDiscount allows the discount-edit regression without needing admin role.
      await db
        .update(usersTable)
        .set({
          permissions: JSON.stringify([
            "/orders",
            "/billing",
            "/patients",
            "/payments",
          ]),
          maxDiscount: "50",
        })
        .where(eq(usersTable.id, fx.userId));
    }, 60_000);

    afterAll(async () => {
      await fx?.cleanup();
    }, 60_000);

    async function insertBill(opts: { paid?: boolean } = {}) {
      seq += 1;
      const price = fx.testPrice;
      const paid = opts.paid ? price : 0;
      const [order] = await db
        .insert(ordersTable)
        .values({
          patientId: fx.patientId,
          orderNumber: `ORD-P01-${fx.marker}-${seq}`,
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
          billNumber: `BILL-P01-${fx.marker}-${seq}`,
          orderId: order.id,
          patientId: fx.patientId,
          subtotal: String(price),
          discount: "0",
          taxAmount: "0",
          totalAmount: String(price),
          paidAmount: String(paid),
          refundAmount: "0",
          balanceAmount: String(price - paid),
          status: opts.paid ? "paid" : "pending",
          originalTotal: String(price),
        })
        .returning();
      return {
        id: bill.id,
        status: bill.status,
        discount: Number(bill.discount),
        totalAmount: Number(bill.totalAmount),
        paidAmount: Number(bill.paidAmount),
        orderId: order.id,
        dueDate: bill.dueDate,
      };
    }

    test("generic PUT cannot mark a bill paid (status stripped / no-op)", async () => {
      const bill = await insertBill();
      expect(bill.status).not.toBe("paid");

      const res = await request(app)
        .put(`/api/bills/${bill.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({
          status: "paid",
          reason: "p0-1 paid bypass",
          editedBy: "vitest",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).not.toBe("paid");
      const [row] = await db
        .select()
        .from(billsTable)
        .where(eq(billsTable.id, bill.id));
      expect(row.status).toBe("pending");
    });

    test("generic PUT cannot cancel a bill", async () => {
      const bill = await insertBill();

      const res = await request(app)
        .put(`/api/bills/${bill.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({
          status: "cancelled",
          reason: "p0-1 cancel bypass",
          editedBy: "vitest",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).not.toBe("cancelled");
      const [row] = await db
        .select()
        .from(billsTable)
        .where(eq(billsTable.id, bill.id));
      expect(row.status).toBe("pending");
      expect(row.cancelledAt).toBeNull();
    });

    test("discount editing continues working", async () => {
      const bill = await insertBill();
      const newDiscount = Math.min(50, Math.floor(fx.testPrice / 4));

      const res = await request(app)
        .put(`/api/bills/${bill.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ discount: newDiscount, reason: "loyalty", editedBy: "vitest" });

      expect(res.status).toBe(200);
      expect(Number(res.body.discount)).toBeCloseTo(newDiscount, 2);
      expect(res.body.status).toBe(bill.status);
    });

    test("dueDate editing continues working", async () => {
      const bill = await insertBill();
      const dueDate = "2099-12-31";

      const res = await request(app)
        .put(`/api/bills/${bill.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ dueDate, reason: "extend due", editedBy: "vitest" });

      expect(res.status).toBe(200);
      expect(
        res.body.dueDate === dueDate ||
          String(res.body.dueDate).startsWith("2099-12-31"),
      ).toBe(true);
    });

    test("dedicated cancel still cascades order_tests", async () => {
      const bill = await insertBill();

      const res = await request(app)
        .post(`/api/bills/${bill.id}/cancel`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({
          performedBy: "Vitest Cancel",
          reason: "p0-1 cancel cascade check",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");

      const ots = await db
        .select({ status: orderTestsTable.status })
        .from(orderTestsTable)
        .where(eq(orderTestsTable.orderId, bill.orderId));
      expect(ots.length).toBeGreaterThan(0);
      expect(ots.every((t) => t.status === "cancelled")).toBe(true);
    });

    test("payment workflow still marks paid (not via PUT)", async () => {
      const bill = await insertBill();
      expect(bill.status).toBe("pending");

      const pay = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${fx.token}`)
        .send({
          billId: bill.id,
          amount: fx.testPrice,
          method: "cash",
          notes: "p0-1 payment path",
        });

      expect(pay.status).toBe(201);
      const [row] = await db
        .select()
        .from(billsTable)
        .where(eq(billsTable.id, bill.id));
      expect(row.status).toBe("paid");
      expect(Number(row.paidAmount)).toBeCloseTo(fx.testPrice, 2);
    });
  },
);
