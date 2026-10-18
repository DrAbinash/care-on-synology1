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
 *     `renderReportVersionHtml`, and `showMeasurements` — a stored,
 *     admin-editable institutional-style flag that defaults ON — is written by
 *     `PUT /api/radiology/institutional-style` and read by no renderer at all
 *     (in `patient-reports.ts` it appears only inside one preset literal). It
 *     is left unread here too: printing the table whenever the study has
 *     measured levels is what the draft preview does today, and giving that
 *     dormant flag a new meaning is the owner's call, not a side effect of a
 *     bug fix.
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
  radiologyReportDraftsTable,
  patientReportsTable,
  spinalMeasurementsTable,
  signaturesTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { findCanalApTables } from "@workspace/measurements";

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
  const draftIds: number[] = [];
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

  /** Create a study exactly as the product leaves it: worklist linked to a billed study,
   *  canal rows keyed as the reporting workspace keys them, and — when `draftEnvelope`
   *  is given — the study's own draft holding the canonical measurement record the
   *  Reporting Workspace grid writes. Passing that envelope is what makes these cases
   *  measure the join instead of one side of it: every case above seeds
   *  `spinal_measurements` directly, which is why entry was tested, print was tested,
   *  and nothing tested that a number the radiologist can see reaches the paper. */
  async function studyWithCanalRows(
    levels = LEVELS,
    key: "billed" | "worklist-row" = "billed",
    draftEnvelope?: unknown,
    examName = "MRI LUMBAR SPINE",
  ) {
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
        studyDescription: examName,
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
        studyDescription: examName,
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

    let draftId: number | null = null;
    if (draftEnvelope !== undefined) {
      // save-draft stores the worklist ROW id here, which is why the signing route
      // reads both ids — and why this row is keyed the way the product keys it.
      const [draft] = await db
        .insert(radiologyReportDraftsTable)
        .values({
          status: "DRAFT",
          worklistId: worklist.id,
          studyId: worklist.id,
          patientId: null,
          modality: "MR",
          studyName: examName,
          rawFindings: `Lumbar canal assessed at three levels. ${tag}`,
          impression: "[]",
          structuredJson: draftEnvelope,
        })
        .returning();
      draftId = draft.id;
      draftIds.push(draft.id);
    }
    return { study, worklist, tag, measurementKey, draftId };
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
    // ?preview=true renders the same artifact without the delivery
    // bookkeeping (share log, delivered stamp, audit) — presentation only, so
    // this is the document the clinic prints with no side effects written by the
    // test itself.
    const res = await request(app).get(`/api/patient-reports/${reportId}/print?preview=true`).set(auth);
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
    for (const id of draftIds) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id)).catch(() => {});
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
    const html = await printHtml(reportId);
    const text = visibleText(html);

    expect(text).toMatch(/LUMBAR CANAL AP DIAMETER/);
    expect(text).toContain("AP (mm)");
    // Each measured value paired with the level it belongs to, in the rail's
    // order rather than Postgres' row order, with the segment's unmeasured levels
    // printed as an em-dash (never blank, never a 0).
    //
    // Measured on the table's own cells, not the flattened page: the section title
    // names both endpoint levels ("AT L1-L2 TO L5-S1 LEVELS"), so a page-wide
    // indexOf finds L5-S1 in the heading BEFORE the first cell and reports a level
    // order the printed table does not have.
    const { headers, values } = canalCells(html);
    expect(headers).toEqual(["LEVEL", "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    expect(Object.fromEntries(headers.slice(1).map((level, i) => [level, values[i + 1]]))).toEqual({
      "L1-L2": "—",
      "L2-L3": "—",
      "L3-L4": "15.2",
      "L4-L5": "6.4",
      "L5-S1": "8.1",
    });
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

  // ── The store the radiologist can reach must be the one that signs ───────────
  const canalRec = (level: string, over: Record<string, unknown> = {}) => ({
    level,
    measurementId: "CANAL_AP",
    unit: "mm",
    region: "lumbar",
    viewerValue: null,
    reportValue: null,
    manualOverride: false,
    annotationId: null,
    viewerMeasurementRowId: null,
    studyInstanceUID: null,
    seriesInstanceUID: null,
    sopInstanceUID: null,
    frameNumber: null,
    viewerName: null,
    capturedAt: null,
    verifiedAt: null,
    staleReason: null,
    aliasConflict: null,
    ...over,
  });
  const envelope = (records: Record<string, unknown>) => ({ careCanalApProvenance: records });
  /** Only the table itself, so a digit elsewhere on the page cannot pass as a measurement. */
  const canalRegion = (html: string) => html.match(/CANAL AP DIAMETER[\s\S]*?<\/table>/i)?.[0] ?? "";
  /** The printed header row and value row, as text, in the order they appear. */
  const canalCells = (html: string) => {
    const table = canalRegion(html).match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
    const cells = (tag: string) =>
      [...table.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) =>
        m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim(),
      );
    return { headers: cells("th"), values: cells("td") };
  };

  it("signs the number typed into the workspace grid, with no spinal_measurements row in existence", async () => {
    const { worklist, tag } = await studyWithCanalRows([], "billed", envelope({
      "L4-L5": canalRec("L4-L5", { reportValue: 8.5, manualOverride: true }),
      "L5-S1": canalRec("L5-S1", { reportValue: 9.1, manualOverride: true }),
    }));
    const reportId = await signedReportFor(worklist, tag);
    const html = await printHtml(reportId);
    expect(canalRegion(html)).toContain("8.5");
    expect(canalRegion(html)).toContain("9.1");
    const text = visibleText(html);
    expect(text.indexOf("Lumbar canal assessed")).toBeLessThan(text.indexOf("CANAL AP DIAMETER"));
    expect(text.indexOf("CANAL AP DIAMETER")).toBeLessThan(text.lastIndexOf("Impression"));
  });

  it("signs the radiologist's override rather than the caliper row stored beside it", async () => {
    const { worklist, tag } = await studyWithCanalRows(
      [{ vertebraLevel: "L4-L5", canalAP: "7.2" }],
      "billed",
      envelope({ "L4-L5": canalRec("L4-L5", { viewerValue: 7.2, reportValue: 8.5, manualOverride: true }) }),
    );
    const reportId = await signedReportFor(worklist, tag);
    const region = canalRegion(await printHtml(reportId));
    expect(region).toContain("8.5");
    expect(region, "the overridden caliper number must not sign").not.toContain("7.2");
  });

  it("freezes the record too: editing the draft's measurement after signing does not rewrite the signed document", async () => {
    // The signed side stores the table for exactly this reason. The record is now an
    // input to signing, so the freeze has to hold against it as well as against
    // spinal_measurements (case 4 above), because the canal route reopens with the
    // study after a withdrawal and a later measurement must not rewrite a document
    // that may already have been delivered.
    const { worklist, tag, draftId } = await studyWithCanalRows(
      [],
      "billed",
      envelope({ "L4-L5": canalRec("L4-L5", { reportValue: 8.5, manualOverride: true }) }),
    );
    const reportId = await signedReportFor(worklist, tag);
    expect(canalRegion(await printHtml(reportId))).toContain("8.5");

    await db
      .update(radiologyReportDraftsTable)
      .set({ structuredJson: envelope({ "L4-L5": canalRec("L4-L5", { reportValue: 99.9, manualOverride: true }) }) })
      .where(eq(radiologyReportDraftsTable.id, draftId!));

    const after = canalRegion(await printHtml(reportId));
    expect(after, "a signed report must not print a measurement taken after it was signed").not.toContain("99.9");
    expect(after).toContain("8.5");
  });

  it("signs nothing for a level the record declines, even when the measurement table holds it", async () => {
    const { worklist, tag } = await studyWithCanalRows(
      [{ vertebraLevel: "L4-L5", canalAP: "7.2" }],
      "billed",
      envelope({
        "L4-5": canalRec("L4-5", { reportValue: 8.5, manualOverride: true }),
        "L4-L5": canalRec("L4-L5", { reportValue: 9.4, manualOverride: true }),
      }),
    );
    const reportId = await signedReportFor(worklist, tag);
    const html = await printHtml(reportId);
    expect(canalRegion(html)).toBe("");
    expect(visibleText(html)).not.toMatch(/CANAL AP DIAMETER/);
  });

  it("signs a transitional level that no fixed vocabulary can express", async () => {
    const { worklist, tag } = await studyWithCanalRows([], "billed", envelope({
      "L5-T": canalRec("L5-T", { reportValue: 8.4, manualOverride: true }),
    }));
    const reportId = await signedReportFor(worklist, tag);
    expect(canalRegion(await printHtml(reportId))).toContain("8.4");
  });

  // ── REQUIRED VERIFICATION (owner, 2026-10-17) ─────────────────────────────────
  //
  // DECISION 1 removed the rule that picked ONE segment to print, so what the signed
  // report holds is decided by the levels that carry measurements, not by the
  // examination the front desk booked. Each case below is asserted on the rendered
  // print artifact of a real signed study — the document the clinic hands out — and
  // counts the table's own headings, so a second grid cannot pass as the same answer.
  const bodyFor = (label: string, tag: string) =>
    `<div class="section-heading">Findings</div><p>${label} assessed at the levels measured. ${tag}</p>` +
    `<div class="section-heading">Impression</div><p>No significant canal stenosis. ${tag}</p>`;
  const printedCanal = (html: string) => {
    const { headers, values } = canalCells(html);
    return {
      headers,
      cells: Object.fromEntries(headers.slice(1).map((level, i) => [level, values[i + 1]])),
      // The heading is read from the page, not from `canalRegion`: that region starts
      // at "CANAL AP DIAMETER", so it cannot carry the segment word in front of it.
      title: (html.match(/([A-Z][A-Z \-]*)CANAL AP DIAMETER AT \S+ TO \S+ LEVELS/)?.[0] ?? "").trim(),
      tables: (html.match(/CANAL AP DIAMETER AT/gi) ?? []).length,
      apRows: (html.match(/AP \(mm\)/g) ?? []).length,
      // Verification 10 counted structurally, not by heading: a canal grid the report
      // did not write — the clinic template's grid of dashes, an AI-tab insertion —
      // is a second measurement table whether or not it names itself the same way.
      canalTables: findCanalApTables(html).length,
    };
  };

  /** Sign one study as booked, and hand back what its printed canal table says. */
  async function signedCanalOf(
    exam: string,
    label: string,
    opts: { rows?: Array<{ vertebraLevel: string; canalAP: string }>; records?: Record<string, unknown> } = {},
  ) {
    const { worklist, tag } = await studyWithCanalRows(
      opts.rows ?? [],
      "billed",
      opts.records === undefined ? undefined : envelope(opts.records),
      exam,
    );
    const reportId = await signedReportFor(worklist, tag, bodyFor(label, tag));
    const html = await printHtml(reportId);
    return { reportId, html, printed: printedCanal(html), text: visibleText(html) };
  }

  const rec = (level: string, value: number, region: string) =>
    canalRec(level, { region, reportValue: value, manualOverride: true });

  it("V1 MRI LS Spine: every lumbar level measured prints, in one table", async () => {
    const { printed, text } = await signedCanalOf("MRI LUMBAR SPINE", "Lumbar canal", {
      rows: [{ vertebraLevel: "L2-L3", canalAP: "16.1" }, { vertebraLevel: "L4-L5", canalAP: "9.7" }],
    });
    expect(printed.title).toBe("LUMBAR CANAL AP DIAMETER AT L1-L2 TO L5-S1 LEVELS");
    expect(printed.headers).toEqual(["LEVEL", "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    expect(printed.cells).toEqual({ "L1-L2": "—", "L2-L3": "16.1", "L3-L4": "—", "L4-L5": "9.7", "L5-S1": "—" });
    expect(printed.tables).toBe(1);
    expect(printed.canalTables).toBe(1);
    expect(text).toContain("No significant canal stenosis");
  });

  it("V2 MRI Cervical Spine: the cervical grid prints, and C1-C2 is not invented", async () => {
    const six = await signedCanalOf("MRI CERVICAL SPINE", "Cervical canal", {
      rows: ["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"].map((level, i) => ({
        vertebraLevel: level, canalAP: String(14.5 - i * 1.1),
      })),
    });
    expect(six.printed.title).toBe("CERVICAL CANAL AP DIAMETER AT C2-C3 TO C7-T1 LEVELS");
    expect(six.printed.headers.slice(1)).toEqual(["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"]);
    expect(six.printed.headers).not.toContain("C1-C2");
    expect(six.printed.tables).toBe(1);
    expect(six.printed.canalTables).toBe(1);

    // Two cervical examinations are not the same examination: a single measured disc
    // still prints its own table rather than being skipped as "not enough data".
    const one = await signedCanalOf("MRI CERVICAL SPINE", "Cervical canal", {
      rows: [{ vertebraLevel: "C5-C6", canalAP: "9.2" }],
    });
    expect(one.printed.cells["C5-C6"]).toBe("9.2");
    expect(one.printed.cells["C4-C5"]).toBe("—");
    expect(one.printed.tables).toBe(1);
  });

  it("V3 MRI Dorsal Spine: dorsal levels print on the dorsal grid, junction included when measured", async () => {
    const multi = await signedCanalOf("MRI DORSAL SPINE", "Dorsal canal", {
      rows: [{ vertebraLevel: "D3-D4", canalAP: "13.4" }, { vertebraLevel: "D6-D7", canalAP: "11.0" }, { vertebraLevel: "D9-D10", canalAP: "12.6" }],
    });
    expect(multi.printed.title).toBe("DORSAL CANAL AP DIAMETER AT D1-D2 TO D11-D12 LEVELS");
    expect(multi.printed.headers.slice(1)).toHaveLength(11);
    expect(multi.printed.cells["D3-D4"]).toBe("13.4");
    expect(multi.printed.cells["D6-D7"]).toBe("11.0");
    expect(multi.printed.cells["D9-D10"]).toBe("12.6");
    expect(multi.printed.tables).toBe(1);

    // D12-L1 exists only when the acquired coverage reaches the conus, so it is a
    // column only when somebody measured it.
    const junction = await signedCanalOf("MRI DORSAL SPINE", "Dorsal canal", {
      rows: [{ vertebraLevel: "D11-D12", canalAP: "12.2" }, { vertebraLevel: "D12-L1", canalAP: "11.8" }],
    });
    expect(junction.printed.headers).toContain("D12-L1");
    expect(junction.printed.cells["D12-L1"]).toBe("11.8");
    expect(junction.printed.tables).toBe(1);
    expect(multi.printed.headers).not.toContain("D12-L1");

    // The OHIF calipers and older drafts spell dorsal levels T*.
    const alias = await signedCanalOf("MRI DORSAL SPINE", "Dorsal canal", {
      records: { "D8-D9": rec("D8-D9", 12.6, "dorsal") },
    });
    expect(alias.printed.cells["D8-D9"]).toBe("12.6");
  });

  it("V4 MRI Dorso-Lumbar Spine: one combined table, no segment dropped and no second grid", async () => {
    const { printed, text } = await signedCanalOf("MRI DORSO-LUMBAR SPINE", "Dorso-lumbar canal", {
      rows: [
        { vertebraLevel: "D6-D7", canalAP: "11.0" },
        { vertebraLevel: "D10-D11", canalAP: "12.9" },
        { vertebraLevel: "L2-L3", canalAP: "16.1" },
        { vertebraLevel: "L4-L5", canalAP: "9.7" },
        { vertebraLevel: "L5-S1", canalAP: "10.4" },
      ],
    });
    expect(printed.title).toBe("DORSO-LUMBAR CANAL AP DIAMETER AT D1-D2 TO L5-S1 LEVELS");
    // Every measured level of BOTH segments is on the page — this is the case that
    // used to print a lumbar-only table and lose the dorsal discs entirely.
    for (const level of ["D6-D7", "D10-D11", "L2-L3", "L4-L5", "L5-S1"]) {
      expect(printed.headers, `${level} has no column`).toContain(level);
    }
    expect(printed.cells["D6-D7"]).toBe("11.0");
    expect(printed.cells["D10-D11"]).toBe("12.9");
    expect(printed.cells["L5-S1"]).toBe("10.4");
    expect(printed.apRows, "the AP (mm) row printed more than once").toBe(1);
    expect(printed.tables).toBe(1);
    expect(printed.canalTables).toBe(1);
    expect(text).toContain("No significant canal stenosis");
  });

  it("V5 transitional vertebrae: the extra levels the grid accepts are printed", async () => {
    const { printed } = await signedCanalOf("MRI LUMBAR SPINE", "Lumbar canal with transitional anatomy", {
      records: {
        "L5-T": rec("L5-T", 8.4, "lumbar"),
        "L5-L6": rec("L5-L6", 9.1, "lumbar"),
        "L6-S1": rec("L6-S1", 10.2, "lumbar"),
      },
    });
    expect(printed.headers).toContain("L5-T");
    expect(printed.headers).toContain("L5-L6");
    expect(printed.headers).toContain("L6-S1");
    expect(printed.cells["L5-T"]).toBe("8.4");
    expect(printed.cells["L6-S1"]).toBe("10.2");
    expect(printed.tables).toBe(1);
  });

  /**
   * V7 — DECISION 2 on the signed surface. Generate writes prose, and the radiologist
   * measures after it. The Findings text here says "Canal AP diameter" in a sentence,
   * which is exactly what the old phrase match read as "a table is already printed"
   * and answered by signing no table at all.
   */
  it("V7 a measurement entered after the prose was written still signs, even when the prose names the canal", async () => {
    const { worklist, tag } = await studyWithCanalRows(
      [],
      "billed",
      envelope({
        "L4-L5": rec("L4-L5", 8.5, "lumbar"),
        "L3-L4": rec("L3-L4", 11.2, "lumbar"),
      }),
      "MRI LUMBAR SPINE",
    );
    const proseSaysCanal =
      `<div class="section-heading">Findings</div><p>Canal AP diameter is 8.5 mm at L4-L5, measured after the report was written. ${tag}</p>` +
      `<div class="section-heading">Impression</div><p>Mild canal stenosis at L4-L5. ${tag}</p>`;
    const reportId = await signedReportFor(worklist, tag, proseSaysCanal);
    const html = await printHtml(reportId);
    const printed = printedCanal(html);
    expect(printed.tables).toBe(1);
    expect(printed.canalTables).toBe(1);
    expect(printed.cells["L4-L5"]).toBe("8.5");
    expect(printed.cells["L3-L4"]).toBe("11.2");
  });

  it("V10 the clinic's own blank canal grid is replaced by the measured table, not left beside it", async () => {
    // structuredReportTemplates.ts ships the LS-Spine normal with `Canal Diameter:`
    // over a grid of dashes. Treating that placeholder as an already-printed table
    // would sign a report with no measurement in it at all.
    const scaffold = `<div class="section-heading">Canal Diameter</div>`
      + `<table><thead><tr><th>Level</th><th>AP Canal (mm)</th></tr></thead><tbody>`
      + ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]
        .map((l) => `<tr><td>${l}</td><td>—</td></tr>`).join("")
      + `</tbody></table>`;
    const { worklist, tag } = await studyWithCanalRows(
      [{ vertebraLevel: "L4-L5", canalAP: "9.7" }],
      "billed",
      undefined,
      "MRI LUMBAR SPINE",
    );
    const reportId = await signedReportFor(worklist, tag, `${workspaceBody(tag)}${scaffold}`);
    const html = await printHtml(reportId);
    const printed = printedCanal(html);
    expect(printed.tables).toBe(1);
    expect(printed.cells["L4-L5"]).toBe("9.7");
    expect(printed.apRows).toBe(1);
    // Counted as grids, not as headings: the template's placeholder and the measured
    // table must not both be on the page.
    expect(printed.canalTables, "the blank template grid survived alongside the measured table").toBe(1);
  });

  it("V10 a body that already prints a valued canal table is not edited into a second one", async () => {
    const { worklist, tag } = await studyWithCanalRows(
      [{ vertebraLevel: "L4-L5", canalAP: "9.7" }],
      "billed",
      undefined,
      "MRI LUMBAR SPINE",
    );
    const composed = workspaceBody(tag)
      + `<div class="section-heading">LUMBAR CANAL AP DIAMETER AT L1-L2 TO L5-S1 LEVELS</div>`
      + `<table><thead><tr><th>LEVEL</th><th>L1-L2</th><th>L4-L5</th></tr></thead>`
      + `<tbody><tr><td>AP (mm)</td><td>16.0</td><td>9.7</td></tr></tbody></table>`;
    const reportId = await signedReportFor(worklist, tag, composed);
    const html = await printHtml(reportId);
    expect(printedCanal(html).tables).toBe(1);
    expect(printedCanal(html).canalTables).toBe(1);
    expect(visibleText(await printHtml(reportId))).toContain("16.0");
  });

  /**
   * V8 and V9 — the two surfaces that used to be produced from a body nobody had put
   * a table into. The PDF is the signed artifact the clinic delivers, and the
   * amendment is a new signed document, so each has to carry the same numbers the
   * print page does.
   */
  it("V8 the signed PDF artifact carries the table the print page carries", async () => {
    const { buildReportArtifact } = await import("../routes/patient-reports");
    const { reportId, printed, text } = await signedCanalOf("MRI DORSO-LUMBAR SPINE", "Dorso-lumbar canal", {
      rows: [{ vertebraLevel: "D7-D8", canalAP: "11.5" }, { vertebraLevel: "L4-L5", canalAP: "9.7" }],
    });
    expect(printed.cells["D7-D8"]).toBe("11.5");
    const artifact = await buildReportArtifact(reportId, { surface: "pdf", versionMode: "specific" });
    expect(artifact, "the durable PDF artifact must resolve").not.toBeNull();
    const pdfText = visibleText(artifact!.html);
    expect(pdfText).toContain("DORSO-LUMBAR CANAL AP DIAMETER AT D1-D2 TO L5-S1 LEVELS");
    expect(pdfText).toContain("9.7");
    expect((artifact!.html.match(/CANAL AP DIAMETER AT/gi) ?? []).length).toBe(1);
    expect(pdfText).toContain(text.slice(text.indexOf("Dorso-lumbar canal"), text.indexOf("Dorso-lumbar canal") + 40));
  });
});
