/**
 * S1 — the internal radiology gate now says WHO called, and never the credential.
 *
 * `requireStaffOrInternalAuth` is applied to every route on this router and
 * consults no permission and no role: the server-to-server key passes, and so does
 * any active staff session — a typist reaches `/radiology/worklist/:id`,
 * `/radiology/report-status` and `/dicom-agent/config` the same way the intake
 * automation does. Narrowing that is the owner's authorization decision, and the
 * decision needs the measurement first.
 *
 * This file is a request-level test on purpose (see testSupport/apiTestApp.ts for
 * why grep-style route tests are not enough here): it runs the real middleware
 * chain against a real PostgreSQL, with a real staff session row. Two claims are
 * pinned:
 *
 *   1. every authentication decision produces exactly one audit line carrying
 *      route (identifiers masked), caller category and outcome;
 *   2. nothing about this PR changes an HTTP status or a response body — the
 *      refusals still answer 401, the automation lane still answers 200.
 *
 * And the claim that matters most is asserted on the captured log, not on the
 * source text: a real bearer token, a real patient id and a real UHID go in, and
 * none of them come out.
 *
 * Skipped without DATABASE_URL; in CI it runs against the postgres:16 service.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable } from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const captured = vi.hoisted(() => [] as Array<{ level: string; args: unknown[] }>);

// The real pino logger is replaced by a recorder: the assertions below are about
// what WOULD be written, and a token must never be part of it.
vi.mock("../lib/logger", () => {
  const record = (level: string) => (...args: unknown[]) => captured.push({ level, args });
  const logger: Record<string, unknown> = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    debug: record("debug"),
    trace: record("trace"),
    fatal: record("fatal"),
  };
  logger.child = () => logger;
  return { logger };
});

const dbReady = hasDatabaseUrl();
const AUDIT_MESSAGE = "internal radiology route authentication decision";

describe.skipIf(!dbReady)("internal radiology caller logging — request level", () => {
  const marker = `s1-${randomUUID().slice(0, 8)}`;
  const staffToken = `vitest-s1-staff-${randomUUID()}`;
  const internalKey = `vitest-s1-internal-${randomUUID()}`;
  const PATIENT_ROW_ID = 41124112;

  let app: Express;
  let userId = 0;

  /** The audit lines only — other modules log during the same request. */
  const auditLines = () =>
    captured.filter((line) => line.args.some((a) => a === AUDIT_MESSAGE));

  const templates = (authorization?: string) => {
    const call = request(app).get("/api/internal/radiology/templates");
    return authorization ? call.set({ Authorization: `Bearer ${authorization}` }) : call;
  };

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = internalKey;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `S1 Probe ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "typist",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token: staffToken,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    app = await createTestApp();
  });

  afterAll(async () => {
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, staffToken)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    delete process.env.INTERNAL_API_KEY;
  });

  it("a staff session is logged by ROLE, answers 200 as before, and its token never reaches the log", async () => {
    captured.length = 0;
    const res = await templates(staffToken);

    // Behaviour unchanged: the same route, the same status, the same body shape.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].args[0]).toEqual({
      route: "GET /api/internal/radiology/templates",
      caller: "staff:typist",
      outcome: "allowed",
    });

    // The credential is a live session — logged, it is a replayable patient-data
    // door. Asserted on everything this request recorded, not just the audit line.
    expect(JSON.stringify(captured)).not.toContain(staffToken);
    expect(JSON.stringify(captured)).not.toContain(internalKey);
  });

  it("the automation lane is logged at debug as internal-key, and still answers 200", async () => {
    captured.length = 0;
    const res = await templates(internalKey);
    expect(res.status).toBe(200);

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    // Debug, not info: this lane fires on every DICOM arrival and must not flood
    // the clinic's daily log — while still being there when the level is turned up.
    expect(lines[0].level).toBe("debug");
    expect(lines[0].args[0]).toEqual({
      route: "GET /api/internal/radiology/templates",
      caller: "internal-key",
      outcome: "allowed",
    });
    expect(JSON.stringify(captured)).not.toContain(internalKey);
  });

  it("no credential is refused 401 as before and logged as anonymous", async () => {
    captured.length = 0;
    const res = await templates();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("warn");
    expect(lines[0].args[0]).toEqual({
      route: "GET /api/internal/radiology/templates",
      caller: "anonymous",
      outcome: "no-credential",
    });
  });

  it("an unresolvable credential is refused 401 and labelled nobody's, not staff's", async () => {
    captured.length = 0;
    const res = await templates(`vitest-not-a-session-${randomUUID()}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired session. Please log in again." });

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].args[0]).toMatchObject({ caller: "unrecognised-credential", outcome: "unknown-credential" });
  });

  it("an inactive staff account is refused 401 and still labelled by its role", async () => {
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));
    try {
      captured.length = 0;
      const res = await templates(staffToken);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Staff account is inactive." });

      const lines = auditLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].args[0]).toMatchObject({ caller: "staff:typist", outcome: "inactive-account" });
    } finally {
      await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, userId));
    }
  });

  it("a patient id and a UHID in the request never reach the audit line", async () => {
    captured.length = 0;
    const res = await request(app)
      .get(`/api/internal/radiology/patients/${PATIENT_ROW_ID}/contact?uhid=UHIDS1&name=Sharma`);

    // Unauthenticated: refused exactly as before the logging existed.
    expect(res.status).toBe(401);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].args[0]).toMatchObject({
      route: "GET /api/internal/radiology/patients/:id/contact",
      outcome: "no-credential",
    });
    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain(String(PATIENT_ROW_ID));
    expect(serialised).not.toContain("UHIDS1");
    expect(serialised).not.toContain("Sharma");
  });

  it("a numeric worklist row id is masked, and a typist reaches the row read", async () => {
    captured.length = 0;
    const res = await request(app)
      .get("/api/internal/radiology/worklist/999999999")
      .set({ Authorization: `Bearer ${staffToken}` });

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].args[0]).toMatchObject({
      route: "GET /api/internal/radiology/worklist/:id",
      caller: "staff:typist",
      outcome: "allowed",
    });
    // The audit line is a route shape plus a category: no row id, no body.
    expect(JSON.stringify(lines[0].args[0])).not.toContain("999999999");
    // No such row: whatever the route answers, it answers exactly as it did
    // before the logging existed — and the line above is the measurement that a
    // transcriptionist role reaches a per-row radiology read.
    expect([200, 404]).toContain(res.status);
  });
});
