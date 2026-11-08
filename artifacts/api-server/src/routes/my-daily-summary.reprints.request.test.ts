/**
 * Request-level: the My Activity Log must show reprints, and show them once.
 *
 * Reprints were already inside the "Bill Edits" bucket (they are not one of the
 * six operational changeTypes), but buried among money edits with no patient and
 * no reprint number — which is why the tab read as empty for a desk that had
 * reprinted all morning. They now have their own tab, so the invariant that
 * matters is: reprint rows appear in reprintEdits, never in billEdits, and the
 * other edit types still appear in billEdits.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  billAuditsTable,
  billsTable,
  doctorsTable,
  orderTestsTable,
  ordersTable,
  patientsTable,
  portalSessionsTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("My Activity Log reprints", () => {
  let app: Express;
  const marker = `vitest-reprint-${randomUUID().slice(0, 8)}`;
  const staffName = `Suraj Jha ${marker}`;
  const otherStaffName = `Sanjeev Kumar ${marker}`;

  let token = "";
  let otherToken = "";
  let billId = 0;
  let billNumber = "";
  let doctorId = 0;
  let testId = 0;
  const createdUserIds: number[] = [];
  const createdSessionTokens: string[] = [];
  const createdAuditIds: number[] = [];

  /** The route's own IST calendar-day bounds, so the window cannot drift. */
  const todayIst = () =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  async function seedStaff(name: string, username: string) {
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${username}@vitest.invalid`,
        username,
        role: "receptionist",
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/dashboard", "/my-daily-summary"]),
        pin: "1111",
        isActive: true,
      })
      .returning();
    createdUserIds.push(user.id);
    const sessionToken = `vitest-reprint-${randomUUID()}`;
    createdSessionTokens.push(sessionToken);
    await db.insert(portalSessionsTable).values({
      token: sessionToken,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return sessionToken;
  }

  beforeAll(async () => {
    app = await createTestApp();
    token = await seedStaff(staffName, `suraj-${marker}`);
    otherToken = await seedStaff(otherStaffName, `sanjeev-${marker}`);

    const [patient] = await db.insert(patientsTable).values({
      patientId: `RP-${marker}`,
      firstName: "Rabiya",
      lastName: `Khatoon ${marker}`,
      dateOfBirth: "2000-01-01",
      gender: "female",
      phone: "9111111111",
    }).returning();

    const [doctor] = await db.insert(doctorsTable).values({
      name: `Dr Neha Priya ${marker}`,
      specialization: "Gynaecology",
    }).returning();
    doctorId = doctor.id;

    const [test] = await db.insert(testsTable).values({
      name: `USG Whole Abdomen ${marker}`,
      code: `USG${marker.slice(-6).toUpperCase()}`,
      price: "1500",
      category: "USG",
      duration: "30 min",
      isActive: true,
    }).returning();
    testId = test.id;

    const [order] = await db.insert(ordersTable).values({
      patientId: patient.id,
      orderNumber: `ORD-RP-${marker}`,
      doctorId: doctor.id,
      status: "completed",
      totalAmount: "1500",
    }).returning();
    await db.insert(orderTestsTable).values({
      orderId: order.id,
      testId: test.id,
      price: "1500",
      status: "active",
    });

    const [bill] = await db.insert(billsTable).values({
      billNumber: `BILL-RP-${marker}`,
      orderId: order.id,
      patientId: patient.id,
      subtotal: "1500",
      totalAmount: "1500",
      paidAmount: "1500",
      balanceAmount: "0",
      status: "paid",
      createdByName: staffName,
    }).returning();
    billId = bill.id;
    billNumber = bill.billNumber;
  }, 120_000);

  afterAll(async () => {
    if (createdSessionTokens.length > 0) {
      await db
        .delete(portalSessionsTable)
        .where(inArray(portalSessionsTable.token, createdSessionTokens))
        .catch(() => {});
    }
    if (createdAuditIds.length > 0) {
      await db.delete(billAuditsTable).where(inArray(billAuditsTable.id, createdAuditIds)).catch(() => {});
    }
    const bills = await db.select({ id: billsTable.id }).from(billsTable).where(eq(billsTable.billNumber, billNumber));
    if (bills.length > 0) {
      await db.delete(billAuditsTable).where(inArray(billAuditsTable.billId, bills.map((b) => b.id))).catch(() => {});
      await db.delete(billsTable).where(inArray(billsTable.id, bills.map((b) => b.id))).catch(() => {});
    }
    const orders = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.orderNumber, `ORD-RP-${marker}`));
    if (orders.length > 0) {
      await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orders.map((o) => o.id))).catch(() => {});
      await db.delete(ordersTable).where(inArray(ordersTable.id, orders.map((o) => o.id))).catch(() => {});
    }
    await db.delete(patientsTable).where(eq(patientsTable.patientId, `RP-${marker}`)).catch(() => {});
    if (testId) await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId)).catch(() => {});
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds)).catch(() => {});
    }
  }, 120_000);

  async function summary(authToken: string, params = "") {
    const day = todayIst();
    const res = await request(app)
      .get(`/api/dashboard/my-daily-summary?from=${day}&to=${day}${params}`)
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    return res.body as {
      billEdits: { changeType: string; billNumber: string }[];
      reprintEdits: {
        billNumber: string; newValue: string | null; reason: string; editedBy: string;
        patientName: string; referringDoctor: string | null; totalAmount: number;
      }[];
    };
  }

  async function reprint(reason: string, authToken = token) {
    const res = await request(app)
      .post(`/api/bills/${billId}/reprint-log`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ reprintedBy: "ignored — session wins", reason });
    expect(res.status).toBe(200);
    return res.body.reprintCount as number;
  }

  test("two reprints land in reprintEdits numbered, with patient and referral", async () => {
    expect(await reprint("Patient lost the first copy")).toBe(1);
    expect(await reprint("Taking to radiology for a second opinion")).toBe(2);

    const body = await summary(token);
    const mine = body.reprintEdits.filter((r) => r.billNumber === billNumber);
    expect(mine.map((r) => r.newValue).sort()).toEqual(["reprint #1", "reprint #2"]);
    expect(mine.every((r) => r.editedBy === staffName)).toBe(true);
    expect(mine[0]!.patientName).toContain(marker);
    expect(mine[0]!.referringDoctor).toBe(`Dr Neha Priya ${marker}`);
    expect(mine[0]!.totalAmount).toBe(1500);
    expect(mine.map((r) => r.reason).sort()).toEqual([
      "Patient lost the first copy",
      "Taking to radiology for a second opinion",
    ]);
  });

  test("reprints leave Bill Edits, and Bill Edits still carries real edits", async () => {
    // A non-operational edit that is NOT a reprint, to prove the bucket survived.
    const [audit] = await db.insert(billAuditsTable).values({
      billId,
      editedBy: staffName,
      reason: "Price corrected at desk",
      changeType: "test_swapped",
      oldValue: "USG WHOLE ABDOMEN (price=1500.00)",
      newValue: "USG WHOLE ABDOMEN + FETUS (price=2500.00)",
    }).returning();
    createdAuditIds.push(audit.id);

    const body = await summary(token);
    expect(body.billEdits.filter((e) => e.changeType === "reprint")).toEqual([]);
    const swap = body.billEdits.find((e) => e.changeType === "test_swapped" && e.billNumber === billNumber);
    expect(swap, "test_swapped must still reach Bill Edits").toBeDefined();
  });

  test("a staff member does not see another's reprints", async () => {
    const otherBody = await summary(otherToken);
    expect(otherBody.reprintEdits.filter((r) => r.billNumber === billNumber)).toEqual([]);
    // Positive control: the same window does show them to the person who did it.
    const ownBody = await summary(token);
    expect(ownBody.reprintEdits.filter((r) => r.billNumber === billNumber).length).toBeGreaterThan(0);
  });
});
