/**
 * WHY THIS FILE EXISTS
 *
 * "Sign in with Security Key" has never worked in CARE, and no test noticed, because
 * nothing ever asked the server what that button actually calls.
 *
 * `routes/webauthn.ts` declares its public routes as "/authenticate/begin" and
 * "/authenticate/complete", but `routes/index.ts` mounted that public router at
 * "/auth/webauthn/authenticate". Express concatenates the two, so the only reachable
 * public URL was /api/auth/webauthn/authenticate/authenticate/begin. The URL the login
 * screen posts to — /api/auth/webauthn/authenticate/begin — matched nothing in the
 * public router and fell through to the very next mount,
 * `router.use("/auth/webauthn", requireStaffAuth, …)`, which answered
 * 401 "Staff authentication required" to someone who has not authenticated yet.
 * Chrome was never handed a challenge, so `navigator.credentials.get()` never ran and
 * `webauthn_credentials.last_used_at` could not move.
 *
 * These are request-level assertions over the real router. A source-text test would
 * have passed the whole time: every path string was spelled correctly in the file that
 * declared it. Only executing the route shows what the mounted application answers.
 *
 * The suite skips without DATABASE_URL rather than failing collection, because
 * createTestApp() — the only thing that pulls in @workspace/db — is called inside
 * beforeAll. The later blocks create marker-scoped users and credentials and delete
 * them again; the login endpoints read the credential table, so there is no way to
 * exercise the closed-account fence without rows.
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

/** The shape authenticate/complete reads, with an id the server can look up. The
 *  signature fields are deliberately unusable: these tests only check *which*
 *  rejection fires first — the closed account's, or the signature check's. */
function assertion(credentialId: string, challenge: string) {
  return {
    response: {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: "dGVzdA",
        clientDataJSON: "dGVzdA",
        signature: "dGVzdA",
      },
    },
    expectedChallenge: challenge,
  };
}

describe.skipIf(!hasDatabaseUrl())("security-key login route reachability", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  test("POST /api/auth/webauthn/authenticate/begin answers an anonymous caller", async () => {
    const res = await request(app).post("/api/auth/webauthn/authenticate/begin").send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.challenge).toBe("string");
    expect(res.body.challenge.length).toBeGreaterThan(10);
    expect(typeof res.body.rpId).toBe("string");
    expect(res.body.userVerification).toBe("required");
    expect(Array.isArray(res.body.allowCredentials)).toBe(true);
    for (const c of res.body.allowCredentials) {
      expect(typeof c.id).toBe("string");
      expect(c.type).toBe("public-key");
    }
  });

  test("the doubled path is gone, so exactly one public route exists", async () => {
    const res = await request(app)
      .post("/api/auth/webauthn/authenticate/authenticate/begin")
      .send({});
    // Not 200: the duplicate must not stay reachable. Not 404 either: whatever answers,
    // it is the staff mount, and an anonymous caller must not get past it.
    expect(res.status).toBe(401);
  });

  test("POST /api/auth/webauthn/authenticate/complete is public too", async () => {
    const res = await request(app)
      .post("/api/auth/webauthn/authenticate/complete")
      .send({ response: {}, expectedChallenge: "not-a-real-challenge" });
    // Public means it reaches the handler and is rejected for the right reason —
    // a bad challenge (400), not an authentication demand (401).
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!hasDatabaseUrl())("the staff fence still guards everything that is not a login", () => {
  // The fix mounts the public router at /auth/webauthn and relies on fall-through for
  // paths it does not declare. If that fall-through ever broke, key enrolment and
  // credential listing would go public — which is what these tests exist to prevent.
  beforeAll(async () => {
    app = await createTestApp();
  });

  test("register/begin refuses anonymous callers", async () => {
    expect((await request(app).post("/api/auth/webauthn/register/begin").send({})).status).toBe(401);
  });

  test("register/complete refuses anonymous callers", async () => {
    const res = await request(app)
      .post("/api/auth/webauthn/register/complete")
      .send({ response: {}, expectedChallenge: "x" });
    expect(res.status).toBe(401);
  });

  test("credential listing and deletion refuse anonymous callers", async () => {
    expect((await request(app).get("/api/auth/webauthn/credentials")).status).toBe(401);
    expect((await request(app).delete("/api/auth/webauthn/credentials/1")).status).toBe(401);
  });
});

describe.skipIf(!hasDatabaseUrl())("a closed account's key is not a way back in", () => {
  // A security key is a credential that outlives the person. Deactivating a staff
  // member revokes their PIN and their sessions, but authenticate/complete used to
  // load the user by id with no isActive filter — so the key still minted a 24-hour
  // staff session. begin had the same hole from the other side: it listed every
  // credential in the table, so a closed account's key was still offered to whoever
  // opened the login screen.
  const marker = `vitest-wa-${randomUUID()}`.slice(0, 32);
  const openCred = `${marker}-open`;
  const closedCred = `${marker}-closed`;
  const userIds: number[] = [];

  async function makeUser(name: string, isActive: boolean): Promise<number> {
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `${marker}-${name}`,
        email: `${marker}-${name}@vitest.invalid`,
        username: `${marker}-${name}`,
        role: "staff",
        permissions: JSON.stringify(["/queue"]),
        pin: "0000",
        isActive,
      })
      .returning({ id: usersTable.id });
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const openId = await makeUser("open", true);
    const closedId = await makeUser("closed", false);
    // publicKey is an opaque base64url blob as far as these two handlers are
    // concerned; authenticate/complete only fails later, inside the signature check.
    await db.insert(webauthnCredentialsTable).values([
      { userId: openId, credentialId: openCred, publicKey: "co2YvT2stubkey", transports: '["usb"]' },
      { userId: closedId, credentialId: closedCred, publicKey: "co2YvT2stubkey", transports: '["usb"]' },
    ]);
  });

  afterAll(async () => {
    await db.delete(webauthnCredentialsTable).where(inArray(webauthnCredentialsTable.credentialId, [openCred, closedCred]));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  test("begin offers only the credentials of accounts that are still open", async () => {
    const res = await request(app).post("/api/auth/webauthn/authenticate/begin").send({});
    expect(res.status).toBe(200);
    const ids: string[] = (res.body.allowCredentials || []).map((c: { id: string }) => c.id);
    expect(ids).toContain(openCred);
    expect(ids).not.toContain(closedCred);
  });

  test("complete refuses the closed account's key before it spends the signature", async () => {
    const begun = await request(app).post("/api/auth/webauthn/authenticate/begin").send({});
    const res = await request(app)
      .post("/api/auth/webauthn/authenticate/complete")
      .send(assertion(closedCred, begun.body.challenge));
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test("the same assertion for an open account gets past the fence and fails on the signature", async () => {
    // Positive control: without this, the 401 above proves nothing beyond "the
    // handler rejects stub keys". The open account must reach the cryptographic
    // verification step — which rejects this assertion for a different reason.
    const begun = await request(app).post("/api/auth/webauthn/authenticate/begin").send({});
    const res = await request(app)
      .post("/api/auth/webauthn/authenticate/complete")
      .send(assertion(openCred, begun.body.challenge));
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!hasDatabaseUrl())("the anonymous login endpoints are throttled", () => {
  // This PR is what makes them reachable at all, and the ERP is published through
  // Cloudflare. Key enrolment is gated by staff auth; key *login* is not, so both
  // halves of the ceremony need a ceiling. Last in the file on purpose: the failed
  // attempts below consume the per-address quota of this process's limiter instance.
  beforeAll(async () => {
    app = await createTestApp();
  });

  test("begin and complete both answer with a rate-limit ceiling", async () => {
    const begun = await request(app).post("/api/auth/webauthn/authenticate/begin").send({});
    expect(begun.status).toBe(200);
    const done = await request(app)
      .post("/api/auth/webauthn/authenticate/complete")
      .send({ response: {}, expectedChallenge: "not-a-real-challenge" });
    expect(done.status).toBe(400);
    // express-rate-limit 8 emits the draft-6 set (RateLimit-Limit / -Policy /
    // -Remaining / -Reset); a missing header reads as NaN and fails the number.
    expect(Number(begun.headers["ratelimit-limit"]), "begin is not throttled").toBe(30);
    expect(Number(done.headers["ratelimit-limit"]), "complete is not throttled").toBe(10);
  });

  test("repeated failed signature checks end in a 429, not another attempt", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post("/api/auth/webauthn/authenticate/complete")
        .send({ response: {}, expectedChallenge: `not-a-real-challenge-${i}` });
      statuses.push(res.status);
    }
    expect(statuses[0]).toBe(400);
    expect(statuses).toContain(429);
  });
});
