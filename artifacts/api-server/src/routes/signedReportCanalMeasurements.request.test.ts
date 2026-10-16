/**
 * A measured spinal canal AP diameter reached the draft print-preview and then
 * stopped existing.
 *
 * Measured 2026-10-16 against the real server surfaces of one signed study
 * (isolated Postgres, synthetic patient, artifacts captured from the running
 * app): the canal table was absent from the signed print HTML, from the
 * Chromium-rendered signed PDF, and from the Word export, while the draft
 * preview of the same examination printed it. Two causes, both proven:
 *
 *  1. the table is drawn from `spinal_measurements` when the DRAFT preview
 *     renders, and never stored, so the content the workspace POSTs to
 *     `patient_reports.body` — the signed document's clinical body — has no
 *     table in it;
 *  2. nothing on the signed side reads `spinal_measurements` at all. Every
 *     signed surface (print, PDF, public/WhatsApp PDF, email share, PACS
 *     archive) renders `patient_reports.body` through
 *     `renderReportVersionHtml`, and the style flag that looks like the hook
 *     for it (`showMeasurements`) appears nowhere but a preset literal.
 *
 * The correction is to freeze the table INTO the stored body when a radiology
 * report is created, exactly where the draft preview puts it (after Findings,
 * before Impression), and not to re-derive it at render time. That distinction
 * is the point of case 4 below: a signed report is a historical document, so a
 * measurement entered or edited after signing must not silently rewrite what
 * was already signed and possibly already delivered. Rendering from live rows
 * would do precisely that, and would also add a table to reports that were
 * signed before this change — which is a change to an existing signed report.
 *
 * Every assertion is on a produced artifact, not on source text. The same
 * `artifact.html` is what Chromium prints, so the PDF case names the artifact
 * the PDF is rendered from rather than claiming to read PDF bytes — Vitest has
 * no PDF text extractor here, and `reportPdfGenerator.letterpad` is the suite
 * that needs the external `pdftotext` binary.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL; runs against CI's postgres:16.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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
  spinalMeasurementsTable,
  signaturesTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("canal AP measurements on the signed report", () => {
  let app: Express;
  const marker = `signed-canal-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const auth = { Authorization: `Bearer ${token}` };

  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  let signatureId = 0;
  let seq = 0;
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const reportIds: number[] = [];
  const measurementKeys = new Set<number>();

  const LEVELS = [
    { vertebraLevel: "L3-L4", canalAP: "15.2" },
    { vertebraLevel: "L4-L5", canalAP: "6.4" },
    { vertebraLevel: "L5-S1", canalAP: "8.1" },
  ];

  /** The body the Reporting Workspace composes: section headings, no table. */
  const workspaceBody = (tag: string) =>
    `<div class="section-heading">Findings</div><p>Lumbar canal assessed at three levels. ${tag}</p>` +
    `<div class="section-heading">Impression</div><p>Lumbar canal stenosis at L4-L5. ${tag}</p>`;

  const visibleText = (html: string) =>
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");

  /** A study exactly as the product leaves it: worklist linked to a billed
   *  study, canal rows keyed by the billed id (what the reporting rail writes). */
  async function studyWithCanalRows(levels = LEVELS, key: "billed" | "worklist-row" = "billed") {
    seq += 1;
    const tag = `${marker}-${seq}`;
    const [orderTest] = await db
      .insert(orderTestsTable)
      .values({ orderId, testId, price: "5000" })
      .returning();
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${tag}`,
        orderId,
        orderTestId: orderTest.id,
        patientId,
        testId,
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI LUMBAR SPINE",
        studyDate: "2026-10-16",
        status: "completed",
      })
      .returning();
    studyIds.push(study.id);
    const [worklist] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Canal Patient ${tag}`,
        patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: "MRI LUMBAR SPINE",
        studyDate: "2026-10-16",
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.signedcanal.${seq}.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(worklist.id);

    const measurementKey = key === "billed" ? study.id : worklist.id;
    measurementKeys.add(measurementKey);
    for (const l of levels) {
      await db
        .insert(spinalMeasurementsTable)
        .values({ studyId: measurementKey, worklistId: worklist.id, vertebraLevel: l.vertebraLevel, canalAP: l.canalAP, measuredBy: marker });
    }
    return { study, worklist, tag, measurementKey };
  }

  /** Create and sign the way the workspace does, then return the report id. */
  async function signedReportFor(worklist: { id: number }, tag: string, body?: string) {
    const created = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: worklist.id,
        worklistId: worklist.id,
        title: `MRI LUMBAR SPINE ${tag}`,
        body: body ?? workspaceBody(tag),
        impression: `Lumbar canal stenosis at L4-L5. ${tag}`,
      });
    expect([200, 201], `create: ${created.status} ${created.text.slice(0, 400)}`).toContain(created.status);
    const reportId = created.body.id as number;
    reportIds.push(reportId);
    const signed = await request(app)
      .post(`/api/patient-reports/${reportId}/sign`)
      .set(auth)
      .send({ signatureId });
    expect(signed.status, `sign: ${signed.text.slice(0, 400)}`).toBe(200);
    return reportId;
  }

  const printHtml = async (reportId: number) => {
    const res = await request(app).get(`/api/patient-reports/${reportId}/print`).set(auth);
    expect(res.status, `signed print: ${res.status}`).toBe(200);
    return res.text as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. Canal Signer ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
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
        patientId: `SCANAL-${marker}`,
        firstName: "Canal",
        lastName: marker,
        dateOfBirth: "1975-01-01",
        gender: "female",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;
    const [test] = await db
      .insert(testsTable)
      .values({
        name: `MRI Lumbar Spine ${marker}`,
        code: `ML${marker.slice(-4).toUpperCase()}`,
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
      .values({ orderNumber: `ORD-${marker}`, patientId, status: "completed" })
      .returning();
    orderId = order.id;
    const [sig] = await db
      .insert(signaturesTable)
      .values({
        name: `Dr. Canal Signer ${marker}`,
        role: "Radiologist",
        qualification: "MD (Radiodiagnosis)",
        registrationNo: `REG-${marker}`,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    signatureId = sig.id;
  }, 60_000);

  afterAll(async () => {
    for (const id of reportIds) await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    if (measurementKeys.size > 0) {
      await db
        .delete(spinalMeasurementsTable)
        .where(inArray(spinalMeasurementsTable.studyId, [...measurementKeys]))
        .catch(() => {});
    }
    for (const id of worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    for (const id of studyIds) await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
  });

  it("prints the measured canal table on the signed report, between Findings and Impression", async () => {
    const { worklist, tag } = await studyWithCanalRows();
    const reportId = await signedReportFor(worklist, tag);
    const text = visibleText(await printHtml(reportId));

    expect(text).toMatch(/LUMBAR CANAL AP DIAMETER/);
    expect(text).toContain("AP (mm)");
    // The measured values, not a heading with empty cells.
    for (const { canalAP } of LEVELS) expect(text, `missing ${canalAP}`).toContain(canalAP);
    // Level order and value order are the rail's, not Postgres' row order.
    expect(text.indexOf("L3-L4")).toBeLessThan(text.indexOf("L4-L5"));
    expect(text.indexOf("L4-L5")).toBeLessThan(text.indexOf("L5-S1"));
    expect(text.indexOf("15.2")).toBeLessThan(text.indexOf("6.4"));
    expect(text.indexOf("6.4")).toBeLessThan(text.indexOf("8.1"));
    // Where the draft preview puts it: after Findings, before Impression.
    expect(text.indexOf("Lumbar canal assessed")).toBeLessThan(text.indexOf("CANAL AP DIAMETER"));
    expect(text.indexOf("CANAL AP DIAMETER")).toBeLessThan(text.lastIndexOf("Impression"));
    // and the rest of the report survived being edited.
    expect(text).toContain("Lumbar canal stenosis at L4-L5");
  });

  it("carries the table into the artifact the signed PDF, email and PACS archive render from", async () => {
    const { buildReportArtifact } = await import("../routes/patient-reports");
    const { worklist, tag } = await studyWithCanalRows();
    const reportId = await signedReportFor(worklist, tag);
    const artifact = await buildReportArtifact(reportId, { surface: "pdf", versionMode: "specific" });
    expect(artifact, "the durable artifact must resolve").not.toBeNull();
    const text = visibleText(artifact!.html);
    expect(text).toMatch(/LUMBAR CANAL AP DIAMETER/);
    expect(text).toContain("6.4");
    expect(text).toContain("AP (mm)");
  });

  it("freezes the values it was signed with: a measurement changed afterwards does not rewrite the signed document", async () => {
    const { worklist, tag, measurementKey } = await studyWithCanalRows();
    const reportId = await signedReportFor(worklist, tag);
    expect(visibleText(await printHtml(reportId))).toContain("6.4");

    // Simulate time passing — a later measurement entry on the same study.
    // Written directly, because the API refuses canal mutation on a finalized
    // study and that refusal is a different suite's job to prove.
    await db
      .update(spinalMeasurementsTable)
      .set({ canalAP: "99.9" })
      .where(eq(spinalMeasurementsTable.studyId, measurementKey));

    const after = visibleText(await printHtml(reportId));
    expect(after, "a signed report must not print a measurement taken after it was signed").not.toContain("99.9");
    expect(after).toContain("6.4");
  });

  it("does not print the canal table twice when the composed body already carries it", async () => {
    const { worklist, tag } = await studyWithCanalRows();
    const alreadyTabled =
      workspaceBody(tag) +
      `<div class="section-heading">LUMBAR CANAL AP DIAMETER AT L3 TO L5-S1 LEVELS</div>` +
      `<table><tbody><tr><td>AP (mm)</td><td>15.2</td><td>6.4</td><td>8.1</td></tr></tbody></table>`;
    const reportId = await signedReportFor(worklist, tag, alreadyTabled);
    const html = await printHtml(reportId);
    const apRows = (html.match(/AP \(mm\)/g) ?? []).length;
    expect(apRows, `AP (mm) printed ${apRows} times`).toBe(1);
    const headings = (html.match(/CANAL AP DIAMETER/g) ?? []).length;
    expect(headings, `table heading printed ${headings} times`).toBe(1);
  });

  it("leaves a report with no measurements exactly as it was", async () => {
    const { worklist, tag } = await studyWithCanalRows([]);
    const reportId = await signedReportFor(worklist, tag);
    const text = visibleText(await printHtml(reportId));
    expect(text).not.toMatch(/CANAL AP DIAMETER/);
    expect(text).not.toContain("AP (mm)");
    expect(text).toContain("Lumbar canal assessed at three levels");
  });

  it("resolves canal rows stored under the worklist row id, not only the billed study id", async () => {
    // The same examination has two ids, and unlinked studies are keyed by the
    // worklist row. A signed surface that read only one would print nothing.
    const { worklist, tag } = await studyWithCanalRows([{ vertebraLevel: "L4-L5", canalAP: "7.9" }], "worklist-row");
    const reportId = await signedReportFor(worklist, tag);
    const text = visibleText(await printHtml(reportId));
    expect(text).toMatch(/LUMBAR CANAL AP DIAMETER/);
    expect(text).toContain("7.9");
  });
});
