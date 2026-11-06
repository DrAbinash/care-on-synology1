/**
 * The TOTP login exchange must be reachable WITHOUT a session.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `routes/index.ts` mounted the whole TOTP router behind `requireStaffAuth`:
 *
 *   router.use("/portal/totp", requireStaffAuth, totpRouter);
 *
 * but `/verify-login` is the step that CREATES the session. It authenticates the
 * 5-minute `totp_pending` temp token from its own body, and `requireStaffAuth`
 * only accepts scope "staff" — which does not exist yet at that point. So every
 * admin with TOTP enrolled was refused before their code was ever checked:
 * the login screen showed "Staff authentication required" for a correct 6-digit
 * code, and backup codes failed the same way because they ride the same route.
 * Measured on the clinic's own login page, 2026-10-29 ~01:20 IST.
 *
 * No test had ever posted to this endpoint, which is why it shipped. These are
 * request-level assertions through the real router on purpose: a source-text test
 * would have stayed green while the mount kept the route unreachable, which is
 * exactly what happened.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable, portalSessionsTable } from "@workspace/db/schema";
import { inArray, eq } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const VERIFY_URL = "/api/portal/totp/verify-login";
const marker = `vitest-totp-${randomUUID()}`.slice(0, 26);

let app: Express;
let userId = 0;
let secretBase32 = "";
const tempTokens: string[] = [];

function currentCode(): string {
  return new OTPAuth.TOTP({
    issuer: "Care Diagnostics ERP",
    label: marker,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

/** The same temp token staff-login issues: scope "totp_pending", 5 minutes. */
async function issueTempToken(): Promise<string> {
  const token = `${marker}-temp-${randomUUID()}`.slice(0, 60);
  tempTokens.push(token);
  await db.insert(portalSessionsTable).values({
    token,
    scope: "totp_pending",
    subjectId: userId,
    subjectName: `${marker}-admin`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return token;
}

describe.skipIf(!hasDatabaseUrl())("TOTP login exchange is reachable before a session exists", () => {
  beforeAll(async () => {
    app = await createTestApp();
    secretBase32 = new OTPAuth.Secret({ size: 20 }).base32;
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
        totpEnabled: true,
        totpSecret: secretBase32,
        totpBackupCodes: ["AAAA1111BBBB2222"],
      })
      .returning({ id: usersTable.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (tempTokens.length) {
      await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.token, tempTokens));
    }
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  test("a correct 6-digit code exchanges the temp token for a real session", async () => {
    const tempToken = await issueTempToken();
    const res = await request(app).post(VERIFY_URL).send({ tempToken, code: currentCode() });

    // Before the fix this was 401 { error: "Staff authentication required" }.
    expect(res.status).toBe(200);
    expect(typeof (res.body as { token?: string }).token).toBe("string");
    expect(((res.body as { token: string }).token ?? "").length).toBeGreaterThan(20);
    expect((res.body as { user?: { role?: string } }).user?.role).toBe("super_admin");
  });

  test("the temp token is spent by that exchange", async () => {
    const tempToken = await issueTempToken();
    const first = await request(app).post(VERIFY_URL).send({ tempToken, code: currentCode() });
    expect(first.status).toBe(200);
    const again = await request(app).post(VERIFY_URL).send({ tempToken, code: currentCode() });
    expect(again.status).toBe(401);
    expect(String((again.body as { error?: string }).error)).toMatch(/temp token/i);
  });

  test("a wrong code reaches the handler, so it is refused as a wrong code", async () => {
    const tempToken = await issueTempToken();
    const res = await request(app).post(VERIFY_URL).send({ tempToken, code: "000000" });
    // The point is WHICH 401 this is: "Invalid TOTP code" proves the handler ran.
    // "Staff authentication required" would prove the mount is broken again.
    expect(res.status).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/Invalid TOTP code/i);
  });

  test("a backup code logs in too — the same route, so it failed the same way", async () => {
    const tempToken = await issueTempToken();
    const res = await request(app).post(VERIFY_URL).send({ tempToken, backupCode: "AAAA1111BBBB2222" });
    expect(res.status).toBe(200);
    expect(typeof (res.body as { token?: string }).token).toBe("string");
  });

  test("a missing temp token is a 400 from the handler, not a 401 from middleware", async () => {
    const res = await request(app).post(VERIFY_URL).send({ code: currentCode() });
    expect(res.status).toBe(400);
    expect(String((res.body as { error?: string }).error)).toMatch(/Temp token and code are required/i);
  });

  test("positive control: the post-session routes are still gated", async () => {
    // The fix moved ONE route out from under requireStaffAuth. If this ever
    // answers 200 without a session, the gate was widened, not narrowed.
    const res = await request(app).get("/api/portal/totp/status");
    expect(res.status).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/Staff authentication required/i);
  });

  // Last: the limiter counts failures per IP for 15 minutes inside this
  // process, so anything above that would trip over its own throttle.
  test("the code oracle is throttled", async () => {
    const tempToken = await issueTempToken();
    const probe = await request(app).post(VERIFY_URL).send({ tempToken, code: "000000" });
    expect(Number(probe.headers["ratelimit-limit"])).toBe(10);

    let saw429 = false;
    for (let i = 0; i < 12 && !saw429; i++) {
      const res = await request(app).post(VERIFY_URL).send({ tempToken, code: "000000" });
      if (res.status === 429) saw429 = true;
    }
    expect(saw429, "repeated wrong codes must eventually be throttled").toBe(true);
  });
});
