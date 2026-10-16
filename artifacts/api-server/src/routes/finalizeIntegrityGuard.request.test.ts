/**
 * A study must not reach REPORT_FINAL unless a report that belongs to it exists.
 *
 * Measured before this file existed (2026-10-16, isolated scratch Postgres,
 * synthetic patients, no browser, no fixture ambiguity):
 *
 *   POST /api/internal/radiology/report-status
 *     { worklistId: 110, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND" }
 *   -> 200, and radiology_worklist row 110 became status=REPORT_FINAL,
 *      report_id=NULL, while patient_reports held ZERO rows for that study.
 *
 * The route already has the intended guard, but it is conditioned on
 * `!isCanonicalFinalize`, where `isCanonicalFinalize` is the CALLER-SUPPLIED
 * `deliveryStatus === "READY_TO_SEND"` (internal-radiology.ts:1131). So naming a
 * delivery status is treated as proof that a report exists. The Reporting
 * Workspace always names it — including when its own create leg was skipped
 * (`radiologyReportLifecycle.ts:474`, which posts the flip with
 * `reportId: reportId ?? undefined`), which is how a study ends up final with
 * nothing to show the patient and, because the signing gate reads that same
 * status (ReportCanvas.tsx:2119 `workflow.currentRow?.status === "REPORT_FINAL"`),
 * permanently unable to be signed.
 *
 * What must keep working, and is asserted here: a normal signed finalize, a
 * finalize whose row is bound but whose caller omits reportId, the documented
 * unbilled soft-final, and (see signatureWithdrawalReopensStudy.request.test.ts)
 * withdrawal → correction → re-signing, which passes an explicit reportId.
 *
 * Every assertion is an HTTP status plus a re-read of the stored rows.
 * Skipped without DATABASE_URL; in CI it runs against the postgres:16 service.
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
  signaturesTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("finalization integrity — request level", () => {
  let app: Express;
  const marker = `fin-ig-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const SIGNER = `Dr. Finalizer ${marker}`;

  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  let signatureId = 0;
  let seq = 0;
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const reportIds: number[] = [];

  const auth = { Authorization: `Bearer ${token}` };
  const flip = (body: Record<string, unknown>) =>
    request(app).post("/api/internal/radiology/report-status").set(auth).send(body);
  const wl = async (id: number) =>
    (await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)))[0];

  /** A study with a billed order-test behind it and a matched worklist row. */
  async function billedStudy({ billed = true } = {}) {
    seq += 1;
    const tag = `${marker}-${seq}`;
    const today = new Date().toISOString().slice(0, 10);
    let orderTestId: number | null = null;
    if (billed) {
      const [ot] = await db
        .insert(orderTestsTable)
        .values({ orderId, testId, price: "5000" })
        .returning();
      orderTestId = ot.id;
    }
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${tag}`,
        orderId,
        orderTestId,
        patientId,
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "scheduled",
      })
      .returning();
    studyIds.push(study.id);
    const [worklist] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Patient ${tag}`,
        patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.finig.${seq}.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(worklist.id);
    return { study, worklist, tag };
  }

  /** Report created and signed the way the workspace does it, bound to the worklist row. */
  async function signedReportFor(worklistId: number, studyId: number, tag: string) {
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: worklistId,
        worklistId,
        title: `MRI Brain ${tag}`,
        body: `<p>FINDINGS ${tag}</p>`,
        impression: `IMPRESSION ${tag}`,
      });
    expect([200, 201], `create report: ${created.status} ${created.text}`).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    const signed = await request(app)
      .post(`/api/patient-reports/${reportId}/sign`)
      .set(auth)
      .send({ signatureId });
    expect(signed.status, `sign: ${signed.text}`).toBe(200);
    return { reportId, studyId };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER,
        email: `fin-ig-${marker}@vitest.invalid`,
        username: `fin-ig-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
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
        patientId: `FINIG-${marker}`,
        firstName: "Integrity",
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
        code: `MB${marker.slice(-4).toUpperCase()}`,
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

    const [sig] = await db
      .insert(signaturesTable)
      .values({
        name: SIGNER,
        role: "Radiologist",
        qualification: "MD (Radio-diagnosis)",
        registrationNo: `REG-${marker}`,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    signatureId = sig.id;
  }, 60_000);

  afterAll(async () => {
    for (const id of reportIds)
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    for (const id of worklistIds)
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    for (const id of studyIds)
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
  });

  it("rejects REPORT_FINAL for a billed study that has no report at all, even when the caller names READY_TO_SEND", async () => {
    const { study, worklist, tag } = await billedStudy();
    const res = await flip({
      worklistId: worklist.id,
      accessionNumber: `ACC-${tag}`,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      actor: SIGNER,
    });
    expect(res.status, `flip: ${res.status} ${res.text}`).toBe(409);
    const after = await wl(worklist.id);
    expect(after.status, "a refused flip must not close the study").not.toBe("REPORT_FINAL");
    expect(after.reportId, "a refused flip must not invent a report binding").toBeNull();
    expect(
      (await db.select().from(patientReportsTable).where(eq(patientReportsTable.studyId, study.id))).length,
      "the refusal must not create a report row either"
    ).toBe(0);
  });

  it("rejects a reportId that belongs to a different study than the worklist being finalized", async () => {
    const a = await billedStudy();
    const b = await billedStudy();
    const { reportId } = await signedReportFor(a.worklist.id, a.study.id, a.tag);
    const res = await flip({
      worklistId: b.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `cross-study flip: ${res.status} ${res.text}`).toBe(409);
    const afterB = await wl(b.worklist.id);
    expect(afterB.status).not.toBe("REPORT_FINAL");
    expect(afterB.reportId).toBeNull();
    // the legitimate study is untouched
    expect((await wl(a.worklist.id)).reportId).toBe(reportId);
  });

  it("allows the normal signed finalize, with and without an explicit reportId", async () => {
    const x = await billedStudy();
    const { reportId } = await signedReportFor(x.worklist.id, x.study.id, x.tag);
    const explicit = await flip({
      worklistId: x.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(explicit.status, `explicit: ${explicit.status} ${explicit.text}`).toBe(200);
    expect((await wl(x.worklist.id)).status).toBe("REPORT_FINAL");

    // The workspace's own binding is on the worklist row, so a flip that omits
    // reportId must still resolve the bound row rather than be refused.
    const y = await billedStudy();
    const yReport = await signedReportFor(y.worklist.id, y.study.id, y.tag);
    const omitted = await flip({
      worklistId: y.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      actor: SIGNER,
    });
    expect(omitted.status, `omitted id: ${omitted.status} ${omitted.text}`).toBe(200);
    expect((await wl(y.worklist.id)).status).toBe("REPORT_FINAL");
    expect(yReport.reportId).toBeGreaterThan(0);
  });

  it("leaves the documented unbilled soft-final working", async () => {
    const { worklist } = await billedStudy({ billed: false });
    const res = await flip({
      worklistId: worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      actor: SIGNER,
    });
    expect(res.status, `unbilled: ${res.status} ${res.text}`).toBe(200);
    expect((await wl(worklist.id)).status).toBe("REPORT_FINAL");
  });

  it("refuses a draft report: an unsigned row is not a finalized report", async () => {
    const { worklist, tag } = await billedStudy();
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: worklist.id,
        worklistId: worklist.id,
        title: `MRI Brain ${tag}`,
        body: `<p>UNSIGN ${tag}</p>`,
        impression: `IMPRESSION ${tag}`,
      });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    const res = await flip({
      worklistId: worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    const row = (await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId)))[0];
    if (row.status === "draft") {
      expect(res.status, `draft row: ${res.status} ${res.text}`).toBe(409);
      expect((await wl(worklist.id)).status).not.toBe("REPORT_FINAL");
    } else {
      // create already advanced it past draft (pending_verification); that is a
      // reportable state, so the flip is legitimate and must succeed.
      expect(res.status, `${res.status} ${res.text}`).toBe(200);
    }
  });

  it("repeated and concurrent flips leave one consistent finalization state", async () => {
    const { worklist } = await billedStudy();
    const { reportId } = await signedReportFor(worklist.id, worklist.id, `${marker}-conc`);
    const [first, second] = await Promise.all([
      flip({ worklistId: worklist.id, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND", reportId, actor: SIGNER }),
      flip({ worklistId: worklist.id, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND", reportId, actor: SIGNER }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const after = await wl(worklist.id);
    expect(after.status).toBe("REPORT_FINAL");
    expect(after.reportId).toBe(reportId);
    const reports = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId));
    expect(reports.length, "concurrent finalize must not duplicate the report row").toBe(1);
  });
});
