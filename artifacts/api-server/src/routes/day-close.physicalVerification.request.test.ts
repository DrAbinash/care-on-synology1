/**
 * Request-level: what a drawer close actually RECORDS.
 *
 * The pure decision lives in `staffDrawerStatus`, but the defect this covers was
 * in the wiring: both close forms pre-fill every actual from the system's own
 * expected totals, so an untouched submit produced variance 0 and the row stored
 * "balanced". Twelve consecutive live closes on 2026-10-13 all looked like that,
 * including the one an admin force-closed for a cashier who could not close it.
 *
 * Seeds marker-scoped users, and tears down by closure id above a snapshot,
 * because /staff-close-all legitimately closes EVERY active user's drawer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  usersTable,
  userDayClosuresTable,
  drawerAuditLogTable,
} from "@workspace/db/schema";
import { desc, eq, gt, inArray, like, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const NOT_VERIFIED = "not_physically_verified";

describe.skipIf(!hasDatabaseUrl())("day close physical verification", () => {
  let app: Express;
  const marker = `vitest-dcvfy-${randomUUID().slice(0, 8)}`;
  const staffName = `Vijay Yadav ${marker}`;
  const adminName = `Dr Abinash Kumar ${marker}`;
  const neverClosedName = `Sanjay ${marker}`;
  const staffToken = `vitest-staff-${randomUUID()}`;
  const adminToken = `vitest-admin-${randomUUID()}`;
  let closureIdFloor = 0;

  const actuals = (cash = 0) => ({ cash, upi: 0, card: 0, cheque: 0, other: 0 });

  const asStaff = (req: request.Test) => req.set("Authorization", `Bearer ${staffToken}`);
  const asAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${adminToken}`);

  async function insertStaff(name: string, role: string, pin: string) {
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${name.split(" ")[0].toLowerCase()}-${marker}@vitest.invalid`,
        username: `${name.split(" ")[0].toLowerCase()}-${marker}-${pin}`,
        role,
        permissions: JSON.stringify([]),
        pin,
        isActive: true,
      })
      .returning();
    return user;
  }

  async function latestClosure(userName: string) {
    const [row] = await db
      .select()
      .from(userDayClosuresTable)
      .where(eq(userDayClosuresTable.userName, userName))
      .orderBy(desc(userDayClosuresTable.id))
      .limit(1);
    return row ?? null;
  }

  async function auditFor(closureId: number) {
    return db
      .select({ action: drawerAuditLogTable.action, reason: drawerAuditLogTable.reason })
      .from(drawerAuditLogTable)
      .where(eq(drawerAuditLogTable.userClosureId, closureId));
  }

  beforeAll(async () => {
    app = await createTestApp();

    const staff = await insertStaff(staffName, "receptionist", "1111");
    const admin = await insertStaff(adminName, "admin", "2222");
    await insertStaff(neverClosedName, "receptionist", "3333");

    await db.insert(portalSessionsTable).values([
      {
        token: staffToken,
        scope: "staff",
        subjectId: staff.id,
        subjectName: staff.name,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      {
        token: adminToken,
        scope: "staff",
        subjectId: admin.id,
        subjectName: admin.name,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ]);

    const [floor] = await db
      .select({ v: sql<number>`coalesce(max(id), 0)::int`.as("v") })
      .from(userDayClosuresTable);
    closureIdFloor = floor?.v ?? 0;
  }, 60_000);

  afterAll(async () => {
    // Everything this file created, including the drawers /staff-close-all closed
    // on behalf of users that pre-date the marker.
    const created = await db
      .select({ id: userDayClosuresTable.id })
      .from(userDayClosuresTable)
      .where(gt(userDayClosuresTable.id, closureIdFloor));
    const ids = created.map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(drawerAuditLogTable).where(inArray(drawerAuditLogTable.userClosureId, ids)).catch(() => {});
      await db.delete(userDayClosuresTable).where(inArray(userDayClosuresTable.id, ids)).catch(() => {});
    }
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.token, [staffToken, adminToken])).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.email, `%${marker}@vitest.invalid`)).catch(() => {});
  }, 60_000);

  it("refuses to record an un-counted self-close as Balanced", async () => {
    const res = await asStaff(request(app).post("/api/day-close/my-close"))
      .send({ actuals: actuals(), varianceNote: "", notes: "" })
      .expect(201);

    expect(res.body.drawerStatus).toBe(NOT_VERIFIED);
    // Variance really is zero — which is exactly why the old code called it
    // balanced, and why the status cannot be derived from the number alone.
    expect(Number(res.body.variance)).toBe(0);

    const row = await latestClosure(staffName);
    expect(row?.drawerStatus).toBe(NOT_VERIFIED);
    expect((await auditFor(row!.id)).map((a) => a.action)).toContain("closed_unverified");
  });

  it("records Balanced when the cashier says they counted the cash", async () => {
    const res = await asStaff(request(app).post("/api/day-close/my-close"))
      .send({ actuals: actuals(), physicallyCounted: true })
      .expect(201);

    expect(res.body.drawerStatus).toBe("balanced");
    const row = await latestClosure(staffName);
    expect((await auditFor(row!.id)).map((a) => a.action)).toContain("closed");
  });

  it("treats note-by-denomination counts as a physical count", async () => {
    const res = await asStaff(request(app).post("/api/day-close/my-close"))
      .send({
        actuals: actuals(),
        denominations: { d500: 0, d200: 0, d100: 12, d50: 4, d20: 0, d10: 0, coins: 37 },
      })
      .expect(201);

    expect(res.body.drawerStatus).toBe("balanced");
    expect(res.body.denominationTotal).not.toBeNull();
  });

  it("still calls a real shortage a mismatch even when the count was asserted", async () => {
    // The guard must not let "I counted" convert missing money into Balanced.
    const res = await asStaff(request(app).post("/api/day-close/my-close"))
      .send({ actuals: actuals(500), physicallyCounted: true, varianceNote: "Drawer is short" })
      .expect(201);

    expect(res.body.drawerStatus).toBe("mismatch");
    const row = await latestClosure(staffName);
    expect((await auditFor(row!.id)).map((a) => a.action)).toContain("mismatch_detected");
  });

  it("refuses a bulk close that does not say why", async () => {
    const noReason = await asAdmin(request(app).post("/api/day-close/staff-close-all"))
      .send({ notes: "end of day" })
      .expect(400);
    // The refusal has to name the recovery, or the operator just retries.
    expect(JSON.stringify(noReason.body)).toMatch(/reason/i);

    const tooShort = await asAdmin(request(app).post("/api/day-close/staff-close-all"))
      .send({ reason: "ab" })
      .expect(400);
    expect(JSON.stringify(tooShort.body)).toMatch(/reason/i);
  });

  it("bulk-closes with a stated reason, and every drawer records as unverified", async () => {
    const res = await asAdmin(request(app).post("/api/day-close/staff-close-all"))
      .send({ reason: "Suraj was off; Vijay holds both drawers and the aggregate was verified at the counter." })
      .expect(200);

    // The cashier who never closed anything is the one this path claims to fix.
    expect(res.body.results.map((r: { userName: string }) => r.userName))
      .toContain(neverClosedName);

    const row = await latestClosure(neverClosedName);
    expect(row).not.toBeNull();
    expect(row!.drawerStatus).toBe(NOT_VERIFIED);
    // Zero variance by construction — the system agreed with itself.
    expect(Number(row!.variance)).toBe(0);
    // The admin's reason is on the closure, not only in the click.
    expect(`${row!.varianceNote}|${row!.notes}`).toMatch(/aggregate was verified/i);
    expect(row!.notes).toMatch(/without a physical cash count/i);

    const audit = await auditFor(row!.id);
    expect(audit.map((a) => a.action)).toContain("closed_unverified");
    expect(audit.map((a) => a.reason).join(" ")).toMatch(/aggregate was verified/i);
  });

  it("cannot be talked into Balanced by claiming a count it did not make", async () => {
    // The auto-balance path is the one that wrote expected into actual, so a
    // caller that asserts physicallyCounted must not earn "balanced" from it.
    // Needs a drawer that is still open: the bulk path skips closed ones.
    const fresh = await insertStaff(`Poonam ${marker}`, "receptionist", "4444");
    const res = await asAdmin(request(app).post("/api/day-close/staff-close-all"))
      .send({ reason: "Second bulk close, probing the flag", physicallyCounted: true })
      .expect(200);

    expect(res.body.results.map((r: { userName: string }) => r.userName)).toContain(fresh.name);
    const row = await latestClosure(fresh.name);
    expect(row?.drawerStatus).toBe(NOT_VERIFIED);
  });

  it("lets an admin close one staff drawer and record whether it was counted", async () => {
    const uncounted = await asAdmin(request(app).post("/api/day-close/staff-close"))
      .send({ userName: neverClosedName, actuals: actuals() })
      .expect(201);
    expect(uncounted.body.drawerStatus).toBe(NOT_VERIFIED);

    const counted = await asAdmin(request(app).post("/api/day-close/staff-close"))
      .send({ userName: neverClosedName, actuals: actuals(), physicallyCounted: true })
      .expect(201);
    expect(counted.body.drawerStatus).toBe("balanced");
  });
});
