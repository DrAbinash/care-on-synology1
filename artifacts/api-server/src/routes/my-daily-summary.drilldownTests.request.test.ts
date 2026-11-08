/**
 * Request-level: the "Total Bills Generated" popup must say what was billed.
 *
 * The drilldown listed bill number, patient, referring doctor and amount — so a
 * desk reconciling a shift could see 40 bills and ₹1,17,800 but not which tests
 * made them up, and had to open each bill to find out. The Tests column now
 * comes from the same query the popup already runs, and it must name the line
 * the way the printed bill names it.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
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

describe.skipIf(!dbAvailable)("Total Bills Generated drilldown", () => {
  let app: Express;
  const marker = `vitest-drill-${randomUUID().slice(0, 8)}`;
  const staffName = `Suraj Jha ${marker}`;

  let token = "";
  let userId = 0;
  let sessionId = "";
  const billNumbers: string[] = [];
  const testIds: number[] = [];
  let doctorId = 0;

  const todayIst = () =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  /** Column index of a header, so the assertion never depends on ordering. */
  function colIndex(columns: string[], header: string) {
    return columns.indexOf(header);
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db.insert(usersTable).values({
      name: staffName,
      email: `${marker}@vitest.invalid`,
      username: marker,
      role: "receptionist",
      permissions: JSON.stringify(["/orders", "/billing", "/patients", "/dashboard", "/my-daily-summary"]),
      pin: "1111",
      isActive: true,
    }).returning();
    userId = user.id;
    sessionId = `vitest-drill-${randomUUID()}`;
    token = sessionId;
    await db.insert(portalSessionsTable).values({
      token: sessionId,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [patient] = await db.insert(patientsTable).values({
      patientId: `DR-${marker}`,
      firstName: "Jahira",
      lastName: `Khatoon ${marker}`,
      dateOfBirth: "1990-01-01",
      gender: "female",
      phone: "9000000001",
    }).returning();

    const [doctor] = await db.insert(doctorsTable).values({
      name: `Dr Neha Priya ${marker}`,
      specialization: "Gynaecology",
    }).returning();
    doctorId = doctor.id;

    const insertedTests = await db.insert(testsTable).values([
      { name: `USG WHOLE ABDOMEN ${marker}`, code: `A${marker.slice(-6)}`, price: "1500", category: "USG", duration: "30 min", isActive: true },
      { name: `CBC ${marker}`, code: `B${marker.slice(-6)}`, price: "350", category: "Pathology", duration: "4 hr", isActive: true },
      { name: `X-RAY CHEST ${marker}`, code: `C${marker.slice(-6)}`, price: "450", category: "X-Ray", duration: "15 min", isActive: true },
    ]).returning();
    testIds.push(...insertedTests.map((t) => t.id));

    // Bill 1: two catalogue lines.
    await makeBill("1", patient.id, [
      { testId: insertedTests[0].id, price: 1500 },
      { testId: insertedTests[1].id, price: 350 },
    ]);

    // Bill 2: one line the desk renamed on the bill — the popup must show the
    // name the patient actually received, not the catalogue name.
    await makeBill("2", patient.id, [
      { testId: insertedTests[2].id, price: 450, displayName: `X-RAY CHEST PA ${marker} (REPRINTED LABEL)` },
    ]);

    // Bill 3: an order with no lines at all.
    await makeBill("3", patient.id, []);
  }, 120_000);

  async function makeBill(
    tag: string,
    patientId: number,
    lines: { testId: number; price: number; displayName?: string }[],
  ) {
    const total = lines.reduce((s, l) => s + l.price, 0);
    const [order] = await db.insert(ordersTable).values({
      patientId,
      orderNumber: `ORD-DRILL-${tag}-${marker}`,
      doctorId,
      status: "completed",
      totalAmount: String(total),
    }).returning();
    if (lines.length > 0) {
      await db.insert(orderTestsTable).values(lines.map((l) => ({
        orderId: order.id,
        testId: l.testId,
        price: String(l.price),
        status: "active",
        displayName: l.displayName ?? null,
      })));
    }
    const billNumber = `BILL-DRILL-${tag}-${marker}`;
    billNumbers.push(billNumber);
    await db.insert(billsTable).values({
      billNumber,
      orderId: order.id,
      patientId,
      subtotal: String(total),
      totalAmount: String(total),
      paidAmount: String(total),
      balanceAmount: "0",
      status: "paid",
      createdByName: staffName,
    });
  }

  afterAll(async () => {
    const bills = await db.select({ id: billsTable.id, orderId: billsTable.orderId })
      .from(billsTable).where(inArray(billsTable.billNumber, billNumbers));
    const orderIds = bills.map((b) => b.orderId);
    if (bills.length > 0) {
      await db.delete(billsTable).where(inArray(billsTable.id, bills.map((b) => b.id))).catch(() => {});
    }
    if (orderIds.length > 0) {
      await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds)).catch(() => {});
      await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds)).catch(() => {});
    }
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, sessionId)).catch(() => {});
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.patientId, `DR-${marker}`)).catch(() => {});
    if (testIds.length > 0) await db.delete(testsTable).where(inArray(testsTable.id, testIds)).catch(() => {});
    if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId)).catch(() => {});
  }, 120_000);

  async function drilldown(type: string) {
    const day = todayIst();
    const res = await request(app)
      .get(`/api/dashboard/my-daily-summary/drilldown?type=${type}&from=${day}&to=${day}&staffName=${encodeURIComponent(staffName)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as { columns: string[]; rows: (string | number | null)[][] };
  }

  test("Total Bills Generated carries a Tests column", async () => {
    const body = await drilldown("totalBills");
    expect(body.columns).toContain("Tests");
    const tests = colIndex(body.columns, "Tests");
    const bill = colIndex(body.columns, "Bill #");
    const byBill = new Map(body.rows.map((r) => [String(r[bill]), r[tests]]));

    expect(byBill.get(billNumbers[0])).toBe(
      `USG WHOLE ABDOMEN ${marker}, CBC ${marker}`,
    );
  });

  test("a renamed line is shown as the bill printed it, not as the catalogue", async () => {
    const body = await drilldown("totalBills");
    const tests = colIndex(body.columns, "Tests");
    const bill = colIndex(body.columns, "Bill #");
    const byBill = new Map(body.rows.map((r) => [String(r[bill]), r[tests]]));

    const renamed = String(byBill.get(billNumbers[1]));
    expect(renamed).toContain("REPRINTED LABEL");
    expect(renamed).not.toBe(`X-RAY CHEST ${marker}`);
  });

  test("a bill with no lines says so instead of rendering blank", async () => {
    const body = await drilldown("totalBills");
    const tests = colIndex(body.columns, "Tests");
    const bill = colIndex(body.columns, "Bill #");
    const row = body.rows.find((r) => String(r[bill]) === billNumbers[2]);
    expect(row).toBeDefined();
    expect(row![tests]).toBe("—");
  });

  test("the other drilldowns keep their own columns", async () => {
    // The Tests lookup lives inside the totalBills case only; a leak into the
    // shared billsInRange row-set would show up as an unexpected header here.
    const dues = await drilldown("outstandingDues");
    expect(dues.columns).not.toContain("Tests");
    const discounts = await drilldown("discountsGiven");
    expect(discounts.columns).not.toContain("Tests");
    // Positive control: the same endpoint does add it where it belongs.
    const total = await drilldown("totalBills");
    expect(total.columns).toContain("Tests");
  });
});
