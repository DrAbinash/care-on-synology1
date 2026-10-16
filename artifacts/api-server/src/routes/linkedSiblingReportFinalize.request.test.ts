/**
 * RIS-012 — one signed report may cover a second examination ONLY when the two examinations were
 * explicitly linked under the combined-report workflow. The same patient alone is never sufficient.
 *
 * The Reporting Workspace's "combine" action reports two studies in one document: the radiologist
 * writes one report for, say, an MRI Brain and an MRI LS Spine done in the same slot. On finalize the
 * ERP posts the SAME report twice — once for the study it was opened on
 * (`radiologyReportLifecycle.ts:486`) and once for the linked sibling (`:505`) — because both studies
 * must leave the worklist as REPORT_FINAL or the second one sits in the queue forever and the patient
 * is told to wait for a report that already exists.
 *
 * The shared ownership guard is `assertReportBelongsToWorklist`
 * (`lib/radiologyIdentity.ts:234-260`), and it resolves the report's own `study_id` to a worklist row
 * and refuses when that is not the row being flipped. So the question this file answers, at the HTTP
 * boundary and against PostgreSQL rather than by reading the trace: does the authorized sibling flip
 * survive that guard, or is a legitimate combined report refused on its second study while the
 * unauthorized reuse is what the guard exists to stop?
 *
 * The linkage authority is the one the product already persists — the combined-report draft's
 * structured_json envelope (`linkedStudyId` / `careLinkedStudy`, written by
 * `POST /api/radiology/report-generator/save-draft` and reached from the signed report through
 * `radiology_report_drafts.final_report_id`). Nothing here invents a second identity system, and no
 * assertion accepts a patient-only justification.
 *
 * Every case asserts the HTTP status AND re-reads `radiology_worklist` / `patient_reports`, because a
 * 200 that flipped nothing and a 409 that flipped anyway are both clinical failures.
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
const MARKER = `lkr-${randomUUID().slice(0, 8)}`;

describe.skipIf(!dbReady)("combined-report sibling ownership — request level", () => {
  let app: Express;
  const token = `vitest-token-${MARKER}`;
  const SIGNER = `Dr. Linker ${MARKER}`;

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

  /** One billed examination with a matched, approved worklist row — the pair the workspace opens. */
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
        studyInstanceUID: `1.2.840.linked.${seq}.${MARKER}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(worklist.id);
    return { study, worklist, tag };
  }

  /**
   * The workspace's own two calls, in order: save the draft (this is where a combined report records
   * its second examination), then create-and-sign the report against the primary worklist row.
   */
  async function signedReport(opts: {
    patientId: number;
    testId: number;
    primary: { worklist: { id: number }; study: { accessionNumber: string | null; studyInstanceUid: string | null } };
    sibling?: { worklist: { id: number }; study: { accessionNumber: string | null; studyInstanceUid: string | null } };
    label: string;
  }) {
    const draftBody: Record<string, unknown> = {
      studyId: opts.primary.worklist.id,
      worklistId: opts.primary.worklist.id,
      patientId: opts.patientId,
      modality: "MR",
      studyName: opts.label,
      rawFindings: `<p>FINDINGS ${opts.label}</p>`,
      findingsSections: { Findings: `FINDINGS ${opts.label}` },
    };
    if (opts.sibling) {
      draftBody.linkedStudy = {
        studyId: opts.sibling.worklist.id,
        title: opts.label,
        modality: "MR",
        studyDescription: opts.label,
        accessionNumber: opts.sibling.study.accessionNumber ?? null,
        studyInstanceUID: opts.sibling.study.studyInstanceUid ?? null,
      };
    }
    const saved = await request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set(auth)
      .send(draftBody);
    expect(saved.status, `save-draft: ${saved.text}`).toBe(200);
    const draftId = (saved.body?.draft?.id ?? saved.body?.id ?? null) as number | null;
    if (draftId != null) draftIds.push(draftId);

    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: opts.patientId,
        testId: opts.testId,
        studyId: opts.primary.worklist.id,
        worklistId: opts.primary.worklist.id,
        title: opts.label,
        body: `<p>FINDINGS ${opts.label}</p>`,
        impression: `IMPRESSION ${opts.label}`,
      });
    expect(created.status, `create: ${created.text}`).toBe(201);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    const signed = await request(app)
      .post(`/api/patient-reports/${reportId}/sign`)
      .set(auth)
      .send({ signatureId });
    expect(signed.status, `sign: ${signed.text}`).toBe(200);
    return { reportId, draftId };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER,
        email: `linked-${MARKER}@vitest.invalid`,
        username: `linked-${MARKER}`,
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
          patientId: `LKR-${MARKER}-${name}`,
          firstName: `Linked ${name}`,
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
          code: `${label.replace(/\s/g, "").slice(0, 4)}${MARKER.slice(-5).toUpperCase()}`,
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

  it("1. one examination, one signed report — the ordinary finalize works", async () => {
    const a = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await signedReport({
      patientId, testId: brainTestId, primary: a, label: "SINGLE BRAIN",
    });

    const res = await flip({
      worklistId: a.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(res.status, res.text).toBe(200);

    const row = await wl(a.worklist.id);
    expect(row.status).toBe("REPORT_FINAL");
    expect(row.reportId).toBe(reportId);
  });

  it("2. two explicitly linked examinations, one authorized combined report — both reach REPORT_FINAL", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const spine = await examination({ patientId, testId: spineTestId, label: "MRI LS SPINE" });
    const { reportId, draftId } = await signedReport({
      patientId, testId: brainTestId, primary: brain, sibling: spine, label: "COMBINED BRAIN + LS SPINE",
    });

    // The linkage the owner's ruling requires: recorded by the product on the draft, not inferred
    // here. If this is absent the rest of the case is measuring the wrong thing.
    const draft = draftId == null ? null : (await db.select().from(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId)))[0];
    expect(draft, "save-draft returned no draft id").toBeTruthy();
    const envelope = draft!.structuredJson as { linkedStudyId?: number | string; careLinkedStudy?: { studyId?: number | string } } | null;
    expect(Number(envelope?.linkedStudyId ?? envelope?.careLinkedStudy?.studyId)).toBe(spine.worklist.id);

    const primary = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(primary.status, primary.text).toBe(200);

    const sibling = await flip({
      worklistId: spine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    // The owner's required behaviour: an authorized combined report covers both examinations.
    expect(sibling.status, `linked sibling flip: ${sibling.text}`).toBe(200);

    const spineRow = await wl(spine.worklist.id);
    expect(spineRow.status).toBe("REPORT_FINAL");
    expect(spineRow.reportId).toBe(reportId);

    // The report itself stays a document about both, owned by the pair's patient — not re-keyed to
    // the sibling, which would silently move it out of the primary study.
    const stored = await report(reportId);
    expect(stored.studyId).toBe(brain.worklist.id);
    expect(stored.patientId).toBe(patientId);
  });

  it("3. two examinations of the same patient, NOT explicitly linked — reuse is refused", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const spine = await examination({ patientId, testId: spineTestId, label: "MRI LS SPINE" });
    const { reportId } = await signedReport({
      patientId, testId: brainTestId, primary: brain, label: "UNLINKED BRAIN",
    });

    const primary = await flip({
      worklistId: brain.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(primary.status, primary.text).toBe(200);

    // Same patient, same modality, plausible-looking request. Sharing a patient is not a linkage.
    const reuse = await flip({
      worklistId: spine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(reuse.status, `unlinked same-patient reuse must be refused: ${reuse.text}`).toBe(409);
    expect(reuse.body.code).toBe("REPORT_WORKLIST_MISMATCH");

    const spineRow = await wl(spine.worklist.id);
    expect(spineRow.status).not.toBe("REPORT_FINAL");
    expect(spineRow.reportId).toBeNull();
  });

  it("4. two examinations of DIFFERENT patients — refused, and a forged linkage does not help", async () => {
    const mine = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const theirs = await examination({ patientId: otherPatientId, testId: brainTestId, label: "MRI BRAIN" });
    const { reportId } = await signedReport({
      patientId, testId: brainTestId, primary: mine, sibling: theirs, label: "ATTEMPTED CROSS-PATIENT COMBINE",
    });

    const primary = await flip({
      worklistId: mine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(primary.status, primary.text).toBe(200);

    // The linkage exists on the draft and names the other patient's row; the report's own patient
    // still does not match that study, so the flip must refuse. This is the case that keeps the
    // sibling allowance from becoming a new way to cross patients.
    const cross = await flip({
      worklistId: theirs.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    });
    expect(cross.status, `cross-patient flip must be refused: ${cross.text}`).toBe(409);

    const otherRow = await wl(theirs.worklist.id);
    expect(otherRow.status).not.toBe("REPORT_FINAL");
    expect(otherRow.reportId).toBeNull();
  });

  it("5. repeated finalization of the linked sibling stays idempotent", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const spine = await examination({ patientId, testId: spineTestId, label: "MRI LS SPINE" });
    const { reportId } = await signedReport({
      patientId, testId: brainTestId, primary: brain, sibling: spine, label: "COMBINED TWICE",
    });
    // A second, genuinely separate report for the spine study — created BEFORE anything is marked
    // final, because saving a draft against a study that already has a final report is refused by
    // the draft-lock guard, and that refusal is not what this case is about.
    const other = await signedReport({
      patientId, testId: spineTestId, primary: spine, label: "SEPARATE LS SPINE REPORT",
    });

    const body = {
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId,
      actor: SIGNER,
    };
    expect((await flip({ worklistId: brain.worklist.id, ...body })).status).toBe(200);
    const firstSibling = await flip({ worklistId: spine.worklist.id, ...body });
    expect(firstSibling.status, firstSibling.text).toBe(200);

    const again = await flip({ worklistId: spine.worklist.id, ...body });
    expect(again.status, `repeat flip: ${again.text}`).toBe(200);
    expect(again.body.idempotent).toBe(true);

    const row = await wl(spine.worklist.id);
    expect(row.status).toBe("REPORT_FINAL");
    expect(row.reportId).toBe(reportId);

    // A different report claiming the same sibling is still refused — idempotence is for the same
    // document, not a licence to overwrite whichever report arrives second.
    const conflicting = await flip({
      worklistId: spine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId: other.reportId,
      actor: SIGNER,
    });
    expect(conflicting.status, `conflicting report: ${conflicting.text}`).toBe(409);
    expect(conflicting.body.code).toBe("ALREADY_FINAL");
    const stillCombined = await wl(spine.worklist.id);
    expect(stillCombined.reportId).toBe(reportId);
  });

  it("6. an amendment keeps the combined report's integrity and its authorized scope", async () => {
    const brain = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN" });
    const spine = await examination({ patientId, testId: spineTestId, label: "MRI LS SPINE" });
    const unrelated = await examination({ patientId, testId: brainTestId, label: "MRI BRAIN SECOND SLOT" });
    const { reportId } = await signedReport({
      patientId, testId: brainTestId, primary: brain, sibling: spine, label: "COMBINED THEN AMENDED",
    });

    await flip({
      worklistId: brain.worklist.id, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND", reportId, actor: SIGNER,
    });
    const before = await report(reportId);

    const sibling = await flip({
      worklistId: spine.worklist.id, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND", reportId, actor: SIGNER,
    });
    expect(sibling.status, sibling.text).toBe(200);

    // Nothing the ownership decision does may touch the signed document.
    const after = await report(reportId);
    expect(after.body).toBe(before.body);
    expect(after.impression).toBe(before.impression);
    expect(after.signedAt?.toISOString()).toBe(before.signedAt?.toISOString());
    expect(after.status).toBe(before.status);

    // An amendment inherits the parent's identity verbatim
    // (`routes/patient-reports.ts:1815-1820`), so it is the same combined document for the same two
    // examinations: it may reach the sibling, and it may NOT reach any other study of this patient.
    const [amendment] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-AMEND-${MARKER}`,
        type: "radiology",
        patientId: before.patientId,
        testId: before.testId,
        orderTestId: before.orderTestId,
        orderId: before.orderId,
        billId: before.billId,
        studyId: before.studyId,
        title: `${before.title} (amended)`,
        body: before.body,
        status: "final",
        signedByName: SIGNER,
        signedAt: new Date(),
      })
      .returning();
    reportIds.push(amendment.id);

    const amendedSibling = await flip({
      worklistId: spine.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId: amendment.id,
      actor: SIGNER,
    });
    // The sibling row already holds the parent report; a second document for it is a conflict, not
    // a re-affirmation — the refusal must be about that, and never a silent overwrite.
    expect(amendedSibling.status, amendedSibling.text).toBe(409);
    const spineRow = await wl(spine.worklist.id);
    expect(spineRow.reportId).toBe(reportId);

    const stray = await flip({
      worklistId: unrelated.worklist.id,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId: amendment.id,
      actor: SIGNER,
    });
    expect(stray.status, `amendment reuse on an unlinked study: ${stray.text}`).toBe(409);
    const unrelatedRow = await wl(unrelated.worklist.id);
    expect(unrelatedRow.reportId).toBeNull();
  });
});
