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
 * beforeAll. The single database read on the public path is the credential allow-list.
 */
import { beforeAll, describe, expect, test } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

let app: Express;

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
