/**
 * Withdrawing a signature must reopen the STUDY, not just the report row.
 *
 * The gap this file exists for: `POST /:id/withdraw-signature` cleared
 * signedByName/signedAt/signatureId and set the row back to draft, and its own
 * six tests in signedArtifactTrust.request.test.ts passed — because that file's
 * `newDraft()` creates a *pathology* report with no worklist row behind it. A
 * radiology report is bound to one at create time (patient-reports.ts:2141), and
 * the workspace's finalize then flips that row to REPORT_FINAL.
 * `assertDraftWritable` (radiologyIdentity.ts:291) refuses on EITHER condition,
 * so the withdrawal un-signed a report whose study could never be reported
 * again: every draft save answered 409 REPORT_LOCKED, and a second POST
 * /api/patient-reports answered `idempotent: true` off the same stale reportId
 * instead of creating the corrected report.
 *
 * Every assertion here is an HTTP status plus a re-read of the stored rows.
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
  radiologyReportDraftsTable,
  patientReportsTable,
  signaturesTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { assertDraftWritable } from "../lib/radiologyIdentity";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("signature withdrawal reopens the study — request level", () => {
  let app: Express;
  const marker = `wdraw-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const SIGNER_NAME = `Dr. Withdrawer ${marker}`;
  const REASON = `Wrong side recorded ${marker}`;

  let userId = 0;
  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  let signatureId = 0;
  const reportIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const draftIds: number[] = [];
  let seq = 0;

  const auth = { Authorization: `Bearer ${token}` };

  /**
   * A radiology study taken all the way to a signed, REPORT_FINAL study — the
   * state the Reporting Workspace leaves a study in after Finalize & Sign. Each
   * test gets its own so the cases do not depend on each other's ordering.
   *
   * `worklistStatus` overrides the flip target so the DELIVERED refusal can be
   * exercised without a real delivery run.
   *
   * `withDraft` first writes a draft through `POST /save-draft`, the way the
   * Reporting Workspace does before it finalizes. It matters because the
   * finalize stamps `radiology_report_drafts.final_report_id` on the newest
   * draft for that worklist row (`patient-reports.ts:2543`), and that stamp —
   * not the worklist row — is what the draft-side lock reads. Without a draft
   * behind the study, every assertion below only exercises the worklist half.
   */
  async function signedOffStudy(worklistStatus = "REPORT_FINAL", withDraft = false) {
    seq += 1;
    const tag = `${marker}-${seq}`;
    const today = new Date().toISOString().slice(0, 10);

    const [ot] = await db
      .insert(orderTestsTable)
      .values({ orderId, testId, price: "5000" })
      .returning();
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

    // GREEN/APPROVED so the match gate at POST /api/patient-reports and at
    // report-status both let the finalize through.
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: SIGNER_NAME,
        patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.wdraw.${seq}.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);

    if (withDraft) {
      const seeded = await saveDraft(wl.id, `DRAFT BEFORE SIGNING ${tag}`);
      expect(seeded.status, `seed draft: ${seeded.text}`).toBe(200);
    }

    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: wl.id,
        worklistId: wl.id,
        title: `MRI Brain ${tag}`,
        body: `<p>SIGNED BODY ${tag}</p>`,
        impression: "No acute intracranial abnormality.",
      });
    expect([200, 201], `create: ${created.status} ${created.text}`).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    // Create binds the worklist row itself (patient-reports.ts:2141).
    expect((await worklist(wl.id)).reportId).toBe(reportId);

    const flipped = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: wl.id,
        accessionNumber: wl.accessionNumber,
        studyInstanceUID: wl.studyInstanceUID,
        status: worklistStatus,
        deliveryStatus: "READY_TO_SEND",
        reportId,
      });
    expect(flipped.status, `report-status: ${flipped.text}`).toBe(200);

    const signed = await request(app)
      .post(`/api/patient-reports/${reportId}/sign`)
      .set(auth)
      .send({ signatureId });
    expect([200, 201], `sign: ${signed.status} ${signed.text}`).toContain(signed.status);

    return { worklistId: wl.id, reportId, tag };
  }

  async function worklist(id: number) {
    const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    if (!wl) throw new Error(`worklist ${id} vanished`);
    return wl;
  }

  async function report(id: number) {
    const [r] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
    if (!r) throw new Error(`report ${id} vanished`);
    return r;
  }

  function withdraw(reportId: number, reason: string = REASON) {
    return request(app)
      .post(`/api/patient-reports/${reportId}/withdraw-signature`)
      .set(auth)
      .send({ reason });
  }

  /** The workspace's own draft save — the call that 409'd before this fix. */
  function saveDraft(worklistId: number, text: string) {
    return request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set(auth)
      .send({ studyId: worklistId, worklistId, patientId, rawFindings: text });
  }

  /**
   * The same save with the draft's own id, which is what the Reporting Workspace
   * actually sends: `useDraftPersistence.ts` posts `id: draftId ?? undefined` on
   * every autosave, and `assertDraftWritable` only consults
   * `radiology_report_drafts` when that id is present. A body without it cannot
   * reach the draft-side lock at all.
   */
  function saveDraftWithId(draftId: number, worklistId: number, text: string) {
    return request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set(auth)
      .send({ id: draftId, studyId: worklistId, worklistId, patientId, rawFindings: text });
  }

  async function draftFor(worklistId: number) {
    const [draft] = await db
      .select()
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.worklistId, worklistId))
      .limit(1);
    if (!draft) throw new Error(`draft for worklist ${worklistId} vanished`);
    draftIds.push(draft.id);
    return draft;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER_NAME,
        email: `wdraw-${marker}@vitest.invalid`,
        username: `wdraw-${marker}`,
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
        patientId: `WDRAW-${marker}`,
        firstName: "Probe",
        lastName: `Withdrawal ${marker}`,
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
        code: `MR${marker.slice(-4).toUpperCase()}`,
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
        name: SIGNER_NAME,
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
    // Marker-scoped: every row this file created carries the marker in an
    // accession number, a name or an id list, so cleanup cannot touch unrelated
    // clinical data.
    for (const id of reportIds) {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, String(id))).catch(() => {});
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of draftIds) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id)).catch(() => {});
    }
    for (const id of studyIds) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientId)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 60_000);

  it("the finalized study is locked before anyone withdraws — this is the state the fix has to change", async () => {
    const { worklistId } = await signedOffStudy();
    const wl = await worklist(worklistId);
    expect(wl.status).toBe("REPORT_FINAL");
    expect(wl.deliveryStatus).toBe("READY_TO_SEND");

    const res = await saveDraft(worklistId, "a correction nobody can save");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPORT_LOCKED");
  });

  it("withdrawing reverts the worklist row the finalize bound", async () => {
    const { worklistId, reportId } = await signedOffStudy();

    const res = await withdraw(reportId);
    expect(res.status, res.text).toBe(200);

    const wl = await worklist(worklistId);
    expect(wl.status).toBe("REPORT_IN_PROGRESS");
    expect(wl.reportId).toBeNull();
    // Cleared with it: READY_TO_SEND would advertise an unsigned report as
    // ready to hand to the patient.
    expect(wl.deliveryStatus).toBeNull();
  });

  it("the draft becomes writable — the guard that refused is the one that now passes", async () => {
    const { worklistId, reportId } = await signedOffStudy();

    await expect(assertDraftWritable({ worklistId, patientId })).rejects.toMatchObject({
      code: "REPORT_LOCKED",
    });
    expect((await saveDraft(worklistId, "locked")).body.code).toBe("REPORT_LOCKED");

    expect((await withdraw(reportId)).status).toBe(200);

    // Pinned at the guard itself, not only through the route: no real-DB test in
    // the repo proves a minimal save-draft body returns 200 (the existing
    // save-draft successes are mocked handler tests), so asserting a success
    // status here would couple this contract to save-draft's unrelated
    // validation. What must change is that the lock stops refusing.
    await expect(assertDraftWritable({ worklistId, patientId })).resolves.toBeUndefined();
    const after = await saveDraft(worklistId, "CORRECTED FINDINGS");
    expect(after.body.code, after.text).not.toBe("REPORT_LOCKED");
  });

  it("the draft the finalize promoted stops being writable forever — withdraw must release it too", async () => {
    // The half the file above does not cover: a study that has a real workspace
    // draft behind it. `POST /api/patient-reports` stamps that draft's
    // final_report_id (patient-reports.ts:2543), and the workspace's autosave
    // carries the draft id, so `assertDraftWritable`'s draft branch runs even
    // after the worklist row has been reverted. Withdrawal therefore reopened
    // the study on the worklist half and left it locked on the draft half, with
    // a refusal — "This draft has already been finalized and cannot be
    // overwritten." — that names no way out.
    const { worklistId, reportId } = await signedOffStudy("REPORT_FINAL", true);

    const draft = await draftFor(worklistId);
    expect(draft.finalReportId, "the workspace finalize must promote the draft").toBe(reportId);

    const before = await saveDraftWithId(draft.id, worklistId, "locked while signed");
    expect(before.status, before.text).toBe(409);
    expect(before.body.code).toBe("REPORT_LOCKED");

    expect((await withdraw(reportId)).status, "withdrawal").toBe(200);

    const [promoted] = await db
      .select({ finalReportId: radiologyReportDraftsTable.finalReportId })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, draft.id));
    expect(promoted.finalReportId, "an unsigned report must not keep a draft pointing at it as final").toBeNull();

    const after = await saveDraftWithId(draft.id, worklistId, "CORRECTED FINDINGS AFTER WITHDRAWAL");
    expect(after.body.code, after.text).not.toBe("REPORT_LOCKED");
    expect(after.status, after.text).toBe(200);
  });

  it("the study can be reported again instead of answering idempotent off the stale pointer", async () => {
    const { worklistId, reportId, tag } = await signedOffStudy();
    expect((await withdraw(reportId)).status).toBe(200);

    const again = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: worklistId,
        worklistId,
        title: `MRI Brain ${tag} corrected`,
        body: "<p>CORRECTED BODY</p>",
        impression: "Corrected impression.",
      });
    expect([200, 201], again.text).toContain(again.status);
    // C1 — the corrected report goes through the study's OWN row, not beside it.
    // This assertion used to read `not.toBe(reportId)`, which recorded what the
    // implementation did rather than what the clinic needs: a second live
    // `patient_reports` row for one study, the withdrawn one left in the table as
    // `draft` with no signature and still signable (reproduced at request level in
    // `withdrawAndFailedSignIntegrity.request.test.ts`; production carried two such
    // studies). The purpose of this test is untouched — the study is reportable
    // again instead of answering `idempotent` off a stale pointer — and is now
    // proved on the content as well as the pointer, which is the clinical half.
    expect(again.body.id, `re-finalize should write through the study's own row: ${again.text}`).toBe(reportId);
    expect(again.body.idempotent).toBeUndefined();
    expect(String(again.body.body)).toContain("CORRECTED BODY");
    expect(String(again.body.title)).toContain("corrected");
    reportIds.push(again.body.id);
    expect((await worklist(worklistId)).reportId).toBe(again.body.id);
  });

  it("the signed content survives the withdrawal — it un-signs, it does not blank", async () => {
    const { reportId, tag } = await signedOffStudy();
    const before = await report(reportId);
    expect(before.signedByName).toBe(SIGNER_NAME);

    expect((await withdraw(reportId)).status).toBe(200);

    const after = await report(reportId);
    expect(after.body).toBe(before.body);
    expect(after.body).toContain(tag);
    expect(after.status).toBe("draft");
    expect(after.signedByName).toBeNull();
    expect(after.signedAt).toBeNull();
    expect(after.signatureId).toBeNull();
  });

  it("a study already marked DELIVERED refuses, and the refusal is atomic", async () => {
    const { worklistId, reportId } = await signedOffStudy("DELIVERED");

    const res = await withdraw(reportId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_delivered");

    // The point of doing this in one transaction: the report row must NOT have
    // been un-signed by the attempt that was then refused. A half-applied
    // withdrawal would leave an unsigned report on a delivered study.
    const r = await report(reportId);
    expect(r.signedByName).toBe(SIGNER_NAME);
    expect(r.signedAt).not.toBeNull();
    expect(r.status).not.toBe("draft");
    const wl = await worklist(worklistId);
    expect(wl.status).toBe("DELIVERED");
    expect(wl.reportId).toBe(reportId);

    // And nothing was recorded as withdrawn.
    const audits = await auditRows(reportId);
    expect(audits.filter((a) => JSON.parse(a.newValue ?? "{}").outcome === "withdrawn")).toHaveLength(0);
  });

  // ── Which of the three locked states the radiologist is actually in ────────
  //
  // assertDraftWritable refused DELIVERED, REPORT_FINAL and a set reportId with
  // ONE sentence, so it could only be vague enough to be true of all three:
  // "correcting a signed report is a separate, attributed action". That names no
  // path, and it cannot — a delivered study has none, a final study still bound
  // to a report has Report Hub's withdrawal, and a study marked final with no
  // reportId has no signature behind it at all. These pin the three apart over
  // real HTTP, because a source grep cannot prove which branch a row reaches.
  it("a final study still bound to its report is told how to get back", async () => {
    const { worklistId } = await signedOffStudy();

    const res = await saveDraft(worklistId, "a correction nobody can save");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPORT_LOCKED");
    const message = String(res.body.error ?? "");
    expect(message, message).toMatch(/withdraw/i);
    expect(message, message).toContain("Report Hub");
    expect(message, message).toMatch(/signer or an administrator/i);
    // The row this fixture builds is signed but not verified, so the button IS
    // there — but the message must not promise it unconditionally, because the
    // legacy verify route can change that without touching the worklist row.
    expect(message, message).toMatch(/unless it has been verified or delivered/i);
  });

  it("a delivered study is told there is no way back, not sent looking for one", async () => {
    const { worklistId } = await signedOffStudy("DELIVERED");

    const res = await saveDraft(worklistId, "a correction nobody can save");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPORT_LOCKED");
    const message = String(res.body.error ?? "");
    expect(message, message).toMatch(/already been delivered/i);
    expect(message, message).toMatch(/cannot be un-signed from the app/i);
    // withdraw-signature refuses this row `already_delivered` (:2932), and
    // Report Hub hides the button for the same reason. Naming either here sends
    // staff on a trip that ends in a second refusal.
    expect(message, message).not.toMatch(/withdraw/i);
    expect(message, message).not.toContain("Report Hub");
  });

  it("a study marked final with no report behind it is not sent to a signature that does not exist", async () => {
    const { worklistId } = await signedOffStudy();
    // The state the workspace renders as "Study marked final — NO report
    // exists" (`signedReportBadge("no-signed-report")` in
    // diagnostic-erp/src/lib/radiologyReportLifecycle.ts): REPORT_FINAL with
    // reportId null. Reached here by unbinding
    // the pointer rather than by skipping report creation, because that is the
    // only part of the state assertDraftWritable reads.
    await db
      .update(radiologyWorklistTable)
      .set({ reportId: null })
      .where(eq(radiologyWorklistTable.id, worklistId));
    expect((await worklist(worklistId)).status).toBe("REPORT_FINAL");

    const res = await saveDraft(worklistId, "a correction nobody can save");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPORT_LOCKED");
    const message = String(res.body.error ?? "");
    expect(message, message).toMatch(/no report linked to it/i);
    expect(message, message).not.toMatch(/withdraw/i);
    expect(message, message).not.toContain("Report Hub");
  });

  it("the audit row records which study was reopened, and from what", async () => {
    const { worklistId, reportId } = await signedOffStudy();
    expect((await withdraw(reportId)).status).toBe(200);

    const audits = await auditRows(reportId);
    const withdrawn = audits.filter((a) => JSON.parse(a.newValue ?? "{}").outcome === "withdrawn");
    expect(withdrawn).toHaveLength(1);
    const details = JSON.parse(withdrawn[0].newValue ?? "{}");
    expect(details.reason).toBe(REASON);
    expect(details.withdrawn.signedByName).toBe(SIGNER_NAME);
    expect(details.reopenedWorklist).toEqual({
      id: worklistId,
      statusFrom: "REPORT_FINAL",
      deliveryStatusFrom: "READY_TO_SEND",
    });
  });

  it("a report with no worklist behind it still withdraws, and says nothing was reopened", async () => {
    // The pathology-shaped row the pre-existing suite uses: no study, no
    // worklist. The revert must be conditional on the pointer existing, not
    // assume every signed report came from the radiology workspace.
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "pathology",
        patientId,
        testId,
        title: `Unbound ${marker}`,
        body: "UNBOUND SIGNED BODY",
      });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    await request(app).post(`/api/patient-reports/${reportId}/sign`).set(auth).send({ signatureId });

    const res = await withdraw(reportId);
    expect(res.status, res.text).toBe(200);
    expect((await report(reportId)).status).toBe("draft");

    const audits = await auditRows(reportId);
    const withdrawn = audits.filter((a) => JSON.parse(a.newValue ?? "{}").outcome === "withdrawn");
    expect(withdrawn).toHaveLength(1);
    expect(JSON.parse(withdrawn[0].newValue ?? "{}").reopenedWorklist).toBeNull();
  });

  it("the pre-existing refusals still hold on a worklist-bound radiology report", async () => {
    // Widening what withdrawal does must not widen who can do it or what it
    // accepts. Same route, same guards, now with a study behind it.
    const { worklistId, reportId } = await signedOffStudy();

    const noReason = await withdraw(reportId, "   ");
    expect(noReason.status).toBe(400);
    expect((await report(reportId)).signedByName).toBe(SIGNER_NAME);

    const unauthenticated = await request(app)
      .post(`/api/patient-reports/${reportId}/withdraw-signature`)
      .send({ reason: REASON });
    expect(unauthenticated.status).toBe(401);

    expect((await worklist(worklistId)).status).toBe("REPORT_FINAL");
  });

  async function auditRows(id: number) {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, String(id)));
    return rows.filter((r) => r.action === "signature_withdrawn");
  }
});
