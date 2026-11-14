/**
 * Request-level: POST /api/bills/:id/swap-test on a single-item bill.
 *
 * Clinic case: unpaid USG Abdomen ₹1500 → X-Ray ₹1000 must NOT invent a
 * cash refund for the ₹500 price drop. Paid bills only refund excess paid
 * over the new total.
 *
 * The second half is the booked examination (item 5): a radiology line is also
 * a worklist item, a room, a machine and a report header, all of which used to
 * stay on the OLD test after the invoice was corrected.
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
  radiologyStudiesTable,
  radiologyScheduledProceduresTable,
  radiologyAuditLogTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateStudiesForOrder } from "./radiology";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("POST /api/bills/:id/swap-test — single-item", () => {
  let app: Express;
  let fx: BillingFixture;
  let cheapTestId: number;
  let expensiveTestId: number;
  /** Real radiology departments, so the study fan-out actually books them. */
  let usgImgTestId: number;
  let xrayImgTestId: number;
  let usgImgName: string;
  let xrayImgName: string;
  let labTestId: number;
  let seq = 0;
  const extraTestIds: number[] = [];
  const bookedAccessions: string[] = [];
  const bookedOrderTestIds: number[] = [];

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

    usgImgName = `USG Abdomen RIS ${fx.marker}`;
    xrayImgName = `X-Ray Chest RIS ${fx.marker}`;
    const [usgImg] = await db
      .insert(testsTable)
      .values({
        name: usgImgName,
        code: `USRI${fx.marker.slice(-3).toUpperCase()}`,
        price: "1500.00",
        category: "Radiology",
        department: "USG",
        roomNumber: "USG ROOM 1",
        duration: "same day",
        isActive: true,
      })
      .returning();
    const [xrayImg] = await db
      .insert(testsTable)
      .values({
        name: xrayImgName,
        code: `XRFI${fx.marker.slice(-3).toUpperCase()}`,
        price: "1000.00",
        category: "Radiology",
        department: "X-Ray",
        roomNumber: "X-RAY ROOM 1",
        duration: "same day",
        isActive: true,
      })
      .returning();
    // A lab counter: correcting INTO it must not create a study, and correcting
    // OUT of it must not silently cancel the booking.
    const [lab] = await db
      .insert(testsTable)
      .values({
        name: `CBC RIS ${fx.marker}`,
        code: `CBRI${fx.marker.slice(-3).toUpperCase()}`,
        price: "500.00",
        category: "Pathology",
        department: "Pathology",
        roomNumber: "LAB 1",
        duration: "same day",
        isActive: true,
      })
      .returning();
    usgImgTestId = usgImg.id;
    xrayImgTestId = xrayImg.id;
    labTestId = lab.id;
    extraTestIds.push(usgImg.id, xrayImg.id, lab.id);
  }, 60_000);

  afterAll(async () => {
    // The study rows reference the fixture's order/bill by integer only, so
    // they outlive `fx.cleanup()` unless they are taken here.
    for (const acc of bookedAccessions) {
      await db
        .delete(radiologyScheduledProceduresTable)
        .where(eq(radiologyScheduledProceduresTable.accessionNumber, acc))
        .catch(() => {});
      await db
        .delete(radiologyAuditLogTable)
        .where(eq(radiologyAuditLogTable.accessionNumber, acc))
        .catch(() => {});
    }
    for (const orderTestId of bookedOrderTestIds) {
      await db
        .delete(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.orderTestId, orderTestId))
        .catch(() => {});
    }
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
    return { bill, orderTestId: ot.id, orderId: order.id };
  }

  /**
   * Book the examination the way the billing desk does: through the real
   * fan-out, which writes both `radiology_studies` and the
   * `radiology_scheduled_procedures` row the `.wl` file is built from.
   */
  async function bookStudy(opts: {
    billId: number;
    orderId: number;
    orderTestId: number;
  }): Promise<string> {
    const created = await generateStudiesForOrder({
      billId: opts.billId,
      orderId: opts.orderId,
      patientId: fx.patientId,
    });
    const mine = created.find((c) => c.orderTestId === opts.orderTestId);
    expect(mine, "the fan-out must book a study for the paid radiology line").toBeDefined();
    bookedAccessions.push(mine!.accessionNumber);
    bookedOrderTestIds.push(opts.orderTestId);
    return mine!.accessionNumber;
  }

  function swapRequest(billId: number, body: Record<string, unknown>) {
    return request(app)
      .post(`/api/bills/${billId}/swap-test`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send(body);
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

  test("CASE 4: booked USG → X-Ray — the examination follows the invoice", async () => {
    const { bill, orderTestId, orderId } = await insertSingleItemBill({
      testId: usgImgTestId,
      price: 1500,
      paid: 0,
    });
    const accession = await bookStudy({ billId: bill.id, orderId, orderTestId });

    const before = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));
    expect(before[0]!.modality).toBe("US");
    expect(before[0]!.testId).toBe(usgImgTestId);

    const res = await swapRequest(bill.id, {
      orderTestId,
      newTestId: xrayImgTestId,
      reason: "Patient wants a chest film, not an ultrasound",
      performedBy: fx.marker,
    });

    expect(res.status).toBe(200);
    expect(res.body.studySync).toMatchObject({
      status: "synced",
      accessionNumber: accession,
      modality: "CR",
      department: "X-Ray",
      studyDescriptionOutcome: "synced",
    });
    // `scheduledStationAETitle` joins this list only when the test machine has
    // stations configured, which a migration-built CI database may not have.
    expect(res.body.studySync.changed as string[]).toEqual(
      expect.arrayContaining([
        "testId",
        "modality",
        "department",
        "roomNumber",
        "studyDescription",
      ]),
    );

    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));
    expect(study!.testId).toBe(xrayImgTestId);
    expect(study!.modality).toBe("CR");
    expect(study!.department).toBe("X-Ray");
    expect(study!.roomNumber).toBe("X-RAY ROOM 1");
    expect(study!.studyDescription).toBe(xrayImgName);
    // The same correction the console reads, not just the one the RIS screen reads.
    const [procedure] = await db
      .select()
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, accession));
    expect(procedure!.modality).toBe("CR");
    expect(procedure!.procedureName).toBe(xrayImgName);
    // The MWL publisher is allowed to append a sibling-test suffix, so the
    // corrected name must be present without pinning its exact decoration.
    expect(procedure!.studyDescription).toContain(xrayImgName);

    const audits = await db
      .select()
      .from(radiologyAuditLogTable)
      .where(eq(radiologyAuditLogTable.accessionNumber, accession));
    const swapAudit = audits.find((a) => a.action === "BILLED_TEST_SWAPPED");
    expect(swapAudit, "the study must record which billed test it was moved from").toBeTruthy();
    expect(JSON.parse(swapAudit!.details!).to.testId).toBe(xrayImgTestId);
  });

  test("CASE 5: a study that has already been started refuses the swap before the money moves", async () => {
    const { bill, orderTestId, orderId } = await insertSingleItemBill({
      testId: usgImgTestId,
      price: 1500,
      paid: 1500,
    });
    await bookStudy({ billId: bill.id, orderId, orderTestId });
    await db
      .update(radiologyStudiesTable)
      .set({ startedAt: new Date(), status: "in_progress" })
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));

    const res = await swapRequest(bill.id, {
      orderTestId,
      newTestId: xrayImgTestId,
      reason: "Wrong modality booked",
      performedBy: fx.marker,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already been started");

    // Fail closed means the invoice is exactly as it was: the examination has
    // happened, so the price the patient was charged for it still stands.
    const [ot] = await db.select().from(orderTestsTable).where(eq(orderTestsTable.id, orderTestId));
    expect(ot!.testId).toBe(usgImgTestId);
    expect(Number(ot!.price)).toBe(1500);
    const [after] = await db.select().from(billsTable).where(eq(billsTable.id, bill.id));
    expect(Number(after!.totalAmount)).toBe(1500);
    expect(Number(after!.refundAmount ?? 0)).toBe(0);
    const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, bill.id));
    expect(audits.some((a) => a.changeType === "test_swapped")).toBe(false);

    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));
    expect(study!.testId).toBe(usgImgTestId);
    expect(study!.modality).toBe("US");
  });

  test("CASE 6: a description somebody typed is kept while the examination moves", async () => {
    const { bill, orderTestId, orderId } = await insertSingleItemBill({
      testId: usgImgTestId,
      price: 1500,
      paid: 0,
    });
    const accession = await bookStudy({ billId: bill.id, orderId, orderTestId });
    const typed = "RUQ pain, rule out cholelithiasis";
    await db
      .update(radiologyStudiesTable)
      .set({ studyDescription: typed })
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));

    const res = await swapRequest(bill.id, {
      orderTestId,
      newTestId: xrayImgTestId,
      reason: "Billing correction",
      performedBy: fx.marker,
    });

    expect(res.status).toBe(200);
    expect(res.body.studySync).toMatchObject({
      status: "synced",
      studyDescriptionOutcome: "kept_manual",
    });

    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));
    expect(study!.studyDescription).toBe(typed);
    // Kept is not the same as stalled: the machine, the room and the test id DO move.
    expect(study!.modality).toBe("CR");
    expect(study!.testId).toBe(xrayImgTestId);
    expect((res.body.studySync.changed as string[])).not.toContain("studyDescription");
  });

  test("CASE 7: a lab line corrected into imaging gets the study it never had", async () => {
    const { bill, orderTestId } = await insertSingleItemBill({
      testId: labTestId,
      price: 500,
      paid: 0,
    });

    const res = await swapRequest(bill.id, {
      orderTestId,
      newTestId: xrayImgTestId,
      reason: "Clerk entered the blood test instead of the film",
      performedBy: fx.marker,
    });

    expect(res.status).toBe(200);
    expect(res.body.studySync.status).toBe("study_created");
    const accessions = res.body.studySync.accessions as string[];
    expect(accessions.length).toBe(1);
    bookedAccessions.push(accessions[0]!);
    bookedOrderTestIds.push(orderTestId);

    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));
    expect(study!.testId).toBe(xrayImgTestId);
    expect(study!.modality).toBe("CR");
    expect(Number((await db.select().from(billsTable).where(eq(billsTable.id, bill.id)).then((r) => r[0]!)).totalAmount)).toBe(1000);
  });

  test("CASE 8: imaging corrected into a lab test reports the stale booking, and does not cancel it", async () => {
    const { bill, orderTestId, orderId } = await insertSingleItemBill({
      testId: xrayImgTestId,
      price: 1000,
      paid: 0,
    });
    const accession = await bookStudy({ billId: bill.id, orderId, orderTestId });

    const res = await swapRequest(bill.id, {
      orderTestId,
      newTestId: labTestId,
      reason: "Patient does not need the film after all",
      performedBy: fx.marker,
    });

    expect(res.status).toBe(200);
    expect(res.body.studySync).toMatchObject({
      status: "booking_stale",
      accessionNumber: accession,
    });
    // Cancellation is `cancel-test`'s job — with its token and refund rules.
    // A swap that cancelled behind the desk's back would leave the row terminal,
    // and the next swap would then be refused.
    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, orderTestId));
    expect(study!.status).not.toBe("cancelled");
    expect(study!.testId).toBe(xrayImgTestId);
  });
});
