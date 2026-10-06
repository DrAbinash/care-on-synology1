/**
 * A report with nothing in it must not become a signed report.
 *
 * The gap this file exists for: `patient_reports.body` is, in the schema's own
 * words, "the authoritative, append-only signed artifact", and for a radiology
 * row it is the only content that reaches the print page, the PDF, the WhatsApp
 * link and the PACS archive. Nothing on the server read it. POST /api/patient-reports
 * defaults `body` to "" and POST /:id/sign checked nine separate conditions —
 * role, existence, already-verified, signed structured document, already-signed,
 * unreviewed AI, signature row, signer identity — and not one of them looked at
 * the text.
 *
 * Reaching a blank signed report needs no API crafting. Report Hub → New Report
 * → pick a patient and a test → Create → Sign: ReportHub.tsx:490 sends no `body`
 * key at all, and SignDialog (:970) then sends only `{ signatureId }`.
 *
 * The guard is enforced at BOTH boundaries, and the split matters:
 *
 *  - at POST / (create), so the canonical workspace finalize aborts before the
 *    worklist is flipped. radiologyReportLifecycle.ts's autoSignReport never
 *    throws — "a failure here must not undo the report row that was already
 *    created or block the worklist flip" — so a blank caught only at sign time
 *    would leave a FINAL study pointing at an unsigned blank draft, and
 *    re-finalizing cannot repair it because POST / answers `idempotent: true`
 *    for an already-bound worklist and discards the new body. Create fires only
 *    when the caller actually supplied a `body`, which is what keeps Report
 *    Hub's create-then-edit flow working (test 4).
 *  - at POST /:id/sign, for rows that were created with no body, or created
 *    before this guard existed.
 *
 * A refusal is never a dead end: `contentOverride: true` plus a
 * `contentOverrideReason` of at least three characters signs it anyway, and that
 * override is attributed and audited (test 6). This mirrors the existing
 * soft-final override contract in internal-radiology.ts, except that it is NOT
 * restricted to admin roles — the signer is the person attesting the document
 * says what they mean.
 *
 * The classifier itself is pure and is covered against all five real body
 * producers in lib/signedReportContentGuard.test.ts, which runs without a
 * database. This file pins the route behaviour around it.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts); in CI it runs
 * against the postgres:16 service.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
  auditLogsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

/** RadiologyCommandCenter.tsx:842-855 with every field left blank. */
const EMPTY_SCAFFOLD_BODY = `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3 style="break-after:avoid-page;page-break-after:avoid;">Radiology Report: MRI Brain</h3>
          <p><strong>Patient Name:</strong> Somebody</p>
          <p><strong>Clinical History:</strong> </p>
          <p><strong>Technique:</strong> </p>
          <hr />
          <h4 style="break-after:avoid-page;page-break-after:avoid;">Findings</h4>
          <p style="white-space: pre-line;"></p>
          <h4 style="break-after:avoid-page;page-break-after:avoid;">Impression</h4>
          <ol></ol>
          <p><strong>Recommendation:</strong> </p>
        </div>
      `;

const REAL_BODY = "<p>No acute intracranial abnormality. No midline shift.</p>";
const OVERRIDE_REASON = "Dictation to follow by addendum";

describe.skipIf(!dbReady)("signed report must have content — request level", () => {
  let app: Express;
  const marker = `scontent-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const SIGNER_NAME = `Dr. Content ${marker}`;

  let userId = 0;
  let patientId = 0;
  let testId = 0;
  let pathologyTestId = 0;
  let orderId = 0;
  let signatureId = 0;
  let seq = 0;

  const reportIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const orderIds: number[] = [];

  const auth = { Authorization: `Bearer ${token}` };

  /** A fresh GREEN/APPROVED worklist row so no two tests share state. */
  async function newWorklist() {
    seq += 1;
    const tag = `${marker}-${seq}`;
    const today = new Date().toISOString().slice(0, 10);

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${tag}`, patientId, status: "pending" })
      .returning();
    orderIds.push(order.id);
    const [ot] = await db
      .insert(orderTestsTable)
      .values({ orderId: order.id, testId, price: "5000" })
      .returning();
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${tag}`,
        orderId: order.id,
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
        patientName: SIGNER_NAME,
        patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.scontent.${seq}.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);
    return wl;
  }

  function createReport(wl: { id: number }, body: Record<string, unknown>) {
    return request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: wl.id,
        worklistId: wl.id,
        title: `MRI Brain ${wl.id}`,
        impression: "No acute intracranial abnormality.",
        ...body,
      });
  }

  function sign(reportId: number, extra: Record<string, unknown> = {}) {
    return request(app)
      .post(`/api/patient-reports/${reportId}/sign`)
      .set(auth)
      .send({ signatureId, ...extra });
  }

  async function worklistRow(id: number) {
    const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    if (!wl) throw new Error(`worklist ${id} vanished`);
    return wl;
  }

  async function reportRow(id: number) {
    const [r] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
    if (!r) throw new Error(`report ${id} vanished`);
    return r;
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: SIGNER_NAME,
        email: `scontent-${marker}@vitest.invalid`,
        username: `scontent-${marker}`,
        // NOT admin: the override must work for the radiologist who signs, and
        // an admin fixture would short-circuit both permission gates and prove
        // nothing about that.
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "/reports", "/reports:sign", "/patients"]),
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
        patientId: `SCONTENT-${marker}`,
        firstName: "Probe",
        lastName: `Content ${marker}`,
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
        code: `SC${marker.slice(-4).replace(/[^A-Za-z0-9]/g, "x").toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;

    // A pathology test, for the exemption in test 8: pathology keeps its content
    // in `parameters`, which a text classifier has no business judging.
    const [pathTest] = await db
      .insert(testsTable)
      .values({
        name: `CBC ${marker}`,
        code: `SP${marker.slice(-4).replace(/[^A-Za-z0-9]/g, "x").toUpperCase()}`,
        price: "500",
        category: "Pathology",
        department: "Laboratory",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    pathologyTestId = pathTest.id;

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-SETUP-${marker}`, patientId, status: "pending" })
      .returning();
    orderId = order.id;
    orderIds.push(orderId);

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
    // accession number, an order number, a name or an id list, so cleanup cannot
    // touch unrelated clinical data.
    for (const id of reportIds) {
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of studyIds) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
    for (const id of orderIds) {
      await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, id)).catch(() => {});
      await db.delete(ordersTable).where(eq(ordersTable.id, id)).catch(() => {});
    }
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, pathologyTestId)).catch(() => {});
    await db
      .delete(auditLogsTable)
      .where(and(eq(auditLogsTable.module, "radiology"), eq(auditLogsTable.userName, SIGNER_NAME)))
      .catch(() => {});
  }, 60_000);

  it("1. refuses to finalize a body that is only the template's own scaffolding, and writes nothing", async () => {
    const wl = await newWorklist();
    const res = await createReport(wl, { body: EMPTY_SCAFFOLD_BODY });

    expect(res.status, res.text).toBe(409);
    expect(res.body.code).toBe("report_content_empty");
    expect(res.body.override?.allowed).toBe(true);
    expect(res.body.override?.reasonField).toBe("contentOverrideReason");
    // `error` is the field the signer's toast shows (sanitizeApiErrorMessage
    // returns it verbatim), and it is built by concatenation, so assert it reads
    // as sentences: no letter glued straight onto a full stop.
    expect(res.body.error).not.toMatch(/\.[A-Za-z]/);
    expect(res.body.error).toContain("contentOverrideReason");

    // The point of guarding create rather than only sign: no row exists and the
    // study is still editable, instead of REPORT_FINAL behind a blank draft.
    const after = await worklistRow(wl.id);
    expect(after.reportId).toBeNull();
    expect(after.status).toBe("STUDY_RECEIVED");
    const orphans = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.studyId, wl.id));
    expect(orphans).toHaveLength(0);
  });

  it("2. refuses a literally empty body too", async () => {
    const wl = await newWorklist();
    const res = await createReport(wl, { body: "" });
    expect(res.status, res.text).toBe(409);
    expect(res.body.code).toBe("report_content_empty");
  });

  it("3. positive control — the same worklist finalizes once findings are written", async () => {
    const wl = await newWorklist();
    const res = await createReport(wl, { body: REAL_BODY });
    expect([200, 201], res.text).toContain(res.status);
    reportIds.push(res.body.id as number);
    expect((await worklistRow(wl.id)).reportId).toBe(res.body.id);
  });

  it("4. Report Hub's create-then-edit flow still works, and the blank is caught at sign instead", async () => {
    const wl = await newWorklist();
    // ReportHub.tsx:490 sends no `body` key at all. With nothing supplied there
    // is nothing to judge at create time, so the draft must still be created.
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({ type: "radiology", patientId, testId, studyId: wl.id, worklistId: wl.id, title: `Hub ${wl.id}` });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    expect((await reportRow(reportId)).body).toBe("");

    // SignDialog (:970) then sends only { signatureId } — this is the three-click
    // path to a blank signed report that the guard exists to stop.
    const blank = await sign(reportId);
    expect(blank.status, blank.text).toBe(409);
    expect(blank.body.code).toBe("report_content_empty");
    const stillUnsigned = await reportRow(reportId);
    expect(stillUnsigned.signedAt).toBeNull();
    expect(stillUnsigned.signedByName).toBeNull();
    expect(stillUnsigned.status).toBe("draft");

    // The recovery path: write the findings through the ordinary PATCH, then sign.
    const patched = await request(app)
      .patch(`/api/patient-reports/${reportId}`)
      .set(auth)
      .send({ body: REAL_BODY });
    expect(patched.status, patched.text).toBe(200);
    const signed = await sign(reportId);
    expect([200, 201], signed.text).toContain(signed.status);
    expect((await reportRow(reportId)).signedByName).toBeTruthy();
  });

  it("5. refuses a body that is only placeholder text, and says which", async () => {
    const wl = await newWorklist();
    const res = await createReport(wl, { body: "<p>[insert findings]</p><p>TODO</p>" });
    expect(res.status, res.text).toBe(409);
    expect(res.body.code).toBe("report_content_placeholder");
    expect(res.body.placeholders.length).toBeGreaterThan(0);
    expect(res.body.error).not.toMatch(/\.[A-Za-z]/);
  });

  it("6. an attributed override signs it anyway and writes a signed_content_override audit row", async () => {
    const wl = await newWorklist();
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({ type: "radiology", patientId, testId, studyId: wl.id, worklistId: wl.id, title: `Override ${wl.id}` });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    const signed = await sign(reportId, { contentOverride: true, contentOverrideReason: OVERRIDE_REASON });
    expect([200, 201], signed.text).toContain(signed.status);
    const row = await reportRow(reportId);
    expect(row.signedByName).toBeTruthy();
    expect(row.status).toBe("pending_verification");

    const audits = await db
      .select({ action: auditLogsTable.action, reason: auditLogsTable.reason, entityId: auditLogsTable.entityId })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "signed_content_override"));
    const mine = audits.filter((a) => a.entityId === String(reportId));
    expect(mine).toHaveLength(1);
    expect(mine[0].reason).toBe(OVERRIDE_REASON);
  });

  it("7. the override needs BOTH the flag and a real reason", async () => {
    const wl = await newWorklist();
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({ type: "radiology", patientId, testId, studyId: wl.id, worklistId: wl.id, title: `NoOverride ${wl.id}` });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    // Reason but no flag.
    const reasonOnly = await sign(reportId, { contentOverrideReason: OVERRIDE_REASON });
    expect(reasonOnly.status, reasonOnly.text).toBe(409);
    // Flag but a reason too short to be a reason (same 3-char minimum the
    // soft-final override uses).
    const shortReason = await sign(reportId, { contentOverride: true, contentOverrideReason: "x" });
    expect(shortReason.status, shortReason.text).toBe(409);
    // Flag but no reason at all.
    const flagOnly = await sign(reportId, { contentOverride: true });
    expect(flagOnly.status, flagOnly.text).toBe(409);

    const row = await reportRow(reportId);
    expect(row.signedAt).toBeNull();
    expect(row.status).toBe("draft");
  });

  it("8. a refusal is audited as legacy_sign_rejected with the content reason", async () => {
    const wl = await newWorklist();
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({ type: "radiology", patientId, testId, studyId: wl.id, worklistId: wl.id, title: `Audit ${wl.id}` });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    const refused = await sign(reportId);
    expect(refused.status).toBe(409);

    const audits = await db
      .select({ action: auditLogsTable.action, reason: auditLogsTable.reason, entityId: auditLogsTable.entityId })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "legacy_sign_rejected"));
    const mine = audits.filter((a) => a.entityId === String(reportId));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((a) => a.reason === "report_content_empty")).toBe(true);
  });

  it("9. pathology is exempt — its content is the parameters panel, not prose", async () => {
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "pathology",
        patientId,
        testId: pathologyTestId,
        title: `CBC ${marker}`,
        parameters: JSON.stringify([{ name: "Haemoglobin", value: "13.2", unit: "g/dL", refRange: "12-16", flag: "normal" }]),
      });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    const signed = await sign(reportId);
    expect([200, 201], signed.text).toContain(signed.status);
  });

  it("10. a pathology row with neither body nor parameters is still refused", async () => {
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({ type: "pathology", patientId, testId: pathologyTestId, title: `Blank CBC ${marker}` });
    expect([200, 201], created.text).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);

    const signed = await sign(reportId);
    expect(signed.status, signed.text).toBe(409);
    expect(signed.body.code).toBe("report_content_empty");
  });
});
