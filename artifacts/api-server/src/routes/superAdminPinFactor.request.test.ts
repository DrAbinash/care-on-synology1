/**
 * WHY THIS FILE EXISTS
 *
 * The Super Admin login used to accept `usbPin` — one four-digit value shared by every
 * super admin, held in a plain text file (superadmin.pin) next to the drive key on the
 * same stick. Presenting the stick was therefore the same as presenting the secret, and
 * the personal PIN was never checked. That substitution is gone, and a unit suite that
 * imports the router object cannot prove it: the shape that mattered was the mounted
 * route answering a real body with a real user row behind it.
 *
 * These cases run against the mounted application and a real database, so the whole
 * chain is exercised — the request schema, the pen-drive gate, the name lookup and the
 * PIN comparison. The one thing no test can do is sign a WebAuthn challenge, which is
 * why the tap itself is covered in superAdminHostAuth.test.ts with the signing library
 * replaced; what the tap is allowed to *replace* is this repository's own decision and
 * is checked here.
 *
 * Its own file rather than extra cases in superAdminKeyLogin.request.test.ts: both
 * routes share `loginLimiter` (10 per 15 minutes per address) and that suite already
 * spends eight of them. A separate store is the difference between a check and a flake.
 *
 * Skips rather than fails without DATABASE_URL, as the other request suites do.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, superAdminSessionsTable, webauthnCredentialsTable } from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

let app: Express;

const marker = `vitest-pin-${randomUUID()}`.slice(0, 27);
const driveKey = `${marker}-drive-key`;
const credId = `${marker}-cred`;
const sharedPin = "4321";
const personalPin = "8842";
const SA_NAME = `${marker} Pin Superadmin`;

let userId = 0;
const savedEnv: Record<string, string | undefined> = {};

async function login(body: Record<string, string>, header: string | null = driveKey) {
  const call = request(app).post("/api/super-admin/login").send(body);
  if (header !== null) call.set("x-sa-usb-key", header);
  return call;
}

function tokenOf(body: unknown): string | undefined {
  return (body as { token?: string }).token;
}

describe.skipIf(!hasDatabaseUrl())("Super Admin PIN factor, as the mounted app enforces it", () => {
  beforeAll(async () => {
    for (const name of ["SUPER_ADMIN_USB_KEY", "SUPER_ADMIN_USB_PIN", "SUPER_ADMIN_REQUIRE_KEY", "SUPER_ADMIN_REQUIRE_2FA"]) {
      savedEnv[name] = process.env[name];
    }
    process.env["SUPER_ADMIN_USB_KEY"] = driveKey;
    // The shared pen-drive PIN is set to a known value on purpose. Every refusal
    // below that involves it is only worth anything if the value matches: a test that
    // sent a non-matching code would pass even with the substitution restored.
    process.env["SUPER_ADMIN_USB_PIN"] = sharedPin;
    delete process.env["SUPER_ADMIN_REQUIRE_KEY"];
    delete process.env["SUPER_ADMIN_REQUIRE_2FA"];

    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: SA_NAME,
        email: `${marker}.pin@vitest.invalid`,
        username: `${marker}-pin`,
        role: "super_admin",
        permissions: JSON.stringify(["/queue"]),
        pin: personalPin,
        isActive: true,
      })
      .returning({ id: usersTable.id });
    userId = user.id;
    // A key enrolled for this account. Without a credential row the switch answers 403
    // "register one" — a different, also-correct door — so the 401 below would pass for
    // the wrong reason. The public key is a stub: no signature is asked for here,
    // because this case is about a login that never tapped.
    await db.insert(webauthnCredentialsTable).values({
      userId,
      credentialId: credId,
      publicKey: "co2YvT2stubkey",
      transports: '["usb"]',
    });
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.credentialId, credId));
      await db.delete(superAdminSessionsTable).where(eq(superAdminSessionsTable.userId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("drive + the account's own PIN still opens it", async () => {
    const res = await login({ name: SA_NAME, pin: personalPin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((tokenOf(res.body) ?? "").length).toBeGreaterThan(20);
    expect(res.body.userName).toBe(SA_NAME);
  });

  test("usbPin alone is refused before the PIN is even looked at", async () => {
    // The request that used to log in. The value matches SUPER_ADMIN_USB_PIN exactly —
    // see beforeAll — so this can only be passing because the field no longer counts.
    const res = await login({ name: SA_NAME, usbPin: sharedPin });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/PIN is required/i);
    expect(tokenOf(res.body)).toBeUndefined();
  });

  test("the shared PIN typed into the PIN box is answered as a wrong PIN", async () => {
    // It used to be reclassified as usbPin and skip the check. Now it is one more
    // incorrect PIN, and it gets the same sentence as any other so the endpoint stays
    // silent about which accounts exist and which codes are shared.
    const res = await login({ name: SA_NAME, pin: sharedPin });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/Invalid credentials/i);
    expect(tokenOf(res.body)).toBeUndefined();
  });

  test("a wrong PIN is refused", async () => {
    const res = await login({ name: SA_NAME, pin: "000000" });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/Invalid credentials/i);
  });

  test("no drive, no session — even with the right PIN", async () => {
    const res = await login({ name: SA_NAME, pin: personalPin }, null);
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/USB key required/i);
    expect(tokenOf(res.body)).toBeUndefined();
  });

  test("with SUPER_ADMIN_REQUIRE_KEY on, the right PIN alone is refused and the tap is named", async () => {
    process.env["SUPER_ADMIN_REQUIRE_KEY"] = "1";
    try {
      const res = await login({ name: SA_NAME, pin: personalPin });
      expect(res.status).toBe(401);
      expect(res.body.requiresKey).toBe(true);
      expect(tokenOf(res.body)).toBeUndefined();
    } finally {
      delete process.env["SUPER_ADMIN_REQUIRE_KEY"];
    }
  });

  test("a refusal never writes a session row", async () => {
    // The cases above are only evidence if the door they closed was the one that hands
    // out tokens. Count the rows rather than trusting the status codes.
    const rows = await db
      .select({ token: superAdminSessionsTable.token })
      .from(superAdminSessionsTable)
      .where(eq(superAdminSessionsTable.userId, userId));
    expect(rows.length).toBe(1);
  });
});
