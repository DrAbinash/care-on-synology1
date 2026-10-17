/**
 * RIS-006 under the owner's ruling (2026-10-17): a report with `patient_reports.study_id IS NULL`
 * arrives at `assertReportBelongsToWorklist` with only its patient to recommend it, and today that is
 * enough — the whole worklist comparison sits inside `if (report.studyId)`. A patient with two studies
 * therefore satisfies the ownership gate for BOTH of them, so a report written for one examination can
 * be signed, flipped final and delivered against the other patient-looking row.
 *
 * The ruling: patient identity alone is never sufficient; an explicitly linked pair may share one
 * report (see `linkedSiblingReportFinalize.request.test.ts`); historical reports are preserved and
 * never back-filled. So the null branch must find a linkage that already exists in the database, and
 * refuse when none names the row being written.
 *
 * Three linkages are already authoritative, and none of them is a patient comparison:
 *  1. the worklist row already names this report (`radiology_worklist.report_id`) — no new
 *     association is being claimed at all;
 *  2. the draft that produced this report names this row (`radiology_report_drafts.final_report_id`
 *     → the same row finalize promotes and reads back, `routes/patient-reports.ts:1208`, `:973-977`);
 *  3. the report's own billed examination identity resolves to exactly one study (`order_test_id` is
 *     UNIQUE on `radiology_studies`) and that study is bound to this row.
 *
 * Every case asserts the HTTP status AND re-reads the rows. No case rewrites an existing report, and
 * no case asserts anything about production counts — the production census this needs is still
 * unreadable from this workstation, which is recorded in the tracker rather than guessed at.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  orderTestsTable,
  ordersTable,
  patientReportsTable,
  patientsTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  signaturesTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const MARKER = `nul-study-${randomUUID().slice(0, 8)}`;

describe.skipIf(!dbReady)("null study_id ownership — request level", () => {
  let app: Express;
  const token = `vitest-token-${MARKER}`;
  const SIGNER = `Dr. NullStudy ${MARKER}`;

  let patientId = 0;
  let otherPatientId = 0;
  let brainTestId = 0;
  let spineTestId = 0;
  let orderId = 0;
  let signatureId = 0;
  let seq = 0;

  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const reportIds: number[] = [];
  const draftIds: number[] = [];
  const orderTestIds: number[] = [];
  const patientsCreated: number[] = [];

  const auth = { Authorization: `Bearer ${token}` };
  const flip = (body: Record<string, unknown>) =>
    request(app).post("/api/internal/radiology/report-status").set(auth).send(body);
  const wl = async (id: number) =>
    (await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)))[0];
  const report = async (id: number) =>
    (await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id)))[0];

  async function examination(opts: { patientId: number; testId: number; label: string }) {
    seq += 1;
    const tag = `${MARKER}-${seq}`;
    const today = new Date().toISOString().slice(0, 10);
    const [ot] = await db
      .insert(orderTestsTable)
      .values({ orderId, testId: opts.testId, price: "5000" })
      .returning();
    orderTestIds.push(ot.id);
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${tag}`,
        orderId,
        orderTestId: ot.id,
        patientId: opts.patientId,
        testId: opts.testId,
        modality: "MR",
        department: "MRI",
        studyDescription: opts.label,
        studyDate: today,
        status: "scheduled",
      })
      .returning();
    studyIds.push(study.id);
    const [worklist] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Patient ${opts.patientId} ${tag}`,
        patientId: opts.patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: opts.label,
        studyDate: today,
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.nulstudy.${seq}.${MARKER}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(worklist.id);
    return { study, worklist, orderTest: ot, tag };
  }

  /**
   * A study-less report: created exactly the way the documented study-less flow creates one — no
   * studyId/worklistId on the request, so `bindRadiologyReportIdentity` is never consulted and
   * `study_id` stays NULL (`routes/patient-reports.ts:1980-1985` keeps that path on purpose).
   */
  async function studyLessReport(opts: {
    patientId: number;
    testId: number;
    label: string;
    orderTestId?: number;
    billId?: number | null;
    orderId?: number | null;
  }) {
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: opts.patientId,
        testId: opts.testId,
        orderTestId: opts.orderTestId,
        orderId: opts.orderId,
        billId: opts.billId ?? null,
        title: opts.label,
        body: `<p>FINDINGS ${opts.label}</p>`,
        impression: `IMPRESSION ${opts.label}`,
      });
    expect(created.status, `create: ${created.text}`).toBe(201);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    const stored = await report(reportId);
    // The fixture must actually be the shape under test; a study_id that arrived here means the
    // request was accepted by the binding path and the case would measure the wrong thing.
    expect(stored.studyId, "fixture must land with study_id NULL").toBeNull();
    return { reportId, stored };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER,
        email: `null-study-${MARKER}@vitest.invalid`,
        username: `null-study-${MARKER}`,
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

    const mkPatient = async (name: string) => {
      const [p] = await db
        .insert(patientsTable)
        .values({
          patientId: `NUL-${MARKER}-${name}`,
          firstName: `Nullable ${name}`,
          lastName: MARKER,
          dateOfBirth: "1980-01-01",
          gender: "female",
          phone: "0000000000",
        })
        .returning();
      patientsCreated.push(p.id);
      return p.id;
    };
    patientId = await mkPatient("a");
    otherPatientId = await mkPatient("b");

    const mkTest = async (label: string) => {
      const [t] = await db
        .insert(testsTable)
        .values({
          name: `${label} ${MARKER}`,
          code: `${label.replace(/\s/g, "").slice(0, 4)}${MARKER.slice(-6).replace(/-/g, "").toUpperCase()}`,
          price: "5000",
          category: "Radiology",
          department: "MRI",
          duration: "1 day",
          isActive: true,
        })
        .returning();
      return t.id;
    };
    brainTestId = await mkTest("MRI BRAIN");
    spineTestId = await mkTest("MRI LS SPINE");

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${MARKER}`, patientId, status: "pending" })
      .returning();
    orderId = order.id;

    const [sig] = await db
      .insert(signaturesTable)
      .values({
        name: SIGNER,
        role: "Radiologist",
        qualification: "MD (Radio-diagnosis)",
        registrationNo: `REG-${MARKER}`,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    signatureId = sig.id;
  }, 90_000);

  afterAll(async () => {
    for (const id of reportIds)
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    for (const id of draftIds)
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id)).catch(() => {});
    for (const id of worklistIds)
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    for (const id of studyIds)
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    for (const id of orderTestIds)
      await db.delete(orderTestsTable).where(eq(orderTestsTable.id, id)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId)).catch(() => {});
    for (const id of patientsCreated)
      await db.delete(patientsTable).where(eq(patientsTable.id, id)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, brainTestId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, spineTestId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
  });

  it("refuses a study-less report whose only claim is that the patient matches", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await studyLessReport({ patientId, testId: brainTestId, label: "NO STUDY LINK" });

    const res = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `patient-alone association must be refused: ${res.text}`).toBe(409);

    const row = await wl(brain.worklist.id);
    expect(row.status).not.toBe("REPORT_FINAL");
    expect(row.reportId).toBeNull();
  });

  it("still accepts the row that already names the report — no new association is being claimed", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await studyLessReport({ patientId, testId: brainTestId, label: "BACK-LINKED" });

    // The back-link the workspace writes when it promotes a report
    // (`radiology_worklist.report_id`, routes/patient-reports.ts:2208 / :2275).
    await db
      .update(radiologyWorklistTable)
      .set({ reportId })
      .where(eq(radiologyWorklistTable.id, brain.worklist.id));

    const res = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `re-affirming an existing link: ${res.text}`).toBe(200);
    const row = await wl(brain.worklist.id);
    expect(row.status).toBe("REPORT_FINAL");
    expect(row.reportId).toBe(reportId);
  });

  it("accepts a study-less report whose promoting draft names this row", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await studyLessReport({ patientId, testId: brainTestId, label: "DRAFT-NAMED" });

    // A draft for this worklist row, promoted to this report — exactly the pair finalize creates at
    // patient-reports.ts:1208, minus the study_id the study-less flow never set.
    const saved = await request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set(auth)
      .send({
        studyId: brain.worklist.id,
        worklistId: brain.worklist.id,
        patientId,
        modality: "MR",
        studyName: "DRAFT-NAMED",
        rawFindings: "<p>FINDINGS DRAFT-NAMED</p>",
      });
    expect(saved.status, saved.text).toBe(200);
    const draftId = (saved.body?.draft?.id ?? saved.body?.id ?? null) as number | null;
    expect(draftId, "save-draft returned no draft id").not.toBeNull();
    draftIds.push(draftId!);
    await db
      .update(radiologyReportDraftsTable)
      .set({ finalReportId: reportId })
      .where(eq(radiologyReportDraftsTable.id, draftId!));

    const res = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `draft linkage must authorize its own row: ${res.text}`).toBe(200);
    expect((await wl(brain.worklist.id)).status).toBe("REPORT_FINAL");
  });

  it("accepts it when the report's own billed examination resolves uniquely to this row", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await studyLessReport({
      patientId,
      testId: brainTestId,
      label: "BILLED-LINKED",
      orderTestId: brain.orderTest.id,
      orderId,
    });

    const res = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `unique order_test_id must authorize: ${res.text}`).toBe(200);
    expect((await wl(brain.worklist.id)).status).toBe("REPORT_FINAL");
  });

  it("refuses the same-patient sibling of a report another row already owns", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const spine = await examination({ patientId, testId: spineTestId, label: "MRI LS SPINE" });
    const { reportId } = await studyLessReport({ patientId, testId: brainTestId, label: "OWNED ELSEWHERE" });

    await db
      .update(radiologyWorklistTable)
      .set({ reportId, status: "REPORT_FINAL" })
      .where(eq(radiologyWorklistTable.id, brain.worklist.id));

    const res = await flip({
      worklistId: spine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `unlinked same-patient reuse: ${res.text}`).toBe(409);
    const spineRow = await wl(spine.worklist.id);
    expect(spineRow.reportId).toBeNull();
    expect(spineRow.status).not.toBe("REPORT_FINAL");
  });

  it("refuses across patients even when the other patient's row is the one holding the report", async () => {
    const mine = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const theirs = await examination({ patientId: otherPatientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await studyLessReport({ patientId, testId: brainTestId, label: "CROSS PATIENT" });
    await db
      .update(radiologyWorklistTable)
      .set({ reportId })
      .where(eq(radiologyWorklistTable.id, mine.worklist.id));

    const res = await flip({
      worklistId: theirs.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, `cross-patient flip: ${res.text}`).toBe(409);
    expect(res.body.code).toBe("REPORT_PATIENT_MISMATCH");
    expect((await wl(theirs.worklist.id)).reportId).toBeNull();
  });

  it("attributes it to either row when duplicate intake bound two rows to the same study", async () => {
    seq += 1;
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const today = new Date().toISOString().slice(0, 10);
    const [secondRow] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Patient ${patientId} ${MARKER}-dup`,
        patientId,
        studyId: brain.study.id,
        modality: "MR",
        studyDescription: "MRI BRAIN",
        studyDate: today,
        accessionNumber: `ACC-${MARKER}-${seq}-dup`,
        studyInstanceUID: `1.2.840.nulstudy.dup.${MARKER}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(secondRow.id);

    const { reportId } = await studyLessReport({
      patientId,
      testId: brainTestId,
      label: "DUPLICATE-ROW BILLED-LINKED",
      orderTestId: brain.orderTest.id,
      orderId,
    });

    // Two rows, one examination: both of them ARE that examination, so neither flip is a claim to
    // reach another study. Refusing here would strand the very intake duplicates this guards against.
    const first = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(first.status, `primary row: ${first.text}`).toBe(200);

    const second = await flip({
      worklistId: secondRow.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(second.status, `duplicate row: ${second.text}`).toBe(200);
    expect((await wl(secondRow.id)).status).toBe("REPORT_FINAL");
  });

  it("leaves the historical report itself untouched by a refusal", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const spine = await examination({ patientId, testId: spineTestId, label: "MRI LS SPINE" });
    const { reportId, stored } = await studyLessReport({ patientId, testId: brainTestId, label: "PRESERVED" });

    const refusal = await flip({
      worklistId: spine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(refusal.status).toBe(409);

    const after = await report(reportId);
    // No back-fill: the refusal must not quietly resolve the linkage by writing an id onto history.
    expect(after.studyId).toBeNull();
    expect(after.patientId).toBe(stored.patientId);
    expect(after.testId).toBe(stored.testId);
    expect(after.body).toBe(stored.body);
    expect(after.impression).toBe(stored.impression);
    expect(after.status).toBe(stored.status);
    expect(after.updatedAt.getTime()).toBe(stored.updatedAt.getTime());
  });
});
