/**
 * Radiology master-hardening request tests.
 * Skip automatically when DATABASE_URL is not exported.
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
  testsTable,
  ordersTable,
  orderTestsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientReportsTable,
  radiologyReportDraftsTable,
  diagnosticReferralsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("radiology identity hardening — request level", () => {
  let app: Express;
  const marker = `radhard-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  let patientA = 0;
  let patientB = 0;
  let testMri = 0;
  let testCt = 0;
  let orderA = 0;
  let studyA1 = 0;
  let studyA2 = 0;
  let wlRed = 0;
  let wlGreen = 0;
  let wlApproved = 0;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Rad Hard ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/reports", "/radiology", "/report-generator"]),
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

    const [pa] = await db.insert(patientsTable).values({
      patientId: `RHA-${marker}`,
      firstName: "Asha",
      lastName: `SameName ${marker}`,
      dateOfBirth: "1988-03-01",
      gender: "female",
      phone: "9111111111",
    }).returning();
    const [pb] = await db.insert(patientsTable).values({
      patientId: `RHB-${marker}`,
      firstName: "Asha",
      lastName: `SameName ${marker}`,
      dateOfBirth: "1992-07-15",
      gender: "female",
      phone: "9222222222",
    }).returning();
    patientA = pa.id;
    patientB = pb.id;

    const [mri] = await db.insert(testsTable).values({
      name: `MRI Brain ${marker}`,
      code: `MRI${marker.slice(-4).toUpperCase()}`,
      price: "5000",
      category: "Radiology",
      department: "MRI",
      duration: "1 day",
      isActive: true,
    }).returning();
    const [ct] = await db.insert(testsTable).values({
      name: `CT Head ${marker}`,
      code: `CT${marker.slice(-4).toUpperCase()}`,
      price: "3000",
      category: "Radiology",
      department: "CT",
      duration: "1 day",
      isActive: true,
    }).returning();
    testMri = mri.id;
    testCt = ct.id;

    const today = new Date().toISOString().slice(0, 10);
    const [ord] = await db.insert(ordersTable).values({
      orderNumber: `ORD-${marker}`,
      patientId: patientA,
      status: "pending",
    }).returning();
    orderA = ord.id;
    const [ot] = await db.insert(orderTestsTable).values({
      orderId: orderA,
      testId: testMri,
      price: "5000",
    }).returning();

    const [s1] = await db.insert(radiologyStudiesTable).values({
      accessionNumber: `ACC-${marker}-1`,
      orderId: orderA,
      orderTestId: ot.id,
      patientId: patientA,
      testId: testMri,
      modality: "MR",
      department: "MRI",
      studyDescription: "MRI Brain",
      studyDate: today,
      status: "scheduled",
    }).returning();
    const [s2] = await db.insert(radiologyStudiesTable).values({
      accessionNumber: `ACC-${marker}-2`,
      patientId: patientA,
      testId: testMri,
      modality: "MR",
      department: "MRI",
      studyDescription: "MRI Brain",
      studyDate: today,
      status: "scheduled",
    }).returning();
    studyA1 = s1.id;
    studyA2 = s2.id;

    const [red] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: today,
      studyInstanceUID: `1.2.840.hard.red.${marker}`,
      matchScore: "RED",
      matchDecision: "PENDING",
      status: "STUDY_RECEIVED",
    }).returning();
    const [green] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: today,
      studyInstanceUID: `1.2.840.hard.green.${marker}`,
      matchScore: "GREEN",
      matchDecision: "PENDING",
      status: "STUDY_RECEIVED",
    }).returning();
    const [approved] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "CT",
      studyDescription: "CT Head",
      studyDate: today,
      studyInstanceUID: `1.2.840.hard.appr.${marker}`,
      matchScore: "YELLOW",
      matchDecision: "APPROVED",
      status: "STUDY_RECEIVED",
    }).returning();
    wlRed = red.id;
    wlGreen = green.id;
    wlApproved = approved.id;
  }, 60_000);

  afterAll(async () => {
    await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.patientId, patientA)).catch(() => {});
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientA)).catch(() => {});
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.patientId, patientA)).catch(() => {});
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.patientId, patientA)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderA)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderA)).catch(() => {});
    await db.delete(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.carePatientId, patientA)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientA)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientB)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testMri)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testCt)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 60_000);

  const auth = { Authorization: `Bearer ${token}` };

  it("1. RED Match Center rejects canonical finalize", async () => {
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMri,
        studyId: wlRed,
        worklistId: wlRed,
        title: "MRI Brain",
        body: "findings",
        impression: "normal",
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MATCH_GATE_BLOCKED");
  });

  it("2. APPROVED match allows finalize", async () => {
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMri,
        studyId: wlApproved,
        worklistId: wlApproved,
        title: "CT Head",
        body: "ct findings",
        impression: "normal",
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.patientId).toBe(patientA);
    expect(res.body.studyId).toBe(wlApproved);
  });

  it("3. mismatched patientId/testId is rejected", async () => {
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientB,
        testId: testCt,
        studyId: wlGreen,
        worklistId: wlGreen,
        title: "MRI Brain",
        body: "x",
        impression: "x",
      });
    expect(res.status).toBe(409);
    expect(["PATIENT_MISMATCH", "TEST_MISMATCH"]).toContain(res.body.code);
  });

  it("4. mismatched reportId/worklist is rejected on report-status", async () => {
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMri,
        studyId: wlGreen,
        worklistId: wlGreen,
        title: "MRI Brain",
        body: "ok",
        impression: "ok",
      });
    expect([200, 201]).toContain(created.status);
    const res = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: wlRed,
        status: "REPORT_FINAL",
        reportId: created.body.id,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("5. two same-day same-modality studies do not arbitrary auto-link", async () => {
    // Router-level auth accepts staff JWT or INTERNAL_API_KEY; the intake
    // handler itself is requireInternalApiKey (open in non-production when unset).
    const headers: Record<string, string> = { ...auth };
    const internalKey = process.env.INTERNAL_API_KEY;
    if (internalKey) headers.Authorization = `Bearer ${internalKey}`;
    const res = await request(app)
      .post("/api/internal/radiology/studies")
      .set(headers)
      .send({
        patientName: "ASHA SAME",
        modality: "MR",
        studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        studyDescription: "MRI Brain",
        studyInstanceUID: `1.2.840.hard.intake.${marker.replace(/[^0-9]/g, "") || "99"}`,
        accessionNumber: `ACC-INTAKE-${marker}`,
        patientId: String(patientA),
      });
    expect([200, 201]).toContain(res.status);
    const linkedStudyId = res.body?.worklist?.studyId ?? res.body?.studyId ?? null;
    // Ambiguous same-day MR pair → must not silently pick studyA1 or studyA2.
    if (linkedStudyId != null) {
      expect([studyA1, studyA2]).not.toContain(linkedStudyId);
    }
  });

  it("13. concurrent finalize produces one final clinical result", async () => {
    const [wl] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: new Date().toISOString().slice(0, 10),
      studyInstanceUID: `1.2.840.hard.cas.${marker}`,
      matchScore: "GREEN",
      matchDecision: "PENDING",
      status: "STUDY_RECEIVED",
    }).returning();
    const payload = {
      type: "radiology",
      patientId: patientA,
      testId: testMri,
      studyId: wl.id,
      worklistId: wl.id,
      title: "MRI Brain CAS",
      body: "cas",
      impression: "cas",
    };
    const [a, b] = await Promise.all([
      request(app).post("/api/patient-reports").set(auth).send(payload),
      request(app).post("/api/patient-reports").set(auth).send(payload),
    ]);
    const ok = [a, b].filter((r) => r.status === 201 || r.body?.idempotent);
    const conflict = [a, b].filter((r) => r.status === 409 && r.body?.code === "ALREADY_FINALIZED");
    expect(ok.length + conflict.length).toBe(2);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const reports = await db.select().from(patientReportsTable).where(eq(patientReportsTable.studyId, wl.id));
    expect(reports.length).toBe(1);
  });

  it("14. save-draft after FINAL is rejected", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set(auth)
      .send({
        studyId: wlApproved,
        worklistId: wlApproved,
        patientId: patientA,
        rawFindings: "should not save",
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPORT_LOCKED");
  });

  it("21. ordinary MRI GREEN workflow still finalizes", async () => {
    const [wl] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: new Date().toISOString().slice(0, 10),
      studyInstanceUID: `1.2.840.hard.mriok.${marker}`,
      matchScore: "GREEN",
      matchDecision: "PENDING",
      status: "STUDY_RECEIVED",
    }).returning();
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMri,
        studyId: wl.id,
        worklistId: wl.id,
        title: "MRI Brain OK",
        body: "mri ok",
        impression: "normal",
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.patientId).toBe(patientA);
  });

  it("12. AI image-review rejects a foreign StudyInstanceUID", async () => {
    const res = await request(app)
      .post("/api/ai-reporting/image-review")
      .set(auth)
      .send({
        worklistId: wlGreen,
        studyInstanceUID: "1.2.840.foreign.uid",
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    if (res.body?.code) {
      expect(["STUDY_UID_MISMATCH", "WORKLIST_REQUIRED"]).toContain(res.body.code);
    }
  });

  it("6. same-name patients do not name-only merge", async () => {
    const { findExistingPatient } = await import("../lib/dicomPatientCreator");
    const hit = await findExistingPatient({
      patientName: `SameName ${marker}^Asha`,
      // no DOB, no DICOM PatientID — must not merge onto patientA or patientB
    });
    expect(hit).toBeNull();
  });

  it("10. wrong draft patient hydration is filtered server-side", async () => {
    const [draft] = await db.insert(radiologyReportDraftsTable).values({
      studyId: wlGreen,
      worklistId: wlGreen,
      patientId: patientB,
      rawFindings: "belongs to B",
      status: "DRAFT",
    }).returning();
    const res = await request(app)
      .get(`/api/radiology/report-generator/drafts?studyId=${wlGreen}`)
      .set(auth);
    expect(res.status).toBe(200);
    const ids = (res.body.drafts ?? []).map((d: { id: number }) => d.id);
    expect(ids).not.toContain(draft.id);
  });

  it("15. selected image from another study is rejected", async () => {
    const [wl] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: new Date().toISOString().slice(0, 10),
      studyInstanceUID: `1.2.840.100.${marker.replace(/[^0-9]/g, "") || "1"}`,
      matchScore: "GREEN",
      matchDecision: "PENDING",
      status: "STUDY_RECEIVED",
    }).returning();
    const [draft] = await db.insert(radiologyReportDraftsTable).values({
      studyId: wl.id,
      worklistId: wl.id,
      patientId: patientA,
      rawFindings: "img ownership",
      status: "DRAFT",
    }).returning();
    const res = await request(app)
      .post("/api/radiology/report-generator/image-references")
      .set(auth)
      .send({
        draftId: draft.id,
        description: "foreign key image",
        studyInstanceUid: "1.2.840.999.888.777",
        seriesInstanceUid: "1.2.840.999.888.1",
        sopInstanceUid: "1.2.840.999.888.2",
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IMAGE_STUDY_MISMATCH");
  });

  it("17/18. HOPE emit fails closed without exact order referral", async () => {
    const { emitReportToHope } = await import("../services/integration/emitReportToHope");
    const [wl] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "MR",
      studyDescription: "MRI Brain",
      studyDate: new Date().toISOString().slice(0, 10),
      studyInstanceUID: `1.2.840.hard.hope.${marker}`,
      matchScore: "GREEN",
      matchDecision: "PENDING",
      status: "STUDY_RECEIVED",
    }).returning();
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMri,
        studyId: wl.id,
        worklistId: wl.id,
        title: "MRI Hope gate",
        body: "hope",
        impression: "hope",
      });
    expect([200, 201]).toContain(created.status);
    await db
      .update(patientReportsTable)
      .set({ status: "verified", signedAt: new Date(), signedByName: "Vitest" })
      .where(eq(patientReportsTable.id, created.body.id));
    // Patient-level referrals exist but are NOT linked to this CARE order —
    // emit must fail closed (no latest-referral guessing).
    await db.insert(diagnosticReferralsTable).values({
      referralUuid: `ref-other-${marker}`,
      sourceOrg: "HOPE",
      sourcePatientId: `hope-uhid-${marker}`,
      carePatientId: patientA,
      careOrderId: null,
      status: "ACCEPTED",
      patientName: "ASHA SAME",
    });
    const result = await emitReportToHope({ reportId: created.body.id, worklistId: wl.id, dispatchNow: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_REFERRAL");
  });

  it("22. ordinary CT APPROVED workflow still finalizes", async () => {
    const [wl] = await db.insert(radiologyWorklistTable).values({
      patientName: "ASHA SAME",
      patientId: patientA,
      studyId: studyA1,
      modality: "CT",
      studyDescription: "CT Head",
      studyDate: new Date().toISOString().slice(0, 10),
      studyInstanceUID: `1.2.840.hard.ctok.${marker}`,
      matchScore: "YELLOW",
      matchDecision: "APPROVED",
      status: "STUDY_RECEIVED",
    }).returning();
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testMri,
        studyId: wl.id,
        worklistId: wl.id,
        title: "CT Head OK",
        body: "ct ok",
        impression: "normal",
      });
    expect([200, 201]).toContain(res.status);
  });
});
