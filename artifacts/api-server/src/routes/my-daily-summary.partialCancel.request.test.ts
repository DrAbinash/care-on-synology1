/**
 * Request-level: partial test cancel must not change the bill creator's
 * daily-summary collectible / expected cash. Regression for the Short ₹1500
 * bug when Abinash cancels tests on Vijay's paid bill.
 *
 * Seeds order/bill/payment rows directly (avoids bill-number sequence deps)
 * then exercises cancel-refund-tests + my-daily-summary.
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
  testsTable,
  billsTable,
  ordersTable,
  orderTestsTable,
  paymentsTable,
  billAuditsTable,
  vouchersTable,
  doctorsTable,
} from "@workspace/db/schema";
import { eq, inArray, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("partial test-cancel attribution — my-daily-summary", () => {
  let app: Express;
  const marker = `vitest-pcancel-${randomUUID().slice(0, 8)}`;
  let vijayToken = "";
  let abinashToken = "";
  let vijayName = "";
  let abinashName = "";
  let patientId = 0;
  let doctorId = 0;
  let doctorName = "";
  let testKeepId = 0;
  let testCancelId = 0;
  let billId = 0;
  let orderId = 0;
  let cancelOtId = 0;
  const keepPrice = 8500;
  const cancelPrice = 1500;
  const totalPrice = keepPrice + cancelPrice;

  beforeAll(async () => {
    app = await createTestApp();

    vijayName = `Vijay Yadav ${marker}`;
    abinashName = `Dr Abinash Kumar ${marker}`;

    const [vijay] = await db
      .insert(usersTable)
      .values({
        name: vijayName,
        email: `vijay-${marker}@vitest.invalid`,
        username: `vijay-${marker}`,
        role: "receptionist",
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/dashboard", "/my-daily-summary"]),
        pin: "1111",
        isActive: true,
      })
      .returning();
    const [abinash] = await db
      .insert(usersTable)
      .values({
        name: abinashName,
        email: `abinash-${marker}@vitest.invalid`,
        username: `abinash-${marker}`,
        role: "receptionist",
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/dashboard", "/my-daily-summary"]),
        pin: "2222",
        isActive: true,
      })
      .returning();

    vijayToken = `vitest-token-vijay-${randomUUID()}`;
    abinashToken = `vitest-token-abinash-${randomUUID()}`;
    await db.insert(portalSessionsTable).values([
      {
        token: vijayToken,
        scope: "staff",
        subjectId: vijay.id,
        subjectName: vijay.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        token: abinashToken,
        scope: "staff",
        subjectId: abinash.id,
        subjectName: abinash.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `VT-${marker}`,
        firstName: "Vitest",
        lastName: `PartialCancel ${marker}`,
        dateOfBirth: "1990-01-01",
        gender: "male",
        phone: "9000000001",
      })
      .returning();
    patientId = patient.id;

    // A referring doctor on the order, so the refund row can be checked for the
    // name the activity log is supposed to show without opening the bill.
    doctorName = `Dr Referral ${marker}`;
    const [doctor] = await db
      .insert(doctorsTable)
      .values({ name: doctorName, specialization: "General Medicine" })
      .returning();
    doctorId = doctor.id;

    const [tKeep] = await db
      .insert(testsTable)
      .values({
        name: `Keep Test ${marker}`,
        code: `K${marker.slice(-6).toUpperCase()}`,
        price: String(keepPrice),
        category: "Pathology",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    const [tCancel] = await db
      .insert(testsTable)
      .values({
        name: `Cancel Test ${marker}`,
        code: `C${marker.slice(-6).toUpperCase()}`,
        price: String(cancelPrice),
        category: "Pathology",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testKeepId = tKeep.id;
    testCancelId = tCancel.id;

    const [order] = await db
      .insert(ordersTable)
      .values({
        orderNumber: `ORD-${marker}`,
        patientId,
        doctorId,
        status: "completed",
        totalAmount: String(totalPrice),
      })
      .returning();
    orderId = order.id;

    const [otKeep] = await db
      .insert(orderTestsTable)
      .values({
        orderId,
        testId: testKeepId,
        price: String(keepPrice),
        status: "active",
      })
      .returning();
    const [otCancel] = await db
      .insert(orderTestsTable)
      .values({
        orderId,
        testId: testCancelId,
        price: String(cancelPrice),
        status: "active",
      })
      .returning();
    cancelOtId = otCancel.id;
    void otKeep;

    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BILL-${marker}`,
        orderId,
        patientId,
        subtotal: String(totalPrice),
        discount: "0",
        taxAmount: "0",
        totalAmount: String(totalPrice),
        paidAmount: String(totalPrice),
        refundAmount: "0",
        balanceAmount: "0",
        status: "paid",
        createdByName: vijayName,
      })
      .returning();
    billId = bill.id;

    await db.insert(paymentsTable).values({
      billId,
      amount: String(totalPrice),
      method: "cash",
      notes: `collection ${marker}`,
      recordedByName: vijayName,
    });
  }, 60_000);

  afterAll(async () => {
    if (billId) {
      await db.delete(vouchersTable).where(eq(vouchersTable.billId, billId)).catch(() => {});
      await db.delete(paymentsTable).where(eq(paymentsTable.billId, billId)).catch(() => {});
      await db.delete(billAuditsTable).where(eq(billAuditsTable.billId, billId)).catch(() => {});
      await db.delete(billsTable).where(eq(billsTable.id, billId)).catch(() => {});
    }
    if (orderId) {
      await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
      await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    }
    if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId)).catch(() => {});
    if (testKeepId) await db.delete(testsTable).where(eq(testsTable.id, testKeepId)).catch(() => {});
    if (testCancelId) await db.delete(testsTable).where(eq(testsTable.id, testCancelId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, vijayToken)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, abinashToken)).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.email, `%${marker}@vitest.invalid`)).catch(() => {});
    await db.delete(vouchersTable).where(like(vouchersTable.particular, `%${marker}%`)).catch(() => {});
  }, 60_000);

  test("Abinash partial-cancels ₹1500 on Vijay bill — Vijay collectible unchanged, Abinash −1500, no Short", async () => {
    const beforeVijay = await request(app)
      .get("/api/dashboard/my-daily-summary")
      .set("Authorization", `Bearer ${vijayToken}`);
    expect(beforeVijay.status).toBe(200);
    const vijayCollectibleBefore = Number(beforeVijay.body.summary.collectible);
    const vijayGrossBefore = Number(beforeVijay.body.summary.grossBilledIncludingCancelled);
    const vijayCashBefore = Number(beforeVijay.body.summary.physicalCashInHand);
    expect(vijayGrossBefore).toBeCloseTo(totalPrice, 2);
    expect(vijayCollectibleBefore).toBeCloseTo(totalPrice, 2);
    expect(vijayCashBefore).toBeCloseTo(totalPrice, 2);

    const cancelRes = await request(app)
      .post(`/api/bills/${billId}/cancel-refund-tests`)
      .set("Authorization", `Bearer ${abinashToken}`)
      .send({
        orderTestIds: [cancelOtId],
        reason: `partial cancel attribution test ${marker}`,
        performedBy: abinashName,
        refundMethod: "cash",
      });
    expect(cancelRes.status).toBe(200);
    expect(Number(cancelRes.body.totalAmount)).toBeCloseTo(keepPrice, 2);

    const afterVijay = await request(app)
      .get("/api/dashboard/my-daily-summary")
      .set("Authorization", `Bearer ${vijayToken}`);
    expect(afterVijay.status).toBe(200);
    const vs = afterVijay.body.summary;
    expect(Number(vs.grossBilledIncludingCancelled)).toBeCloseTo(vijayGrossBefore, 2);
    expect(Number(vs.collectible)).toBeCloseTo(vijayCollectibleBefore, 2);
    expect(Number(vs.physicalCashInHand)).toBeCloseTo(vijayCashBefore, 2);
    const vijayExpectedCash =
      Number(vs.collectible) - (Number(vs.digitalIn) - Number(vs.digitalRefunded)) - Number(vs.cashExpenses);
    expect(Math.abs(vijayExpectedCash - Number(vs.physicalCashInHand))).toBeLessThanOrEqual(0.01);

    const afterAbinash = await request(app)
      .get("/api/dashboard/my-daily-summary")
      .set("Authorization", `Bearer ${abinashToken}`);
    expect(afterAbinash.status).toBe(200);
    const as = afterAbinash.body.summary;
    expect(Number(as.cancelledAmount)).toBeCloseTo(cancelPrice, 2);
    expect(Number(as.cashRefunded)).toBeCloseTo(cancelPrice, 2);
    expect(Number(as.refundsOnBillsCancelledByMe)).toBeCloseTo(cancelPrice, 2);
    expect(Number(as.collectible)).toBeCloseTo(-cancelPrice, 2);
    expect(Number(as.physicalCashInHand)).toBeCloseTo(-cancelPrice, 2);
    const abinashExpectedCash =
      Number(as.collectible) - (Number(as.digitalIn) - Number(as.digitalRefunded)) - Number(as.cashExpenses);
    expect(Math.abs(abinashExpectedCash - Number(as.physicalCashInHand))).toBeLessThanOrEqual(0.01);

    // The Refunds tab of My Activity Log is judged by what this payload carries:
    // which bill (its own number, not a row id), whose study it was, and why money
    // went back — so the owner never has to open the bill to read a refund.
    const refundRow = (afterAbinash.body.refunds as Array<Record<string, unknown>>).find(
      (r) => Number(r.billId) === billId,
    );
    expect(refundRow, "the test-cancel auto-refund must be listed in refunds").toBeTruthy();
    expect(refundRow!.billNumber).toBe(`BILL-${marker}`);
    expect(refundRow!.referringDoctor).toBe(doctorName);
    expect(String(refundRow!.patientName)).toContain("Vitest");
    expect(Number(refundRow!.amount)).toBeCloseTo(-cancelPrice, 2);
    expect(refundRow!.refundKind).toBe("test-cancel");
    expect(String(refundRow!.reason)).toContain(marker);
    // The reason is the sentence the canceller typed, not the note's own label —
    // the kind badge says "test cancelled", and repeating the prefix in the text
    // is how a reason column turns into unreadable noise.
    expect(String(refundRow!.reason)).not.toMatch(/^REFUND/);
  }, 90_000);
});
