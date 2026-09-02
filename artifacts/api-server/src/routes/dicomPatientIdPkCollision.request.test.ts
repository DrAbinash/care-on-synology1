/**
 * Intake must not bind DICOM PatientID to patients.id (internal PK).
 * Request-level coverage against POST /api/internal/radiology/studies.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  patientsTable,
  radiologyWorklistTable,
  usersTable,
  portalSessionsTable,
} from "@workspace/db/schema";
import { eq, like, or } from "drizzle-orm";
import { matchAllowsFinalize } from "../lib/radiologyIdentity";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("DICOM PatientID must not auto-link via internal PK", () => {
  let app: Express;
  const marker = `pkcol-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  const createdPatientIds: number[] = [];
  const createdWorklistIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `PK Col ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/radiology"]),
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
  }, 60_000);

  afterAll(async () => {
    for (const id of createdWorklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    await db
      .delete(radiologyWorklistTable)
      .where(like(radiologyWorklistTable.studyInstanceUID, `1.2.840.pkcol.${marker}%`))
      .catch(() => {});
    for (const id of [...new Set(createdPatientIds)]) {
      await db.delete(patientsTable).where(eq(patientsTable.id, id)).catch(() => {});
    }
    await db
      .delete(patientsTable)
      .where(
        or(
          like(patientsTable.patientId, `CD-PKCOL-${marker}%`),
          like(patientsTable.patientId, `UHID-PKCOL-${marker}%`),
          like(patientsTable.patientId, `UNKNOWN-${marker}%`),
        ),
      )
      .catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 60_000);

  function intakeHeaders(): Record<string, string> {
    // Router-level requireStaffOrInternalAuth accepts staff JWT or INTERNAL_API_KEY.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const key = process.env.INTERNAL_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  async function postIntake(body: Record<string, unknown>) {
    return request(app)
      .post("/api/internal/radiology/studies")
      .set(intakeHeaders())
      .send(body);
  }

  test("1) numeric PatientID equal to patients.id does not bind that row", async () => {
    const [victim] = await db
      .insert(patientsTable)
      .values({
        patientId: `CD-PKCOL-${marker}-VICTIM`,
        firstName: "Registered",
        lastName: `Victim ${marker}`,
        dateOfBirth: "1980-01-15",
        gender: "female",
        phone: "9000000001",
      })
      .returning();
    createdPatientIds.push(victim.id);

    const uid = `1.2.840.pkcol.${marker}.1`;
    const res = await postIntake({
      patientName: "MODALITY^STRANGER",
      modality: "MR",
      studyDate: "20260315",
      studyDescription: "MRI Brain",
      studyInstanceUID: uid,
      accessionNumber: `ACC-PKCOL-${marker}-1`,
      // Collision: DICOM PatientID is the internal PK as a string
      patientId: String(victim.id),
    });
    expect([200, 201]).toContain(res.status);

    const worklistId = Number(res.body?.worklistId);
    expect(Number.isInteger(worklistId) && worklistId > 0).toBe(true);
    createdWorklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));

    expect(wl.dicomPatientId).toBe(String(victim.id));
    // Must not silently bind the victim row solely from PK equality
    expect(wl.patientId).not.toBe(victim.id);
    expect(wl.patientMatchStatus).not.toBe("MATCHED");

    if (wl.patientId != null) {
      createdPatientIds.push(wl.patientId);
      const [linked] = await db.select().from(patientsTable).where(eq(patientsTable.id, wl.patientId));
      expect(linked.id).not.toBe(victim.id);
      expect(linked.patientId).toBe(String(victim.id));
    }

    expect(
      matchAllowsFinalize({
        matchScore: wl.matchScore,
        matchDecision: wl.matchDecision,
      }),
    ).toBe(false);
  });

  test("2) exact UHID / patient-facing ID still matches", async () => {
    const uhid = `UHID-PKCOL-${marker}-OK`;
    const [legit] = await db
      .insert(patientsTable)
      .values({
        patientId: uhid,
        firstName: "Legit",
        lastName: `Match ${marker}`,
        dateOfBirth: "1991-05-20",
        gender: "male",
        phone: "9000000002",
      })
      .returning();
    createdPatientIds.push(legit.id);

    const uid = `1.2.840.pkcol.${marker}.2`;
    const res = await postIntake({
      patientName: "MATCH^LEGIT",
      modality: "CT",
      studyDate: "20260316",
      studyDescription: "CT Head",
      studyInstanceUID: uid,
      accessionNumber: `ACC-PKCOL-${marker}-2`,
      patientId: uhid,
    });
    expect([200, 201]).toContain(res.status);
    const worklistId = Number(res.body?.worklistId);
    expect(Number.isInteger(worklistId) && worklistId > 0).toBe(true);
    createdWorklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));

    expect(wl.patientId).toBe(legit.id);
    expect(wl.patientMatchStatus).toBe("MATCHED");
    expect(wl.dicomPatientId).toBe(uhid);
  });

  test("3) leading-zero PatientID is an external string, not patients.id", async () => {
    const [victim] = await db
      .insert(patientsTable)
      .values({
        patientId: `CD-PKCOL-${marker}-PAD`,
        firstName: "Padded",
        lastName: `Victim ${marker}`,
        dateOfBirth: "1975-09-01",
        gender: "male",
        phone: "9000000003",
      })
      .returning();
    createdPatientIds.push(victim.id);

    const padded = `0${victim.id}`;
    const uid = `1.2.840.pkcol.${marker}.3`;
    const res = await postIntake({
      patientName: "PADDED^STRANGER",
      modality: "XR",
      studyDate: "20260317",
      studyDescription: "Chest",
      studyInstanceUID: uid,
      accessionNumber: `ACC-PKCOL-${marker}-3`,
      patientId: padded,
    });
    expect([200, 201]).toContain(res.status);
    const worklistId = Number(res.body?.worklistId);
    expect(Number.isInteger(worklistId) && worklistId > 0).toBe(true);
    createdWorklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));

    expect(wl.patientId).not.toBe(victim.id);
    expect(wl.patientMatchStatus).not.toBe("MATCHED");
    if (wl.patientId != null) createdPatientIds.push(wl.patientId);
  });

  test("4) name-only intake does not MATCHED-bind an existing same-name patient", async () => {
    const [existing] = await db
      .insert(patientsTable)
      .values({
        patientId: `CD-PKCOL-${marker}-NAME`,
        firstName: "Common",
        lastName: `NameOnly ${marker}`,
        dateOfBirth: "1988-03-01",
        gender: "female",
        phone: "9000000004",
      })
      .returning();
    createdPatientIds.push(existing.id);

    const uid = `1.2.840.pkcol.${marker}.4`;
    const res = await postIntake({
      patientName: `NameOnly ${marker}^Common`,
      modality: "MR",
      studyDate: "20260318",
      studyDescription: "MRI Spine",
      studyInstanceUID: uid,
      accessionNumber: `ACC-PKCOL-${marker}-4`,
      patientId: `UNKNOWN-${marker}`,
    });
    expect([200, 201]).toContain(res.status);
    const worklistId = Number(res.body?.worklistId);
    expect(Number.isInteger(worklistId) && worklistId > 0).toBe(true);
    createdWorklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));

    expect(wl.patientId).not.toBe(existing.id);
    expect(wl.patientMatchStatus).not.toBe("MATCHED");
    if (wl.patientId != null) createdPatientIds.push(wl.patientId);
  });
});
