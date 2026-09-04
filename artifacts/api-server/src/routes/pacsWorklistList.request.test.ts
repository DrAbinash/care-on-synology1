/**
 * Request-level: GET /api/radiology/pacs-worklist must not ship heavy blobs.
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
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("pacs-worklist list payload — request level", () => {
  let app: Express;
  const marker = `pacslist-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  let worklistId = 0;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Pacs List ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/orders", "/patients", "/reports"]),
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
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `List Probe ${marker}`,
        modality: "MR",
        status: "STUDY_RECEIVED",
        studyDescription: `perf-wiring ${marker}`,
        studyDate: "20260904",
        accessionNumber: `ACC-PL-${marker}`,
        studyInstanceUID: `1.2.840.perf.${marker}`,
        dicomMetadata: JSON.stringify({ PatientAge: "045Y", huge: "x".repeat(2000) }),
        aiDraftJson: JSON.stringify({ findings: "blob should not ship on list", impression: "x" }),
        aiDraftStatus: "NONE",
      })
      .returning();
    worklistId = wl.id;
  });

  afterAll(async () => {
    if (worklistId) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    }
    if (token) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    }
    if (userId) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("list rows omit dicomMetadata and aiDraftJson", async () => {
    const res = await request(app)
      .get("/api/radiology/pacs-worklist")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === worklistId);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("dicomMetadata");
    expect(row).not.toHaveProperty("aiDraftJson");
    expect(row).toHaveProperty("modality", "MR");
    expect(row).toHaveProperty("patientName");
  });

  it("per-study ai-draft detail still returns draft content", async () => {
    const res = await request(app)
      .get(`/api/radiology/pacs-worklist/${worklistId}/ai-draft`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("draft");
  });

  it("per-study detail returns dicomMetadata + demographics, not aiDraftJson", async () => {
    const res = await request(app)
      .get(`/api/radiology/pacs-worklist/${worklistId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("id", worklistId);
    expect(res.body).toHaveProperty("dicomMetadata");
    expect(res.body).toHaveProperty("patientName");
    expect(res.body).toHaveProperty("age");
    expect(res.body).toHaveProperty("sex");
    expect(res.body).not.toHaveProperty("aiDraftJson");
    expect(String(res.body.dicomMetadata)).toContain("PatientAge");
  });

  it("list USG aggregates are present and numeric for seeded rows", async () => {
    const res = await request(app)
      .get("/api/radiology/pacs-worklist")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === worklistId);
    expect(row).toBeTruthy();
    expect(typeof row!.usgMeasurementCount).toBe("number");
    expect(typeof row!.usgKeyImageCount).toBe("number");
    expect(row).toHaveProperty("usgReportStatus");
  });
});
