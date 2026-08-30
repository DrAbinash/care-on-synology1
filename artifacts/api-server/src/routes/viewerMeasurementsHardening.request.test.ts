/**
 * Request-level hardening for viewer_measurements:
 * ignored annotations must not be rehydrated by annotationId upsert.
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
  patientsTable,
  viewerMeasurementsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("viewer_measurements hardening — request level", () => {
  let app: Express;
  const marker = `vmh-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const studyUID = `1.2.840.test.${marker}`;
  const annotationId = `ann-${marker}`;
  let userId = 0;
  let patientId = 0;
  let rowId = 0;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `VMH ${marker}`,
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
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `VMH-${marker}`,
        firstName: "VMH",
        lastName: `Patient ${marker}`,
        dateOfBirth: "1980-01-01",
        gender: "other",
        phone: `9${String(Date.now()).slice(-9)}`,
      })
      .returning();
    patientId = patient.id;
  });

  afterAll(async () => {
    if (studyUID) {
      await db
        .delete(viewerMeasurementsTable)
        .where(eq(viewerMeasurementsTable.studyInstanceUID, studyUID));
    }
    if (patientId) {
      await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    }
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("upserts by annotationId then refuses to revive ignored rows", async () => {
    const create = await request(app)
      .post("/api/radiology-lesions/viewer-measurements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        patientId,
        studyInstanceUID: studyUID,
        viewerName: "OHIF",
        measurementType: "L4-L5",
        value: "6.8",
        unit: "mm",
        imageCoordinates: JSON.stringify({ annotationId, intent: "CANAL_AP" }),
        status: "pending",
      });
    expect(create.status).toBe(201);
    rowId = create.body?.measurements?.[0]?.id ?? 0;
    expect(rowId).toBeGreaterThan(0);

    const again = await request(app)
      .post("/api/radiology-lesions/viewer-measurements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        patientId,
        studyInstanceUID: studyUID,
        viewerName: "OHIF",
        measurementType: "L4-L5",
        value: "7.1",
        unit: "mm",
        imageCoordinates: JSON.stringify({ annotationId, intent: "CANAL_AP" }),
        status: "pending",
      });
    expect(again.status).toBe(201);
    expect(again.body?.measurements?.[0]?.id).toBe(rowId);
    expect(again.body?.measurements?.[0]?.value).toBe("7.1");

    const ignore = await request(app)
      .patch(`/api/radiology-lesions/viewer-measurements/${rowId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "ignored" });
    expect(ignore.status).toBe(200);
    expect(ignore.body?.measurement?.status).toBe("ignored");

    const stale = await request(app)
      .post("/api/radiology-lesions/viewer-measurements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        patientId,
        studyInstanceUID: studyUID,
        viewerName: "OHIF",
        measurementType: "L4-L5",
        value: "9.9",
        unit: "mm",
        imageCoordinates: JSON.stringify({ annotationId, intent: "CANAL_AP" }),
        status: "pending",
      });
    expect(stale.status).toBe(201);
    expect(stale.body?.measurements?.[0]?.id).toBe(rowId);
    expect(stale.body?.measurements?.[0]?.status).toBe("ignored");
    expect(stale.body?.measurements?.[0]?.value).toBe("7.1");
  });
});
