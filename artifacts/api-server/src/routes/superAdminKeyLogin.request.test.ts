/**
 * WHY THIS FILE EXISTS
 *
 * Two bugs in this product have the same shape: a route that is declared correctly in
 * its own file and is unreachable in the mounted application, because the mount, the
 * fall-through order or a limiter that was only ever claimed decides what actually
 * answers. Security-key login shipped like that for months (#1217) and the tests stayed
 * green because they imported the router directly.
 *
 * `/super-admin/key-login/begin` is the third door into the highest-privilege session
 * CARE issues, and it must be reachable WITHOUT the portal plugin being loaded — which
 * is what this file checks against the real mounted router, not against the router
 * object. It also checks that the door is not handed to an anonymous caller: the pen
 * drive still has to be presented before the server will say which accounts hold keys.
 *
 * Skips rather than fails without DATABASE_URL: createTestApp() is what pulls in
 * @workspace/db, and it runs inside beforeAll.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable, webauthnCredentialsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

let app: Express;

const marker = `vitest-sak-${randomUUID()}`.slice(0, 28);
const driveKey = `${marker}-drive-key`;
const ownCred = `${marker}-own-cred`;
const otherCred = `${marker}-other-cred`;
const staffCred = `${marker}-staff-cred`;

const OPEN_SA = `${marker} Open Superadmin`;
const CLOSED_SA = `${marker} Closed Superadmin`;
const SECOND_SA = `${marker} Second Superadmin`;
const STAFF_NAME = `${marker} Staff Holder`;

const userIds: number[] = [];
const credIds = [ownCred, otherCred, staffCred];
const savedEnv: Record<string, string | undefined> = {};

async function makeUser(name: string, role: string, isActive: boolean): Promise<number> {
  const [user] = await db
    .insert(usersTable)
    .values({
      name,
      email: `${name.replace(/\s+/g, ".").toLowerCase()}@vitest.invalid`,
      username: `${name.replace(/\s+/g, "-").toLowerCase()}`,
      role,
      permissions: JSON.stringify(["/queue"]),
      pin: "0000",
      isActive,
    })
    .returning({ id: usersTable.id });
  userIds.push(user.id);
  return user.id;
}

describe.skipIf(!hasDatabaseUrl())("Super Admin security-key login, as the mounted app answers it", () => {
  beforeAll(async () => {
    for (const name of ["SUPER_ADMIN_USB_KEY", "SUPER_ADMIN_REQUIRE_KEY", "SUPER_ADMIN_REQUIRE_2FA"]) {
      savedEnv[name] = process.env[name];
    }
    process.env["SUPER_ADMIN_USB_KEY"] = driveKey;
    delete process.env["SUPER_ADMIN_REQUIRE_KEY"];
    delete process.env["SUPER_ADMIN_REQUIRE_2FA"];

    app = await createTestApp();
    const openId = await makeUser(OPEN_SA, "super_admin", true);
    await makeUser(CLOSED_SA, "super_admin", false);
    const secondId = await makeUser(SECOND_SA, "super_admin", true);
    // A staff account holding a key is the fence case: the same credential table
    // serves the ERP login, so a staff member's key must not open the Super Admin door.
    const staffId = await makeUser(STAFF_NAME, "staff", true);
    await db.insert(webauthnCredentialsTable).values([
      { userId: openId, credentialId: ownCred, publicKey: "co2YvT2stubkey", transports: '["usb"]' },
      { userId: secondId, credentialId: otherCred, publicKey: "co2YvT2stubkey", transports: '["usb"]' },
      { userId: staffId, credentialId: staffCred, publicKey: "co2YvT2stubkey", transports: '["usb"]' },
    ]);
  });

  afterAll(async () => {
    await db.delete(webauthnCredentialsTable).where(inArray(webauthnCredentialsTable.credentialId, credIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("the path is mounted where the browser calls it, ahead of the plugin gate", async () => {
    // Not 404, and not "Super Admin plugin is not loaded": this has to work before any
    // plugin exists, which is the whole reason host auth is its own router.
    const res = await request(app)
      .post("/api/super-admin/key-login/begin")
      .set("x-sa-usb-key", driveKey)
      .send({ name: OPEN_SA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.challenge).toBe("string");
    expect(res.body.challenge.length).toBeGreaterThan(10);
    expect(res.body.userVerification).toBe("required");
  });

  test("it names only the credentials of the account being signed in to", async () => {
    const res = await request(app)
      .post("/api/super-admin/key-login/begin")
      .set("x-sa-usb-key", driveKey)
      .send({ name: OPEN_SA });
    const ids: string[] = (res.body.allowCredentials || []).map((c: { id: string }) => c.id);
    expect(ids).toEqual([ownCred]);
    expect(ids).not.toContain(otherCred);
  });

  test("a caller holding no pen drive is refused before anything is revealed", async () => {
    const res = await request(app).post("/api/super-admin/key-login/begin").send({ name: OPEN_SA });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/USB key required/i);
  });

  test("an unknown name, a closed account and a staff key holder all get one sentence", async () => {
    const sentences = new Set<string>();
    for (const name of [`${marker} Nobody At All`, CLOSED_SA, STAFF_NAME]) {
      const res = await request(app)
        .post("/api/super-admin/key-login/begin")
        .set("x-sa-usb-key", driveKey)
        .send({ name });
      expect(res.status, name).toBe(401);
      sentences.add(String(res.body.error));
    }
    expect(sentences.size).toBe(1);
    expect([...sentences][0]).toMatch(/No security key can be used/i);
  });

  test("a staff member's security key does not open the Super Admin door", async () => {
    // The credential table is shared with the ERP login, so the only thing standing
    // between a staff key and a super-admin session is this role check. It must refuse
    // before the ceremony even starts, and never list that credential.
    const res = await request(app)
      .post("/api/super-admin/key-login/begin")
      .set("x-sa-usb-key", driveKey)
      .send({ name: STAFF_NAME });
    expect(res.status).toBe(401);
    const listed = ((res.body as { allowCredentials?: { id: string }[] }).allowCredentials || [])
      .map((c) => c.id);
    expect(listed).not.toContain(staffCred);
  });

  test("a challenge issued for one super admin cannot sign in as another", async () => {
    // Two live super admins, both holding keys. The assertion cannot be produced in a
    // test, but the account binding is checked before the signature, and that is the
    // step under test: a challenge is only worth anything to the account that asked.
    const begun = await request(app)
      .post("/api/super-admin/key-login/begin")
      .set("x-sa-usb-key", driveKey)
      .send({ name: OPEN_SA });
    expect(begun.status).toBe(200);

    const res = await request(app)
      .post("/api/super-admin/login")
      .set("x-sa-usb-key", driveKey)
      .send({
        name: SECOND_SA,
        webauthnChallenge: begun.body.challenge,
        keyAssertion: { id: otherCred, type: "public-key", clientExtensionResults: {}, response: {} },
      });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/expired/i);
    expect(res.body.token).toBeUndefined();
  });

  test("the ordinary pen-drive login is still there and still needs the drive", async () => {
    const res = await request(app).post("/api/super-admin/login").send({ name: OPEN_SA, usbPin: "0000" });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/USB key required/i);
  });

  test("begin is throttled, not merely described as throttled", async () => {
    const res = await request(app)
      .post("/api/super-admin/key-login/begin")
      .set("x-sa-usb-key", driveKey)
      .send({ name: OPEN_SA });
    // express-rate-limit 8 emits the draft-6 set; a missing header reads as NaN.
    expect(Number(res.headers["ratelimit-limit"])).toBeGreaterThan(0);
    expect(Number(res.headers["ratelimit-remaining"])).toBeLessThan(Number(res.headers["ratelimit-limit"]));
  });
});
