/**
 * Request-level coverage for PUT /api/radiology/report-generator/preferences.
 *
 * The reporting workspace clears an optional line by sending `null`, but
 * PreferencesSchema declared those fields `z.string().optional()`, which accepts
 * `undefined` and rejects `null`. Every save from the real UI therefore returned
 * 400 "Invalid body" and preferences never persisted — while the handler itself
 * wrote `data.footerText || null`, so it plainly intended to store null.
 *
 * These tests drive the mounted router (real middleware chain, real Postgres)
 * rather than reading source text, because the failure was a runtime contract
 * mismatch that a grep cannot see.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  usersTable,
  radiologyReportPreferencesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const marker = `vitest-prefs-${randomUUID().slice(0, 8)}`;

const VALID = {
  headingCase: "all_caps",
  sectionSpacing: "spaced",
  impressionStyle: "bulleted",
  showEndOfReportFooter: true,
  headerLine2Source: "template_name",
  workspaceLayout: "3_panel",
  printMode: "letterhead",
  showLetterpadHeader: true,
};

describe.skipIf(!hasDatabaseUrl())(
  "PUT /api/radiology/report-generator/preferences",
  () => {
    let app: Express;
    let token = "";
    let userId = 0;

    beforeAll(async () => {
      app = await createTestApp();
      token = `vitest-token-${randomUUID()}`;
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `Vitest Prefs ${marker}`,
          email: `${marker}@vitest.invalid`,
          username: marker,
          role: "admin",
          permissions: JSON.stringify(["radiology.report_generator"]),
          pin: "0000",
          isActive: true,
        })
        .returning();
      userId = user.id;
      await db.insert(portalSessionsTable).values({
        token,
        scope: "staff",
        subjectId: user.id,
        subjectName: user.name,
        expiresAt: new Date(Date.now() + 3600_000),
      });
    });

    afterAll(async () => {
      await db
        .delete(radiologyReportPreferencesTable)
        .where(eq(radiologyReportPreferencesTable.userId, userId));
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    });

    const put = (body: Record<string, unknown>) =>
      request(app).put("/api/radiology/report-generator/preferences").set("Authorization", `Bearer ${token}`).send(body);
    const get = () =>
      request(app).get("/api/radiology/report-generator/preferences").set("Authorization", `Bearer ${token}`);

    it("accepts the null values the workspace actually sends", async () => {
      const res = await put({ ...VALID, footerText: null, headerLine1: null, headerLine2Custom: null });
      expect(res.status).toBeLessThan(400);
      expect(res.status).toBe(201);
      expect(res.body.footerText).toBeNull();
    });

    it("accepts the same body with those fields omitted entirely", async () => {
      const res = await put({ ...VALID });
      expect(res.status).toBeLessThan(400);
    });

    it("stores valid strings and reads them back", async () => {
      const putRes = await put({
        ...VALID,
        footerText: "Follow-up MRI in six months.",
        headerLine1: "CARE DIAGNOSTICS",
        headerLine2Source: "custom",
        headerLine2Custom: "Multispeciality Imaging",
      });
      expect(putRes.status).toBeLessThan(400);
      const getRes = await get();
      expect(getRes.status).toBe(200);
      expect(getRes.body.footerText).toBe("Follow-up MRI in six months.");
      expect(getRes.body.headerLine2Custom).toBe("Multispeciality Imaging");
    });

    it("clearing a saved line back to null persists the clear", async () => {
      await put({ ...VALID, footerText: "Temporary footer" });
      const cleared = await put({ ...VALID, footerText: null });
      expect(cleared.status).toBeLessThan(400);
      const getRes = await get();
      expect(getRes.body.footerText).toBeNull();
      // The row itself survives — only the optional line is cleared.
      expect(getRes.body.headingCase).toBe("all_caps");
    });

    it("still rejects a genuinely invalid enum value", async () => {
      const res = await put({ ...VALID, headingCase: "shouty" });
      expect(res.status).toBe(400);
    });

    it("still rejects an over-length footer", async () => {
      const res = await put({ ...VALID, footerText: "x".repeat(501) });
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .put("/api/radiology/report-generator/preferences")
        .send({ ...VALID });
      expect(res.status).toBe(401);
    });
  },
);
