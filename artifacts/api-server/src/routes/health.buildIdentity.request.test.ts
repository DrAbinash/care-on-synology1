import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import type { Express } from "express";

/**
 * GET /api/health — release identity (E4). Must stay free of secrets and
 * must not break the existing /api/healthz readiness contract.
 */
describe.skipIf(!hasDatabaseUrl())("GET /api/health build identity", () => {
  const prev = process.env.GIT_COMMIT;
  let app: Express;

  beforeAll(async () => {
    process.env.GIT_COMMIT = "0616667905b583dc6e4dca0c6ce7ffeef9d86615";
    app = await createTestApp();
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = prev;
  });

  it("returns status ok and build.commit without leaking env secrets", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.status).toBe("ok");
    // Exactly the three identity fields — nothing else may ride out of /api/health.
    expect(Object.keys(res.body.build).sort()).toEqual([
      "artifactSha256",
      "commit",
      "imageBuiltAt",
    ]);
    expect(res.body.build.commit).toBe("0616667905b5");
    // Self-derived fields stay null-or-text: a missing build-info.json must not
    // be dressed up as a value.
    for (const key of ["artifactSha256", "imageBuiltAt"]) {
      const value = res.body.build[key];
      expect(value === null || (typeof value === "string" && value.length > 0)).toBe(true);
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/DATABASE_URL|JWT|SECRET|API_KEY|PASSWORD|postgres:\/\//i);
    expect(res.body).not.toHaveProperty("DATABASE_URL");
  });

  it("keeps /api/healthz shape intact (status field still present)", async () => {
    const res = await request(app).get("/api/healthz");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(res.body.build).toBeUndefined();
  });
});
