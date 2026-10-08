/**
 * Request-level: /api/daily-summary refunds must carry the facts the two screens
 * that read it (Dashboard → Control Logs, and the Daily Summary report) render,
 * and the joins that fetch those facts must not touch the money.
 *
 * Why a request test and not a source grep: the refund rows now come out of a
 * four-table join, and the only way to know a join neither loses a row nor
 * counts one twice is to run it against Postgres and read the totals.
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
  billsTable,
  ordersTable,
  paymentsTable,
  doctorsTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { todayIST } from "../lib/istDate";

describe.skipIf(!hasDatabaseUrl())(
  "daily-summary refund rows — bill number, referral, reason, and untouched money",
  () => {
    let app: Express;
    const marker = `vitest-refund-${randomUUID().slice(0, 8)}`;
    let staffName = "";
    let staffToken = "";
    let patientId = 0;
    let doctorId = 0;
    let doctorName = "";
    let orderId = 0;
    let oldOrderId = 0;
    let billA = 0;
    let billB = 0;

    const paidToday = 2000;
    const refundA1 = 500;
    const refundA2 = 300;
    const oldBillPaid = 700;
    const refundB = 200;

    beforeAll(async () => {
      app = await createTestApp();
      staffName = `Rina Refundclerk ${marker}`;

      const [staff] = await db
        .insert(usersTable)
        .values({
          name: staffName,
          email: `refund-${marker}@vitest.invalid`,
          username: `refund-${marker}`,
          role: "receptionist",
          permissions: JSON.stringify(["/reports", "/billing", "/dashboard"]),
          pin: "3333",
          isActive: true,
        })
        .returning();
      staffToken = `vitest-token-refund-${randomUUID()}`;
      await db.insert(portalSessionsTable).values({
        token: staffToken,
        scope: "staff",
        subjectId: staff.id,
        subjectName: staff.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const [patient] = await db
        .insert(patientsTable)
        .values({
          patientId: `VT-${marker}`,
          firstName: "Vitest",
          lastName: `Refund ${marker}`,
          dateOfBirth: "1990-01-01",
          gender: "female",
          phone: "9000000002",
        })
        .returning();
      patientId = patient.id;

      doctorName = `Dr Referral ${marker}`;
      const [doctor] = await db
        .insert(doctorsTable)
        .values({ name: doctorName, specialization: "General Medicine" })
        .returning();
      doctorId = doctor.id;

      const [order] = await db
        .insert(ordersTable)
        .values({
          orderNumber: `ORD-${marker}`,
          patientId,
          doctorId,
          status: "completed",
          totalAmount: String(paidToday),
        })
        .returning();
      orderId = order.id;

      const [a] = await db
        .insert(billsTable)
        .values({
          billNumber: `BILL-${marker}-A`,
          orderId,
          patientId,
          subtotal: String(paidToday),
          discount: "0",
          taxAmount: "0",
          totalAmount: String(paidToday),
          paidAmount: String(paidToday),
          refundAmount: "0",
          balanceAmount: "0",
          status: "paid",
          createdByName: staffName,
        })
        .returning();
      billA = a.id;

      // A bill raised on an earlier day, settled and part-refunded today: the
      // screens badge this as "of <date>", which only works if the row carries
      // the bill's own createdAt and not just the refund's.
      // billsTable.orderId is NOT NULL, so the earlier bill needs its own order.
      const [oldOrder] = await db
        .insert(ordersTable)
        .values({
          orderNumber: `OLD-${marker}`,
          patientId,
          doctorId,
          status: "completed",
          totalAmount: String(oldBillPaid),
        })
        .returning();
      oldOrderId = oldOrder.id;

      const [b] = await db
        .insert(billsTable)
        .values({
          billNumber: `BILL-${marker}-B`,
          orderId: oldOrderId,
          patientId,
          subtotal: String(oldBillPaid),
          discount: "0",
          taxAmount: "0",
          totalAmount: String(oldBillPaid),
          paidAmount: String(oldBillPaid),
          refundAmount: "0",
          balanceAmount: "0",
          status: "paid",
          createdByName: staffName,
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        })
        .returning();
      billB = b.id;

      await db.insert(paymentsTable).values([
        {
          billId: billA,
          amount: String(paidToday),
          method: "cash",
          notes: `collection ${marker}`,
          recordedByName: staffName,
        },
        {
          billId: billA,
          amount: String(-refundA1),
          method: "cash",
          notes: `REFUND: patient could not come for the sample ${marker}`,
          recordedByName: staffName,
        },
        {
          billId: billA,
          amount: String(-refundA2),
          method: "upi",
          notes: `REFUND on cancellation: MRI dropped, UPI back ${marker}`,
          recordedByName: staffName,
        },
        {
          billId: billB,
          amount: String(oldBillPaid),
          method: "cash",
          notes: `old due collected ${marker}`,
          recordedByName: staffName,
        },
        {
          billId: billB,
          amount: String(-refundB),
          method: "cash",
          notes: `Refund for test swap: haemoglobin replaced by CBC ${marker}`,
          recordedByName: staffName,
        },
      ]);
    }, 120_000);

    afterAll(async () => {
      for (const id of [billA, billB]) {
        if (id) await db.delete(paymentsTable).where(eq(paymentsTable.billId, id)).catch(() => {});
      }
      if (billA) await db.delete(billsTable).where(eq(billsTable.id, billA)).catch(() => {});
      if (billB) await db.delete(billsTable).where(eq(billsTable.id, billB)).catch(() => {});
      if (orderId) await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
      if (oldOrderId) await db.delete(ordersTable).where(eq(ordersTable.id, oldOrderId)).catch(() => {});
      if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
      if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId)).catch(() => {});
      if (staffToken) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, staffToken)).catch(() => {});
      await db.delete(usersTable).where(like(usersTable.email, `%${marker}@vitest.invalid`)).catch(() => {});
    }, 60_000);

    async function getSummary() {
      const res = await request(app)
        .get(`/api/daily-summary?date=${todayIST()}&staffName=${encodeURIComponent(staffName)}`)
        .set("Authorization", `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      return res.body;
    }

    test("each refund row names the bill, the patient, the referral and the reason", async () => {
      const body = await getSummary();
      const mine = body.refunds as any[];
      expect(mine).toHaveLength(4);

      const byBill = new Map(mine.map((r) => [`${r.billId}:${r.amount}`, r]));
      const first = byBill.get(`${billA}:${refundA1}`);
      expect(first).toBeTruthy();
      expect(first.billNumber).toBe(`BILL-${marker}-A`);
      expect(first.billNumber).not.toBe(String(billA));
      expect(first.patientName).toBe(`Vitest Refund ${marker}`);
      expect(first.referringDoctor).toBe(doctorName);
      expect(first.refundKind).toBe("refund");
      // The note's own `REFUND: ` label is not part of the reason a person reads.
      expect(first.reason).toBe(`patient could not come for the sample ${marker}`);

      const second = byBill.get(`${billA}:${refundA2}`);
      expect(second.refundKind).toBe("cancellation");
      expect(second.reason).toBe(`MRI dropped, UPI back ${marker}`);

      // A refund on a bill raised three days ago still prints that bill's number,
      // and carries the bill's own date so the screen can badge "of <date>".
      const swapped = byBill.get(`${billB}:${refundB}`);
      expect(swapped.billNumber).toBe(`BILL-${marker}-B`);
      expect(swapped.refundKind).toBe("test-swap");
      expect(new Date(swapped.billCreatedAt).getTime()).toBeLessThan(
        new Date(swapped.createdAt).getTime() - 2 * 24 * 60 * 60 * 1000,
      );
    });

    test("the four-table join did not move a single rupee", async () => {
      const body = await getSummary();
      const s = body.summary;
      // Money in: today's new bill + the old bill's dues, counted once each.
      expect(s.cashCollection).toBeCloseTo(paidToday + oldBillPaid, 2);
      expect(s.totalReceived).toBeCloseTo(paidToday + oldBillPaid, 2);
      // Money out: both cash refunds, and the UPI one only in the digital/refund split.
      expect(s.totalRefunded).toBeCloseTo(refundA1 + refundA2 + refundB, 2);
      expect(s.cashRefunded).toBeCloseTo(refundA1 + refundB, 2);
      expect(s.physicalCashInHand).toBeCloseTo(paidToday + oldBillPaid - refundA1 - refundB, 2);
      // A join that multiplied payment rows would show up here as a doubled refund.
      expect(s.backdatedRefunds).toBeCloseTo(refundB, 2);
      expect(s.sameDayRefunds).toBeCloseTo(refundA1 + refundA2, 2);
    });

    test("the bill list and the refund list agree on the same bill number", async () => {
      const body = await getSummary();
      const a = body.bills.find((b: any) => b.id === billA);
      const refundOnA = body.refunds.find((r: any) => r.billId === billA);
      expect(a).toBeTruthy();
      expect(refundOnA.billNumber).toBe(a.billNumber);
    });
  },
);
