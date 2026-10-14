// ============================================================================
// PR-I9 — the admin outbox list must show the report that gave up.
//
// `GET /api/integration/admin/outbox` (routes/integration/admin.ts:186-192) reads
// `ORDER BY created_at DESC LIMIT 200`. That is the newest-first shape of a news
// feed applied to a failure queue: once more than 200 rows match the filter, the
// event that DEAD-LETTERED three weeks ago is not on the page at all, and the
// screen — the only place a human can go to look for undelivered Hope reports —
// reads as if the backlog were the ordinary retrying kind. An event CARE stopped
// retrying is indistinguishable from silence.
//
// Request level, not a source grep: AGENTS.md is explicit that route behaviour is
// proven through the router, because a grep stayed green while the endpoint under
// it returned 500 on every call.
//
// Synthetic rows only; nothing here contacts HOPE.
// ============================================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { integrationOutboxTable, portalSessionsTable, usersTable } from "@workspace/db/schema";
import { like } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const MARKER = `pr-i9-admin-${randomUUID().slice(0, 8)}`;
const URL = "/api/integration/admin/outbox";
const NEWER_RETRYING = 220; // > the route's own LIMIT of 200

describe.skipIf(!hasDatabaseUrl())("integration admin outbox list — request level", () => {
  let app: Express;
  const adminToken = `${MARKER}-adm-${randomUUID()}`;
  const nurseToken = `${MARKER}-nurse-${randomUUID()}`;
  const deadIds: number[] = [];

  const asAdmin = { Authorization: `Bearer ${adminToken}` };
  const asNurse = { Authorization: `Bearer ${nurseToken}` };

  beforeAll(async () => {
    app = await createTestApp();
    const [admin] = await db.insert(usersTable).values({
      name: `Delivery Admin ${MARKER}`,
      email: `${MARKER}@vitest.invalid`,
      username: `${MARKER}-user`,
      role: "admin",
      permissions: JSON.stringify([]),
      pin: "0000",
      isActive: true,
    }).returning();
    const [nurse] = await db.insert(usersTable).values({
      name: `Nurse ${MARKER}`,
      email: `${MARKER}-nurse@vitest.invalid`,
      username: `${MARKER}-nurse`,
      role: "nurse",
      permissions: JSON.stringify(["/reports"]),
      pin: "0000",
      isActive: true,
    }).returning();
    await db.insert(portalSessionsTable).values([
      { token: adminToken, scope: "staff", subjectId: admin.id, subjectName: admin.name, expiresAt: new Date(Date.now() + 3_600_000) },
      { token: nurseToken, scope: "staff", subjectId: nurse.id, subjectName: nurse.name, expiresAt: new Date(Date.now() + 3_600_000) },
    ]);

    // One abandoned report, a queue of younger retrying rows behind it, and three
    // freshly delivered rows on top — which is exactly what a newest-first list
    // shows an operator: the healthy end of the queue.
    const [abandoned] = await db.insert(integrationOutboxTable).values({
      eventId: `${MARKER}-dead`,
      eventType: "diagnostic_report.finalised",
      eventVersion: "1.0",
      idempotencyKey: `${MARKER}-dead-key`,
      correlationId: `${MARKER}-dead-referral`,
      aggregateId: `${MARKER}-dead-referral`,
      destinationOrg: "HOPE",
      payload: {},
      status: "dead",
      attempts: 8,
      maxAttempts: 8,
      lastError: "http_500",
      nextAttemptAt: new Date(Date.now() - 30 * 86_400_000),
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    }).returning({ id: integrationOutboxTable.id });
    deadIds.push(abandoned.id);

    const row = (i: number, status: "pending" | "sent") => ({
      eventId: `${MARKER}-${status}-${i}`,
      eventType: "diagnostic_report.finalised",
      eventVersion: "1.0",
      idempotencyKey: `${MARKER}-${status}-${i}-key`,
      correlationId: `${MARKER}-${status}-${i}`,
      aggregateId: `${MARKER}-${status}-${i}`,
      destinationOrg: "HOPE",
      payload: {},
      status,
      attempts: 1,
      maxAttempts: 8,
      lastError: status === "sent" ? null : "http_503",
      // A minute apart so created_at ordering is strictly newest-first here.
      createdAt: new Date(Date.now() - i * 60_000),
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    await db.insert(integrationOutboxTable).values(
      [...Array.from({ length: NEWER_RETRYING }, (_, i) => row(i, "pending")),
       ...[0, 1, 2].map((i) => row(i, "sent"))]);
  }, 120_000);

  afterAll(async () => {
    if (!hasDatabaseUrl()) return;
    await db.delete(integrationOutboxTable).where(like(integrationOutboxTable.correlationId, `${MARKER}%`));
    await db.delete(portalSessionsTable).where(like(portalSessionsTable.token, `${MARKER}%`));
    await db.delete(usersTable).where(like(usersTable.username, `${MARKER}%`));
  }, 60_000);

  it("surfaces the dead-lettered report even when 200+ newer rows match the filter", async () => {
    const res = await request(app).get(URL).set(asAdmin).query({ status: "dead,pending,sending" });
    expect(res.status, res.text).toBe(200);
    const events = res.body.events as Array<{ id: number; status: string }>;
    expect(events.length, "the list came back empty, so the ordering assertion below proves nothing")
      .toBeGreaterThan(0);
    const hit = events.find((e) => e.id === deadIds[0]);
    expect(hit,
      `the report CARE gave up on is missing from the first ${events.length} rows of `
      + `${events.length} returned (newest-first + LIMIT 200 buries it: `
      + `${events.filter((e) => e.status === "pending").length} retrying rows were returned instead)`)
      .toBeDefined();
    expect(hit!.status).toBe("dead");
    expect(events[0].id, `an operator's first row should be the one that needs a person, got ${events[0].status}`)
      .toBe(deadIds[0]);
  });

  it("keeps the delivered rows out of the way of the ones that need attention", async () => {
    const res = await request(app).get(URL).set(asAdmin).query({ status: "dead,pending,sending,sent" });
    expect(res.status).toBe(200);
    const events = res.body.events as Array<{ status: string }>;
    const firstSent = events.findIndex((e) => e.status === "sent");
    const lastUnresolved = events.map((e) => e.status).lastIndexOf("pending");
    if (firstSent !== -1 && lastUnresolved !== -1) {
      expect(lastUnresolved, "a delivered event was ranked above an undelivered one")
        .toBeLessThan(firstSent);
    }
  });

  it("still refuses a non-admin, because this list carries report payloads", async () => {
    const res = await request(app).get(URL).set(asNurse).query({ status: "dead" });
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });
});
