/**
 * Request-level hardening for spinal canal measurements:
 * finalize lock + auth on write/delete.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  spinalMeasurementsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("spinal canal measurements hardening — request level", () => {
  let app: Express;
  const marker = `canal-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  let draftId = 0;
  const studyId = 9_100_000 + Math.floor(Math.random() * 90_000);
  let rowId = 0;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Canal ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/orders", "/radiology", "/report-generator", "/reports"]),
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: `Canal harden ${marker}`,
        modality: "MR",
        rawFindings: "x",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;
  });

  afterAll(async () => {
    if (studyId) {
      await db.delete(spinalMeasurementsTable).where(eq(spinalMeasurementsTable.studyId, studyId));
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    }
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("rejects unauthenticated canal write", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/spinal-measurements")
      .send({ studyId, draftId, vertebraLevel: "L4-L5", canalAP: "6.8" });
    expect(res.status).toBe(401);
  });

  it("allows canal write on DRAFT then blocks after FINAL", async () => {
    const ok = await request(app)
      .post("/api/radiology/report-generator/spinal-measurements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        studyId,
        draftId,
        vertebraLevel: "L4-L5",
        canalAP: "6.8",
        stenosisGrade: "none",
      });
    expect(ok.status).toBeGreaterThanOrEqual(200);
    expect(ok.status).toBeLessThan(300);
    rowId = ok.body?.id ?? 0;
    expect(rowId).toBeGreaterThan(0);

    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "FINAL", finalReportId: 990_001 })
      .where(eq(radiologyReportDraftsTable.id, draftId));

    const blocked = await request(app)
      .post("/api/radiology/report-generator/spinal-measurements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        studyId,
        draftId,
        vertebraLevel: "L4-L5",
        canalAP: "9.9",
        stenosisGrade: "none",
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body?.code ?? blocked.body?.error).toMatch(/REPORT_LOCKED|final/i);

    const del = await request(app)
      .delete(`/api/radiology/report-generator/spinal-measurements/${rowId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(409);
  });
});
