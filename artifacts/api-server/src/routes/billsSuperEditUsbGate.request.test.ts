/**
 * The money routes honour the pen drive.
 *
 * PATCH /api/bills/:id/super-edit rewrites a bill's amount and DELETE
 * /api/bills/:id removes a bill and renumbers the ones after it. Both begin with
 * rejectIfUsbMissing(), which used to return "not enforced, carry on" whenever
 * SUPER_ADMIN_USB_KEY was unset. docker-compose.yml forwards that secret as
 * `${SUPER_ADMIN_USB_KEY:-}`, so an empty or missing line in `.env` is a normal
 * thing to happen — and it would have left a full amount edit and a bill delete
 * reachable with no physical key present, behind nothing but a staff session.
 *
 * These are request-level assertions through the real router: the guard is the
 * first statement in the handler, so no bill has to exist, and the status code
 * alone says whether the door opened.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable, portalSessionsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

let app: Express;
const marker = `vitest-usbgate-${randomUUID()}`.slice(0, 28);
const KEY = "f".repeat(64);
let token = "";
const userIds: number[] = [];
const savedKey = process.env["SUPER_ADMIN_USB_KEY"];

const MONEY_ROUTES: Array<{ label: string; send: (a: Express) => request.Test }> = [
  {
    label: "PATCH /bills/:id/super-edit",
    send: (a) => a.patch("/api/bills/999999999/super-edit").send({ amount: 1, reason: "gate test" }),
  },
  {
    label: "DELETE /bills/:id",
    send: (a) => a.delete("/api/bills/999999999").send({ reason: "gate test" }),
  },
];

describe.skipIf(!hasDatabaseUrl())("super-admin bill mutations require the pen drive", () => {
  beforeAll(async () => {
    app = await createTestApp();
    // A super_admin staff session: requireStaffAuth and requireStaffPermission both
    // grant full access to that role, so the only thing left gating these routes is
    // the pen drive under test.
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `${marker}-admin`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "super_admin",
        permissions: JSON.stringify(["/billing"]),
        pin: "0000",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    userIds.push(user.id);
    token = `${marker}-session`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: `${marker}-admin`,
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env["SUPER_ADMIN_USB_KEY"];
    else process.env["SUPER_ADMIN_USB_KEY"] = savedKey;
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.token, [token]));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  test("a server that cannot verify the drive refuses the money routes", async () => {
    delete process.env["SUPER_ADMIN_USB_KEY"];
    for (const r of MONEY_ROUTES) {
      const res = await r.send(request(app)).set("Authorization", `Bearer ${token}`);
      expect(res.status, `${r.label} with no secret configured`).toBe(503);
      expect(String(res.body.error)).toMatch(/not configured/i);
    }
  });

  test("a configured server refuses a signed-in super admin holding no drive", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
    for (const r of MONEY_ROUTES) {
      const res = await r.send(request(app)).set("Authorization", `Bearer ${token}`);
      expect(res.status, r.label).toBe(401);
      expect(String(res.body.error)).toMatch(/USB key required/i);
    }
  });

  test("the wrong key is refused too", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
    for (const r of MONEY_ROUTES) {
      const res = await r
        .send(request(app))
        .set("Authorization", `Bearer ${token}`)
        .set("x-sa-usb-key", "e".repeat(64));
      expect(res.status, r.label).toBe(401);
      expect(String(res.body.error)).toMatch(/Invalid USB key/i);
    }
  });

  test("positive control: with the real drive the guard steps aside and validation answers", async () => {
    // Proves the 401s above are the drive check and not the route being broken: the
    // same request carrying the configured key reaches parameter/body validation,
    // which is where a nonexistent bill id would normally be caught.
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
    for (const r of MONEY_ROUTES) {
      const res = await r
        .send(request(app))
        .set("Authorization", `Bearer ${token}`)
        .set("x-sa-usb-key", KEY);
      expect(res.status, r.label).not.toBe(401);
      expect(res.status, r.label).not.toBe(503);
      expect([200, 400, 404]).toContain(res.status);
    }
  });

  test("and a caller with no staff session at all is refused before the drive is consulted", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
    for (const r of MONEY_ROUTES) {
      const res = await r.send(request(app)).set("x-sa-usb-key", KEY);
      expect(res.status, r.label).toBe(401);
      expect(String(res.body.error)).toMatch(/Staff authentication required/i);
    }
  });
});
