/**
 * P1 — what the signed-report witness actually reads, at the wire.
 *
 * The Reporting Workspace used to answer "is this signed?" with "is there a
 * report id?", and displayed `Report signed` on a row that was `status = 'draft'`
 * with `signed_at IS NULL` (browser-reproduced as patient_reports 171). The
 * display decision now comes from the report row's own witnesses, so the
 * questions this file answers are the ones the UI depends on:
 *
 *   1. does a created-but-unsigned row read as unsigned, through the route the
 *      browser uses (`GET /api/patient-reports/:id`)?
 *   2. does a refused sign leave it that way — a signature block that does not
 *      exist writes nothing?
 *   3. when several signature blocks exist, whose name ends up on the row: the
 *      chosen block's, from the database, or the one the caller typed?
 *   4. does re-signing preserve the original signer and instant?
 *   5. does a withdrawal stop being a witness, and reopen the study?
 *   6. what does a study marked final with NO report behind it look like, and
 *      can a signing role put one there? (both doors are pinned: the refusal
 *      that closes the fabricated one, the read from the legitimate one);
 *   7. do two patients' reports keep their own witnesses when both are open?
 *
 * The parity between `isSignedArtifact` (the ONE server authority) and the
 * client's classifier is pinned in
 * `diagnostic-erp/src/lib/signedReportWitness.test.ts`, which runs the same
 * witness rows through both predicates — so what is asserted here is the
 * authoritative field state after each real request, not a second copy of the
 * rule.
 *
 * "Missing signature configuration" is split honestly: a clinic with no active
 * signature block is a CLIENT-side decision (`autoSignReport` declines rather
 * than invent an author — pinned in radiologyReportLifecycle.test.ts, which
 * mocks GET /api/signatures as an empty list). A request-level test cannot make
 * a shared table empty, so this file pins the wire-observable equivalent: the
 * sign route refuses a signature block that is not there and leaves the row
 * unsigned, which is the state the UI must then show as "not signed".
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
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
import { isSignedArtifact } from "../lib/signedArtifactGuard";

const dbReady = hasDatabaseUrl();

const BODY = "<p>The brain parenchyma shows no acute infarct, haemorrhage or mass effect. "
  + "The ventricles and sulci are age-appropriate in caliber.</p>";
const IMPRESSION = "No acute intracranial pathology.";

describe.skipIf(!dbReady)("signed-report witness — request level", () => {
  let app: Express;
  const marker = `sigwit-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const auth = { Authorization: `Bearer ${token}` };
  const today = new Date().toISOString().slice(0, 10);
  const SIGNER_NAME = `Dr. Witness ${marker}`;

  const reportIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const signatureIds: number[] = [];

  let patientA = 0;
  let patientB = 0;
  let testA = 0;
  let orderA = 0;
  let orderB = 0;
  let studyA = 0;
  let worklistA = 0;
  let sigOne = 0;
  let sigTwo = 0;

  function insertWorklist(values: Record<string, unknown>) {
    return db
      .insert(radiologyWorklistTable)
      .values({
        modality: "CT",
        studyDescription: "CT Brain",
        studyDate: today,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
        ...values,
      } as never)
      .returning();
  }

  async function worklist(id: number) {
    const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    if (!wl) throw new Error(`worklist ${id} vanished`);
    return wl;
  }

  /**
   * One worklist row per scenario. A finalize claims the row it is bound to
   * (`claimWorklistForFinalize` locks it and writes `report_id`), so a second
   * create against the same row is answered with the FIRST report — which is
   * exactly the idempotent path, and would make every scenario after the first
   * sign the same row twice and fail for a reason that has nothing to do with
   * the witness.
   */
  async function freshStudyRow(tag: string, patientId: number | null = patientA) {
    const [row] = await insertWorklist({
      patientId,
      patientName: `Witness ${tag} ${marker}`,
      studyId: patientId === patientA ? studyA : null,
      accessionNumber: `ACC-WIT-${tag}-${marker}`,
      studyInstanceUID: `1.2.840.sigwit.${marker}.${tag.toLowerCase()}`,
    });
    worklistIds.push(row.id);
    return row.id;
  }

  /** The read the browser's badge is built from — the same route, same params. */
  async function readBack(reportId: number) {
    const res = await request(app).get(`/api/patient-reports/${reportId}`).set(auth);
    expect(res.status).toBe(200);
    return res.body as {
      id: number; status: string; signedAt: string | null;
      signedByName: string | null; studyId: number | null; patientId: number;
    };
  }

  function createReport(rowId: number, over: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId: patientA,
        testId: testA,
        orderId: orderA,
        studyId: rowId,
        title: "CT BRAIN",
        body: BODY,
        impression: IMPRESSION,
        createdBy: SIGNER_NAME,
        ...over,
      });
  }

  async function createdReport(rowId: number, over: Record<string, unknown> = {}) {
    const res = await createReport(rowId, over);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);
    const id = res.body.id as number;
    reportIds.push(id);
    return id;
  }

  function sign(reportId: number, body: Record<string, unknown> = {}) {
    return request(app).post(`/api/patient-reports/${reportId}/sign`).set(auth).send(body);
  }

  async function finalizeToStudy(rowId: number, reportId: number) {
    const res = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: rowId,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId,
        actor: SIGNER_NAME,
      });
    return res;
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER_NAME,
        email: `sigwit-${marker}@vitest.invalid`,
        username: `sigwit-${marker}`,
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

    const [a] = await db.insert(patientsTable).values({
      patientId: `SWA-${marker}`, firstName: "Witness", lastName: `Alpha ${marker}`,
      dateOfBirth: "1980-01-01", gender: "female", phone: "0000000000",
    }).returning();
    const [b] = await db.insert(patientsTable).values({
      patientId: `SWB-${marker}`, firstName: "Witness", lastName: `Bravo ${marker}`,
      dateOfBirth: "1982-02-02", gender: "male", phone: "0000000001",
    }).returning();
    patientA = a.id;
    patientB = b.id;

    const [t] = await db.insert(testsTable).values({
      name: `CT Brain ${marker}`, code: `CTW${marker.slice(-4).toUpperCase()}`, price: "4000",
      category: "Radiology", department: "CT", duration: "1 day", isActive: true,
    }).returning();
    testA = t.id;

    const [order] = await db.insert(ordersTable)
      .values({ orderNumber: `ORD-${marker}`, patientId: patientA, status: "pending" })
      .returning();
    orderA = order.id;
    await db.insert(orderTestsTable).values({ orderId: orderA, testId: testA, price: "4000" });

    // Patient B needs a bill of their own: create validates that the order in
    // the payload belongs to the patient on the report (ORDER_MISMATCH), so a
    // second patient cannot be carried on A's numbers.
    const [order2] = await db.insert(ordersTable)
      .values({ orderNumber: `ORD-B-${marker}`, patientId: patientB, status: "pending" })
      .returning();
    orderB = order2.id;
    await db.insert(orderTestsTable).values({ orderId: orderB, testId: testA, price: "4000" });

    const [study] = await db.insert(radiologyStudiesTable).values({
      accessionNumber: `ACC-A-${marker}`, patientId: patientA, testId: testA, orderId: orderA,
      modality: "CT", department: "CT", studyDescription: "CT Brain", studyDate: today, status: "acquired",
    } as never).returning();
    studyA = study.id;
    studyIds.push(study.id);

    const [wl] = await insertWorklist({
      patientId: patientA,
      patientName: `Witness Alpha ${marker}`,
      studyId: studyA,
      accessionNumber: `ACC-WIT-A-${marker}`,
      studyInstanceUID: `1.2.840.sigwit.${marker}.a`,
    });
    worklistA = wl.id;
    worklistIds.push(wl.id);

    // Two signature blocks on file: the case where the workspace refuses to
    // guess, and the case the sign route must resolve from the CHOSEN row.
    const [s1] = await db.insert(signaturesTable).values({
      name: `Dr. First ${marker}`, role: "Radiologist", qualification: "MD (Radio)",
      registrationNo: `REG1-${marker}`, imageDataUrl: "data:image/png;base64,iVBORw0KGgo=", isActive: true,
    }).returning();
    const [s2] = await db.insert(signaturesTable).values({
      name: `Dr. Second ${marker}`, role: "Radiologist", qualification: "MD (Radio)",
      registrationNo: `REG2-${marker}`, imageDataUrl: "data:image/png;base64,iVBORw0KGgo=", isActive: true,
    }).returning();
    sigOne = s1.id;
    sigTwo = s2.id;
    signatureIds.push(s1.id, s2.id);
  }, 90_000);

  afterAll(async () => {
    for (const id of reportIds) {
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of studyIds) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    for (const id of signatureIds) {
      await db.delete(signaturesTable).where(eq(signaturesTable.id, id)).catch(() => {});
    }
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderA)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderA)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderB)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderB)).catch(() => {});
    for (const pid of [patientA, patientB]) {
      await db.delete(patientsTable).where(eq(patientsTable.id, pid)).catch(() => {});
    }
    await db.delete(testsTable).where(eq(testsTable.id, testA)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.name, SIGNER_NAME)).catch(() => {});
  }, 90_000);

  it("1. a created row is unsigned, and the browser's own read says so", async () => {
    const id = await createdReport(await freshStudyRow("T1"));

    const row = await readBack(id);
    expect(row.status).toBe("draft");
    expect(row.signedAt).toBeNull();
    expect(row.signedByName).toBeNull();
    // The authority the UI's classifier mirrors — so a badge built on this row
    // is obliged to say "not signed", whatever `reportId` it was given.
    expect(isSignedArtifact(row)).toBe(false);
  });

  it("2. a signature block that does not exist refuses and writes nothing", async () => {
    const id = await createdReport(await freshStudyRow("T2"));

    const refused = await sign(id, { signatureId: 999_999_999 });
    expect(refused.status, JSON.stringify(refused.body)).toBe(404);

    const row = await readBack(id);
    expect(row.signedAt).toBeNull();
    expect(row.status).toBe("draft");
    expect(isSignedArtifact(row)).toBe(false);
  });

  it("3. the signer of record is the chosen block, never the name in the body", async () => {
    const id = await createdReport(await freshStudyRow("T3"));

    const signed = await sign(id, { signatureId: sigTwo, signedByName: `Dr. Whoever ${marker}` });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);

    const row = await readBack(id);
    // Two active blocks exist; the row must carry the one that was chosen, so an
    // ambiguous clinic cannot be resolved by a client assertion.
    expect(row.signedByName).toBe(`Dr. Second ${marker}`);
    expect(row.signedByName).not.toBe(`Dr. Whoever ${marker}`);
    expect(row.signedAt).not.toBeNull();
    expect(row.status).toBe("pending_verification");
    expect(isSignedArtifact(row)).toBe(true);
  });

  it("4. re-signing is refused and keeps the original signer and instant", async () => {
    const id = await createdReport(await freshStudyRow("T4"));

    const first = await sign(id, { signatureId: sigOne });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const original = await readBack(id);

    const again = await sign(id, { signatureId: sigTwo });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/already_signed/);

    const after = await readBack(id);
    expect(after.signedByName).toBe(original.signedByName);
    expect(after.signedAt).toBe(original.signedAt);
  });

  it("5. a withdrawn signature stops being a witness and reopens the study", async () => {
    const rowId = await freshStudyRow("T5");
    const id = await createdReport(rowId);

    // Sign as the session's own identity, which is also who may withdraw it.
    const signed = await sign(id, {});
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const flip = await finalizeToStudy(rowId, id);
    expect(flip.status, JSON.stringify(flip.body)).toBeLessThan(400);
    expect((await worklist(rowId)).status).toBe("REPORT_FINAL");

    const withdrawn = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .set(auth)
      .send({ reason: `vitest ${marker}: wrong patient disclosed` });
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBeLessThan(400);

    const row = await readBack(id);
    expect(row.signedAt).toBeNull();
    expect(row.status).toBe("draft");
    expect(isSignedArtifact(row)).toBe(false);

    // The study is editable again, and the row no longer points at the report —
    // which is why the finalize caption must fall back to "Confirm & Sign"
    // rather than stay on any signature word.
    const wl = await worklist(rowId);
    expect(wl.status).not.toBe("REPORT_FINAL");
    expect(wl.reportId).toBeNull();
  });

  it("6. a study marked final with no report behind it has no witness to show", async () => {
    // The state the badge must name — REPORT_FINAL with `report_id` NULL — has
    // exactly two ways in, and they are not equivalent. Pinning only the end
    // state would leave the door that fabricates it untested.
    const rowId = await freshStudyRow("T6", null);

    // (a) A status-only flip from a signing role is refused. This is the closed
    // door (#1035): before it, naming REPORT_FINAL with no report row returned
    // 200, left report_id NULL and — because the workspace's own signing gate
    // reads that status — locked the study out of ever being signed.
    const statusOnly = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({ worklistId: rowId, status: "REPORT_FINAL", actor: SIGNER_NAME });
    expect(statusOnly.status, JSON.stringify(statusOnly.body)).toBe(409);
    expect(String(statusOnly.body.error)).toBe("SOFT_FINAL_BLOCKED");
    expect((await worklist(rowId)).status).not.toBe("REPORT_FINAL");

    // (b) The override flag does not move a radiologist through that door: soft
    // final is restricted by ROLE, not by asking nicely. A witness could
    // otherwise be manufactured by whoever holds a signing permission.
    const flagged = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: rowId,
        status: "REPORT_FINAL",
        actor: SIGNER_NAME,
        softFinalOverride: true,
        softFinalReason: `vitest ${marker}: override must not open the door for a radiologist`,
      });
    expect(flagged.status, JSON.stringify(flagged.body)).toBe(409);
    expect((await worklist(rowId)).status).not.toBe("REPORT_FINAL");

    // (c) The legitimate way: an unbilled study (no patient, so no report row is
    // possible) finalized the way the workspace finalizes it — READY_TO_SEND
    // included. The flip lands, and the read the badge uses carries no witness.
    const flip = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: rowId,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        actor: SIGNER_NAME,
      });
    expect(flip.status, JSON.stringify(flip.body)).toBeLessThan(400);

    const asTheUiReadsIt = await request(app).get(`/api/radiology/pacs-worklist/${rowId}`).set(auth);
    expect(asTheUiReadsIt.status, JSON.stringify(asTheUiReadsIt.body)).toBe(200);
    expect(asTheUiReadsIt.body.status).toBe("REPORT_FINAL");
    expect(asTheUiReadsIt.body.reportId ?? null).toBeNull();
    // No id, no row: the only claim left that is true is that there is no report.
    expect(isSignedArtifact(asTheUiReadsIt.body)).toBe(false);
  });

  it("7. two patients' reports keep their own witnesses side by side", async () => {
    // Patient A's report, signed.
    const aRowId = await freshStudyRow("T7A");
    const aId = await createdReport(aRowId);
    const aSigned = await sign(aId, { signatureId: sigOne });
    expect(aSigned.status, JSON.stringify(aSigned.body)).toBe(200);

    // Patient B's report on B's own worklist row and B's own bill, left as a
    // draft.
    const bRowId = await freshStudyRow("T7B", patientB);
    const bId = await createdReport(bRowId, { patientId: patientB, orderId: orderB });

    const aRow = await readBack(aId);
    const bRow = await readBack(bId);
    expect(aRow.patientId).toBe(patientA);
    expect(bRow.patientId).toBe(patientB);
    expect(isSignedArtifact(aRow)).toBe(true);
    expect(isSignedArtifact(bRow)).toBe(false);
    // A badge keyed on "some report id exists" would light up green for B here;
    // the study's own row is what keeps them apart, and each points at its own.
    expect(aRow.studyId).toBe(aRowId);
    expect(bRow.studyId).toBe(bRowId);
  });
});
