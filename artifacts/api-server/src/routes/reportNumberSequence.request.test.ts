/**
 * A report number must never be reissued.
 *
 * `nextReportNumber()` derived the next `RPT-YYYYMMDD-NNN` from COUNT(*) of
 * today's rows, so deleting any report for the day opened a hole and the hole
 * was refilled: the next finalize computed a number that already existed, the
 * UNIQUE index rejected it, the three-attempt retry recomputed the SAME number
 * each time, and finalize answered a bare `500 {"error":"Failed to create
 * report"}`. Measured on the acceptance rig on 2026-10-29, where the harness
 * deletes the report row to re-arm a study for another signing journey — the
 * next journey failed `sign-succeeded` while all 34 clinical gates passed,
 * which reads exactly like a signing regression.
 *
 * This file pins the replacement: per-day sequence allocation from
 * `documentNumberCounters`, the mechanism the clinic's bill and order numbers
 * already use. A nextval cannot repeat, so a deleted row leaves a gap instead of
 * a wedge, and two concurrent finalizes get two numbers instead of racing on a
 * count.
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
  patientReportsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("report numbers are never reissued — request level", () => {
  let app: Express;
  const marker = `rptseq-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const SIGNER = `Dr. Numbering ${marker}`;
  const auth = { Authorization: `Bearer ${token}` };

  let userId = 0;
  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  const reportIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const orderTestIds: number[] = [];
  let seq = 0;

  /** A worklist study ready to be finalized — GREEN/APPROVED so the match gate
   *  lets POST /api/patient-reports through, exactly as the signing tests do. */
  async function finalizableStudy() {
    seq += 1;
    const tag = `${marker}-${seq}`;
    const today = new Date().toISOString().slice(0, 10);

    const [ot] = await db
      .insert(orderTestsTable)
      .values({ orderId, testId, price: "5000" })
      .returning();
    orderTestIds.push(ot.id);

    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${tag}`,
        orderId,
        orderTestId: ot.id,
        patientId,
        testId,
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "scheduled",
      })
      .returning();
    studyIds.push(study.id);

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: SIGNER,
        patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.rptseq.${seq}.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);
    return { worklistId: wl.id, tag };
  }

  async function createReport(worklistId: number, tag: string) {
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: worklistId,
        worklistId,
        title: `MRI Brain ${tag}`,
        body: `<p>BODY ${tag}</p>`,
        impression: "No acute intracranial abnormality.",
      });
    return res;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
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

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `RPTSEQ-${marker}`,
        firstName: "Numbering",
        lastName: `Probe ${marker}`,
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
        code: `RQ${marker.slice(-4).toUpperCase()}`,
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
  }, 60_000);

  afterAll(async () => {
    for (const id of reportIds) {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, String(id))).catch(() => {});
    }
    for (const id of reportIds) {
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of studyIds) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    for (const id of orderTestIds) {
      await db.delete(orderTestsTable).where(eq(orderTestsTable.id, id)).catch(() => {});
    }
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 60_000);

  it("numbers issued today are distinct and strictly new", async () => {
    const a = await finalizableStudy();
    const b = await finalizableStudy();
    const first = await createReport(a.worklistId, a.tag);
    expect([200, 201], first.text).toContain(first.status);
    const second = await createReport(b.worklistId, b.tag);
    expect([200, 201], second.text).toContain(second.status);
    reportIds.push(first.body.id, second.body.id);

    const n1 = first.body.reportNumber as string;
    const n2 = second.body.reportNumber as string;
    expect(n1).toMatch(/^RPT-\d{8}-\d{3,}$/);
    expect(n2).toMatch(/^RPT-\d{8}-\d{3,}$/);
    expect(n2).not.toBe(n1);
  });

  it("deleting one of today's reports does not wedge every later finalize", async () => {
    const three = await finalizableStudy();
    const four = await finalizableStudy();

    const created = await createReport(three.worklistId, three.tag);
    expect([200, 201], created.text).toContain(created.status);
    reportIds.push(created.body.id);
    const taken = created.body.reportNumber as string;

    // The rig's re-arm step, and the clinic's purge, both delete a report row.
    // Under COUNT(*)+1 the number it held became available again.
    const [victim] = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, created.body.id as number));
    expect(victim).toBeTruthy();
    await db.delete(patientReportsTable).where(eq(patientReportsTable.id, created.body.id as number));
    reportIds.shift();

    const after = await createReport(four.worklistId, four.tag);
    expect([200, 201], `finalize after a delete: ${after.text}`).toContain(after.status);
    reportIds.push(after.body.id);
    expect(after.body.reportNumber, "a reissued report number is a new document with an old identity").not.toBe(taken);
  });
});
