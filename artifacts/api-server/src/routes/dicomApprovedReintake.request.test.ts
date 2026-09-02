/**
 * Once Match Center sets match_decision=APPROVED, DICOM re-intake for the same
 * StudyInstanceUID must not replace the approved patient association.
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
import {
  isApprovedMatchDecision,
  preserveApprovedPatientAssociationOnReintake,
} from "./internal-radiology";

const dbAvailable = hasDatabaseUrl();

describe("preserveApprovedPatientAssociationOnReintake (unit)", () => {
  test("APPROVED keeps patientId / match status / studyId", () => {
    const existing = {
      id: 10,
      patientId: 100,
      patientMatchStatus: "MATCHED",
      matchDecision: "APPROVED",
      studyId: 55,
    };
    const values = {
      studyId: 99,
      patientId: 200,
      dicomPatientId: "UHID-B",
      patientMatchStatus: "MATCHED",
      patientName: "Other",
      age: null,
      sex: null,
      modality: "MR",
      studyDescription: "MRI Brain Revised",
      studyDate: "2026-03-20",
      accessionNumber: "ACC-1",
      studyInstanceUID: "1.2.3",
      aeTitle: null,
      ipAddress: null,
      port: null,
      referringDoctor: null,
      weasisUrl: null,
      sourcePacs: "pacs",
      sourceAeTitle: null,
      dicomMetadata: { refreshed: true },
    };
    const out = preserveApprovedPatientAssociationOnReintake(existing, values);
    expect(out.patientId).toBe(100);
    expect(out.patientMatchStatus).toBe("MATCHED");
    expect(out.studyId).toBe(55);
    // Safe metadata still refreshes
    expect(out.studyDescription).toBe("MRI Brain Revised");
    expect(out.dicomPatientId).toBe("UHID-B");
    expect(out.dicomMetadata).toEqual({ refreshed: true });
  });

  test("PENDING allows incoming patient resolution to apply", () => {
    const existing = {
      id: 11,
      patientId: 100,
      patientMatchStatus: "MATCHED",
      matchDecision: "PENDING",
      studyId: 55,
    };
    const values = {
      studyId: 99,
      patientId: 200,
      dicomPatientId: "UHID-B",
      patientMatchStatus: "MATCHED",
      patientName: "Other",
      age: null,
      sex: null,
      modality: "MR",
      studyDescription: "MRI",
      studyDate: "2026-03-20",
      accessionNumber: "ACC-2",
      studyInstanceUID: "1.2.4",
      aeTitle: null,
      ipAddress: null,
      port: null,
      referringDoctor: null,
      weasisUrl: null,
      sourcePacs: "pacs",
      sourceAeTitle: null,
      dicomMetadata: null,
    };
    const out = preserveApprovedPatientAssociationOnReintake(existing, values);
    expect(out.patientId).toBe(200);
    expect(out.studyId).toBe(99);
  });

  test("isApprovedMatchDecision is case-insensitive", () => {
    expect(isApprovedMatchDecision("APPROVED")).toBe(true);
    expect(isApprovedMatchDecision("approved")).toBe(true);
    expect(isApprovedMatchDecision("PENDING")).toBe(false);
    expect(isApprovedMatchDecision(null)).toBe(false);
  });
});

describe.skipIf(!dbAvailable)("APPROVED patient association survives DICOM re-intake", () => {
  let app: Express;
  const marker = `apprv-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  let patientA = 0;
  let patientB = 0;
  const uhidA = `UHID-APPRV-${marker}-A`;
  const uhidB = `UHID-APPRV-${marker}-B`;
  const worklistIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Apprv ${marker}`,
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

    const [pa] = await db
      .insert(patientsTable)
      .values({
        patientId: uhidA,
        firstName: "Approved",
        lastName: `Alpha ${marker}`,
        dateOfBirth: "1985-01-01",
        gender: "female",
        phone: "9111000001",
      })
      .returning();
    const [pb] = await db
      .insert(patientsTable)
      .values({
        patientId: uhidB,
        firstName: "Other",
        lastName: `Bravo ${marker}`,
        dateOfBirth: "1990-02-02",
        gender: "male",
        phone: "9111000002",
      })
      .returning();
    patientA = pa.id;
    patientB = pb.id;
  }, 60_000);

  afterAll(async () => {
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    await db
      .delete(radiologyWorklistTable)
      .where(like(radiologyWorklistTable.studyInstanceUID, `1.2.840.apprv.${marker}%`))
      .catch(() => {});
    await db.delete(patientsTable).where(or(eq(patientsTable.id, patientA), eq(patientsTable.id, patientB))).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 60_000);

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const key = process.env.INTERNAL_API_KEY;
    if (key) h.Authorization = `Bearer ${key}`;
    return h;
  }

  async function intake(body: Record<string, unknown>) {
    return request(app).post("/api/internal/radiology/studies").set(headers()).send(body);
  }

  test("A) APPROVED patient A survives re-intake resolving to patient B", async () => {
    const uid = `1.2.840.apprv.${marker}.A`;
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Approved Alpha",
        patientId: patientA,
        dicomPatientId: uhidA,
        patientMatchStatus: "MATCHED",
        modality: "MR",
        studyDescription: "MRI Brain Original",
        studyDate: "2026-03-01",
        accessionNumber: `ACC-APPRV-${marker}-A`,
        studyInstanceUID: uid,
        matchScore: "YELLOW",
        matchDecision: "APPROVED",
        matchApprovedBy: "Match Center",
        matchApprovedAt: new Date(),
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);

    const res = await intake({
      patientName: "Other Bravo",
      modality: "MR",
      studyDate: "20260320",
      studyDescription: "MRI Brain Revised Series",
      studyInstanceUID: uid,
      accessionNumber: `ACC-APPRV-${marker}-A`,
      patientId: uhidB,
    });
    expect([200, 201]).toContain(res.status);
    expect(Number(res.body.worklistId)).toBe(wl.id);

    const [after] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wl.id));
    expect(after.patientId).toBe(patientA);
    expect(after.matchDecision).toBe("APPROVED");
    expect(after.patientMatchStatus).toBe("MATCHED");
    expect(after.matchApprovedBy).toBe("Match Center");
    // Metadata refresh still allowed
    expect(after.studyDescription).toBe("MRI Brain Revised Series");
    expect(after.dicomPatientId).toBe(uhidB);
  });

  test("B) unapproved study may update patient on re-intake", async () => {
    const uid = `1.2.840.apprv.${marker}.B`;
    const create = await intake({
      patientName: "Approved Alpha",
      modality: "CT",
      studyDate: "20260302",
      studyDescription: "CT Head v1",
      studyInstanceUID: uid,
      accessionNumber: `ACC-APPRV-${marker}-B`,
      patientId: uhidA,
    });
    expect([200, 201]).toContain(create.status);
    const wlId = Number(create.body.worklistId);
    worklistIds.push(wlId);

    const [before] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wlId));
    expect(before.patientId).toBe(patientA);
    expect(before.matchDecision).not.toBe("APPROVED");

    const res = await intake({
      patientName: "Other Bravo",
      modality: "CT",
      studyDate: "20260321",
      studyDescription: "CT Head v2",
      studyInstanceUID: uid,
      accessionNumber: `ACC-APPRV-${marker}-B`,
      patientId: uhidB,
    });
    expect([200, 201]).toContain(res.status);

    const [after] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wlId));
    expect(after.patientId).toBe(patientB);
    expect(after.studyDescription).toBe("CT Head v2");
  });

  test("C) APPROVED + same patient re-intake is idempotent", async () => {
    const uid = `1.2.840.apprv.${marker}.C`;
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Approved Alpha",
        patientId: patientA,
        dicomPatientId: uhidA,
        patientMatchStatus: "MATCHED",
        modality: "MR",
        studyDescription: "MRI Spine",
        studyDate: "2026-03-03",
        accessionNumber: `ACC-APPRV-${marker}-C`,
        studyInstanceUID: uid,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        matchApprovedBy: "Dr Test",
        matchApprovedAt: new Date("2026-03-03T10:00:00Z"),
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);

    const res = await intake({
      patientName: "Approved Alpha",
      modality: "MR",
      studyDate: "20260303",
      studyDescription: "MRI Spine",
      studyInstanceUID: uid,
      accessionNumber: `ACC-APPRV-${marker}-C`,
      patientId: uhidA,
    });
    expect([200, 201]).toContain(res.status);

    const [after] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wl.id));
    expect(after.patientId).toBe(patientA);
    expect(after.matchDecision).toBe("APPROVED");
    expect(after.matchApprovedBy).toBe("Dr Test");
    expect(after.matchScore).toBe("GREEN");
  });

  test("D) APPROVED survives repeated Orthanc-style re-ingestions", async () => {
    const uid = `1.2.840.apprv.${marker}.D`;
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Approved Alpha",
        patientId: patientA,
        dicomPatientId: uhidA,
        patientMatchStatus: "MATCHED",
        modality: "XR",
        studyDescription: "Chest",
        studyDate: "2026-03-04",
        accessionNumber: `ACC-APPRV-${marker}-D`,
        studyInstanceUID: uid,
        matchScore: "YELLOW",
        matchDecision: "APPROVED",
        matchApprovedBy: "poller",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);

    for (let i = 0; i < 3; i++) {
      const res = await intake({
        patientName: "Other Bravo",
        modality: "XR",
        studyDate: "20260304",
        studyDescription: `Chest poll ${i}`,
        studyInstanceUID: uid,
        accessionNumber: `ACC-APPRV-${marker}-D`,
        patientId: uhidB,
      });
      expect([200, 201]).toContain(res.status);
    }

    const [after] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wl.id));
    expect(after.patientId).toBe(patientA);
    expect(after.matchDecision).toBe("APPROVED");
    expect(after.studyDescription).toBe("Chest poll 2");
  });

  test("E) safe metadata still refreshes under APPROVED", async () => {
    const uid = `1.2.840.apprv.${marker}.E`;
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Old Name",
        patientId: patientA,
        dicomPatientId: uhidA,
        patientMatchStatus: "MATCHED",
        modality: "US",
        studyDescription: "Old Desc",
        studyDate: "2026-03-05",
        accessionNumber: `ACC-APPRV-${marker}-E`,
        studyInstanceUID: uid,
        referringDoctor: "Old Ref",
        matchScore: "YELLOW",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);

    const res = await intake({
      patientName: "New Display Name",
      modality: "US",
      studyDate: "20260306",
      studyDescription: "New Desc",
      studyInstanceUID: uid,
      accessionNumber: `ACC-APPRV-${marker}-E2`,
      referringDoctor: "New Ref",
      patientId: uhidA,
    });
    expect([200, 201]).toContain(res.status);

    const [after] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wl.id));
    expect(after.patientId).toBe(patientA);
    expect(after.matchDecision).toBe("APPROVED");
    expect(after.patientName).toMatch(/New Display Name/i);
    expect(after.studyDescription).toBe("New Desc");
    expect(after.accessionNumber).toBe(`ACC-APPRV-${marker}-E2`);
    expect(after.referringDoctor).toMatch(/New Ref/i);
  });
});
