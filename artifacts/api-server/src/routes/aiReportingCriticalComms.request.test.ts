/**
 * Request-level: /api/ai-reporting/critical-findings is gated by
 * ff_radiology_critical_result_comms (PR-5).
 *
 * WHY A REQUEST TEST AND NOT A GREP
 *   The gate's whole job is to make a switched-off feature indistinguishable
 *   from a feature that does not exist. A source-text assertion can confirm the
 *   string `isFeatureEnabledServer("ff_radiology_critical_result_comms")` is
 *   present; it cannot confirm the handler actually returns 404 before it
 *   touches the database, that the gate sits ahead of the permission check, or
 *   that it re-reads the flag on every request rather than once at module load.
 *   This repo already shipped a route that passed its grep test while returning
 *   HTTP 500 on every call (see testSupport/apiTestApp.ts), so the three
 *   handlers are executed here against the real router.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 *   /api/radiology/critical-findings (the PACS dashboard widget, a different
 *   table: radiology_critical_findings) and
 *   /api/radiology-workflow/critical-alerts (the Critical Alerts Manager) are
 *   separate subsystems and are NOT gated by this flag. They are asserted
 *   ungated in the source-contract ratchet instead.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import { featureFlagsTable, portalSessionsTable, usersTable, criticalFindingsTable } from "@workspace/db/schema";
import { invalidateFeatureFlagCache } from "../lib/featureFlags";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const FLAG = "ff_radiology_critical_result_comms";

describe.skipIf(!hasDatabaseUrl())(
  "critical-result communication endpoints — feature-flag gate",
  () => {
    let app: Express;
    let token = "";
    let userId = 0;
    const marker = `vitest-critcomms-${randomUUID().slice(0, 8)}`;
    const createdFindingIds: number[] = [];
    /** The flag row's state before this file ran, so afterAll restores rather
     *  than deletes a row a real deployment may already have. */
    let preexisting: { enabled: boolean } | null = null;

    /** Write the flag through the same table the Settings toggle writes, then
     *  drop the 30s server-side cache so the next request re-reads it. */
    async function setFlag(enabled: boolean) {
      await db
        .insert(featureFlagsTable)
        .values({ key: FLAG, enabled, description: "vitest" })
        .onConflictDoUpdate({ target: featureFlagsTable.key, set: { enabled } });
      invalidateFeatureFlagCache();
    }

    beforeAll(async () => {
      app = await createTestApp();
      token = `vitest-token-${randomUUID()}`;

      const [prior] = await db
        .select()
        .from(featureFlagsTable)
        .where(eq(featureFlagsTable.key, FLAG))
        .limit(1);
      preexisting = prior ? { enabled: prior.enabled } : null;

      const [user] = await db
        .insert(usersTable)
        .values({
          name: `Vitest CritComms ${marker}`,
          email: `${marker}@vitest.invalid`,
          username: marker,
          role: "admin",
          permissions: JSON.stringify(["ai_reporting.use", "ai_reporting.configure"]),
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
      if (createdFindingIds.length) {
        await db.delete(criticalFindingsTable).where(inArray(criticalFindingsTable.id, createdFindingIds));
      }
      // Restore, don't remove: on a deployed database the migration seeds this
      // row and it must survive the test run.
      if (preexisting) {
        await db
          .update(featureFlagsTable)
          .set({ enabled: preexisting.enabled })
          .where(eq(featureFlagsTable.key, FLAG));
      } else {
        await db.delete(featureFlagsTable).where(eq(featureFlagsTable.key, FLAG));
      }
      invalidateFeatureFlagCache();
      if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    });

    const authed = () => ({ Authorization: `Bearer ${token}` });

    describe("flag OFF — the endpoints do not exist", () => {
      beforeAll(async () => { await setFlag(false); });

      it("GET returns 404 not_found", async () => {
        const res = await request(app).get("/api/ai-reporting/critical-findings").set(authed());
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "not_found" });
      });

      it("POST returns 404 and writes nothing", async () => {
        const before = await db.select({ id: criticalFindingsTable.id }).from(criticalFindingsTable);
        const res = await request(app)
          .post("/api/ai-reporting/critical-findings")
          .set(authed())
          .send({ reportId: 999999, findingKeywords: ["acute infarct"], severity: "critical" });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "not_found" });
        const after = await db.select({ id: criticalFindingsTable.id }).from(criticalFindingsTable);
        expect(after.length).toBe(before.length);
      });

      it("PATCH returns 404", async () => {
        const res = await request(app)
          .patch("/api/ai-reporting/critical-findings/1")
          .set(authed())
          .send({ status: "notified" });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "not_found" });
      });

      it("404s for an authenticated admin too — the gate precedes the permission check", async () => {
        // The session above is a FULL_ACCESS_ROLES admin with ai_reporting.use.
        // A 403 here would mean the gate ran after canUse(), which would leak
        // the existence of a disabled subsystem to whoever has permission.
        const res = await request(app).get("/api/ai-reporting/critical-findings").set(authed());
        expect(res.status).toBe(404);
      });
    });

    describe("flag ON — the endpoints work as before", () => {
      beforeAll(async () => { await setFlag(true); });

      it("GET returns a list", async () => {
        const res = await request(app).get("/api/ai-reporting/critical-findings").set(authed());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it("POST creates a record", async () => {
        const res = await request(app)
          .post("/api/ai-reporting/critical-findings")
          .set(authed())
          .send({ reportId: 999999, findingKeywords: ["acute infarct"], severity: "critical" });
        expect(res.status).toBe(200);
        expect(typeof res.body.id).toBe("number");
        createdFindingIds.push(res.body.id);
      });

      it("PATCH updates the notification status", async () => {
        expect(createdFindingIds.length).toBeGreaterThan(0);
        const id = createdFindingIds[0];
        const res = await request(app)
          .patch(`/api/ai-reporting/critical-findings/${id}`)
          .set(authed())
          .send({ status: "notified", notifiedTo: "dr@example.invalid", notificationMethod: "email" });
        expect(res.status).toBe(200);
        const [row] = await db
          .select()
          .from(criticalFindingsTable)
          .where(eq(criticalFindingsTable.id, id))
          .limit(1);
        expect(row.status).toBe("notified");
      });

      it("POST still validates its own payload once the gate is open", async () => {
        // The gate must not swallow the handler's existing 400s.
        const res = await request(app)
          .post("/api/ai-reporting/critical-findings")
          .set(authed())
          .send({ findingKeywords: [] });
        expect(res.status).toBe(400);
      });
    });

    describe("the gate is read per request, not once at module load", () => {
      it("returns to 404 after the flag is switched back off", async () => {
        await setFlag(false);
        const res = await request(app).get("/api/ai-reporting/critical-findings").set(authed());
        expect(res.status).toBe(404);
      });
    });
  },
);
