/**
 * Referral-wise and test-wise search on GET /api/bills.
 *
 * The Bills page box used to match only bill number + patient, and typing into
 * it swapped the paginated, filtered list for a separate 15-row endpoint that
 * ignored the date/status/user filters entirely. These tests pin what replaced
 * it: one query, every filter composes with it, and a bill with several line
 * items is still counted once.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";
import { db } from "@workspace/db";
import {
  billsTable,
  doctorsTable,
  orderTestsTable,
  ordersTable,
  testsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const dbAvailable = hasDatabaseUrl();

type BillRow = {
  billNumber: string;
  order?: { testNames?: string[] } | null;
};
type ListBody = {
  bills: BillRow[];
  total: number;
  totals: { totalAmount: number };
};

describe.skipIf(!dbAvailable)("Bills referral / test search", () => {
  let app: Express;
  let fx: BillingFixture;
  let marker: string;
  let drAlpha = 0;
  let drBeta = 0;
  /** Created by this file but never attached to any order — a doctor with no
   * bill must never surface in the referrers option list. */
  let drNoBill = 0;
  let mriTestId = 0;
  /** Master catalogue test from the fixture — `Vitest Test <marker>`. */
  const masterName = () => `Vitest Test ${marker}`;
  const mriName = () => `Vitest MRI Brain ${marker}`;

  beforeAll(async () => {
    app = await createTestApp();
    fx = await seedBillingFixture();
    marker = fx.marker;

    const [alpha] = await db
      .insert(doctorsTable)
      .values({ name: `Vitest Referral Alpha ${marker}`, specialization: "General" })
      .returning();
    const [beta] = await db
      .insert(doctorsTable)
      .values({ name: `Vitest Referral Beta ${marker}`, specialization: "Neurology" })
      .returning();
    drAlpha = alpha.id;
    drBeta = beta.id;

    const [noBill] = await db
      .insert(doctorsTable)
      .values({ name: `Vitest Referral NoBill ${marker}`, specialization: "General" })
      .returning();
    drNoBill = noBill.id;

    const [mri] = await db
      .insert(testsTable)
      .values({
        name: mriName(),
        code: `MRI${marker.slice(-6).toUpperCase()}`,
        price: "400",
        category: "Radiology",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    mriTestId = mri.id;
  }, 60_000);

  afterAll(async () => {
    // Bills and orders for this patient go with it; the catalogue rows and
    // doctors the fixture does not know about must be removed explicitly.
    await fx?.cleanup();
    if (drAlpha)
      await db
        .delete(doctorsTable)
        .where(inArray(doctorsTable.id, [drAlpha, drBeta, drNoBill].filter(Boolean)))
        .catch(() => {});
    if (mriTestId) await db.delete(testsTable).where(eq(testsTable.id, mriTestId)).catch(() => {});
  }, 60_000);

  async function makeBill(opts: {
    tag: string;
    doctorId: number | null;
    lines: { testId: number; displayName?: string }[];
  }) {
    const total = 400 * opts.lines.length;
    const [order] = await db
      .insert(ordersTable)
      .values({
        patientId: fx.patientId,
        orderNumber: `ORD-SF-${opts.tag}-${marker}`,
        doctorId: opts.doctorId,
        status: "completed",
        totalAmount: String(total),
      })
      .returning();
    await db.insert(orderTestsTable).values(
      opts.lines.map((l) => ({
        orderId: order.id,
        testId: l.testId,
        price: "400",
        status: "active",
        displayName: l.displayName ?? null,
      })),
    );
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BILL-SF-${opts.tag}-${marker}`,
        orderId: order.id,
        patientId: fx.patientId,
        subtotal: String(total),
        totalAmount: String(total),
        paidAmount: String(total),
        balanceAmount: "0",
        status: "paid",
      })
      .returning();
    return bill;
  }

  async function list(params: string) {
    const res = await request(app)
      .get(`/api/bills?limit=50&compact=1&${params}`)
      .set("Authorization", `Bearer ${fx.token}`);
    expect(res.status).toBe(200);
    const body = res.body as ListBody;
    // Scoped to this run so a shared CI database cannot make assertions drift.
    return {
      tags: body.bills
        .filter((b) => b.billNumber.endsWith(marker))
        .map((b) => b.billNumber.replace(`BILL-SF-`, "").replace(`-${marker}`, ""))
        .sort(),
      rows: body.bills.filter((b) => b.billNumber.endsWith(marker)),
      total: body.total,
      totals: body.totals,
    };
  }

  test("free-text matches the referring doctor", async () => {
    await makeBill({ tag: "A", doctorId: drAlpha, lines: [{ testId: fx.testId }] });
    await makeBill({
      tag: "B",
      doctorId: drBeta,
      lines: [{ testId: mriTestId, displayName: `MRI Brain W Contrast ${marker}` }],
    });
    await makeBill({
      tag: "C",
      doctorId: drAlpha,
      lines: [{ testId: fx.testId }, { testId: fx.testId }, { testId: fx.testId }],
    });
    await makeBill({ tag: "D", doctorId: null, lines: [{ testId: mriTestId }] });

    expect((await list("q=Referral+Alpha")).tags).toEqual(["A", "C"]);
    expect((await list("q=Referral+Beta")).tags).toEqual(["B"]);
  });

  test("free-text matches the test, including the as-billed display name", async () => {
    expect((await list("q=Vitest+Test")).tags).toEqual(["A", "C"]);
    expect((await list("q=MRI+Brain+W+Contrast")).tags).toEqual(["B"]);
    expect((await list("q=Vitest+MRI+Brain")).tags).toEqual(["B", "D"]);
  });

  test("a three-line bill matches once and totals are not multiplied", async () => {
    // The run's marker is unique to these four bills, so the aggregate totals
    // are assertable even while other fixtures sit in the same database.
    const r = await list(`q=${marker}`);
    expect(r.tags).toEqual(["A", "B", "C", "D"]);
    // 400 + 400 + (3 lines x 400) + 400. Joining order_tests instead of
    // semi-joining would inflate C to 3,600 and the total to 4,800.
    expect(r.totals.totalAmount).toBe(2400);
  });

  test("referralDoctorId and testId filter exactly", async () => {
    expect((await list(`referralDoctorId=${drAlpha}`)).tags).toEqual(["A", "C"]);
    expect((await list(`referralDoctorId=${drBeta}`)).tags).toEqual(["B"]);
    expect((await list(`testId=${mriTestId}`)).tags).toEqual(["B", "D"]);
    expect((await list(`testId=${fx.testId}`)).tags).toEqual(["A", "C"]);
  });

  test("search composes with the date window instead of replacing it", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(
      (await list(`q=Referral+Alpha&dateFrom=2000-01-01&dateTo=${today}`)).tags,
    ).toEqual(["A", "C"]);
    expect(
      (await list(`q=Referral+Alpha&dateFrom=${tomorrow}&dateTo=${tomorrow}`)).tags,
    ).toEqual([]);
  });

  test("compact rows carry the billed test names for the list column", async () => {
    const r = await list(`testId=${fx.testId}`);
    const byTag = Object.fromEntries(r.rows.map((row) => [
      row.billNumber.replace("BILL-SF-", "").replace(`-${marker}`, ""),
      row.order?.testNames ?? [],
    ]));
    expect(byTag.A).toEqual([masterName()]);
    expect(byTag.C).toEqual([masterName(), masterName(), masterName()]);
  });

  test("option lists expose only what appears on bills", async () => {
    const referrers = await request(app)
      .get("/api/bills/referrers")
      .set("Authorization", `Bearer ${fx.token}`);
    expect(referrers.status).toBe(200);
    // The endpoint serves the Bills page dropdown, so it deliberately returns
    // every billed referrer in the database — and other request tests create
    // billed doctors in this same shared CI database, possibly mid-flight.
    // Exact-set equality therefore races against sibling files; the product
    // property is asserted scoped instead: this run's billed referrers are
    // listed once each, and a doctor with no bill never appears.
    const referrerIds = referrers.body.map((d: { id: number }) => d.id);
    expect(referrerIds).toContain(drAlpha);
    expect(referrerIds).toContain(drBeta);
    expect(referrerIds.filter((id: number) => id === drAlpha)).toHaveLength(1);
    expect(referrerIds).not.toContain(drNoBill);

    const billedTests = await request(app)
      .get("/api/bills/billed-tests")
      .set("Authorization", `Bearer ${fx.token}`);
    expect(billedTests.status).toBe(200);
    const ids = billedTests.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(mriTestId);
    expect(ids).toContain(fx.testId);
    // One entry per catalogue test even though it appears on several bills.
    expect(ids.filter((id: number) => id === fx.testId)).toHaveLength(1);
  });

  test("rejects a non-numeric filter id rather than ignoring it", async () => {
    const res = await request(app)
      .get("/api/bills?referralDoctorId=not-a-number")
      .set("Authorization", `Bearer ${fx.token}`);
    expect(res.status).toBe(400);
  });
});
