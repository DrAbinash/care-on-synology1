/**
 * Which id is a finalize allowed to use? — request level, real Postgres.
 *
 * Measured in a real browser on `origin/main`: the Reporting Workspace's
 * Confirm & sign issued `GET /api/patient-reports/from-study/4` where **4 is the
 * radiology_worklist row id**, got a 404, skipped the report row entirely, sent
 * no REPORT_FINAL flip — and still put the workspace into its locked
 * "signed/final" state. `radiology_worklist.status` stayed `STUDY_RECEIVED` and
 * `patient_reports` stayed empty, for every one of five studies tested.
 *
 * The lookup is keyed on `radiology_studies.id` (patient-reports.ts:3743-3760)
 * and echoes whatever that row holds — `patientId`, `testId`, `orderId`,
 * `billId`. `radiology_studies.id` and `radiology_worklist.id` are independent
 * sequences; `resolveWorklistFromStudyRef` has to try both, which is the
 * proof that neither implies the other. So a worklist row id passed to that
 * lookup either MISSES (the observed 404 → silent skip) or resolves a study that
 * belongs to a different patient. Both cases are built here on purpose.
 *
 * What this file pins:
 *   1. the correct handoff (prefill by billed study id, create bound by the
 *      worklist row id) finalizes end to end — the fix must restore this, not
 *      reinvent it;
 *   2. a row id that lands on another patient's study is NOT allowed to produce
 *      a report for the patient on screen, and must not silently bind that other
 *      study's test/order/bill;
 *   3. a row id that lands on nothing leaves no report and no finalization
 *      server-side — so a UI that reports "final" over it is showing something
 *      the database never did.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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

describe.skipIf(!dbReady)("finalize id authority — request level", () => {
  let app: Express;
  const marker = `finid-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const auth = { Authorization: `Bearer ${token}` };
  const today = new Date().toISOString().slice(0, 10);

  const reportIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];

  let patientA = 0; // the patient the radiologist is reporting for
  let patientB = 0; // somebody else, whose study will occupy A's row number
  let testA = 0; // A's own test
  let testB = 0; // B's different test — the one a wrong prefill hands back
  let orderA = 0;
  let orderB = 0;

  let studyA = 0;
  let worklistOk = 0;
  let worklistCollide = 0;
  let worklistNoStudy = 0;
  let collisionStudyId = 0; // id deliberately equal to `worklistCollide`

  function insertPatient(tag: string) {
    return db
      .insert(patientsTable)
      .values({
        patientId: `${marker.toUpperCase()}-${tag}`,
        firstName: "Probe",
        lastName: `${tag} ${marker}`,
        dateOfBirth: "1980-01-01",
        gender: "female",
        phone: "0000000000",
      })
      .returning();
  }

  function insertTest(code: string) {
    return db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${code}`,
        code,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
  }

  function insertStudy(values: Record<string, unknown>) {
    return db
      .insert(radiologyStudiesTable)
      .values({
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "acquired",
        ...values,
      } as never)
      .returning();
  }

  function insertWorklist(values: Record<string, unknown>) {
    return db
      .insert(radiologyWorklistTable)
      .values({
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
        ...values,
      } as never)
      .returning();
  }

  async function readWorklist(id: number) {
    const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    return wl;
  }

  const finalizingReport = (title: string) => ({
    type: "radiology",
    patientId: patientA, // the patient on screen
    testId: testB, // what the colliding prefill returned
    orderId: orderB, // and the order that came with it
    studyId: worklistCollide,
    worklistId: worklistCollide,
    title,
    body: `<p>${marker}</p>`,
    impression: "Must never be written for patient A.",
  });

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. IdProbe ${marker}`,
        email: `finid-${marker}@vitest.invalid`,
        username: `finid-${marker}`,
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

    const [a] = await insertPatient("Alpha");
    const [b] = await insertPatient("Bravo");
    patientA = a.id;
    patientB = b.id;

    // Two DIFFERENT tests, so a prefill that reaches the wrong study is provable
    // from the test id alone.
    const [ta] = await insertTest(`MRA${marker.slice(-4).toUpperCase()}`);
    const [tb] = await insertTest(`MRB${marker.slice(-4).toUpperCase()}`);
    testA = ta.id;
    testB = tb.id;

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${marker}`, patientId: patientA, status: "pending" })
      .returning();
    orderA = order.id;
    await db.insert(orderTestsTable).values({ orderId: orderA, testId: testA, price: "5000" });

    // Patient B's own order, carrying B's test. A prefill that resolves B's
    // study hands these numbers to A's finalize, which is the pairing the
    // server must refuse.
    const [orderBRow] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-B-${marker}`, patientId: patientB, status: "pending" })
      .returning();
    orderB = orderBRow.id;
    await db.insert(orderTestsTable).values({ orderId: orderB, testId: testB, price: "5000" });

    const [sA] = await insertStudy({ accessionNumber: `ACC-A-${marker}`, patientId: patientA, testId: testA, orderId: orderA });
    studyA = sA.id;
    studyIds.push(sA.id);

    // (1) the honest case: a row linked to its own billed study.
    const [wOk] = await insertWorklist({
      patientName: `Probe Alpha ${marker}`,
      patientId: patientA,
      studyId: studyA,
      accessionNumber: `ACC-OK-${marker}`,
      studyInstanceUID: `1.2.840.finid.${marker}.ok`,
    });
    worklistOk = wOk.id;
    worklistIds.push(wOk.id);

    // (2) the dangerous case: a PACS row whose billing link has not landed yet
    // (study_id NULL — routine in this schema), plus ANOTHER patient's study
    // sitting at this row's number.
    const [wC] = await insertWorklist({
      patientName: `Probe Alpha ${marker}`,
      patientId: patientA,
      studyId: null,
      modality: "CT",
      studyDescription: "CT Brain",
      accessionNumber: `ACC-COLLIDE-${marker}`,
      studyInstanceUID: `1.2.840.finid.${marker}.c`,
    });
    worklistCollide = wC.id;
    worklistIds.push(wC.id);

    const already = await db
      .select({ id: radiologyStudiesTable.id, patientId: radiologyStudiesTable.patientId })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, worklistCollide));
    if (already.length === 0) {
      const [cs] = await insertStudy({
        id: worklistCollide,
        accessionNumber: `ACC-B-${marker}`,
        patientId: patientB,
        testId: testB,
        orderId: orderB,
      });
      collisionStudyId = cs.id;
      studyIds.push(cs.id);
      // The id was supplied explicitly, so the sequence has not moved past it.
      // Without this the next auto-inserted study would collide with this row
      // and fail an unrelated test file.
      await db.execute(sql`select setval(pg_get_serial_sequence('radiology_studies','id'),
        (select coalesce(max(id),1) from radiology_studies))`);
    } else if (already[0].patientId !== patientA) {
      collisionStudyId = already[0].id; // an unrelated study already owns the number
    }

    // (3) the observed case: no billing link and nothing at that study number.
    const [wN] = await insertWorklist({
      patientName: `Probe Alpha ${marker}`,
      patientId: patientA,
      studyId: null,
      modality: "US",
      studyDescription: "USG Whole Abdomen",
      accessionNumber: `ACC-NOSTUDY-${marker}`,
      studyInstanceUID: `1.2.840.finid.${marker}.n`,
    });
    worklistNoStudy = wN.id;
    worklistIds.push(wN.id);
  }, 90_000);

  afterAll(async () => {
    for (const id of reportIds) {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, String(id))).catch(() => {});
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of studyIds) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    for (const pid of [patientA, patientB]) {
      await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, pid)).catch(() => {});
      await db.delete(patientsTable).where(eq(patientsTable.id, pid)).catch(() => {});
    }
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderA)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderB)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.patientId, patientA)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.patientId, patientB)).catch(() => {});
    for (const t of [testA, testB]) {
      await db.delete(testsTable).where(eq(testsTable.id, t)).catch(() => {});
    }
  }, 60_000);

  it("finalizes end to end when the prefill is read by the BILLED study id", async () => {
    const prefill = await request(app).get(`/api/patient-reports/from-study/${studyA}`).set(auth);
    expect(prefill.status, prefill.text).toBe(200);
    expect(Number(prefill.body.testId)).toBe(testA);
    expect(Number(prefill.body.patientId)).toBe(patientA);

    // Create binds by the worklist ROW id — `patient_reports.study_id` is
    // documented as that space, so the fix must not change it.
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testA,
        studyId: worklistOk,
        worklistId: worklistOk,
        title: `MRI Brain ${marker}`,
        body: `<p>Findings ${marker}</p>`,
        impression: "No acute intracranial abnormality.",
      });
    expect([200, 201], created.text).toContain(created.status);
    expect(created.body.idempotent, `unexpected idempotent reuse: ${JSON.stringify(created.body)}`).not.toBe(true);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    const flipped = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: worklistOk,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId,
      });
    expect(flipped.status, flipped.text).toBe(200);

    const wl = await readWorklist(worklistOk);
    expect(wl.status).toBe("REPORT_FINAL");
    expect(wl.reportId).toBe(reportId);
  });

  it("never lets a row id that resolves another patient's study write a report for this patient", async () => {
    expect(collisionStudyId, "no study occupies the colliding row id; case not constructible here").toBeGreaterThan(0);

    const prefill = await request(app)
      .get(`/api/patient-reports/from-study/${worklistCollide}`)
      .set(auth);
    expect(prefill.status, prefill.text).toBe(200);
    // The lookup is unknowingly answering for the OTHER patient.
    expect(Number(prefill.body.patientId)).toBe(patientB);
    expect(Number(prefill.body.testId)).toBe(testB);
    expect(Number(prefill.body.orderId)).toBe(orderB);

    const attempted = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send(finalizingReport(`MRI Brain stolen ${marker}`));

    expect(attempted.status, attempted.text).toBeGreaterThanOrEqual(400);
    expect(["ORDER_MISMATCH", "TEST_MISMATCH", "PATIENT_MISMATCH", "ORDER_CANCELLED"], attempted.text).toContain(
      attempted.body?.code,
    );
    const [row] = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.title, `MRI Brain stolen ${marker}`));
    expect(row, "the refused finalize still wrote a report row").toBeUndefined();

    const wl = await readWorklist(worklistCollide);
    expect(wl.reportId, `row was bound to a report: ${JSON.stringify(wl)}`).toBeNull();
    expect(wl.status).toBe("STUDY_RECEIVED");
  });

  it("leaves no report and no finalization when a row id is not a study id", async () => {
    const lookup = await request(app).get(`/api/patient-reports/from-study/${worklistNoStudy}`).set(auth);
    if (lookup.status === 200) {
      // If SOMETHING answers, it must not be this row's study — the row has none.
      expect(Number(lookup.body.patientId)).not.toBe(patientA);
    } else {
      expect(lookup.status, lookup.text).toBe(404);
    }

    const before = await readWorklist(worklistNoStudy);
    expect(before.status).toBe("STUDY_RECEIVED");
    expect(before.reportId).toBeNull();
  });

  it("still finalizes a legitimately unbilled study — the new proof refuses only false claims", async () => {
    // (a) no order cited at all: exactly the audited unbilled path, which must
    // not be narrowed by a guard meant for cross-patient order linkage.
    const [wlNoOrder] = await insertWorklist({
      patientName: `Probe Alpha ${marker}`,
      patientId: patientA,
      studyId: null,
      accessionNumber: `ACC-NOORDER-${marker}`,
      studyInstanceUID: `1.2.840.finid.${marker}.o`,
    });
    worklistIds.push(wlNoOrder.id);
    const noOrder = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testA,
        studyId: wlNoOrder.id,
        worklistId: wlNoOrder.id,
        title: `MRI Brain unbilled ${marker}`,
        body: `<p>${marker}</p>`,
        impression: "Unbilled but honest.",
      });
    expect([200, 201], noOrder.text).toContain(noOrder.status);
    reportIds.push(noOrder.body.id as number);

    // (b) an order cited, and the test really is on it.
    const [wlOrdered] = await insertWorklist({
      patientName: `Probe Alpha ${marker}`,
      patientId: patientA,
      studyId: null,
      accessionNumber: `ACC-ORDERED-${marker}`,
      studyInstanceUID: `1.2.840.finid.${marker}.d`,
    });
    worklistIds.push(wlOrdered.id);
    const ordered = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testA,
        orderId: orderA, // A's own order, which does carry A's own test
        studyId: wlOrdered.id,
        worklistId: wlOrdered.id,
        title: `MRI Brain ordered ${marker}`,
        body: `<p>${marker}</p>`,
        impression: "Correctly paired.",
      });
    expect([200, 201], ordered.text).toContain(ordered.status);
    reportIds.push(ordered.body.id as number);
  });
});
