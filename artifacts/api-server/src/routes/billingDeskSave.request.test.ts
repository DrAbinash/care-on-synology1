/**
 * billingDeskSave.request.test.ts — REAL request-level coverage for the desk's
 * one-shot Save & Print endpoint.
 *
 * Complements billingDeskSave.test.ts (which asserts on source text). That
 * grep-style test passed while this endpoint returned HTTP 500 on EVERY call:
 *
 *   POST /api/billing/save -> 500
 *   TypeError: Cannot set property query of #<IncomingMessage>
 *     which has only a getter
 *       at Function.assign
 *       at billingDeskSave.ts:77
 *
 * These tests execute the route, so that class of defect cannot ship again.
 * Skipped automatically when no DATABASE_URL is configured.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("POST /api/billing/save — request level", () => {
  let app: Express;
  let fx: BillingFixture;

  beforeAll(async () => {
    app = await createTestApp();
    fx = await seedBillingFixture();
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  }, 60_000);

  function savePayload(clientRef: string, overrides: Record<string, unknown> = {}) {
    return {
      patientId: fx.patientId,
      tests: [{ testId: fx.testId, price: fx.testPrice }],
      clientRef,
      payments: [{ amount: fx.testPrice, method: "cash" }],
      ...overrides,
    };
  }

  test("creates order + bill in one call and returns a bill number", async () => {
    const res = await request(app)
      .post("/api/billing/save")
      .set("Authorization", `Bearer ${fx.token}`)
      .send(savePayload(randomUUID()));

    // The production regression was a 500 here.
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      billNumber: expect.any(String),
      orderNumber: expect.any(String),
      status: "paid",
    });
    expect(Number(res.body.totalAmount)).toBeCloseTo(fx.testPrice, 2);
    expect(Number(res.body.orderId)).toBeGreaterThan(0);
    // ?fast=1 must still reach createBillHandler — this is the flag that was
    // being written onto the getter-only req.query.
    expect(res.body._fastMode).toBe(true);
  });

  test("replays the same bill for a repeated clientRef (no duplicate)", async () => {
    const clientRef = randomUUID();
    const first = await request(app)
      .post("/api/billing/save")
      .set("Authorization", `Bearer ${fx.token}`)
      .send(savePayload(clientRef));
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post("/api/billing/save")
      .set("Authorization", `Bearer ${fx.token}`)
      .send(savePayload(clientRef));

    expect(retry.status).toBe(200);
    expect(retry.body._idempotent).toBe(true);
    expect(retry.body.billNumber).toBe(first.body.billNumber);
  });

  test("?fast=0 is honoured (query is readable, not clobbered)", async () => {
    const res = await request(app)
      .post("/api/billing/save?fast=0")
      .set("Authorization", `Bearer ${fx.token}`)
      .send(savePayload(randomUUID()));

    expect(res.status).toBe(201);
    expect(res.body._fastMode).toBeUndefined();
    // Slow path returns the hydrated bill.
    expect(res.body.patient).not.toBeNull();
  });

  test("concurrent saves all succeed with unique bill numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/billing/save")
          .set("Authorization", `Bearer ${fx.token}`)
          .send(savePayload(randomUUID())),
      ),
    );

    for (const r of results) {
      expect(r.status).toBe(201);
    }
    const numbers = results.map((r) => r.body.billNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("rejects an unauthenticated save", async () => {
    const res = await request(app).post("/api/billing/save").send(savePayload(randomUUID()));
    expect(res.status).toBe(401);
  });

  test("a non-admin desk role may bill a package/VIP line below catalogue price", async () => {
    // The price-override guard used to require admin for ANY price != catalogue,
    // which 403'd normal reception staff on package splits.
    const res = await request(app)
      .post("/api/billing/save")
      .set("Authorization", `Bearer ${fx.token}`)
      .send(
        savePayload(randomUUID(), {
          tests: [{ testId: fx.testId, price: fx.testPrice / 2 }],
          payments: [{ amount: fx.testPrice / 2, method: "cash" }],
        }),
      );

    expect(res.status).toBe(201);
    expect(Number(res.body.totalAmount)).toBeCloseTo(fx.testPrice / 2, 2);
  });

  test("still rejects a non-admin markup above the catalogue ceiling", async () => {
    const res = await request(app)
      .post("/api/billing/save")
      .set("Authorization", `Bearer ${fx.token}`)
      .send(
        savePayload(randomUUID(), {
          tests: [{ testId: fx.testId, price: fx.testPrice * 5 }],
          payments: [],
        }),
      );

    expect(res.status).toBe(403);
  });
});
