/**
 * online-bookings.request.test.ts — reception create + shared slot capacity.
 *
 * Public website/kiosk and staff reception/phone share createPendingOnlineBooking.
 * These tests hit the real router so a capacity race cannot silently overbook.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";
import { db } from "@workspace/db";
import {
  clinicSettingsTable,
  onlineBookingsTable,
  portalSessionsTable,
  usersTable,
  billsTable,
  paymentsTable,
  vouchersTable,
  testTokensTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("Online booking reception + slot capacity — request level", () => {
  let app: Express;
  let fx: BillingFixture;
  let adminToken: string;
  let adminUserId: number;
  let savedSettings: { onlineBookingEnabled: boolean; onlineBookingAllowedTestIds: string; bookingTimeSlots: string } | null = null;
  let settingsRowId: number | null = null;
  let insertedSettings = false;
  const date = "2099-06-15";
  const slot = "10:00 – 11:00";

  beforeAll(async () => {
    app = await createTestApp();
    fx = await seedBillingFixture();

    const bookingPatch = {
      onlineBookingEnabled: true,
      onlineBookingAllowedTestIds: JSON.stringify([fx.testId]),
      bookingTimeSlots: JSON.stringify([
        { value: slot, label: "Late morning test slot", maxBookings: 1 },
      ]),
    };

    const [settings] = await db
      .select({
        id: clinicSettingsTable.id,
        onlineBookingEnabled: clinicSettingsTable.onlineBookingEnabled,
        onlineBookingAllowedTestIds: clinicSettingsTable.onlineBookingAllowedTestIds,
        bookingTimeSlots: clinicSettingsTable.bookingTimeSlots,
      })
      .from(clinicSettingsTable)
      .limit(1);
    if (settings) {
      settingsRowId = settings.id;
      savedSettings = {
        onlineBookingEnabled: settings.onlineBookingEnabled,
        onlineBookingAllowedTestIds: settings.onlineBookingAllowedTestIds,
        bookingTimeSlots: settings.bookingTimeSlots,
      };
      await db.update(clinicSettingsTable).set(bookingPatch).where(eq(clinicSettingsTable.id, settings.id));
    } else {
      // CI db:bootstrap creates the table but does not seed clinic_settings
      // (that insert happens on API boot, which request tests skip).
      const [inserted] = await db.insert(clinicSettingsTable).values(bookingPatch).returning();
      settingsRowId = inserted.id;
      insertedSettings = true;
    }

    const [enabled] = await db
      .select({ onlineBookingEnabled: clinicSettingsTable.onlineBookingEnabled })
      .from(clinicSettingsTable)
      .limit(1);
    if (!enabled?.onlineBookingEnabled) {
      throw new Error("online booking stayed disabled after test setup (clinic_settings missing or update no-op)");
    }

    const marker = fx.marker;
    const [admin] = await db.insert(usersTable).values({
      name: `Vitest Admin ${marker}`,
      email: `admin-${marker}@vitest.invalid`,
      username: `admin-${marker}`,
      role: "admin",
      permissions: JSON.stringify(["/orders", "/billing", "/patients"]),
      pin: "0000",
      isActive: true,
    }).returning();
    adminUserId = admin.id;
    adminToken = `vitest-admin-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token: adminToken,
      scope: "staff",
      subjectId: admin.id,
      subjectName: admin.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }, 60_000);

  afterAll(async () => {
    await db.delete(onlineBookingsTable).where(like(onlineBookingsTable.bookingRef, "OB2099%")).catch(() => {});
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, date)).catch(() => {});
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, "2099-07-01")).catch(() => {});
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, "2099-07-02")).catch(() => {});
    if (adminToken) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, adminToken)).catch(() => {});
    if (adminUserId) await db.delete(usersTable).where(eq(usersTable.id, adminUserId)).catch(() => {});
    if (insertedSettings && settingsRowId) {
      await db.delete(clinicSettingsTable).where(eq(clinicSettingsTable.id, settingsRowId)).catch(() => {});
    } else if (savedSettings && settingsRowId) {
      await db.update(clinicSettingsTable).set(savedSettings).where(eq(clinicSettingsTable.id, settingsRowId));
    }
    await fx?.cleanup();
  }, 60_000);

  function publicBody(phone = "9111111111") {
    return {
      name: "Capacity Tester",
      phone,
      email: "",
      selectedDate: date,
      timeSlot: slot,
      testIds: [fx.testId],
      packageIds: [],
      totalAmount: fx.testPrice,
      ageValue: 30,
      ageUnit: "years",
      gender: "male",
      source: "website",
    };
  }

  test("GET /api/public/booking/slots reports remaining capacity", async () => {
    const res = await request(app).get(`/api/public/booking/slots?date=${date}`);
    expect(res.status).toBe(200);
    expect(res.body.slots[0]).toMatchObject({
      value: slot,
      maxBookings: 1,
      available: true,
    });
    expect(res.body.slots[0].remaining).toBe(1);
  });

  test("second booking on a full slot is rejected; cancel releases capacity", async () => {
    const first = await request(app).post("/api/public/booking/qr-initiate").send(publicBody("9111111111"));
    expect(first.status).toBe(200);
    expect(first.body.bookingRef).toMatch(/^OB/);

    const second = await request(app).post("/api/public/booking/qr-initiate").send(publicBody("9222222222"));
    expect(second.status).toBe(409);
    expect(String(second.body.error)).toMatch(/full/i);

    const [row] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.bookingRef, first.body.bookingRef)).limit(1);
    expect(row).toBeTruthy();

    const cancel = await request(app)
      .post(`/api/online-bookings/${row.id}/cancel`)
      .set("Authorization", `Bearer ${fx.token}`);
    expect(cancel.status).toBe(200);

    const third = await request(app).post("/api/public/booking/qr-initiate").send(publicBody("9333333333"));
    expect(third.status).toBe(200);
  });

  test("staff reception create uses the same pipeline and can share a payment link", async () => {
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, date));

    const created = await request(app)
      .post("/api/online-bookings")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        patientId: fx.patientId,
        selectedDate: date,
        timeSlot: slot,
        testIds: [fx.testId],
        packageIds: [],
        source: "phone",
      });
    expect(created.status).toBe(201);
    expect(created.body.booking.source).toBe("phone");
    expect(created.body.booking.status).toBe("pending_payment");
    expect(created.body.booking.patientId).toBe(fx.patientId);

    const slots = await request(app).get(`/api/public/booking/slots?date=${date}`);
    expect(slots.body.slots[0].available).toBe(false);

    const blocked = await request(app)
      .post("/api/online-bookings")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        patientId: fx.patientId,
        selectedDate: date,
        timeSlot: slot,
        testIds: [fx.testId],
        packageIds: [],
        source: "reception",
      });
    expect(blocked.status).toBe(409);

    const override = await request(app)
      .post("/api/online-bookings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: fx.patientId,
        selectedDate: date,
        timeSlot: slot,
        testIds: [fx.testId],
        packageIds: [],
        source: "reception",
        overrideCapacity: true,
        overrideReason: "Emergency add-on scan",
      });
    expect(override.status).toBe(201);
    expect(override.body.booking.capacityOverrideReason).toBe("Emergency add-on scan");
  });

  test("public initiate cannot spoof reception/phone source", async () => {
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, date));
    const res = await request(app).post("/api/public/booking/qr-initiate").send({
      ...publicBody("9444444444"),
      source: "phone",
    });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(onlineBookingsTable)
      .where(eq(onlineBookingsTable.bookingRef, res.body.bookingRef))
      .limit(1);
    expect(row.source).toBe("website");
  });

  test("Pay at Centre confirm creates an unpaid due bill and does not post ICICI/online collection", async () => {
    const payDate = "2099-07-01";
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, payDate));

    const created = await request(app)
      .post("/api/online-bookings")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        patientId: fx.patientId,
        selectedDate: payDate,
        timeSlot: slot,
        testIds: [fx.testId],
        packageIds: [],
        source: "phone",
      });
    expect(created.status).toBe(201);
    const bookingId = created.body.booking.id as number;

    // Share Link initiate used to stamp ICICI ids before money arrived.
    await db.update(onlineBookingsTable).set({
      iciciTransactionId: created.body.booking.bookingRef,
      iciciProviderRefId: "initiate-only-tran-ctx",
    }).where(eq(onlineBookingsTable.id, bookingId));

    const confirmed = await request(app)
      .post(`/api/online-bookings/${bookingId}/confirm`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.dueAtCentre).toBe(true);
    expect(confirmed.body.billId).toBeGreaterThan(0);

    const billId = confirmed.body.billId as number;
    const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1);
    expect(bill.status).toBe("pending");
    expect(Number(bill.paidAmount)).toBe(0);
    expect(Number(bill.balanceAmount)).toBeGreaterThan(0);

    const pays = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, billId));
    expect(pays).toHaveLength(0);

    const vouchers = await db.select().from(vouchersTable).where(eq(vouchersTable.billId, billId));
    expect(vouchers).toHaveLength(0);

    const [row] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, bookingId)).limit(1);
    expect(row.status).toBe("confirmed");
    expect(row.iciciTransactionId).toBeNull();
    expect(row.iciciProviderRefId).toBeNull();

    await db.delete(testTokensTable).where(eq(testTokensTable.billId, billId)).catch(() => {});
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.id, bookingId)).catch(() => {});
  });

  test("Share payment link returns 400 (or 200), never 502/503", async () => {
    const linkDate = "2099-07-02";
    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.selectedDate, linkDate));

    const created = await request(app)
      .post("/api/online-bookings")
      .set("Authorization", `Bearer ${fx.token}`)
      .send({
        patientId: fx.patientId,
        selectedDate: linkDate,
        timeSlot: slot,
        testIds: [fx.testId],
        packageIds: [],
        source: "reception",
      });
    expect(created.status).toBe(201);

    const link = await request(app)
      .post(`/api/online-bookings/${created.body.booking.id}/payment-link`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({});
    expect([200, 400]).toContain(link.status);
    expect(link.status).not.toBe(502);
    expect(link.status).not.toBe(503);
    if (link.status === 400) {
      expect(String(link.body.error || "")).not.toMatch(/temporarily unavailable/i);
    }

    await db.delete(onlineBookingsTable).where(eq(onlineBookingsTable.id, created.body.booking.id)).catch(() => {});
  });
});
