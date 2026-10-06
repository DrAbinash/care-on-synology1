/**
 * The /api/radiology namespace is not admin-only — and the Orthanc purge still is.
 *
 * The gap this file exists for: routes/index.ts mounted orthancPurgeRouter on
 * the BARE "/radiology" prefix with requireAdminRole in the mount chain. Express
 * runs a mount's middleware for every request matching the prefix, before the
 * sub-router gets to decline it — so the admin gate answered 403 "Admin access
 * required" to every non-admin request for /api/radiology/*, not just the two
 * destructive purge endpoints. radiologyRouter and the Reporting Workspace's
 * report-generator are both mounted below that line, which made the whole
 * radiology module (worklist, study locks, draft save, knowledge packs,
 * presentation templates) unreachable by any role other than admin/super_admin —
 * and silently defeated the /radiology toggle in Settings → Users.
 *
 * It went unnoticed because every existing request-level test that touches
 * /api/radiology/* signs its fixture user in as `role: "admin"`, which
 * requireStaffPermission and requireAdminRole both short-circuit on.
 *
 * The fix moves requireAdminRole onto the two purge routes themselves, matching
 * featureFlagsRouter — the same shared-prefix situation, already solved that way
 * in this file. Test 1 is the regression; tests 2-4 are the reason the fix is
 * not simply "delete the guard": the purge must stay admin-only.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts); in CI it runs
 * against the postgres:16 service.
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
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

const PURGE_URL = "/api/radiology/orthanc/purge";
const SAVE_DRAFT_URL = "/api/radiology/report-generator/save-draft";
const ADMIN_GATE_BODY = "Admin access required";

describe.skipIf(!dbReady)("radiology namespace authorization — request level", () => {
  let app: Express;
  const marker = `nsauth-${randomUUID().slice(0, 8)}`;

  // A realistic Reporting Workspace user: NOT admin, holds the /radiology
  // permission an administrator granted in Settings → Users.
  const RADIOLOGIST = `Dr. Namespace ${marker}`;
  const radiologistToken = `vitest-rad-${randomUUID()}`;
  // The admin, used only for the differential in test 1 and the
  // still-reaches-the-handler proof in test 3.
  const ADMIN = `Admin Namespace ${marker}`;
  const adminToken = `vitest-adm-${randomUUID()}`;

  let radiologistId = 0;
  let adminId = 0;
  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  let worklistId = 0;
  let studyId = 0;
  let orderTestId = 0;

  const asRadiologist = { Authorization: `Bearer ${radiologistToken}` };
  const asAdmin = { Authorization: `Bearer ${adminToken}` };

  function saveDraft(auth: Record<string, string>, text: string) {
    return request(app)
      .post(SAVE_DRAFT_URL)
      .set(auth)
      .send({ studyId: worklistId, worklistId, patientId, rawFindings: text });
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [rad] = await db
      .insert(usersTable)
      .values({
        name: RADIOLOGIST,
        email: `ns-rad-${marker}@vitest.invalid`,
        username: `ns-rad-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "/reports", "/reports:sign", "/patients"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    radiologistId = rad.id;

    const [adm] = await db
      .insert(usersTable)
      .values({
        name: ADMIN,
        email: `ns-adm-${marker}@vitest.invalid`,
        username: `ns-adm-${marker}`,
        role: "admin",
        permissions: JSON.stringify([]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    adminId = adm.id;

    await db.insert(portalSessionsTable).values([
      {
        token: radiologistToken,
        scope: "staff",
        subjectId: radiologistId,
        subjectName: RADIOLOGIST,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
      {
        token: adminToken,
        scope: "staff",
        subjectId: adminId,
        subjectName: ADMIN,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    ]);

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `NSAUTH-${marker}`,
        firstName: "Probe",
        lastName: `Namespace ${marker}`,
        dateOfBirth: "1980-01-01",
        gender: "female",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `NS${marker.slice(-4).toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${marker}`, patientId, status: "pending" })
      .returning();
    orderId = order.id;

    const [ot] = await db
      .insert(orderTestsTable)
      .values({ orderId, testId, price: "5000" })
      .returning();
    orderTestId = ot.id;

    const today = new Date().toISOString().slice(0, 10);
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${marker}`,
        orderId,
        orderTestId,
        patientId,
        testId,
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "scheduled",
      })
      .returning();
    studyId = study.id;

    // STUDY_RECEIVED and unclaimed: an open study a radiologist may write on,
    // with no lock and no REPORT_FINAL for assertDraftWritable to refuse on.
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: RADIOLOGIST,
        patientId,
        studyId,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        accessionNumber: `ACC-${marker}`,
        studyInstanceUID: `1.2.840.nsauth.1.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;
  }, 60_000);

  afterAll(async () => {
    // Marker-scoped: every row this file created carries the marker in an
    // accession number, a username or an id, so cleanup cannot touch unrelated
    // clinical data.
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.id, orderTestId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, radiologistToken)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, adminToken)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, radiologistId)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, adminId)).catch(() => {});
  }, 60_000);

  it("a non-admin radiologist reaches the workspace draft save, exactly as an admin does", async () => {
    const rad = await saveDraft(asRadiologist, `Findings by a non-admin ${marker}`);
    const adm = await saveDraft(asAdmin, `Findings by an admin ${marker}`);

    // The defect was an authorization refusal, so name it explicitly rather
    // than only comparing statuses: a 403 from anywhere else in the chain must
    // not be able to masquerade as the fixed behaviour.
    expect(rad.status, `radiologist: ${rad.text}`).not.toBe(403);
    expect(rad.body?.error, `radiologist: ${rad.status} ${rad.text}`).not.toBe(ADMIN_GATE_BODY);
    expect(adm.body?.error, `admin: ${adm.status} ${adm.text}`).not.toBe(ADMIN_GATE_BODY);

    // Differential, not a hard-coded success code: save-draft's own validation
    // is not what this file is about, and no real-DB test in the repo pins a
    // minimal save-draft body to a specific status. What must hold is that
    // holding the /radiology permission rather than the admin role makes no
    // difference to how far the request gets. Before the fix this failed
    // 403-vs-not; it cannot pass vacuously, because the two callers take
    // different branches of requireStaffPermission.
    expect(rad.status, `radiologist ${rad.text} vs admin ${adm.text}`).toBe(adm.status);
  });

  it("a non-admin radiologist is still refused the Orthanc purge", async () => {
    const res = await request(app).post(PURGE_URL).set(asRadiologist).send({});
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe(ADMIN_GATE_BODY);
  });

  it("an admin still reaches the purge handler — the guard moved, it was not deleted", async () => {
    // An empty body fails the handler's own confirm-phrase check, which runs
    // before any Orthanc call, so this proves the admin got past
    // requireAdminRole without depending on a PACS server being configured.
    const res = await request(app).post(PURGE_URL).set(asAdmin).send({});
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? "")).toContain("Confirmation required");
  });

  it("an unauthenticated caller is still refused the Orthanc purge", async () => {
    const res = await request(app).post(PURGE_URL).send({});
    expect(res.status).toBe(401);
  });
});
